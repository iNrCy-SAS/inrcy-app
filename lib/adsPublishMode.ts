import type { AdsCampaignInput } from "@/lib/adsValidation";
import {
  assessMetaCreativeAssetReadiness,
  metaCreativeAssetReadinessReason,
} from "./adsCampaignMediaPolicy.ts";

export type AdsPublishMode = "live" | "paused" | "demo_paused";

export const ADS_LIVE_PUBLISH_CONFIRMATION = "PUBLIER_ET_DEPENSER";
export const ADS_PAUSED_PUBLISH_CONFIRMATION = "CREER_CAMPAGNE_EN_PAUSE";
export const ADS_PAUSED_DEMO_CONFIRMATION = "CREER_DEMO_EN_PAUSE";

type AdsPublishEnvironment = Record<string, string | undefined>;

/**
 * Unknown request values resolve to the live path, which always requires
 * explicit spending confirmation and an enabled provider.
 */
export function parseAdsPublishMode(value: unknown): AdsPublishMode {
  if (value === "paused" || value === "demo_paused") return value;
  return "live";
}

export function isAdsPublishModeEnabled(mode: AdsPublishMode, environment: AdsPublishEnvironment): boolean {
  return mode === "demo_paused"
    ? environment.INRCY_ADS_DEMO_PAUSED_PUBLISH_ENABLED === "true"
    : environment.INRCY_ADS_LIVE_PUBLISH_ENABLED === "true";
}

/** Approved channels have independent kill switches; pilot flags do not unlock other providers. */
export function isAdsChannelPublishEnabled(provider: string, mode: AdsPublishMode, environment: AdsPublishEnvironment): boolean {
  if (provider === "google") return environment.INRCY_GOOGLE_ADS_PUBLISH_ENABLED !== "false";
  if (provider === "pinterest") return environment.INRCY_PINTEREST_ADS_PUBLISH_ENABLED !== "false";
  if (provider === "linkedin") return environment.INRCY_LINKEDIN_ADS_PUBLISH_ENABLED === "true";
  // ChatGPT Ads always creates the complete hierarchy in Paused state first.
  // Live activation has its own emergency kill switch and an additional billing
  // confirmation at the route boundary; the paused path remains independently
  // reversible. A missing switch does not block the approved Premium rollout.
  if (provider === "openai") {
    if (mode === "live") return environment.INRCY_OPENAI_ADS_LIVE_PUBLISH_ENABLED !== "false";
    if (mode === "paused") return environment.INRCY_OPENAI_ADS_PAUSED_PUBLISH_ENABLED !== "false";
    return false;
  }
  return provider === "meta" && isAdsPublishModeEnabled(mode, environment);
}

/** A confirmed 400 before any provider ID is editable; uncertain responses need manual review. */
export function openaiDraftRetrySafe(input: {
  mutationStarted: boolean;
  httpStatus?: number;
  resources: Record<string, unknown>;
}): boolean {
  const hasRemoteResource = ["campaignId", "adGroupId", "imageFileId", "adId"]
    .some((key) => Boolean(input.resources[key]));
  return !hasRemoteResource && (!input.mutationStarted || input.httpStatus === 400);
}

export function hasAdsPublishConfirmation(mode: AdsPublishMode, value: unknown): boolean {
  if (mode === "demo_paused") return value === ADS_PAUSED_DEMO_CONFIRMATION;
  if (mode === "paused") return value === ADS_PAUSED_PUBLISH_CONFIRMATION;
  return value === ADS_LIVE_PUBLISH_CONFIRMATION;
}

type ConnectorDraft = Pick<AdsCampaignInput,
  "provider" | "campaignType" | "objective" | "conversionGoal" | "conversionLocation" | "bidStrategy" |
  "metaPlacements" | "callToAction" | "mediaStrategy" | "creativeType" | "channelSettings"> &
  Partial<Pick<AdsCampaignInput, "imageUrl" | "creativeUrl" | "metaCreativeAssets" | "keywords" |
    "targetLocations" | "headlines" | "primaryText" | "openaiBidEuros" | "trackingParameters" | "negativeKeywords">>;

/** The first Google Search adapter has no numeric CPA/ROAS target input. */
export function googleSearchBiddingFields(strategy: AdsCampaignInput["bidStrategy"]): Record<string, object> | null {
  switch (strategy) {
    case "maximize_conversions": return { maximizeConversions: {} };
    case "maximize_clicks": return { targetSpend: {} };
    case "maximize_value": return { maximizeConversionValue: {} };
    default: return null;
  }
}

