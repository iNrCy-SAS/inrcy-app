import "server-only";

import { canonicalSiteWebChannel } from "@/lib/siteWebChannel";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { type BoosterCtaMode } from "@/lib/boosterCta";
import { normalizeCtaPhone, normalizeCtaWebsiteUrl } from "@/lib/boosterCtaPreferences";
import { type JsonRecord, type BoosterChannel, type BoosterPost, type NormalizedScheduleSelection } from "@/lib/inrAgentScheduleTypes";

export const ACTION_SELECT =
  "id, automation_key, action_type, target_tool, title, summary, preview_text, target_channels, target_themes, recipients, image_assets, payload, validation_required, execution_policy, status, scheduled_for, prepared_at, validated_at, refused_at, completed_at, last_error, created_at, updated_at";

export const SCHEDULED_ACTION_SELECT =
  "id, automation_key, action_type, target_tool, source, title, summary, scheduled_at, timezone, channels, payload, status, attempt_count, last_error, executed_at, created_at, updated_at";

export const EDITORIAL_VALIDATION_EXPIRED_MESSAGE =
  "Validation non reçue avant l’échéance programmée.";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const schedulableStatuses = new Set([
  "prepared",
  "pending_validation",
  "pending",
  "draft",
  "validated",
  "failed",
]);

const agentToBoosterChannel: Record<string, BoosterChannel> = {
  site_web: "site_web",
  siteWeb: "site_web",
  inr_search: "inr_search",
  inrSearch: "inr_search",
  gmb: "gmb",
  google_business: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  threads: "threads",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube_shorts",
  youtube_shorts: "youtube_shorts",
  pinterest: "pinterest",
  x: "x",
  twitter: "x",
};

export function canPublishWithoutMedia(channel: BoosterChannel) {
  return ["site_web", "inr_search", "gmb", "facebook", "threads", "linkedin", "x"].includes(
    channel,
  );
}

export function isVideoOnlyChannel(channel: BoosterChannel) {
  return channel === "youtube_shorts";
}

export function isImageRequiredChannel(channel: BoosterChannel) {
  return channel === "instagram" || channel === "tiktok" || channel === "pinterest";
}

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

export function cleanText(value: unknown, maxLength = 5000) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

export function sanitizeFutureDate(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() + 30_000)
    return null;
  return date.toISOString();
}

export function sanitizeAutomaticScheduledDate(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return null;
  const minimumDispatchAt = Date.now() + 45_000;
  return new Date(Math.max(date.getTime(), minimumDispatchAt)).toISOString();
}

export function normalizeScheduleSelections(input: unknown): NormalizedScheduleSelection[] {
  if (!Array.isArray(input)) return [];
  const byKey = new Map<string, NormalizedScheduleSelection>();
  for (const item of input) {
    const record = asRecord(item);
    if (!record) continue;
    const channel = normalizeBoosterChannels([record.channel])[0];
    const scheduledAt = sanitizeFutureDate(record.scheduledAt ?? record.scheduled_at);
    if (!channel || !scheduledAt) continue;
    byKey.set(`${channel}:${scheduledAt}`, { channel, scheduledAt });
  }
  return Array.from(byKey.values()).slice(0, 12);
}

export function filterRecordByChannels(
  input: unknown,
  channels: BoosterChannel[],
): Record<string, unknown> {
  const record = asRecord(input);
  if (!record) return {};
  return Object.fromEntries(
    channels
      .filter((channel) => Object.prototype.hasOwnProperty.call(record, channel))
      .map((channel) => [channel, record[channel]]),
  );
}

