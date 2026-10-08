import "server-only";
import { resolveLinkedInAdsGeoTargets } from "./adsLinkedInGeoResolution.ts";

import sharp from "sharp";
import { uploadLinkedInAdsVideo, validateLinkedInAdsVideoSource, linkedInAdsVideoUrn, LINKEDIN_ADS_VIDEO_MAX_BYTES, LinkedInVideoUploadError, type LinkedInAdsVideoSource } from "./adsLinkedInVideo.ts";
import type { AdsCampaignInput } from "./adsValidation.ts";
import { assessAdsChannelDraft, type LinkedInAdsDraft } from "./adsChannelDrafts.ts";
import { normalizeLinkedInDeliverySettings, linkedInDeliveryBidding, linkedInTrackedDestination, type LinkedInProfessionalTarget } from "./adsLinkedInCampaignSettings.ts";
import { resolveLinkedInAdsProfessionalTargets, resolveLinkedInAdsConversions } from "./adsLinkedInResourcesServer.ts";
import {
  linkedInAdsHasAccessMode,
  LINKEDIN_ADS_API_VERSION,
  type LinkedInAdsAccount,
} from "./adsLinkedInPolicy.ts";
import {
  LinkedInAdsConnectionError,
  linkedInAdsAuthorization,
  listLinkedInAdsAccounts,
  readLinkedInAdsIntegration,
} from "./adsLinkedInServer.ts";
import {
  buildLinkedInAdsAudienceCountPath,
  buildLinkedInAdsBudgetPricingPath,
  buildLinkedInAdsCampaignGroupsPath,
  buildLinkedInAdsImagePath,
  buildLinkedInAdsLocalesPath,
  linkedInAdsPreflightBlockers,
  normalizeLinkedInAdsAudienceCount,
  normalizeLinkedInAdsBudgetPricing,
  normalizeLinkedInAdsCampaignGroups,
  normalizeLinkedInAdsImage,
  normalizeLinkedInAdsLocales,
  type LinkedInAdsCampaignGroup,
  type LinkedInAdsImageEvidence,
} from "./adsLinkedInPreflightPolicy.ts";
import {
  buildLinkedInAdsFinalizationSteps,
  linkedInAdsCampaignScheduleIssues,
  prepareLinkedInAdsDarkPost,
  prepareLinkedInAdsDraftCampaign,
  prepareLinkedInAdsDraftCreative,
  type LinkedInAdsCampaignEvidence,
  type LinkedInAdsDraftCampaignChoices,
} from "./adsLinkedInPublish.ts";
import {
  assertLinkedInPublishProgress,
  isSafeLinkedInImageUploadUrl,
  linkedInAdsCampaignReference,
  linkedInAdsCreativeUrn,
  linkedInAdsImageUrn,
  linkedInAdsPostUrn,
  withLinkedInRequestId,
  type LinkedInAdsCreateStep,
  type LinkedInAdsPublishProgress,
} from "./adsLinkedInPublisherCore.ts";
import { verifyMediaLibraryContentToken } from "./mediaLibraryContentUrl.ts";
import { supabaseAdmin } from "./supabaseAdmin.ts";

const LINKEDIN_REST_ORIGIN = "https://api.linkedin.com";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 36_152_320;
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif"]);
const ORGANIZATION_URN = /^urn:li:organization:\d{1,25}$/;

type PersistLinkedInProgress = (progress: LinkedInAdsPublishProgress) => Promise<void>;
type PublisherFetch = typeof fetch;

