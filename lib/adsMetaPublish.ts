import "server-only";

import { listMetaPages, metaAdsJson } from "./adsServer.ts";
import {
  metaCreativeAssetUrls,
  metaPlacementsNeedInstagramIdentity,
  type MetaAdsPlacement,
} from "./adsMetaPlacement.ts";
import {
  executeMetaAdsGraphPublish,
  resolveMetaAdsPublishTargeting,
  metaUrlTags,
  MetaAdsPublishError,
  type PersistMetaAdsProgress,
} from "./adsMetaPublishCore.ts";
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
    throw new Error("Le visuel Meta n’a pas pu être téléchargé. Utilisez une image HTTPS directement accessible, sans redirection.");
  }
  if (!response.ok) {
    throw new Error("Le visuel Meta n’a pas pu être téléchargé avant son import dans Ads Manager.");
  }
  const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error("Le fichier préparé pour Meta n’est pas une image valide.");
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_META_IMAGE_BYTES) {
    throw new Error("Le visuel Meta dépasse la limite de 30 Mo.");
  }
  if (!response.body) throw new Error("Le visuel Meta téléchargé est vide.");

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_META_IMAGE_BYTES) throw new Error("Le visuel Meta dépasse la limite de 30 Mo.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("Le visuel Meta téléchargé est vide.");
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
    throw new Error("Le visuel Meta doit être une URL HTTPS ou un média valide de votre médiathèque iNrCy.");
  }

  const { data: media, error } = await supabaseAdmin
    .from("pro_media_library")
    .select("bucket_name,storage_path,media_type,is_active")
    .eq("id", mediaId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !media || media.is_active === false) {
    throw new Error("Le média sélectionné n’est plus disponible dans votre médiathèque iNrCy.");
  }
  if (media.media_type !== "image") {
    throw new Error("Le connecteur Meta actuellement disponible attend une image. Choisissez une image dans iNr’Studio ou votre médiathèque.");
  }

  const publicUrl = await createSafeStorageSignedUrl(
    String(media.bucket_name || "inrcy-pro-media"),
    String(media.storage_path || ""),
    60 * 60,
  );
  if (!publicUrl || !safeHttpsUrl(publicUrl)) {
    throw new Error("Le média iNrCy ne peut pas être préparé pour Meta pour le moment. Réessayez dans quelques instants.");
  }
  return publicUrl;
}