export function publicationPayloadForChannels(
  payload: JsonRecord,
  channels: BoosterChannel[],
): JsonRecord {
  const publishPayload = asRecord(payload.publishPayload) || {};
  const filteredVideoByChannel = filterRecordByChannels(
    publishPayload.videoByChannel,
    channels,
  );
  const channelSpecificVideo =
    channels.length === 1
      ? asRecord(filteredVideoByChannel[channels[0]])
      : null;
  const nextPublishPayload: JsonRecord = {
    ...publishPayload,
    channels,
    postByChannel: filterRecordByChannels(publishPayload.postByChannel, channels),
    mediaModeByChannel: filterRecordByChannels(
      publishPayload.mediaModeByChannel,
      channels,
    ),
    videoSettingsByChannel: filterRecordByChannels(
      publishPayload.videoSettingsByChannel,
      channels,
    ),
    videoFormatByChannel: filterRecordByChannels(
      publishPayload.videoFormatByChannel,
      channels,
    ),
    videoAdaptationModeByChannel: filterRecordByChannels(
      publishPayload.videoAdaptationModeByChannel,
      channels,
    ),
    imageSettingsByChannel: filterRecordByChannels(
      publishPayload.imageSettingsByChannel,
      channels,
    ),
    imagesByChannel: filterRecordByChannels(
      publishPayload.imagesByChannel,
      channels,
    ),
    videoByChannel: filteredVideoByChannel,
    ...(channelSpecificVideo && Object.keys(channelSpecificVideo).length
      ? { video: channelSpecificVideo }
      : {}),
  };
  if (!channels.includes("instagram")) {
    delete nextPublishPayload.instagramPublicationSettings;
    delete nextPublishPayload.instagramPublicationPlacement;
  }
  if (!channels.includes("facebook")) {
    delete nextPublishPayload.facebookPublicationSettings;
    delete nextPublishPayload.facebookPublicationPlacement;
  }
  if (!channels.includes("threads")) delete nextPublishPayload.threadsPublicationSettings;
  if (!channels.includes("tiktok")) {
    delete nextPublishPayload.tiktokPublicationSettings;
  }
  return {
    ...payload,
    scheduleGrouping: {
      mode: "multichannel_single_action",
      channelCount: channels.length,
      createdFrom: "agent_action_schedule",
    },
    publishPayload: nextPublishPayload,
  };
}

export function isMissingTableError(
  error: { code?: string; message?: string } | null | undefined,
) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" ||
    message.includes("inr_agent_scheduled_actions")
  );
}

export function isMissingEditorialConfirmationRpc(
  error: { code?: string; message?: string } | null | undefined,
) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    message.includes("inrcy_confirm_editorial_publication_schedule")
  );
}

function cleanHashtags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) =>
      String(tag || "")
        .trim()
        .replace(/^#+/, "")
        .replace(/[^\p{L}\p{N}_]/gu, "")
        .slice(0, 40),
    )
    .filter(Boolean)
    .slice(0, 20);
}

export function normalizePost(raw: unknown, fallback?: BoosterPost): BoosterPost {
  const record = asRecord(raw) || {};
  const title = cleanText(record.title ?? fallback?.title ?? "", 140);
  const content = cleanText(
    record.content ?? record.text ?? record.caption ?? fallback?.content ?? "",
    6000,
  );
  const cta = cleanText(record.cta ?? fallback?.cta ?? "", 220);
  const hashtags = cleanHashtags(record.hashtags).length
    ? cleanHashtags(record.hashtags)
    : fallback?.hashtags || [];
  const rawCtaMode = cleanText(record.ctaMode ?? record.cta_mode ?? fallback?.ctaMode ?? "", 24);
  const ctaMode = ["none", "website", "call", "message", "custom"].includes(rawCtaMode)
    ? (rawCtaMode as BoosterCtaMode)
    : undefined;
  const ctaUrl = normalizeCtaWebsiteUrl(record.ctaUrl ?? record.cta_url ?? fallback?.ctaUrl);
  const ctaPhone = normalizeCtaPhone(record.ctaPhone ?? record.cta_phone ?? fallback?.ctaPhone);
  return {
    title,
    content,
    cta,
    hashtags,
    ...(ctaMode ? { ctaMode } : {}),
    ...(ctaUrl ? { ctaUrl } : {}),
    ...(ctaPhone ? { ctaPhone } : {}),
  };
}

