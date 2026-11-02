import { isInrAssistantMediaUiCommandName, isInrAssistantMediaUiCommandText, parseInrAssistantMediaUiCommand, type InrAssistantMediaUiCommand } from "./inrAssistantMediaUiCommands.ts";
import { getAssistantInternalDestination } from "./inrAssistantNavigation.ts";
import { parseInrAssistantMailPatch, inrAssistantMailRecipientRequested, type InrAssistantMailCommand } from "./inrAssistantMailCompose.ts";
import { parseInrAssistantDocumentMailCommand, getInrAssistantDocumentPrefillNavigation, type InrAssistantDocumentMailCommand, type InrAssistantDocumentPrefill } from "./inrAssistantDocumentUiCommands.ts";

/** Shared public destinations. These commands navigate; they never grant business permissions. */
export const INR_ASSISTANT_NAVIGATION = {
  home: "/dashboard", channels: "/dashboard?action=channels", crm: "/dashboard/crm",
  calendar: "/dashboard/agenda", studio: "/dashboard/generer-media", media: "/dashboard/mediatheque",
  booster: "/dashboard?action=publish", campaigns: "/dashboard?action=campaigns",
  reputation: "/dashboard/e-reputation", stats: "/dashboard?stats=1", mail: "/dashboard/mails",
  ads: "/dashboard/ads", quotes: "/dashboard/devis", invoices: "/dashboard/factures",
  dna: "/dashboard/adn-entreprise", ai: "/dashboard/configuration-ia",
  account: "/dashboard?panel=compte", subscription: "/dashboard?panel=abonnement",
  subscription_invoices: "/dashboard?panel=factures", referrals: "/dashboard?panel=parrainage",
  legal: "/dashboard?panel=legal", privacy: "/dashboard?panel=rgpd",
  shop: "/dashboard?panel=boutique", inertia: "/dashboard?panel=inertie",
  generator: "/dashboard?generator=1", agents: "/dashboard/agent",
  preferences: "/dashboard?panel=preferences", notifications: "/dashboard?panel=notifications",
  calendar_settings: "/dashboard?panel=agenda", mail_settings: "/dashboard?panel=mails",
  document_settings: "/dashboard?panel=documents", badge: "/dashboard?panel=inrbadge",
  google_business: "/dashboard?panel=gmb", facebook: "/dashboard?panel=facebook",
  instagram: "/dashboard?panel=instagram", threads: "/dashboard?panel=threads",
  linkedin: "/dashboard?panel=linkedin", tiktok: "/dashboard?panel=tiktok",
  youtube: "/dashboard?panel=youtube_shorts", pinterest: "/dashboard?panel=pinterest",
  x: "/dashboard?panel=x", website: "/dashboard?panel=site_web", search: "/dashboard?panel=inr_search",
  directory: "/dashboard?panel=inr_directory",
  publication_agent: "/dashboard/agent/publications", email_agent: "/dashboard/agent/campagnes-mails",
  stats_agent: "/dashboard/agent/stats", help: "/dashboard?help=1", contact: "/dashboard?panel=contact",
  credits: "/dashboard/boutique/recharges", cash: "/dashboard?action=cash",
} as const;
export const INR_ASSISTANT_NAVIGATION_DESTINATIONS = Object.keys(INR_ASSISTANT_NAVIGATION) as (keyof typeof INR_ASSISTANT_NAVIGATION)[];
export type InrAssistantNavigation = { destination: string; href: string; label: string; documentId?: string; documentPrefill?: InrAssistantDocumentPrefill };
export const INR_ASSISTANT_ADS_STEPS = ["foundations", "bidding", "geography", "targeting", "keywords", "creative", "pinterest_format", "identity", "media", "delivery", "budget", "validation", "analysis"] as const;
export type InrAssistantAdsPatch = { name?: string; primaryText?: string; step?: typeof INR_ASSISTANT_ADS_STEPS[number] };
export type InrAssistantVideoPatch = { format?: "original" | "9_16" | "1_1" | "16_9"; adaptationMode?: "safe_frame" | "cover_crop" };
export type InrAssistantNativeCommand =
  InrAssistantMailCommand | { command: "configure_ads_draft"; selection: { kind: "campaign"; id: string }; revision: string; patch: InrAssistantAdsPatch }
  | { command: "configure_video_retouch"; selection: { kind: "media"; id: string }; revision: string; patch: InrAssistantVideoPatch };
