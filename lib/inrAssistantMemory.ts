import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const TABLE = "inr_assistant_turns";
const SELECT = "account_id,actor_user_id,conversation_id,turn_id,user_text,assistant_text,status,created_at,updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 5_000;
const PENDING_LEASE_MS = 15 * 60_000;
export const INR_ASSISTANT_MEMORY_MAX_REPLY_CHARS = 60_000;
export const INR_ASSISTANT_MEMORY_RETENTION_MONTHS = 2;

/** Calendar months in UTC, with PostgreSQL's month-end clamping semantics. */
export function inrAssistantMemoryCutoff(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid memory retention date.");
  const cutoff = new Date(now.getTime());
  const originalDay = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - INR_ASSISTANT_MEMORY_RETENTION_MONTHS);
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(originalDay, lastDay));
  return cutoff.toISOString();
}
type Row = Record<string, unknown>;
export type InrAssistantMemoryTurn = {
  conversationId: string; turnId: string; userText: string; assistantText: string | null;
  status: "pending" | "completed" | "failed"; createdAt: string; updatedAt: string;
};
type TurnIdentity = { conversationId: string; turnId: string };
export type InrAssistantMemoryTurnResult = { available: boolean; ok: boolean; existing: boolean; claimed: boolean; turn: InrAssistantMemoryTurn | null; retryAfterSeconds?: number };
export type InrAssistantMemoryReadResult = { available: boolean; turns: InrAssistantMemoryTurn[]; truncated: boolean; untrustedContent: true };
type TurnResult = InrAssistantMemoryTurnResult;
type ReadResult = InrAssistantMemoryReadResult;

export class InrAssistantMemoryInputError extends Error {
  code = "assistant_memory_invalid_request";
}
export class InrAssistantMemoryConflictError extends Error {
  code = "assistant_memory_conflict";
}

function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new InrAssistantMemoryInputError("Identifiant de discussion invalide.");
  return value.toLowerCase();
}
function limit(value: number | undefined, maximum: number): number {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > maximum)) {
    throw new InrAssistantMemoryInputError("Limite de discussion invalide.");
  }
  return value ?? maximum;
}

/** Store conversation prose only, never raw tool results, attachments or credentials.
 * This is defensive text redaction, not a claim of perfect semantic anonymisation.
 */
export function sanitizeInrAssistantMemoryText(value: unknown, maximum = INR_ASSISTANT_MEMORY_MAX_REPLY_CHARS): string {
  if (typeof value !== "string") return "";
  return value.slice(0, 80_000)
    .replace(/```[\s\S]*?(?:```|$)/g, "[bloc technique retiré]")
    .replace(/!\[([^\]]*)\]\([^\s)]*\)/g, "[média]")
    .replace(/https?:\/\/[^\s<>"')\]]+/gi, (candidate) => {
      try {
        const url = new URL(candidate);
        const privateQuery = [...url.searchParams.keys()].some((key) => /token|secret|signature|credential|authorization|^sig$|^code$|^key$|^expires$|^x-amz-/i.test(key));
        return privateQuery || Boolean(url.username || url.password) || /token|secret|signature|authorization|code=/i.test(url.hash) || /(?:^|\.)supabase\.(?:co|com|net)$/i.test(url.hostname) ||
          /\.(?:png|jpe?g|webp|gif|avif|mp4|mov|webm|mp3|wav)(?:$|\/)/i.test(url.pathname)
          ? "[lien privé retiré]" : candidate;
      } catch { return "[lien privé retiré]"; }
    })
    .replace(/\b(?:sb_secret_|sb_publishable_|sk-(?:proj-|ant-)?|sk_live_|rk_live_|ghp_|github_pat_)[A-Za-z0-9_\-]{8,}\b/g, "[secret retiré]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[jeton retiré]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "[autorisation retirée]")
    .replace(/\b(?:access[_ -]?token|refresh[_ -]?token|api[_ -]?key|client[_ -]?secret|password|mot de passe|code de connexion|SUPABASE_[A-Z_]+|[A-Z_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z_]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[identifiant secret retiré]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[adresse électronique retirée]")
    .replace(/(?<!\w)(?:\+\d{1,3}[ .-]?)?(?:\(?0?[1-9]\)?[ .-]?)(?:\d[ .-]?){8,11}(?!\w)/g, "[coordonnée retirée]")
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g, "[coordonnée bancaire retirée]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[référence privée retirée]")
    .replace(/\b(?:M\.|Mme|Monsieur|Madame)\s+[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){0,2}/gu, "[nom de personne retiré]")
    .replace(/\b(?:mon client|ma cliente|nom du client|nom de la cliente|client|cliente)\s*:\s*[^\n,;]{1,100}/gi, "client : [identité retirée]")
    .replace(/^.*(?:\bat\s+[^\s]+\s*\([^\n]*:\d+:\d+\)|[A-Za-z]:\\|(?:\/var\/task\/|\/home\/[^\s]+\/)|\.env(?:\.local)?\s*[:=]|(?:TypeError|ReferenceError|SyntaxError):).*(?:\n|$)/gm, "[trace technique retirée]\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, maximum);
}

function prose(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new InrAssistantMemoryInputError("Texte de discussion invalide.");
  }
  return sanitizeInrAssistantMemoryText(value, maximum) || "[contenu privé retiré]";
}
async function execute(operation: () => PromiseLike<unknown>): Promise<Row | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = object(await Promise.race([
      Promise.resolve(operation()),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Memory unavailable")), TIMEOUT_MS); }),
    ]));
    return response;
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); }
}

