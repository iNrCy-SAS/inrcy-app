import { isExpectedRateLimitError, isTransientBrowserNetworkError } from "@/lib/clientExpectedErrors";

type SentryLikeEvent = {
  message?: string;
  logger?: string;
  level?: string;
  user?: Record<string, unknown>;
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, unknown>;
    data?: unknown;
  };
  exception?: { values?: Array<{ type?: string; value?: string; mechanism?: { handled?: boolean; type?: string } }> };
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  extra?: Record<string, unknown>;
  transaction?: string;
  contexts?: Record<string, unknown>;
  spans?: SentryLikeSpan[];
  sdkProcessingMetadata?: { dynamicSamplingContext?: Record<string, unknown> };
};

type SentryLikeSpan = {
  description?: string;
  data?: Record<string, unknown>;
};

type FilterOptions = {
  scrubHeaders?: boolean;
  /** Drop only client-side, already-handled expected control-flow noise. */
  dropExpectedClientErrors?: boolean;
};

function compactLower(value: unknown): string {
  return String(value || "").toLowerCase().trim();
}

const IMAGE_DATA_URL_RE = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi;
const LONG_BASE64_RE = /(?:[a-z0-9+/]{256,}={0,2})/gi;

/**
 * Provider errors and browser breadcrumbs must never turn an uploaded image
 * into observability data. Keep the useful error text while removing binary
 * payloads, including bare base64 strings without a data-URL prefix.
 */
function scrubBinaryPayloads(value: unknown): unknown {
  if (typeof value !== "string" || !value) return value;
  return value
    .replace(IMAGE_DATA_URL_RE, "[Filtered image]")
    .replace(LONG_BASE64_RE, "[Filtered binary]");
}

const SENSITIVE_QUERY_KEYS = /^(code|state|token|access_token|refresh_token|id_token|input_token|client_secret|fb_exchange_token|key|secret|password|signature|sig)$/i;
const SENSITIVE_TRACE_DATA_KEYS = /^(code|state|token|access_token|refresh_token|id_token|input_token|client_secret|fb_exchange_token|key|secret|password|signature|sig|body|payload|form|content|html)$|(?:^|\.)(authorization|cookie)$/i;

function scrubUrl(value: unknown): unknown {
  if (typeof value !== "string" || !value) return value;

  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.test(key)) url.searchParams.set(key, "[Filtered]");
    }
    return scrubBinaryPayloads(url.toString());
  } catch {
    return scrubBinaryPayloads(
      value.replace(/([?&](?:code|state|token|access_token|refresh_token|id_token|input_token|client_secret|fb_exchange_token|key|secret|password|signature|sig)=)[^&]*/gi, "$1[Filtered]"),
    );
  }
}

/** Redact query credentials even when an URL is embedded in a diagnostic sentence. */
function scrubDiagnosticText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return (scrubBinaryPayloads(value) as string).replace(
    /([?&](?:code|state|token|access_token|refresh_token|id_token|input_token|client_secret|fb_exchange_token|key|secret|password|signature|sig)=)[^&\s"'<>#]*/gi,
    "$1[Filtered]",
  );
}

function scrubDiagnosticData(value: unknown, sensitiveKeys: RegExp, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrubDiagnosticText(value);
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (sensitiveKeys.test(key)) delete record[key];
    else if (/^(?:url\.query|http\.query|query_string)$/i.test(key)) record[key] = scrubQueryString(record[key], seen);
    else if (/^(?:url\.full|http\.url|url)$/i.test(key) && typeof record[key] === "string") record[key] = scrubUrl(record[key]);
    else record[key] = scrubDiagnosticData(record[key], sensitiveKeys, seen);
  }
  return value;
}

function scrubQueryString(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) return value.map((entry) =>
    Array.isArray(entry) && typeof entry[0] === "string"
      ? [entry[0], SENSITIVE_QUERY_KEYS.test(entry[0]) ? "[Filtered]" : scrubDiagnosticText(entry[1])]
      : scrubDiagnosticData(entry, SENSITIVE_QUERY_KEYS, seen));
  if (value && typeof value === "object") return scrubDiagnosticData(value, SENSITIVE_QUERY_KEYS, seen);
  if (typeof value !== "string") return value;
  return scrubBinaryPayloads(
    value.replace(/(^\??|&)([^=&]+)=([^&]*)/g, (pair, prefix: string, key: string) => {
      let decodedKey = key;
      try { decodedKey = decodeURIComponent(key.replace(/\+/g, " ")); } catch {}
      return SENSITIVE_QUERY_KEYS.test(decodedKey) ? `${prefix}${key}=[Filtered]` : pair;
    }),
  );
}


/** Keep tracing diagnostics while removing credentials before the SDK serializes a span. */
export function scrubSentrySpan<T>(span: T): T {
  const mutableSpan = span as unknown as SentryLikeSpan;
  mutableSpan.description = scrubDiagnosticText(mutableSpan.description) as string | undefined;
  if (mutableSpan.data) {
    scrubDiagnosticData(mutableSpan.data, SENSITIVE_TRACE_DATA_KEYS);
  }
  return span;
}

