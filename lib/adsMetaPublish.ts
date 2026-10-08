import "server-only";

import { listMetaPages, metaAdsJson } from "./adsServer.ts";
import {
  metaCreativeAssetUrls,
  metaPlacementTargeting,
  metaPlacementsNeedInstagramIdentity,
  type MetaAdsPlacement,
} from "./adsMetaPlacement.ts";
import {
  executeMetaAdsGraphPublish,
  resolveMetaAdsPublishTargeting,
  metaUrlTags,
  MetaAdsPublishError,
  type PersistMetaAdsProgress,
  type MetaAdsGraphPublishInput,
} from "./adsMetaPublishCore.ts";
import { metaNativeDelivery } from "./adsMetaCampaignSettings.ts";
import { metaAdsResourcesConsentKey, resolveMetaAdsLanguages, type MetaAdsResources } from "./adsMetaResources.ts";
import { readMetaAdsDeliveryResources, verifyMetaAdsGeoTargets, metaAdsDeliveryContext, MetaAdsPreparationError } from "./adsMetaResourcesServer.ts";
import { prepareMetaCreativeImageForUpload } from "./adsMetaCreativeImageServer.ts";
import type { AdsCampaignInput } from "./adsValidation.ts";
import { verifyMediaLibraryContentToken } from "./mediaLibraryContentUrl.ts";
import { createSafeStorageSignedUrl } from "./safeStorageSignedUrl.ts";
import { supabaseAdmin } from "./supabaseAdmin.ts";

const MAX_META_IMAGE_BYTES = 30 * 1024 * 1024;

type MetaCreativeAssets = {
  feedImageUrl?: string;
  storyReelImageUrl?: string;
};

type MetaAdsCampaignDraft = AdsCampaignInput & {
  noSpecialCategoryConfirmed?: boolean;
  metaCreativeAssets?: MetaCreativeAssets;
};

export { MetaAdsPublishError };
export type {
  MetaAdsImageResource,
  MetaAdsPublishProgress,
  MetaAdsPublishStage,
  PersistMetaAdsProgress,
} from "./adsMetaPublishCore.ts";

/**
 * Meta's campaign → ad set → creative → ad hierarchy is created paused.
 * The campaign is activated last so no delivery can start before all IDs are
 * durably recorded by the caller.
 * https://www.postman.com/meta/facebook-marketing-api/documentation/9jo4f5y/mapi-onboarding
 */
export type MetaAdsPublishOptions = {
  /** A review demonstration must never activate provider resources. */
  activate?: boolean;
  /**
   * Called immediately before the first Graph mutation. The route uses this
   * boundary to distinguish a safe, retryable preflight rejection from an
   * ambiguous provider failure that must be reconciled in Ads Manager.
   */
  onProviderMutationStart?: () => void;
};

function safeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return url.protocol === "https:" && !url.username && !url.password &&
      Boolean(hostname) && hostname !== "localhost" && !hostname.endsWith(".localhost") &&
      !hostname.endsWith(".local") && !hostname.endsWith(".internal") &&
      !/^(?:0|10|127|169\.254|192\.168)\./.test(hostname) &&
      !/^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) &&
      hostname !== "::1";
  } catch {
    return false;
  }
}

