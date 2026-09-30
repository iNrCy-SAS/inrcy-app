import type {
  AdsCampaignType,
  AdsChannelId,
  AdsMediaStrategy,
  AdsMetaCreativeAssets,
  AdsMetaPlacement,
} from "./adsValidation.ts";
import type { AiMediaOutputFormat } from "./aiMediaGenerationContracts.ts";

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

export type MetaAdsImageContext = {
  offer: string;
  name: string;
  brand?: string;
  primaryText?: string;
  callToAction?: string;
  targetAudiences: string[];
  mediaBrief: string;
};

export const META_ADS_CREATIVE_SPECS = {
  feed: {
    outputFormat: "portrait",
    aspectRatio: "4:5",
    width: 1_080,
    height: 1_350,
  },
  storyReel: {
    outputFormat: "story",
    aspectRatio: "9:16",
    width: 1_080,
    height: 1_920,
  },
} as const;

// Studio currently normalizes portrait images to 4:5. Do not request a 2:3
// composition that this shared pipeline would crop or replace with a square.
export const PINTEREST_ADS_IMAGE_SPEC = {
  outputFormat: "portrait",
  aspectRatio: "4:5",
  width: 1_080,
  height: 1_350,
} as const;

export function adsMediaFormatForPlan(
  plan: Pick<PlannedMedia, "provider" | "campaignType">,
  kind: "image" | "video",
): AiMediaOutputFormat {
  if (kind === "video") return plan.campaignType === "video" ? "landscape" : "story";
  if (plan.provider === "pinterest") return PINTEREST_ADS_IMAGE_SPEC.outputFormat;
  if (plan.campaignType.startsWith("meta_")) return "portrait";
  return "square";
}

export function pinterestAdsImagePrompt(context: MetaAdsImageContext): string {
  const requirements = [
    "Crée une seule image publicitaire Pinterest verticale au format portrait 4:5 (1080 × 1350 px).",
    "Une scène d’inspiration professionnelle, nette et lisible sur mobile : mets en valeur l’offre réelle et son contexte d’usage, avec une composition verticale et des marges autour du sujet essentiel.",
    "Aucun texte incrusté, logo ajouté, filigrane, bordure, faux avant/après ni preuve inventée. Une scène générée est une illustration, jamais une réalisation client attestée.",
  ].join(" ");
  const reminder = "Le format final 4:5 et ces contraintes priment sur toute consigne contradictoire du brief.";
  const subject = [
    `Offre réelle à illustrer : ${(context.offer || context.brand || context.name).slice(0, 280)}.`,
    context.primaryText && `Intention de l’annonce, sans l’écrire dans l’image : ${context.primaryText.slice(0, 300)}.`,
    context.targetAudiences.length && `Public visé : ${context.targetAudiences.slice(0, 2).map((audience) => audience.slice(0, 90)).join(", ")}.`,
    context.mediaBrief && `Direction visuelle, uniquement si compatible avec le format final 4:5 : ${context.mediaBrief.slice(0, 450)}.`,
  ].filter(Boolean).join(" ");
  return [requirements, subject.slice(0, 1_800 - requirements.length - reminder.length - 2), reminder].join(" ");
}

export const META_ADS_FEED_IMAGE_REQUIREMENTS = [
  "Crée uniquement UNE image publicitaire Meta Feed verticale 4:5 (1080 × 1350 px), jamais une vidéo.",
  "Photographie ou illustration professionnelle, nette et immédiatement lisible dans les fils Facebook et Instagram. Le sujet principal et les éléments importants restent dans la zone centrale.",
  "Aucun texte lisible, prix, appel à l’action, logo ajouté, filigrane, collage ou bordure : le texte et le bouton sont ajoutés séparément par l’annonce Meta.",
  "L’image doit représenter fidèlement l’offre et la page de destination, sans résultat garanti, attribut inventé ni contenu sensible ou trompeur.",
].join(" ");

export const META_ADS_STORY_REEL_IMAGE_REQUIREMENTS = [
  "Crée uniquement UNE image publicitaire Meta Story/Reel plein écran 9:16 (1080 × 1920 px), jamais une vidéo.",
  "Composition verticale professionnelle et immersive pour Facebook et Instagram. Garde le sujet, le produit et toute information visuelle essentielle dans la zone centrale, avec des zones dégagées en haut et en bas pour l’interface Meta.",
  "Aucun texte lisible, prix, appel à l’action, logo ajouté, filigrane, collage ou bordure : le texte et le bouton sont ajoutés séparément par l’annonce Meta.",
  "L’image doit représenter fidèlement l’offre et la page de destination, sans résultat garanti, attribut inventé ni contenu sensible ou trompeur.",
].join(" ");

const META_FEED_PLACEMENTS = new Set<AdsMetaPlacement>(["facebook_feed", "instagram_feed"]);
const META_STORY_REEL_PLACEMENTS = new Set<AdsMetaPlacement>(["stories", "reels"]);
const META_SUPPORTED_IMAGE_PLACEMENTS = new Set<AdsMetaPlacement>([
  ...META_FEED_PLACEMENTS,
  ...META_STORY_REEL_PLACEMENTS,
]);

export type MetaCreativeAssetReadiness = {
  ready: boolean;
  hasPlacement: boolean;
  requiresFeedImage: boolean;
  requiresStoryReelImage: boolean;
  missingAssets: (keyof AdsMetaCreativeAssets)[];
  unsupportedPlacements: AdsMetaPlacement[];
  reusesSameImageAcrossFormats: boolean;
};

/**
 * Preserve a format that was generated successfully when the second Meta
 * format fails. Empty generator results must never erase an accepted asset.
 */
