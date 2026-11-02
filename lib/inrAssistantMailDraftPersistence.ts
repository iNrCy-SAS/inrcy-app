import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMailSubject } from "./mailEncoding.ts";
import { normalizeRichMailHtmlForSend } from "./mailRichText.ts";
type Row = Record<string, unknown>;
const obj = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const stable = (value: unknown): string => JSON.stringify(value && typeof value === "object" ? Array.isArray(value) ? value.map(item => JSON.parse(stable(item))) : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(stable(item))])) : value ?? null);
const text = (value: unknown) => typeof value === "string" ? value : "";
/** Match the form's loaded baseline before updating a draft another tab can edit. */
export function inrAssistantMailDraftMatchesBaseline(row: Row, snapshot: string | null): boolean {
  if (!snapshot) return false;
  let original: Row; try { original = obj(JSON.parse(snapshot)); } catch { return false; }
  const fields = { selectedAccountId: "integration_id", to: "to_emails", subject: "subject", text: "body_text", html: "body_html", composeType: "type", sourceDocSaveId: "source_doc_save_id", sourceDocType: "source_doc_type", sourceDocNumber: "source_doc_number", templateKey: "template_key" };
  if (Object.entries(fields).some(([key, field]) => key === "html" ? normalizeRichMailHtmlForSend(text(row.body_text), text(row[field])) !== normalizeRichMailHtmlForSend(text(original.text), text(original[key])) : key === "subject" ? normalizeMailSubject(text(row[field])).trim() !== normalizeMailSubject(text(original[key])).trim() : key === "to" ? text(row[field]).trim() !== text(original[key]).trim() : text(row[field]) !== text(original[key]))) return false;
  return stable(row.attachments ?? []) === stable(original.attachments ?? []);
}
/** Same native send_items payload, with exact draft/version comparison and readback.
 * No fallback may silently drop attachments or turn a sent item back into a draft. */
export async function persistInrAssistantMailDraft(input: { supabase: Pick<SupabaseClient, "from">; accountId: string; draftId: string | null; payload: Row; baseline: string | null; isCurrent: () => boolean; onWriteStarted: () => void }): Promise<string> {
  const guard = () => { if (!input.isCurrent()) throw new Error("Le composeur ou le compte a changé."); };
  const read = async (id: string) => {
    const result = await input.supabase.from("send_items").select("*").eq("id", id).eq("user_id", input.accountId).maybeSingle(); guard();
    if (result.error || !result.data || result.data.user_id !== input.accountId || result.data.id !== id) throw new Error("Le brouillon exact n’est plus accessible.");
    return obj(result.data);
  };
  guard();
  if (input.payload.user_id !== input.accountId || input.payload.status !== "draft") throw new Error("Périmètre du brouillon invalide.");
  let id = input.draftId;
  if (id) {
    const before = await read(id);
    if (before.status !== "draft" || typeof before.updated_at !== "string" || !inrAssistantMailDraftMatchesBaseline(before, input.baseline)) throw new Error("Le brouillon a changé. Rouvrez sa version actuelle avant de l’enregistrer.");
    guard();
    input.onWriteStarted();
    const result = await input.supabase.from("send_items").update(input.payload).eq("id", id).eq("user_id", input.accountId).eq("status", "draft").eq("updated_at", before.updated_at).select("id").maybeSingle();
    guard(); if (result.error || result.data?.id !== id) throw new Error("L’enregistrement du brouillon n’a pas été confirmé.");
  } else {
    input.onWriteStarted();
    const result = await input.supabase.from("send_items").insert(input.payload).select("id").single();
    guard(); if (result.error || typeof result.data?.id !== "string") throw new Error("L’enregistrement du brouillon n’a pas été confirmé.");
    id = result.data.id;
  }
  const after = await read(id!);
  if (Object.entries(input.payload).some(([key, value]) => stable(after[key]) !== stable(value))) throw new Error("Le brouillon enregistré ne correspond pas au composeur. Aucun nouvel essai automatique.");
  return id!;
}
