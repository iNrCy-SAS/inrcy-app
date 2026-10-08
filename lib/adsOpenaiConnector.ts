import { createHash } from "node:crypto";
import { OPENAI_ADS_PLATFORMS, openaiAdsTrackingTemplate, type OpenaiAdsPlatform } from "./adsOpenaiCampaignSettings.ts";

/**
 * ChatGPT Ads Advertiser API. This module deliberately has no database or UI
 * dependency: the caller owns the client's account-scoped key and persists each
 * returned ID before allowing the next provider mutation.
 *
 * Contract: https://developers.openai.com/ads/api-overview
 * Schema: https://developers.openai.com/ads/openapi.json
 */
const API_BASE = "https://api.ads.openai.com/v1";

type Fetcher = typeof fetch;
type Json = Record<string, unknown>;

export type OpenaiAdsResolvedLocation = {
  id: string;
  name: string;
  countryCode: string;
  type: string;
};

export type OpenaiAdsAccount = {
  id: string;
  name: string;
  currencyCode: string;
  timezone: string;
  status: string;
  brandReviewStatus: string;
  accountReviewStatus: string | null;
};

export type OpenaiAdsPublishRequest = {
  /** Stable, persisted local operation/draft ID; never generate a new one on retry. */
  operationId: string;
  expectedAccountId: string;
  campaignName: string;
  biddingType: "clicks" | "impressions";
  budget: { dailySpendLimitMicros: number; lifetimeSpendLimitMicros?: never }
    | { lifetimeSpendLimitMicros: number; dailySpendLimitMicros?: never };
  /** Names are resolved against the current Ads account before ANY creation. */
  targetLocations: string[];
  countryCode: string;
  /** Unix timestamp in seconds, as expected by the Ads API. */
  endTime?: number;
  startTime?: number;
  /** Absent means all available ChatGPT platforms. Never send an empty array. */
  platforms?: OpenaiAdsPlatform[];
  queryStringTemplate?: string;
  adGroupName: string;
  contextHints: string[];
  maxBidMicros: number;
  adName: string;
  title: string;
  body: string;
  destinationUrl: string;
  /** Immutable, caller-verified pro_media_library UUID; unlike imageUrl, stable across retries. */
  mediaStableId: string;
  /** Public HTTPS URL of an image suitable for a square ChatGPT chat card. */
  imageUrl: string;
};

export type OpenaiAdsPublishProgress = {
  operationId: string;
  requestFingerprint: string;
  accountId: string;
  locations: OpenaiAdsResolvedLocation[];
  stage: "verified" | "campaign_created" | "ad_group_created" | "image_uploaded" |
    "ad_created" | "paused" | "ad_activated" | "ad_group_activated" | "active";
  campaignId?: string;
  adGroupId?: string;
  imageFileId?: string;
  adId?: string;
};

export type OpenaiAdsConnectorOptions = {
  apiKey: string;
  fetchImpl?: Fetcher;
};

export type CreatePausedOpenaiAdsCampaignOptions = OpenaiAdsConnectorOptions & {
  request: OpenaiAdsPublishRequest;
  /** Previously persisted progress, if this exact operation is retried. */
  progress?: OpenaiAdsPublishProgress | null;
  onProgress?: (progress: OpenaiAdsPublishProgress) => Promise<void>;
  onProviderMutationStart?: () => void;
};

export type ActivateOpenaiAdsCampaignOptions = OpenaiAdsConnectorOptions & {
  progress: OpenaiAdsPublishProgress;
  expectedAccountId: string;
  /** Must come from independent advertiser billing confirmation, not GET /ad_account. */
  billingConfirmed: boolean;
  onProgress?: (progress: OpenaiAdsPublishProgress) => Promise<void>;
};

export type OpenaiAdsCampaignState = {
  campaignId: string;
  adGroupId: string;
  adId: string;
  campaignStatus: "active" | "paused";
  adGroupStatus: "active" | "paused";
  adStatus: "active" | "paused";
  reviewStatus: string;
};

export type ReadOpenaiAdsCampaignStateOptions = OpenaiAdsConnectorOptions & {
  progress: OpenaiAdsPublishProgress;
  expectedAccountId: string;
};

export type SetOpenaiAdsCampaignPausedOptions = OpenaiAdsConnectorOptions & {
  progress: OpenaiAdsPublishProgress;
  expectedAccountId: string;
  paused: boolean;
  /** Required at runtime whenever paused=false; ignored for a safe pause. */
  billingConfirmed?: boolean;
  onProgress?: (progress: OpenaiAdsPublishProgress) => Promise<void>;
};

