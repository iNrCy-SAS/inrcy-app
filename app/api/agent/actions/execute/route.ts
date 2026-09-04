import { NextResponse } from "next/server";
import { POST as publishNowBooster } from "@/app/api/booster/publish-now/route";
import { buildVideoSettingsByChannel } from "@/lib/boosterVideoSettings";
import { prepareBoosterImagesByChannelOnServer } from "@/lib/boosterImageServerPreparation";
import { POST as createCrmCampaign } from "@/app/api/crm/campaigns/route";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { buildAbsoluteStorageContentUrl } from "@/lib/storageContentUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { captureApiException } from "@/lib/observability/sentry";
import { withApi } from "@/lib/observability/withApi";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import {
  getDashboardEditionForAuthUser,
  premiumRequiredApiResponse,
} from "@/lib/dashboardEditionServer";
import { isStandardAgentActionDescriptor } from "@/lib/standardAgentPolicy";
import type { BoosterCtaMode } from "@/lib/boosterCta";
import {
  applySafePreferredCta,
  normalizeCtaPhone,
  normalizeCtaWebsiteUrl,
} from "@/lib/boosterCtaPreferences";
import { loadBoosterCtaDefaults } from "@/lib/boosterCtaDefaultsServer";

export const maxDuration = 180;
export const runtime = "nodejs";

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
  ctaMode?: BoosterCtaMode;
  ctaUrl?: string;
  ctaPhone?: string;
};

const ACTION_SELECT =
  "id, automation_key, action_type, target_tool, title, summary, preview_text, target_channels, target_themes, recipients, image_assets, payload, validation_required, execution_policy, status, scheduled_for, prepared_at, validated_at, refused_at, completed_at, last_error, created_at, updated_at";

const executableStatuses = new Set([
  "prepared",
  "pending_validation",
  "pending",
  "draft",
  "validated",
  "failed",
]);

const allowedBoosterChannels = new Set<BoosterChannel>([
  "inrcy_site",
  "site_web",
  "inr_search",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
]);

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

const agentToBoosterChannel: Record<string, BoosterChannel> = {
  site_inrcy: "inrcy_site",
  siteInrcy: "inrcy_site",
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
  const rawCtaMode = cleanText(
    record.ctaMode ?? record.cta_mode ?? fallback?.ctaMode ?? "",
    24,
  );
  const ctaMode = ["none", "website", "call", "message", "custom"].includes(
    rawCtaMode,
  )
    ? (rawCtaMode as BoosterCtaMode)
    : undefined;
  const ctaUrl = normalizeCtaWebsiteUrl(
    record.ctaUrl ?? record.cta_url ?? fallback?.ctaUrl,
  );
  const ctaPhone = normalizeCtaPhone(
    record.ctaPhone ?? record.cta_phone ?? fallback?.ctaPhone,
  );

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

function ensurePublishablePost(
  post: BoosterPost,
  fallbackText: string,
): BoosterPost {
  const fallback =
    cleanText(fallbackText, 1000) || "Publication préparée par iNr’Agent.";
  return {
    ...post,
    title: post.title,
    content: post.content || post.title || fallback,
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
          allowedBoosterChannels.has(channel as BoosterChannel),
        ),
    ),
  );
}