export type InrAssistantUiCommand = InrAssistantMediaUiCommand | InrAssistantDocumentMailCommand | InrAssistantNativeCommand | { command: "export_document_pdf"; selection: { kind: "quote" | "invoice"; id: string }; revision?: string }
  | { command: "download_media"; selection: { kind: "media"; id: string }; mediaIds: string[]; pathname: "/dashboard/mediatheque"; selectionMode?: "current" }
  | { command: "download_stats_report"; selection: { kind: "stats_report"; id: string }; reportId: string };
export function parseInrAssistantUiCommand(value: unknown): InrAssistantUiCommand | null {
  const media = parseInrAssistantMediaUiCommand(value);
  if (media) return media;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.command === "prepare_document_mail") return parseInrAssistantDocumentMailCommand(row);
  const selection = row.selection && typeof row.selection === "object" ? row.selection as Record<string, unknown> : {};
  if (row.command === "configure_mail_draft") {
    const patch = parseInrAssistantMailPatch(row.patch);
    return patch && selection.kind === "mail" && typeof selection.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(selection.id) && typeof row.revision === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(row.revision)
      ? { command: row.command, selection: { kind: "mail", id: selection.id }, revision: row.revision, patch } : null;
  }
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  if (row.command === "configure_ads_draft" || row.command === "configure_video_retouch") {
    if (typeof selection.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(selection.id) || typeof row.revision !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.revision) || !row.patch || typeof row.patch !== "object" || Array.isArray(row.patch)) return null;
    const patch = row.patch as Record<string, unknown>;
    const entries = Object.entries(patch).filter(([, value]) => value !== null && value !== undefined);
    if (!entries.length) return null;
    if (row.command === "configure_ads_draft" && selection.kind === "campaign") {
      if (entries.some(([key, value]) => key === "name" ? typeof value !== "string" || !value.trim() || value.length > 100 : key === "primaryText" ? typeof value !== "string" || value.length > 800 : key === "step" ? !INR_ASSISTANT_ADS_STEPS.includes(value as typeof INR_ASSISTANT_ADS_STEPS[number]) : true)) return null;
      return { command: row.command, selection: { kind: "campaign", id: selection.id }, revision: row.revision, patch: Object.fromEntries(entries) as InrAssistantAdsPatch };
    }
    if (row.command === "configure_video_retouch" && selection.kind === "media") {
      if (entries.some(([key, value]) => key === "format" ? !["original", "9_16", "1_1", "16_9"].includes(String(value)) : key === "adaptationMode" ? !["safe_frame", "cover_crop"].includes(String(value)) : true)) return null;
      return { command: row.command, selection: { kind: "media", id: selection.id }, revision: row.revision, patch: Object.fromEntries(entries) as InrAssistantVideoPatch };
    }
    return null;
  }
  if (row.command === "download_media") return row.pathname === "/dashboard/mediatheque" && Array.isArray(row.mediaIds) && row.mediaIds.length > 0 && row.mediaIds.length <= 25 && row.mediaIds.every(id => typeof id === "string" && uuid.test(id)) && new Set(row.mediaIds).size === row.mediaIds.length && selection.kind === "media" && selection.id === row.mediaIds[0]
    ? { command: "download_media", selection: { kind: "media", id: row.mediaIds[0] as string }, mediaIds: [...row.mediaIds] as string[], pathname: "/dashboard/mediatheque", ...(row.selectionMode === "current" ? { selectionMode: "current" } : {}) } : null;
  if (row.command === "download_stats_report") return typeof row.reportId === "string" && uuid.test(row.reportId) && selection.kind === "stats_report" && selection.id === row.reportId
    ? { command: "download_stats_report", selection: { kind: "stats_report", id: row.reportId }, reportId: row.reportId } : null;
  return row.command === "export_document_pdf" && (selection.kind === "quote" || selection.kind === "invoice") && typeof selection.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(selection.id) && (row.revision === undefined || typeof row.revision === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(row.revision))
    ? { command: "export_document_pdf", selection: { kind: selection.kind, id: selection.id }, ...(typeof row.revision === "string" ? { revision: row.revision } : {}) } : null;
}