export class OpenaiAdsPublishError extends Error {
  readonly code: string;
  readonly progress: OpenaiAdsPublishProgress | null;
  readonly mutationStarted: boolean;
  readonly httpStatus?: number;

  /** Only a pre-mutation failure or an explicit first-create validation rejection is editable. */
  get retrySafe(): boolean {
    const hasRemoteId = Boolean(this.progress?.campaignId || this.progress?.adGroupId ||
      this.progress?.imageFileId || this.progress?.adId);
    return !hasRemoteId && (!this.mutationStarted || this.httpStatus === 400);
  }

  constructor(
    code: string,
    message: string,
    progress: OpenaiAdsPublishProgress | null = null,
    mutationStarted = false,
    httpStatus?: number,
  ) {
    super(message);
    this.name = "OpenaiAdsPublishError";
    this.code = code;
    this.progress = progress;
    this.mutationStarted = mutationStarted;
    this.httpStatus = httpStatus;
  }
}

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resourceId(value: unknown, prefix: string): string {
  const id = clean(value);
  return new RegExp(`^${prefix}[A-Za-z0-9_-]{1,120}$`).test(id) ? id : "";
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || value.length > 2048 || !host ||
      host.startsWith("[") || !host.includes(".") || !/[a-z]/.test(host) ||
      host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host === "::1" ||
      /^(?:0|10|127|169\.254|192\.168)\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function locationName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function fail(code: string, message: string): never {
  throw new OpenaiAdsPublishError(code, message);
}

function validateRequest(value: OpenaiAdsPublishRequest): OpenaiAdsPublishRequest {
  const request: OpenaiAdsPublishRequest = {
    ...value,
    operationId: clean(value.operationId),
    expectedAccountId: clean(value.expectedAccountId),
    campaignName: clean(value.campaignName),
    adGroupName: clean(value.adGroupName),
    adName: clean(value.adName),
    title: clean(value.title),
    body: clean(value.body),
    countryCode: clean(value.countryCode).toUpperCase(),
    targetLocations: Array.isArray(value.targetLocations) ? value.targetLocations.map(clean) : [],
    contextHints: Array.isArray(value.contextHints) ? value.contextHints.map(clean).filter(Boolean) : [],
    destinationUrl: safeHttpsUrl(value.destinationUrl) || "",
    mediaStableId: clean(value.mediaStableId).toLowerCase(),
    imageUrl: safeHttpsUrl(value.imageUrl) || "",
  };
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(request.operationId)) fail("INVALID_REQUEST", "L’identifiant de publication ChatGPT Ads est invalide.");
  if (!resourceId(request.expectedAccountId, "adacct_")) fail("INVALID_REQUEST", "Le compte annonceur ChatGPT Ads est invalide.");
  for (const name of [request.campaignName, request.adGroupName, request.adName]) {
    if (name.length < 3 || name.length > 1000) fail("INVALID_REQUEST", "Le nom de campagne ChatGPT Ads est invalide.");
  }
  if (request.biddingType !== "clicks" && request.biddingType !== "impressions") fail("INVALID_REQUEST", "L’objectif ChatGPT Ads est invalide.");
  if (!/^[A-Z]{2}$/.test(request.countryCode) || request.targetLocations.length < 1 || request.targetLocations.length > 30 ||
    request.targetLocations.some((name) => !name || name.length > 120)) fail("INVALID_GEO", "Sélectionnez des zones géographiques précises pour ChatGPT Ads.");
  const daily = request.budget?.dailySpendLimitMicros;
  const lifetime = request.budget?.lifetimeSpendLimitMicros;
  if ((daily === undefined) === (lifetime === undefined) ||
    !Number.isSafeInteger(daily ?? lifetime) || (daily ?? lifetime ?? 0) < 1_000_000) {
    fail("INVALID_BUDGET", "Le budget ChatGPT Ads est invalide.");
  }
  if (!Number.isSafeInteger(request.maxBidMicros) || request.maxBidMicros < 1) fail("INVALID_BID", "L’enchère ChatGPT Ads est invalide.");
  if (daily !== undefined && request.maxBidMicros > daily) {
    fail("INVALID_BID", "L’enchère maximale ChatGPT Ads doit rester inférieure ou égale au budget quotidien.");
  }
  if (lifetime !== undefined && request.maxBidMicros > lifetime) fail("INVALID_BID", "L’enchère ChatGPT Ads ne peut pas dépasser le budget total.");
  if (request.endTime !== undefined && (!Number.isSafeInteger(request.endTime) || request.endTime < 946684800 || request.endTime > 4102444800)) {
    fail("INVALID_REQUEST", "La date de fin ChatGPT Ads est invalide.");
  }
  if (request.startTime !== undefined && (!Number.isSafeInteger(request.startTime) || request.startTime < 946684800 || request.startTime > 4102444800 || (request.endTime != null && request.endTime <= request.startTime))) fail("INVALID_REQUEST", "Le calendrier ChatGPT Ads est invalide.");
  if (request.platforms !== undefined && (!Array.isArray(request.platforms) || request.platforms.length < 1 || request.platforms.length > OPENAI_ADS_PLATFORMS.length || new Set(request.platforms).size !== request.platforms.length || request.platforms.some((p) => !OPENAI_ADS_PLATFORMS.includes(p)))) fail("INVALID_REQUEST", "Les plateformes ChatGPT Ads sélectionnées sont invalides.");
  if (request.queryStringTemplate !== undefined) {
    try { request.queryStringTemplate = openaiAdsTrackingTemplate(request.queryStringTemplate); }
    catch { fail("INVALID_REQUEST", "Les paramètres de suivi ChatGPT Ads sont invalides."); }
  }
  if (request.title.length < 3 || request.title.length > 50 || !request.body || request.body.length > 100) {
    fail("INVALID_CREATIVE", "Le titre ou le texte ChatGPT Ads ne respecte pas les limites du canal.");
  }
  if (!request.destinationUrl || !request.imageUrl) fail("INVALID_CREATIVE", "Une page de destination et une image publiques HTTPS sont obligatoires pour ChatGPT Ads.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(request.mediaStableId)) {
    fail("INVALID_CREATIVE", "L’identité du média ChatGPT Ads n’a pas été vérifiée.");
  }
  if (request.contextHints.length > 30 || request.contextHints.some((hint) => hint.length > 250)) fail("INVALID_REQUEST", "Les indications de contexte ChatGPT Ads sont invalides.");
  return request;
}

