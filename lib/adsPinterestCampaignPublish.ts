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
import { pinterestAdsAccessToken } from "./adsPinterestServer.ts";
import { matchPinterestGeographies, matchPinterestTargetLanguages } from "./adsPinterestLocations.ts";
import { verifyMediaLibraryContentToken } from "./mediaLibraryContentUrl.ts";
import { createSafeStorageSignedUrl } from "./safeStorageSignedUrl.ts";
import { supabaseAdmin } from "./supabaseAdmin.ts";

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
  if (!id) throw new Error("Le visuel Pinterest doit être une image HTTPS ou un média valide de votre médiathèque iNrCy.");
  const { data, error } = await supabaseAdmin.from("pro_media_library")
    .select("bucket_name,storage_path,media_type,is_active")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (error || !data || data.is_active === false) {
    throw new Error("Le média Pinterest sélectionné n’est plus disponible dans votre médiathèque iNrCy.");
  }
  if (data.media_type !== "image") {
    throw new Error("Le lancement Pinterest actuellement disponible attend une image.");
  }
  const signed = await createSafeStorageSignedUrl(
    String(data.bucket_name || "inrcy-pro-media"),
    String(data.storage_path || ""),
    60 * 60,
  );
  if (!signed || !safeHttpsUrl(signed)) throw new Error("Le visuel iNrCy ne peut pas être préparé pour Pinterest pour le moment.");
  return signed;
}

function endTimestamp(endDate: string): number {
  const milliseconds = Date.parse(`${endDate}T23:59:59Z`);
  const days = (milliseconds - Date.now()) / 86_400_000;
  if (!Number.isFinite(milliseconds) || days < 1 || days > 90) throw new Error("La date de fin Pinterest doit être comprise entre demain et dans 90 jours.");
  return Math.floor(milliseconds / 1000);
}

function microCurrency(amount: number): number {
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || Math.abs(cents - amount * 100) > 0.000001 || cents < 500 || cents > 50_000) {
    throw new Error("Le budget Pinterest doit être compris entre 5 et 500 € par jour.");
  }
  return cents * 10_000;
}

function bidMicroCurrency(amount: number, dailyBudgetEuros: number): number {
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || Math.abs(cents - amount * 100) > 0.000001 || cents < 1 || amount > dailyBudgetEuros) {
    throw new Error("L’enchère Pinterest doit être comprise entre 0,01 € et le budget journalier.");
  }
  return cents * 10_000;
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
    if (draft.provider !== "pinterest") throw new Error("Ce brouillon n’est pas une campagne Pinterest Ads.");
    if (typeof persistProgress !== "function") throw new Error("La journalisation Pinterest est obligatoire avant le lancement.");
    if (!/^\d{5,30}$/.test(draft.adAccountId) || draft.accountCurrency !== "EUR") {
      throw new Error("Le compte Pinterest Ads EUR est invalide.");
    }
    const settings = draft.channelSettings?.channel === "pinterest" ? draft.channelSettings : null;
    const configurationIssue = pinterestLiveConfigurationIssue(settings, draft.keywords);
    if (configurationIssue) throw new Error(configurationIssue);
    if (!settings || (settings.objectiveType !== "AWARENESS" && settings.objectiveType !== "CONSIDERATION")) {
      throw new Error("Les réglages Pinterest sont incomplets.");
    }
    if (!safeHttpsUrl(draft.destinationUrl)) throw new Error("Le lien de destination Pinterest doit être une URL HTTPS publique.");
    const destinationUrl = pinterestDestinationUrl(draft.destinationUrl, draft.trackingParameters);
    const imageUrl = await resolvePinterestImageUrl(userId, String(draft.creativeUrl || draft.imageUrl || ""));
    const dailySpendCap = microCurrency(draft.dailyBudgetEuros);
    const bidInMicroCurrency = bidMicroCurrency(draft.pinterestBidEuros ?? 1, draft.dailyBudgetEuros);
    const endTime = endTimestamp(draft.endDate);
    const title = String(draft.headlines[0] || draft.name).trim();
    const description = draft.primaryText.trim();
    if (!title || !description) throw new Error("Le titre et la description de l’épingle Pinterest sont obligatoires.");
    if (Array.from(title).length > 100 || Array.from(description).length > 800) {
      throw new Error("Reformulez le titre (100 caractères) ou la description (800 caractères) Pinterest avant publication.");
    }
    const accessToken = await pinterestAdsAccessToken(userId);
    const [locationOptions, geoOptions, localeOptions] = await Promise.all(
      ["LOCATION", "GEO", "LOCALE"].map((type) => pinterestAdsRequest(accessToken,
        `/resources/targeting/${type}?ad_account_id=${encodeURIComponent(draft.adAccountId)}`, "GET")),
    );
    const targetingSpec = {
      ...matchPinterestGeographies(draft.targetLocations, locationOptions, geoOptions),
      LOCALE: matchPinterestTargetLanguages(draft.languages, localeOptions),
    };
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
        dailySpendCap,
        endTime,
      }),
    ]), "de la campagne");
    progress = { campaignId, stage: "campaign_created", initialActivationPending: true };
    await persistProgress(progress);

    const adGroupId = batchCreatedId(await mutate(`${accountPath}/ad_groups`, "POST", [
      buildPinterestLiveAdGroupBody({
        name: `${draft.name.trim()} · Groupe d’annonces`,
        campaignId,
        objectiveType: settings.objectiveType,
        bidInMicroCurrency,
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
