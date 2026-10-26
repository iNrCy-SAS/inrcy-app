import "server-only";

import { createHash } from "node:crypto";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/requireUser";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "@/lib/accountSubscriptionAccess";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { COMMERCIAL_DOCUMENT_DRAFT_SCHEMA, COMMERCIAL_UUID, parseCommercialDocumentDraft, type CommercialDocumentDraftInput } from "./commercialDocumentDraft.ts";

type Row = Record<string, unknown>;
type ContactFields = {
  displayName?: string | null; companyName?: string | null; email?: string | null; phone?: string | null;
  address?: string | null; billingAddress?: string | null; deliveryAddress?: string | null; postalCode?: string | null; city?: string | null;
  siret?: string | null; vatNumber?: string | null; category?: "particulier" | "professionnel" | "collectivite_publique" | null;
  contactType?: "client" | "prospect" | "fournisseur" | "partenaire" | "autre" | null; notes?: string | null; important?: boolean | null;
};
type ContactInput = { action: "create" | "update" | "delete"; instructionQuote: string; reference: string; contactId: string | null; fields: ContactFields };
type DraftInput = { instructionQuote: string; clientReference: string; draft: CommercialDocumentDraftInput };
export type InrAssistantCommercialResult = {
  ok: boolean; status: "created" | "updated" | "deleted" | "unchanged" | "draft" | "incomplete_draft" | "needs_instruction" | "needs_details" | "not_included" | "blocked" | "unavailable" | "unknown";
  message: string; nextAction: { label: string; href: string }; id?: string; kind?: "devis" | "facture"; missingFields?: string[]; changedFields?: string[];
};
const CONTACT_COLUMNS = "id,user_id,last_name,first_name,company_name,siret,email,phone,address,billing_address,delivery_address,vat_number,city,postal_code,category,contact_type,notes,important";
const FIELDS = { displayName: "display_name", companyName: "company_name", email: "email", phone: "phone", address: "address", billingAddress: "billing_address", deliveryAddress: "delivery_address", postalCode: "postal_code", city: "city", siret: "siret", vatNumber: "vat_number", category: "category", contactType: "contact_type", notes: "notes", important: "important" } as const;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const string = (value: unknown, maximum: number, minimum = 0) => { if (typeof value !== "string" || value.length > maximum || value.trim().length < minimum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("Champ commercial invalide."); return value.trim(); };
const strict = (value: unknown, allowed: string[]) => { const data = row(value); if (Object.keys(data).some(key => !allowed.includes(key))) throw new Error("Champ commercial non autorisé."); return data; };
const crmLink = { label: "iNr’CRM", href: "/dashboard/crm" };
const draftLink = (kind: "devis" | "facture") => ({ label: kind === "devis" ? "Mes devis" : "Mes factures", href: `/dashboard/${kind === "devis" ? "devis" : "factures"}` });
function parseContact(value: unknown): ContactInput {
  const data = strict(value, ["action", "instructionQuote", "reference", "contactId", "fields"]);
  if (!["create", "update", "delete"].includes(String(data.action))) throw new Error("Action CRM invalide.");
  const contactId = data.contactId == null ? null : string(data.contactId, 36, 36);
  if (data.action === "create" ? contactId !== null : !contactId || !COMMERCIAL_UUID.test(contactId)) throw new Error("Référence CRM invalide.");
  const fields = strict(data.fields, Object.keys(FIELDS));
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue;
    if (key === "important") { if (typeof value !== "boolean") throw new Error("Importance invalide."); continue; }
    fields[key] = string(value, key === "notes" ? 2000 : key.toLowerCase().includes("address") ? 500 : 254);
    if (key === "category" && !["particulier", "professionnel", "collectivite_publique"].includes(String(value)) || key === "contactType" && !["client", "prospect", "fournisseur", "partenaire", "autre"].includes(String(value))) throw new Error("Catégorie CRM invalide.");
    if (key === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) throw new Error("Adresse email invalide.");
  }
  if (data.action === "delete" && Object.values(fields).some(value => value != null)) throw new Error("Une suppression ne modifie pas les champs.");
  return { action: data.action as ContactInput["action"], contactId, fields: fields as ContactFields, instructionQuote: string(data.instructionQuote, 600, 8), reference: string(data.reference, 180, 2) };
}
function parseDraft(value: unknown): DraftInput {
  const input = strict(value, ["instructionQuote", "clientReference", "draft"]);
  return { instructionQuote: string(input.instructionQuote, 600, 8), clientReference: string(input.clientReference, 180, 2), draft: parseCommercialDocumentDraft(input.draft) };
}
function currentInstruction(message: string, quote: string, action: "create" | "update" | "delete" | "devis" | "facture", reference: string): boolean {
  if (!message.includes(quote)) return false;
  const current = normalize(message.slice(0, 4000).replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm, " "));
  if (!normalize(message).includes(normalize(reference)) || /^(?:comment|pourquoi|explique|how|why|what|where|ou)\b|(?:expli\w*|montr\w*|show|savoir|comprendre).{0,50}(?:comment|how|ou\b|where)\b/.test(current) || /\b(?:ne |n'|n’|sans |do not |don't ).{0,40}(?:supprim|effac|modif|chang|cre|prepar|ajout|enregistr|delete|create|update)/.test(current) || /\b(?:le|ce|un|du) bouton\b|\b(?:erreur|bug|message d.erreur)\b.{0,100}(?:ne marche|ne fonctionne|bloqu|impossible|echec)|\b(?:hier|precedemment|la derniere fois|tu as deja)\b/.test(current)) return false;
  const verbs = action === "delete" ? /\b(?:supprim\w*|effac\w*|retir\w*|delete|remove)\b/ : action === "update" ? /\b(?:modifi\w*|corrig\w*|chang\w*|remplac\w*|mets|mettez|ajout\w*|effac\w*|retir\w*|update|change|edit)\b/ : /\b(?:cree\w*|creer|crea\w*|ajout\w*|enregistr\w*|prepar\w*|redig\w*|fais|faites|create|prepare|draft)\b/;
  const subject = action === "devis" ? /\b(?:devis|quote)\b/ : action === "facture" ? /\b(?:facture|invoice)\b/ : /\b(?:contact|fiche|client|prospect|fournisseur|partenaire|crm)\b/;
  return verbs.test(current) && verbs.test(normalize(quote)) && subject.test(current);
}
function fieldsFromCurrentMessage(fields: ContactFields, message: string): boolean {
  const current = normalize(message);
  for (const [name, value] of Object.entries(fields)) {
    if (value == null) continue;
    if (typeof value === "boolean") { if (!/\b(?:important|prioritaire|etoile)\b/.test(current)) return false; continue; }
    if (value === "") { if (!/\b(?:effac|supprim|retir|vide|clear)\w*/.test(current)) return false; continue; }
    if (["phone", "siret", "postalCode"].includes(name)) { const digits = value.replace(/\D/g, ""); if (!digits || !message.replace(/\D/g, "").includes(digits)) return false; }
    else if (!current.includes(normalize(value.replace(/_/g, " ")))) return false;
  }
  return true;
}
function nativeRequest(source: Request, path: string, method: string, body: unknown, key: string): Request {
  const headers = new Headers({ accept: "application/json", "content-type": "application/json", "idempotency-key": key });
  for (const name of ["cookie", "authorization"]) { const value = source.headers.get(name); if (value) headers.set(name, value); }
  return new Request(new URL(path, source.url), { method, headers, signal: source.signal, ...(body === null ? {} : { body: JSON.stringify(body) }) });
}