function apiKey(value: string): string {
  const key = clean(value);
  if (!key || /[\r\n]/.test(key)) fail("NO_API_KEY", "Connectez la clé API du compte annonceur ChatGPT Ads.");
  return key;
}

async function apiRequest(
  key: string,
  path: string,
  method: "GET" | "POST",
  fetchImpl: Fetcher,
  body?: Json,
  idempotencyKey?: string,
): Promise<Json> {
  let response: Response;
  try {
    response = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new OpenaiAdsPublishError("NETWORK_UNCERTAIN", "ChatGPT Ads n’a pas confirmé la requête. Vérifiez Ads Manager avant de réessayer.");
  }
  const payload: Json = object(await response.json().catch(() => ({})));
  if (!response.ok) {
    const code = clean(object(payload.error).code) || `HTTP_${response.status}`;
    const message = response.status === 401 ? "La clé API ChatGPT Ads est invalide ou révoquée."
      : response.status === 403 ? "Ce compte n’autorise pas cette opération ChatGPT Ads."
      : response.status === 429 ? "ChatGPT Ads limite temporairement les requêtes."
      : response.status === 409 ? "Une opération ChatGPT Ads existe déjà avec des données différentes."
      : `ChatGPT Ads a refusé la requête (${response.status}).`;
    throw new OpenaiAdsPublishError(code, message, null, method === "POST", response.status);
  }
  return payload;
}

export async function verifyOpenaiAdsAccount(options: OpenaiAdsConnectorOptions & { expectedAccountId?: string }): Promise<OpenaiAdsAccount> {
  const key = apiKey(options.apiKey);
  const payload = await apiRequest(key, "/ad_account", "GET", options.fetchImpl || fetch);
  const account: OpenaiAdsAccount = {
    id: resourceId(payload.id, "adacct_"),
    name: clean(payload.account_name) || clean(payload.brand_name) || clean(payload.name),
    currencyCode: clean(payload.currency_code).toUpperCase(),
    timezone: clean(payload.timezone),
    status: clean(payload.status),
    brandReviewStatus: clean(object(payload.review).status),
    accountReviewStatus: clean(object(object(payload.account_integrity_review).review).status) || null,
  };
  if (!account.id || (options.expectedAccountId && account.id !== options.expectedAccountId)) {
    fail("ACCOUNT_MISMATCH", "La clé ChatGPT Ads ne correspond pas au compte annonceur sélectionné.");
  }
  return account;
}

