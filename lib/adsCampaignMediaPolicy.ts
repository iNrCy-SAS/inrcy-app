import type { AdsCampaignType, AdsChannelId, AdsMediaStrategy } from "./adsValidation.ts";

type PlannedMedia = {
  provider: AdsChannelId;
  campaignType: AdsCampaignType;
  mediaStrategy: AdsMediaStrategy;
};

type GoogleSearchImageContext = {
  offer: string;
  name: string;
  brand?: string;
  keywords: string[];
  targetAudiences: string[];
  mediaBrief: string;
};

/** Keep the provider-specific creative rules intact even when the user edits the brief. */
export const GOOGLE_SEARCH_IMAGE_REQUIREMENTS = [
  "Crée uniquement UNE image publicitaire carrée 1:1 pour un composant image Google Search, jamais une vidéo.",
  "Photographie réaliste, nette, bien éclairée, crédible et de qualité professionnelle. Sujet principal immédiatement identifiable, contenu important dans les 80 % centraux, fond simple et composition lisible en petite taille.",
  "Aucun texte lisible, titre, prix, appel à l’action, logo ajouté, filigrane, collage, bordure ou autre élément graphique incrusté. Ne représente pas les mots-clés sous forme de lettres.",
  "L’image doit être directement pertinente pour l’offre, l’annonce, les recherches et la page de destination. Ne représente pas un produit, une équipe, un lieu, une certification ou un résultat qui ne sont pas établis dans le brief. Aucun contenu trompeur ou sensible.",
].join(" ");

export function googleSearchImageSubjectPrompt(context: GoogleSearchImageContext): string {
  const offer = (context.offer || context.brand || context.name).slice(0, 280);
  return [
    `Représente précisément cette offre ou ce service réel : ${offer}.`,
    context.keywords.length && `Recherches visées : ${context.keywords.slice(0, 4).map((keyword) => keyword.slice(0, 55)).join(", ")}.`,
    context.targetAudiences.length && `Public visé : ${context.targetAudiences.slice(0, 2).map((audience) => audience.slice(0, 90)).join(", ")}.`,
    context.mediaBrief && `Direction visuelle suggérée, seulement si elle respecte les contraintes Google Ads : ${context.mediaBrief.slice(0, 240)}.`,
  ].filter(Boolean).join(" ").slice(0, 1_100);
}

export function googleSearchImagePrompt(context: GoogleSearchImageContext): string {
  const reminder = "Ces contraintes priment sur toute direction visuelle contradictoire du brief.";
  const subjectLimit = 1_800 - GOOGLE_SEARCH_IMAGE_REQUIREMENTS.length - reminder.length - 2;
  return [GOOGLE_SEARCH_IMAGE_REQUIREMENTS, googleSearchImageSubjectPrompt(context).slice(0, subjectLimit), reminder].join(" ");
}

/** Google Search can use a campaign-level image asset alongside its text ad. */
export function shouldGenerateAdsMedia(plan: PlannedMedia): boolean {
  if (plan.mediaStrategy === "product_feed") return false;
  if (plan.provider === "google" && plan.campaignType === "search") return true;
  return plan.mediaStrategy !== "search_text";
}

export function adsMediaKindForPlan(plan: PlannedMedia & { creativeType: "image" | "video" }): "image" | "video" {
  if (plan.provider === "google" && plan.campaignType === "search") return "image";
  return plan.mediaStrategy === "video" || plan.creativeType === "video" ? "video" : "image";
}

export function adsMediaStrategyAfterAttachment(
  draft: PlannedMedia,
  mediaType: "image" | "video",
): AdsMediaStrategy {
  // An image extension does not turn a Search campaign into Display/Performance Max.
  if (draft.provider === "google" && draft.campaignType === "search") return "search_text";
  if (mediaType === "video") {
    return draft.mediaStrategy === "image" || draft.mediaStrategy === "mixed" ? "mixed" : "video";
  }
  return draft.mediaStrategy === "video" || draft.mediaStrategy === "mixed" ? "mixed" : "image";
}