function collectPrimaryEventText(event: SentryLikeEvent): string {
  const parts: string[] = [];
  if (event.message) parts.push(String(event.message));
  for (const item of event.exception?.values || []) {
    if (item.type) parts.push(String(item.type));
    if (item.value) parts.push(String(item.value));
  }
  return compactLower(parts.join(" | "));
}

function collectEventText(event: SentryLikeEvent): string {
  const parts: string[] = [];
  if (event.message) parts.push(String(event.message));
  for (const item of event.exception?.values || []) {
    if (item.type) parts.push(String(item.type));
    if (item.value) parts.push(String(item.value));
  }
  for (const crumb of event.breadcrumbs || []) {
    if (crumb.message) parts.push(String(crumb.message));
  }
  return compactLower(parts.join(" | "));
}


function isHandledExceptionEvent(event: SentryLikeEvent): boolean {
  const values = event.exception?.values || [];
  if (!values.length) return compactLower(event.logger).includes("console");
  return values.every((value) => value.mechanism?.handled !== false);
}

function shouldDropExpectedClientEvent(event: SentryLikeEvent): boolean {
  const text = collectPrimaryEventText(event);
  if (!text) return false;

  // A 429 is expected control flow. It remains enforced by the API and should
  // not appear as an application crash when a client promise is not awaited.
  if (isExpectedRateLimitError(text)) return true;

  // Generic Safari/browser fetch interruptions are dropped only when Sentry
  // marks them as handled. Unhandled network crashes remain visible.
  return isHandledExceptionEvent(event) && isTransientBrowserNetworkError(text);
}

function shouldDropNoisyEvent(event: SentryLikeEvent): boolean {
  const text = collectEventText(event);
  if (!text) return false;

  return [
    "the message port closed before a response was received",
    "unchecked runtime.lasterror",
    "resizeobserver loop completed with undelivered notifications",
    "resizeobserver loop limit exceeded",
    "non-error promise rejection captured with value: cancelled",
  ].some((needle) => text.includes(needle)) ||
    /^aborterror\b/.test(text) ||
    text === "aborted" ||
    text.includes("error | aborted") ||
    text.includes("abortincoming") ||
    text.includes("request aborted") ||
    text.includes("socket hang up");
}

export function filterSentryEvent<T>(event: T, options: FilterOptions = {}): T | null {
  const mutableEvent = event as unknown as SentryLikeEvent;

  if (shouldDropNoisyEvent(mutableEvent)) return null;
  if (options.dropExpectedClientErrors && shouldDropExpectedClientEvent(mutableEvent)) return null;

  if (mutableEvent.user) {
    delete mutableEvent.user.email;
    delete mutableEvent.user.ip_address;
    delete mutableEvent.user.username;
  }

  if (options.scrubHeaders && mutableEvent.request?.headers) {
    delete mutableEvent.request.headers.authorization;
    delete mutableEvent.request.headers.Authorization;
    delete mutableEvent.request.headers.cookie;
    delete mutableEvent.request.headers.Cookie;
  }

  if (mutableEvent.request) {
    mutableEvent.request.url = scrubUrl(mutableEvent.request.url) as string | undefined;
    mutableEvent.request.query_string = scrubQueryString(mutableEvent.request.query_string);
    // Request bodies are not needed to diagnose a server error and may contain
    // client names, email addresses, message content or document data.
    delete mutableEvent.request.data;
  }

  mutableEvent.message = scrubDiagnosticText(mutableEvent.message) as string | undefined;
  mutableEvent.transaction = scrubDiagnosticText(mutableEvent.transaction) as string | undefined;
  if (mutableEvent.contexts) {
    scrubDiagnosticData(mutableEvent.contexts, SENSITIVE_TRACE_DATA_KEYS);
  }
  // The SDK copies this context into the envelope headers after beforeSendTransaction.
  if (mutableEvent.sdkProcessingMetadata?.dynamicSamplingContext) {
    scrubDiagnosticData(mutableEvent.sdkProcessingMetadata.dynamicSamplingContext, SENSITIVE_TRACE_DATA_KEYS);
  }
  for (const span of mutableEvent.spans || []) scrubSentrySpan(span);
  for (const item of mutableEvent.exception?.values || []) {
    item.value = scrubDiagnosticText(item.value) as string | undefined;
  }
  for (const breadcrumb of mutableEvent.breadcrumbs || []) {
    breadcrumb.message = scrubDiagnosticText(breadcrumb.message) as string | undefined;
    if (breadcrumb.data) {
      scrubDiagnosticData(breadcrumb.data, /(body|payload|form|content|html|token|secret|password)/i);
    }
  }

  if (mutableEvent.extra) {
    scrubDiagnosticData(mutableEvent.extra, /(body|payload|form|email|phone|content|html|token|secret|password)/i);
  }

  return event;
}
