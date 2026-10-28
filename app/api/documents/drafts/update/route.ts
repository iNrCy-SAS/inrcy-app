import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "@/lib/accountSubscriptionAccess";
import { commercialIdempotencyKey } from "@/lib/commercialMutationIdempotency";
import { parseCommercialDocumentUpdate, applyCommercialDocumentChanges } from "@/lib/commercialDocumentUpdate";
import { commercialDocumentMissingFields, commercialDocumentRow as row } from "@/lib/commercialDocumentValidation";
import { withApi } from "@/lib/observability/withApi";
const error = (message: string, status: number, code: string) => NextResponse.json({ error: message, code }, { status });
async function update(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return error("Origine non autorisée.",403,"origin_not_allowed");
  const auth = await requireUser(); if (auth.errorResponse) return auth.errorResponse;
  if (await getDashboardEditionForAccountId(auth.activeUserId) !== "founder" || !(await getActiveSubscriptionAccountIds([auth.activeUserId])).has(auth.activeUserId)) return error("Accès à la gestion commerciale requis.",403,"accounting_access_required");
  let input, key;
  try { key = commercialIdempotencyKey(request); const body = await request.json(); if (!key || JSON.stringify(body).length > 30_000) throw new Error(); input = parseCommercialDocumentUpdate(body); }
  catch { return error("Modification de brouillon invalide.",400,"document_update_invalid"); }
  const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex"), keyHash = createHash("sha256").update(`${auth.activeUserId}:${key}`).digest("hex");
  const read = () => auth.supabase.from("doc_saves").select("id,user_id,type,name,payload,updated_at").eq("id",input.documentId).eq("user_id",auth.activeUserId).eq("type",input.kind).maybeSingle();
  const previous = await read(), document = row(previous.data), payload = row(document.payload);
  if (previous.error) return error("Le brouillon ne peut pas être lu.",503,"document_unavailable");
  if (!previous.data) return error("Document introuvable.",404,"document_not_found");
  const sameOperation = (value: Record<string,unknown>) => { const receipt = row(value.assistantLastUpdate); return receipt.keyHash === keyHash && receipt.inputHash === inputHash; };
  const success = (saved: Record<string,unknown>, version: unknown, idempotent = false) => NextResponse.json({ ok:true,id:input.documentId,kind:input.kind,status:"updated",updatedAt:version,missingFields:commercialDocumentMissingFields(input.kind,saved),idempotent });
  if (sameOperation(payload)) return success(payload,document.updated_at,true);
  if (row(payload.assistantLastUpdate).keyHash === keyHash || document.updated_at !== input.expectedUpdatedAt) return error("Le brouillon a changé. Relisez sa version actuelle.",409,"document_version_conflict");
  let next;
  try { next = applyCommercialDocumentChanges(payload,input,index => `l_ai_${inputHash.slice(0,18)}_${index}`); }
  catch (reason) { return error(reason instanceof Error ? reason.message : "Brouillon invalide.",422,"document_update_invalid"); }
  if (input.changes.lines.some(line => line.vatRate !== null) || input.changes.addLines.length) {
    const profile = await auth.supabase.from("profiles").select("vat_dispense").eq("user_id",auth.activeUserId).maybeSingle();
    if (profile.error || !profile.data) return error("Le régime de TVA ne peut pas être vérifié.",503,"document_tax_unavailable");
    if (row(profile.data).vat_dispense === true && (next.lines as Record<string,unknown>[]).some(line => line.vatRate !== 0)) return error("Le profil est exonéré de TVA. Vérifiez les taux du document.",422,"document_tax_conflict");
  }
  if ((next.lines as Record<string,unknown>[]).some(line => Number(line.qty)*Number(line.unitPrice)>1_000_000_000)) return error("Montant de ligne trop élevé.",422,"document_update_invalid");
  if (request.signal.aborted) return error("Demande interrompue.",409,"request_interrupted");
  const now = new Date().toISOString();
  next.assistantLastUpdate = { keyHash,inputHash }; next.assistantDraftMissingFields = commercialDocumentMissingFields(input.kind,next);
  const saved = await auth.supabase.from("doc_saves").update({ payload:next,name:String(next.clientName || next.clientEmail || next.number || document.name),updated_at:now }).eq("id",input.documentId).eq("user_id",auth.activeUserId).eq("type",input.kind).eq("updated_at",input.expectedUpdatedAt).select("id").maybeSingle();
  if (saved.error) return error("La modification ne peut pas être confirmée. Vérifiez le brouillon.",503,"document_update_unconfirmed");
  const checked = await read(), final = row(checked.data), finalPayload = row(final.payload);
  if (!saved.data && !sameOperation(finalPayload)) return error("Le brouillon a changé. Relisez-le.",409,"document_version_conflict");
  if (checked.error || !sameOperation(finalPayload)) return error("La modification ne peut pas être vérifiée. Relisez le brouillon.",503,"document_update_unconfirmed");
  return success(finalPayload,final.updated_at,!saved.data);
}
export const POST = withApi(update,{route:"/api/documents/drafts/update"});
