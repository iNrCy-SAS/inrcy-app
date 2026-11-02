import { parseInrAssistantClientContext, type InrAssistantClientError } from "@/lib/inrAssistantClientContext";
import { parseAssistantAttachments, type AssistantAttachment } from "@/lib/inrAssistantAttachments";
import { parseInrAssistantTaskProgress, type InrAssistantTaskProgress } from "@/lib/inrAssistantUiCommands";
import { parseInrAssistantStudioDraft, type InrAssistantStudioDraft } from "@/lib/inrAssistantStudioDraft";

export type AssistantMedia = {
  status: "processing" | "completed" | "failed";
  mediaType?: "image" | "video";
  requestId?: string;
  mediaId?: string;
  url?: string;
  message?: string;
};
export type ChatMessage = { role: "user" | "assistant"; content: string; media?: AssistantMedia; studioDraft?: InrAssistantStudioDraft; turnId?: string; attachments?: AssistantAttachment[]; taskProgress?: InrAssistantTaskProgress };
const SESSION_STORAGE_PREFIX = "inrcy_assistant_session_v1:";
const SESSION_TTL = 6 * 60 * 60 * 1000;
export const TURN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StoredSession = { version: 1; actorUserId: string; accountId: string; conversationId?: string; updatedAt: number; messages: ChatMessage[]; draft: string; draftAttachments?: AssistantAttachment[]; interrupted: boolean; retryable: boolean; visibleError?: InrAssistantClientError };

export const sessionStorageKey = (actor: string, account: string) => `${SESSION_STORAGE_PREFIX}${encodeURIComponent(actor)}:${encodeURIComponent(account)}`;
export function clearActorSessions(actor: string) {
  try {
    const prefix = `${SESSION_STORAGE_PREFIX}${encodeURIComponent(actor)}:`;
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch { /* The current in-memory session still resets when storage is unavailable. */ }
}

export function storedMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const rows: ChatMessage[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || (row.role !== "user" && row.role !== "assistant") || typeof row.content !== "string" || !row.content.trim()) return null;
    if (row.role === "user" && (typeof row.turnId !== "string" || !TURN_ID_PATTERN.test(row.turnId))) return null;
    let attachments: AssistantAttachment[] = [];
    try { if (row.role === "user") attachments = parseAssistantAttachments(row.attachments); } catch { /* An invalid local attachment cannot become a server reference. */ }
    const studioDraft = row.role === "assistant" ? parseInrAssistantStudioDraft(row.studioDraft) : null;
    const taskProgress = row.role === "assistant" ? parseInrAssistantTaskProgress(row.taskProgress) : null;
    rows.push({ role: row.role, content: row.content.slice(0, row.role === "user" ? 4000 : 60000), ...(studioDraft ? { studioDraft } : {}), ...(taskProgress ? { taskProgress } : {}), ...(row.role === "user" ? { turnId: row.turnId, ...(attachments.length ? { attachments } : {}) } : {}) });
  }
  while (rows.length > 1 && rows.reduce((total, row) => total + row.content.length, 0) > 400000) rows.shift();
  return rows;
}

/** Display history may contain a full long answer; model input remains much smaller. */
export function requestMessages(conversation: ChatMessage[]) {
  const rows = conversation.slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, role === "user" ? 4000 : 12000) }));
  const encoder = new TextEncoder();
  while (rows.length > 1 && encoder.encode(JSON.stringify(rows)).byteLength > 20000) rows.shift();
  return rows;
}

export function readStoredSession(actorUserId: string, accountId: string): StoredSession | null {
  const key = sessionStorageKey(actorUserId, accountId);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    if (raw.length > 1000000) throw new Error("Oversized session");
    const value = JSON.parse(raw);
    if (value?.version !== 1 || value.actorUserId !== actorUserId || value.accountId !== accountId || !Number.isFinite(value.updatedAt) || value.updatedAt > Date.now() + 5000 || Date.now() - value.updatedAt > SESSION_TTL || typeof value.draft !== "string") throw new Error("Invalid session");
    const messages = storedMessages(value.messages);
    if (!messages) throw new Error("Invalid messages");
    const visibleError = parseInrAssistantClientContext({ visibleError: value.visibleError })?.visibleError;
    let draftAttachments: AssistantAttachment[] = [];
    try { draftAttachments = parseAssistantAttachments(value.draftAttachments); } catch { /* Ignore malformed browser state. */ }
    return { version: 1, actorUserId, accountId, ...(typeof value.conversationId === "string" && TURN_ID_PATTERN.test(value.conversationId) ? { conversationId: value.conversationId } : {}), updatedAt: value.updatedAt, messages, draft: value.draft.slice(0, 4000), draftAttachments, interrupted: value.interrupted === true, retryable: value.retryable === true, ...(visibleError ? { visibleError } : {}) };
  } catch {
    try { sessionStorage.removeItem(key); } catch { /* Memory-only fallback. */ }
    return null;
  }
}

export function parseAssistantMedia(value: unknown): AssistantMedia | undefined {
  if (!value || typeof value !== "object") return;
  const media = value as Record<string, unknown>;
  if (!["processing", "completed", "failed", "ready_to_save"].includes(String(media.status))) return;
  const item = media.media && typeof media.media === "object" ? media.media as Record<string, unknown> : {};
  const kind = media.mediaType || item.mediaType;
  const mediaType = kind === "image" || kind === "video" ? kind : undefined;
  const rawUrl = item.url ?? media.url;
  let url: string | undefined;
  if (typeof rawUrl === "string") {
    try {
      const parsed = new URL(rawUrl, "https://inrcy.local");
      if (["http:", "https:"].includes(parsed.protocol) && (/^https?:\/\//i.test(rawUrl) || /^\/api\//.test(rawUrl))) url = rawUrl;
    } catch { /* An invalid provider URL must never become a rendered media source. */ }
  }
  return {
    status: media.status === "ready_to_save" ? "processing" : media.status as AssistantMedia["status"],
    ...(mediaType ? { mediaType } : {}),
    ...(url ? { url } : {}),
    ...(typeof media.requestId === "string" ? { requestId: media.requestId } : {}),
    ...(typeof item.id === "string" ? { mediaId: item.id } : typeof media.mediaId === "string" ? { mediaId: media.mediaId } : {}),
    ...(typeof media.message === "string" ? { message: media.message.slice(0, 1200) } : {}),
  };
}
