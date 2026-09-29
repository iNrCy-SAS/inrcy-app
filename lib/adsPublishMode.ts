import type { AdsCampaignInput } from "@/lib/adsValidation";
import {
  assessMetaCreativeAssetReadiness,
  metaCreativeAssetReadinessReason,
} from "./adsCampaignMediaPolicy.ts";

export type AdsPublishMode = "live" | "demo_paused";

export const ADS_LIVE_PUBLISH_CONFIRMATION = "PUBLIER_ET_DEPENSER";
export const ADS_PAUSED_DEMO_CONFIRMATION = "CREER_DEMO_EN_PAUSE";

type AdsPublishEnvironment = Record<string, string | undefined>;

/**
 * Unknown request values always resolve to the live path. That path stays
 * locked unless its own explicit environment flag and confirmation are set.
 */
export function parseAdsPublishMode(value: unknown): AdsPublishMode {
  return value === "demo_paused" ? "demo_paused" : "live";
}

export function isAdsPublishModeEnabled(mode: AdsPublishMode, environment: AdsPublishEnvironment): boolean {
  return mode === "demo_paused"
    ? environment.INRCY_ADS_DEMO_PAUSED_PUBLISH_ENABLED === "true"
    : environment.INRCY_ADS_LIVE_PUBLISH_ENABLED === "true";
}

export function hasAdsPublishConfirmation(mode: AdsPublishMode, value: unknown): boolean {
  return mode === "demo_paused"
    ? value === ADS_PAUSED_DEMO_CONFIRMATION
    : value === ADS_LIVE_PUBLISH_CONFIRMATION;
}

type ConnectorDraft = Pick<AdsCampaignInput,
  "provider" | "campaignType" | "objective" | "conversionGoal" | "conversionLocation" | "bidStrategy" |
  "metaPlacements" | "callToAction" | "mediaStrategy" | "creativeType" | "channelSettings"> &
  Partial<Pick<AdsCampaignInput, "imageUrl" | "creativeUrl" | "metaCreativeAssets">>;

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