export function getInrAssistantNavigation(destination: unknown, documentId?: unknown): InrAssistantNavigation | null {
  if (typeof destination !== "string" || !Object.hasOwn(INR_ASSISTANT_NAVIGATION, destination)) return null;
  if (documentId !== undefined && documentId !== null) {
    if (typeof documentId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(documentId) || !["quotes", "invoices"].includes(destination)) return null;
    return { destination, documentId, href: `/dashboard/${destination === "quotes" ? "devis" : "factures"}/new?saveId=${documentId}`, label: destination === "quotes" ? "Ouvrir le devis" : "Ouvrir la facture" };
  }
  const href = INR_ASSISTANT_NAVIGATION[destination as keyof typeof INR_ASSISTANT_NAVIGATION];
  const target = getAssistantInternalDestination(href);
  return target ? { destination, href: target.href, label: target.label } : null;
}

export function parseInrAssistantNavigation(value: unknown): InrAssistantNavigation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.documentPrefill) {
    const target = getInrAssistantDocumentPrefillNavigation(input.documentPrefill);
    return target && !input.documentId && input.destination === target.destination && input.href === target.href && input.label === target.label ? target : null;
  }
  const target = getInrAssistantNavigation(input.destination, input.documentId);
  // Do not accept provider/browser supplied URLs or labels, even for known keys.
  return target && input.href === target.href && input.label === target.label ? target : null;
}