export function assessOpenaiAdsAccount(account: OpenaiAdsAccount): { ready: boolean; code: string | null; message: string | null } {
  if (account.currencyCode !== "EUR") return { ready: false, code: "CURRENCY_MISMATCH", message: "Le compte ChatGPT Ads doit être configuré en euros pour ce parcours." };
  if (account.status !== "active") return { ready: false, code: "ACCOUNT_NOT_ACTIVE", message: "Le compte ChatGPT Ads n’est pas actif." };
  if (account.brandReviewStatus !== "approved" || (account.accountReviewStatus && account.accountReviewStatus !== "approved")) {
    return { ready: false, code: "ACCOUNT_IN_REVIEW", message: "La vérification du compte ou de sa marque ChatGPT Ads n’est pas terminée." };
  }
  return { ready: true, code: null, message: null };
}

export function openaiAdsAccountReady(account: OpenaiAdsAccount): boolean {
  return assessOpenaiAdsAccount(account).ready;
}

function assertAccountReady(account: OpenaiAdsAccount): void {
  const assessment = assessOpenaiAdsAccount(account);
  if (!assessment.ready) fail(assessment.code || "ACCOUNT_NOT_READY", assessment.message || "Le compte ChatGPT Ads n’est pas prêt.");
}

export async function resolveOpenaiAdsLocations(options: OpenaiAdsConnectorOptions & {
  names: string[];
  countryCode: string;
}): Promise<OpenaiAdsResolvedLocation[]> {
  const key = apiKey(options.apiKey);
  const countryCode = clean(options.countryCode).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode) || !Array.isArray(options.names) || !options.names.length || options.names.length > 30) {
    fail("INVALID_GEO", "Les zones ChatGPT Ads sont invalides.");
  }
  const selected: OpenaiAdsResolvedLocation[] = [];
  for (const rawName of options.names) {
    const name = clean(rawName);
    if (!name || name.length > 120) fail("INVALID_GEO", "Une zone ChatGPT Ads est vide ou trop longue.");
    const params = new URLSearchParams({ q: name, limit: "10" });
    const payload = await apiRequest(key, `/geo_lookup/search?${params}`, "GET", options.fetchImpl || fetch);
    const results = Array.isArray(payload.results) ? payload.results : [];
    const wanted = locationName(name);
    const matches = results.map(object).filter((item) =>
      clean(item.country_code).toUpperCase() === countryCode && clean(item.type).toLowerCase() !== "country" &&
      (locationName(clean(item.name)) === wanted || locationName(clean(item.canonical_name)) === wanted) &&
      clean(item.id),
    );
    const unique = [...new Map(matches.map((item) => [clean(item.id), item])).values()];
    if (unique.length !== 1) {
      fail("UNRESOLVED_GEO", `La zone « ${name} » est introuvable ou ambiguë dans ChatGPT Ads. Précisez la ville ou la région.`);
    }
    const result = unique[0];
    const id = clean(result.id);
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) fail("UNRESOLVED_GEO", "ChatGPT Ads a renvoyé une zone invalide.");
    if (!selected.some((item) => item.id === id)) selected.push({
      id,
      name: clean(result.name),
      countryCode,
      type: clean(result.type),
    });
  }
  if (!selected.length) fail("UNRESOLVED_GEO", "Aucune zone géographique ChatGPT Ads n’a été vérifiée.");
  return selected;
}

/** Public geographic catalog only. A search does not verify a campaign or create anything. */
export async function searchOpenaiAdsLocations(options: OpenaiAdsConnectorOptions & { query: string; countryCode?: string }): Promise<Array<OpenaiAdsResolvedLocation & { canonicalName: string }>> {
  const query = clean(options.query);
  if (query.length < 2 || query.length > 120 || /[\r\n\u0000-\u001f]/.test(query)) fail("INVALID_GEO", "Saisissez une zone ChatGPT Ads de 2 à 120 caractères.");
  const countryCode = options.countryCode ? clean(options.countryCode).toUpperCase() : "";
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) fail("INVALID_GEO", "Le pays ChatGPT Ads est invalide.");
  const params = new URLSearchParams({ q: query, limit: "30" });
  const payload = await apiRequest(apiKey(options.apiKey), `/geo_lookup/search?${params}`, "GET", options.fetchImpl || fetch);
  const results = Array.isArray(payload.results) ? payload.results.map(object) : [];
  return [...new Map(results.filter((item) => /^[A-Za-z0-9_-]{1,120}$/.test(clean(item.id)) && clean(item.name) && /^[A-Z]{2}$/.test(clean(item.country_code).toUpperCase()) && clean(item.type).toLowerCase() !== "country" && (!countryCode || clean(item.country_code).toUpperCase() === countryCode)).map((item) => [clean(item.id), {
    id: clean(item.id), name: clean(item.name), countryCode: clean(item.country_code).toUpperCase(), type: clean(item.type), canonicalName: clean(item.canonical_name) || clean(item.name),
  }])).values()];
}

