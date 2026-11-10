import { isInrAssistantCurrentTimeRequest } from "./inrAssistantClock.ts";

/** Routing only. Search execution separately checks the current public query. */
export function isInrAssistantWebResearchRequest(message: string): boolean {
  const text = String(message || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().slice(0, 4000);
  const explicit = /\b(?:internet|web|en ligne|sources? officiell\w*|sources? recent\w*|search the web|look up|browse|recherche sur)\b/.test(text);
  if (explicit) return true;
  const internal = /\binrcy\b|\binr.?(?:assist\w*|studio|stats|send|calendar|crm|search)\b|\bdans (?:le |mon |notre )?studio\b|\b(?:mes?|notre|mon|ma|nos)\b.{0,50}\b(?:statistiques?|publications?|canaux?|erreurs?|adn|abonnements?|factures?|devis|contacts?|clients?|medias?|images?)\b/.test(text);
  if (internal || isInrAssistantCurrentTimeRequest(text) && !/actualite|nouveaute|annonce|cours|meteo|weather|news/.test(text)) return false;
  return /\b(?:actualites?|nouveautes?|dernieres? annonces?|recent\w*|recemment|latest|recent|news|prix actuel|cours actuel|meteo|weather)\b/.test(text)
    || /^(?:(?:peux|pourrais).{0,12}m['’]?(?:expliquer|dire)|explique|pourquoi|quand|qui est|qui a|quels?|quelles?|combien|what|why|who|when|how)\b/.test(text.trim());
}
