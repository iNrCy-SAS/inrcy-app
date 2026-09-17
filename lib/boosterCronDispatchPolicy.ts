export const BOOSTER_DISPATCH_DEFAULT_RETRY_AFTER_MS = 60_000;
export const BOOSTER_DISPATCH_MAX_RETRY_AFTER_MS = 15 * 60_000;

/**
 * Retry-After accepts either a whole number of seconds or an HTTP date.
 * The value comes from an internal route, but remains bounded so a malformed
 * response cannot freeze a durable publication forever.
 */
export function parseBoosterDispatchRetryAfterMs(
  value: string | null | undefined,
  nowMs = Date.now(),
) {
  const raw = String(value || "").trim();
  let requestedMs = BOOSTER_DISPATCH_DEFAULT_RETRY_AFTER_MS;

  if (/^\d+$/.test(raw)) {
    requestedMs = Number(raw) * 1_000;
  } else if (raw) {
    const retryAtMs = Date.parse(raw);
    if (Number.isFinite(retryAtMs)) requestedMs = retryAtMs - nowMs;
  }

  if (!Number.isFinite(requestedMs) || requestedMs <= 0) {
    requestedMs = BOOSTER_DISPATCH_DEFAULT_RETRY_AFTER_MS;
  }

  return Math.max(
    1_000,
    Math.min(BOOSTER_DISPATCH_MAX_RETRY_AFTER_MS, Math.ceil(requestedMs)),
  );
}