export function isOpenaiAdsPublishProgress(value: unknown): value is OpenaiAdsPublishProgress {
  const item = object(value);
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(clean(item.operationId)) || !/^[a-f0-9]{64}$/.test(clean(item.requestFingerprint)) ||
    !resourceId(item.accountId, "adacct_") || !Array.isArray(item.locations) || !item.locations.length ||
    !item.locations.every((location) => Boolean(clean(object(location).id) && clean(object(location).name)))) return false;
  if (item.campaignId !== undefined && !resourceId(item.campaignId, "cmpn_")) return false;
  if (item.adGroupId !== undefined && (!resourceId(item.adGroupId, "adgrp_") || !item.campaignId)) return false;
  if (item.imageFileId !== undefined && (!resourceId(item.imageFileId, "file_") || !item.adGroupId)) return false;
  if (item.adId !== undefined && (!resourceId(item.adId, "ad_") || !item.adGroupId || !item.imageFileId)) return false;
  return ["verified", "campaign_created", "ad_group_created", "image_uploaded", "ad_created", "paused", "ad_activated", "ad_group_activated", "active"].includes(clean(item.stage));
}

export async function createPausedOpenaiAdsCampaign(options: CreatePausedOpenaiAdsCampaignOptions): Promise<OpenaiAdsPublishProgress> {
  const request = validateRequest(options.request);
  const key = apiKey(options.apiKey);
  const fetchImpl = options.fetchImpl || fetch;
  // Supabase signed URLs change between attempts. Identity comes from the
  // ownership-checked media UUID; the transient delivery URL is not campaign data.
  const { imageUrl: _transientImageUrl, ...stableRequest } = request;
  void _transientImageUrl;
  const fingerprint = createHash("sha256").update(JSON.stringify(stableRequest)).digest("hex");
  let progress = options.progress || null;
  let mutationStarted = false;
  if (progress && (!isOpenaiAdsPublishProgress(progress) || progress.operationId !== request.operationId ||
    progress.requestFingerprint !== fingerprint || progress.accountId !== request.expectedAccountId)) {
    fail("PROGRESS_MISMATCH", "La reprise ChatGPT Ads ne correspond pas à cette campagne. Vérifiez Ads Manager.");
  }
  const save = async (next: OpenaiAdsPublishProgress) => {
    progress = next;
    if (options.onProgress) await options.onProgress(next);
  };
  const mutation = () => {
    options.onProviderMutationStart?.();
    mutationStarted = true;
  };
  try {
    const account = await verifyOpenaiAdsAccount({ apiKey: key, expectedAccountId: request.expectedAccountId, fetchImpl });
    assertAccountReady(account);
    if (request.budget.dailySpendLimitMicros !== undefined && request.budget.dailySpendLimitMicros < 15_000_000) {
      fail("INVALID_BUDGET", "Notre parcours ChatGPT Ads demande au moins 15 € par jour ; le minimum réel dépend du compte et sera vérifié par la plateforme.");
    }
    if (!progress) {
      const locations = await resolveOpenaiAdsLocations({
        apiKey: key, names: request.targetLocations, countryCode: request.countryCode, fetchImpl,
      });
      await save({ operationId: request.operationId, requestFingerprint: fingerprint,
        accountId: account.id, locations, stage: "verified" });
    }
    if (!progress) fail("PROGRESS_MISMATCH", "La préparation ChatGPT Ads a échoué.");
    if (!progress.campaignId) {
      const budget = request.budget.dailySpendLimitMicros !== undefined
        ? { daily_spend_limit_micros: request.budget.dailySpendLimitMicros }
        : { lifetime_spend_limit_micros: request.budget.lifetimeSpendLimitMicros };
      mutation();
      const created = await apiRequest(key, "/campaigns", "POST", fetchImpl, {
        name: request.campaignName,
        status: "paused",
        bidding_type: request.biddingType,
        budget,
        ...(request.startTime != null ? { start_time: request.startTime } : {}),
        ...(request.endTime ? { end_time: request.endTime } : {}),
        targeting: { locations: { include: progress.locations.map(({ id }) => ({ id })) }, ...(request.platforms?.length ? { platforms: { included: request.platforms } } : {}) },
        ...(request.queryStringTemplate ? { landing_page_configuration: { query_string_template: request.queryStringTemplate } } : {}),
      }, `${request.operationId}-campaign`);
      const campaignId = resourceId(created.id, "cmpn_");
      if (!campaignId || clean(created.status) !== "paused") fail("INVALID_PROVIDER_RESPONSE", "ChatGPT Ads n’a pas confirmé la campagne en pause.");
      await save({ ...progress, campaignId, stage: "campaign_created" });
    }
    if (!progress.adGroupId) {
      mutation();
      const created = await apiRequest(key, "/ad_groups", "POST", fetchImpl, {
        campaign_id: progress.campaignId,
        name: request.adGroupName,
        status: "paused",
        context_hints: request.contextHints,
        bidding_config: {
          billing_event_type: request.biddingType === "clicks" ? "click" : "impression",
          strategy: "fixed_bid",
          max_bid_micros: request.maxBidMicros,
        },
      }, `${request.operationId}-ad-group`);
      const adGroupId = resourceId(created.id, "adgrp_");
      if (!adGroupId || clean(created.status) !== "paused") fail("INVALID_PROVIDER_RESPONSE", "ChatGPT Ads n’a pas confirmé le groupe d’annonces en pause.");
      await save({ ...progress, adGroupId, stage: "ad_group_created" });
    }
    if (!progress.imageFileId) {
      mutation();
      const uploaded = await apiRequest(key, "/upload", "POST", fetchImpl, { image_url: request.imageUrl });
      const imageFileId = resourceId(uploaded.file_id, "file_");
      if (!imageFileId) fail("INVALID_PROVIDER_RESPONSE", "ChatGPT Ads n’a pas confirmé l’image publicitaire.");
      await save({ ...progress, imageFileId, stage: "image_uploaded" });
    }
    if (!progress.adId) {
      mutation();
      const created = await apiRequest(key, "/ads", "POST", fetchImpl, {
        ad_group_id: progress.adGroupId,
        name: request.adName,
        status: "paused",
        creative: {
          type: "chat_card",
          title: request.title,
          body: request.body,
          target_url: request.destinationUrl,
          file_id: progress.imageFileId,
        },
      }, `${request.operationId}-ad`);
      const adId = resourceId(created.id, "ad_");
      if (!adId || clean(created.status) !== "paused") fail("INVALID_PROVIDER_RESPONSE", "ChatGPT Ads n’a pas confirmé l’annonce en pause.");
      await save({ ...progress, adId, stage: "ad_created" });
    }
    const [campaign, adGroup, ad] = await Promise.all([
      apiRequest(key, `/campaigns/${progress.campaignId}`, "GET", fetchImpl),
      apiRequest(key, `/ad_groups/${progress.adGroupId}`, "GET", fetchImpl),
      apiRequest(key, `/ads/${progress.adId}`, "GET", fetchImpl),
    ]);
    if (clean(campaign.status) !== "paused" || clean(adGroup.status) !== "paused" || clean(ad.status) !== "paused" ||
      resourceId(campaign.id, "cmpn_") !== progress.campaignId ||
      resourceId(adGroup.id, "adgrp_") !== progress.adGroupId ||
      resourceId(ad.id, "ad_") !== progress.adId ||
      (clean(adGroup.campaign_id) && clean(adGroup.campaign_id) !== progress.campaignId) ||
      (clean(ad.ad_group_id) && clean(ad.ad_group_id) !== progress.adGroupId)) {
      fail("PROVIDER_STATE_MISMATCH", "La campagne ChatGPT Ads n’est pas entièrement en pause. Vérifiez Ads Manager.");
    }
    await save({ ...progress, stage: "paused" });
    return progress;
  } catch (error) {
    if (error instanceof OpenaiAdsPublishError) {
      throw new OpenaiAdsPublishError(error.code, error.message, progress, mutationStarted || error.mutationStarted, error.httpStatus);
    }
    throw new OpenaiAdsPublishError("LOCAL_FAILURE", "La préparation ChatGPT Ads a été interrompue. Vérifiez Ads Manager.", progress, mutationStarted);
  }
}

