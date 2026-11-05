import "server-only";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";
import { assistantActionFingerprint } from "./inrAssistantActionPreview.ts";
import { BUSINESS_IDENTITY_COLUMNS, BUSINESS_IDENTITY_FIELDS, BUSINESS_IDENTITY_PROFILE_SELECT, normalizeBusinessIdentityChange, normalizeBusinessProfession, projectBusinessIdentity } from "./businessIdentity.ts";
import { searchActivityJobs } from "./activityJobSearch.ts";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { isInrAssistantBusinessIdentityRequest } from "./inrAssistantBasicTargetIntents.ts";

type Row = Record<string, unknown>;
type Change = { field: string; value: string | boolean };
type UpdateInput = { section: "profile" | "activity"; expectedVersion: string; changes: Change[]; instructionQuote: string };
const link = { label: "Mon entreprise", href: "/dashboard/personnalisation?section=company" };
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
function strict(value: unknown, keys: string[]) {
  const input = row(value);
  if (Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key))) throw new Error("Demande d’identité invalide.");
  return input;
}
function parseUpdate(value: unknown): UpdateInput {
  const input = strict(value, ["section", "expectedVersion", "changes", "instructionQuote"]);
  if (!["profile", "activity"].includes(String(input.section)) || typeof input.expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedVersion)
      || typeof input.instructionQuote !== "string" || !input.instructionQuote.trim() || input.instructionQuote.length > 1200 || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 18) throw new Error("Modification d’identité invalide.");
  const seen = new Set<string>();
  const changes = input.changes.map(value => {
    const change = strict(value, ["field", "value"]);
    const allowed = input.section === "activity" ? ["sectorCategory", "profession"] : BUSINESS_IDENTITY_FIELDS;
    if (typeof change.field !== "string" || !allowed.includes(change.field as never) || seen.has(change.field) || !["string", "boolean"].includes(typeof change.value)) throw new Error("Champ d’identité invalide.");
    seen.add(change.field);
    return { field: change.field, value: change.value as string | boolean };
  });
  return { section: input.section as UpdateInput["section"], expectedVersion: input.expectedVersion, instructionQuote: input.instructionQuote.trim(), changes };
}
function authorized(message: string, quote: string) {
  return matchesInrAssistantActionClause(message, quote, (clause, exact) => isInrAssistantBusinessIdentityRequest(clause, exact));
}
/** Scoped adapters to the public profile and activity records used by native forms.
 * A whole section is versioned and re-read. Profile and activity are separate writes. */