/** Reject choices that the first live adapters would otherwise silently replace. */
export function unsupportedAdsConnectorReason(draft: ConnectorDraft): string | null {
  if (draft.provider === "google") {
    if (draft.campaignType !== "search") {
      return "La publication Google Ads prend actuellement en charge le Réseau de recherche uniquement.";
    }
    if (!googleSearchBiddingFields(draft.bidStrategy)) {
      return "La stratégie Google Ads choisie requiert une cible CPA/ROAS ou une configuration manuelle non disponible dans ce connecteur. Choisissez Maximiser les conversions, les clics ou la valeur.";
    }
    return null;
  }
  if (draft.provider === "pinterest") {
    const settings = draft.channelSettings?.channel === "pinterest" ? draft.channelSettings : null;
    if (!settings) return "Choisissez les réglages Pinterest avant le lancement.";
    if (settings.objectiveType !== "AWARENESS" && settings.objectiveType !== "CONSIDERATION") {
      return "Le lancement Pinterest prend actuellement en charge les objectifs Notoriété et Considération. Les objectifs Vues vidéo, Ventes et Prospects restent disponibles en brouillon.";
    }
    if (settings.targetingMode !== "automatic") {
      return "Le lancement Pinterest prend actuellement en charge le ciblage automatique Pinterest. Les intérêts, mots-clés et audiences restent enregistrables en brouillon jusqu’à leur sélection vérifiée dans le compte.";
    }
    if (draft.keywords?.length) {
      return "Les mots-clés Pinterest ne sont pas publiables automatiquement pour le moment. Retirez-les du lancement réel ou conservez cette configuration en brouillon.";
    }
    if (settings.intendedPromotionType !== "STANDARD_AD" || settings.creativeType !== "REGULAR") {
      return "Le lancement Pinterest prend actuellement en charge une épingle sponsorisée image. Les vidéos, carrousels et catalogues restent disponibles en brouillon.";
    }
    if (draft.mediaStrategy !== "image" || draft.creativeType !== "image") {
      return "Le lancement Pinterest nécessite actuellement une image unique.";
    }
    if (!String(draft.creativeUrl || draft.imageUrl || "").trim()) {
      return "Ajoutez l’image de l’épingle Pinterest avant le lancement.";
    }
    return null;
  }
  if (draft.provider === "linkedin") {
    const settings = draft.channelSettings?.channel === "linkedin" ? draft.channelSettings : null;
    if (!settings || settings.objectiveType !== "WEBSITE_VISIT" || settings.format !== "STANDARD_UPDATE") {
      return "Le lancement LinkedIn prend actuellement en charge une campagne Visites du site avec une image sponsorisée uniquement.";
    }
    if (draft.mediaStrategy !== "image" || draft.creativeType !== "image") {
      return "Le lancement LinkedIn nécessite actuellement une image unique.";
    }
    if (!String(draft.creativeUrl || draft.imageUrl || "").trim()) {
      return "Ajoutez l’image sponsorisée LinkedIn avant le lancement.";
    }
    return null;
  }
  if (draft.provider === "openai") {
    if (draft.campaignType !== "generic" || draft.objective !== "website_traffic"
      || draft.conversionGoal !== "website_visit" || draft.bidStrategy !== "manual_review") {
      return "Le premier parcours ChatGPT Ads prépare une carte image pour obtenir des clics vers le site.";
    }
    if (draft.conversionLocation !== "website" || draft.mediaStrategy !== "image" || draft.creativeType !== "image") {
      return "ChatGPT Ads requiert une carte image et une page de destination HTTPS dans ce parcours.";
    }
    if (!draft.targetLocations?.length) return "Choisissez au moins une zone exacte pour ChatGPT Ads.";
    if (!draft.imageUrl && !draft.creativeUrl) return "Ajoutez une image pour la carte ChatGPT Ads.";
    if (draft.headlines?.length !== 1 || !draft.headlines[0] || draft.headlines[0].length < 3 || draft.headlines[0].length > 50) {
      return "La carte ChatGPT Ads requiert un seul titre de 3 à 50 caractères.";
    }
    if (!draft.primaryText || draft.primaryText.length > 100) {
      return "La carte ChatGPT Ads requiert un texte de 1 à 100 caractères.";
    }
    if (!draft.openaiBidEuros || draft.openaiBidEuros <= 0) {
      return "Définissez une enchère maximale par clic avant la création sur ChatGPT Ads.";
    }
    if (draft.trackingParameters?.trim() || draft.keywords?.length || draft.negativeKeywords?.length || draft.callToAction.trim()) {
      return "Retirez les paramètres de suivi, mots-clés et appels à l’action : ce parcours ChatGPT Ads ne les transmet pas.";
    }
    return null;
  }
  if (draft.provider !== "meta") return "La publication de ce canal n’est pas encore disponible.";
  if (draft.campaignType !== "meta_traffic" || draft.objective !== "website_traffic") {
    return "La publication Meta Ads prend actuellement en charge les campagnes Trafic vers un site web uniquement.";
  }
  if (draft.conversionLocation !== "website" || draft.conversionGoal !== "website_visit") {
    return "La publication Meta Ads mesure actuellement les visites du site web uniquement.";
  }
  if (draft.mediaStrategy !== "image" || draft.creativeType !== "image") {
    return "La publication Meta Ads utilise actuellement une image uniquement.";
  }
  const mediaReadinessReason = metaCreativeAssetReadinessReason(assessMetaCreativeAssetReadiness({
    metaPlacements: draft.metaPlacements,
    metaCreativeAssets: draft.metaCreativeAssets,
    imageUrl: draft.imageUrl,
  }));
  if (mediaReadinessReason) return mediaReadinessReason;
  const callToAction = draft.callToAction.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!["en savoir plus", "decouvrir", "learn more"].includes(callToAction)) {
    return "L’appel à l’action Meta Ads publié actuellement est « En savoir plus ». Adaptez votre brouillon avant publication.";
  }
  return null;
}
