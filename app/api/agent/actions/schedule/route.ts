import { NextResponse } from "next/server";
import { buildVideoSettingsByChannel } from "@/lib/boosterVideoSettings";
import { prepareBoosterImagesByChannelOnServer } from "@/lib/boosterImageServerPreparation";
import { resolveInrAgentActionRequest } from "@/lib/inrAgentRequest";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { buildAbsoluteStorageContentUrl } from "@/lib/storageContentUrl";
import {
  rowToInrAgentScheduledAction,
  scheduledActionToDbRow,
} from "@/lib/inrAgentScheduledActions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { findSimilarScheduledPublication } from "@/lib/scheduledPublicationDedupe";
import { findSimilarScheduledCampaign } from "@/lib/scheduledCampaignDedupe";
import { captureApiException } from "@/lib/observability/sentry";
import { withApi } from "@/lib/observability/withApi";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import {
  getDashboardEditionForAccountId,
  premiumRequiredApiResponse,
} from "@/lib/dashboardEditionServer";
import { isStandardAgentActionDescriptor } from "@/lib/standardAgentPolicy";

export const runtime = "nodejs";
export const maxDuration = 90;

type JsonRecord = Record<string, unknown>;
type BoosterChannel =
  | "inrcy_site"
  | "site_web"
  | "inr_search"
  | "gmb"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest";

type BoosterPost = {
  title: string;
  content: string;
  cta: string;
  hashtags: string[];
};

const ACTION_SELECT =
  "id, automation_key, action_type, target_tool, title, summary, preview_text, target_channels, target_themes, recipients, image_assets, payload, validation_required, execution_policy, status, scheduled_for, prepared_at, validated_at, refused_at, completed_at, last_error, created_at, updated_at";

const SCHEDULED_ACTION_SELECT =
  "id, automation_key, action_type, target_tool, source, title, summary, scheduled_at, timezone, channels, payload, status, attempt_count, last_error, executed_at, created_at, updated_at";

const schedulableStatuses = new Set([
  "prepared",
  "pending_validation",
  "pending",
  "draft",
  "validated",
  "failed",
]);

const agentToBoosterChannel: Record<string, BoosterChannel> = {
  site_inrcy: "inrcy_site",
  siteInrcy: "inrcy_site",
  inrcy_site: "inrcy_site",
  site_web: "site_web",
  siteWeb: "site_web",
  inr_search: "inr_search",
  inrSearch: "inr_search",
  gmb: "gmb",
  google_business: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube_shorts",
  youtube_shorts: "youtube_shorts",
  pinterest: "pinterest",
};

function canPublishWithoutMedia(channel: BoosterChannel) {
  return ["inrcy_site", "site_web", "inr_search", "gmb", "facebook", "linkedin"].includes(
    channel,
  );
}

function isVideoOnlyChannel(channel: BoosterChannel) {
  return channel === "youtube_shorts";
}

function isImageRequiredChannel(channel: BoosterChannel) {
  return channel === "instagram" || channel === "tiktok" || channel === "pinterest";
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function cleanText(value: unknown, maxLength = 5000) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function sanitizeFutureDate(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() + 30_000)
    return null;
  return date.toISOString();
}

function sanitizeAutomaticScheduledDate(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return null;
  const minimumDispatchAt = Date.now() + 45_000;
  return new Date(Math.max(date.getTime(), minimumDispatchAt)).toISOString();
}

type NormalizedScheduleSelection = {
  channel: BoosterChannel;
  scheduledAt: string;
};

