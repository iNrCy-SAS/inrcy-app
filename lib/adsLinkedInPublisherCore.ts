import type { LinkedInVideoCheckpoint } from "./adsLinkedInVideo.ts";

export const LINKEDIN_ADS_CREATE_STEPS = [
  "initialize_image",
  "create_campaign",
  "create_dark_post",
  "create_creative",
] as const;

export const LINKEDIN_ADS_PUBLISH_STAGES = [
  "preflight_complete",
  "image_initialized",
  "video_initialized",
  "image_available",
  "video_available",
  "campaign_created",
  "dark_post_created",
  "creative_created",
  "creative_active",
  "paused",
  "active",
] as const;

export type LinkedInAdsCreateStep = (typeof LINKEDIN_ADS_CREATE_STEPS)[number];
export type LinkedInAdsPublishStage =
  | "preflight_complete"
  | "image_initialized"
  | "video_initialized"
  | "image_available"
  | "video_available"
  | "campaign_created"
  | "dark_post_created"
  | "creative_created"
  | "creative_active"
  | "paused"
  | "active";

export type LinkedInAdsPublishProgress = Record<string, unknown> & {
  schemaVersion: 1;
  operationKey: string;
  accountId: string;
  targetStatus: "ACTIVE" | "PAUSED";
  stage: LinkedInAdsPublishStage;
  pendingStep?: LinkedInAdsCreateStep | "upload_image" | "activate_creative" | "finalize_campaign";
  uncertainStep?: LinkedInAdsCreateStep;
  imageUrn?: string;
  videoUrn?: string;
  /** Upload capabilities must stay in server-only provider_resources. */
  videoCheckpoint?: LinkedInVideoCheckpoint;
  campaignId?: string;
  campaignUrn?: string;
  postUrn?: string;
  creativeUrn?: string;
  providerRequestIds?: Record<string, string>;
};

const ACCOUNT_ID = /^\d{1,25}$/;
const VIDEO_URN = /^urn:li:video:[A-Za-z0-9_-]{3,200}$/;
const IMAGE_URN = /^urn:li:image:[A-Za-z0-9_-]{3,200}$/;
const CAMPAIGN_URN = /^urn:li:sponsoredCampaign:(\d{1,25})$/;
const POST_URN = /^urn:li:(?:share|ugcPost):\d{1,25}$/;
const CREATIVE_URN = /^urn:li:sponsoredCreative:\d{1,25}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,200}$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function linkedInAdsCampaignReference(value: unknown): { id: string; urn: string } | null {
  const raw = typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : text(value);
  const id = ACCOUNT_ID.test(raw) ? raw : CAMPAIGN_URN.exec(raw)?.[1] || "";
  return id ? { id, urn: `urn:li:sponsoredCampaign:${id}` } : null;
}

export function linkedInAdsPostUrn(value: unknown): string | null {
  const urn = text(value);
  return POST_URN.test(urn) ? urn : null;
}

export function linkedInAdsCreativeUrn(value: unknown): string | null {
  const urn = text(value);
  return CREATIVE_URN.test(urn) ? urn : null;
}

export function linkedInAdsImageUrn(value: unknown): string | null {
  const urn = text(value);
  return IMAGE_URN.test(urn) ? urn : null;
}

/** Upload URLs are bearer-authenticated. Never send the token to another host. */
export function isSafeLinkedInImageUploadUrl(value: unknown): boolean {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === "www.linkedin.com"
      && url.pathname.startsWith("/dms-uploads/")
      && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function safeLinkedInRequestId(value: unknown): string | null {
  const id = text(value);
  return REQUEST_ID.test(id) ? id : null;
}

export function assertLinkedInPublishProgress(
  value: LinkedInAdsPublishProgress,
  operationKey: string,
  accountId: string,
  targetStatus: "ACTIVE" | "PAUSED",
): void {
  if (value.schemaVersion !== 1 || value.operationKey !== operationKey
    || value.accountId !== accountId || value.targetStatus !== targetStatus) {
    throw new TypeError("LinkedIn publication checkpoint does not match this operation");
  }
  if (value.imageUrn && !linkedInAdsImageUrn(value.imageUrn)) throw new TypeError("Invalid LinkedIn image checkpoint");
  if (value.videoUrn && !VIDEO_URN.test(value.videoUrn)) throw new TypeError("Invalid LinkedIn video checkpoint");
  if (value.videoUrn && value.imageUrn) throw new TypeError("LinkedIn checkpoint cannot mix image and video");
  const campaign = value.campaignUrn ? linkedInAdsCampaignReference(value.campaignUrn) : null;
  if ((value.campaignUrn && !campaign) || (value.campaignId && (!campaign || value.campaignId !== campaign.id))) {
    throw new TypeError("Invalid LinkedIn campaign checkpoint");
  }
  if (value.postUrn && !linkedInAdsPostUrn(value.postUrn)) throw new TypeError("Invalid LinkedIn post checkpoint");
  if (value.creativeUrn && !linkedInAdsCreativeUrn(value.creativeUrn)) throw new TypeError("Invalid LinkedIn creative checkpoint");
  if (value.uncertainStep && !LINKEDIN_ADS_CREATE_STEPS.includes(value.uncertainStep)) {
    throw new TypeError("Invalid LinkedIn uncertain checkpoint");
  }
  const pendingSteps = [...LINKEDIN_ADS_CREATE_STEPS, "upload_image", "activate_creative", "finalize_campaign"] as const;
  if (value.pendingStep && !pendingSteps.includes(value.pendingStep)) {
    throw new TypeError("Invalid LinkedIn pending checkpoint");
  }
  const stageIndex = LINKEDIN_ADS_PUBLISH_STAGES.indexOf(value.stage);
  if (stageIndex < 0) throw new TypeError("Invalid LinkedIn publication stage");
  const imageStage = LINKEDIN_ADS_PUBLISH_STAGES.indexOf("image_initialized");
  const campaignStage = LINKEDIN_ADS_PUBLISH_STAGES.indexOf("campaign_created");
  const postStage = LINKEDIN_ADS_PUBLISH_STAGES.indexOf("dark_post_created");
  const creativeStage = LINKEDIN_ADS_PUBLISH_STAGES.indexOf("creative_created");
  if ((stageIndex >= imageStage) !== Boolean(value.imageUrn || value.videoUrn)
    || (stageIndex >= campaignStage) !== Boolean(value.campaignUrn)
    || (stageIndex >= campaignStage) !== Boolean(value.campaignId)
    || (stageIndex >= postStage) !== Boolean(value.postUrn)
    || (stageIndex >= creativeStage) !== Boolean(value.creativeUrn)) {
    throw new TypeError("LinkedIn publication checkpoint hierarchy is inconsistent");
  }
  if ((value.stage === "active" && value.targetStatus !== "ACTIVE")
    || (value.stage === "paused" && value.targetStatus !== "PAUSED")) {
    throw new TypeError("LinkedIn final checkpoint does not match its target status");
  }
}

export function withLinkedInRequestId(
  progress: LinkedInAdsPublishProgress,
  step: string,
  response: Pick<Response, "headers">,
): LinkedInAdsPublishProgress {
  const requestId = safeLinkedInRequestId(response.headers.get("x-li-request-id"))
    || safeLinkedInRequestId(response.headers.get("x-li-uuid"));
  if (!requestId) return progress;
  return {
    ...progress,
    providerRequestIds: { ...(progress.providerRequestIds || {}), [step]: requestId },
  };
}
