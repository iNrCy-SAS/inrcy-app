/** Shared bounds; file contents and Storage credentials never belong in browser messages. */
export const ASSISTANT_ATTACHMENT_MAX_COUNT = 4;
export const ASSISTANT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const ASSISTANT_ATTACHMENT_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const ASSISTANT_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;
export const ASSISTANT_ATTACHMENT_BUCKET = "inrcy-assistant-attachments";
export const ASSISTANT_ATTACHMENT_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.pdf,.docx,.xlsx,.csv,.txt,.md,.mp4,.mov,.webm";
export type AssistantAttachment = { id: string; token: string; name: string; kind: "image" | "video" | "document"; size: number };
export const ASSISTANT_ATTACHMENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORMATS: Record<string, { mime: string; kind: AssistantAttachment["kind"] }> = {
  jpg: { mime: "image/jpeg", kind: "image" }, jpeg: { mime: "image/jpeg", kind: "image" },
  png: { mime: "image/png", kind: "image" }, webp: { mime: "image/webp", kind: "image" },
  gif: { mime: "image/gif", kind: "image" }, heic: { mime: "image/heic", kind: "image" }, heif: { mime: "image/heif", kind: "image" },
  pdf: { mime: "application/pdf", kind: "document" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document" },
  csv: { mime: "text/csv", kind: "document" }, txt: { mime: "text/plain", kind: "document" }, md: { mime: "text/markdown", kind: "document" },
  mp4: { mime: "video/mp4", kind: "video" }, mov: { mime: "video/quicktime", kind: "video" }, webm: { mime: "video/webm", kind: "video" },
};
export class AssistantAttachmentError extends Error {
  code: "attachment_invalid" | "attachment_limit" | "attachment_unreadable" | "attachment_unavailable" | "attachment_expired" | "attachment_conflict";
  constructor(code: AssistantAttachmentError["code"]) { super(code); this.code = code; }
}
export function assistantAttachmentFile(value: { name?: unknown; size?: unknown; type?: unknown }) {
  const name = typeof value.name === "string" ? value.name.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) : "";
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  const format = FORMATS[extension];
  if (!name || !format || !Number.isSafeInteger(value.size) || Number(value.size) <= 0) throw new AssistantAttachmentError("attachment_invalid");
  if (Number(value.size) > (format.kind === "video" ? ASSISTANT_ATTACHMENT_VIDEO_MAX_BYTES : ASSISTANT_ATTACHMENT_MAX_BYTES)) throw new AssistantAttachmentError("attachment_limit");
  const declared = typeof value.type === "string" ? value.type.split(";")[0].toLowerCase() : "";
  if (declared && ![format.mime, "application/octet-stream", "application/zip", "text/plain", "image/jpg"].includes(declared)) throw new AssistantAttachmentError("attachment_invalid");
  return { name, size: Number(value.size), extension, ...format };
}
export function parseAssistantAttachments(raw: unknown): AssistantAttachment[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > ASSISTANT_ATTACHMENT_MAX_COUNT) throw new AssistantAttachmentError("attachment_limit");
  const refs = raw.map(value => {
    if (!value || typeof value !== "object" || !ASSISTANT_ATTACHMENT_UUID.test(value.id) || typeof value.token !== "string" || value.token.length > 2500 || !value.token ||
      typeof value.name !== "string" || !value.name || value.name.length > 180 || !["image", "video", "document"].includes(value.kind) || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > ASSISTANT_ATTACHMENT_VIDEO_MAX_BYTES) throw new AssistantAttachmentError("attachment_invalid");
    return { id: value.id, token: value.token, name: value.name, kind: value.kind, size: value.size } as AssistantAttachment;
  });
  if (new Set(refs.map(ref => ref.id)).size !== refs.length || refs.reduce((sum, ref) => sum + ref.size, 0) > ASSISTANT_ATTACHMENT_TOTAL_BYTES) throw new AssistantAttachmentError("attachment_limit");
  return refs;
}

/** Count only bounded server-generated image bytes as visual tokens, never arbitrary text/tool data. */
export function assistantModelInputBudget(value: unknown): number {
  let imageTokens = 0;
  const serialized = JSON.stringify(value, function(key, item) {
    if ((key === "image" || key === "data") && this && (this.type === "image" || this.type === "file" && this.mediaType === "image/jpeg") && this[key] instanceof Uint8Array) {
      imageTokens += 2048;
      return "[server image preview]";
    }
    return item;
  });
  return new TextEncoder().encode(serialized).byteLength + imageTokens;
}
