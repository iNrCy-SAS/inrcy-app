import "server-only";

import type { AdsCampaignInput } from "./adsValidation.ts";
import {
  buildPinterestActivationSteps,
  buildPinterestAdOnlyPinBody,
  buildPinterestLiveAdBody,
  buildPinterestLiveAdGroupBody,
  buildPinterestLiveCampaignBody,
  pinterestLiveConfigurationIssue,
  pinterestDestinationUrl,
  assertPinterestBatchStatus,
} from "./adsPinterestPublish.ts";
import { pinterestNativeDelivery } from "./adsPinterestCampaignSettings.ts";
import { readPinterestAdsDeliveryResources } from "./adsPinterestResourcesServer.ts";
import { pinterestAdsResourcesConsentKey } from "./adsPinterestResources.ts";
import { matchPinterestGeographies, matchPinterestTargetLanguages } from "./adsPinterestLocations.ts";
import { verifyMediaLibraryContentToken } from "./mediaLibraryContentUrl.ts";
import { createSafeStorageSignedUrl } from "./safeStorageSignedUrl.ts";
import { supabaseAdmin } from "./supabaseAdmin.ts";

export class PinterestAdsPreparationError extends Error {
  constructor(message: string) { super(message); this.name = "PinterestAdsPreparationError"; }
}

type PinterestPublishProgress = Record<string, unknown> & {
  stage?: "campaign_created" | "ad_group_created" | "pin_created" | "ad_created" |
    "paused" | "ad_activated" | "ad_group_activated" | "active";
  campaignId?: string;
  adGroupId?: string;
  pinId?: string;
  adId?: string;
  initialActivationPending?: boolean;
};

type PinterestPublishOptions = {
  activate?: boolean;
  /** Account metadata only; never used as an audience fallback. */
  accountCountry?: string | null;
  onProviderMutationStart?: () => void;
};

type PersistPinterestProgress = (progress: PinterestPublishProgress) => Promise<void>;

export class PinterestAdsPublishError extends Error {
  constructor(
    message: string,
    readonly progress: PinterestPublishProgress,
    readonly mutationStarted: boolean,
  ) {
    super(message);
    this.name = "PinterestAdsPublishError";
  }
}

const PINTEREST_API_BASE_URL = "https://api.pinterest.com/v5";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function providerErrorMessage(value: unknown, status: number): string {
  const payload = record(value);
  const direct = clean(payload.message) || clean(payload.error_description) || clean(payload.error);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const first = record(items[0]);
  const exceptions = Array.isArray(first.exceptions) ? first.exceptions : [];
  const exception = record(exceptions[0]);
  const nested = clean(exception.message) || clean(exception.description) || clean(exception.code);
  return nested || direct || `Pinterest Ads a refusé la création (${status}).`;
}

async function pinterestAdsRequest(
  accessToken: string,
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${PINTEREST_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(method === "GET"
      ? "Les options de ciblage Pinterest n’ont pas pu être vérifiées. Aucune création n’a été envoyée. Réessayez dans quelques instants."
      : "Pinterest Ads n’a pas confirmé la création. Vérifiez Ads Manager avant toute nouvelle tentative.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(providerErrorMessage(payload, response.status));
  return payload;
}

function batchCreatedId(payload: unknown, resourceLabel: string): string {
  const root = record(payload);
  const items = Array.isArray(root.items) ? root.items : [];
  const first = record(items[0]);
  const exceptions = Array.isArray(first.exceptions) ? first.exceptions : [];
  if (exceptions.length) throw new Error(providerErrorMessage(payload, 422));
  const data = record(first.data);
  const id = clean(data.id) || clean(first.id) || clean(root.id);
  if (!/^\d+$/.test(id)) {
    throw new Error(`Pinterest Ads n’a pas renvoyé l’identifiant ${resourceLabel}. Vérifiez Ads Manager avant de réessayer.`);
  }
  return id;
}

function pinCreatedId(payload: unknown): string {
  const root = record(payload);
  const id = clean(root.id) || clean(root.pin_id);
  if (!/^\d+$/.test(id)) {
    throw new Error("Pinterest n’a pas renvoyé l’identifiant de l’épingle publicitaire. Vérifiez Ads Manager avant de réessayer.");
  }
  return id;
}

function safeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return url.protocol === "https:" && !url.username && !url.password && Boolean(hostname)
      && hostname !== "localhost" && !hostname.endsWith(".localhost")
      && !hostname.endsWith(".local") && !hostname.endsWith(".internal")
      && !/^(?:0|10|127|169\.254|192\.168)\./.test(hostname)
      && !/^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
      && hostname !== "::1";
  } catch {
    return false;
  }
}

