const TRANSIENT_GOOGLE_REASONS = new Set([
  "ratelimitexceeded",
  "userratelimitexceeded",
  "backenderror",
]);

const MAX_RETRY_AFTER_MS = 30_000;

function clean(value: unknown) {
  return String(value || "").trim();
}

export function googleCalendarErrorReason(body: unknown) {
  let value = body;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return "";
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const root = value as Record<string, unknown>;
  const error = root.error && typeof root.error === "object" && !Array.isArray(root.error)
    ? root.error as Record<string, unknown>
    : root;
  const errors = Array.isArray(error.errors) ? error.errors : [];
  const nestedReason = errors.find(
    (candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate),
  ) as Record<string, unknown> | undefined;
  return clean(nestedReason?.reason || error.reason || error.status).toLowerCase();
}

export function isTransientGoogleCalendarFailure(input: {
  status: number;
  responseBody?: unknown;
}) {
  if (input.status === 429 || input.status >= 500) return true;
  return input.status === 403 && TRANSIENT_GOOGLE_REASONS.has(
    googleCalendarErrorReason(input.responseBody),
  );
}

function retryAfterMs(value: unknown, nowMs: number) {
  const raw = clean(value);
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1_000));
  }
  const dateMs = Date.parse(raw);
  return Number.isFinite(dateMs)
    ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, dateMs - nowMs))
    : 0;
}

export function googleCalendarRetryDelayMs(input: {
  attempt: number;
  retryAfter?: unknown;
  nowMs?: number;
  random?: number;
}) {
  const attempt = Math.max(0, Math.floor(input.attempt));
  const exponentialMs = Math.min(8_000, 1_000 * 2 ** attempt);
  const jitter = Math.max(0, Math.min(0.999999, input.random ?? Math.random()));
  return Math.max(
    retryAfterMs(input.retryAfter, input.nowMs ?? Date.now()),
    exponentialMs + Math.floor(jitter * 1_000),
  );
}