async function downloadMetaImageBytes(imageUrl: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(imageUrl, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new MetaAdsPreparationError("Le visuel Meta n’a pas pu être téléchargé. Utilisez une image HTTPS directement accessible, sans redirection.");
  }
  if (!response.ok) {
    throw new MetaAdsPreparationError("Le visuel Meta n’a pas pu être téléchargé avant son import dans Ads Manager.");
  }
  const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new MetaAdsPreparationError("Le fichier préparé pour Meta n’est pas une image valide.");
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_META_IMAGE_BYTES) {
    throw new MetaAdsPreparationError("Le visuel Meta dépasse la limite de 30 Mo.");
  }
  if (!response.body) throw new MetaAdsPreparationError("Le visuel Meta téléchargé est vide.");

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_META_IMAGE_BYTES) throw new MetaAdsPreparationError("Le visuel Meta dépasse la limite de 30 Mo.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new MetaAdsPreparationError("Le visuel Meta téléchargé est vide.");
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function mediaLibraryIdFromPrivateUrl(value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/")) return null;
  try {
    const url = new URL(raw, "https://inrcy-media.local");
    if (url.origin !== "https://inrcy-media.local") return null;
    const match = url.pathname.match(/^\/api\/media-library\/items\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content$/i);
    const id = match?.[1] || "";
    const token = url.searchParams.get("token") || "";
    return id && verifyMediaLibraryContentToken(id, token) ? id : null;
  } catch {
    return null;
  }
}

/**
 * iNrCy keeps library objects private. Meta cannot use the app-relative
 * preview URL because its crawler has no iNrCy session, so resolve it here to
 * a short-lived Storage URL just before the creative is created.
 */
async function resolveMetaImageUrl(userId: string, imageUrl: string): Promise<string> {
  if (safeHttpsUrl(imageUrl)) return imageUrl;

  const mediaId = mediaLibraryIdFromPrivateUrl(imageUrl);
  if (!mediaId) {
    throw new MetaAdsPreparationError("Le visuel Meta doit être une URL HTTPS ou un média valide de votre médiathèque iNrCy.");
  }

  const { data: media, error } = await supabaseAdmin
    .from("pro_media_library")
    .select("bucket_name,storage_path,media_type,is_active")
    .eq("id", mediaId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !media || media.is_active === false) {
    throw new MetaAdsPreparationError("Le média sélectionné n’est plus disponible dans votre médiathèque iNrCy.");
  }
  if (media.media_type !== "image") {
    throw new MetaAdsPreparationError("Le connecteur Meta actuellement disponible attend une image. Choisissez une image dans iNr’Studio ou votre médiathèque.");
  }

  const publicUrl = await createSafeStorageSignedUrl(
    String(media.bucket_name || "inrcy-pro-media"),
    String(media.storage_path || ""),
    60 * 60,
  );
  if (!publicUrl || !safeHttpsUrl(publicUrl)) {
    throw new MetaAdsPreparationError("Le média iNrCy ne peut pas être préparé pour Meta pour le moment. Réessayez dans quelques instants.");
  }
  return publicUrl;
}

async function prepareMetaAdsPublication(
  userId: string,
  draft: MetaAdsCampaignDraft,
  activate: boolean,
) {
  if (draft.provider !== "meta") throw new MetaAdsPreparationError("Ce brouillon n’est pas une campagne Meta Ads.");
  if (draft.noSpecialCategoryConfirmed !== true) {
    throw new MetaAdsPreparationError("Confirmez que cette campagne ne relève pas d’une catégorie publicitaire spéciale Meta.");
  }
  if (!/^\d{5,25}$/.test(draft.adAccountId) || !/^\d{5,30}$/.test(draft.pageId)) {
    throw new MetaAdsPreparationError("Le compte publicitaire ou la Page Meta est invalide.");
  }
  if (draft.accountCurrency !== "EUR") throw new MetaAdsPreparationError("Seuls les comptes Meta en EUR sont pris en charge.");
  if (!safeHttpsUrl(draft.destinationUrl)) {
    throw new MetaAdsPreparationError("Le lien de destination Meta doit être une URL HTTPS publique.");
  }
  const context = draft.metaDeliverySettings ? await metaAdsDeliveryContext(userId) : "";
  const placements = draft.metaPlacements as MetaAdsPlacement[];
  const needsInstagramIdentity = metaPlacementsNeedInstagramIdentity(placements);
  const selectedAssets = metaCreativeAssetUrls({
    placements,
    imageUrl: draft.imageUrl,
    metaCreativeAssets: draft.metaCreativeAssets,
  });
  const urlTags = metaUrlTags(draft.trackingParameters);
  if (draft.name.trim().length < 3 || draft.primaryText.trim().length < 10) {
    throw new MetaAdsPreparationError("Le nom ou le texte de la campagne Meta est trop court.");
  }
  let delivery: ReturnType<typeof metaNativeDelivery>;
  try { delivery = metaNativeDelivery(draft); } catch (error) { throw new MetaAdsPreparationError(error instanceof Error ? error.message : "Vérifiez la diffusion Meta."); }
  if (draft.metaDeliverySettings && (draft.headlines.length !== 1 || draft.descriptions.length > 1 || draft.campaignType !== "meta_traffic" || draft.objective !== "website_traffic" || draft.conversionGoal !== "website_visit" || draft.conversionLocation !== "website" || draft.mediaStrategy !== "image" || draft.creativeType !== "image")) throw new MetaAdsPreparationError("Vérifiez le format image Trafic Meta, avec un titre et au maximum une description.");
  const accountPath = `act_${draft.adAccountId}`;
  let resources: MetaAdsResources | null = null;

  // Check the same token used for creation can access the chosen EUR account
  // and Page. Meta still validates the Page's advertising rights at creation.
  if (draft.metaDeliverySettings) resources = await readMetaAdsDeliveryResources(userId, draft.adAccountId, draft.pageId);
  const account = resources ? { id: resources.account.id, currency: resources.account.currency, account_status: resources.account.status } : await metaAdsJson(userId, `${accountPath}?fields=id,currency,account_status`);
  if (String(account.id ?? "").replace(/^act_/, "") !== draft.adAccountId) {
    throw new MetaAdsPreparationError("Ce compte publicitaire Meta n’est pas accessible avec la connexion actuelle.");
  }
  if (account.currency !== "EUR") throw new MetaAdsPreparationError("Le compte publicitaire Meta doit être en EUR.");
  if (Number(account.account_status) !== 1) {
    throw new MetaAdsPreparationError("Le compte publicitaire Meta n’est pas actif. Vérifiez-le dans Ads Manager.");
  }
  const pages = resources?.pages || await listMetaPages(userId);
  const page = pages.find((item) => item.id === draft.pageId);
  if (!page) {
    throw new MetaAdsPreparationError("Cette Page Facebook n’est pas autorisée par la connexion Meta Ads.");
  }
  const instagramUserId = page.instagramUserId || undefined;
  if (needsInstagramIdentity && !instagramUserId) {
    throw new MetaAdsPreparationError("Associez un compte Instagram professionnel à cette Page Facebook dans Meta Business Suite, puis actualisez la configuration iNr’ADS.");
  }
  if (needsInstagramIdentity) {
    // A linked Page alone does not prove that this ad account may advertise
    // with the Instagram identity. Check the account edge before any creation.
    const instagramAccounts = resources ? { data: resources.instagramAccountIds.map((id) => ({ id })) } : await metaAdsJson(userId, `${accountPath}/connected_instagram_accounts?fields=id&limit=100`);
    if (!(Array.isArray(instagramAccounts.data) ? instagramAccounts.data : []).some((item) =>
      String((item as Record<string, unknown>).id || "") === instagramUserId
    )) {
      throw new MetaAdsPreparationError("Le compte Instagram lié à cette Page n’est pas autorisé sur le compte publicitaire Meta sélectionné. Vérifiez son association dans Meta Business Suite, puis actualisez iNr’ADS.");
    }
  }

  // The review's local zones must be the actual ad-set geography. The shared
  // resolver rejects unknown/ambiguous locations instead of widening to France.
  const targeting: Record<string, unknown> = resources
    ? { ...metaPlacementTargeting(placements), geo_locations: await verifyMetaAdsGeoTargets(userId, draft.metaGeoTargets || [], draft.adAccountId), age_min: delivery.ageMin, ...(delivery.ageMax == null ? {} : { age_max: delivery.ageMax }) }
    : await resolveMetaAdsPublishTargeting(userId, placements, draft.targetLocations, metaAdsJson);
  let localeIds: number[] = [];
  try { localeIds = resources ? resolveMetaAdsLanguages(resources, draft.languages) : []; } catch (error) { throw new MetaAdsPreparationError(error instanceof Error ? error.message : "Vérifiez les langues Meta."); }
  if (localeIds.length) targeting.locales = localeIds;

  // Resolve and download only after the selected account and identities have
  // been rechecked. Each placement family is inspected independently from the
  // real image bytes, then normalized to Meta's exact recommended canvas. An
  // asset is never silently reused for the other placement family.
  const feedImageUrl = selectedAssets.feedImageUrl
    ? await resolveMetaImageUrl(userId, selectedAssets.feedImageUrl) : "";
  const storyReelImageUrl = selectedAssets.storyReelImageUrl
    ? await resolveMetaImageUrl(userId, selectedAssets.storyReelImageUrl) : "";
  const feedSourceBytes = feedImageUrl ? await downloadMetaImageBytes(feedImageUrl) : null;
  const storyReelSourceBytes = storyReelImageUrl ? await downloadMetaImageBytes(storyReelImageUrl) : null;
  const feedImageBytes = feedSourceBytes
    ? (await prepareMetaCreativeImageForUpload(feedSourceBytes, "feed")).buffer.toString("base64")
    : "";
  const storyReelImageBytes = storyReelSourceBytes
    ? (await prepareMetaCreativeImageForUpload(storyReelSourceBytes, "storyReel")).buffer.toString("base64")
    : "";

  if (context && context !== await metaAdsDeliveryContext(userId)) throw new MetaAdsPreparationError("Le compte, la connexion ou la Page Meta a changé pendant la préparation. Relancez la vérification.", 409);
  const input: MetaAdsGraphPublishInput = {
    userId,
    adAccountId: draft.adAccountId,
    pageId: draft.pageId,
    instagramUserId: needsInstagramIdentity ? instagramUserId : undefined,
    name: draft.name,
    destinationUrl: draft.destinationUrl,
    primaryText: draft.primaryText,
    headline: draft.headlines.find((headline) => headline.trim()) || draft.name,
    description: draft.descriptions.find((description) => description.trim()),
    dailyBudgetCents: delivery.dailyBudgetCents,
    endTime: delivery.endTime,
    ...(draft.metaDeliverySettings ? { lifetimeBudgetCents: delivery.lifetimeBudgetCents, budgetType: delivery.budgetType, startTime: delivery.startTime, bidStrategy: delivery.bidStrategy, bidAmountCents: delivery.bidAmountCents, callToAction: delivery.callToAction } : {}),
    placements,
    targeting,
    urlTags,
    feedImageBytes,
    storyReelImageBytes,
    activate,
  };
  return { input, check: { ready: true as const, selectedAccountId: draft.adAccountId, selectedPageId: draft.pageId, verifiedLocationCount: resources ? (draft.metaGeoTargets || []).length : draft.targetLocations.length, verifiedLanguageCount: localeIds.length, resourcesKey: resources ? metaAdsResourcesConsentKey(resources) : "" } };
}

/** GET-only checks and media inspection; provider resources remain untouched. */
export async function checkMetaAdsPublication(userId: string, draft: MetaAdsCampaignDraft) {
  try { return (await prepareMetaAdsPublication(userId, draft, false)).check; }
  catch (error) { if (error instanceof MetaAdsPreparationError) throw error; throw new MetaAdsPreparationError("La vérification Meta n’a pas pu être terminée. Vérifiez les zones, les langues, le média et la connexion avant de réessayer.", 503); }
}

export async function publishMetaAdsCampaign(userId: string, draft: MetaAdsCampaignDraft, persistProgress: PersistMetaAdsProgress, options: MetaAdsPublishOptions = {}): Promise<Record<string, unknown>> {
  if (typeof persistProgress !== "function") throw new MetaAdsPreparationError("La journalisation des identifiants Meta est obligatoire avant publication.");
  const { input } = await prepareMetaAdsPublication(userId, draft, options.activate !== false);
  options.onProviderMutationStart?.();
  return executeMetaAdsGraphPublish(input, metaAdsJson, persistProgress);
}
