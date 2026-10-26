import { inrAssistantRoutingText } from "./inrAssistantTaskPolicy.ts";
export { inrAssistantRoutingText, inrAssistantRequiredTools, inrAssistantTaskOutcome } from "./inrAssistantTaskPolicy.ts";
export { verifiedInrAssistantCapabilityLimit } from "./inrAssistantCapabilities.ts";
export type InrAssistantToolFamily = "media" | "publication" | "business" | "management" | "workspace" | "commercial" | "advertising" | "settings";

/** This only limits schema cost. It never grants a right or authorizes an action. */
export function selectInrAssistantToolFamilies(latest: string, recentUserMessages: string[] = []): Set<InrAssistantToolFamily> {
  const text = inrAssistantRoutingText([latest, ...recentUserMessages.slice(-2)].join(" ")).slice(0, 12_000);
  const families = new Set<InrAssistantToolFamily>();
  if (/\b(?:images?|videos?|photos?|medias?|visuel|affiche|flyer|studio|dessin|illustration|retouch|fond|logo)\b|图片|视频|รูป|วิดีโอ/.test(text)) families.add("media");
  if (/\b(?:publications?|publie|publier|poste[rz]?|posts?|booster|program(?:me|mer|mation)|calendrier editorial|schedule|publish|brouillons?|contenu(?:s)?|redige)\b|发布|โพสต์/.test(text)) families.add("publication");
  if (/\b(?:adn|dna|ctas?|configuration|reglages?|emoji|consignes?|horaires|valeurs|missions?|connecter|connexion|canaux|canal|vouvoiement|tutoiement|ton|tone)\b|appels? a l.action|设置|企业|连接|บริษัท|เชื่อมต่อ/.test(text) ||
    /\b(?:bouton|appeler|call)\b.{0,70}\b(?:facebook|instagram|google|site|telephone)\b|\b(?:telephone|site)\b.{0,70}\bbouton\b/.test(text) ||
    /\b(?:telephone|numero|site|website|lien).{0,70}\b(?:partout|tous|toutes|contenus|publications)\b/.test(text) ||
    /\b(?:complete|remplis|modifie|ajoute|change|mets).{0,60}\b(?:entreprise|business|services|prestations|ton|tone|style)\b/.test(text)) families.add("business");
  if (/\b(?:abonnement|abonner|souscrire|souscription|resilier|resiliation|facturation|standard|premium|founder|stripe|agents?|automatisation|planning|rapport|bilan|active|desactive)\b|订阅|สมัคร/.test(text)) families.add("management");
  if (/\b(?:crm|clients?|prospects?|contacts?|agenda|rendez.vous|rdv|calendar|campagnes?|email|emails?|mail|mails|newsletter|courriel|fidelis|propuls|reputation|avis|mediatheque|tags?)\b|评论|邮件|客户|อีเมล/.test(text)) families.add("workspace");
  if (/\b(?:crm|devis|factures?|encaisser|clients?|prospects?|contacts?)\b/.test(text)) families.add("commercial");
  if (/\bads\b|publicit|publicitair|annonceur|campagne sponsoris/.test(text)) families.add("advertising");
  if (/notification|inr.?badge|qr.code|\bpreferences\b|(?:reglag|parametr|configur|criteres?|defaut).{0,65}(?:studio|generateur|calendar|agenda|devis|facture|tiktok)|(?:studio|generateur|calendar|agenda|devis|facture|tiktok).{0,65}(?:reglag|parametr|configur|criteres?|defaut)/.test(text)) families.add("settings");
  return families;
}
