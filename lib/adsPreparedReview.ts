import { plannedNativeCalendar } from "./adsPreparedCampaignSettings.ts";
import type { AdsCampaignInput } from "./adsValidation.ts";

/** Completeness of a preparation brief, never permission to publish or spend. */
export function preparedAdsReviewIssues(draft: AdsCampaignInput, now = Date.now(), timeZone = "Europe/Paris"): string[] {
  if (draft.provider !== "x" && draft.provider !== "tiktok") return ["Ce contrôle concerne les brouillons X et TikTok."];
  const issues: string[] = [];
  if (draft.name.trim().length < 3 || !draft.offer.trim()) issues.push("Précisez le nom et l’offre à l’étape Campagne.");
  if (!draft.targetLocations.length) issues.push("Précisez les lieux à l’étape Zones géographiques ; leurs identifiants seront vérifiés au branchement.");
  if (!draft.targetAudiences.some((value) => value.trim())) issues.push("Précisez les clients visés à l’étape Audience.");
  const settings = draft.channelSettings;
  if (!settings || settings.channel !== draft.provider) issues.push("Choisissez l’objectif et le format du canal.");
  const body = draft.primaryText.trim();
  const xLength = Array.from(body.replace(/https?:\/\/[^\s]+/g, "")).length + (body.match(/https?:\/\/[^\s]+/g) || []).length * 23;
  if (!body || draft.provider === "tiktok" && Array.from(body).length > 100 || draft.provider === "x" && xLength > 280) issues.push("Vérifiez le texte à l’étape Annonce et sa longueur pour le canal.");
  if (settings?.channel === "x" && settings.targetingMode === "keywords" && !draft.keywords.length) issues.push("Ajoutez les mots-clés X proposés pour ce mode de ciblage.");
  const mediaRequired = settings?.channel !== "x" || settings.format !== "text";
  if (mediaRequired && !(draft.creativeUrl?.trim() || draft.imageUrl.trim())) issues.push("Ajoutez le média prévu pour votre annonce.");
  if (draft.provider === "tiktok" && draft.creativeType !== "video") issues.push("Ce parcours TikTok prépare une vidéo publicitaire.");
  const websiteRequired = settings?.channel === "tiktok" ? settings.destinationKind === "website" : draft.conversionLocation === "website";
  if (websiteRequired) {
    try {
      const url = new URL(draft.destinationUrl);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error();
    } catch { issues.push("Précisez un lien HTTPS valide à l’étape Destination et suivi."); }
  }
  try { plannedNativeCalendar(draft, now, timeZone); }
  catch (error) { issues.push(error instanceof Error ? error.message : "Vérifiez le budget et le calendrier."); }
  return issues;
}