function mediaLibraryId(value: string): string | null {
  if (!value.startsWith("/")) return null;
  try {
    const url = new URL(value, "https://inrcy-media.local");
    const match = url.pathname.match(/^\/api\/media-library\/items\/([0-9a-f-]{36})\/content$/i);
    const id = match?.[1] || "";
    return id && verifyMediaLibraryContentToken(id, url.searchParams.get("token") || "") ? id : null;
  } catch {
    return null;
  }
}

async function resolvePinterestImageUrl(userId: string, value: string): Promise<string> {
  const source = value.trim();
  if (safeHttpsUrl(source)) return source;
  const id = mediaLibraryId(source);
  if (!id) throw new PinterestAdsPreparationError("Le visuel Pinterest doit être une image HTTPS ou un média valide de votre médiathèque iNrCy.");
  const { data, error } = await supabaseAdmin.from("pro_media_library")
    .select("bucket_name,storage_path,media_type,is_active")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (error || !data || data.is_active === false) {
    throw new PinterestAdsPreparationError("Le média Pinterest sélectionné n’est plus disponible dans votre médiathèque iNrCy.");
  }
  if (data.media_type !== "image") {
    throw new PinterestAdsPreparationError("Le lancement Pinterest actuellement disponible attend une image.");
  }
  const signed = await createSafeStorageSignedUrl(
    String(data.bucket_name || "inrcy-pro-media"),
    String(data.storage_path || ""),
    60 * 60,
  );
  if (!signed || !safeHttpsUrl(signed)) throw new PinterestAdsPreparationError("Le visuel iNrCy ne peut pas être préparé pour Pinterest pour le moment.");
  return signed;
}

/** The exact publication checks are also exposed read-only before claiming a local draft. */
export async function checkPinterestAdsPublication(userId: string, draft: AdsCampaignInput) {
  if (draft.provider !== "pinterest") throw new PinterestAdsPreparationError("Ce brouillon n’est pas une campagne Pinterest Ads.");
  if (!/^\d{5,30}$/.test(draft.adAccountId) || draft.accountCurrency !== "EUR") throw new PinterestAdsPreparationError("Le compte Pinterest Ads EUR est invalide.");
  const settings = draft.channelSettings?.channel === "pinterest" ? draft.channelSettings : null;
  const configurationIssue = pinterestLiveConfigurationIssue(settings, draft.keywords);
  if (configurationIssue) throw new PinterestAdsPreparationError(configurationIssue);
  let delivery: ReturnType<typeof pinterestNativeDelivery>;
  try { delivery = pinterestNativeDelivery({ ...draft, channelSettings: settings || undefined }); }
  catch (error) { throw new PinterestAdsPreparationError(error instanceof Error ? error.message : "Vérifiez les réglages Pinterest."); }
  if (!safeHttpsUrl(draft.destinationUrl)) throw new PinterestAdsPreparationError("Le lien de destination Pinterest doit être une URL HTTPS publique.");
  let destinationUrl: string;
  try { destinationUrl = pinterestDestinationUrl(draft.destinationUrl, draft.trackingParameters); }
  catch (error) { throw new PinterestAdsPreparationError(error instanceof Error ? error.message : "Vérifiez les paramètres de suivi Pinterest."); }
  const title = String(draft.headlines[0] || draft.name).trim(), description = draft.primaryText.trim();
  if (draft.headlines.length !== 1 || !title || !description || Array.from(title).length > 100 || Array.from(description).length > 800) throw new PinterestAdsPreparationError("Pinterest requiert un seul titre de 100 caractères et une description de 800 caractères maximum.");
  const imageUrl = await resolvePinterestImageUrl(userId, String(draft.creativeUrl || draft.imageUrl || ""));
  const native = await readPinterestAdsDeliveryResources(userId, draft.adAccountId);
  let targetingSpec: ReturnType<typeof matchPinterestGeographies> & { LOCALE: string[] };
  try { targetingSpec = { ...matchPinterestGeographies(draft.targetLocations, native.locationPayload, native.geoPayload), LOCALE: matchPinterestTargetLanguages(draft.languages, native.localePayload) }; }
  catch (error) { throw new PinterestAdsPreparationError(error instanceof Error ? error.message : "Choisissez des zones et langues Pinterest vérifiées."); }
  return { ready: true as const, selectedAccountId: draft.adAccountId, verifiedLocationCount: (targetingSpec.LOCATION?.length || 0) + (targetingSpec.GEO?.length || 0), verifiedLanguageCount: targetingSpec.LOCALE.length, resourcesKey: pinterestAdsResourcesConsentKey(native.resources), accessToken: native.accessToken, targetingSpec, imageUrl, destinationUrl, title, description, delivery };
}

