import "server-only";
import { matchesInrAssistantActionClause, inrAssistantMaskQuotedText } from "./inrAssistantActionClause.ts";

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
  inputIssue?: "exact_instruction_quote_required" | "unrequested_fields" | "current_instruction_not_authorized" | "invalid_tool_input";
  noEffect?: true; retryableInput?: true; invalidFields?: string[];
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
  if (data.action === "create" && data.contactId !== null) throw new Error("Pour créer une fiche, contactId doit être null, jamais une chaîne vide ou un identifiant inventé.");
  const contactId = data.contactId == null ? null : string(data.contactId, 36, 36);
  if (data.action === "create" ? contactId !== null : !contactId || !COMMERCIAL_UUID.test(contactId)) throw new Error("Référence CRM invalide : update/delete exige le contactId UUID d’une fiche réellement lue ; create exige null.");
  const fields = strict(data.fields, Object.keys(FIELDS));
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue;
    if (key === "important") { if (typeof value !== "boolean") throw new Error("Importance invalide."); continue; }
    fields[key] = string(value, key === "notes" ? 2000 : key.toLowerCase().includes("address") ? 500 : 254);
    if (key === "category" && !["particulier", "professionnel", "collectivite_publique"].includes(String(value))) throw new Error("fields.category : particulier, professionnel, collectivite_publique ou null, en minuscules exactes.");
    if (key === "contactType" && !["client", "prospect", "fournisseur", "partenaire", "autre"].includes(String(value))) throw new Error("fields.contactType : client, prospect, fournisseur, partenaire, autre ou null, en minuscules exactes (jamais Client).");
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
  return matchesInrAssistantActionClause(message,quote,(clause,exact)=>currentInstructionClause(clause,exact,action,reference));
}
function currentInstructionClause(message: string, quote: string, action: "create" | "update" | "delete" | "devis" | "facture", reference: string): boolean {
  if (!message.includes(quote)) return false;
  const current = normalize(inrAssistantMaskQuotedText(message.slice(0, 4000)));
  const verbs = action === "delete" ? /\b(?:supprim\w*|effac\w*|retir\w*|delete|remove)\b/ : action === "update" ? /\b(?:modifi\w*|corrig\w*|chang\w*|remplac\w*|renomm\w*|mets|mettez|ajout\w*|effac\w*|retir\w*|update|change|edit|rename)\b/ : /\b(?:cree\w*|creer|crea\w*|ajout\w*|enregistr\w*|prepar\w*|redig\w*|fais|faites|create|prepare|draft)\b/;
  // Every accepted action verb must also participate in the veto. Keeping one
  // vocabulary prevents a new paraphrase from bypassing a negative instruction.
  const negative = new RegExp(`(?:\\b(?:ne|pas|jamais|sans|not|never|without|do not)\\b|\\bn['’]|don't).{0,45}${verbs.source}|${verbs.source}.{0,20}\\b(?:pas|jamais|not|never|rien|nothing)\\b`);
  if (!normalize(message).includes(normalize(reference)) || /^(?:comment|pourquoi|explique|how|why|what|where|ou)\b|(?:expli\w*|montr\w*|show|savoir|comprendre).{0,50}(?:comment|how|ou\b|where)\b/.test(current) || negative.test(current) || /\b(?:le|ce|un|du) bouton\b|\b(?:erreur|bug|message d.erreur)\b.{0,100}(?:ne marche|ne fonctionne|bloqu|impossible|echec)|\b(?:hier|precedemment|la derniere fois|tu as deja)\b/.test(current)) return false;
  const subject = action === "devis" ? /\b(?:devis|quote)\b/ : action === "facture" ? /\b(?:facture|invoice)\b/ : /\b(?:contact|fiche|client|prospect|fournisseur|partenaire|crm)\b|\bcarnet (?:d['’]adresses|de clients|clients)\b/;
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
const CRM_UPDATE_TARGETS: Record<keyof ContactFields, string> = {
  displayName: "(?:nom|prenom|identite|name)", companyName: "(?:entreprise|societe|raison sociale|company)",
  email: "(?:(?:e-?)?mail|courriel|adresse electronique)", phone: "(?:telephone|numero|mobile|portable|phone)",
  address: "(?:adresse(?! (?:de )?(?:facturation|livraison))|address)", billingAddress: "(?:facturation|billing)", deliveryAddress: "(?:livraison|delivery)",
  postalCode: "(?:code postal|postal|zip)", city: "(?:ville|city)", siret: "siret", vatNumber: "(?:tva|vat)",
  category: "(?:categorie|category)", contactType: "(?:type|statut)", notes: "(?:notes?|commentaires?)", important: "(?:important|prioritaire|etoile)",
};
function explicitlyUpdatesField(message: string, field: keyof ContactFields, reference: string): boolean {
  const current = normalize(inrAssistantMaskQuotedText(message));
  if (field === "displayName") {
    if (/\b(?:renomm\w*|rename)\b/.test(current)) return true;
    const escapedReference = normalize(reference).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b(?:remplac\\w*|replace)\\s+(?:(?:la fiche|le contact)\\s+)?(?:${escapedReference}\\s+)?(?:par|by|with)\\b`).test(current)) return true;
  }
  const verbs = "(?:modifi\\w*|corrig\\w*|chang\\w*|remplac\\w*|mets|mettez|ajout\\w*|effac\\w*|retir\\w*|update|change|edit)";
  return new RegExp(`\\b${verbs}\\b(?:(?![;.!?]|\\b(?:sans|ne|mais|without|not)\\b).){0,120}\\b${CRM_UPDATE_TARGETS[field]}\\b`).test(current);
}
/** A value supplied for another contact or in an explanation is not a field order.
 * Retain original bytes for quoted names and coordinates; split only unquoted directives. */
function currentContactInstruction(message: string, input: ContactInput): boolean {
  return matchesInrAssistantActionClause(message, input.instructionQuote, (current, quote) => {
    if (!current.includes(quote)) return false;
    const masked = inrAssistantMaskQuotedText(current);
    const directive = "(?:cr[ée]e\\w*|ajout\\w*|enregistr\\w*|pr[ée]par\\w*|modifi\\w*|corrig\\w*|chang\\w*|remplac\\w*|renomm\\w*|supprim\\w*|effac\\w*|retir\\w*|explique\\w*|create|add|update|delete|remove|rename|explain)";
    const boundary = new RegExp(`(?:[,;.!?]\\s+|\\s+(?:et|puis|ensuite|and|then)\\s+)(?=${directive}\\b)`, "gi");
    const clauses: string[] = [];
    let start = 0;
    for (const match of masked.matchAll(boundary)) { clauses.push(current.slice(start, match.index).trim()); start = match.index! + match[0].length; }
    clauses.push(current.slice(start).trim());
    const matching = clauses.filter(clause => currentInstructionClause(clause, clause, input.action, input.reference));
    if (matching.length !== 1) return false;
    let fieldScope = matching[0];
    let sharedContactType: ContactFields["contactType"];
    if (/\b(?:deux|trois|quatre|cinq|plusieurs|two|three|multiple|[2-9])\s+(?:contacts?|fiches?|clients?|prospects?)\b/.test(normalize(fieldScope))) {
      const data = inrAssistantMaskQuotedText(fieldScope);
      const headerEnd = data.search(/[:;]/);
      if (input.action === "create" && headerEnd >= 0) {
        const header = normalize(data.slice(0, headerEnd));
        const types = new Set([...header.matchAll(/\b(clients?|prospects?|fournisseurs?|partenaires?|autres?)\b/g)].map(match => match[1].replace(/s$/, "")));
        if (types.size === 1) sharedContactType = [...types][0] as NonNullable<ContactFields["contactType"]>;
      }
      const groups: string[] = []; let from = 0;
      for (const match of data.matchAll(/[:;]\s*|\s+(?:et|and)\s+/gi)) { groups.push(fieldScope.slice(from, match.index).trim()); from = match.index! + match[0].length; }
      groups.push(fieldScope.slice(from).trim());
      const targets = groups.filter(group => normalize(group).includes(normalize(input.reference)));
      if (targets.length !== 1) return false;
      fieldScope = targets[0];
      if (input.fields.email && new Set(fieldScope.match(/[^\s,;<>"'@]+@[^\s,;<>"'@]+/g)).size > 1) return false;
    }
    if (input.action === "update" && Object.entries(input.fields).some(([field, value]) => value != null && !explicitlyUpdatesField(fieldScope, field as keyof ContactFields, input.reference))) return false;
    const scopedFields = sharedContactType && input.fields.contactType === sharedContactType ? { ...input.fields, contactType: null } : input.fields;
    return fieldsFromCurrentMessage(scopedFields, fieldScope);
  });
}
/** Pure, shared with the synthetic-model bench. A prior read never authorizes
 * writing those fields back. The native executor applies this before any I/O. */
export function getInrAssistantCrmInstructionRefusal(message: string, raw: unknown): InrAssistantCommercialResult | null {
  let input: ContactInput;
  try { const supplied = row(raw); input = parseContact({ ...supplied, fields: { ...row(supplied.fields) } }); }
  catch { return { ok: false, status: "needs_instruction", inputIssue: "invalid_tool_input", noEffect: true, nextAction: crmLink, message: "Les paramètres CRM ne respectent pas le contrat. Conservez les clés prévues, les identifiants lus et null pour les champs non demandés. Rien exécuté." }; }
  if (!message.includes(input.instructionQuote)) return {
    ok: false, status: "needs_instruction", inputIssue: "exact_instruction_quote_required", noEffect: true, retryableInput: true, nextAction: crmLink,
    message: "instructionQuote doit recopier un extrait EXACT du dernier message, sans changer le verbe ni reformuler. Reprenez la consigne originale ; aucune fiche n’a été modifiée.",
  };
  if (currentContactInstruction(message, input)) return null;
  const emptyFields = Object.fromEntries(Object.keys(FIELDS).map(field => [field, null]));
  if (currentContactInstruction(message, { ...input, fields: emptyFields })) {
    const invalidFields = Object.entries(input.fields).filter(([field, value]) => value != null && !currentContactInstruction(message, { ...input, fields: { ...emptyFields, [field]: value } })).map(([field]) => field);
    return { ok: false, status: "needs_instruction", inputIssue: "unrequested_fields", noEffect: true, retryableInput: true, invalidFields, nextAction: crmLink,
      message: `Ces champs ne sont pas autorisés par la consigne actuelle : ${invalidFields.join(", ")}. Mettez leurs valeurs à null pour conserver l’existant, même après readCrmContact. Envoyez uniquement les changements explicitement demandés avec la citation exacte. Aucune fiche n’a été modifiée.` };
  }
  return { ok: false, status: "needs_instruction", inputIssue: "current_instruction_not_authorized", noEffect: true, nextAction: crmLink, message: "La consigne actuelle n’autorise pas cette action sur cette fiche. Une citation, une condition ou une validation future ne donne pas d’autorisation. Rien exécuté." };
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
  for(const field of Object.values(fieldProperties)) field.description="null si ce champ n’est pas explicitement demandé. Pour update, null conserve l’existant : ne recopier aucune valeur de readCrmContact pour un champ que le pro n’a pas demandé de modifier. La clé est obligatoire, pas sa valeur.";
  fieldProperties.category.description += " Valeurs en minuscules exactes : particulier, professionnel, collectivite_publique ou null.";
  fieldProperties.contactType.description += " Valeurs en minuscules exactes : client, prospect, fournisseur, partenaire, autre ou null ; jamais Client.";
  const schema = <T>(definition: JSONSchema7, parse: (value: unknown) => T) => jsonSchema<T>(definition, { validate: input => { try { return { success: true, value: parse(input) }; } catch (error) { return { success: false, error: error as Error }; } } });
  return {
    manageCrmContact: tool({ strict: true,
      description: "Créer, modifier ou supprimer UNE fiche iNr’CRM explicitement demandée maintenant (Premium). Rechercher d’abord une fiche existante via searchCrmContacts. Pour create, contactId=null ; le nom fourni suffit, tous les champs non fournis sont null. Pour update, renseigner UNIQUEMENT le champ demandé : téléphone seul ⇒ phone=valeur, tous les autres fields=null, même après lecture de la fiche. null conserve l’existant ; ne pas renvoyer son email, ses notes ou son nom pour les préserver. Chaîne vide efface seulement sur demande explicite. contactId est l’UUID réellement lu, reference le nom actuel. instructionQuote est un extrait exact, jamais reformulé. delete exige tous les champs null ; aucun envoi.",
      inputSchema: schema<ContactInput>({ type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["create", "update", "delete"] }, instructionQuote: { type: "string", minLength: 8, maxLength: 600 }, reference: { type: "string", minLength: 2, maxLength: 180 }, contactId: { type: ["string", "null"], pattern: COMMERCIAL_UUID.source }, fields: { type: "object", additionalProperties: false, properties: fieldProperties, required: Object.keys(FIELDS) } }, required: ["action", "instructionQuote", "reference", "contactId", "fields"] }, parseContact),
      execute: async raw => {
        const input = parseContact(raw);
        if (edition === "standard") return fail(crmLink, "not_included");
        const instructionRefusal = getInrAssistantCrmInstructionRefusal(currentUserMessage, input);
        if (instructionRefusal) return instructionRefusal;
        return once(`contact:${input.action}:${input.contactId || normalize(input.reference)}`, input, crmLink, async () => {
          if (!await allowed(false)) return fail(crmLink, "blocked");
          const previous = input.contactId ? await contact(input.contactId) : null;
          if (input.contactId && (!previous || !contactMatches(previous, input.reference) || !await uniqueContact(input.contactId, input.reference))) return fail(crmLink, "blocked");
          const body: Row = previous ? Object.fromEntries(CONTACT_COLUMNS.split(",").filter(field => field !== "id" && field !== "user_id").map(field => [field, previous[field] ?? (field === "important" ? false : "")])) : {};
          const changedFields: string[] = [];
          for (const [name, value] of Object.entries(input.fields)) if (value != null) { const native = FIELDS[name as keyof ContactFields]; if (body[native] !== value) changedFields.push(name); body[native] = value; }
          // The native display_name parser owns both name components. Sending
          // legacy first/last values as fallbacks would duplicate an old name.
          // A phone-only update keeps those values exactly as they were read.
          if (input.action === "update" && input.fields.displayName != null) { body.first_name = ""; body.last_name = ""; }
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
      description: "Enregistrer UN BROUILLON de devis ou facture dans l’outil existant (droits comptables requis). Reprendre le client cité maintenant, via sa vraie référence CRM si connue. Prix unitaires HT, quantités et TVA doivent venir de la demande, jamais être inventés ; null demande précision (TVA exonérée peut venir du profil vérifié). Adresse inconnue=null conserve un brouillon incomplet. Aucun numéro officiel, finalisation, paiement, PDF, mail ou envoi n’est produit. Une même demande retrouve le même document.",
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