/** Trusted actor and account come from requireUser; no admin client or user-selected scope. */
export function createInrAssistantMemory(options: {
  supabase: Pick<SupabaseClient, "from" | "rpc">; accountId: string; actorUserId: string;
}) {
  const accountId = uuid(options.accountId), actorUserId = uuid(options.actorUserId);
  const leaseId = randomUUID();
  const { supabase } = options;
  const empty = (): TurnResult => ({ available: false, ok: false, existing: false, claimed: false, turn: null });
  const readEmpty = (): ReadResult => ({ available: false, turns: [], truncated: false, untrustedContent: true });
  function turn(value: unknown): InrAssistantMemoryTurn | null {
    const row = object(value);
    if (row.account_id !== accountId || row.actor_user_id !== actorUserId ||
      typeof row.conversation_id !== "string" || !UUID.test(row.conversation_id) ||
      typeof row.turn_id !== "string" || !UUID.test(row.turn_id) ||
      !["pending", "completed", "failed"].includes(String(row.status)) ||
      typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at)) ||
      typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at)) || typeof row.user_text !== "string") return null;
    return {
      conversationId: row.conversation_id, turnId: row.turn_id,
      userText: sanitizeInrAssistantMemoryText(row.user_text, 4_000),
      assistantText: typeof row.assistant_text === "string" ? sanitizeInrAssistantMemoryText(row.assistant_text) : null,
      status: row.status as InrAssistantMemoryTurn["status"], createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
  async function find(turnId: string) {
    const response = await execute(() => supabase.from(TABLE).select(SELECT).eq("account_id", accountId)
      .eq("actor_user_id", actorUserId).eq("turn_id", turnId).gte("created_at", inrAssistantMemoryCutoff()).maybeSingle());
    if (!response || response.error) return { available: false, turn: null };
    const saved = response.data ? turn(response.data) : null;
    return response.data && !saved ? { available: false, turn: null } : { available: true, turn: saved };
  }
  function match(existing: InrAssistantMemoryTurn, identity: TurnIdentity, userText?: string) {
    if (existing.conversationId !== identity.conversationId || (userText !== undefined && existing.userText !== userText)) {
      throw new InrAssistantMemoryConflictError("Cette demande est déjà liée à un autre message. Merci de réessayer avec une nouvelle demande.");
    }
  }
  async function finish(input: TurnIdentity & { assistantText?: string }, status: "completed" | "failed"): Promise<TurnResult> {
    const identity = { conversationId: uuid(input.conversationId), turnId: uuid(input.turnId) };
    const assistantText = input.assistantText == null && status === "failed" ? null : prose(input.assistantText, INR_ASSISTANT_MEMORY_MAX_REPLY_CHARS);
    const response = await execute(() => supabase.from(TABLE).update({ status, assistant_text: assistantText, updated_at: new Date().toISOString() })
      .eq("account_id", accountId).eq("actor_user_id", actorUserId).eq("conversation_id", identity.conversationId)
      .eq("turn_id", identity.turnId).eq("status", "pending").eq("lease_id", leaseId)
      .gte("created_at", inrAssistantMemoryCutoff()).select(SELECT).maybeSingle());
    if (!response || response.error) return empty();
    const saved = response.data ? turn(response.data) : null;
    if (saved) return { available: true, ok: true, existing: false, claimed: false, turn: saved };
    const previous = await find(identity.turnId);
    if (!previous.available) return empty();
    if (previous.turn) match(previous.turn, identity);
    return { available: true, ok: Boolean(previous.turn?.status === "completed" || previous.turn?.status === status), existing: true, claimed: false, turn: previous.turn };
  }

  return {
    async beginTurn(input: TurnIdentity & { userText: string }): Promise<TurnResult> {
      const identity = { conversationId: uuid(input.conversationId), turnId: uuid(input.turnId) };
      const userText = prose(input.userText, 4_000);
      const previous = await find(identity.turnId);
      if (!previous.available) return empty();
      if (previous.turn) {
        match(previous.turn, identity, userText);
        const leaseRemaining = Math.max(0, Math.ceil((Date.parse(previous.turn.updatedAt) + PENDING_LEASE_MS - Date.now()) / 1_000));
        if (previous.turn.status === "completed" || (previous.turn.status === "pending" && leaseRemaining > 0)) {
          return { available: true, ok: true, existing: true, claimed: false, turn: previous.turn,
            ...(previous.turn.status === "pending" ? { retryAfterSeconds: leaseRemaining } : {}) };
        }
        const resumed = await execute(() => supabase.from(TABLE).update({ status: "pending", assistant_text: null, lease_id: leaseId, updated_at: new Date().toISOString() })
          .eq("account_id", accountId).eq("actor_user_id", actorUserId).eq("conversation_id", identity.conversationId)
          .eq("turn_id", identity.turnId).eq("status", previous.turn!.status).eq("updated_at", previous.turn!.updatedAt)
          .gte("created_at", inrAssistantMemoryCutoff()).select(SELECT).maybeSingle());
        if (!resumed || resumed.error) return empty();
        const saved = resumed.data ? turn(resumed.data) : null;
        if (saved) return { available: true, ok: true, existing: true, claimed: true, turn: saved };
        const raced = await find(identity.turnId);
        return { available: raced.available, ok: Boolean(raced.turn), existing: true, claimed: false, turn: raced.turn };
      }
      const response = await execute(() => supabase.from(TABLE).insert({ account_id: accountId, actor_user_id: actorUserId,
        conversation_id: identity.conversationId, turn_id: identity.turnId, user_text: userText, status: "pending", lease_id: leaseId })
        .select(SELECT).maybeSingle());
      if (response && !response.error) {
        const saved = turn(response.data);
        return saved ? { available: true, ok: true, existing: false, claimed: true, turn: saved } : empty();
      }
      if (object(response?.error).code !== "23505") return empty();
      // The unique account+actor+turn constraint wins concurrent retries.
      const raced = await find(identity.turnId);
      if (raced.turn) match(raced.turn, identity, userText);
      return { available: raced.available, ok: Boolean(raced.turn), existing: true, claimed: false, turn: raced.turn };
    },
    completeTurn: (input: TurnIdentity & { assistantText: string }) => finish(input, "completed"),
    failTurn: (input: TurnIdentity & { assistantText?: string }) => finish(input, "failed"),

    async loadRecent(input: { conversationId?: string; limit?: number } = {}): Promise<ReadResult> {
      const maximum = limit(input.limit, 6);
      const conversationId = input.conversationId === undefined ? null : uuid(input.conversationId);
      const response = await execute(() => {
        let query = supabase.from(TABLE).select(SELECT).eq("account_id", accountId).eq("actor_user_id", actorUserId)
          .gte("created_at", inrAssistantMemoryCutoff());
        if (conversationId) query = query.eq("conversation_id", conversationId);
        return query.order("created_at", { ascending: false }).order("turn_id", { ascending: false }).limit(maximum + 1);
      });
      if (!response || response.error || !Array.isArray(response.data)) return readEmpty();
      const selected = response.data.slice(0, maximum);
      const turns = selected.map(turn).filter((item): item is InrAssistantMemoryTurn => Boolean(item)).reverse();
      if (turns.length !== selected.length) return readEmpty();
      return { available: true, turns, truncated: response.data.length > maximum, untrustedContent: true };
    },

    async search(input: { query: string; limit?: number }): Promise<ReadResult> {
      const maximum = limit(input.limit, 8);
      if (typeof input.query !== "string" || input.query.length > 500) throw new InrAssistantMemoryInputError("Recherche de discussion invalide.");
      const terms = [...new Set(sanitizeInrAssistantMemoryText(input.query, 500).toLowerCase().match(/[\p{L}\p{N}]{3,40}/gu) ?? [])].slice(0, 8);
      if (!terms.length) return { available: true, turns: [], truncated: false, untrustedContent: true };
      const response = await execute(() => supabase.from(TABLE).select(SELECT).eq("account_id", accountId).eq("actor_user_id", actorUserId)
        .gte("created_at", inrAssistantMemoryCutoff())
        .textSearch("search_document", terms.join(" OR "), { type: "websearch", config: "simple" })
        .order("created_at", { ascending: false }).order("turn_id", { ascending: false }).limit(maximum + 1));
      if (!response || response.error || !Array.isArray(response.data)) return readEmpty();
      const selected = response.data.slice(0, maximum);
      const turns = selected.map(turn).filter((item): item is InrAssistantMemoryTurn => Boolean(item));
      if (turns.length !== selected.length) return readEmpty();
      return { available: true, turns,
        truncated: response.data.length > maximum, untrustedContent: true };
    },

    async listConversations(input: { limit?: number } = {}) {
      const maximum = limit(input.limit, 20);
      const response = await execute(() => supabase.rpc("inrcy_list_assistant_conversations", { p_account_id: accountId, p_limit: maximum + 1 }));
      if (!response || response.error || !Array.isArray(response.data)) return { available: false, conversations: [], truncated: false };
      const conversations = response.data.slice(0, maximum).map((value) => {
        const row = object(value);
        return typeof row.conversation_id === "string" && UUID.test(row.conversation_id) && typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at))
          ? { id: row.conversation_id, title: sanitizeInrAssistantMemoryText(row.title, 100) || "Discussion", updatedAt: row.updated_at } : null;
      }).filter((row): row is { id: string; title: string; updatedAt: string } => Boolean(row));
      return { available: true, conversations, truncated: response.data.length > maximum };
    },
  };
}