function navigationRequestText(message: string): string {
  // Fence end-of-input must not use multiline $, which exposes later code lines.
  return message.replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/`[^`]*(?:`|$)|«[^»]*(?:»|$)|“[^”]*(?:”|$)|"[^"]*(?:"|$)|(?<![\p{L}])'[\s\S]*?(?:'(?![\p{L}])|$)|‘[\s\S]*?(?:’(?![\p{L}])|$)/gu, " ")
    .replace(/^\s*>.*$/gm, " ")
    .normalize("NFD").replace(/\p{M}/gu, "").replace(/’/g, "'").toLowerCase().trim();
}

export function isInrAssistantNavigationRequest(message: string): boolean {
  const text = navigationRequestText(message);
  if (/^(?:comment|pourquoi|explique|how|why|what|si |imagine|suppose)\b/.test(text)) return false;
  // A future confirmation is not a current navigation instruction, including
  // when its condition follows punctuation or an adverb.
  const navigationClause = text.split(/\s+(?:et|puis|ensuite|and|then)\s+/)[0];
  if (/\b(?:si|if|quand|when|lorsque|unless|until|apres|after|avant|before)\b|\blorsqu'|\bune fois\b|\ba condition\b/.test(navigationClause) || /\b(?:seulement|uniquement|only|et|and)\s+(?:si|if|when)\b|\b(?:apres|after)\s+(?:(?:ma|mon|votre|my|your)\s+)?(?:confirmation|accord|approval|consent)\b/.test(text)) return false;
  if (/\b(?:demain|plus tard|tout a l'heure|tomorrow|later|pas maintenant)\b|\bdans\s+(?:\d+|une?|quelques?)\s*(?:minutes?|heures?|jours?)\b/.test(navigationClause)) return false;
  if (/\b(?:ne |n'|sans |do not |don't ).{0,25}(?:ouvr|affich|montr|emmen|amen|condui|navig|open|show|va\b|aller\b)/.test(text)) return false;
  return /\b(?:ouvre|ouvrez|ouvrir|affiche|affichez|afficher|montre|montrez|montrer|emmene|emmenez|emmener|amene|amenez|amener|conduis|conduisez|conduire|navigate|open|show)\b|\b(?:va|allez|aller|go)\s+(?:dans|sur|a|au|aux|to)\b/.test(text);
}

export function isInrAssistantScreenCommandRequest(message: string, command?: "export_document_pdf" | InrAssistantNativeCommand["command"] | InrAssistantMediaUiCommand["command"] | "prepare_document_mail"): boolean {
  const text = navigationRequestText(message);
  if (isInrAssistantMediaUiCommandName(command)) return isInrAssistantMediaUiCommandText(text, command);
  if (/^(?:comment|pourquoi|explique|how|why|si |imagine)\b|\b(?:ne |n['’]|sans |do not |don't ).{0,35}(?:telecharg|export|gener|prepar|download|modifi|chang|regl|appli|rempl|config|recadr|adapt|pass|met|renomm|joins|joign|ajout|attach|redig|ecri)/.test(text) || /\b(?:si|if|quand|when|apres confirmation|after approval|demain|tomorrow)\b/.test(text)) return false;
  const documentMail = /\b(?:prepare\w*|ouvre\w*|redige\w*|rempli\w*|open|draft)\b/.test(text)
    && /\b(?:mail|email|courriel|composeur|composer)\b/.test(text) && /\b(?:pdf|piece jointe|pj)\b/.test(text)
    && /\b(?:devis|facture|document|quote|invoice)\b/.test(text);
  if (command === "prepare_document_mail") return documentMail;
  const pdf = !documentMail && /\bpdf\b/.test(text) && !/\b(?:stats|statistiques|bilan|rapport)\b/.test(text) && /\b(?:telecharge\w*|exporte\w*|gener\w*|prepare\w*|download|export|generate)\b/.test(text);
  const edit = /\b(?:modifi\w*|chang\w*|regl\w*|appli\w*|rempl\w*|configur\w*|recadr\w*|adapt\w*|passe\w*|mets|mettre|renomm\w*|set|change|edit|apply|fill)\b/.test(text);
  const ads = edit && /\b(?:pub|publicite|publicitaire|campagne|annonce|ads|advert|brouillon)\b/.test(text);
  const video = edit && /\b(?:video|cadrage|format|recadrage)\b/.test(text);
  const mail = !documentMail && (edit || /\b(?:redig\w*|ecris|prepare\w*|joins|joignez|ajoute\w*|attache\w*)\b/.test(text)) && /\b(?:mail|email|courriel|message|composeur)\b/.test(text) && !/\b(?:campagne|newsletter|publicitaire)\b/.test(text);
  return command === "export_document_pdf" ? pdf : command === "configure_ads_draft" ? ads : command === "configure_video_retouch" ? video : command === "configure_mail_draft" ? mail : documentMail || pdf || ads || video || mail || isInrAssistantMediaUiCommandText(text);
}

export function inrAssistantMailPatchRequested(message: string, patch: InrAssistantMailCommand["patch"]): boolean {
  const text = navigationRequestText(message);
  const draft = /\b(?:redig\w*|ecris|prepare\w*)\b.{0,45}\b(?:mail|email|courriel|message)\b/.test(text);
  return inrAssistantMailRecipientRequested(message, patch.recipient)
    && (patch.subject === undefined || draft || /\b(?:objet|sujet|subject)\b/.test(text))
    && (patch.bodyText === undefined || draft || /\b(?:texte|corps|contenu|body)\b/.test(text))
    && (patch.attachments === undefined || /\b(?:joins|joignez|ajoute\w*|attache\w*|pieces? jointes?|pj)\b/.test(text));
}

const DIRECT_DESTINATION_ALIASES: ReadonlyArray<readonly [keyof typeof INR_ASSISTANT_NAVIGATION, RegExp]> = [
  ["subscription_invoices", /^(?:factures? (?:d'abonnement|de l'abonnement|de mon abonnement|inrcy)|subscription invoices)\b/],
  ["calendar_settings", /^(?:reglages|parametres|connexion) (?:de l'|de mon |du )?(?:agenda|calendrier|calendar)\b/],
  ["mail_settings", /^(?:reglages|parametres|connexion) (?:de la |de ma |de |des )?(?:messagerie|mails?|emails?)\b/],
  ["document_settings", /^(?:reglages|parametres|configuration) (?:des |de mes )?documents\b/],
  ["publication_agent", /^agent (?:de |des )?publications\b/],
  ["email_agent", /^agent (?:de |des )?(?:emailings?|campagnes mails?|campagnes emails?)\b/],
  ["stats_agent", /^agent (?:de |des )?(?:stats|statistiques)\b/],
  ["preferences", /^(?:preferences(?: generales)?|reglages generaux|parametres generaux)\b/], ["notifications", /^notifications\b/],
  ["crm", /^(?:inr'?\s*)?crm\b/], ["calendar", /^(?:agenda|calendrier|(?:inr'?\s*)?calendar)\b/],
  ["channels", /^canaux\b/], ["studio", /^(?:inr'?\s*)?studio\b/],
  ["media", /^(?:mediatheque|medias)\b/], ["stats", /^(?:(?:inr'?\s*)?stats|statistiques)\b/],
  ["account", /^compte\b/], ["subscription", /^abonnement\b/],
  ["home", /^(?:accueil|tableau de bord|dashboard)\b/], ["dna", /^adn(?: de l'entreprise)?\b/],
  ["ai", /^(?:(?:configuration|reglages|parametres) (?:de l')?ia|configurer mon ia)\b/],
  ["reputation", /^(?:e[- ]?reputation|reputation|avis google)\b/],
  ["booster", /^(?:booster|publication multicanale)\b/],
  ["campaigns", /^campagnes(?: (?:mails|emails|emailing))?\b/],
  ["mail", /^(?:(?:inr'?\s*)?send|messagerie|mails|emails)\b/],
  ["ads", /^(?:(?:inr'?\s*)?ads|publicites)\b/],
  ["quotes", /^devis\b/], ["invoices", /^factures\b/],
  ["badge", /^(?:inr'?\s*)?badge\b/],
  ["google_business", /^(?:google business(?: profile)?|fiche google)\b/],
  ["facebook", /^facebook\b/], ["instagram", /^instagram\b/], ["threads", /^threads\b/],
  ["linkedin", /^linkedin\b/], ["tiktok", /^tiktok\b/], ["youtube", /^youtube(?: shorts)?\b/],
  ["pinterest", /^pinterest\b/], ["x", /^(?:x|twitter)\b/],
  ["website", /^site (?:web|internet)\b/], ["search", /^(?:inr'?\s*)search\b/],
  ["directory", /^(?:(?:inr'?\s*)?annuaire)\b/],
  ["help", /^(?:aide(?: inrcy)?|gps)\b/], ["contact", /^(?:contact|nous contacter)\b/],
  ["credits", /^(?:credits medias|recharges(?: medias)?)\b/], ["cash", /^(?:encaisser|encaissement)\b/],
  ["referrals", /^parrainage\b/], ["legal", /^(?:infos legales|informations legales|mentions legales)\b/],
  ["privacy", /^(?:donnees rgpd|rgpd|confidentialite)\b/], ["shop", /^boutique\b/],
  ["inertia", /^(?:inertie|puissance d'inertie)\b/],
  ["generator", /^(?:generateur(?: de visibilite)?|reglages du generateur)\b/], ["agents", /^agents(?: ia)?\b/],
];

type DirectNavigationRequest = { destination: string; instructionQuote: string };

/** Resolve an explicit module opening; record-specific requests remain with the normal tools. */
function parseDirectNavigationRequest(message: string): (DirectNavigationRequest & { suffix: string }) | null {
  if (message.length > 1200 || !isInrAssistantNavigationRequest(message)) return null;
  const text = navigationRequestText(message).replace(/^(?:(?:bonjour|salut|merci)[,!]?\s+|(?:s'il (?:te|vous) plait|stp|svp)[,!]?\s+)/, "");
  const opening = text.match(/^(?:(?:peux|pourrais|pouvez|pourriez)[ -](?:tu|vous)\s+(?:m'|me\s+|nous\s+)?)?(?:(?:ouvre|ouvrez|ouvrir|affiche|affichez|afficher|montre|montrez|montrer|open|show)(?:-moi|-nous)?\s+|(?:emmene|emmenez|emmener|amene|amenez|amener|conduis|conduisez|conduire)(?:-moi|-nous|\s+moi|\s+nous)?\s+(?:dans|sur|vers|a|au|aux)\s+|(?:va|allez|aller|go)\s+(?:dans|sur|a|au|aux|to)\s+)(?:(les|le|la|mon|ma|mes|the|my)\s+|l'\s*)?((?:module|panneau|page|ecran|outil)\s+)?/);
  if (!opening) return null;
  const remainder = text.slice(opening[0].length);
  for (const [destination, pattern] of DIRECT_DESTINATION_ALIASES) {
    const match = remainder.match(pattern);
    if (!match) continue;
    if (destination === "quotes" && ["mon", "le", "my", "the"].includes(opening[1]) && !opening[2]) return null;
    const after = remainder.slice(match[0].length);
    const suffix = after.replace(/^\s+(?:de l'application|de mon application)\b/, "");
    if (!/^(?:\s*(?:$|[.!?,;])|\s+(?:et|puis|and|then|pour moi|sans|seulement|s'il|stp|svp|please|maintenant|merci)\b)/.test(suffix)) return null;
    if (isInrAssistantNavigationRequest(suffix)) return null;
    const secondTarget = suffix.match(/^\s*(?:[,;]\s*)?(?:(?:et|puis|ou|and|then|or)\s+)?(?:(?:les|le|la|mon|ma|mes|the|my)\s+|l')?(.*)$/)?.[1] ?? "";
    if (DIRECT_DESTINATION_ALIASES.some(([, alias]) => alias.test(secondTarget))) return null;
    return { destination, instructionQuote: message, suffix };
  }
  return null;
}

export function getDirectInrAssistantNavigationRequest(message: string): DirectNavigationRequest | null {
  const parsed = parseDirectNavigationRequest(message);
  return parsed ? { destination: parsed.destination, instructionQuote: parsed.instructionQuote } : null;
}

/** A strict subset needing no model: one named module and optional courtesy, with no extra task. */
export function getPureInrAssistantNavigationRequest(message: string): DirectNavigationRequest | null {
  const parsed = parseDirectNavigationRequest(message);
  if (!parsed || !/^(?:[\s.!?,;]|pour moi\b|s'il (?:te|vous) plait\b|stp\b|svp\b|please\b|maintenant\b|merci\b)*$/.test(parsed.suffix)) return null;
  return { destination: parsed.destination, instructionQuote: parsed.instructionQuote };
}

export type InrAssistantTaskProgress = {
  outcome: "completed" | "partial" | "needs_input" | "processing" | "blocked" | "failed";
  completed: string[]; remaining: string[];
};
export function parseInrAssistantTaskProgress(value: unknown): InrAssistantTaskProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!["completed", "partial", "needs_input", "processing", "blocked", "failed"].includes(String(row.outcome))) return null;
  const list = (value: unknown): string[] | null => Array.isArray(value) && value.length <= 24 && value.every(item => typeof item === "string" && item.length > 0 && item.length <= 160 && !/[\u0000-\u001f\u007f]/.test(item)) ? [...new Set(value as string[])] : null;
  const completed = list(row.completed), remaining = list(row.remaining);
  return completed && remaining ? { outcome: row.outcome as InrAssistantTaskProgress["outcome"], completed, remaining } : null;
}
