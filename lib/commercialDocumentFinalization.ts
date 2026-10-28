import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "@/lib/accountSubscriptionAccess";
import { COMMERCIAL_UUID } from "@/lib/commercialDocumentDraft";
import { commercialDocumentMissingFields, commercialDocumentContentVersion, commercialDocumentRow as row } from "./commercialDocumentValidation.ts";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const error = (message: string, status: number, code: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error: message, code, ...extra }, { status });
export async function finalizeCommercialDocumentRequest(request: Request, kind: "devis" | "facture") {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origine non autorisée.", 403, "origin_not_allowed");
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  if (await getDashboardEditionForAccountId(auth.activeUserId) !== "founder" || !(await getActiveSubscriptionAccountIds([auth.activeUserId])).has(auth.activeUserId)) return error("Un accès actif à la gestion commerciale est nécessaire.", 403, "accounting_access_required");
  const input = row(await request.json().catch(() => null));
  const id = text(input.docSaveId), expected = text(input.expectedUpdatedAt);
  if (!COMMERCIAL_UUID.test(id) || expected && !Number.isFinite(Date.parse(expected))) return error("Référence ou version du document invalide.", 400, "document_input_invalid");
  if (request.signal.aborted) return error("La demande est interrompue.", 409, "request_interrupted");
  const read = () => auth.supabase.from("doc_saves").select("id,user_id,type,name,payload,updated_at").eq("id", id).eq("user_id", auth.activeUserId).eq("type", kind).maybeSingle();
  const first = await read();
  if (first.error) return error("Le document ne peut pas être vérifié.", 503, "document_unavailable");
  if (!first.data) return error("Document introuvable.", 404, "document_not_found");
  const document = row(first.data), payload = row(document.payload);
  if (expected && expected !== document.updated_at) return error("Ce document a changé. Relisez sa version actuelle avant de le figer.", 409, "document_version_conflict");
  const success = (saved: Record<string, unknown>, unchanged = false) => NextResponse.json({ ok: true, docSaveId: id, kind, number: text(saved.number), status: text(saved.status), isFinalized: true, finalizedAt: saved.finalizedAt, lockedAt: saved.lockedAt, officialSequenceYear: saved.officialSequenceYear ?? null, officialSequenceValue: saved.officialSequenceValue ?? null, unchanged, sent: false });
  if (payload.isFinalized === true && text(payload.number) && (expected || kind === "devis")) return success(payload, true);
  const missingFields = commercialDocumentMissingFields(kind, payload);
  const profile = await auth.supabase.from("profiles").select("company_legal_name,hq_address,hq_zip,hq_city,siren,vat_dispense").eq("user_id", auth.activeUserId).maybeSingle();
  if (profile.error) return error("Les informations du prestataire ne peuvent pas être vérifiées.", 503, "document_issuer_unavailable");
  const issuer = { ...row(profile.data), ...row(payload.providerOverride) };
  if (["company_legal_name", "hq_address", "hq_zip", "hq_city", "siren"].some(field => !text(issuer[field]))) missingFields.push("Informations légales du prestataire");
  if (row(profile.data).vat_dispense === true && Array.isArray(payload.lines) && payload.lines.some(line => row(line).vatRate !== 0)) missingFields.push("Régime de TVA du prestataire");
  if (missingFields.length) return error("Complétez les champs manquants avant de figer le document.", 422, "document_incomplete", { missingFields });
  let number = text(payload.number), year = payload.officialSequenceYear, seq = payload.officialSequenceValue;
  if (kind === "facture" && !(payload.isFinalized === true && number)) {
    const allocated = await auth.supabase.rpc("allocate_invoice_number", { p_doc_save_id: id });
    if (allocated.error) return error("La numérotation officielle est indisponible. Vérifiez le document avant de réessayer.", 503, "invoice_numbering_unavailable");
    const numbered = row(Array.isArray(allocated.data) ? allocated.data[0] : allocated.data);
    number = text(numbered.number); year = numbered.year; seq = numbered.seq;
    if (!number) return error("Le numéro officiel ne peut pas être confirmé.", 503, "invoice_numbering_unavailable");
  }
  const latest = await read();
  const current = row(latest.data), currentPayload = row(current.payload);
  if (latest.error || !latest.data) return error("La version du document ne peut pas être confirmée.", 503, "document_unavailable");
  if (kind === "devis" && current.updated_at !== document.updated_at || currentPayload.status !== payload.status && currentPayload.isFinalized !== true) return error("Le document a changé pendant la préparation. Relisez-le avant de le figer.", 409, "document_version_conflict");
  if (commercialDocumentContentVersion(payload) !== commercialDocumentContentVersion(currentPayload) || request.signal.aborted) return error("Le document a changé pendant la préparation. Relisez-le avant de le figer.", 409, "document_version_conflict");
  if (current.updated_at !== document.updated_at && currentPayload.isFinalized === true && text(currentPayload.number)) return success(currentPayload, true);
  const now = new Date().toISOString();
  const target = kind === "devis" ? "envoye" : ["en_attente_paiement", "envoye", "paye"].includes(text(input.targetStatus)) ? text(input.targetStatus) : "en_attente_paiement";
  const next: Record<string, unknown> = { ...currentPayload, number, status: target, isFinalized: true, finalizedAt: text(currentPayload.finalizedAt) || now, lockedAt: text(currentPayload.lockedAt) || now, ...(kind === "facture" ? { officialNumberAssignedAt: text(currentPayload.officialNumberAssignedAt) || now, officialSequenceYear: year ?? null, officialSequenceValue: seq ?? null } : {}) };
  const update = await auth.supabase.from("doc_saves").update({ name: text(next.clientName) || text(next.clientEmail) || number || text(current.name), payload: next, updated_at: now }).eq("id", id).eq("user_id", auth.activeUserId).eq("type", kind).eq("updated_at", current.updated_at).select("id").maybeSingle();
  if (update.error) return error("La finalisation ne peut pas être confirmée. Vérifiez le document.", 503, "document_update_unconfirmed");
  if (!update.data) return error("Le document a changé. Relisez-le avant de le figer.", 409, "document_version_conflict");
  return success(next);
}