type LinkedInAdsPublisherOptions = {
  operationKey: string;
  activate?: boolean;
  initialProgress?: LinkedInAdsPublishProgress | null;
  onProviderMutationStart?: () => void;
  fetchImpl?: PublisherFetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

type PreparedImage = { bytes: Buffer; contentType: string };
type OrganizationAccess = { urn: string; role: "ADMINISTRATOR" | "DIRECT_SPONSORED_CONTENT_POSTER" | "CONTENT_ADMINISTRATOR" };

type PublicationEvidence = {
  token: string;
  scopes: string;
  account: LinkedInAdsAccount;
  campaignGroup: LinkedInAdsCampaignGroup;
  organization: OrganizationAccess;
  geoUrns: string[];
  verifiedProfessionalTargets: LinkedInProfessionalTarget[];
  verifiedConversionUrns: string[];
  supportedLocales: Array<{ language: string; country: string }>;
  image: LinkedInAdsImageEvidence | null;
  video: LinkedInAdsImageEvidence | null;
  pricing: { bidMin: number; bidMax: number; dailyBudgetMin: number };
  checkedAtMs: number;
};

export class LinkedInAdsPublishError extends Error {
  constructor(
    message: string,
    readonly progress: LinkedInAdsPublishProgress,
    readonly mutationStarted: boolean,
    readonly retrySafe: boolean,
  ) {
    super(message);
    this.name = "LinkedInAdsPublishError";
  }
}

class ProviderMutationFailure extends Error {
  constructor(message: string, readonly uncertain: boolean) {
    super(message);
    this.name = "ProviderMutationFailure";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function allowedDevelopmentAccountIds(): Set<string> {
  return new Set(String(process.env.LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS || "")
    .split(/[\s,]+/).map((value) => value.trim()).filter((value) => /^\d{1,25}$/.test(value)));
}

function providerHeaders(token: string, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Linkedin-Version": LINKEDIN_ADS_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function providerReadError(status: number): LinkedInAdsConnectionError {
  if (status === 404) return new LinkedInAdsConnectionError("Cette ressource LinkedIn n’existe pas.", "provider_not_found", 404);
  if (status === 401 || status === 403) {
    return new LinkedInAdsConnectionError(
      "LinkedIn refuse le contrôle préalable. Reconnectez LinkedIn Ads et vérifiez les rôles du compte et de la Page.",
      "preflight_access_denied",
      403,
    );
  }
  return new LinkedInAdsConnectionError("Le contrôle préalable LinkedIn Ads est indisponible.", "provider_unavailable");
}

function retryDelay(response: Response, attempt: number): number {
  const raw = response.headers.get("retry-after");
  const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  const date = raw && !Number.isFinite(seconds) ? Date.parse(raw) : NaN;
  const requested = Number.isFinite(seconds) ? seconds * 1_000
    : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 250 * (2 ** attempt);
  return Math.max(250, Math.min(5_000, requested));
}

async function linkedInRead(
  token: string,
  path: string,
  fetchImpl: PublisherFetch,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(`${LINKEDIN_REST_ORIGIN}${path}`, {
        headers: providerHeaders(token),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      if (attempt < 2) {
        await sleep(250 * (2 ** attempt));
        continue;
      }
      throw new LinkedInAdsConnectionError("LinkedIn Ads n’a pas répondu au contrôle préalable.", "provider_unavailable");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      throw Object.assign(providerReadError(response.status), { providerStatus: response.status });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new LinkedInAdsConnectionError("Réponse LinkedIn Ads invalide.", "provider_invalid_response");
    }
    return payload as Record<string, unknown>;
  }
  throw new LinkedInAdsConnectionError("LinkedIn Ads est indisponible.", "provider_unavailable");
}

function normalizeOrganizationAccess(payload: unknown): OrganizationAccess[] | null {
  const elements = record(payload).elements;
  if (!Array.isArray(elements) || elements.length > 500) return null;
  const found = new Map<string, OrganizationAccess>();
  for (const value of elements) {
    const row = record(value);
    if (row.state !== "APPROVED") continue;
    const role = text(row.role);
    if (role !== "ADMINISTRATOR" && role !== "DIRECT_SPONSORED_CONTENT_POSTER" && role !== "CONTENT_ADMINISTRATOR") continue;
    const urn = text(row.organization) || text(row.organizationTarget);
    if (!ORGANIZATION_URN.test(urn)) return null;
    found.set(urn, { urn, role });
  }
  return [...found.values()];
}

function mediaLibraryId(value: string): string | null {
  if (!value.startsWith("/")) return null;
  try {
    const url = new URL(value, "https://inrcy-media.local");
    if (url.origin !== "https://inrcy-media.local") return null;
    const match = url.pathname.match(/^\/api\/media-library\/items\/([0-9a-f-]{36})\/content$/i);
    const id = match?.[1] || "";
    return id && verifyMediaLibraryContentToken(id, url.searchParams.get("token") || "") ? id : null;
  } catch {
    return null;
  }
}

async function readCampaignImage(userId: string, draft: AdsCampaignInput): Promise<PreparedImage> {
  const reference = String(draft.creativeUrl || draft.imageUrl || "").trim();
  const id = mediaLibraryId(reference);
  if (!id) {
    throw new Error("Pour un lancement LinkedIn sûr, importez l’image dans la médiathèque iNrCy avant de lancer la campagne.");
  }
  const { data: media, error } = await supabaseAdmin.from("pro_media_library")
    .select("bucket_name,storage_path,media_type,mime_type,size_bytes,width,height,is_active")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (error || !media || media.is_active === false) throw new Error("Le média LinkedIn sélectionné n’est plus disponible.");
  if (media.media_type !== "image") throw new Error("Le lancement LinkedIn classique requiert une image unique.");
  const declaredSize = Number(media.size_bytes || 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) throw new Error("L’image LinkedIn dépasse la limite iNrCy de 10 Mo.");
  const bucket = String(media.bucket_name || "inrcy-pro-media").trim();
  const storagePath = String(media.storage_path || "").trim();
  if (!bucket || !storagePath || storagePath.includes("..") || storagePath.includes("\\")) throw new Error("Le chemin du média LinkedIn est invalide.");
  const downloaded = await supabaseAdmin.storage.from(bucket).download(storagePath);
  if (downloaded.error || !downloaded.data) throw new Error("L’image LinkedIn n’a pas pu être relue depuis la médiathèque.");
  if (downloaded.data.size <= 0 || downloaded.data.size > MAX_IMAGE_BYTES) throw new Error("L’image LinkedIn est vide ou dépasse 10 Mo.");
  const contentType = String(downloaded.data.type || media.mime_type || "").split(";", 1)[0].toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(contentType)) throw new Error("LinkedIn accepte ici une image JPEG, PNG ou GIF.");
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  const metadata = await sharp(bytes, { animated: false }).metadata().catch(() => null);
  const width = Number(metadata?.width || 0);
  const height = Number(metadata?.height || 0);
  const detectedType = metadata?.format === "jpeg" ? "image/jpeg"
    : metadata?.format === "png" ? "image/png"
      : metadata?.format === "gif" ? "image/gif" : "";
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width * height > MAX_IMAGE_PIXELS || !detectedType || detectedType !== contentType
    || Number(metadata?.pages || 1) > 250) {
    throw new Error("Les dimensions de l’image LinkedIn sont invalides ou dépassent la limite de pixels.");
  }
  return { bytes, contentType };
}

async function readCampaignVideo(userId: string, draft: AdsCampaignInput): Promise<LinkedInAdsVideoSource> {
  const id = mediaLibraryId(String(draft.creativeUrl || draft.imageUrl || "").trim());
  if (!id) throw new Error("Pour un lancement LinkedIn sûr, importez la vidéo dans la médiathèque iNrCy.");
  const { data: media, error } = await supabaseAdmin.from("pro_media_library")
    .select("bucket_name,storage_path,media_type,mime_type,size_bytes,is_active")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (error || !media || media.is_active === false || media.media_type !== "video") throw new Error("La vidéo LinkedIn sélectionnée n’est plus disponible.");
  if (Number(media.size_bytes || 0) > LINKEDIN_ADS_VIDEO_MAX_BYTES) throw new Error("La vidéo LinkedIn dépasse la limite de la médiathèque iNrCy.");
  const bucket = String(media.bucket_name || "inrcy-pro-media").trim();
  const storagePath = String(media.storage_path || "").trim();
  if (!bucket || !storagePath || storagePath.includes("..") || storagePath.includes("\\")) throw new Error("Le chemin de la vidéo LinkedIn est invalide.");
  const downloaded = await supabaseAdmin.storage.from(bucket).download(storagePath);
  if (downloaded.error || !downloaded.data || downloaded.data.size <= 0 || downloaded.data.size > LINKEDIN_ADS_VIDEO_MAX_BYTES) throw new Error("La vidéo LinkedIn est vide ou dépasse la limite iNrCy.");
  const source = { bytes: Buffer.from(await downloaded.data.arrayBuffer()), contentType: String(downloaded.data.type || media.mime_type || ""), sourceIdentity: id };
  validateLinkedInAdsVideoSource(source);
  return source;
}

function campaignEndAtMs(endDate: string): number {
  const end = Date.parse(`${endDate}T23:59:59Z`);
  if (!Number.isSafeInteger(end)) throw new Error("La date de fin LinkedIn est invalide.");
  return end;
}

function publicationSchedule(draft: AdsCampaignInput, group: LinkedInAdsCampaignGroup, nowMs: number) {
  return {
    startAtMs: draft.linkedinDeliverySettings?.budget.startAt
      ? Date.parse(draft.linkedinDeliverySettings.budget.startAt) : Math.max(nowMs + 5 * 60_000, group.runSchedule.start || 0),
    endAtMs: draft.linkedinDeliverySettings?.budget.endAt
      ? Date.parse(draft.linkedinDeliverySettings.budget.endAt) : campaignEndAtMs(draft.endDate),
  };
}

function providerBrief(draft: AdsCampaignInput): LinkedInAdsDraft {
  const settings = draft.channelSettings?.channel === "linkedin" ? draft.channelSettings : null;
  if (!settings) throw new Error("Les réglages LinkedIn sont incomplets.");
  return {
    schemaVersion: 1,
    channel: "linkedin",
    name: draft.name,
    objectiveType: settings.objectiveType,
    format: settings.format,
    budget: { amount: draft.dailyBudgetEuros, currency: "EUR", period: "daily", level: "campaign" },
    audience: { locationBriefs: (draft.linkedinGeoTargets || []).map((geo) => geo.urn), audienceBrief: draft.targetAudiences.join(" · ") || "Audience professionnelle" },
    locale: settings.locale,
    creative: {
      introText: draft.primaryText,
      headline: String(draft.headlines[0] || draft.name).trim(),
      mediaBrief: draft.mediaBrief?.trim().length >= 10 ? draft.mediaBrief : "Média sélectionné dans la médiathèque iNrCy",
      destinationUrl: linkedInTrackedDestination(draft.destinationUrl, draft.trackingParameters).url || "",
    },
  };
}

function assertLocalPublicationChoices(draft: AdsCampaignInput, nowMs: number): void {
  const delivery = normalizeLinkedInDeliverySettings(draft.linkedinDeliverySettings);
  if (delivery.error) throw new Error(delivery.error);
  const brief = providerBrief(draft);
  const issues = assessAdsChannelDraft(brief).briefIssues;
  if (issues.length) throw new Error(`La création LinkedIn est incomplète : ${issues.map((item) => item.code).join(", ")}.`);
  if (!["STANDARD_UPDATE", "SINGLE_VIDEO"].includes(brief.format) || (brief.objectiveType === "VIDEO_VIEW" && brief.format !== "SINGLE_VIDEO") || !linkedInDeliveryBidding(brief.objectiveType, delivery.settings)) throw new Error("L’objectif, le format ou la stratégie d’enchères LinkedIn ne sont pas compatibles.");
  const tracked = linkedInTrackedDestination(draft.destinationUrl, draft.trackingParameters);
  if (tracked.error) throw new Error(tracked.error);
  const schedule = publicationSchedule(draft, { runSchedule: {} } as LinkedInAdsCampaignGroup, nowMs);
  if (linkedInAdsCampaignScheduleIssues({ ...schedule, groupSchedule: {}, nowMs }).length || schedule.endAtMs > nowMs + 90 * 86_400_000) throw new Error("Le calendrier LinkedIn est invalide.");
  const bid = delivery.settings?.bidding.amountEuros ?? draft.linkedinBidEuros;
  const budget = delivery.settings?.budget.type === "total" ? delivery.settings.budget.totalEuros : draft.dailyBudgetEuros;
  if (delivery.settings?.bidding.strategy !== "maximum_delivery" && (!Number.isFinite(bid) || Number(bid) <= 0 || Number(bid) > Number(budget))) throw new Error("L’enchère LinkedIn est invalide.");
  if (brief.objectiveType === "WEBSITE_CONVERSION" && !delivery.settings?.conversions.conversionUrns.length) throw new Error("Sélectionnez une conversion LinkedIn pour cet objectif.");
}

function providerDraft(draft: AdsCampaignInput, evidence: PublicationEvidence, imageUrn: string): LinkedInAdsDraft {
  return {
    ...providerBrief(draft),
    externalRefs: {
      adAccountUrn: `urn:li:sponsoredAccount:${draft.adAccountId}`,
      campaignGroupUrn: evidence.campaignGroup.urn,
      organizationUrn: evidence.organization.urn,
      creativeAssetUrn: imageUrn,
      geoUrns: evidence.geoUrns,
    },
  };
}

async function readPublicationAccount(
  userId: string,
  draft: AdsCampaignInput,
) {
  const integration = await readLinkedInAdsIntegration(userId);
  if (!integration || integration.status !== "connected" || integration.resource_id !== draft.adAccountId) {
    throw new LinkedInAdsConnectionError("Le compte LinkedIn Ads associé a changé. Reconnectez-le avant le lancement.", "connection_changed", 409);
  }
  // Discovery can refresh credentials. Authorize the current row once afterwards,
  // rather than refreshing the same expired snapshot twice.
  const accounts = await listLinkedInAdsAccounts(userId, integration);
  const currentIntegration = await readLinkedInAdsIntegration(userId);
  if (!currentIntegration || currentIntegration.status !== "connected" || currentIntegration.resource_id !== draft.adAccountId || currentIntegration.id !== integration.id || currentIntegration.provider_account_id !== integration.provider_account_id) throw new LinkedInAdsConnectionError("La connexion LinkedIn a changé pendant le contrôle. Relancez la vérification.", "connection_changed", 409);
  const { token, scopes } = await linkedInAdsAuthorization(userId, currentIntegration);
  if (!linkedInAdsHasAccessMode(scopes, "manage")) {
    throw new LinkedInAdsConnectionError("Reconnectez LinkedIn Ads pour accorder les autorisations de gestion complètes.", "missing_scopes", 403);
  }
  const account = accounts.find((item) => item.id === draft.adAccountId);
  if (!account || !allowedDevelopmentAccountIds().has(account.id)) {
    throw new LinkedInAdsConnectionError("Ce compte n’est pas mappé à l’application LinkedIn Advertising API en Development Tier.", "development_account_mapping_required", 403);
  }
  if (account.currency !== "EUR") throw new LinkedInAdsConnectionError("Le compte LinkedIn Ads doit être en EUR.", "unsupported_account_currency", 422);
  if (!account.canManageCampaigns) throw new LinkedInAdsConnectionError("Votre rôle LinkedIn ne permet plus de gérer les campagnes.", "account_access_denied", 403);
  return { token, scopes, account };
}

async function collectPublicationEvidence(
  userId: string,
  draft: AdsCampaignInput,
  targetStatus: "ACTIVE" | "PAUSED",
  fetchImpl: PublisherFetch,
  sleep: (milliseconds: number) => Promise<void>,
  now: () => number,
  imageUrn?: string,
): Promise<PublicationEvidence> {
  const { token, scopes, account } = await readPublicationAccount(userId, draft);
  if (targetStatus === "ACTIVE" && !account.canServeCampaigns) {
    throw new LinkedInAdsConnectionError("Le compte LinkedIn Ads est suspendu, en attente ou On hold. Réactivez sa servabilité dans Campaign Manager avant tout lancement.", "account_not_serving", 409);
  }
  const settings = draft.channelSettings?.channel === "linkedin" ? draft.channelSettings : null;
  const groupId = String(draft.linkedinCampaignGroupId || "");
  const organizationUrn = String(draft.linkedinOrganizationUrn || "");
  const geoTargets = draft.linkedinGeoTargets || [];
  if (!settings || !/^\d{1,25}$/.test(groupId) || !ORGANIZATION_URN.test(organizationUrn) || !geoTargets.length) {
    throw new Error("Les sélections LinkedIn (groupe, Page et zones) sont incomplètes.");
  }
  const delivery = draft.linkedinDeliverySettings;
  const [groupsPayload, organizationsPayload, localesPayload, verifiedGeos, professionals, conversions] = await Promise.all([
    linkedInRead(token, buildLinkedInAdsCampaignGroupsPath(account.id), fetchImpl, sleep),
    linkedInRead(token, "/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=500&start=0", fetchImpl, sleep),
    linkedInRead(token, buildLinkedInAdsLocalesPath(), fetchImpl, sleep),
    resolveLinkedInAdsGeoTargets({
      targets: geoTargets,
      language: settings.locale.language,
      country: settings.locale.country,
      read: (path) => linkedInRead(token, path, fetchImpl, sleep),
    }),
    resolveLinkedInAdsProfessionalTargets({ accessToken: token, targets: [...(delivery?.professionalTargeting.include || []), ...(delivery?.professionalTargeting.exclude || [])], language: settings.locale.language, country: settings.locale.country, read: (path) => linkedInRead(token, path, fetchImpl, sleep) }),
    resolveLinkedInAdsConversions({ accessToken: token, accountId: account.id, conversionUrns: delivery?.conversions.conversionUrns || [], read: (path) => linkedInRead(token, path, fetchImpl, sleep) }),
  ]);
  if (professionals.unresolvedTargets.length) throw new Error("LinkedIn n’a pas confirmé les critères professionnels sélectionnés.");
  if (conversions.unresolvedUrns.length) throw new Error("LinkedIn n’a pas confirmé les conversions actives sélectionnées dans ce compte.");
  const groups = normalizeLinkedInAdsCampaignGroups(groupsPayload, account.id);
  const organizations = normalizeOrganizationAccess(organizationsPayload);
  const supportedLocales = normalizeLinkedInAdsLocales(localesPayload);
  if (!groups) throw new LinkedInAdsConnectionError("Les groupes de campagnes renvoyés par LinkedIn ne peuvent pas être vérifiés.", "campaign_groups_invalid_response");
  if (!organizations) throw new LinkedInAdsConnectionError("Les autorisations de Page renvoyées par LinkedIn ne peuvent pas être vérifiées.", "organization_access_invalid_response");
  if (!supportedLocales) throw new LinkedInAdsConnectionError("Les langues renvoyées par LinkedIn ne peuvent pas être vérifiées.", "interface_locales_invalid_response");
  const campaignGroup = groups.find((item) => item.id === groupId) || null;
  const organization = organizations.find((item) => item.urn === organizationUrn) || null;
  if (!campaignGroup || !organization) throw new Error("Le groupe de campagnes ou la Page LinkedIn n’est plus accessible.");
  if (campaignGroup.organizationUrn && campaignGroup.organizationUrn !== organization.urn) {
    throw new Error("Le groupe de campagnes LinkedIn n’appartient pas à la Page sélectionnée.");
  }
  if (targetStatus === "ACTIVE" && campaignGroup.status !== "ACTIVE") {
    throw new Error("Le groupe de campagnes LinkedIn doit être actif avant un lancement Active. iNrCy ne l’active jamais sans votre choix explicite.");
  }
  const scheduleNow = now();
  if (linkedInAdsCampaignScheduleIssues({
    ...publicationSchedule(draft, campaignGroup, scheduleNow), groupSchedule: campaignGroup.runSchedule, nowMs: scheduleNow,
  }).length) {
    throw new LinkedInAdsConnectionError(
      "Les dates de la campagne ne sont pas compatibles avec celles du groupe LinkedIn. Choisissez une fin comprise dans la période du groupe, ou un autre groupe disponible.",
      "campaign_schedule_invalid", 422,
    );
  }
  const requestedGeoUrns = new Set(geoTargets.map((target) => target.urn));
  const everyGeoMatches = verifiedGeos.every((geo) =>
    requestedGeoUrns.has(geo.urn) && geo.facetUrn === "urn:li:adTargetingFacet:locations");
  if (!everyGeoMatches || verifiedGeos.length !== requestedGeoUrns.size) {
    throw new Error("Une zone LinkedIn a changé ou n’est plus vérifiable. Sélectionnez-la à nouveau.");
  }
  const geoUrns = geoTargets.map((target) => target.urn);
  const [audiencePayload, pricingPayload, imagePayload] = await Promise.all([
    linkedInRead(token, buildLinkedInAdsAudienceCountPath(geoUrns, settings.locale.language, settings.locale.country, delivery), fetchImpl, sleep),
    linkedInRead(token, buildLinkedInAdsBudgetPricingPath({
      accountId: account.id,
      geoUrns,
      language: settings.locale.language,
      country: settings.locale.country,
      dailyBudget: delivery?.budget.type === "total" ? undefined : draft.dailyBudgetEuros,
      objectiveType: settings.objectiveType, deliverySettings: delivery,
    }), fetchImpl, sleep),
    imageUrn ? linkedInRead(token, linkedInAdsVideoUrn(imageUrn) ? `/rest/videos/${encodeURIComponent(imageUrn)}` : buildLinkedInAdsImagePath(imageUrn), fetchImpl, sleep) : Promise.resolve(null),
  ]);
  const audienceCount = normalizeLinkedInAdsAudienceCount(audiencePayload);
  const pricing = normalizeLinkedInAdsBudgetPricing(pricingPayload);
  const video = imageUrn && imagePayload && linkedInAdsVideoUrn(imageUrn) ? { urn: imageUrn, owner: text(imagePayload.owner), status: text(imagePayload.status), associatedAccount: null } : null;
  const image = imageUrn && imagePayload && !video ? normalizeLinkedInAdsImage(imagePayload, imageUrn) : null;
  if (video && (video.owner !== organization.urn || video.status !== "AVAILABLE")) throw new Error("La vidéo LinkedIn n’est pas disponible pour la Page sélectionnée.");
  const bidAmount = delivery?.bidding.amountEuros ?? draft.linkedinBidEuros ?? null;
  const blockers = linkedInAdsPreflightBlockers({
    scopes: scopes.split(/\s+/).filter(Boolean),
    accountCurrency: account.currency,
    canManageCampaigns: account.canManageCampaigns,
    canServeCampaigns: account.canServeCampaigns,
    targetStatus,
    campaignGroup,
    image,
    requireImage: Boolean(imageUrn) && !video,
    organizationUrn: organization.urn,
    localeSupported: supportedLocales.some((item) => item.language === settings.locale.language && item.country === settings.locale.country),
    verifiedGeoUrns: geoUrns,
    audienceCount,
    pricing,
    bidAmount,
    dailyBudget: draft.dailyBudgetEuros,
    objectiveType: settings.objectiveType, deliverySettings: delivery,
    totalBudget: delivery?.budget.totalEuros, scheduleDays: Math.ceil((publicationSchedule(draft, campaignGroup, scheduleNow).endAtMs - publicationSchedule(draft, campaignGroup, scheduleNow).startAtMs) / 86_400_000),
    politicalIntentConfirmed: draft.linkedinPoliticalIntentConfirmed === true,
    targetingNoticeAcknowledged: draft.linkedinTargetingNoticeAcknowledged === true,
  });
  if (blockers.length) throw new Error(`Le contrôle LinkedIn Ads bloque le lancement : ${blockers.join(", ")}.`);
  if (!pricing) throw new Error("LinkedIn n’a pas confirmé les bornes d’enchère et de budget.");
  return {
    token,
    scopes,
    account,
    campaignGroup,
    organization,
    geoUrns,
    verifiedProfessionalTargets: professionals.verifiedTargets,
    verifiedConversionUrns: conversions.verifiedConversions.map((conversion) => conversion.urn),
    supportedLocales,
    image, video,
    pricing,
    checkedAtMs: now(),
  };
}

async function createRequest(
  token: string,
  url: string,
  body: unknown,
  fetchImpl: PublisherFetch,
  expectedStatus: number,
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: providerHeaders(token, true),
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ProviderMutationFailure("LinkedIn n’a pas confirmé la création. Vérifiez Campaign Manager avant toute reprise.", true);
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status !== expectedStatus) {
    const uncertain = response.status === 429 || response.status >= 500;
    throw new ProviderMutationFailure(
      uncertain
        ? "LinkedIn n’a pas confirmé la création. Vérifiez Campaign Manager avant toute reprise."
        : `LinkedIn Ads a refusé cette étape (${response.status}).`,
      uncertain,
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProviderMutationFailure("LinkedIn a renvoyé une réponse de création invalide.", true);
  }
  return { response, payload: payload as Record<string, unknown> };
}

async function partialUpdate(
  token: string,
  path: string,
  headers: Record<string, string>,
  body: unknown,
  fetchImpl: PublisherFetch,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(`${LINKEDIN_REST_ORIGIN}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("LinkedIn n’a pas confirmé le changement de statut. Vérifiez Campaign Manager avant toute reprise.");
  }
  await response.text().catch(() => "");
  if (!response.ok) throw new Error(`LinkedIn Ads a refusé le changement de statut (${response.status}).`);
  return response;
}

async function waitForImage(
  token: string,
  imageUrn: string,
  fetchImpl: PublisherFetch,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<LinkedInAdsImageEvidence> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(4_000, 500 * (2 ** Math.min(attempt, 3))));
    const payload = await linkedInRead(token, buildLinkedInAdsImagePath(imageUrn), fetchImpl, sleep);
    const image = normalizeLinkedInAdsImage(payload, imageUrn);
    if (!image) throw new Error("LinkedIn a renvoyé un état d’image invalide.");
    if (image.status === "AVAILABLE") return image;
    if (image.status === "PROCESSING_FAILED") throw new Error("LinkedIn n’a pas pu traiter l’image sponsorisée.");
    if (image.status !== "WAITING_UPLOAD" && image.status !== "PROCESSING") {
      throw new Error("LinkedIn a renvoyé un état d’image inattendu.");
    }
  }
  throw new Error("L’image LinkedIn est toujours en cours de traitement. Reprenez la vérification plus tard.");
}

function campaignEvidence(
  payload: unknown,
  campaignUrn: string,
  accountId: string,
  groupUrn: string,
  organizationUrn: string,
  expectedStatus: "DRAFT" | "ACTIVE" | "PAUSED" = "DRAFT",
  objectiveType = "WEBSITE_VISIT",
  format = "STANDARD_UPDATE",
): LinkedInAdsCampaignEvidence["campaign"] | null {
  const row = record(payload);
  const id = linkedInAdsCampaignReference(row.id)?.urn;
  const account = text(row.account);
  const status = text(row.status);
  return id === campaignUrn && account === `urn:li:sponsoredAccount:${accountId}` && status === expectedStatus
    && text(row.campaignGroup) === groupUrn && text(row.associatedEntity) === organizationUrn
    && row.objectiveType === objectiveType && row.format === format && row.type === "SPONSORED_UPDATES"
    ? { urn: campaignUrn, account, status } : null;
}

function hasProviderResource(progress: LinkedInAdsPublishProgress): boolean {
  return Boolean(progress.imageUrn || progress.videoUrn || progress.videoCheckpoint || progress.campaignUrn || progress.postUrn || progress.creativeUrn);
}

/** Runs the publisher's initial checks without any provider or database mutation. */
export async function checkLinkedInAdsPublication(
  userId: string,
  draft: AdsCampaignInput,
  options: { activate?: boolean } = {},
): Promise<{ ready: true; verifiedGeoCount: number }> {
  try {
    if (draft.provider !== "linkedin") throw new LinkedInAdsConnectionError("Ce brouillon n’est pas une campagne LinkedIn Ads.", "invalid_provider", 422);
    assertLocalPublicationChoices(draft, Date.now());
    if (draft.channelSettings?.channel === "linkedin" && draft.channelSettings.format === "SINGLE_VIDEO") await readCampaignVideo(userId, draft);
    else await readCampaignImage(userId, draft);
    const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    const evidence = await collectPublicationEvidence(userId, draft, options.activate === false ? "PAUSED" : "ACTIVE", fetch, sleep, Date.now);
    return { ready: true, verifiedGeoCount: evidence.geoUrns.length };
  } catch (error) {
    if (error instanceof LinkedInAdsConnectionError) throw error;
    const message = error instanceof Error && /^(Le |La |Les |L’|Une |Pour |LinkedIn |iNrCy )/.test(error.message)
      ? error.message : "Le contrôle LinkedIn est temporairement indisponible.";
    throw new LinkedInAdsConnectionError(message, "publication_preflight_failed", 422);
  }
}

/**
 * Creates an image Sponsored Content campaign using only Development-mapped,
 * freshly revalidated resources. Every provider identifier is persisted before
 * the next create call. A pending/uncertain create is never replayed blindly.
 */
export async function publishLinkedInAdsCampaign(
  userId: string,
  draft: AdsCampaignInput,
  persistProgress: PersistLinkedInProgress,
  options: LinkedInAdsPublisherOptions,
): Promise<LinkedInAdsPublishProgress> {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const sleep = options.sleep || ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const targetStatus = options.activate === false ? "PAUSED" : "ACTIVE";
  let progress: LinkedInAdsPublishProgress = options.initialProgress || {
    schemaVersion: 1,
    operationKey: options.operationKey,
    accountId: draft.adAccountId,
    targetStatus,
    stage: "preflight_complete",
  };
  let mutationStarted = hasProviderResource(progress);
  const persist = async (next: LinkedInAdsPublishProgress) => {
    progress = next;
    await persistProgress(progress);
  };
  const beginCreate = async (step: LinkedInAdsCreateStep) => {
    if (progress.uncertainStep || (progress.pendingStep && progress.pendingStep !== step)) {
      throw new Error("Une étape LinkedIn précédente doit être réconciliée avant toute nouvelle création.");
    }
    if (progress.pendingStep === step) {
      await persist({ ...progress, uncertainStep: step });
      throw new Error("La réponse d’une création LinkedIn précédente est incertaine. Vérifiez Campaign Manager avant de reprendre.");
    }
    await persist({ ...progress, pendingStep: step });
    mutationStarted = true;
    options.onProviderMutationStart?.();
  };
  const failCreate = async (step: LinkedInAdsCreateStep, failure: ProviderMutationFailure) => {
    if (failure.uncertain) {
      await persist({ ...progress, pendingStep: undefined, uncertainStep: step }).catch(() => undefined);
    } else {
      await persist({ ...progress, pendingStep: undefined }).catch(() => undefined);
    }
    throw failure;
  };

  try {
    if (draft.provider !== "linkedin") throw new Error("Ce brouillon n’est pas une campagne LinkedIn Ads.");
    if (typeof persistProgress !== "function") throw new Error("La journalisation LinkedIn est obligatoire.");
    if (!/^\d{1,25}$/.test(draft.adAccountId) || draft.accountCurrency !== "EUR") throw new Error("Le compte LinkedIn Ads EUR est invalide.");
    assertLinkedInPublishProgress(progress, options.operationKey, draft.adAccountId, targetStatus);
    if (progress.uncertainStep) throw new Error("Cette campagne contient une création LinkedIn incertaine à contrôler dans Campaign Manager.");
    if (progress.pendingStep && ["initialize_image", "create_campaign", "create_dark_post", "create_creative"].includes(progress.pendingStep)) {
      const step = progress.pendingStep as LinkedInAdsCreateStep;
      await persist({ ...progress, pendingStep: undefined, uncertainStep: step });
      throw new Error("Une création LinkedIn a été interrompue après son envoi. Contrôlez Campaign Manager avant toute reprise.");
    }

    // A final PATCH can succeed even when its response or the local completion
    // write is lost. Reconcile that exact state before DRAFT-only serialization
    // or media/preflight checks. This branch never activates or creates anything.
    const finalCheckpoint = progress.stage === "active" || progress.stage === "paused";
    if (progress.pendingStep === "finalize_campaign" || finalCheckpoint) {
      if ((!finalCheckpoint && progress.stage !== "creative_active")
        || (progress.pendingStep && progress.pendingStep !== "finalize_campaign")) {
        throw new Error("Le checkpoint de finalisation LinkedIn est incohérent.");
      }
      const { token } = await readPublicationAccount(userId, draft);
      const campaign = linkedInAdsCampaignReference(progress.campaignUrn)!;
      const [campaignPayload, creativePayload] = await Promise.all([
        linkedInRead(token, `/rest/adAccounts/${draft.adAccountId}/adCampaigns/${campaign.id}`, fetchImpl, sleep),
        linkedInRead(token, `/rest/adAccounts/${draft.adAccountId}/creatives/${encodeURIComponent(progress.creativeUrn!)}`, fetchImpl, sleep),
      ]);
      const remoteStatus = text(campaignPayload.status);
      const stillDraft = !finalCheckpoint && remoteStatus === "DRAFT";
      if (!campaignEvidence(
        campaignPayload, campaign.urn, draft.adAccountId,
        `urn:li:sponsoredCampaignGroup:${draft.linkedinCampaignGroupId}`,
        String(draft.linkedinOrganizationUrn || ""),
        stillDraft ? "DRAFT" : targetStatus,
        draft.channelSettings?.channel === "linkedin" ? draft.channelSettings.objectiveType : "WEBSITE_VISIT",
        draft.channelSettings?.channel === "linkedin" ? draft.channelSettings.format : "STANDARD_UPDATE",
      ) || linkedInAdsCreativeUrn(creativePayload.id) !== progress.creativeUrn
        || text(creativePayload.campaign) !== campaign.urn
        || text(record(creativePayload.content).reference) !== progress.postUrn
        || text(creativePayload.intendedStatus) !== "ACTIVE") {
        throw new Error("LinkedIn n’a pas confirmé les ressources et le statut attendus pour cette reprise. Contrôlez Campaign Manager.");
      }
      if (!stillDraft) {
        await persist({ ...progress, stage: targetStatus === "ACTIVE" ? "active" : "paused", pendingStep: undefined });
        return progress;
      }
      // The final PATCH was not applied: keep the durable hierarchy and run the
      // normal live checks before retrying only the requested final status.
    }

    // Phase 1: all local and live account/targeting evidence is checked before
    // the first provider mutation. The local image is downloaded and decoded
    // before the LinkedIn upload resource is initialized.
    assertLocalPublicationChoices(draft, now());
    const isVideo = draft.channelSettings?.channel === "linkedin" && draft.channelSettings.format === "SINGLE_VIDEO";
    const imageSource = isVideo ? await readCampaignVideo(userId, draft) : await readCampaignImage(userId, draft);
    let evidence = await collectPublicationEvidence(userId, draft, targetStatus, fetchImpl, sleep, now);
    // Never regress a durable provider checkpoint during recovery. In
    // particular, an interrupted upload must retain `image_initialized` so we
    // inspect the existing image URN rather than initializing a duplicate.
    if (!hasProviderResource(progress)) {
      await persist({ ...progress, stage: "preflight_complete", pendingStep: undefined });
    }

    let imageUrn: string | null = isVideo ? linkedInAdsVideoUrn(progress.videoUrn) : linkedInAdsImageUrn(progress.imageUrn);
    if (isVideo) {
      try {
        const uploaded = await uploadLinkedInAdsVideo({ operationKey: options.operationKey, ownerUrn: evidence.organization.urn, source: imageSource as LinkedInAdsVideoSource, checkpoint: progress.videoCheckpoint }, {
          read: (path) => linkedInRead(evidence.token, path, fetchImpl, sleep),
          write: async (path, body) => { mutationStarted = true; options.onProviderMutationStart?.(); return (await createRequest(evidence.token, `${LINKEDIN_REST_ORIGIN}${path}`, body, fetchImpl, 200)).payload; },
          fetchImpl, now, sleep,
          persist: async (checkpoint) => {
            const videoUrn = linkedInAdsVideoUrn(checkpoint.videoUrn) || undefined;
            await persist({ ...progress, videoCheckpoint: checkpoint, ...(videoUrn ? { videoUrn } : {}), stage: progress.campaignUrn ? progress.stage : checkpoint.phase === "available" ? "video_available" : videoUrn ? "video_initialized" : "preflight_complete", pendingStep: undefined });
          },
        });
        imageUrn = uploaded.videoUrn;
      } catch (error) {
        if (error instanceof LinkedInVideoUploadError && error.checkpoint) {
          const videoUrn = linkedInAdsVideoUrn(error.checkpoint.videoUrn) || undefined;
          progress = { ...progress, videoCheckpoint: error.checkpoint, ...(videoUrn ? { videoUrn } : {}), stage: progress.campaignUrn ? progress.stage : videoUrn ? "video_initialized" : "preflight_complete" };
          await persistProgress(progress).catch(() => undefined);
        }
        throw error;
      }
    } else {
    let uploadUrl = "";
    if (!imageUrn) {
      await beginCreate("initialize_image");
      try {
        const initialized = await createRequest(
          evidence.token,
          `${LINKEDIN_REST_ORIGIN}/rest/images?action=initializeUpload`,
          { initializeUploadRequest: { owner: evidence.organization.urn } },
          fetchImpl,
          200,
        );
        progress = withLinkedInRequestId(progress, "initialize_image", initialized.response);
        const value = record(initialized.payload.value);
        imageUrn = linkedInAdsImageUrn(value.image);
        uploadUrl = text(value.uploadUrl);
        const expiresAt = Number(value.uploadUrlExpiresAt);
        if (!imageUrn || !isSafeLinkedInImageUploadUrl(uploadUrl)
          || !Number.isSafeInteger(expiresAt) || expiresAt <= now() + 30_000) {
          throw new ProviderMutationFailure("LinkedIn a renvoyé des instructions d’upload invalides.", true);
        }
        await persist({ ...progress, imageUrn, stage: "image_initialized", pendingStep: undefined });
      } catch (error) {
        if (error instanceof ProviderMutationFailure) await failCreate("initialize_image", error);
        throw error;
      }
    }

    if (progress.stage === "image_initialized" || progress.pendingStep === "upload_image") {
      if (!uploadUrl) {
        const existing = await linkedInRead(evidence.token, buildLinkedInAdsImagePath(imageUrn), fetchImpl, sleep);
        const image = normalizeLinkedInAdsImage(existing, imageUrn);
        if (image?.status !== "AVAILABLE") {
          throw new Error("L’upload LinkedIn a été interrompu et son URL éphémère n’est jamais conservée. Vérifiez ou supprimez l’image dans Campaign Manager avant de reprendre.");
        }
      } else {
        await persist({ ...progress, pendingStep: "upload_image" });
        let uploadResponse: Response;
        try {
          uploadResponse = await fetchImpl(uploadUrl, {
            method: "PUT",
            headers: { Authorization: `Bearer ${evidence.token}`, "Content-Type": imageSource.contentType },
            body: imageSource.bytes as unknown as BodyInit,
            redirect: "error",
            cache: "no-store",
            signal: AbortSignal.timeout(60_000),
          });
        } catch {
          throw new Error("LinkedIn n’a pas confirmé l’upload de l’image. Son URN est conservé pour vérification, sans réinitialisation automatique.");
        }
        progress = withLinkedInRequestId(progress, "upload_image", uploadResponse);
        await uploadResponse.text().catch(() => "");
        if (uploadResponse.status !== 201) throw new Error(`LinkedIn a refusé l’upload de l’image (${uploadResponse.status}).`);
      }
      const availableImage = await waitForImage(evidence.token, imageUrn, fetchImpl, sleep);
      if (availableImage.owner !== evidence.organization.urn) throw new Error("L’image LinkedIn n’appartient pas à la Page sélectionnée.");
      await persist({ ...progress, imageUrn, stage: "image_available", pendingStep: undefined });
    }

    }
    if (!imageUrn) throw new Error("LinkedIn n’a pas confirmé l’identifiant du média.");

    // Phase 2: re-read every mutable permission/resource plus the newly
    // uploaded image. Campaign creation is impossible if any evidence changed.
    evidence = await collectPublicationEvidence(userId, draft, targetStatus, fetchImpl, sleep, now, imageUrn);
    const mediaEvidence = isVideo ? evidence.video : evidence.image;
    if (!mediaEvidence || mediaEvidence.status !== "AVAILABLE") throw new Error("Le média LinkedIn n’est pas disponible.");
    const linkedInDraft = providerDraft(draft, evidence, imageUrn);
    const choices: LinkedInAdsDraftCampaignChoices = {
      bidAmount: Number(draft.linkedinDeliverySettings?.bidding.amountEuros ?? draft.linkedinBidEuros ?? 0).toFixed(2),
      deliverySettings: draft.linkedinDeliverySettings,
      ...publicationSchedule(draft, evidence.campaignGroup, now()),
      politicalIntentConfirmed: draft.linkedinPoliticalIntentConfirmed === true,
      discriminationNoticeAcknowledged: draft.linkedinTargetingNoticeAcknowledged === true,
    };
    const campaignPreparation = prepareLinkedInAdsDraftCampaign(linkedInDraft, {
      fetchedAtMs: evidence.checkedAtMs,
      selectedAccountId: evidence.account.id,
      scopes: evidence.scopes,
      account: evidence.account,
      campaignGroup: evidence.campaignGroup,
      organization: evidence.organization,
      image: evidence.image || { urn: "", owner: "", status: "" },
      ...(evidence.video ? { video: evidence.video } : {}),
      geoUrns: evidence.geoUrns,
      verifiedProfessionalTargets: evidence.verifiedProfessionalTargets,
      verifiedConversionUrns: evidence.verifiedConversionUrns,
      supportedLocales: evidence.supportedLocales,
    }, choices, now());
    if (!campaignPreparation.readyForDraftCreate || !campaignPreparation.request) {
      throw new Error(`La campagne LinkedIn DRAFT n’est pas sérialisable : ${campaignPreparation.issues.map((item) => item.code).join(", ")}.`);
    }

    let campaignReference = progress.campaignUrn ? linkedInAdsCampaignReference(progress.campaignUrn) : null;
    if (!campaignReference) {
      await beginCreate("create_campaign");
      try {
        const created = await createRequest(
          evidence.token,
          `${LINKEDIN_REST_ORIGIN}${campaignPreparation.request.path}`,
          campaignPreparation.request.body,
          fetchImpl,
          201,
        );
        progress = withLinkedInRequestId(progress, "create_campaign", created.response);
        campaignReference = linkedInAdsCampaignReference(created.response.headers.get("x-restli-id"))
          || linkedInAdsCampaignReference(created.payload.id);
        if (!campaignReference) throw new ProviderMutationFailure("LinkedIn n’a pas renvoyé l’identifiant de campagne.", true);
        await persist({
          ...progress,
          campaignId: campaignReference.id,
          campaignUrn: campaignReference.urn,
          stage: "campaign_created",
          pendingStep: undefined,
        });
      } catch (error) {
        if (error instanceof ProviderMutationFailure) await failCreate("create_campaign", error);
        throw error;
      }
    }
    const campaignPayload = await linkedInRead(
      evidence.token,
      `/rest/adAccounts/${draft.adAccountId}/adCampaigns/${campaignReference.id}`,
      fetchImpl,
      sleep,
    );
    const verifiedCampaign = campaignEvidence(
      campaignPayload,
      campaignReference.urn,
      draft.adAccountId,
      evidence.campaignGroup.urn,
      evidence.organization.urn,
      "DRAFT", linkedInDraft.objectiveType, linkedInDraft.format,
    );
    if (!verifiedCampaign) throw new Error("La campagne LinkedIn DRAFT créée ne peut pas être vérifiée.");
    const serializationEvidence: LinkedInAdsCampaignEvidence = {
      fetchedAtMs: now(),
      selectedAccountId: evidence.account.id,
      scopes: evidence.scopes,
      account: evidence.account,
      campaignGroup: evidence.campaignGroup,
      organization: evidence.organization,
      image: evidence.image || { urn: "", owner: "", status: "" },
      ...(evidence.video ? { video: evidence.video } : {}),
      campaign: verifiedCampaign,
      geoUrns: evidence.geoUrns,
      verifiedProfessionalTargets: evidence.verifiedProfessionalTargets,
      verifiedConversionUrns: evidence.verifiedConversionUrns,
      supportedLocales: evidence.supportedLocales,
    };

    let postUrn = linkedInAdsPostUrn(progress.postUrn);
    if (!postUrn) {
      const postPreparation = prepareLinkedInAdsDarkPost(linkedInDraft, serializationEvidence, now(), draft.linkedinDeliverySettings);
      if (!postPreparation.readyForDraftCreate || !postPreparation.request) {
        throw new Error(`La publication sponsorisée LinkedIn est invalide : ${postPreparation.issues.map((item) => item.code).join(", ")}.`);
      }
      await beginCreate("create_dark_post");
      try {
        const created = await createRequest(
          evidence.token,
          `${LINKEDIN_REST_ORIGIN}${postPreparation.request.path}`,
          postPreparation.request.body,
          fetchImpl,
          201,
        );
        progress = withLinkedInRequestId(progress, "create_dark_post", created.response);
        postUrn = linkedInAdsPostUrn(created.response.headers.get("x-restli-id")) || linkedInAdsPostUrn(created.payload.id);
        if (!postUrn) throw new ProviderMutationFailure("LinkedIn n’a pas renvoyé l’URN du dark post.", true);
        await persist({ ...progress, postUrn, stage: "dark_post_created", pendingStep: undefined });
      } catch (error) {
        if (error instanceof ProviderMutationFailure) await failCreate("create_dark_post", error);
        throw error;
      }
    }

    let creativeUrn = linkedInAdsCreativeUrn(progress.creativeUrn);
    if (!creativeUrn) {
      const creativePreparation = prepareLinkedInAdsDraftCreative(
        linkedInDraft,
        serializationEvidence,
        campaignReference.urn,
        postUrn,
        now(),
      );
      if (!creativePreparation.readyForDraftCreate || !creativePreparation.request) {
        throw new Error(`La création LinkedIn DRAFT est invalide : ${creativePreparation.issues.map((item) => item.code).join(", ")}.`);
      }
      await beginCreate("create_creative");
      try {
        const created = await createRequest(
          evidence.token,
          `${LINKEDIN_REST_ORIGIN}${creativePreparation.request.path}`,
          creativePreparation.request.body,
          fetchImpl,
          201,
        );
        progress = withLinkedInRequestId(progress, "create_creative", created.response);
        creativeUrn = linkedInAdsCreativeUrn(created.response.headers.get("x-restli-id")) || linkedInAdsCreativeUrn(created.payload.id);
        if (!creativeUrn) throw new ProviderMutationFailure("LinkedIn n’a pas renvoyé l’URN de la création.", true);
        await persist({ ...progress, creativeUrn, stage: "creative_created", pendingStep: undefined });
      } catch (error) {
        if (error instanceof ProviderMutationFailure) await failCreate("create_creative", error);
        throw error;
      }
    }

    // Association uses an idempotent PUT on the exact campaign/conversion key.
    // Re-read before replay and confirm the association before delivery can start.
    for (const conversionUrn of evidence.verifiedConversionUrns) {
      const path = `/rest/campaignConversions/(campaign:${encodeURIComponent(campaignReference.urn)},conversion:${encodeURIComponent(conversionUrn)})`;
      let existing: Record<string, unknown> | null = null;
      try { existing = await linkedInRead(evidence.token, path, fetchImpl, sleep); } catch (error) {
        if (!(error instanceof LinkedInAdsConnectionError) || error.status !== 404) throw error;
      }
      if (!existing) {
        mutationStarted = true; options.onProviderMutationStart?.();
        const response = await fetchImpl(`${LINKEDIN_REST_ORIGIN}${path}`, { method: "PUT", headers: providerHeaders(evidence.token, true), body: JSON.stringify({ campaign: campaignReference.urn, conversion: conversionUrn }), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) });
        await response.text().catch(() => "");
        if (response.status !== 204) throw new Error("LinkedIn n’a pas confirmé l’association de conversion. La campagne reste en brouillon.");
        existing = await linkedInRead(evidence.token, path, fetchImpl, sleep);
      }
      if (existing.campaign !== campaignReference.urn || existing.conversion !== conversionUrn) throw new Error("L’association de conversion LinkedIn ne correspond pas à cette campagne.");
    }

    const finalization = buildLinkedInAdsFinalizationSteps(draft.adAccountId, campaignReference.urn, creativeUrn, targetStatus);
    if (progress.stage !== "creative_active" && progress.stage !== "active" && progress.stage !== "paused") {
      await persist({ ...progress, pendingStep: "activate_creative" });
      const response = await partialUpdate(evidence.token, finalization[0].path, finalization[0].headers, finalization[0].body, fetchImpl);
      progress = withLinkedInRequestId(progress, "activate_creative", response);
      const creativePayload = await linkedInRead(
        evidence.token,
        `/rest/adAccounts/${draft.adAccountId}/creatives/${encodeURIComponent(creativeUrn)}`,
        fetchImpl,
        sleep,
      );
      if (text(creativePayload.intendedStatus) !== "ACTIVE"
        || (creativePayload.id !== undefined && linkedInAdsCreativeUrn(creativePayload.id) !== creativeUrn)) {
        throw new Error("LinkedIn n’a pas confirmé l’activation de la création publicitaire.");
      }
      await persist({ ...progress, stage: "creative_active", pendingStep: undefined });
    }
    if (progress.stage !== "active" && progress.stage !== "paused") {
      // Account/group/ownership evidence is refreshed again immediately before
      // the only switch capable of starting delivery.
      evidence = await collectPublicationEvidence(userId, draft, targetStatus, fetchImpl, sleep, now, imageUrn);
      await persist({ ...progress, pendingStep: "finalize_campaign" });
      const response = await partialUpdate(evidence.token, finalization[1].path, finalization[1].headers, finalization[1].body, fetchImpl);
      progress = withLinkedInRequestId(progress, "finalize_campaign", response);
      let confirmed = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) await sleep(500 * (2 ** attempt));
        const finalCampaign = record(await linkedInRead(
          evidence.token,
          `/rest/adAccounts/${draft.adAccountId}/adCampaigns/${campaignReference.id}`,
          fetchImpl,
          sleep,
        ));
        if (text(finalCampaign.status) === targetStatus
          && linkedInAdsCampaignReference(finalCampaign.id)?.urn === campaignReference.urn
          && text(finalCampaign.account) === `urn:li:sponsoredAccount:${draft.adAccountId}`) {
          confirmed = true;
          break;
        }
      }
      if (!confirmed) throw new Error("LinkedIn n’a pas confirmé le statut final de la campagne.");
      await persist({ ...progress, stage: targetStatus === "ACTIVE" ? "active" : "paused", pendingStep: undefined });
    }
    return progress;
  } catch (error) {
    if (error instanceof LinkedInAdsPublishError) throw error;
    const uncertain = Boolean(progress.uncertainStep);
    throw new LinkedInAdsPublishError(
      error instanceof Error ? error.message : "LinkedIn Ads a refusé la campagne.",
      progress,
      mutationStarted,
      !uncertain && !hasProviderResource(progress),
    );
  }
}