/**
 * Creates the complete Pinterest hierarchy paused, persists every returned ID,
 * then activates ad → ad group → campaign. The campaign is activated last so
 * an Active launch cannot start before all resources are durably recorded.
 */
export async function publishPinterestAdsCampaign(
  userId: string,
  draft: AdsCampaignInput,
  persistProgress: PersistPinterestProgress,
  options: PinterestPublishOptions = {},
): Promise<PinterestPublishProgress> {
  let progress: PinterestPublishProgress = {};
  let mutationStarted = false;
  try {
    if (typeof persistProgress !== "function") throw new Error("La journalisation Pinterest est obligatoire avant le lancement.");
    const prepared = await checkPinterestAdsPublication(userId, draft);
    const { accessToken, targetingSpec, imageUrl, destinationUrl, title, description, delivery } = prepared;
    const settings = draft.channelSettings?.channel === "pinterest" ? draft.channelSettings : null;
    if (!settings || (settings.objectiveType !== "AWARENESS" && settings.objectiveType !== "CONSIDERATION")) throw new Error("Les réglages Pinterest sont incomplets.");
    const accountPath = `/ad_accounts/${draft.adAccountId}`;
    const mutate = async (path: string, method: "POST" | "PATCH", body: unknown) => {
      if (!mutationStarted) {
        mutationStarted = true;
        options.onProviderMutationStart?.();
      }
      return pinterestAdsRequest(accessToken, path, method, body);
    };

    const campaignId = batchCreatedId(await mutate(`${accountPath}/campaigns`, "POST", [
      buildPinterestLiveCampaignBody({
        name: draft.name.trim(),
        objectiveType: settings.objectiveType,
        ...(delivery.budgetType === "total" ? { lifetimeSpendCap: delivery.spendCap } : { dailySpendCap: delivery.spendCap, flexibleDaily: delivery.flexibleDaily }),
        startTime: delivery.startTime,
        adAccountId: draft.adAccountId,
        endTime: delivery.endTime,
      }),
    ]), "de la campagne");
    progress = { campaignId, stage: "campaign_created", initialActivationPending: true };
    await persistProgress(progress);

    const adGroupId = batchCreatedId(await mutate(`${accountPath}/ad_groups`, "POST", [
      buildPinterestLiveAdGroupBody({
        name: `${draft.name.trim()} · Groupe d’annonces`,
        campaignId,
        objectiveType: settings.objectiveType,
        bidInMicroCurrency: delivery.bidInMicroCurrency,
        bidStrategyType: delivery.bidStrategyType,
        placementGroup: delivery.placementGroup,
        targetingSpec,
      }),
    ]), "du groupe d’annonces");
    progress = { ...progress, adGroupId, stage: "ad_group_created" };
    await persistProgress(progress);

    const pinId = pinCreatedId(await mutate(
      `/pins?ad_account_id=${encodeURIComponent(draft.adAccountId)}`,
      "POST",
      buildPinterestAdOnlyPinBody({ title, description, destinationUrl, imageUrl }),
    ));
    progress = { ...progress, pinId, stage: "pin_created" };
    await persistProgress(progress);

    const adId = batchCreatedId(await mutate(`${accountPath}/ads`, "POST", [
      buildPinterestLiveAdBody({
        name: `${draft.name.trim()} · Épingle sponsorisée`,
        adGroupId,
        pinId,
        destinationUrl,
      }),
    ]), "de l’annonce");
    progress = { ...progress, adId, stage: "ad_created" };
    await persistProgress(progress);

    if (options.activate !== false) {
      for (const step of buildPinterestActivationSteps(draft.adAccountId, { campaignId, adGroupId, adId })) {
        const result = await mutate(step.path, "PATCH", step.body);
        assertPinterestBatchStatus(result, step.body[0].id, "ACTIVE");
        progress = { ...progress, stage: step.stage, initialActivationPending: step.stage !== "active" };
        await persistProgress(progress);
      }
    } else {
      progress = { ...progress, stage: "paused" };
      await persistProgress(progress);
    }
    return progress;
  } catch (error) {
    if (error instanceof PinterestAdsPublishError) throw error;
    throw new PinterestAdsPublishError(
      error instanceof Error ? error.message : "Pinterest Ads a refusé la campagne.",
      progress,
      mutationStarted,
    );
  }
}
