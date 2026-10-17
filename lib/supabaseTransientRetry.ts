export type PostgrestLikeResult<T> = {
  data: T | null;
  error: unknown;
  status?: number;
  statusText?: string;
};

const TRANSIENT_POSTGREST_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function errorText(error: unknown) {
  if (error instanceof Error) return error.message.toLowerCase();
  if (typeof error === "string") return error.toLowerCase();
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [candidate.message, candidate.details, candidate.hint, candidate.code]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
  }
  return "";
}

function isTransientThrownError(error: unknown) {
  const text = errorText(error);
  return (
    text.includes("fetch failed") ||
    text.includes("failed to fetch") ||
    text.includes("load failed") ||
    text.includes("timeout") ||
    text.includes("econnreset") ||
    text.includes("connection reset") ||
    text.includes("network request failed")
  );
}

/** Auth and Storage SDKs put HTTP status on the error rather than the result. */
export function isTransientSupabaseReadError(error: unknown): boolean {
  if (!error) return false;
  const value = error as { status?: unknown; statusCode?: unknown };
  const status = Number(value.statusCode || value.status || 0);
  // An explicit authentication/permission failure must never be reclassified.
  if (status >= 400 && status < 500 && !TRANSIENT_POSTGREST_STATUSES.has(status)) return false;
  return TRANSIENT_POSTGREST_STATUSES.has(status) || isTransientThrownError(error);
}

export function shouldRetryPostgrestRead(result: PostgrestLikeResult<unknown>): boolean {
  if (!result?.error) return false;
  const status = Number(result.status || 0);
  return TRANSIENT_POSTGREST_STATUSES.has(status);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a read-only Supabase/PostgREST request once on network/429/5xx only.
 * 4xx validation, permission and schema errors are returned immediately.
 */
export async function runTransientPostgrestRead<T>(
  execute: () => PromiseLike<PostgrestLikeResult<T>>,
  options: { retries?: number; delaysMs?: readonly number[] } = {},
): Promise<PostgrestLikeResult<T>> {
  const retries = Math.max(0, Math.min(2, Math.floor(options.retries ?? 1)));
  const delaysMs = options.delaysMs?.length ? options.delaysMs : [220, 650];
  let lastResult: PostgrestLikeResult<T> | null = null;
  let lastThrown: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await execute();
      lastResult = result;
      if (!shouldRetryPostgrestRead(result) || attempt >= retries) return result;
    } catch (error) {
      lastThrown = error;
      if (!isTransientThrownError(error) || attempt >= retries) throw error;
    }

    const delay = Math.max(0, Number(delaysMs[Math.min(attempt, delaysMs.length - 1)] || 0));
    if (delay > 0) await sleep(delay);
  }

  if (lastResult) return lastResult;
  throw lastThrown instanceof Error ? lastThrown : new Error("Supabase read failed");
}