export function createInrAssistantBusinessIdentityTools(options: { request: Request; accountId: string; actorUserId: string; edition: DashboardEdition; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; canStartWork?: () => boolean }) {
  const { accountId, actorUserId, request, supabase } = options;
  const once = new Map<string, Promise<Row>>();
  const fail = (status: string, message: string): Row => ({ ok: false, status, message, nextAction: link });
  const scope = async () => {
    if (request.signal.aborted || options.canStartWork?.() === false) return false;
    const auth = await requireUser();
    return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId;
  };
  const read = async () => {
    if (!await scope()) throw new Error("Le compte actif a changé.");
    const [profile, business] = await Promise.all([
      supabase.from("profiles").select(BUSINESS_IDENTITY_PROFILE_SELECT).eq("user_id", accountId).maybeSingle(),
      supabase.from("business_profiles").select("user_id,sector").eq("user_id", accountId).maybeSingle(),
    ]);
    if (profile.error || business.error || profile.data && row(profile.data).user_id !== accountId || business.data && row(business.data).user_id !== accountId) throw new Error("Les coordonnées ne sont pas disponibles.");
    const projected = projectBusinessIdentity(profile.data, business.data);
    return { profile: row(profile.data), business: row(business.data), projected,
      profileVersion: assistantActionFingerprint(projected.fields), activityVersion: assistantActionFingerprint(projected.activity) };
  };
  return {
    readBusinessIdentity: tool({ strict: true, description: "Lire les coordonnées publiques de l’entreprise, l’identité, le métier et les champs bloquant Badge/Search/Annuaire. Retourne les versions profileVersion/activityVersion à fournir avant modification. Données du seul établissement actif ; ce n’est pas une lecture des identifiants de connexion.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }),
      execute: async raw => { strict(raw, []); try { const state = await read(); return { ok: true, status: "read", ...state.projected, profileVersion: state.profileVersion, activityVersion: state.activityVersion, untrustedContent: true, nextAction: link, message: "Les coordonnées et le métier de l’entreprise active ont été lus. Aucune information n’a été modifiée." }; } catch { return fail("unavailable", "Les informations de l’entreprise n’ont pas pu être vérifiées."); } } }),
    searchBusinessProfessions: tool({ strict: true, description: "Rechercher le métier dans le même catalogue que Mon entreprise. Réutiliser les codes sectorCategory/job et les libellés trouvés ; ne pas inventer un métier. Cette recherche ne modifie rien.",
      inputSchema: jsonSchema<{ query: string }>({ type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 120 } }, required: ["query"], additionalProperties: false }),
      execute: async raw => { const input = strict(raw, ["query"]); if (typeof input.query !== "string" || input.query.trim().length < 2 || input.query.length > 120) throw new Error("Recherche invalide."); if (!await scope()) return fail("blocked", "Le compte actif a changé."); return { ok: true, status: "read", professions: searchActivityJobs(input.query, 8), nextAction: link, message: "Les métiers correspondants ont été recherchés dans le catalogue natif. Aucun métier n’a été sélectionné." }; } }),
    updateBusinessIdentity: tool({ strict: true, description: "Enregistrer seulement les coordonnées/identité ou le métier explicitement demandés maintenant. Lire readBusinessIdentity avant. section=profile : champs publics (companyName, firstName, lastName, contactEmail, phone, address, postalCode, city, country, identité juridique, logoPath déjà importé du compte) avec profileVersion. section=activity : sectorCategory et profession du catalogue avec activityVersion ; conserve les prestations et autres rubriques. Une section par appel. Aucun identifiant de connexion, compte bancaire, droit, abonnement ou OAuth. Relit le résultat et actualise les surfaces publiques ; n’invente jamais une valeur manquante.",
      inputSchema: jsonSchema<UpdateInput>({ type: "object", properties: {
        section: { type: "string", enum: ["profile", "activity"] }, expectedVersion: { type: "string", pattern: "^[a-f0-9]{64}$" }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 },
        changes: { type: "array", minItems: 1, maxItems: 18, items: { type: "object", properties: { field: { type: "string", enum: [...BUSINESS_IDENTITY_FIELDS, "sectorCategory", "profession"] }, value: { type: ["string", "boolean"], maxLength: 500 } }, required: ["field", "value"], additionalProperties: false } },
      }, required: ["section", "expectedVersion", "changes", "instructionQuote"], additionalProperties: false }, { validate: value => { try { return { success: true, value: parseUpdate(value) }; } catch (error) { return { success: false, error: error as Error }; } } }),
      execute: async raw => {
        const input = parseUpdate(raw);
        if (!authorized(options.currentUserMessage, input.instructionQuote)) return fail("needs_instruction", "Précisez les coordonnées ou le métier à enregistrer dans votre demande actuelle.");
        const key = JSON.stringify(input);
        if (once.has(key)) return once.get(key)!;
        const operation = (async (): Promise<Row> => {
          let dispatched = false;
          try {
            const before = await read();
            const patch: Row = {}; const requested: Row = {};
            if (input.section === "profile") {
              for (const change of input.changes) {
                const value = normalizeBusinessIdentityChange(change.field, change.value, accountId);
                requested[change.field] = value; patch[BUSINESS_IDENTITY_COLUMNS[change.field as keyof typeof BUSINESS_IDENTITY_COLUMNS]] = value;
              }
              // Mirror the native legal form's dependent-field normalization.
              if (patch.capital_dispense_ei === true) { patch.capital_social = ""; requested.capitalSocial = ""; }
              if (patch.vat_dispense === true) { patch.vat_number = ""; requested.vatNumber = ""; }
              if (typeof patch.legal_form === "string" && patch.legal_form !== "AUTRE") { patch.legal_form_other = ""; requested.legalFormOther = ""; }
              if (Object.hasOwn(patch, "logo_path")) {
                if (patch.logo_path) {
                  const { GET } = await import("@/app/api/profile/logo/route");
                  const headers = new Headers(request.headers);
                  const verifiedLogo = await GET(new Request(`https://inrcy.local/api/profile/logo?path=${encodeURIComponent(String(patch.logo_path))}`, { headers, signal: request.signal }));
                  const logo = row(await verifiedLogo.json());
                  if (!verifiedLogo.ok || logo.ok !== true || logo.path !== patch.logo_path || typeof logo.displayUrl !== "string") return fail("invalid_settings", "Ce logo importé n’a pas pu être vérifié.");
                  patch.logo_url = logo.displayUrl;
                } else { patch.logo_path = null; patch.logo_url = null; }
              }
            } else {
              const changes = Object.fromEntries(input.changes.map(change => [change.field, change.value]));
              if (typeof changes.sectorCategory !== "string" || typeof changes.profession !== "string") return fail("needs_details", "Choisissez ensemble le secteur et le métier exacts.");
              const profession = normalizeBusinessProfession(changes.sectorCategory, changes.profession);
              patch.sector = profession.sector; requested.sectorCategory = profession.sectorCategory; requested.professionLabel = profession.professionLabel;
            }
            const current = input.section === "profile" ? before.projected.fields : before.projected.activity;
            if (Object.entries(requested).every(([field, value]) => current[field as keyof typeof current] === value)) return { ok: true, status: "already_applied", changedFields: [], message: "L’entreprise contient déjà les valeurs demandées. Aucune nouvelle écriture n’a été effectuée.", nextAction: link };
            if ((input.section === "profile" ? before.profileVersion : before.activityVersion) !== input.expectedVersion) return fail("stale_preview", "Les informations ont changé. Relisez l’entreprise avant de modifier cette section.");
            if (!await scope()) return fail("blocked", "Le compte actif a changé.");
            const table = input.section === "profile" ? "profiles" : "business_profiles", source = input.section === "profile" ? before.profile : before.business;
            let saved;
            dispatched = true;
            if (!Object.keys(source).length) saved = await supabase.from(table).insert({ user_id: accountId, ...patch }).select("user_id").maybeSingle();
            else {
              let query = supabase.from(table).update(patch).eq("user_id", accountId);
              const columns = input.section === "profile" ? Object.values(BUSINESS_IDENTITY_COLUMNS) : ["sector"];
              for (const column of columns) query = source[column] == null ? query.is(column, null) : query.eq(column, source[column]);
              saved = await query.select("user_id").maybeSingle();
            }
            if (saved.error || saved.data?.user_id !== accountId) return fail("stale_preview", "La section n’a pas été enregistrée : elle a pu changer pendant l’opération. Relisez-la avant de reprendre.");
            const after = await read(), actual = input.section === "profile" ? after.projected.fields : after.projected.activity;
            if (!Object.entries(requested).every(([field, value]) => actual[field as keyof typeof actual] === value)) return fail("saved_unconfirmed", "L’écriture a été demandée, mais sa relecture ne confirme pas toutes les valeurs. Vérifiez Mon entreprise avant toute nouvelle modification.");
            const { POST } = await import("@/app/api/public-profile/refresh/route");
            const refreshed = await POST();
            const refresh = row(await refreshed.json());
            const { invalidateBoosterGenerationContext } = await import("@/lib/boosterGenerationContext");
            await invalidateBoosterGenerationContext(accountId, "professional").catch(() => undefined);
            return { ok: true, status: "updated", changedFields: Object.keys(requested), applied: requested, ...after.projected, profileVersion: after.profileVersion, activityVersion: after.activityVersion,
              publicRefreshPending: !refreshed.ok || refresh.ok !== true, nativeChannels: refresh.nativeChannels ?? null, nextAction: link,
              message: refreshed.ok && refresh.ok === true ? "Les informations demandées ont été enregistrées, relues et les surfaces publiques actualisées." : "Les informations demandées ont été enregistrées et relues. L’actualisation des fiches publiques reste à vérifier." };
          } catch { return fail(dispatched ? "unknown" : "invalid_settings", dispatched ? "Le résultat de la modification n’a pas pu être confirmé. Vérifiez Mon entreprise avant de reprendre." : "Les champs ou valeurs demandés ne respectent pas les formats de Mon entreprise."); }
        })();
        once.set(key, operation); return operation;
      } }),
  };
}