async function readOpenaiAdsCampaignStateWithPolicy(
  options: ReadOpenaiAdsCampaignStateOptions,
  requireAccountReady: boolean,
): Promise<OpenaiAdsCampaignState> {
  const key = apiKey(options.apiKey);
  const progress = options.progress;
  if (!isOpenaiAdsPublishProgress(progress) || !progress.campaignId || !progress.adGroupId || !progress.adId ||
    progress.accountId !== options.expectedAccountId) fail("PROGRESS_MISMATCH", "Les identifiants ChatGPT Ads sont incomplets.");
  const fetchImpl = options.fetchImpl || fetch;
  const account = await verifyOpenaiAdsAccount({ apiKey: key, expectedAccountId: progress.accountId, fetchImpl });
  // Identity is mandatory for every lifecycle action. Readiness is intentionally
  // enforced only before activation: an account becoming inactive or entering
  // review must never prevent an emergency pause of its campaign.
  if (requireAccountReady) assertAccountReady(account);
  const [campaign, adGroup, ad] = await Promise.all([
    apiRequest(key, `/campaigns/${progress.campaignId}`, "GET", fetchImpl),
    apiRequest(key, `/ad_groups/${progress.adGroupId}`, "GET", fetchImpl),
    apiRequest(key, `/ads/${progress.adId}`, "GET", fetchImpl),
  ]);
  const campaignStatus = clean(campaign.status);
  const adGroupStatus = clean(adGroup.status);
  const adStatus = clean(ad.status);
  if (resourceId(campaign.id, "cmpn_") !== progress.campaignId ||
    resourceId(adGroup.id, "adgrp_") !== progress.adGroupId ||
    resourceId(ad.id, "ad_") !== progress.adId ||
    (clean(adGroup.campaign_id) && clean(adGroup.campaign_id) !== progress.campaignId) ||
    (clean(ad.ad_group_id) && clean(ad.ad_group_id) !== progress.adGroupId) ||
    !["paused", "active"].includes(campaignStatus) ||
    !["paused", "active"].includes(adGroupStatus) ||
    !["paused", "active"].includes(adStatus)) {
    fail("PROVIDER_STATE_MISMATCH", "Les ressources ChatGPT Ads ont changé ou leur état n’est pas gérable.");
  }
  return {
    campaignId: progress.campaignId,
    adGroupId: progress.adGroupId,
    adId: progress.adId,
    campaignStatus: campaignStatus as OpenaiAdsCampaignState["campaignStatus"],
    adGroupStatus: adGroupStatus as OpenaiAdsCampaignState["adGroupStatus"],
    adStatus: adStatus as OpenaiAdsCampaignState["adStatus"],
    reviewStatus: clean(ad.review_status),
  };
}

