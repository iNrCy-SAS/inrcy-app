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

const SENSITIVE_QUERY_KEYS = /^(code|state|token|access_token|refresh_token|id_token|key|secret|password|signature|sig)$/i;

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
      value.replace(/([?&](?:code|state|token|access_token|refresh_token|id_token|key|secret|password|signature|sig)=)[^&]*/gi, "$1[Filtered]"),
    );
  }
}

function scrubQueryString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return scrubBinaryPayloads(
    value.replace(/(^|&)(code|state|token|access_token|refresh_token|id_token|key|secret|password|signature|sig)=[^&]*/gi, "$1$2=[Filtered]"),
  );
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

  mutableEvent.message = scrubBinaryPayloads(mutableEvent.message) as string | undefined;
  for (const item of mutableEvent.exception?.values || []) {
    item.value = scrubBinaryPayloads(item.value) as string | undefined;
  }
  for (const breadcrumb of mutableEvent.breadcrumbs || []) {
    breadcrumb.message = scrubBinaryPayloads(breadcrumb.message) as string | undefined;
    if (breadcrumb.data) {
      for (const key of Object.keys(breadcrumb.data)) {
        if (/(body|payload|form|content|html|token|secret|password)/i.test(key)) {
          delete breadcrumb.data[key];
        } else if (typeof breadcrumb.data[key] === "string") {
          breadcrumb.data[key] = scrubBinaryPayloads(breadcrumb.data[key]);
        }
      }
    }
  }

  if (mutableEvent.extra) {
    for (const key of Object.keys(mutableEvent.extra)) {
      if (/(body|payload|form|email|phone|content|html|token|secret|password)/i.test(key)) {
        delete mutableEvent.extra[key];
      } else if (typeof mutableEvent.extra[key] === "string") {
        mutableEvent.extra[key] = scrubBinaryPayloads(mutableEvent.extra[key]);
      }
    }
  }

  return event;
}
