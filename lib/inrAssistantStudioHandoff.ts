import { parseInrAssistantStudioDraft, type InrAssistantStudioDraft } from "./inrAssistantStudioDraft.ts";

export const INR_ASSISTANT_STUDIO_DRAFT_EVENT = "inrcy:assistant-studio-draft";
const ACK_EVENT = "inrcy:assistant-studio-draft-ack";
const PREFIX = "inrcy_assistant_studio_draft_v1:";
const TTL = 15 * 60_000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type InrAssistantStudioScope = { actorUserId: string; accountId: string };
export type InrAssistantStudioHandoff = InrAssistantStudioScope & { version: 1; id: string; createdAt: number; draft: InrAssistantStudioDraft };
export type InrAssistantStudioDraftRequest = InrAssistantStudioScope & { id: string; result?: Promise<boolean> };
const sameScope = (a: InrAssistantStudioScope, b: InrAssistantStudioScope) => a.actorUserId === b.actorUserId && a.accountId === b.accountId;
function key(scope: InrAssistantStudioScope) {
  if (![scope.actorUserId, scope.accountId].every(value => typeof value === "string" && /^[a-z0-9_-]{1,180}$/i.test(value))) return null;
  return PREFIX + encodeURIComponent(scope.actorUserId) + ":" + encodeURIComponent(scope.accountId);
}

/** Free, local draft transfer. Neither the URL nor any network request receives the prompt. */
export function stageInrAssistantStudioDraft(scope: InrAssistantStudioScope, value: unknown, now = Date.now()): InrAssistantStudioHandoff | null {
  const draft = parseInrAssistantStudioDraft(value), storageKey = key(scope);
  if (!draft || !storageKey || typeof window === "undefined" || !Number.isFinite(now)) return null;
  try {
    const handoff: InrAssistantStudioHandoff = { version: 1, ...scope, id: crypto.randomUUID(), createdAt: now, draft };
    window.sessionStorage.setItem(storageKey, JSON.stringify(handoff));
    return handoff;
  } catch { return null; }
}

export function readInrAssistantStudioDraft(scope: InrAssistantStudioScope, id: string, now = Date.now()): InrAssistantStudioHandoff | null {
  const storageKey = key(scope);
  if (!storageKey || !ID.test(id) || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw || raw.length > 24_000) return null;
    const value = JSON.parse(raw), draft = parseInrAssistantStudioDraft(value?.draft);
    if (!value || value.version !== 1 || value.id !== id || !sameScope(value, scope) || !draft ||
      !Number.isFinite(value.createdAt) || value.createdAt > now || now - value.createdAt > TTL) return null;
    return { version: 1, ...scope, id: value.id, createdAt: value.createdAt, draft };
  } catch { return null; }
}

export function clearInrAssistantStudioDraft(scope: InrAssistantStudioScope, id: string) {
  const storageKey = key(scope);
  if (!storageKey || typeof window === "undefined") return;
  try {
    const current = JSON.parse(window.sessionStorage.getItem(storageKey) || "null");
    if (current?.id === id && sameScope(current, scope)) window.sessionStorage.removeItem(storageKey);
  } catch { /* A malformed local value is never applied. */ }
}

/** A mounted Studio can apply through its existing busy/unsaved guard. */
export async function requestInrAssistantStudioDraft(scope: InrAssistantStudioScope, id: string): Promise<boolean | null> {
  if (!readInrAssistantStudioDraft(scope, id)) return false;
  const detail: InrAssistantStudioDraftRequest = { ...scope, id };
  window.dispatchEvent(new CustomEvent(INR_ASSISTANT_STUDIO_DRAFT_EVENT, { detail }));
  return detail.result ? await detail.result : null;
}

export function acknowledgeInrAssistantStudioDraft(scope: InrAssistantStudioScope, id: string, accepted: boolean) {
  if (typeof window !== "undefined" && key(scope) && ID.test(id)) window.dispatchEvent(new CustomEvent(ACK_EVENT, { detail: { ...scope, id, accepted } }));
}

/** Wait only for the matching actor/account transfer after route navigation. */
export function waitForInrAssistantStudioDraft(scope: InrAssistantStudioScope, id: string, timeoutMs = 15_000): Promise<boolean> {
  if (!key(scope) || !ID.test(id) || typeof window === "undefined") return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true; clearTimeout(timer); window.removeEventListener(ACK_EVENT, onAck); resolve(accepted);
    };
    const onAck = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail && detail.id === id && sameScope(detail, scope)) finish(detail.accepted === true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    window.addEventListener(ACK_EVENT, onAck);
  });
}

export function inrAssistantStudioDraftHref(id: string): string | null {
  return ID.test(id) ? "/dashboard/generer-media?assistant_draft=" + encodeURIComponent(id) : null;
}
