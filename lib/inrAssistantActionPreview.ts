import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type RecordValue = Record<string, unknown>;
export type AssistantActionPreview = {
  version: 1; accountId: string; actorUserId: string; kind: string; targetId: string;
  fingerprint: string; patch: RecordValue; expiresAt: number;
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function assistantActionFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
const secret = () => process.env.INRCY_ASSISTANT_APPROVAL_SECRET || process.env.STORAGE_CONTENT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const signature = (encoded: string, key: string) => createHmac("sha256", key).update(`inrcy-assistant-action-v1:${encoded}`).digest("base64url");
export function createAssistantActionPreview(input: Omit<AssistantActionPreview, "version" | "expiresAt">) {
  const key = secret();
  if (key.length < 32) throw new Error("Action preview signing unavailable");
  const payload: AssistantActionPreview = { ...input, version: 1, expiresAt: Date.now() + 15 * 60_000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  if (encoded.length > 23_900) throw new Error("Action preview too large");
  const token = `${encoded}.${signature(encoded, key)}`;
  const reference = `IA-${assistantActionFingerprint(token).slice(0, 12).toUpperCase()}`;
  return { token, reference, expiresAt: new Date(payload.expiresAt).toISOString() };
}
export function verifyAssistantActionPreview(token: string, scope: { accountId: string; actorUserId: string; kind: string }) {
  try {
    const key = secret();
    if (key.length < 32 || typeof token !== "string" || token.length > 24_000) return null;
    const [encoded, given, extra] = token.split(".");
    if (!encoded || !given || extra) return null;
    const expected = Buffer.from(signature(encoded, key)), received = Buffer.from(given);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AssistantActionPreview;
    if (payload.version !== 1 || payload.accountId !== scope.accountId || payload.actorUserId !== scope.actorUserId || payload.kind !== scope.kind
      || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now() || payload.expiresAt > Date.now() + 15 * 60_000
      || typeof payload.targetId !== "string" || typeof payload.fingerprint !== "string" || !payload.patch || typeof payload.patch !== "object" || Array.isArray(payload.patch)) return null;
    return { ...payload, reference: `IA-${assistantActionFingerprint(token).slice(0, 12).toUpperCase()}` };
  } catch { return null; }
}
export function hasAssistantActionApproval(message: string, quote: string, reference: string): boolean {
  if (!quote || !message.includes(quote) || !quote.includes(reference)) return false;
  // Data quoted by the pro must not turn into an instruction to execute it.
  const unquoted = message.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|«[^»]*»|“[^”]*”|"[^"]*"|^>.*$/gm, " ");
  if (!unquoted.includes(quote)) return false;
  const normalized = message.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/\b(?:comment|pourquoi|explique|imagine|suppose|si je|si on|si tu|ne pas|not|never)\b|\bne\b.{0,60}\bpas\b|n[’'](?:applique|execute|envoie)|\b(?:applique|confirme|execute|valide)\s+pas\b|\b(?:demain|plus tard|si possible plus tard)\b/.test(normalized)) return false;
  return /\b(?:confirme|valide|applique|execute|autorise)\b/.test(quote.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
}
export function calendarEventFingerprint(row: RecordValue) {
  return assistantActionFingerprint(Object.fromEntries(["title", "description", "location", "start_at", "end_at", "all_day", "meta"].map(key => [key, row[key] ?? null])));
}
export function scheduledPublicationFingerprint(row: RecordValue) {
  return assistantActionFingerprint(Object.fromEntries(["action_type", "target_tool", "title", "summary", "scheduled_at", "timezone", "channels", "payload", "status", "attempt_count", "executed_at", "updated_at"].map(key => [key, row[key] ?? null])));
}
