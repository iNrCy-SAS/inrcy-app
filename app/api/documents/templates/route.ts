import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "@/lib/accountSubscriptionAccess";
import { commercialIdempotencyKey, commercialMutationId } from "@/lib/commercialMutationIdempotency";
import { COMMERCIAL_UUID } from "@/lib/commercialDocumentDraft";
import { commercialDocumentRow as row } from "@/lib/commercialDocumentValidation";
import { createCommercialTemplateSnapshot, type CommercialTemplateKind } from "@/lib/commercialDocumentTemplate";
import { assistantActionFingerprint } from "@/lib/inrAssistantActionPreview";
import { withApi } from "@/lib/observability/withApi";

const error = (message: string, status: number, code: string) => NextResponse.json({ error: message, code }, { status });
const version = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));

async function mutateTemplate(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origine non autorisée.", 403, "origin_not_allowed");
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  if (await getDashboardEditionForAccountId(auth.activeUserId) !== "founder" || !(await getActiveSubscriptionAccountIds([auth.activeUserId])).has(auth.activeUserId)) return error("Accès actif à la gestion commerciale requis.", 403, "accounting_access_required");
  let input: Record<string, unknown>, key: string;
  try {
    const raw = await request.text();
    if (raw.length > 100_000) throw new Error();
    input = row(JSON.parse(raw)); key = commercialIdempotencyKey(request) || "";
    if (!key || input.accountId !== auth.activeUserId || !["quote", "invoice"].includes(String(input.kind))) throw new Error();
    const keys = Object.keys(input).sort().join(",");
    if (input.operation === "delete") {
      if (keys !== "accountId,expectedUpdatedAt,kind,operation,sourceId" || !COMMERCIAL_UUID.test(String(input.sourceId)) || !version(input.expectedUpdatedAt)) throw new Error();
    } else if (input.operation === "create") {
      if (typeof input.name !== "string" || !input.name.trim() || input.name.trim() !== input.name || input.name.length > 120) throw new Error();
      if (input.source === "saved") {
        if (keys !== "accountId,expectedUpdatedAt,kind,name,operation,source,sourceId" || !COMMERCIAL_UUID.test(String(input.sourceId)) || !version(input.expectedUpdatedAt)) throw new Error();
      } else if (input.source !== "form" || keys !== "accountId,kind,name,operation,snapshot,source" || !input.snapshot || typeof input.snapshot !== "object" || Array.isArray(input.snapshot)) throw new Error();
    } else throw new Error();
  } catch { return error("Nom, source ou version de modèle invalide.", 400, "template_input_invalid"); }
  const kind = input.kind as CommercialTemplateKind, type = kind === "quote" ? "devis" : "facture";
  const read = (id: string) => auth.supabase.from("doc_saves").select("id,user_id,type,name,payload,updated_at").eq("id", id).eq("user_id", auth.activeUserId).eq("type", type).maybeSingle();
  const owned = (value: unknown, id: string) => { const item = row(value); return item.id === id && item.user_id === auth.activeUserId && item.type === type; };
  if (input.operation === "delete") {
    const id = String(input.sourceId), before = await read(id);
    if (before.error) return error("Modèle non vérifiable.", 503, "template_unavailable");
    if (!owned(before.data, id) || row(before.data?.payload).isTemplate !== true) return error("Modèle introuvable. Aucune suppression confirmée.", 404, "template_not_found");
    if (before.data.updated_at !== input.expectedUpdatedAt || request.signal.aborted) return error("Le modèle a changé. Relisez-le.", 409, "template_version_conflict");
    const deleted = await auth.supabase.from("doc_saves").delete().eq("id", id).eq("user_id", auth.activeUserId).eq("type", type)
      .eq("updated_at", input.expectedUpdatedAt).eq("payload->>isTemplate", "true").select("id").maybeSingle();
    if (deleted.error) return error("La suppression ne peut pas être confirmée. Relisez les modèles avant toute autre action.", 503, "template_delete_unconfirmed");
    if (!deleted.data || deleted.data.id !== id) return error("Le modèle a changé. Aucune suppression confirmée.", 409, "template_version_conflict");
    const after = await read(id);
    if (after.error || after.data) return error("La suppression ne peut pas être confirmée.", 503, "template_delete_unconfirmed");
    return NextResponse.json({ ok: true, status: "deleted", id, kind, deleted: true });
  }
  const hash = assistantActionFingerprint(input);
  const actorKey = createHash("sha256").update(`template:${auth.authUserId}:${key}`).digest("hex");
  const id = commercialMutationId(auth.activeUserId, actorKey, type)!;
  const receiptMatches = (value: unknown) => { const item = row(value), payload = row(item.payload);
    const { nativeTemplateInputHash, nativeTemplatePayloadHash, ...content } = payload;
    return owned(value, id) && item.name === input.name && payload.isTemplate === true && nativeTemplateInputHash === hash && nativeTemplatePayloadHash === assistantActionFingerprint(content);
  };
  const success = (value: unknown, reused: boolean) => NextResponse.json({ ok: true, status: "created", id, kind, name: input.name, updatedAt: row(value).updated_at, reused, documentCreated: false });
  const previous = await read(id);
  if (previous.error) return error("Le modèle ne peut pas être vérifié.", 503, "template_unavailable");
  if (previous.data) return receiptMatches(previous.data) ? success(previous.data, true) : error("Cette tentative a déjà une autre version. Relisez les modèles.", 409, "template_idempotency_conflict");
  let source = input.snapshot;
  if (input.source === "saved") {
    const found = await read(String(input.sourceId));
    if (found.error) return error("La source ne peut pas être vérifiée.", 503, "template_unavailable");
    if (!owned(found.data, String(input.sourceId)) || found.data.updated_at !== input.expectedUpdatedAt || row(found.data.payload).isTemplate === true) return error("La source a changé. Relisez-la.", 409, "template_version_conflict");
    source = found.data.payload;
  }
  let payload: Record<string, unknown>;
  try { payload = createCommercialTemplateSnapshot(kind, source, String(input.name), index => `l_${id}_${index}`); }
  catch { return error("Ajoutez au moins une prestation valide.", 400, "template_lines_invalid"); }
  payload.nativeTemplatePayloadHash = assistantActionFingerprint(payload);
  payload.nativeTemplateInputHash = hash;
  if (request.signal.aborted) return error("Demande interrompue.", 409, "request_interrupted");
  const inserted = await auth.supabase.from("doc_saves").insert({ id, user_id: auth.activeUserId, type, name: input.name, payload, updated_at: new Date().toISOString() });
  // A transport failure can follow a committed insert. Recover only the exact operation.
  const checked = await read(id);
  if (!checked.error && receiptMatches(checked.data)) return success(checked.data, !!inserted.error);
  return error("La création du modèle ne peut pas être confirmée. Relisez les modèles.", 503, "template_create_unconfirmed");
}
export const POST = withApi(mutateTemplate, { route: "/api/documents/templates" });