export function ensurePublishablePost(
  post: BoosterPost,
  fallbackText: string,
): BoosterPost {
  const fallback =
    cleanText(fallbackText, 1000) || "Publication préparée par iNr’Agent.";
  return {
    title: post.title,
    content: post.content || post.title || fallback,
    cta: post.cta,
    hashtags: post.hashtags,
    ...(post.ctaMode ? { ctaMode: post.ctaMode } : {}),
    ...(post.ctaUrl ? { ctaUrl: post.ctaUrl } : {}),
    ...(post.ctaPhone ? { ctaPhone: post.ctaPhone } : {}),
  };
}

export function normalizeBoosterChannels(input: unknown): BoosterChannel[] {
  const raw = Array.isArray(input) ? input : [];
  return Array.from(
    new Set(
      raw
        .map((channel) => {
          const value = canonicalSiteWebChannel(channel);
          return agentToBoosterChannel[value] || value;
        })
        .filter((channel): channel is BoosterChannel =>
          Boolean(
            agentToBoosterChannel[channel] ||
            [
              "site_web",
              "inr_search",
              "gmb",
              "facebook",
              "instagram",
              "threads",
              "linkedin",
              "tiktok",
              "youtube_shorts",
              "pinterest",
              "x",
            ].includes(channel),
          ),
        ),
    ),
  );
}

export function getFirstPost(
  postByChannel: Record<string, BoosterPost>,
  channels: BoosterChannel[],
) {
  return (
    channels
      .map((channel) => postByChannel[channel])
      .find((post) => post?.title || post?.content) ||
    Object.values(postByChannel).find(
      (post) => post?.title || post?.content,
    ) || { title: "", content: "", cta: "", hashtags: [] }
  );
}

export function normalizeCampaignRecipients(input: unknown) {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const recipients: Array<{
    contact_id: string | null;
    display_name: string | null;
    email: string;
  }> = [];

  for (const item of raw) {
    const record = asRecord(item);
    const email = cleanText(record?.email || item, 260).toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email) || seen.has(email))
      continue;
    seen.add(email);
    recipients.push({
      contact_id:
        cleanText(record?.contact_id || record?.contactId || "", 140) || null,
      display_name:
        cleanText(
          record?.display_name || record?.displayName || record?.name || "",
          220,
        ) || null,
      email,
    });
  }
  return recipients;
}

export function normalizeCampaignAttachments(input: unknown) {
  const raw = Array.isArray(input) ? input : [];
  return raw
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;
      const bucket = cleanText(record.bucket, 120);
      const path = cleanText(
        record.path || record.storagePath || record.storage_path,
        500,
      );
      if (!bucket || !path) return null;
      const size = Number(
        record.size ??
          record.bytes ??
          record.sizeBytes ??
          record.size_bytes ??
          0,
      );
      return {
        bucket,
        path,
        name:
          cleanText(record.name || record.filename || record.fileName, 240) ||
          path.split("/").pop() ||
          "piece-jointe",
        type:
          cleanText(record.type || record.mimeType || record.mime_type, 140) ||
          "application/octet-stream",
        size: Number.isFinite(size) && size > 0 ? size : null,
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

export function isCampaignAgentAction(action: ReturnType<typeof rowToInrAgentAction>) {
  return (
    (action.automationKey === "grow" || action.automationKey === "loyalty") &&
    (action.targetTool === "propulser" ||
      action.targetTool === "fideliser" ||
      action.targetTool === "mails") &&
    (action.actionType === "campaign" ||
      action.actionType === "loyalty" ||
      action.actionType === "mailing")
  );
}

export function isManualEditorialPublicationAction(
  action: ReturnType<typeof rowToInrAgentAction>,
) {
  return (
    action.automationKey === "publish" &&
    action.actionType === "publication" &&
    action.targetTool === "booster" &&
    action.executionPolicy === "manual_validation" &&
    action.validationRequired === true &&
    asRecord(action.payload?.editorialPlan) !== null
  );
}
