import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "@/lib/accountSubscriptionAccess";
import { commercialIdempotencyKey, commercialMutationId } from "@/lib/commercialMutationIdempotency";
import { parseCommercialDocumentDraft } from "@/lib/commercialDocumentDraft";
import { withApi } from "@/lib/observability/withApi";

export const runtime = "nodejs";
const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const error = (message: string, status: number, code: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error: message, code, ...extra }, { status });

/** Native draft persistence only: no official numbering, finalization or sending. */
async function createDraft(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origine de requête non autorisée.", 403, "origin_not_allowed");
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  if (await getDashboardEditionForAccountId(auth.activeUserId) !== "founder") return error("Les devis et factures nécessitent l’offre Founder.", 403, "accounting_access_required");
  const active = await getActiveSubscriptionAccountIds([auth.activeUserId]);
  if (!active.has(auth.activeUserId)) return error("Un abonnement actif est nécessaire pour enregistrer un brouillon.", 403, "subscription_inactive");
  if (request.signal.aborted) return error("La demande est interrompue.", 409, "request_interrupted");
  let input;
  let key: string;
  try {
    if (Number(request.headers.get("content-length") || 0) > 30_000) throw new Error("Too large");
    key = commercialIdempotencyKey(request) || "";
    if (!key) throw new Error("Missing key");
    const body: unknown = await request.json();
    if (JSON.stringify(body).length > 30_000) throw new Error("Too large");
    input = parseCommercialDocumentDraft(body);
  } catch { return error("Précisez un brouillon valide et sa clé de sauvegarde.", 400, "draft_input_invalid"); }
  const id = commercialMutationId(auth.activeUserId, key, input.kind);
  const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const href = `/dashboard/${input.kind === "facture" ? "factures" : "devis"}/new?saveId=${id}`;
  const success = (missingFields: string[], recovered: boolean) => NextResponse.json({ ok: true, id, kind: input.kind, status: "brouillon", incomplete: missingFields.length > 0, missingFields, idempotent: recovered, href,
    message: "Brouillon enregistré, à vérifier dans l’outil. Aucun numéro officiel, envoi ou paiement n’a été effectué." });
  const recover = async () => {
    const read = await auth.supabase.from("doc_saves").select("id,user_id,type,status:payload->>status,is_finalized:payload->>isFinalized,input_hash:payload->>assistantDraftInputHash,missing_fields:payload->assistantDraftMissingFields")
      .eq("user_id", auth.activeUserId).eq("type", input.kind).eq("id", id).maybeSingle();
    if (read.error) return { response: error("La sauvegarde ne peut pas être vérifiée.", 503, "draft_lookup_unavailable") };
    if (!read.data) return { response: null };
    const saved = row(read.data);
    if (saved.user_id !== auth.activeUserId || saved.id !== id || saved.type !== input.kind || saved.input_hash !== inputHash || saved.status !== "brouillon" || saved.is_finalized === true || saved.is_finalized === "true") return { response: error("Ce document existe déjà ou a été modifié. Vérifiez-le avant une nouvelle demande.", 409, "draft_already_processed", { id, href }) };
    const allowed = new Set(["Nom du client", "Type de client", "Adresse de facturation", "Code postal", "Ville", "Date d’échéance", "Validité du devis", "Numéro du devis", "Informations légales du prestataire"]);
    const missing = Array.isArray(saved.missing_fields) ? saved.missing_fields.filter((field): field is string => typeof field === "string" && allowed.has(field)).slice(0, 10) : [];
    return { response: success(missing, true) };
  };
  const previous = await recover();
  if (previous.response) return previous.response;

  let contact: Record<string, unknown> = {};
  if (input.client.contactId) {
    const read = await auth.supabase.from("crm_contacts").select("id,user_id,last_name,first_name,company_name,email,billing_address,address,postal_code,city,category,siret,vat_number")
      .eq("user_id", auth.activeUserId).eq("id", input.client.contactId).maybeSingle();
    contact = row(read.data);
    if (read.error || contact.id !== input.client.contactId || contact.user_id !== auth.activeUserId) return error("Le client n’est pas disponible dans l’établissement actif.", 404, "draft_client_unavailable");
  }
  const profile = await auth.supabase.from("profiles").select("vat_dispense,company_legal_name,hq_address,hq_zip,hq_city,siren").eq("user_id", auth.activeUserId).maybeSingle();
  if (profile.error) return error("Le régime de TVA ne peut pas être vérifié.", 503, "draft_tax_unavailable");
  const vatDispense = row(profile.data).vat_dispense === true;
  if (vatDispense && input.lines.some(line => line.vatRate !== null && line.vatRate !== 0)) return error("Le profil est exonéré de TVA mais un taux non nul est demandé. Vérifiez le régime avant de préparer le document.", 422, "draft_tax_conflict", { missingFields: ["Régime de TVA (profil exonéré)"] });
  const details = new Set<string>();
  for (const line of input.lines) {
    if (line.qty === null) details.add("Quantité de chaque ligne");
    if (line.unitPrice === null) details.add("Prix unitaire HT de chaque ligne");
    if (line.vatRate === null && !vatDispense) details.add("Taux de TVA de chaque ligne");
    if (line.qty !== null && line.unitPrice !== null && line.qty * line.unitPrice > 1_000_000_000) return error("Le total de la ligne dépasse la limite de préparation.", 400, "draft_amount_invalid");
  }
  if (details.size) return error("Précisez les montants, quantités ou taux manquants avant la préparation.", 422, "draft_details_required", { missingFields: [...details] });
  const clientName = input.client.name || text(contact.company_name) || [text(contact.first_name), text(contact.last_name)].filter(Boolean).join(" ");
  if (!clientName) return error("Précisez le nom du client à faire figurer sur le document.", 422, "draft_details_required", { missingFields: ["Nom du client"] });
  const billingAddress = input.client.address ?? text(contact.billing_address || contact.address);
  const billingPostalCode = input.client.postalCode ?? text(contact.postal_code);
  const billingCity = input.client.city ?? text(contact.city);
  const clientType = input.client.type ?? (contact.category === "collectivite_publique" ? "institution" : ["particulier", "professionnel"].includes(String(contact.category)) ? String(contact.category) : "");
  const missing: string[] = [];
  if (!clientType) missing.push("Type de client");
  if (!billingAddress) missing.push("Adresse de facturation");
  if (!billingPostalCode) missing.push("Code postal");
  if (!billingCity) missing.push("Ville");
  if (!profile.data || ["company_legal_name", "hq_address", "hq_zip", "hq_city", "siren"].some(field => !text(row(profile.data)[field]))) missing.push("Informations légales du prestataire");
  if (input.kind === "facture" && !input.dueDate) missing.push("Date d’échéance");
  if (input.kind === "devis") { missing.push("Numéro du devis"); if (input.validityDays === null) missing.push("Validité du devis"); }
  const today = new Date().toISOString().slice(0, 10);
  if (input.dueDate && input.dueDate < (input.documentDate || today)) return error("L’échéance précède le document.", 400, "draft_date_invalid");
  const postalCity = [billingPostalCode, billingCity].filter(Boolean).join(" ");
  const clientAddress = postalCity && billingAddress.toLowerCase().endsWith(postalCity.toLowerCase()) ? billingAddress : [billingAddress, postalCity].filter(Boolean).join(" ");
  const snapshot = {
    number: "", ...(input.kind === "facture" ? { invoiceDate: input.documentDate || today, dueDate: input.dueDate || "", documentKind: "invoice", paymentMethod: "", paymentDetails: "", invoiceMention: "" } : { docDateISO: input.documentDate || today, validityDays: input.validityDays ?? 30, quoteMention: "" }),
    clientName, clientEmail: input.client.email ?? text(contact.email), clientAddress,
    billingAddress, billingPostalCode, billingCity, deliveryAddress: billingAddress, deliveryPostalCode: billingPostalCode, deliveryCity: billingCity, sameAddresses: true,
    clientSiren: /^\d{9}(?:\d{5})?$/.test(text(contact.siret).replace(/\s/g, "")) ? text(contact.siret).replace(/\s/g, "").slice(0, 9) : "", clientVatNumber: text(contact.vat_number), clientType, vatDispense,
    lines: input.lines.map((line, index) => ({ id: `l_${index + 1}`, label: line.label, qty: line.qty, unitPrice: line.unitPrice, vatRate: vatDispense ? 0 : line.vatRate })),
    notes: input.notes || "", discountKind: "", discountValue: 0, discountDetails: "", status: "brouillon", isFinalized: false, finalizedAt: null, lockedAt: null,
    assistantDraftInputHash: inputHash, assistantDraftMissingFields: missing,
  };
  if (request.signal.aborted) return error("La demande est interrompue.", 409, "request_interrupted");
  const saved = await auth.supabase.from("doc_saves").insert({ id, user_id: auth.activeUserId, type: input.kind, name: clientName, payload: snapshot, updated_at: new Date().toISOString() }).select("id").single();
  if (saved.error) { const existing = await recover(); return existing.response || error("La sauvegarde n’a pas été confirmée. Vérifiez l’outil avant de réessayer.", 503, "draft_save_unconfirmed"); }
  if (saved.data?.id !== id) return error("La sauvegarde n’a pas été confirmée.", 503, "draft_save_unconfirmed");
  return success(missing, false);
}

export const POST = withApi(createDraft, { route: "/api/documents/drafts" });