export function createInrAssistantCommercialTools(options: {
  request: Request; accountId: string; supabase: Pick<SupabaseClient, "from">; edition: DashboardEdition;
  currentUserMessage: string; actionRequestId: string; canStartWork?: () => boolean; onResult?: (result: InrAssistantCommercialResult) => void;
}) {
  const { request, supabase, accountId, edition, currentUserMessage } = options;
  if (!COMMERCIAL_UUID.test(accountId) || !options.actionRequestId || options.actionRequestId.length > 180) throw new Error("Périmètre commercial invalide.");
  const promises = new Map<string, { signature: string; result: Promise<InrAssistantCommercialResult> }>();
  const fail = (link: InrAssistantCommercialResult["nextAction"], status: InrAssistantCommercialResult["status"] = "unavailable", missingFields?: string[]): InrAssistantCommercialResult => ({ ok: false, status, nextAction: link, ...(missingFields ? { missingFields } : {}), message: status === "not_included" ? "Cet outil n’est pas inclus dans l’offre de l’établissement actif." : status === "needs_instruction" ? "Précisez dans votre demande actuelle l’action et la fiche ou le client concerné. Aucune modification n’a été effectuée." : status === "needs_details" ? "Précisez les données manquantes avant la préparation. Aucun montant, régime de TVA ou renseignement client n’a été inventé." : "L’action ne peut pas être confirmée. Vérifiez son état dans l’outil avant une nouvelle demande." });
  const allowed = async (documents: boolean) => {
    if (request.signal.aborted || options.canStartWork?.() === false) return false;
    const auth = await requireUser();
    if (auth.errorResponse || auth.activeUserId !== accountId) return false;
    const actualEdition = await getDashboardEditionForAccountId(accountId);
    if (documents ? actualEdition !== "founder" : actualEdition === "standard") return false;
    return (await getActiveSubscriptionAccountIds([accountId])).has(accountId);
  };
  const key = (kind: string) => createHash("sha256").update(`${accountId}:${options.actionRequestId}:commercial:${kind}`).digest("hex");
  const once = (kind: string, input: unknown, link: InrAssistantCommercialResult["nextAction"], run: () => Promise<InrAssistantCommercialResult>) => {
    const signature = JSON.stringify(input); const previous = promises.get(kind);
    if (previous) return previous.signature === signature ? previous.result : Promise.resolve(fail(link, "blocked"));
    const result = run().catch(() => fail(link, "unknown")).then(result => { try { options.onResult?.(result); } catch { /* Observers cannot repeat a mutation. */ } return result; });
    promises.set(kind, { signature, result }); return result;
  };
  const contact = async (id: string) => {
    const read = await supabase.from("crm_contacts").select(CONTACT_COLUMNS).eq("user_id", accountId).eq("id", id).maybeSingle();
    if (read.error) throw new Error("La fiche ne peut pas être vérifiée.");
    if (!read.data) return null;
    const data = row(read.data);
    if (data.user_id !== accountId || data.id !== id) throw new Error("La fiche ne peut pas être vérifiée.");
    return data;
  };
  const contactMatches = (saved: Row, reference: string) => normalize([saved.first_name, saved.last_name, saved.company_name].filter(value => typeof value === "string").join(" ")).includes(normalize(reference));
  const uniqueContact = async (id: string, reference: string) => {
    const parts = reference.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(value => value.length > 1).slice(0, 5);
    if (!parts.length) return false;
    const filters = parts.flatMap(part => ["first_name", "last_name", "company_name"].map(column => `${column}.ilike.%${part}%`)).join(",");
    const read = await supabase.from("crm_contacts").select("id,user_id,first_name,last_name,company_name").eq("user_id", accountId).or(filters).limit(8);
    if (read.error || !Array.isArray(read.data) || read.data.length >= 8) return false;
    const matches = read.data.map(row).filter(saved => saved.user_id === accountId && parts.every(part => normalize([saved.first_name, saved.last_name, saved.company_name].join(" ")).includes(normalize(part))));
    return matches.length === 1 && matches[0].id === id;
  };
  const fieldProperties: Record<string, JSONSchema7> = Object.fromEntries(Object.keys(FIELDS).map(field => [field, field === "important" ? { type: ["boolean", "null"] } : { type: ["string", "null"], maxLength: field === "notes" ? 2000 : field.toLowerCase().includes("address") ? 500 : 254 }]));
  fieldProperties.category = { type: ["string", "null"], enum: ["particulier", "professionnel", "collectivite_publique", null] };
  fieldProperties.contactType = { type: ["string", "null"], enum: ["client", "prospect", "fournisseur", "partenaire", "autre", null] };
  const schema = <T>(definition: JSONSchema7, parse: (value: unknown) => T) => jsonSchema<T>(definition, { validate: input => { try { return { success: true, value: parse(input) }; } catch (error) { return { success: false, error: error as Error }; } } });
  return {
    manageCrmContact: tool({ strict: true,
      description: "Créer, modifier ou supprimer UNE fiche iNr’CRM explicitement demandée maintenant (Premium/Founder). Rechercher d’abord une fiche existante via searchCrmContacts ; contactId doit être sa vraie référence et reference son nom cité maintenant. fields=null laisse un champ intact ; chaîne vide efface seulement sur demande explicite. Ne jamais inventer identité, coordonnées, notes ou catégorie. create utilise contactId=null. delete exige tous les champs null et une demande explicite de suppression ; aucun mail/campagne n’est envoyé.",
      inputSchema: schema<ContactInput>({ type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["create", "update", "delete"] }, instructionQuote: { type: "string", minLength: 8, maxLength: 600 }, reference: { type: "string", minLength: 2, maxLength: 180 }, contactId: { type: ["string", "null"], pattern: COMMERCIAL_UUID.source }, fields: { type: "object", additionalProperties: false, properties: fieldProperties, required: Object.keys(FIELDS) } }, required: ["action", "instructionQuote", "reference", "contactId", "fields"] }, parseContact),
      execute: async raw => {
        const input = parseContact(raw);
        if (edition === "standard") return fail(crmLink, "not_included");
        if (!currentInstruction(currentUserMessage, input.instructionQuote, input.action, input.reference) || !fieldsFromCurrentMessage(input.fields, currentUserMessage)) return fail(crmLink, "needs_instruction");
        return once(`contact:${input.action}:${input.contactId || normalize(input.reference)}`, input, crmLink, async () => {
          if (!await allowed(false)) return fail(crmLink, "blocked");
          const previous = input.contactId ? await contact(input.contactId) : null;
          if (input.contactId && (!previous || !contactMatches(previous, input.reference) || !await uniqueContact(input.contactId, input.reference))) return fail(crmLink, "blocked");
          const body: Row = previous ? Object.fromEntries(CONTACT_COLUMNS.split(",").filter(field => field !== "id" && field !== "user_id").map(field => [field, previous[field] ?? (field === "important" ? false : "")])) : {};
          const changedFields: string[] = [];
          for (const [name, value] of Object.entries(input.fields)) if (value != null) { const native = FIELDS[name as keyof ContactFields]; if (body[native] !== value) changedFields.push(name); body[native] = value; }
          if (input.action === "create" && ![body.display_name, body.company_name, body.email, body.phone].some(value => typeof value === "string" && value.trim())) return fail(crmLink, "needs_details", ["Identité du contact"]);
          if (input.action === "create" && !normalize([body.display_name, body.company_name, body.email, body.phone].join(" ")).includes(normalize(input.reference))) return fail(crmLink, "needs_instruction");
          if (input.action === "update" && changedFields.length === 0) return { ok: true, status: "unchanged", id: input.contactId!, nextAction: crmLink, message: "La fiche contient déjà les valeurs demandées. Aucun autre champ n’a été modifié." };
          if (!await allowed(false)) return fail(crmLink, "blocked");
          const native = await import("@/app/api/crm/contacts/route");
          const operationKey = key(`contact:${input.action}:${input.contactId || normalize(input.reference)}`);
          const response = input.action === "delete" ? await native.DELETE(nativeRequest(request, `/api/crm/contacts?id=${encodeURIComponent(input.contactId!)}`, "DELETE", null, operationKey))
            : input.action === "create" ? await native.POST(nativeRequest(request, "/api/crm/contacts", "POST", body, operationKey)) : await native.PUT(nativeRequest(request, "/api/crm/contacts", "PUT", { ...body, id: input.contactId }, operationKey));
          const data = row(await response.json().catch(() => ({})));
          if (!response.ok || data.ok !== true) return fail(crmLink, response.status === 409 ? "blocked" : "unknown");
          const id = input.action === "create" ? String(data.id || "") : input.contactId!;
          if (!COMMERCIAL_UUID.test(id)) return fail(crmLink, "unknown");
          const saved = await contact(id);
          if (input.action === "delete" ? saved !== null : !saved) return fail(crmLink, "unknown");
          if (input.action === "update" && saved && Object.entries(input.fields).some(([field, value]) => value != null && field !== "displayName" && saved[FIELDS[field as keyof ContactFields]] !== value)) return fail(crmLink, "unknown");
          return { ok: true, status: input.action === "create" ? "created" : input.action === "update" ? "updated" : "deleted", id, changedFields, nextAction: crmLink,
            message: input.action === "delete" ? "La fiche demandée a été supprimée du CRM de l’établissement actif." : input.action === "create" ? "La fiche demandée a été enregistrée dans le CRM. Aucun message n’a été envoyé." : "Les champs demandés ont été enregistrés dans le CRM ; les autres informations ont été conservées." };
        });
      },
    }),
    prepareCommercialDocument: tool({ strict: true,
      description: "Enregistrer UN BROUILLON de devis ou facture dans l’outil existant (Founder). Reprendre le client cité maintenant, via sa vraie référence CRM si connue. Prix unitaires HT, quantités et TVA doivent venir de la demande, jamais être inventés ; null demande précision (TVA exonérée peut venir du profil vérifié). Adresse inconnue=null conserve un brouillon incomplet. Aucun numéro officiel, finalisation, paiement, PDF, mail ou envoi n’est produit. Une même demande retrouve le même document.",
      inputSchema: schema<DraftInput>({ type: "object", additionalProperties: false, properties: { instructionQuote: { type: "string", minLength: 8, maxLength: 600 }, clientReference: { type: "string", minLength: 2, maxLength: 180 }, draft: COMMERCIAL_DOCUMENT_DRAFT_SCHEMA }, required: ["instructionQuote", "clientReference", "draft"] }, parseDraft),
      execute: async raw => {
        const input = parseDraft(raw); const link = draftLink(input.draft.kind);
        if (edition !== "founder") return fail(link, "not_included");
        if (!currentInstruction(currentUserMessage, input.instructionQuote, input.draft.kind, input.clientReference)) return fail(link, "needs_instruction");
        const current = normalize(currentUserMessage);
        if (input.draft.notes && !current.includes(normalize(input.draft.notes))) return fail(link, "needs_instruction");
        const amounts = new Set((current.match(/\d+(?:[.,]\d+)?/g) || []).map(value => Number(value.replace(",", "."))));
        if (input.draft.lines.some(line => line.qty !== null && !amounts.has(line.qty) && !(line.qty === 1 && /\b(?:un|une|one) (?:prestation|article|produit|jour|heure|intervention|service|item)\b/.test(current)) || line.unitPrice !== null && (!amounts.has(line.unitPrice) || !/\bht\b|hors taxes/.test(current)) || line.vatRate !== null && !new RegExp(`(?:tva|vat|taxe).{0,30}${String(line.vatRate).replace(".", "[.,]")}(?:\\s*%|\\b)`).test(current))) return fail(link, "needs_details", ["Quantités, prix unitaires HT et taux de TVA confirmés"]);
        return once(`document:${input.draft.kind}`, input, link, async () => {
          if (!await allowed(true)) return fail(link, "blocked");
          if (input.draft.client.contactId) {
            const saved = await contact(input.draft.client.contactId);
            if (!saved || !contactMatches(saved, input.clientReference) || !await uniqueContact(input.draft.client.contactId, input.clientReference)) return fail(link, "blocked");
            for (const [field, actual] of Object.entries({ name: [saved.company_name, [saved.first_name, saved.last_name].filter(Boolean).join(" ")], email: [saved.email], address: [saved.billing_address, saved.address], postalCode: [saved.postal_code], city: [saved.city] })) {
              const value = input.draft.client[field as keyof CommercialDocumentDraftInput["client"]];
              if (typeof value === "string" && !actual.some(item => typeof item === "string" && normalize(item) === normalize(value)) && !current.includes(normalize(value))) return fail(link, "needs_instruction");
            }
          }
          else if (!input.draft.client.name || !normalize(input.draft.client.name).includes(normalize(input.clientReference)) || !current.includes(normalize(input.draft.client.name))) return fail(link, "needs_details", ["Nom du client"]);
          if (!input.draft.client.contactId && !fieldsFromCurrentMessage({ email: input.draft.client.email, address: input.draft.client.address, postalCode: input.draft.client.postalCode, city: input.draft.client.city, category: input.draft.client.type === "institution" ? "collectivite_publique" : input.draft.client.type }, currentUserMessage)) return fail(link, "needs_instruction");
          const { POST } = await import("@/app/api/documents/drafts/route");
          const response = await POST(nativeRequest(request, "/api/documents/drafts", "POST", input.draft, key(`document:${input.draft.kind}`)));
          const data = row(await response.json().catch(() => ({})));
          const allowedMissing = new Set(["Nom du client", "Type de client", "Adresse de facturation", "Code postal", "Ville", "Date d’échéance", "Validité du devis", "Numéro du devis", "Informations légales du prestataire", "Quantité de chaque ligne", "Prix unitaire HT de chaque ligne", "Taux de TVA de chaque ligne", "Régime de TVA (profil exonéré)"]);
          const missing = Array.isArray(data.missingFields) ? data.missingFields.filter((value): value is string => typeof value === "string" && allowedMissing.has(value)).slice(0, 12) : [];
          if (!response.ok || data.ok !== true || !COMMERCIAL_UUID.test(String(data.id)) || data.kind !== input.draft.kind || data.status !== "brouillon") return fail(link, response.status === 422 ? "needs_details" : response.status === 409 ? "blocked" : "unknown", missing);
          return { ok: true, status: data.incomplete === true ? "incomplete_draft" : "draft", id: String(data.id), kind: input.draft.kind, missingFields: missing,
            nextAction: { ...link, href: `${link.href}/new?saveId=${data.id}` }, message: data.incomplete === true ? "Le brouillon a été enregistré avec des informations restant à compléter et des paramètres par défaut à vérifier dans l’outil. Aucun numéro officiel, envoi ou paiement n’a été effectué." : "Le brouillon a été enregistré dans l’outil. Vérifiez-le avant toute finalisation ; aucun numéro officiel, envoi ou paiement n’a été effectué." };
        });
      },
    }),
  };
}