/**
 * Reads the three remote resources after validating the advertiser identity
 * and persisted parent links. It deliberately does not require a currently
 * active/approved account so pause and read-only reconciliation remain usable.
 */
export async function readOpenaiAdsCampaignState(
  options: ReadOpenaiAdsCampaignStateOptions,
): Promise<OpenaiAdsCampaignState> {
  return readOpenaiAdsCampaignStateWithPolicy(options, false);
}

export function openaiAdsReviewAllowsActivation(reviewStatus: unknown): boolean {
  return typeof reviewStatus === "string" && ["approved", "in_review"].includes(reviewStatus.trim());
}

/**
 * Deliberately separate from creation. GET /ad_account does not expose a
 * documented billing-ready field. The caller must independently confirm
 * billing before invoking this function; activation never guarantees delivery.
 */
export async function activateOpenaiAdsCampaign(options: ActivateOpenaiAdsCampaignOptions): Promise<OpenaiAdsPublishProgress> {
  const key = apiKey(options.apiKey);
  const progress = options.progress;
  if (!isOpenaiAdsPublishProgress(progress) || !progress.campaignId || !progress.adGroupId || !progress.adId ||
    progress.accountId !== options.expectedAccountId) fail("PROGRESS_MISMATCH", "Les identifiants ChatGPT Ads sont incomplets.");
  if (!options.billingConfirmed) fail("BILLING_UNCONFIRMED", "Vérifiez la facturation dans Ads Manager avant d’activer cette campagne.");
  const fetchImpl = options.fetchImpl || fetch;
  const state = await readOpenaiAdsCampaignStateWithPolicy({
    apiKey: key,
    progress,
    expectedAccountId: options.expectedAccountId,
    fetchImpl,
  }, true);
  if (!openaiAdsReviewAllowsActivation(state.reviewStatus)) {
    fail("REVIEW_OR_STATE_BLOCKED", "L’annonce ChatGPT Ads a été refusée, sa revue est inconnue ou ses ressources ont changé.");
  }
  let mutationStarted = false;
  const save = async (stage: OpenaiAdsPublishProgress["stage"]) => {
    progress.stage = stage;
    await options.onProgress?.({ ...progress });
  };
  try {
    if (state.adStatus === "paused") {
      mutationStarted = true;
      const activated = await apiRequest(key, `/ads/${progress.adId}/activate`, "POST", fetchImpl);
      if (clean(activated.status) !== "active") fail("PROVIDER_STATE_MISMATCH", "ChatGPT Ads n’a pas confirmé l’activation de l’annonce.");
    }
    await save("ad_activated");
    if (state.adGroupStatus === "paused") {
      mutationStarted = true;
      const activated = await apiRequest(key, `/ad_groups/${progress.adGroupId}/activate`, "POST", fetchImpl);
      if (clean(activated.status) !== "active") fail("PROVIDER_STATE_MISMATCH", "ChatGPT Ads n’a pas confirmé l’activation du groupe d’annonces.");
    }
    await save("ad_group_activated");
    if (state.campaignStatus === "paused") {
      mutationStarted = true;
      const activated = await apiRequest(key, `/campaigns/${progress.campaignId}/activate`, "POST", fetchImpl);
      if (clean(activated.status) !== "active") fail("PROVIDER_STATE_MISMATCH", "ChatGPT Ads n’a pas confirmé l’activation de la campagne.");
    }
    await save("active");
    return progress;
  } catch (error) {
    if (error instanceof OpenaiAdsPublishError) {
      throw new OpenaiAdsPublishError(
        error.code,
        error.message,
        progress,
        mutationStarted || error.mutationStarted,
        error.httpStatus,
      );
    }
    throw new OpenaiAdsPublishError(
      "LOCAL_FAILURE",
      "L’activation ChatGPT Ads n’a pas pu être confirmée. Vérifiez Ads Manager.",
      progress,
      mutationStarted,
    );
  }
}