export function mergeMetaCreativeAssetUrls(
  current: Partial<AdsMetaCreativeAssets> | null | undefined,
  generated: Partial<AdsMetaCreativeAssets> | null | undefined,
): AdsMetaCreativeAssets {
  return {
    feedImageUrl: generated?.feedImageUrl?.trim() || current?.feedImageUrl?.trim() || "",
    storyReelImageUrl: generated?.storyReelImageUrl?.trim() || current?.storyReelImageUrl?.trim() || "",
  };
}

function metaAdsImageSubjectPrompt(context: MetaAdsImageContext): string {
  const offer = (context.offer || context.brand || context.name).slice(0, 280);
  return [
    `Représente précisément cette offre ou ce service réel : ${offer}.`,
    context.primaryText && `Promesse de l’annonce à traduire visuellement, sans l’écrire dans l’image : ${context.primaryText.slice(0, 260)}.`,
    context.targetAudiences.length && `Public visé : ${context.targetAudiences.slice(0, 2).map((audience) => audience.slice(0, 90)).join(", ")}.`,
    context.callToAction && `Action attendue après l’annonce : ${context.callToAction.slice(0, 80)}.`,
    context.mediaBrief && `Direction visuelle suggérée, seulement si elle respecte les contraintes Meta Ads : ${context.mediaBrief.slice(0, 240)}.`,
  ].filter(Boolean).join(" ").slice(0, 1_100);
}

function metaAdsImagePrompt(requirements: string, context: MetaAdsImageContext): string {
  const reminder = "Ces contraintes publicitaires et de format priment sur toute direction visuelle contradictoire du brief.";
  const subjectLimit = 1_800 - requirements.length - reminder.length - 2;
  return [requirements, metaAdsImageSubjectPrompt(context).slice(0, subjectLimit), reminder].join(" ");
}

export function metaFeedImagePrompt(context: MetaAdsImageContext): string {
  return metaAdsImagePrompt(META_ADS_FEED_IMAGE_REQUIREMENTS, context);
}

export function metaStoryReelImagePrompt(context: MetaAdsImageContext): string {
  return metaAdsImagePrompt(META_ADS_STORY_REEL_IMAGE_REQUIREMENTS, context);
}

/**
 * A Feed asset must never be silently stretched into a Story/Reel placement.
 * Existing Feed-only drafts remain compatible through the legacy `imageUrl`
 * fallback while every vertical placement requires its dedicated 9:16 asset.
 */
export function assessMetaCreativeAssetReadiness(input: {
  metaPlacements: readonly AdsMetaPlacement[];
  metaCreativeAssets?: Partial<AdsMetaCreativeAssets> | null;
  imageUrl?: string | null;
}): MetaCreativeAssetReadiness {
  const placements = Array.from(new Set(input.metaPlacements));
  const hasPlacement = placements.length > 0;
  const requiresFeedImage = placements.some((placement) => META_FEED_PLACEMENTS.has(placement));
  const requiresStoryReelImage = placements.some((placement) => META_STORY_REEL_PLACEMENTS.has(placement));
  const unsupportedPlacements = placements.filter((placement) => !META_SUPPORTED_IMAGE_PLACEMENTS.has(placement));
  const feedImageUrl = input.metaCreativeAssets?.feedImageUrl?.trim() || input.imageUrl?.trim() || "";
  const storyReelImageUrl = input.metaCreativeAssets?.storyReelImageUrl?.trim() || "";
  const missingAssets: (keyof AdsMetaCreativeAssets)[] = [];
  if (requiresFeedImage && !feedImageUrl) missingAssets.push("feedImageUrl");
  if (requiresStoryReelImage && !storyReelImageUrl) missingAssets.push("storyReelImageUrl");
  const reusesSameImageAcrossFormats = requiresFeedImage && requiresStoryReelImage &&
    Boolean(feedImageUrl) && feedImageUrl === storyReelImageUrl;
  return {
    ready: hasPlacement && unsupportedPlacements.length === 0 && missingAssets.length === 0 && !reusesSameImageAcrossFormats,
    hasPlacement,
    requiresFeedImage,
    requiresStoryReelImage,
    missingAssets,
    unsupportedPlacements,
    reusesSameImageAcrossFormats,
  };
}

export function metaCreativeAssetReadinessReason(readiness: MetaCreativeAssetReadiness): string | null {
  if (!readiness.hasPlacement) {
    return "Sélectionnez au moins un placement Meta Ads.";
  }
  if (readiness.unsupportedPlacements.length > 0) {
    return "La publication Meta Ads accepte les fils Facebook/Instagram, les Stories et les Reels, mais pas Messenger.";
  }
  const feedMissing = readiness.missingAssets.includes("feedImageUrl");
  const storyReelMissing = readiness.missingAssets.includes("storyReelImageUrl");
  if (feedMissing && storyReelMissing) {
    return "Ajoutez une image Meta Feed 4:5 et une image Story/Reel 9:16 avant publication.";
  }
  if (feedMissing) return "Ajoutez une image Meta Feed 4:5 avant publication.";
  if (storyReelMissing) return "Ajoutez une image Meta Story/Reel 9:16 avant publication.";
  if (readiness.reusesSameImageAcrossFormats) {
    return "Utilisez deux images Meta distinctes : une Feed 4:5 et une Story/Reel 9:16, sans recadrage implicite.";
  }
  return null;
}

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

/** The current Search publisher creates responsive text ads only. Google Ads
 * rejects AD_IMAGE links for this account, so do not spend a Studio credit on
 * an image that the publisher cannot attach to the campaign. */
export function shouldGenerateAdsMedia(plan: PlannedMedia): boolean {
  if (plan.mediaStrategy === "product_feed") return false;
  if (plan.provider === "google" && plan.campaignType === "search") return false;
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