function normalizeScheduleSelections(input: unknown): NormalizedScheduleSelection[] {
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

function filterRecordByChannels(
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

function publicationPayloadForChannels(
  payload: JsonRecord,
  channels: BoosterChannel[],
): JsonRecord {
  const publishPayload = asRecord(payload.publishPayload) || {};
  return {
    ...payload,
    scheduleGrouping: {
      mode: "multichannel_single_action",
      channelCount: channels.length,
      createdFrom: "agent_action_schedule",
    },
    publishPayload: {
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
    },
  };
}

function isMissingTableError(
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

function normalizePost(raw: unknown, fallback?: BoosterPost): BoosterPost {
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
  return { title, content, cta, hashtags };
}

function ensurePublishablePost(
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
  };
}

function normalizeBoosterChannels(input: unknown): BoosterChannel[] {
  const raw = Array.isArray(input) ? input : [];
  return Array.from(
    new Set(
      raw
        .map((channel) => {
          const value = String(channel || "").trim();
          return agentToBoosterChannel[value] || value;
        })
        .filter((channel): channel is BoosterChannel =>
          Boolean(
            agentToBoosterChannel[channel] ||
            [
              "inrcy_site",
              "site_web",
              "inr_search",
              "gmb",
              "facebook",
              "instagram",
              "linkedin",
              "tiktok",
              "youtube_shorts",
            ].includes(channel),
          ),
        ),
    ),
  );
}

function getFirstPost(
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

function mimeFromPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return "image/jpeg";
}

function isVideoMedia(record: JsonRecord | null) {
  const hint = cleanText(
    record?.kind ||
      record?.mediaType ||
      record?.media_type ||
      record?.mimeType ||
      record?.mime_type ||
      record?.type ||
      record?.url ||
      record?.storagePath ||
      record?.storage_path ||
      record?.path,
    500,
  ).toLowerCase();
  return hint.includes("video") || /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(hint);
}

function readMediaFromChannelPosts(payload: JsonRecord) {
  const postByChannel = asRecord(payload.postByChannel);
  if (!postByChannel) return null;
  for (const rawPost of Object.values(postByChannel)) {
    const post = asRecord(rawPost);
    if (!post) continue;
    for (const key of [
      "media",
      "mediaAsset",
      "video",
      "videoAsset",
      "image",
      "imageAsset",
    ] as const) {
      const media = asRecord(post[key]);
      if (media) return media;
    }
  }
  return null;
}

function getAgentMediaRecord(payload: JsonRecord) {
  return (
    asRecord(payload.mediaAsset) ||
    asRecord(payload.media) ||
    asRecord(payload.videoAsset) ||
    asRecord(payload.video) ||
    asRecord(payload.imageAsset) ||
    asRecord(payload.image) ||
    readMediaFromChannelPosts(payload)
  );
}

async function buildImagePayloadFromAgentAction(
  payload: JsonRecord,
  actionId: string,
  mediaOverride?: JsonRecord,
) {
  const media = mediaOverride || getAgentMediaRecord(payload);
  if (!media || isVideoMedia(media)) return null;

  const bucket =
    cleanText(media.bucket || "inrcy-image-bank", 120) || "inrcy-image-bank";
  const storagePath = cleanText(
    media.storagePath || media.storage_path || media.path || "",
    800,
  );
  const title = cleanText(media.title || media.name || "image-iNrAgent", 120);

  if (storagePath) {
    const download = await supabaseAdmin.storage
      .from(bucket)
      .download(storagePath);
    if (download.error || !download.data) {
      throw new Error(
        download.error?.message || "Impossible de préparer l’image iNr’Agent.",
      );
    }

    const buffer = Buffer.from(await download.data.arrayBuffer());
    const mime =
      download.data.type ||
      cleanText(media.mimeType || media.mime_type || media.type, 120) ||
      mimeFromPath(storagePath);
    const extension =
      mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    return {
      name: `${title || "image-iNrAgent"}.${extension}`,
      type: mime,
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
      originalName: title || `image-iNrAgent-${actionId}`,
      originalType: mime,
      imageKey: cleanText(media.id || actionId, 120),
      imageMeta: {
        source: cleanText(media.source, 120) || "inr_agent",
        bucket,
        storagePath,
        title,
      },
    };
  }

  const publicUrl = cleanText(
    media.url || media.publicUrl || media.src || "",
    2000,
  );
  if (!publicUrl) return null;
  return {
    name: `${title || "image-iNrAgent"}.jpg`,
    type:
      cleanText(media.mimeType || media.mime_type || media.type, 120) ||
      "image/jpeg",
    publicUrl,
    originalPublicUrl: publicUrl,
    originalName: title || `image-iNrAgent-${actionId}`,
    originalType:
      cleanText(media.mimeType || media.mime_type || media.type, 120) ||
      "image/jpeg",
    imageKey: cleanText(media.id || actionId, 120),
    imageMeta: { source: cleanText(media.source, 120) || "inr_agent", title },
  };
}

async function buildImagePayloadsFromAgentAction(
  payload: JsonRecord,
  actionId: string,
  actionImageAssets: unknown[],
) {
  const candidates = [
    ...(Array.isArray(payload.images) ? payload.images : []),
    ...(Array.isArray(payload.mediaAssets) ? payload.mediaAssets : []),
    ...(Array.isArray(actionImageAssets) ? actionImageAssets : []),
    getAgentMediaRecord(payload),
  ]
    .map((item) => asRecord(item))
    .filter((item): item is JsonRecord => Boolean(item) && !isVideoMedia(item));
  const seen = new Set<string>();
  const unique = candidates.filter((media) => {
    const key = cleanText(
      media.id ||
        media.storagePath ||
        media.storage_path ||
        media.path ||
        media.url ||
        media.publicUrl,
      2_000,
    );
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const images: Array<
    NonNullable<
      Awaited<ReturnType<typeof buildImagePayloadFromAgentAction>>
    >
  > = [];
  for (const media of unique.slice(0, 4)) {
    const image = await buildImagePayloadFromAgentAction(
      payload,
      actionId,
      media,
    );
    if (image) images.push(image);
  }
  return images;
}

async function buildVideoPayloadFromAgentAction(payload: JsonRecord) {
  const media = getAgentMediaRecord(payload);
  if (!media || !isVideoMedia(media)) return null;
  const storagePath = cleanText(
    media.storagePath || media.storage_path || media.path || "",
    900,
  );
  const bucket =
    cleanText(
      media.bucket || media.bucketName || media.bucket_name || "booster",
      120,
    ) || "booster";
  const publicUrl = storagePath
    ? bucket === "booster"
      ? String(
          supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath)?.data
            ?.publicUrl || "",
        ).trim()
      : buildAbsoluteStorageContentUrl(bucket, storagePath) || ""
    : cleanText(media.url || media.publicUrl || media.src || "", 2000);
  if (!publicUrl && !storagePath) return null;

  const transformedVariants = Array.isArray(media.transformedVariants)
    ? media.transformedVariants.filter(Boolean).slice(0, 12)
    : [];
  const videoSettings = asRecord(media.videoSettings) || null;
  const videoSettingsByChannel =
    asRecord(media.videoSettingsByChannel) ||
    asRecord(payload.videoSettingsByChannel) ||
    null;
  const width = Number(media.width || media.videoWidth || 0) || null;
  const height = Number(media.height || media.videoHeight || 0) || null;
  const duration = Number(media.duration || media.duration_seconds || 0) || null;
  const sourceMetadata = {
    ...(width ? { width: Math.round(width) } : {}),
    ...(height ? { height: Math.round(height) } : {}),
    ...(duration ? { duration } : {}),
  };

  return {
    name:
      cleanText(media.name || media.title || "video-iNrAgent.mp4", 180) ||
      "video-iNrAgent.mp4",
    type:
      cleanText(media.mimeType || media.mime_type || media.type, 120) ||
      mimeFromPath(storagePath) ||
      "video/mp4",
    size: Number(media.size || media.sizeBytes || media.size_bytes || 0) || 0,
    duration,
    storagePath,
    bucket,
    publicUrl,
    url: publicUrl,
    thumbnailUrl:
      cleanText(media.thumbnailUrl || media.thumbnail_url, 1200) || null,
    thumbnailStoragePath:
      cleanText(
        media.thumbnailStoragePath || media.thumbnail_storage_path,
        900,
      ) || null,
    ...(Object.keys(sourceMetadata).length ? { sourceMetadata } : {}),
    ...(videoSettings ? { videoSettings } : {}),
    ...(videoSettingsByChannel ? { videoSettingsByChannel } : {}),
    videoFormat: cleanText(media.videoFormat, 40) || null,
    videoAdaptationMode: cleanText(media.videoAdaptationMode, 40) || null,
    transformedVariants,
  };
}

function normalizeCampaignRecipients(input: unknown) {
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

function normalizeCampaignAttachments(input: unknown) {
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

function isCampaignAgentAction(action: ReturnType<typeof rowToInrAgentAction>) {
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

async function buildScheduledPayload(
  action: ReturnType<typeof rowToInrAgentAction>,
) {
  const payload = action.payload || {};

  if (isCampaignAgentAction(action)) {
    const accountId = cleanText(
      payload.accountId || payload.mailAccountId || "",
      140,
    );
    const subject = cleanText(payload.campaignSubject || payload.subject, 220);
    const text = cleanText(
      payload.campaignBody || payload.bodyText || payload.text,
      6000,
    );
    const html = cleanText(payload.bodyHtml || payload.html, 9000);
    const recipients = normalizeCampaignRecipients(
      payload.recipients || action.recipients,
    );
    const folder =
      cleanText(payload.folder, 80) ||
      (action.automationKey === "loyalty" ? "fidelisations" : "propulsions");
    const trackKind =
      cleanText(payload.trackKind, 80) ||
      (action.automationKey === "loyalty" ? "fideliser" : "propulser");
    const trackType = cleanText(payload.trackType, 80);
    const templateKey = cleanText(payload.templateKey, 180);
    const attachments = normalizeCampaignAttachments(payload.attachments);

    if (!accountId)
      throw new Error("Boîte d’envoi manquante pour cette campagne.");
    if (!subject || !text)
      throw new Error("La campagne préparée est incomplète.");
    if (!recipients.length)
      throw new Error("Aucun destinataire valide pour cette campagne.");

    return {
      actionType: "campaign" as const,
      targetTool:
        action.targetTool === "fideliser"
          ? ("fideliser" as const)
          : action.targetTool === "mails"
            ? ("mails" as const)
            : ("propulser" as const),
      channels: ["mails"],
      payload: {
        kind: "mail_campaign",
        sourceActionId: action.id,
        campaign: {
          accountId,
          type: "mail",
          subject,
          text,
          html,
          recipients,
          folder,
          trackKind,
          trackType,
          templateKey,
          attachments,
          metadata: {
            source: "inr_agent",
            label: "iNr'Agent",
            agentActionId: action.id,
            automationKey: action.automationKey,
            targetTool: action.targetTool,
            actionType: action.actionType,
            theme: trackType || null,
            signatureAutomatic: payload.signatureAutomatic !== false,
            scheduledFromValidation: true,
          },
        },
      },
    };
  }

  if (
    action.automationKey === "publish" &&
    action.targetTool === "booster" &&
    action.actionType === "publication"
  ) {
    const selectedChannels = normalizeBoosterChannels(
      payload.selectedChannels || payload.channels || action.targetChannels,
    );
    const imagePayloads = await buildImagePayloadsFromAgentAction(
      payload,
      action.id,
      action.imageAssets,
    );
    const imagePayload = imagePayloads[0] || null;
    const videoPayload = await buildVideoPayloadFromAgentAction(payload);
    const hasImagePayload = Boolean(imagePayload);
    const hasVideoPayload = Boolean(videoPayload);
    const activeMediaMode = hasVideoPayload
      ? "video"
      : hasImagePayload
        ? "images"
        : "none";
    const publishChannels = selectedChannels.filter((channel) => {
      if (activeMediaMode === "video") return true;
      if (isVideoOnlyChannel(channel)) return false;
      if (isImageRequiredChannel(channel)) return hasImagePayload;
      return canPublishWithoutMedia(channel) || hasImagePayload;
    });
    if (!publishChannels.length)
      throw new Error(
        "Aucun canal prêt à programmer. Les canaux sélectionnés nécessitent un média ou une vidéo.",
      );

    const rawPostByChannel = asRecord(payload.postByChannel) || {};
    const fallbackText = cleanText(
      action.summary || payload.idea || action.title,
      1000,
    );
    const normalizedPostByChannel = Object.fromEntries(
      publishChannels.map((channel) => [
        channel,
        ensurePublishablePost(
          normalizePost(rawPostByChannel[channel]),
          fallbackText,
        ),
      ]),
    ) as Record<string, BoosterPost>;
    const firstPost = ensurePublishablePost(
      getFirstPost(normalizedPostByChannel, publishChannels),
      fallbackText,
    );

    const mediaModeByChannel = Object.fromEntries(
      publishChannels.map((channel) => [channel, activeMediaMode]),
    );
    const videoSettingsSource =
      (videoPayload as any)?.videoSettingsByChannel ||
      payload.videoSettingsByChannel ||
      ((videoPayload as any)?.videoSettings
        ? Object.fromEntries(
            publishChannels.map((channel) => [
              channel,
              (videoPayload as any).videoSettings,
            ]),
          )
        : null);
    const videoSettingsByChannel =
      activeMediaMode === "video"
        ? buildVideoSettingsByChannel({
            channels: publishChannels as any,
            videoSettingsByChannel: videoSettingsSource,
            sourceMetadata: (videoPayload as any)?.sourceMetadata || null,
          })
        : {};
    const preparedImages =
      activeMediaMode === "images" && imagePayloads.length
          ? await prepareBoosterImagesByChannelOnServer({
            channels: publishChannels,
            images: imagePayloads,
            automaticFit: "contain",
          })
        : { imagesByChannel: {}, imageSettingsByChannel: {}, warnings: [] };

    return {
      actionType: "publication" as const,
      targetTool: "booster" as const,
      channels: publishChannels,
      payload: {
        kind: "manual_publish_schedule",
        sourceActionId: action.id,
        publishPayload: {
          channels: publishChannels,
          post: firstPost,
          postByChannel: normalizedPostByChannel,
          idea: cleanText(payload.idea || action.summary, 500),
          mediaType: activeMediaMode === "video" ? "video" : "images",
          mediaModeByChannel,
          videoSettingsByChannel,
          images: imagePayloads,
          imagesByChannel: preparedImages.imagesByChannel,
          imageSettingsByChannel: preparedImages.imageSettingsByChannel,
          imagePreparationWarnings: preparedImages.warnings,
          video: videoPayload,
          workflowTool: "booster",
          workflowAction: "publier",
          source: "inr_agent",
          inrAgentActionId: action.id,
        },
      },
    };
  }

  throw new Error("Cette action iNr’Agent ne peut pas être programmée.");
}

async function scheduleAgentActionHandler(request: Request) {
  const context = await resolveInrAgentActionRequest(request);
  if (context.errorResponse) return context.errorResponse;
  const { userId: activeUserId, isCron, body } = context;
  const standardMode =
    (await getDashboardEditionForAccountId(activeUserId)) === "standard";
  const automaticExecution = body?.executionSource === "automatic";
  if (automaticExecution && !isCron) {
    return NextResponse.json(
      { error: "La publication automatique est réservée au moteur iNr’Agent." },
      { status: 403 },
    );
  }
  if (automaticExecution) {
    return NextResponse.json(
      {
        error:
          "Cette publication attend la validation du professionnel avant toute programmation.",
        code: "INR_AGENT_MANUAL_VALIDATION_REQUIRED",
      },
      { status: 409 },
    );
  }

  const actionId = cleanText(body?.actionId, 120);
  let scheduledAt = automaticExecution
    ? sanitizeAutomaticScheduledDate(body?.scheduledAt)
    : sanitizeFutureDate(body?.scheduledAt);
  const scheduleSelections = normalizeScheduleSelections(body?.scheduleSelections);
  if (!actionId)
    return NextResponse.json(
      { error: "Action iNr’Agent introuvable." },
      { status: 400 },
    );
  if (!automaticExecution && !scheduledAt && !scheduleSelections.length)
    return NextResponse.json(
      { error: "Choisissez une date et une heure dans le futur." },
      { status: 400 },
    );

  const { data: actionRow, error: readError } = await supabaseAdmin
    .from("inr_agent_actions")
    .select(ACTION_SELECT)
    .eq("id", actionId)
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json(
      {
        error: "Lecture de l’action iNr’Agent impossible.",
      },
      { status: 500 },
    );
  }
  if (!actionRow)
    return NextResponse.json(
      { error: "Action iNr’Agent introuvable." },
      { status: 404 },
    );

  let action = rowToInrAgentAction(actionRow as any);
  if (standardMode && !isStandardAgentActionDescriptor(action)) {
    return premiumRequiredApiResponse();
  }
  if (automaticExecution) {
    const isAutomaticEditorialPublication =
      action.automationKey === "publish" &&
      action.actionType === "publication" &&
      action.targetTool === "booster" &&
      action.executionPolicy === "automatic_after_settings" &&
      action.validationRequired === false &&
      asRecord(action.payload?.editorialPlan) !== null;

    if (!isAutomaticEditorialPublication) {
      return NextResponse.json(
        { error: "Cette action n’est pas autorisée en publication automatique." },
        { status: 400 },
      );
    }

    if (action.status === "scheduled") {
      const { data: existingScheduled } = await supabaseAdmin
        .from("inr_agent_scheduled_actions")
        .select(SCHEDULED_ACTION_SELECT)
        .eq("id", action.id)
        .eq("user_id", activeUserId)
        .maybeSingle();
      if (existingScheduled) {
        const scheduledAction = rowToInrAgentScheduledAction(existingScheduled);
        return NextResponse.json({
          action,
          scheduledActions: [scheduledAction],
          scheduledAction,
          scheduled: true,
          alreadyScheduled: true,
          tableMissing: false,
        });
      }
    }

    if (action.status !== "prepared") {
      return NextResponse.json(
        { error: "Cette publication automatique n’est plus prête à programmer." },
        { status: 409 },
      );
    }
    scheduledAt = sanitizeAutomaticScheduledDate(action.scheduledFor);
  }
  if (!schedulableStatuses.has(action.status)) {
    return NextResponse.json(
      {
        error: "Cette action ne peut pas être programmée dans son état actuel.",
      },
      { status: 400 },
    );
  }

  let automaticClaimed = false;
  const releaseAutomaticClaim = async () => {
    if (!automaticClaimed) return;
    const { data: currentAction } = await supabaseAdmin
      .from("inr_agent_actions")
      .select("status,execution_policy")
      .eq("id", action.id)
      .eq("user_id", activeUserId)
      .maybeSingle();
    const restoredStatus =
      currentAction?.execution_policy === "draft_only"
        ? "draft"
        : currentAction?.execution_policy === "manual_validation"
          ? "pending_validation"
          : "prepared";
    await supabaseAdmin
      .from("inr_agent_actions")
      .update({
        status: restoredStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", action.id)
      .eq("user_id", activeUserId)
      .eq("status", "executing");
    automaticClaimed = false;
  };

  try {
    const scheduledPayload = await buildScheduledPayload(action);
    const timezone = cleanText(body?.timezone, 80) || "Europe/Paris";
    if (scheduledPayload.actionType !== "publication" && !scheduledAt) {
      return NextResponse.json(
        { error: "Choisissez une date et une heure dans le futur." },
        { status: 400 },
      );
    }

    const baseScheduleArgs = {
      userId: activeUserId,
      automationKey: action.automationKey,
      actionType: scheduledPayload.actionType,
      targetTool: scheduledPayload.targetTool,
      source: automaticExecution ? ("automatic" as const) : ("manual" as const),
      title: action.title || "Action iNr’Agent programmée",
      summary:
        action.summary ||
        (automaticExecution
          ? "Action programmée automatiquement par iNr’Agent."
          : "Action validée et programmée depuis iNr’Agent."),
      timezone,
    };

    const rows: ReturnType<typeof scheduledActionToDbRow>[] = [];
    const normalizedScheduleSelections: NormalizedScheduleSelection[] = [];

    if (scheduledPayload.actionType === "publication") {
      const allowedChannels = new Set(scheduledPayload.channels);
      const requestedSelections = scheduleSelections.length
        ? scheduleSelections.filter((selection) => allowedChannels.has(selection.channel))
        : (scheduledAt
            ? scheduledPayload.channels.map((channel) => ({ channel, scheduledAt }))
            : []);

      if (!requestedSelections.length) {
        return NextResponse.json(
          {
            error:
              "Aucun canal prêt à programmer. Vérifiez les canaux sélectionnés et leurs médias.",
          },
          { status: 400 },
        );
      }

      const groupedSelections = Array.from(
        requestedSelections.reduce((groups, selection) => {
          const existing = groups.get(selection.scheduledAt) || [];
          if (!existing.includes(selection.channel)) existing.push(selection.channel);
          groups.set(selection.scheduledAt, existing);
          return groups;
        }, new Map<string, BoosterChannel[]>()),
      );

      for (const [groupScheduledAt, groupChannels] of groupedSelections) {
        normalizedScheduleSelections.push(
          ...groupChannels.map((channel) => ({
            channel,
            scheduledAt: groupScheduledAt,
          })),
        );
        rows.push(
          scheduledActionToDbRow({
            ...baseScheduleArgs,
            ...(automaticExecution ? { id: action.id } : {}),
            scheduledAt: groupScheduledAt,
            title:
              groupChannels.length > 1
                ? `${baseScheduleArgs.title} · multicanal`
                : baseScheduleArgs.title,
            summary:
              groupChannels.length > 1
                ? `${baseScheduleArgs.summary} (${groupChannels.length} canaux).`
                : baseScheduleArgs.summary,
            channels: groupChannels,
            payload: publicationPayloadForChannels(
              scheduledPayload.payload,
              groupChannels,
            ),
          }),
        );
      }
    } else {
      rows.push(
        scheduledActionToDbRow({
          ...baseScheduleArgs,
          scheduledAt: scheduledAt as string,
          channels: scheduledPayload.channels,
          payload: scheduledPayload.payload,
        }),
      );
    }

    for (const row of rows) {
      if (scheduledPayload.actionType === "publication") {
        const duplicate = await findSimilarScheduledPublication({
          supabase: supabaseAdmin,
          userId: activeUserId,
          scheduledAt: row.scheduled_at,
          channels: row.channels || [],
          payload: row.payload || {},
        });

        if (duplicate.duplicate) {
          return NextResponse.json(
            {
              error:
                "Une publication similaire est déjà programmée sur ce créneau. Vérifiez la programmation existante avant d’en créer une nouvelle.",
              duplicate,
            },
            { status: 409 },
          );
        }
      }

      if (scheduledPayload.actionType === "campaign") {
        const duplicate = await findSimilarScheduledCampaign({
          supabase: supabaseAdmin,
          userId: activeUserId,
          scheduledAt: row.scheduled_at,
          payload: row.payload || {},
        });

        if (duplicate.duplicate) {
          return NextResponse.json(
            {
              error:
                "Une campagne similaire est déjà programmée sur ce créneau. Vérifiez la programmation existante avant d’en créer une nouvelle.",
              duplicate,
            },
            { status: 409 },
          );
        }
      }
    }

    if (automaticExecution) {
      const claimNow = new Date().toISOString();
      const { data: claimedRow, error: claimError } = await supabaseAdmin
        .from("inr_agent_actions")
        .update({
          status: "executing",
          last_error: null,
          updated_at: claimNow,
        })
        .eq("id", action.id)
        .eq("user_id", activeUserId)
        .eq("status", "prepared")
        .eq("execution_policy", "automatic_after_settings")
        .eq("validation_required", false)
        .select(ACTION_SELECT)
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimedRow) {
        const { data: existingScheduled } = await supabaseAdmin
          .from("inr_agent_scheduled_actions")
          .select(SCHEDULED_ACTION_SELECT)
          .eq("id", action.id)
          .eq("user_id", activeUserId)
          .maybeSingle();
        if (existingScheduled) {
          const scheduledAction = rowToInrAgentScheduledAction(existingScheduled);
          return NextResponse.json({
            action,
            scheduledActions: [scheduledAction],
            scheduledAction,
            scheduled: true,
            alreadyScheduled: true,
            tableMissing: false,
          });
        }
        return NextResponse.json(
          { error: "La programmation automatique a déjà été prise en charge." },
          { status: 409 },
        );
      }
      action = rowToInrAgentAction(claimedRow as any);
      automaticClaimed = true;
    }

    const scheduledInsert = automaticExecution
      ? supabaseAdmin
          .from("inr_agent_scheduled_actions")
          .upsert(rows, { onConflict: "id" })
      : supabaseAdmin.from("inr_agent_scheduled_actions").insert(rows);
    const { data: scheduledRows, error: insertError } = await scheduledInsert.select(
      SCHEDULED_ACTION_SELECT,
    );

    if (insertError) {
      await releaseAutomaticClaim();
      if (isMissingTableError(insertError)) {
        return NextResponse.json(
          {
            error: "La base de programmation iNr’Agent doit être initialisée.",
            tableMissing: true,
          },
          { status: 500 },
        );
      }
      return NextResponse.json(
        {
          error: "Programmation de l’action impossible.",
        },
        { status: 500 },
      );
    }

    const createdScheduledRows = Array.isArray(scheduledRows)
      ? scheduledRows
      : [];
    if (!createdScheduledRows.length) {
      await releaseAutomaticClaim();
      return NextResponse.json(
        { error: "Aucune action programmée n’a été créée." },
        { status: 500 },
      );
    }
    const now = new Date().toISOString();
    const scheduledFor = [...createdScheduledRows]
      .map((row) => String(row.scheduled_at || ""))
      .filter(Boolean)
      .sort()[0] || scheduledAt || now;
    let actionUpdate = supabaseAdmin
      .from("inr_agent_actions")
      .update({
        status: "scheduled",
        scheduled_for: scheduledFor,
        validated_at: automaticExecution ? null : now,
        refused_at: null,
        last_error: null,
        payload: {
          ...(action.payload || {}),
          scheduledExecution: {
            scheduledActionIds: createdScheduledRows.map((row) => row.id),
            scheduledAt: scheduledFor,
            scheduleSelections:
              scheduledPayload.actionType === "publication"
                ? normalizedScheduleSelections
                : undefined,
            source: automaticExecution ? "automatic" : "manual",
            createdAt: now,
          },
        },
        updated_at: now,
      })
      .eq("id", action.id)
      .eq("user_id", activeUserId);
    if (automaticExecution) {
      actionUpdate = actionUpdate
        .eq("status", "executing")
        .eq("execution_policy", "automatic_after_settings")
        .eq("validation_required", false);
    }
    const { data: updatedActionRow, error: updateError } = await actionUpdate
      .select(ACTION_SELECT)
      .single();

    if (updateError) {
      if (automaticExecution) {
        await supabaseAdmin
          .from("inr_agent_scheduled_actions")
          .update({
            status: "cancelled",
            last_error:
              "Le mode de validation iNr’Agent a changé avant la programmation.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", action.id)
          .eq("user_id", activeUserId)
          .eq("status", "scheduled");
        await releaseAutomaticClaim();
      }
      return NextResponse.json(
        {
          error:
            "Action programmée créée, mais mise à jour iNr’Agent impossible.",
        },
        { status: 500 },
      );
    }

    automaticClaimed = false;

    return NextResponse.json({
      action: rowToInrAgentAction(updatedActionRow as any),
      scheduledActions: createdScheduledRows.map(rowToInrAgentScheduledAction),
      scheduledAction: createdScheduledRows[0]
        ? rowToInrAgentScheduledAction(createdScheduledRows[0])
        : null,
      scheduled: true,
      tableMissing: false,
    });
  } catch (error) {
    await releaseAutomaticClaim();
    captureApiException(request, error, {
      area: "inragent",
      operation: "POST /api/agent/actions/schedule",
      statusCode: 500,
    });
    return NextResponse.json(
      {
        error: getSimpleFrenchErrorMessage(error, "Programmation de l’action impossible."),
      },
      { status: 400 },
    );
  }
}

export const POST = withApi(scheduleAgentActionHandler, { route: "/api/agent/actions/schedule" });
