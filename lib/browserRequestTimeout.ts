/** Keep the deadline through response body reads on browsers without AbortSignal.timeout. */
export async function withBrowserRequestTimeout<T>(
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (typeof AbortSignal.timeout === "function") return request(AbortSignal.timeout(timeoutMs));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("The request timed out.", "TimeoutError")), timeoutMs);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
