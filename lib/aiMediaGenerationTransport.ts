/** Small public protocol: no prompts, reference bytes or provider diagnostics. */
export const AI_MEDIA_GENERATION_STREAM_TYPE = "application/x-ndjson";
export type AiMediaGenerationEvent =
  | { type: "billing_locked" }
  | { type: "result"; status: number; payload: unknown };

export function acceptsAiMediaGenerationStream(accept: string | null): boolean {
  return (accept || "").split(",").some((entry) => {
    const [mediaType, ...parameters] = entry.trim().toLowerCase().split(";");
    return mediaType.trim() === AI_MEDIA_GENERATION_STREAM_TYPE &&
      !parameters.some((value) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/u.test(value));
  });
}

/** Client cancellation can reach preparation only, never an already locked paid job. */
export function createAiMediaBillingGate(clientSignal: AbortSignal, notify?: () => void | Promise<void>) {
  const execution = new AbortController();
  let locked = false;
  let lockTask: Promise<void> | null = null;
  const disconnect = () => {
    if (!locked) execution.abort(new DOMException("ai_media_generation_cancelled", "AbortError"));
  };
  if (clientSignal.aborted) disconnect();
  else clientSignal.addEventListener("abort", disconnect, { once: true });
  return {
    signal: execution.signal,
    get locked() { return locked; },
    lock(): Promise<void> {
      if (lockTask) return lockTask;
      execution.signal.throwIfAborted();
      // Atomic before the asynchronous notification: a network race cannot
      // turn an already committed supplier call into a user cancellation.
      locked = true;
      clientSignal.removeEventListener("abort", disconnect);
      lockTask = Promise.resolve().then(() => notify?.());
      return lockTask;
    },
    disconnect,
    dispose() { clientSignal.removeEventListener("abort", disconnect); },
  };
}

const MAX_EVENT_CHARS = 1_048_576;
const incompleteResponse = () => new Error("La réponse de génération est incomplète. Réessayez pour retrouver le même média.");

/** A truncated stream remains an uncertain attempt; the caller keeps its request ID. */
export async function readAiMediaGenerationResponse(response: Response, onBillingLocked: () => void) {
  const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== AI_MEDIA_GENERATION_STREAM_TYPE) {
    // Older JSON routes provide no intermediate paid-work boundary.
    onBillingLocked();
    // Proxy HTML and broken JSON are not authoritative generation failures.
    // Keeping them uncertain also avoids showing their internal URLs/logs.
    if (contentType !== "application/json") throw incompleteResponse();
    const payload: unknown = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw incompleteResponse();
    return { status: response.status, ok: response.ok, payload };
  }
  if (!response.body) throw incompleteResponse();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result: { status: number; ok: boolean; payload: unknown } | null = null;
  let locked = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    if (line.length > MAX_EVENT_CHARS || result) throw incompleteResponse();
    let event: AiMediaGenerationEvent;
    try { event = JSON.parse(line) as AiMediaGenerationEvent; }
    catch { throw incompleteResponse(); }
    if (event?.type === "billing_locked") {
      if (!locked) { locked = true; onBillingLocked(); }
      return;
    }
    if (event?.type !== "result" || !Number.isInteger(event.status) || event.status < 200 || event.status > 599 ||
      !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw incompleteResponse();
    result = { status: event.status, ok: event.status < 300, payload: event.payload };
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffered += decoder.decode(chunk.value, { stream: !chunk.done });
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        consume(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
      if (buffered.length > MAX_EVENT_CHARS) throw incompleteResponse();
      if (chunk.done) break;
    }
    consume(buffered);
    if (!result) throw incompleteResponse();
    return result as { status: number; ok: boolean; payload: unknown };
  } finally { reader.releaseLock(); }
}