function getFirstPost(
  postByChannel: Record<string, BoosterPost>,
  channels: BoosterChannel[],
) {
  const preferred: BoosterChannel[] = [
    "facebook",
    "instagram",
    "gmb",
    "linkedin",
    "inrcy_site",
    "site_web",
    "inr_search",
    "tiktok",
    "youtube_shorts",
  ];
  const ordered = [...preferred, ...channels];
  return (
    ordered
      .map((channel) => postByChannel[channel])
      .find((post) => post?.title || post?.content) || {
      title: "Publication iNr’Agent",
      content: "",
      cta: "",
      hashtags: [],
    }
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
) {
  const media = getAgentMediaRecord(payload);
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
  const videoSettingsByChannel = asRecord(media.videoSettingsByChannel) || null;

  return {
    name:
      cleanText(media.name || media.title || "video-iNrAgent.mp4", 180) ||
      "video-iNrAgent.mp4",
    type:
      cleanText(media.mimeType || media.mime_type || media.type, 120) ||
      mimeFromPath(storagePath) ||
      "video/mp4",
    size: Number(media.size || media.sizeBytes || media.size_bytes || 0) || 0,
    duration: Number(media.duration || media.duration_seconds || 0) || null,
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
    transformedVariants,
    videoSettingsByChannel,
  };
}

async function updateActionRow(
  actionId: string,
  userId: string,
  patch: Record<string, unknown>,
) {
  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("user_id", userId)
    .select(ACTION_SELECT)
    .single();

  if (error) throw error;
  return rowToInrAgentAction(data as any);
}

function getPublishError(payload: JsonRecord | null, fallback: string) {
  return cleanText(
    payload?.error ||
      asRecord(payload?.summary)?.error ||
      payload?.message ||
      fallback,
    600,
  );
}

type CampaignRecipient = {
  contact_id?: string | null;
  display_name?: string | null;
  email: string;
};

function normalizeCampaignRecipients(input: unknown): CampaignRecipient[] {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const recipients: CampaignRecipient[] = [];

  for (const item of raw) {
    const record = asRecord(item);
    const email = cleanText(record?.email || item, 260).toLowerCase();
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email) ||
      seen.has(email)
    ) {
      continue;
    }
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

async function executeCampaignAction(args: {
  action: ReturnType<typeof rowToInrAgentAction>;
  actionId: string;
  userId: string;
}) {
  const { action, actionId, userId } = args;
  const payload = action.payload || {};
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

  if (!accountId) {
    return NextResponse.json(
      { error: "Boîte d’envoi manquante pour cette campagne." },
      { status: 400 },
    );
  }
  if (!subject || !text) {
    return NextResponse.json(
      { error: "La campagne préparée est incomplète." },
      { status: 400 },
    );
  }
  if (!recipients.length) {
    return NextResponse.json(
      { error: "Aucun destinataire CRM valide pour cette campagne." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  await updateActionRow(actionId, userId, {
    status: "executing",
    validated_at: action.validatedAt || now,
    refused_at: null,
    last_error: null,
  });

  const campaignIdempotencyKey = `inr_agent_action:${actionId}:campaign_now`;
  const campaignBody = {
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
    idempotencyKey: campaignIdempotencyKey,
    metadata: {
      source: "inr_agent",
      label: "iNr'Agent",
      agentActionId: actionId,
      automationKey: action.automationKey,
      targetTool: action.targetTool,
      actionType: action.actionType,
      theme: trackType || null,
      signatureAutomatic: payload.signatureAutomatic !== false,
      idempotencyKey: campaignIdempotencyKey,
    },
  };

  try {
    const response = await createCrmCampaign(
      new Request("http://inrcy.local/api/crm/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignBody),
      }),
    );
    const campaignPayload = (await response
      .json()
      .catch(() => null)) as JsonRecord | null;

    if (!response.ok || campaignPayload?.success === false) {
      const errorMessage = cleanText(
        campaignPayload?.error || "La campagne mail n’a pas pu être exécutée.",
        700,
      );
      const duplicateBlocked =
        String(campaignPayload?.code || "") === "scheduled_campaign_duplicate";
      const failedAction = await updateActionRow(actionId, userId, {
        status: duplicateBlocked ? "pending_validation" : "failed",
        validated_at: duplicateBlocked ? null : action.validatedAt || now,
        last_error: errorMessage,
        payload: {
          ...payload,
          execution: {
            ok: false,
            blockedByDuplicate: duplicateBlocked,
            executedAt: new Date().toISOString(),
            campaignBody,
            campaignResult: campaignPayload,
          },
        },
      });

      return NextResponse.json(
        {
          action: failedAction,
          campaignResult: campaignPayload,
          error: errorMessage,
          code: campaignPayload?.code || null,
        },
        { status: response.ok ? 400 : response.status },
      );
    }

    const completedAt = new Date().toISOString();
    const completedAction = await updateActionRow(actionId, userId, {
      status: "completed",
      completed_at: completedAt,
      validated_at: action.validatedAt || now,
      refused_at: null,
      last_error: null,
      payload: {
        ...payload,
        execution: {
          ok: true,
          executedAt: completedAt,
          campaignId: campaignPayload?.campaignId || null,
          campaignStatus: campaignPayload?.campaignStatus || null,
          queued: campaignPayload?.queued || recipients.length,
          campaignResult: campaignPayload,
        },
      },
    });

    if (action.automationKey) {
      await supabaseAdmin
        .from("inr_agent_automation_settings")
        .update({ last_executed_at: completedAt, updated_at: completedAt })
        .eq("user_id", userId)
        .eq("automation_key", action.automationKey);
    }

    return NextResponse.json({
      action: completedAction,
      campaignResult: campaignPayload,
      executed: true,
    });
  } catch (error) {
    const message = getSimpleFrenchErrorMessage(error, "Exécution de campagne iNr’Agent impossible.");
    const failedAction = await updateActionRow(actionId, userId, {
      status: "failed",
      last_error: message,
      payload: {
        ...payload,
        execution: {
          ok: false,
          executedAt: new Date().toISOString(),
          error: message,
          campaignBody,
        },
      },
    });

    return NextResponse.json(
      { action: failedAction, error: message },
      { status: 500 },
    );
  }
}

async function executeAgentActionHandler(request: Request) {
  const { supabase, errorResponse, authUserId, activeUserId } =
    await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";

  const userId = activeUserId;
  const rl = await enforceRateLimit({
    name: "inr_agent_execute_action",
    identifier: userId,
    limit: 10,
    window: "1 m",
  });
  if (rl) return rl;

  const body = (await request.json().catch(() => null)) as {
    actionId?: unknown;
    channels?: unknown;
    preserveActionStatus?: unknown;
  } | null;
  const actionId = cleanText(body?.actionId, 120);
  const requestedChannels = normalizeBoosterChannels(body?.channels);
  const hasChannelOverride = requestedChannels.length > 0;
  const preserveActionStatus = body?.preserveActionStatus === true;
  if (!actionId) {
    return NextResponse.json(
      { error: "Action iNr’Agent introuvable." },
      { status: 400 },
    );
  }

  const { data: actionRow, error: readError } = await supabaseAdmin
    .from("inr_agent_actions")
    .select(ACTION_SELECT)
    .eq("id", actionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json(
      {
        error: "Lecture de l’action iNr’Agent impossible.",
      },
      { status: 500 },
    );
  }

  if (!actionRow) {
    return NextResponse.json(
      { error: "Action iNr’Agent introuvable." },
      { status: 404 },
    );
  }

  const action = rowToInrAgentAction(actionRow as any);
  if (standardMode && !isStandardAgentActionDescriptor(action)) {
    return premiumRequiredApiResponse();
  }
  if (action.status === "completed") {
    return NextResponse.json({ action, alreadyCompleted: true });
  }

  if (action.status === "executing") {
    return NextResponse.json(
      { error: "Cette action est déjà en cours d’exécution." },
      { status: 409 },
    );
  }

  if (
    !executableStatuses.has(action.status) &&
    !(hasChannelOverride && action.status === "scheduled")
  ) {
    return NextResponse.json(
      { error: "Cette action ne peut pas être exécutée dans son état actuel." },
      { status: 400 },
    );
  }

  if (isCampaignAgentAction(action)) {
    return executeCampaignAction({ action, actionId, userId });
  }

  if (
    action.automationKey !== "publish" ||
    action.targetTool !== "booster" ||
    action.actionType !== "publication"
  ) {
    return NextResponse.json(
      { error: "L’exécution de cette action n’est pas encore branchée." },
      { status: 400 },
    );
  }

  const payload = action.payload || {};
  const selectedChannels = hasChannelOverride
    ? requestedChannels
    : normalizeBoosterChannels(
        payload.selectedChannels || payload.channels || action.targetChannels,
      );
  const imagePayload = await buildImagePayloadFromAgentAction(
    payload,
    actionId,
  );
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
  const publishChannelSet = new Set<BoosterChannel>(publishChannels);

  if (!publishChannels.length) {
    return NextResponse.json(
      {
        error:
          "Aucun canal prêt à publier. Les canaux sélectionnés nécessitent un média ou une vidéo.",
      },
      { status: 400 },
    );
  }

  const rawPostByChannel = asRecord(payload.postByChannel) || {};
  const ctaDefaults = await loadBoosterCtaDefaults({ supabase, userId });
  const fallbackText = cleanText(
    action.summary || payload.idea || action.title,
    1000,
  );
  const normalizedPostByChannel = Object.fromEntries(
    publishChannels.map((channel) => [
      channel,
      applySafePreferredCta({
        channel,
        post: ensurePublishablePost(
          normalizePost(rawPostByChannel[channel]),
          fallbackText,
        ),
        defaults: ctaDefaults,
      }),
    ]),
  ) as Record<string, BoosterPost>;
  const firstPost = ensurePublishablePost(
    getFirstPost(normalizedPostByChannel, publishChannels),
    fallbackText,
  );

  const now = new Date().toISOString();
  await updateActionRow(actionId, userId, {
    status: "executing",
    validated_at: action.validatedAt || now,
    refused_at: null,
    last_error: null,
  });

  try {
    const mediaModeByChannel = Object.fromEntries(
      publishChannels.map((channel) => [channel, activeMediaMode]),
    );
    const videoSettingsByChannel =
      activeMediaMode === "video"
        ? buildVideoSettingsByChannel({
            channels: publishChannels as any,
            videoSettingsByChannel:
              (videoPayload as any)?.videoSettingsByChannel ||
              payload.videoSettingsByChannel,
            sourceMetadata: (videoPayload as any)?.sourceMetadata || null,
          })
        : {};
    const preparedImages =
      activeMediaMode === "images" && imagePayload
        ? await prepareBoosterImagesByChannelOnServer({
            channels: publishChannels,
            images: [imagePayload],
            automaticFit: "contain",
          })
        : { imagesByChannel: {}, imageSettingsByChannel: {}, warnings: [] };

    const publishBody = {
      channels: publishChannels,
      post: firstPost,
      postByChannel: normalizedPostByChannel,
      idea: cleanText(payload.idea || action.summary, 500),
      mediaType: activeMediaMode === "video" ? "video" : "images",
      mediaModeByChannel,
      videoSettingsByChannel,
      images: imagePayload ? [imagePayload] : [],
      imagesByChannel: preparedImages.imagesByChannel,
      imageSettingsByChannel: preparedImages.imageSettingsByChannel,
      imagePreparationWarnings: preparedImages.warnings,
      video: videoPayload,
      workflowTool: "booster",
      workflowAction: "publier",
      source: "inr_agent",
      inrAgentActionId: actionId,
      idempotencyKey: hasChannelOverride
        ? `inr_agent_action:${actionId}:publish_now:${publishChannels.join(",")}`
        : `inr_agent_action:${actionId}:publish_now`,
      origin: {
        source: "inr_agent",
        label: "iNr’Agent validé",
        agentActionId: actionId,
        workflowTool: "booster",
        workflowAction: "publier",
        runMode: "manual_validation",
      },
    };

    const publishResponse = await publishNowBooster(
      new Request("http://inrcy.local/api/booster/publish-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publishBody),
      }),
    );
    const publishPayload = (await publishResponse
      .json()
      .catch(() => null)) as JsonRecord | null;

    if (!publishResponse.ok || publishPayload?.ok === false) {
      const errorMessage = getPublishError(
        publishPayload,
        "La publication Booster n’a pas pu être exécutée.",
      );
      const duplicateBlocked =
        String(publishPayload?.code || "") ===
        "scheduled_publication_duplicate";
      const failedAction = await updateActionRow(actionId, userId, {
        status: duplicateBlocked ? "pending_validation" : "failed",
        validated_at: duplicateBlocked ? null : action.validatedAt || now,
        last_error: errorMessage,
        payload: {
          ...payload,
          execution: {
            ok: false,
            blockedByDuplicate: duplicateBlocked,
            executedAt: new Date().toISOString(),
            skippedChannels: selectedChannels.filter(
              (channel) => !publishChannelSet.has(channel),
            ),
            publicationId: publishPayload?.publication_id || null,
            historyEventId: publishPayload?.historyEventId || null,
            historyPersisted: publishPayload?.historyPersisted === true,
            summary: publishPayload?.summary || null,
            results: publishPayload?.results || null,
            publishResult: publishPayload,
          },
        },
      });

      return NextResponse.json(
        {
          action: failedAction,
          publishResult: publishPayload,
          error: errorMessage,
          code: publishPayload?.code || null,
        },
        { status: publishResponse.ok ? 400 : publishResponse.status },
      );
    }

    const completedAt = new Date().toISOString();
    const completedPatch: Record<string, unknown> = {
      status: preserveActionStatus ? action.status : "completed",
      validated_at: action.validatedAt || now,
      refused_at: null,
      last_error: null,
      payload: {
        ...payload,
        [preserveActionStatus ? "partialImmediateExecution" : "execution"]: {
          ok: true,
          executedAt: completedAt,
          channels: publishChannels,
          skippedChannels: selectedChannels.filter(
            (channel) => !publishChannelSet.has(channel),
          ),
          publicationId: publishPayload?.publication_id || null,
          historyEventId: publishPayload?.historyEventId || null,
          historyPersisted: publishPayload?.historyPersisted === true,
          summary: publishPayload?.summary || null,
          results: publishPayload?.results || null,
        },
      },
    };
    if (!preserveActionStatus) {
      completedPatch.completed_at = completedAt;
    }
    const completedAction = await updateActionRow(
      actionId,
      userId,
      completedPatch,
    );

    await supabaseAdmin
      .from("inr_agent_automation_settings")
      .update({ last_executed_at: completedAt, updated_at: completedAt })
      .eq("user_id", userId)
      .eq("automation_key", "publish");

    return NextResponse.json({
      action: completedAction,
      publishResult: publishPayload,
      executed: true,
    });
  } catch (error) {
    captureApiException(request, error, {
      area: "inragent",
      operation: "POST /api/agent/actions/execute",
      statusCode: 500,
    });
    const message = getSimpleFrenchErrorMessage(error, "Exécution iNr’Agent impossible.");
    const failedAction = await updateActionRow(actionId, userId, {
      status: preserveActionStatus ? action.status : "failed",
      last_error: message,
      payload: {
        ...payload,
        execution: {
          ok: false,
          executedAt: new Date().toISOString(),
          error: message,
        },
      },
    });

    return NextResponse.json(
      { action: failedAction, error: message },
      { status: 500 },
    );
  }
}

export const POST = withApi(executeAgentActionHandler, { route: "/api/agent/actions/execute" });
