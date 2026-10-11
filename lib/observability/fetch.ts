import { log } from "@/lib/observability/logger";

export class FetchDeadlineExceededError extends Error {
  code = "ai_operation_deadline_exceeded" as const;

  constructor(message = "La durée maximale de l'opération a été atteinte.") {
    super(message);
    this.name = "FetchDeadlineExceededError";
  }
}

export class FetchTimeoutError extends Error {
  code = "fetch_timeout" as const;

  constructor(timeoutMs: number, cause?: unknown) {
    super(`Request timed out after ${timeoutMs} ms.`, { cause });
    this.name = "FetchTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number; requestId?: string; route?: string } = {}
): Promise<Response> {
  const { timeoutMs = 15_000, requestId, route, signal: upstreamSignal, ...rest } = init;
  const ctrl = new AbortController();
  const effectiveTimeout = Math.max(1, Math.floor(timeoutMs));
  let timedOut = false;
  const t = setTimeout(() => {
    if (ctrl.signal.aborted) return;
    timedOut = true;
    ctrl.abort();
  }, effectiveTimeout);
  const abortFromUpstream = () => ctrl.abort(upstreamSignal?.reason);
  if (upstreamSignal) {
    if (upstreamSignal.aborted) abortFromUpstream();
    else upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
  }
  try {
    const res = await fetch(input, { ...rest, signal: ctrl.signal });
    return res;
  } catch (e: any) {
    const error = timedOut ? new FetchTimeoutError(effectiveTimeout, e) : e;
    log.error("fetch_error", {
      request_id: requestId,
      route,
      error_message: error?.message || "fetch failed",
    });
    throw error;
  } finally {
    clearTimeout(t);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

type AttemptSettledContext = {
  attempt: number;
  response?: Response;
  error?: unknown;
  willRetry: boolean;
};

function parseRetryAfterMs(response: Response | undefined): number | null {
  const raw = response?.headers.get("Retry-After");
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function computeBackoffMs(attempt: number, response?: Response) {
  const retryAfterMs = parseRetryAfterMs(response);
  if (retryAfterMs !== null) return Math.min(8_000, retryAfterMs);
  const base = Math.min(750 * 2 ** attempt, 6_000);
  // Petit jitter pour éviter que plusieurs instances repartent exactement ensemble.
  return Math.round(base * (0.85 + Math.random() * 0.3));
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit & {
    retries?: number;
    timeoutMs?: number;
    /** Deadline absolue partagée entre toutes les tentatives + backoffs. */
    deadlineAt?: number;
    requestId?: string;
    route?: string;
    onAttempt?: (attempt: number) => void | Promise<void>;
    onAttemptSettled?: (context: AttemptSettledContext) => void | Promise<void>;
    /** HTTP statuses eligible for an automatic retry. */
    retryStatuses?: number[];
  } = {}
): Promise<Response> {
  const {
    retries = 2,
    onAttempt,
    onAttemptSettled,
    retryStatuses = [408, 500, 502, 503, 504],
    deadlineAt,
    timeoutMs = 15_000,
    ...rest
  } = init;

  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    const remainingBeforeAttempt = deadlineAt ? deadlineAt - Date.now() : Number.POSITIVE_INFINITY;
    if (remainingBeforeAttempt <= 250) {
      throw new FetchDeadlineExceededError();
    }

    // Exécuté avant chaque vraie tentative HTTP. Une erreur de garde-fou ne doit
    // jamais être absorbée ni transformée en retry supplémentaire.
    if (onAttempt) await onAttempt(i);

    let response: Response | undefined;
    try {
      const perAttemptTimeout = Math.max(
        250,
        Math.min(timeoutMs, Number.isFinite(remainingBeforeAttempt) ? remainingBeforeAttempt : timeoutMs),
      );
      response = await fetchWithTimeout(input, { ...rest, timeoutMs: perAttemptTimeout });
    } catch (error) {
      const isDeadlineError = error instanceof FetchDeadlineExceededError ||
        (error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "ai_operation_deadline_exceeded");
      const willRetry = !isDeadlineError && i < retries;
      if (onAttemptSettled) await onAttemptSettled({ attempt: i, error, willRetry });
      if (!willRetry) throw error;
      lastErr = error;
    }

    if (response) {
      if (response.ok) {
        if (onAttemptSettled) await onAttemptSettled({ attempt: i, response, willRetry: false });
        return response;
      }

      const willRetry = i < retries && retryStatuses.includes(response.status);
      if (onAttemptSettled) await onAttemptSettled({ attempt: i, response, willRetry });
      if (!willRetry) return response;
      lastErr = new Error(`HTTP ${response.status}`);
      // On ne garde pas un body de réponse transitoire ouvert entre les tentatives.
      try { await response.body?.cancel(); } catch {}
    }

    const remainingBeforeBackoff = deadlineAt ? deadlineAt - Date.now() : Number.POSITIVE_INFINITY;
    if (remainingBeforeBackoff <= 250) throw new FetchDeadlineExceededError();
    const delay = Math.min(
      computeBackoffMs(i, response),
      Number.isFinite(remainingBeforeBackoff) ? Math.max(0, remainingBeforeBackoff - 250) : 8_000,
    );
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}