/**
 * Pausing the parent campaign first stops delivery without leaving a window in
 * which a child can serve. Resuming delegates to the reviewed child → group →
 * campaign activation sequence above, with the campaign still activated last.
 */
export async function setOpenaiAdsCampaignPaused(
  options: SetOpenaiAdsCampaignPausedOptions,
): Promise<OpenaiAdsPublishProgress> {
  if (!options.paused) return activateOpenaiAdsCampaign({
    ...options,
    billingConfirmed: options.billingConfirmed === true,
  });
  const key = apiKey(options.apiKey);
  const progress = options.progress;
  const fetchImpl = options.fetchImpl || fetch;
  const state = await readOpenaiAdsCampaignState({
    apiKey: key,
    progress,
    expectedAccountId: options.expectedAccountId,
    fetchImpl,
  });
  let mutationStarted = false;
  try {
    if (state.campaignStatus === "active") {
      // The response may be lost after the provider applied the mutation. From
      // this point onward the lifecycle route must never restore a local
      // `active` status solely because a subsequent confirmation read failed.
      mutationStarted = true;
      const paused = await apiRequest(key, `/campaigns/${state.campaignId}/pause`, "POST", fetchImpl);
      if (clean(paused.status) !== "paused") {
        fail("PROVIDER_STATE_MISMATCH", "ChatGPT Ads n’a pas confirmé la mise en pause de la campagne.");
      }
    }
    const confirmed = await apiRequest(key, `/campaigns/${state.campaignId}`, "GET", fetchImpl);
    if (resourceId(confirmed.id, "cmpn_") !== state.campaignId || clean(confirmed.status) !== "paused") {
      fail("PROVIDER_STATE_MISMATCH", "La campagne ChatGPT Ads n’est pas confirmée en pause.");
    }
    progress.stage = "paused";
    await options.onProgress?.({ ...progress });
    return progress;
  } catch (error) {
    if (error instanceof OpenaiAdsPublishError) {
      throw new OpenaiAdsPublishError(
        error.code,
        error.message,
        progress,
        mutationStarted || error.mutationStarted,
        error.httpStatus,
      );
    }
    throw new OpenaiAdsPublishError(
      "LOCAL_FAILURE",
      "La mise en pause ChatGPT Ads n’a pas pu être confirmée. Vérifiez Ads Manager.",
      progress,
      mutationStarted,
    );
  }
}

export async function previewOpenaiAdsAd(options: OpenaiAdsConnectorOptions & { adId: string }): Promise<Json> {
  const id = resourceId(options.adId, "ad_");
  if (!id) fail("INVALID_REQUEST", "L’identifiant de l’annonce ChatGPT Ads est invalide.");
  return apiRequest(apiKey(options.apiKey), `/ads/${id}/preview`, "POST", options.fetchImpl || fetch);
}
