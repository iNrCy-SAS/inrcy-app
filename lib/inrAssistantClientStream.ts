import { parseInrAssistantActivity, type InrAssistantActivity } from "./inrAssistantActivity.ts";

export type InrAssistantClientReply = {
  pending?: unknown; message?: unknown; error?: unknown; code?: unknown;
  requestId?: unknown; accountId?: unknown; conversationId?: unknown;
  memorySaved?: unknown; needsHuman?: unknown; handoffSummary?: unknown; media?: unknown;
};

const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_FRAME_CHARS = 800_000;

function parseReply(value: unknown): InrAssistantClientReply | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const reply: InrAssistantClientReply = {};
  for (const [key, limit] of [["message", 60000], ["error", 2000], ["code", 100], ["requestId", 100], ["accountId", 180], ["conversationId", 100], ["handoffSummary", 4500]] as const) {
    if (typeof input[key] === "string") reply[key] = input[key].slice(0, limit);
  }
  for (const key of ["pending", "memorySaved", "needsHuman"] as const) if (typeof input[key] === "boolean") reply[key] = input[key];
  if (input.media && typeof input.media === "object" && !Array.isArray(input.media)) reply.media = input.media;
  return reply;
}

/** Only server activity events can create collaboration rows; normal JSON remains supported. */
export async function readInrAssistantResponse(response: Response, onActivity: (activity: InrAssistantActivity) => void): Promise<{ payload: InrAssistantClientReply | null; failed: boolean }> {
  const streaming = response.headers.get("Content-Type")?.toLowerCase().includes("text/event-stream") === true;
  const reader = response.body?.getReader();
  if (!reader) return { payload: null, failed: !response.ok };
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let terminal: { payload: InrAssistantClientReply | null; failed: boolean } | undefined;
  const frame = (text: string) => {
    if (!text.trim()) return;
    const data = text.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
    if (!data) return;
    let event: unknown;
    try { event = JSON.parse(data); } catch { return; }
    if (!event || typeof event !== "object" || Array.isArray(event)) return;
    const item = event as Record<string, unknown>;
    if (item.type === "activity") {
      const activity = parseInrAssistantActivity(item.activity);
      if (activity) onActivity(activity);
    } else if (item.type === "result" || item.type === "error") {
      const payload = parseReply(item.payload);
      if (payload) terminal = { payload, failed: item.type === "error" };
    }
  };
  try {
    while (!terminal) {
      const { value, done } = await reader.read();
      if (value) { bytes += value.byteLength; if (bytes > MAX_RESPONSE_BYTES) throw new Error("Assistant response exceeds its display limit"); }
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > MAX_FRAME_CHARS) throw new Error("Assistant response frame is too large");
      if (streaming) {
        let boundary: RegExpExecArray | null;
        while (!terminal && (boundary = /\r?\n\r?\n/.exec(buffer))) {
          frame(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
        }
      }
      if (done) {
        if (streaming) {
          if (!terminal && buffer.trim()) frame(buffer);
          if (!terminal) throw new Error("Assistant stream ended without a result");
        } else {
          let value: unknown;
          try { value = JSON.parse(buffer); } catch { value = null; }
          terminal = { payload: parseReply(value), failed: !response.ok };
        }
        break;
      }
    }
    return terminal!;
  } finally {
    // A terminal event is sufficient; do not keep reading an open response.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
