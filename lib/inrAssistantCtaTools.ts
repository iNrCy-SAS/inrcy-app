import "server-only";

import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_CTA_CHANNELS, normalizeAiChannelCtaMap, type AiCtaChannel } from "./aiChannelCtaPreferences.ts";
import { getPreferredCtaLabel, normalizeCtaPhone } from "./boosterCtaPreferences";
import { normalizeInrBadgeShareSettings } from "./inrBadgeSettings.ts";
import { normalizeChannelPublicUrl } from "./channelPublicUrl.ts";
import { isMetaChannelPilotEnabledForActorAndAccount } from "./metaChannelRolloutServer";
import { requireUser } from "./requireUser";

type Row = Record<string, unknown>;
type Input = { instructionQuote: string; target: "phone" | "website"; channels: AiCtaChannel[] | null };
type Item = { tool: string; channel?: string; status: "applied" | "unchanged" | "blocked" | "unknown"; message: string };
type Result = { ok: boolean; status: "updated" | "unchanged" | "partial" | "needs_instruction" | "blocked" | "unknown"; message: string; items: Item[]; nextAction: { label: string; href: string }; existingContentChanged: false; externalProfilesChanged: false };
const LINK = { label: "Configuration IA — Appels à l’action", href: "/dashboard/configuration-ia" };
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const normalized = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const hasPhoneTarget = (value: string) => /\b(?:telephone|tel|numero|appeler|phone|call)\b/.test(value);
const hasWebsiteTarget = (value: string) => /\b(?:site|website|web|url|lien)\b/.test(value);
const asksForTargetChoice = (value: string) => hasPhoneTarget(value) && hasWebsiteTarget(value) && /\b(?:ou|or)\b/.test(value);
function parse(value: unknown): Input {
  const input = row(value);
  if (Object.keys(input).length !== 3 || !Object.hasOwn(input, "channels") || typeof input.instructionQuote !== "string" || !input.instructionQuote.trim() || input.instructionQuote.length > 1200 || input.target !== "phone" && input.target !== "website") throw new Error("Précisez les appels à l’action à configurer.");
  if (input.channels !== null && (!Array.isArray(input.channels) || !input.channels.length || input.channels.length > AI_CTA_CHANNELS.length || input.channels.some(channel => !AI_CTA_CHANNELS.some(item => item.key === channel)) || new Set(input.channels).size !== input.channels.length)) throw new Error("Canaux d’appel à l’action invalides.");
  return { instructionQuote: input.instructionQuote.trim(), target: input.target, channels: input.channels as Input["channels"] };
}
function authorized(message: string, input: Input): boolean {
  if (!message.includes(input.instructionQuote)) return false;
  const visible = message.slice(0, 4000).replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm, " ");
  if (!visible.includes(input.instructionQuote)) return false;
  const value = normalized(visible);
  const action = /\b(?:fais|faites|faire|mets?|mett(?:re|es|ez|iez)|ajout\w*|configur\w*|parametr\w*|remplac\w*|chang\w*|modifi\w*|regl\w*|utilis\w*|appliqu\w*|renseign\w*|set|use|configure|replace|update|apply)\b/;
  if (!action.test(value) || !action.test(normalized(input.instructionQuote))) return false;
  if (/\b(?:comment|how|where|pourquoi|why)\b[^.!?]{0,160}\b(?:faire|mettre|ajout\w*|configur\w*|parametr\w*|remplac\w*|modifi\w*|appliqu\w*|set|use|configure|update|apply)\b|\b(?:expli\w*|montr\w*|show|tell|dire|dis)\b[^.!?]{0,140}\b(?:comment|ou|how|where)\b/.test(value) || /^(?:comment|pourquoi|explique|how|why|what)\b/.test(value.trim()) || /\b(?:ne |n['’]|sans |do not |don't ).{0,35}(?:met|ajout|configur|parametr|remplac|chang|modifi|utilis|appliqu|set|use|update)/.test(value)) return false;
  // An action word inside a button label, complaint or past narrative is not
  // permission. Require an independent present directive and keep its target
  // and scope in that same directive, rather than borrowing unrelated prose.
  const imperative = "(?:fais|faites|mets|mettez|ajoute|ajoutez|configure|configurez|parametre|parametrez|remplace|remplacez|change|changez|modifie|modifiez|regle|reglez|utilise|utilisez|applique|appliquez|renseigne|renseignez|set|use|replace|update|apply)";
  const infinitive = "(?:faire|mettre|ajouter|configurer|parametrer|remplacer|changer|modifier|regler|utiliser|appliquer|renseigner)";
  const present = new RegExp(`^(?:(?:bonjour|salut|bonsoir|oui|d['’]accord|alors|please|stp|s['’]il te plait|s['’]il vous plait)[ ,:—-]+)*(?:${imperative}\\b|(?:peux[ -]tu|pouvez[ -]vous|pourrais[ -]tu|pourriez[ -]vous|tu peux|vous pouvez|merci de|veuillez)\\s+${infinitive}\\b|(?:je veux|je souhaite|j['’]aimerais|je voudrais)\\s+(?:${infinitive}\\b|que (?:tu|vous)\\s+(?:mettes|mettiez|ajoutes|ajoutiez|configures|configuriez|parametres|parametriez|remplaces|remplaciez|changes|changiez|modifies|modifiiez|regles|regliez|utilises|utilisiez|appliques|appliquiez|renseignes|renseigniez)\\b)|(?:can|could|would) you\\s+${imperative}\\b|i (?:want|would like) you to\\s+${imperative}\\b)`);
  const quote = normalized(input.instructionQuote);
  // A domain or a dotted phone number is part of the instruction. Split only
  // at sentence boundaries, while preserving the same-sentence scope guard.
  const directive = value.split(/\n+|[.!?;](?=\s|$)/).map(part => part.trim()).find(part => present.test(part) && (part.includes(quote.replace(/[.!?;\n]+$/, "")) || quote.includes(part)));
  if (!directive || /\b(?:ne fonctionne pas|ne marche pas|does not work|doesn't work)\b/.test(directive)) return false;
  if (!/\b(?:ctas?|appels? a l.action|boutons?|canaux|publications?|contenus?|partout|tous?|all|channels?)\b/.test(directive)) return false;
  if (asksForTargetChoice(directive) || (input.target === "phone" ? !hasPhoneTarget(directive) : !hasWebsiteTarget(directive))) return false;
  if (input.channels === null) return /\b(?:partout|tous?|toutes?|all)\b/.test(directive);
  const names: Record<AiCtaChannel, RegExp> = { site_web: /\bsite(?: web)?\b/, gmb: /\b(?:google|gmb)\b/, facebook: /\b(?:facebook|fb)\b/, instagram: /\b(?:instagram|insta)\b/, threads: /\bthreads\b/, linkedin: /\blinkedin\b/, x: /\b(?:twitter|x)\b/, tiktok: /\btiktok\b/, youtube_shorts: /\byoutube\b/, pinterest: /\bpinterest\b/ };
  return input.channels.every(channel => names[channel].test(directive));
}
function phone(value: unknown): string {
  if (typeof value !== "string" || value.length > 80) return "";
  const source = value.trim().replace(/^tel:/i, "");
  const raw = /^(?:\+|00)/.test(source) ? source.replace(/\(0\)/g, "") : source;
  if (!/^(?:\+|00)?[\d\s().-]+$/.test(raw)) return "";
  let canonical = normalizeCtaPhone(raw.startsWith("00") ? `+${raw.slice(2)}` : raw).replace(/[^\d+]/g, "");
  if (canonical.startsWith("00")) canonical = `+${canonical.slice(2)}`;
  // Keep a locally saved prefix intact: never invent a country calling code.
  return /^(?:\+?[1-9]\d{7,14}|0\d{7,14})$/.test(canonical) ? canonical : "";
}
function website(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  const result = normalizeChannelPublicUrl("site_web", value);
  if (!result.ok) return "";
  const url = new URL(result.url);
  if ([...url.searchParams.keys()].some(key => /token|secret|signature|authorization|credential|^sig$|^key$|^code$/i.test(key)) || /(?:^|\.)supabase\.(?:co|com|net)$/i.test(url.hostname)) return "";
  return result.url;
}
function usesRegisteredDestination(message: string, target: Input["target"], destination: string): boolean {
  // A value literally supplied by the pro must not be silently replaced with
  // a different saved coordinate. Check the actual message, not a model-picked
  // excerpt which could omit that value. Source updates are a separate task.
  const visible = message.slice(0, 4000).replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm, " ");
  if (target === "phone") {
    const values = visible.match(/(?:\+|00)?\d[\d\s().-]{6,}\d/g) ?? [];
    return values.every(value => phone(value) === destination);
  }
  const values = visible.match(/\b(?:https?:\/\/|www\.)[^\s<>"«»]+/gi) ?? [];
  return values.every(value => website(value.replace(/[.,;!?]+$/, "")) === destination);
}
const equal = (a: unknown, b: unknown): boolean => {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
};

/** Changes future CTA defaults, never saved publications, OAuth, billing, source coordinates or campaign spending. */
export function createInrAssistantCtaTools(options: { request: Request; accountId: string; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; canStartWork?: () => boolean }) {
  const { request, accountId, supabase, currentUserMessage } = options;
  if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 180 || typeof currentUserMessage !== "string") throw new Error("Périmètre de l’assistant invalide.");
  let work: Promise<Result> | undefined;
  const result = (status: Result["status"], items: Item[] = [], message = "La modification n’a pas pu être confirmée. Vérifiez les réglages avant une nouvelle demande."): Result => ({ ok: ["updated", "unchanged"].includes(status) || status === "partial" && items.some(item => item.status === "applied"), status, message, items, nextAction: LINK, existingContentChanged: false, externalProfilesChanged: false });
  const activeScope = async () => { if (request.signal.aborted || options.canStartWork?.() === false) return false; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId; };
  return {
    configureBusinessCta: tool({ strict: true,
      description: "Configurer les futurs appels à l’action depuis le téléphone professionnel ou le site DÉJÀ enregistré, uniquement sur demande actuelle de modification. target=phone choisit Appeler ; website choisit Voir le site. Aucune valeur téléphone/URL fournie par le modèle n’est acceptée. channels=null exige une demande globale (partout/tous) ; sinon seuls les canaux nommés sont changés. Réutilise Configuration IA pour Booster/Agent et, en portée globale, la visibilité téléphone/site du Badge. Certaines plateformes refusent les liens ; retourner les résultats détaillés sans prétendre modifier les contenus déjà publiés, comptes sociaux, annonces payantes ou messages. Les questions comment faire restent du guidage, jamais une écriture.",
      inputSchema: jsonSchema<Input>({ type: "object", properties: { instructionQuote: { type: "string", minLength: 1, maxLength: 1200, description: "Citation exacte de la dernière demande qui ordonne cette modification, pas une ancienne mémoire." }, target: { type: "string", enum: ["phone", "website"] }, channels: { type: ["array", "null"], minItems: 1, maxItems: AI_CTA_CHANNELS.length, items: { type: "string", enum: AI_CTA_CHANNELS.map(item => item.key) } } }, required: ["instructionQuote", "target", "channels"], additionalProperties: false }, { validate: value => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Réglages CTA invalides.") }; } } }),
      execute: async raw => {
        const input = parse(raw);
        if (!authorized(currentUserMessage, input)) return result("needs_instruction", [], asksForTargetChoice(normalized(input.instructionQuote)) ? "Quel appel à l’action choisissez-vous : votre site web ou votre téléphone ? Indiquez aussi les canaux concernés, ou tous les canaux. Aucun réglage n’a été modifié." : "Précisez les appels à l’action à modifier dans votre demande actuelle. Une question d’aide ou une ancienne consigne ne modifie aucun réglage.");
        if (!work) work = (async (): Promise<Result> => {
          const items: Item[] = [];
          try {
            if (!await activeScope()) return result("blocked");
            const [profileRead, businessRead, configRead, pilot] = await Promise.all([
              supabase.from("profiles").select("user_id,phone").eq("user_id", accountId).maybeSingle(),
              supabase.from("business_profiles").select("user_id,ai_channel_ctas,preferred_cta,ai_language,updated_at").eq("user_id", accountId).maybeSingle(),
              supabase.from("pro_tools_configs").select("user_id,settings,updated_at").eq("user_id", accountId).maybeSingle(),
              isMetaChannelPilotEnabledForActorAndAccount(supabase, accountId).catch(() => false),
            ]);
            const profile = row(profileRead.data), business = row(businessRead.data), config = row(configRead.data), settings = row(config.settings);
            const destination = input.target === "phone" ? phone(profile.phone) : website(row(settings.site_web).url);
            if (input.target === "phone" && (profileRead.error || profile.user_id !== accountId) || input.target === "website" && (configRead.error || config.user_id !== accountId) || !destination) return result("blocked", [], input.target === "phone" ? "Aucun téléphone professionnel exploitable n’est enregistré. Complétez le téléphone dans l’ADN ; aucun numéro n’a été inventé ni aucun CTA modifié." : "Aucun site public valide n’est enregistré. Vérifiez le Site web dans Mes canaux ; aucune URL n’a été inventée ni aucun CTA modifié.");
            if (!usesRegisteredDestination(currentUserMessage, input.target, destination)) return result("needs_instruction", [], input.target === "phone" ? "Le téléphone indiqué ne correspond pas au téléphone professionnel enregistré. Vérifiez-le dans l’ADN, puis demandez à appliquer ce numéro aux CTA souhaités. Aucun CTA n’a été modifié." : "Le site indiqué ne correspond pas au site enregistré. Vérifiez le Site web dans Mes canaux, puis demandez à appliquer ce site aux CTA souhaités. Aucun CTA n’a été modifié.");
            const choice = input.target === "phone" ? "appeler" : "site";
            const candidate = { choice, mode: input.target === "phone" ? "call" : "website", label: getPreferredCtaLabel(choice, business.ai_language), url: input.target === "website" ? destination : "", phone: input.target === "phone" ? destination : "" };
            const selected = AI_CTA_CHANNELS.filter(item => input.channels === null || input.channels.includes(item.key));
            const changes: AiCtaChannel[] = [];
            const rawMap = row(business.ai_channel_ctas), nextMap = { ...rawMap };
            const existing = normalizeAiChannelCtaMap(rawMap);
            for (const item of selected) {
              const normalized = normalizeAiChannelCtaMap({ [item.key]: candidate })[item.key];
              if (!normalized || item.key === "threads" && !pilot) { items.push({ tool: "Booster / Agent Publications", channel: item.key, status: "blocked", message: !normalized ? "Ce canal ne permet pas ce type d’appel à l’action dans l’application. Son réglage est conservé." : "Ce canal n’est pas disponible pour ce compte. Son réglage est conservé." }); continue; }
              if (equal(existing[item.key], normalized)) { items.push({ tool: "Booster / Agent Publications", channel: item.key, status: "unchanged", message: "L’appel à l’action correspond déjà à la destination enregistrée." }); continue; }
              nextMap[item.key] = { ...row(rawMap[item.key]), ...normalized }; changes.push(item.key);
            }
            const legacyChange = input.channels === null && business.preferred_cta !== choice;
            if (changes.length || legacyChange) {
              if (businessRead.error || business.user_id !== accountId || business.updated_at !== null && typeof business.updated_at !== "string") {
                items.push(...changes.map(channel => ({ tool: "Booster / Agent Publications", channel, status: "blocked" as const, message: "La configuration actuelle doit être vérifiée avant de modifier ses appels à l’action." })));
              } else {
                // Compare both the timestamp and JSON value: an older writer
                // may change this JSON without updating its timestamp.
                const previousJson = JSON.stringify(business.ai_channel_ctas ?? null);
                if (previousJson.length > 12_000) items.push(...changes.map(channel => ({ tool: "Booster / Agent Publications", channel, status: "blocked" as const, message: "Ces réglages doivent être modifiés dans Configuration IA pour garantir leur conservation." })));
                else {
                  const freshSource = input.target === "phone" ? await supabase.from("profiles").select("user_id,phone").eq("user_id", accountId).maybeSingle() : await supabase.from("pro_tools_configs").select("user_id,settings").eq("user_id", accountId).maybeSingle();
                  const fresh = row(freshSource.data);
                  const freshDestination = input.target === "phone" ? phone(fresh.phone) : website(row(row(fresh.settings).site_web).url);
                  if (freshSource.error || fresh.user_id !== accountId || freshDestination !== destination || !await activeScope()) return result("blocked", items, "La destination ou l’établissement actif a changé pendant la préparation. Aucun nouveau réglage n’a été enregistré.");
                  const patch = { ai_channel_ctas: nextMap, ...(legacyChange ? { preferred_cta: choice } : {}), updated_at: new Date().toISOString() };
                  let update = supabase.from("business_profiles").update(patch).eq("user_id", accountId);
                  update = business.updated_at === null ? update.is("updated_at", null) : update.eq("updated_at", business.updated_at);
                  update = business.ai_channel_ctas == null ? update.is("ai_channel_ctas", null) : update.eq("ai_channel_ctas", previousJson);
                  const saved = await update.select("user_id").maybeSingle();
                  const success = !saved.error && row(saved.data).user_id === accountId;
                  items.push(...changes.map(channel => ({ tool: "Booster / Agent Publications", channel, status: success ? "applied" as const : "unknown" as const, message: success ? channel === "gmb" && input.target === "phone" ? "Mode Appeler enregistré. Le bouton Google utilise le numéro de sa fiche Google ; cette fiche n’a pas été modifiée." : "Le prochain contenu généré utilisera cet appel à l’action compatible." : "Un conflit ou une indisponibilité empêche de confirmer ce réglage. Vérifiez Configuration IA." })));
                  if (legacyChange) items.push({ tool: "Préférence CTA générale", status: success ? "applied" : "unknown", message: success ? "La préférence générale a été alignée sur les canaux compatibles." : "La préférence générale n’a pas pu être confirmée." });
                  if (success) { const { invalidateBoosterGenerationContext } = await import("@/lib/boosterGenerationContext"); await invalidateBoosterGenerationContext(accountId, "professional").catch(() => undefined); }
                }
              }
            }
            if (input.channels === null) {
              const flag = input.target === "phone" ? "phone" : "siteWeb";
              const sharing = normalizeInrBadgeShareSettings(settings.inrBadgeShareSettings);
              if (configRead.error || config.user_id !== accountId || config.updated_at !== null && typeof config.updated_at !== "string") items.push({ tool: "iNr’Badge", status: "unknown", message: "Les réglages du Badge n’ont pas pu être vérifiés." });
              else if (sharing[flag]) items.push({ tool: "iNr’Badge", status: "unchanged", message: "L’affichage de cette coordonnée est déjà autorisé. Le site reste soumis à sa connexion et à sa disponibilité." });
              else if (JSON.stringify(config.settings).length > 12_000) items.push({ tool: "iNr’Badge", status: "blocked", message: "Activez cette coordonnée dans les réglages du Badge pour préserver la configuration actuelle." });
              else if (!await activeScope()) items.push({ tool: "iNr’Badge", status: "blocked", message: "La demande a été interrompue avant la modification du Badge." });
              else {
                const nextSettings = { ...settings, inrBadgeShareSettings: { ...row(settings.inrBadgeShareSettings), [flag]: true } };
                let update = supabase.from("pro_tools_configs").update({ settings: nextSettings, updated_at: new Date().toISOString() }).eq("user_id", accountId);
                update = config.updated_at === null ? update.is("updated_at", null) : update.eq("updated_at", config.updated_at);
                update = config.settings == null ? update.is("settings", null) : update.eq("settings", JSON.stringify(config.settings));
                const saved = await update.select("user_id").maybeSingle();
                items.push({ tool: "iNr’Badge", status: !saved.error && row(saved.data).user_id === accountId ? "applied" : "unknown", message: !saved.error && row(saved.data).user_id === accountId ? "L’affichage de cette coordonnée a été activé, en conservant les autres réglages et connexions." : "Une modification concurrente ou une indisponibilité empêche de confirmer le Badge." });
              }
              items.push({ tool: "iNr’Search", status: "unchanged", message: "La page publique reprend déjà les coordonnées du profil et du site enregistré ; ses actualités n’exposent pas de CTA par publication. Aucune activation de page n’a été effectuée." });
              items.push({ tool: "Annonces / campagnes mails / contenus déjà enregistrés", status: "blocked", message: "Leurs destinations sont propres à chaque contenu. Aucun contenu publié, brouillon existant, profil social ou budget publicitaire n’a été modifié." });
            }
            const changed = items.some(item => item.status === "applied"), unknown = items.some(item => item.status === "unknown"), blocked = items.some(item => item.status === "blocked");
            return result(changed ? unknown || blocked ? "partial" : "updated" : unknown ? "unknown" : blocked ? "partial" : "unchanged", items, "Résultats par outil ci-dessous. Seuls les futurs appels à l’action et les réglages explicitement indiqués ont été traités ; les limites des plateformes restent applicables.");
          } catch { return result(items.some(item => item.status === "applied") ? "partial" : "unknown", items); }
        })();
        return work;
      },
    }),
  };
}
