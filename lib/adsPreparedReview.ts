import { plannedNativeCalendar } from "./adsPreparedCampaignSettings.ts";
import type { AdsCampaignInput } from "./adsValidation.ts";
import type { AdsDraftStepKey } from "./adsDraftNavigation.ts";

export type PreparedAdsReviewIssue = { step: AdsDraftStepKey; message: string };

/** Completeness of a preparation brief, never permission to publish or spend. */
export function preparedAdsReviewDetails(draft: AdsCampaignInput, now = Date.now(), timeZone = "Europe/Paris"): PreparedAdsReviewIssue[] {
  if (draft.provider !== "x" && draft.provider !== "tiktok") return [{ step: "foundations", message: "Ce contrôle concerne les brouillons X et TikTok." }];
  const issues: PreparedAdsReviewIssue[] = [];
  const add = (step: AdsDraftStepKey, message: string) => issues.push({ step, message });
  if (draft.name.trim().length < 3 || !draft.offer.trim()) add("foundations", "Précisez le nom et l’offre à l’étape Campagne.");
  if (!draft.targetLocations.length) add("geography", "Précisez les lieux à l’étape Zones géographiques ; leurs identifiants seront vérifiés au branchement.");
  if (!draft.targetAudiences.some((value) => value.trim())) add("targeting", "Précisez les clients visés à l’étape Audience.");
  const settings = draft.channelSettings;
  if (!settings || settings.channel !== draft.provider) add("foundations", "Choisissez l’objectif et le format du canal.");
  const body = draft.primaryText.trim();
  const xLength = Array.from(body.replace(/https?:\/\/[^\s]+/g, "")).length + (body.match(/https?:\/\/[^\s]+/g) || []).length * 23;
  if (!body || draft.provider === "tiktok" && Array.from(body).length > 100 || draft.provider === "x" && xLength > 280) add("creative", "Vérifiez le texte à l’étape Annonce et sa longueur pour le canal.");
  if (settings?.channel === "x" && settings.targetingMode === "keywords" && !draft.keywords.length) add("keywords", "Ajoutez les mots-clés X proposés pour ce mode de ciblage.");
  const mediaRequired = settings?.channel !== "x" || settings.format !== "text";
  if (mediaRequired && !(draft.creativeUrl?.trim() || draft.imageUrl.trim())) add("media", "Ajoutez le média prévu pour votre annonce.");
  if (draft.provider === "tiktok" && draft.creativeType !== "video") add("media", "Ce parcours TikTok prépare une vidéo publicitaire.");
  const websiteRequired = settings?.channel === "tiktok" ? settings.destinationKind === "website" : draft.conversionLocation === "website";
  if (websiteRequired) {
    try {
      const url = new URL(draft.destinationUrl);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error();
    } catch { add("delivery", "Précisez un lien HTTPS valide à l’étape Destination et suivi."); }
  }
  try { plannedNativeCalendar(draft, now, timeZone); }
  catch (error) { add("budget", error instanceof Error ? error.message : "Vérifiez le budget et le calendrier."); }
  return issues;
}

export function preparedAdsReviewIssues(draft: AdsCampaignInput, now = Date.now(), timeZone = "Europe/Paris"): string[] {
  return preparedAdsReviewDetails(draft, now, timeZone).map((issue) => issue.message);
}