/** Meta accepts an ISO-8601 offset; 23:59 Paris time also handles CET/CEST. */
function parisEndTime(endDate: string): string {
  const reference = new Date(`${endDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(reference.getTime()) || reference.toISOString().slice(0, 10) !== endDate) {
    throw new Error("La date de fin Meta est invalide.");
  }
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    timeZoneName: "shortOffset",
  }).formatToParts(reference).find((part) => part.type === "timeZoneName")?.value;
  const offset = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName ?? "");
  if (!offset) throw new Error("Impossible de déterminer le fuseau horaire de la campagne Meta.");
  const endTime = `${endDate}T23:59:59${offset[1]}${offset[2].padStart(2, "0")}:${offset[3] ?? "00"}`;
  const daysUntilEnd = (Date.parse(endTime) - Date.now()) / 86_400_000;
  if (daysUntilEnd < 1 || daysUntilEnd > 90) {
    throw new Error("La fin de campagne Meta doit être comprise entre demain et dans 90 jours.");
  }
  return endTime;
}

export async function publishMetaAdsCampaign(
  userId: string,
  draft: MetaAdsCampaignDraft,
  persistProgress: PersistMetaAdsProgress,
  options: MetaAdsPublishOptions = {},
): Promise<Record<string, unknown>> {
  if (draft.provider !== "meta") throw new Error("Ce brouillon n’est pas une campagne Meta Ads.");
  if (typeof persistProgress !== "function") {
    throw new Error("La journalisation des identifiants Meta est obligatoire avant publication.");
  }
  if (draft.noSpecialCategoryConfirmed !== true) {
    throw new Error("Confirmez que cette campagne ne relève pas d’une catégorie publicitaire spéciale Meta.");
  }
  if (!/^\d{5,25}$/.test(draft.adAccountId) || !/^\d{5,30}$/.test(draft.pageId)) {
    throw new Error("Le compte publicitaire ou la Page Meta est invalide.");
  }
  if (draft.accountCurrency !== "EUR") throw new Error("Seuls les comptes Meta en EUR sont pris en charge.");
  if (!safeHttpsUrl(draft.destinationUrl)) {
    throw new Error("Le lien de destination Meta doit être une URL HTTPS publique.");
  }
  const placements = draft.metaPlacements as MetaAdsPlacement[];
  const needsInstagramIdentity = metaPlacementsNeedInstagramIdentity(placements);
  const selectedAssets = metaCreativeAssetUrls({
    placements,
    imageUrl: draft.imageUrl,
    metaCreativeAssets: draft.metaCreativeAssets,
  });
  const urlTags = metaUrlTags(draft.trackingParameters);
  if (draft.name.trim().length < 3 || draft.primaryText.trim().length < 10) {
    throw new Error("Le nom ou le texte de la campagne Meta est trop court.");
  }
  const dailyBudgetCents = Math.round(draft.dailyBudgetEuros * 100);
  if (!Number.isFinite(dailyBudgetCents) || Math.abs(dailyBudgetCents - draft.dailyBudgetEuros * 100) > 0.000001 || dailyBudgetCents < 500 || dailyBudgetCents > 50_000) {
    throw new Error("Le budget Meta doit être compris entre 5 et 500 € par jour.");
  }
  const endTime = parisEndTime(draft.endDate);
  const accountPath = `act_${draft.adAccountId}`;
  const shouldActivate = options.activate !== false;

  // Check the same token used for creation can access the chosen EUR account
  // and Page. Meta still validates the Page's advertising rights at creation.
  const account = await metaAdsJson(userId, `${accountPath}?fields=id,currency,account_status`);
  if (String(account.id ?? "").replace(/^act_/, "") !== draft.adAccountId) {
    throw new Error("Ce compte publicitaire Meta n’est pas accessible avec la connexion actuelle.");
  }
  if (account.currency !== "EUR") throw new Error("Le compte publicitaire Meta doit être en EUR.");
  if (Number(account.account_status) !== 1) {
    throw new Error("Le compte publicitaire Meta n’est pas actif. Vérifiez-le dans Ads Manager.");
  }
  const pages = await listMetaPages(userId);
  const page = pages.find((item) => item.id === draft.pageId);
  if (!page) {
    throw new Error("Cette Page Facebook n’est pas autorisée par la connexion Meta Ads.");
  }
  const instagramUserId = page.instagramUserId || undefined;
  if (needsInstagramIdentity && !instagramUserId) {
    throw new Error("Associez un compte Instagram professionnel à cette Page Facebook dans Meta Business Suite, puis actualisez la configuration iNr’ADS.");
  }
  if (needsInstagramIdentity) {
    // A linked Page alone does not prove that this ad account may advertise
    // with the Instagram identity. Check the account edge before any creation.
    const instagramAccounts = await metaAdsJson(userId, `${accountPath}/connected_instagram_accounts?fields=id&limit=100`);
    if (!(Array.isArray(instagramAccounts.data) ? instagramAccounts.data : []).some((item) =>
      String((item as Record<string, unknown>).id || "") === instagramUserId
    )) {
      throw new Error("Le compte Instagram lié à cette Page n’est pas autorisé sur le compte publicitaire Meta sélectionné. Vérifiez son association dans Meta Business Suite, puis actualisez iNr’ADS.");
    }
  }

  // The review's local zones must be the actual ad-set geography. The shared
  // resolver rejects unknown/ambiguous locations instead of widening to France.
  const targeting = await resolveMetaAdsPublishTargeting(userId, placements, draft.targetLocations, metaAdsJson);

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

  options.onProviderMutationStart?.();
  return executeMetaAdsGraphPublish({
    userId,
    adAccountId: draft.adAccountId,
    pageId: draft.pageId,
    instagramUserId: needsInstagramIdentity ? instagramUserId : undefined,
    name: draft.name,
    destinationUrl: draft.destinationUrl,
    primaryText: draft.primaryText,
    headline: draft.headlines.find((headline) => headline.trim()) || draft.name,
    description: draft.descriptions.find((description) => description.trim()),
    dailyBudgetCents,
    endTime,
    placements,
    targeting,
    urlTags,
    feedImageBytes,
    storyReelImageBytes,
    activate: shouldActivate,
  }, metaAdsJson, persistProgress);
}
