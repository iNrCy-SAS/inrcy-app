import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";
import { assistantActionFingerprint } from "./inrAssistantActionPreview.ts";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
import { getGeneratorRecommendation, sanitizeGeneratorBusinessSettings } from "./generatorSettings.ts";
type Row = Record<string, unknown>;
type Field = "avgBasket" | "conversionRate";
const COLUMNS = { avgBasket: "avg_basket", conversionRate: "lead_conversion_rate" } as const;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
const schema = (properties: Record<string, JSONSchema7>): JSONSchema7 => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const link = { label: "Réglages des estimations du Générateur", href: "/dashboard?helpAction=generator-settings" };
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides."); return input; }
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function numbers(value: string) {
  const text = value.replace(/(?<=\d)[ \u00a0\u202f](?=\d{3}(?:\D|$))/g, "");
  return [...text.matchAll(/(?<![\p{L}\d])[-+]?\d+(?:[.,]\d+)?(?![\p{L}\d])/gu)].map(match => Number(match[0].replace(",", ".")));
}
function authorized(message: string, quote: string) {
  const current = normalize(inrAssistantMaskQuotedText(message)), directive = normalize(inrAssistantMaskQuotedText(quote));
  return Boolean(quote && quote.length <= 1200 && message.includes(quote))
    && !/\b(?:comment|pourquoi|explique|si|quand|lorsque|demain|plus tard)\b|\bne\b.{0,60}\bpas\b|\b(?:modifie|change|enregistre|mets|definis|regle)\s+pas\b/.test(current)
    && /\b(?:modifie|modifier|change|changer|enregistre|enregistrer|mets|definis|definir|regle|regler|configure|configurer)\b/.test(directive)
    && /\b(?:panier|transformation|conversion|generateur|roi|estimations?|projections?)\b/.test(directive);
}
/** The native Generator modal's two business assumptions; never a revenue promise. */
export function createInrAssistantGeneratorSettingsTools(options: { request: Request; accountId: string; actorUserId: string; supabase: Pick<SupabaseClient, "from">; edition: DashboardEdition; currentUserMessage: string; canStartWork?: () => boolean }) {
  const { request, accountId, actorUserId, supabase } = options, attempts = new Map<string, Promise<Row>>();
  const fail = (status: string, message: string): Row => ({ ok: false, status, message, nextAction: link });
  const scope = async () => { if (request.signal.aborted || options.canStartWork?.() === false) return false; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId; };
  const read = async () => {
    if (!await scope()) throw new Error("Compte actif modifié.");
    const [profile, business] = await Promise.all([
      supabase.from("profiles").select("user_id,avg_basket,lead_conversion_rate").eq("user_id", accountId).maybeSingle(),
      supabase.from("business_profiles").select("sector").eq("user_id", accountId).maybeSingle(),
    ]);
    if (profile.error || business.error || profile.data && profile.data.user_id !== accountId) throw new Error("Hypothèses indisponibles.");
    const source = row(profile.data), recommendation = getGeneratorRecommendation(typeof business.data?.sector === "string" ? business.data.sector : null), settings = sanitizeGeneratorBusinessSettings(source.avg_basket, source.lead_conversion_rate, recommendation);
    const stored = { avgBasket: source.avg_basket ?? null, conversionRate: source.lead_conversion_rate ?? null };
    return { source, recommendation, settings, stored, version: assistantActionFingerprint(stored) };
  };
  return {
    readGeneratorBusinessSettings: tool({ strict: true, description: "Lire les deux hypothèses métier du Générateur/ROI accessibles en Basique : panier moyen en euros et taux de transformation en pourcentage. Retourne les valeurs affichées par le modal natif, les valeurs enregistrées, les repères indicatifs du secteur et une version avant modification. Ce sont des hypothèses d’estimation, jamais du chiffre d’affaires réalisé ou garanti.", inputSchema: jsonSchema<Record<string, never>>(schema({})), execute: async raw => {
      fields(raw, []); try { const current = await read(); return { ok: true, status: "read", settings: current.settings, stored: current.stored, recommendation: current.recommendation, version: current.version, nextAction: link, assumptionOnly: true, message: "Les hypothèses enregistrées et les repères indicatifs du Générateur ont été lus. Ce sont des paramètres d’estimation, pas du chiffre d’affaires garanti." }; } catch { return fail("unavailable", "Les hypothèses du Générateur n’ont pas pu être lues."); }
    } }),
    updateGeneratorBusinessSettings: tool({ strict: true, description: "Enregistrer les hypothèses Générateur explicitement chiffrées par le pro maintenant : avgBasket>0 (euros), conversionRate>0 et <=100 (pourcentage). Utilise sanitizeGeneratorBusinessSettings natif et son arrondi à deux décimales. Préserve la valeur omise et les autres données du profil. Vérifie la version, écrit avec contrôle concurrent puis relit exactement les valeurs. Aucune promesse de CA ou de performance.",
      inputSchema: jsonSchema<{ expectedVersion: string; changes: Array<{ field: Field; value: number }>; instructionQuote: string }>(schema({ expectedVersion: { type: "string", pattern: "^[a-f0-9]{64}$" }, changes: { type: "array", minItems: 1, maxItems: 2, items: schema({ field: { type: "string", enum: ["avgBasket", "conversionRate"] }, value: { type: "number", exclusiveMinimum: 0 } }) }, instructionQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["expectedVersion", "changes", "instructionQuote"]), quote = str(input.instructionQuote);
        if (!/^[a-f0-9]{64}$/.test(str(input.expectedVersion)) || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 2) return fail("invalid_settings", "Hypothèses Générateur invalides.");
        if (!authorized(options.currentUserMessage, quote)) return fail("needs_instruction", "Précisez les hypothèses métier chiffrées à enregistrer dans votre demande actuelle.");
        const key = JSON.stringify(input);
        if (!attempts.has(key)) attempts.set(key, (async () => {
          let dispatched = false;
          try {
            const before = await read(), values = { ...before.settings }, seen = new Set<Field>(), explicitNumbers = numbers(quote), quoteText = normalize(inrAssistantMaskQuotedText(quote));
            for (const change of input.changes as unknown[]) {
              const item = fields(change, ["field", "value"]), field = str(item.field) as Field, value = item.value;
              if (!["avgBasket", "conversionRate"].includes(field) || seen.has(field) || typeof value !== "number" || !Number.isFinite(value) || value <= 0 || field === "conversionRate" && value > 100) return fail("invalid_settings", "Le panier doit être positif et le taux compris entre 0 exclu et 100 inclus.");
              const mentioned = field === "avgBasket" ? /\bpanier(?: moyen)?\b/.test(quoteText) : /\b(?:taux|transformation|conversion)\b/.test(quoteText);
              if (!mentioned || !explicitNumbers.includes(value)) return fail("needs_details", "Indiquez le montant du panier ou le pourcentage de transformation exact à enregistrer.");
              seen.add(field); values[field] = value;
            }
            const normalized = sanitizeGeneratorBusinessSettings(values.avgBasket, values.conversionRate, before.recommendation), patch: Row = {}, applied: Row = {};
            for (const field of seen) { const value = normalized[field]; if (!Number.isFinite(value) || value <= 0) return fail("invalid_settings", "Cette valeur devient nulle ou non finie après l’arrondi natif. Précisez une valeur valide."); patch[COLUMNS[field]] = value; applied[field] = value; }
            if (Object.entries(patch).every(([column, value]) => before.source[column] === value)) return { ok: true, status: "already_applied", settings: before.settings, nextAction: link, assumptionOnly: true, message: "Le Générateur contient déjà les hypothèses demandées. Aucune nouvelle écriture n’a été effectuée ; ces valeurs restent des hypothèses d’estimation." };
            if (before.version !== input.expectedVersion) return fail("stale_preview", "Les hypothèses ont changé. Relisez le Générateur avant d’enregistrer.");
            if (!await scope()) return fail("blocked", "Le compte actif a changé.");
            dispatched = true;
            let saved;
            if (!Object.keys(before.source).length) saved = await supabase.from("profiles").insert({ user_id: accountId, ...patch }).select("user_id").maybeSingle();
            else {
              let query = supabase.from("profiles").update(patch).eq("user_id", accountId);
              for (const column of Object.values(COLUMNS)) query = before.source[column] == null ? query.is(column, null) : query.eq(column, before.source[column]);
              saved = await query.select("user_id").maybeSingle();
            }
            if (saved.error || saved.data?.user_id !== accountId) return fail("stale_preview", "Le profil a changé pendant l’enregistrement. Relisez les hypothèses avant de reprendre.");
            const after = await read(); if (!Object.entries(patch).every(([column, value]) => after.source[column] === value)) return fail("saved_unconfirmed", "La relecture ne confirme pas les hypothèses demandées. Vérifiez le Générateur avant de reprendre.");
            let contextRefreshPending = false;
            try { await (await import("@/lib/boosterGenerationContext")).invalidateBoosterGenerationContext(accountId, "professional"); } catch { contextRefreshPending = true; }
            return { ok: true, status: "updated", applied, settings: after.settings, stored: after.stored, version: after.version, assumptionOnly: true, contextRefreshPending, nextAction: link, message: "Les hypothèses du Générateur sont enregistrées et vérifiées. Les projections restent des estimations fondées sur ces valeurs métier." };
          } catch { return fail(dispatched ? "unknown" : "unavailable", dispatched ? "L’enregistrement a été demandé mais son résultat n’est pas confirmé. Vérifiez les hypothèses avant de reprendre." : "Les hypothèses du Générateur n’ont pas pu être vérifiées."); }
        })());
        return attempts.get(key)!;
      } }),
  };
}
