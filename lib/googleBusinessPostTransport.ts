export const GOOGLE_BUSINESS_LOCAL_POST_TIMEOUT_MS = 15_000;

export type GoogleBusinessFieldViolation = {
  field: string;
  description: string;
};

export type GoogleBusinessProviderDetail = {
  type: string | null;
  reason?: string;
  domain?: string;
  locale?: string;
  message?: string;
  fieldViolations?: GoogleBusinessFieldViolation[];
};

type GoogleBusinessProviderError = {
  message: string;
  code: string | number | null;
  status: string | null;
  details: GoogleBusinessProviderDetail[];
  fieldViolations: GoogleBusinessFieldViolation[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeProviderText(value: unknown, maxLength: number) {
  const text = String(value || "")
    .replace(
      /([?&](?:access_token|token|refresh_token|signature|sig)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .trim();
  return text.slice(0, maxLength);
}

function sanitizeFieldViolations(value: unknown): GoogleBusinessFieldViolation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((entry) => {
    const record = asRecord(entry);
    const field = sanitizeProviderText(record.field, 300);
    const description = sanitizeProviderText(record.description, 800);
    if (!field && !description) return [];
    return [{ field, description }];
  });
}

function sanitizeProviderDetails(value: unknown): GoogleBusinessProviderDetail[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((entry) => {
    const record = asRecord(entry);
    if (!Object.keys(record).length) return [];
    const fieldViolations = sanitizeFieldViolations(record.fieldViolations);
    const detail: GoogleBusinessProviderDetail = {
      type: sanitizeProviderText(record["@type"], 240) || null,
    };
    const reason = sanitizeProviderText(record.reason, 160);
    const domain = sanitizeProviderText(record.domain, 240);
    const locale = sanitizeProviderText(record.locale, 40);
    const message = sanitizeProviderText(record.message, 800);
    if (reason) detail.reason = reason;
    if (domain) detail.domain = domain;
    if (locale) detail.locale = locale;
    if (message) detail.message = message;
    if (fieldViolations.length) detail.fieldViolations = fieldViolations;
    return [detail];
  });
}

function readProviderError(value: unknown): GoogleBusinessProviderError {
  const record = asRecord(value);
  const error = asRecord(record.error);
  const details = sanitizeProviderDetails(error.details);
  const rawCode = error.code;
  const code =
    typeof rawCode === "number" && Number.isFinite(rawCode)
      ? rawCode
      : sanitizeProviderText(rawCode, 120) || null;
  return {
    message:
      sanitizeProviderText(error.message, 1_500) ||
      sanitizeProviderText(record.error_description, 1_500),
    code,
    status: sanitizeProviderText(error.status, 120) || null,
    details,
    fieldViolations: details.flatMap((detail) => detail.fieldViolations || []),
  };
}

export class GoogleBusinessPostTransportError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryable: boolean;
  /** A POST may have reached Google even though its response was lost. */
  readonly outcomeUnknown: boolean;
  /** Provider diagnostics are allow-listed and bounded; the raw payload is never retained. */
  readonly providerCode: string | number | null;
  readonly providerStatus: string | null;
  readonly details: GoogleBusinessProviderDetail[];
  readonly fieldViolations: GoogleBusinessFieldViolation[];

  constructor(
    code: string,
    message: string,
    options: {
      status?: number | null;
      retryable?: boolean;
      outcomeUnknown?: boolean;
      providerCode?: string | number | null;
      providerStatus?: string | null;
      details?: GoogleBusinessProviderDetail[];
      fieldViolations?: GoogleBusinessFieldViolation[];
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GoogleBusinessPostTransportError";
    this.code = code;
    this.status = Number.isFinite(options.status) ? Number(options.status) : null;
    this.retryable = options.retryable === true;
    this.outcomeUnknown = options.outcomeUnknown === true;
    this.providerCode = options.providerCode ?? null;
    this.providerStatus = options.providerStatus ?? null;
    this.details = Array.isArray(options.details) ? options.details.slice(0, 12) : [];
    this.fieldViolations = Array.isArray(options.fieldViolations)
      ? options.fieldViolations.slice(0, 20)
      : [];
  }
}

export function getGoogleBusinessPostErrorDiagnostics(error: unknown) {
  if (!(error instanceof GoogleBusinessPostTransportError)) return null;
  return {
    transport_code: error.code,
    http_status: error.status,
    provider_code: error.providerCode,
    provider_status: error.providerStatus,
    retryable: error.retryable,
    outcome_unknown: error.outcomeUnknown,
    details: error.details,
    field_violations: error.fieldViolations,
  };
}

export function isGoogleBusinessPostOutcomeUnknown(error: unknown) {
  if (error instanceof GoogleBusinessPostTransportError) {
    return error.outcomeUnknown;
  }
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as Record<string, unknown>).outcomeUnknown === true,
  );
}

function providerMessage(value: unknown, fallback: string) {
  return readProviderError(value).message || fallback;
}

function parseJson(value: string) {
  if (!value) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function isRetryableGoogleHttpStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function validateGoogleBusinessEndpoint(value: string) {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new GoogleBusinessPostTransportError(
      "gmb_local_post_endpoint_invalid",
      "Destination Google Business invalide.",
    );
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "mybusiness.googleapis.com" ||
    !/^\/v4\/accounts\/[^/]+\/locations\/[^/]+\/localPosts$/.test(
      endpoint.pathname,
    )
  ) {
    throw new GoogleBusinessPostTransportError(
      "gmb_local_post_endpoint_invalid",
      "Destination Google Business non reconnue.",
    );
  }
  return endpoint.toString();
}

/**
 * Local Posts accept media by sourceUrl only. This function sends a small JSON
 * document; video bytes stay in shared storage and are pulled by Google.
 *
 * Creation has no provider idempotency key. We deliberately do not retry a
 * network/timeout failure: the outcome is ambiguous and a blind retry could
 * create a duplicate post. The durable channel worker must reconcile/decide.
 */
export async function postGoogleBusinessLocalPost(params: {
  endpoint: string;
  accessToken: string;
  payload: unknown;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const endpoint = validateGoogleBusinessEndpoint(params.endpoint);
  const accessToken = String(params.accessToken || "").trim();
  if (!accessToken) {
    throw new GoogleBusinessPostTransportError(
      "gmb_access_token_missing",
      "Connexion Google Business expirée.",
    );
  }
  const requestedTimeout = Number(params.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.max(100, Math.min(30_000, requestedTimeout))
    : GOOGLE_BUSINESS_LOCAL_POST_TIMEOUT_MS;
  let requestBody: string;
  try {
    requestBody = JSON.stringify(params.payload);
  } catch (error) {
    throw new GoogleBusinessPostTransportError(
      "gmb_local_post_payload_invalid",
      "Le contenu Google Business est invalide.",
      { cause: error },
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("gmb_local_post_timeout")),
    timeoutMs,
  );
  let response: Response;
  let raw: string;
  try {
    response = await (params.fetchImpl || fetch)(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: requestBody,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    raw = await response.text();
  } catch (error) {
    const timedOut = controller.signal.aborted;
    throw new GoogleBusinessPostTransportError(
      timedOut ? "gmb_local_post_timeout" : "gmb_local_post_network_error",
      timedOut
        ? "Google Business n'a pas répondu dans le délai prévu. L'état de la publication doit être vérifié avant toute relance."
        : "La réponse Google Business a été interrompue. L'état de la publication doit être vérifié avant toute relance.",
      {
        retryable: false,
        outcomeUnknown: true,
        cause: error,
      },
    );
  } finally {
    clearTimeout(timer);
  }

  const parsed = parseJson(raw);
  if (!response.ok) {
    const providerError = readProviderError(parsed);
    throw new GoogleBusinessPostTransportError(
      "gmb_local_post_http_error",
      providerError.message ||
        providerMessage(
          parsed,
          "Impossible de publier sur Google Business pour le moment.",
        ),
      {
        status: response.status,
        retryable: isRetryableGoogleHttpStatus(response.status),
        outcomeUnknown: false,
        providerCode: providerError.code,
        providerStatus: providerError.status,
        details: providerError.details,
        fieldViolations: providerError.fieldViolations,
      },
    );
  }
  return parsed;
}
