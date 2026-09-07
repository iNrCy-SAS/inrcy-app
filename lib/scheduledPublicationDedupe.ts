import { createHash } from "crypto";

const DEFAULT_DUPLICATE_WINDOW_MINUTES = 60;
const DEFAULT_IMMEDIATE_DUPLICATE_LOOKAHEAD_MINUTES = 240;
const DUPLICATE_STATUSES = ["scheduled", "running"];
const BOOSTER_CHANNELS = [
  "inrcy_site",
  "site_web",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
  "x",
] as const;

type JsonRecord = Record<string, unknown>;
type BoosterChannel = (typeof BOOSTER_CHANNELS)[number];

type SupabaseLike = {
  from: (table: string) => any;
};

export type ScheduledPublicationDuplicate = {
  duplicate: boolean;
  reason?: string;
  existingId?: string;
  existingTitle?: string;
  existingScheduledAt?: string | null;
  overlappingChannels?: string[];
  windowMinutes: number;
};

const agentToBoosterChannel: Record<string, BoosterChannel> = {
  site_inrcy: "inrcy_site",
  siteInrcy: "inrcy_site",
  inrcy_site: "inrcy_site",
  site_web: "site_web",
  siteWeb: "site_web",
  gmb: "gmb",
  google_business: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube_shorts",
  youtube_shorts: "youtube_shorts",
  pinterest: "pinterest",
  x: "x",
  twitter: "x",
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function cleanText(value: unknown, maxLength = 5000) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, maxLength);
}

function stableHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 32);
}

function normalizeChannels(input: unknown): BoosterChannel[] {
  const raw = Array.isArray(input) ? input : [];
  return Array.from(
    new Set(
      raw
        .map((value) => agentToBoosterChannel[String(value || "").trim()])
        .filter((value): value is BoosterChannel => Boolean(value)),
    ),
  );
}

function getPublishPayload(payload: unknown): JsonRecord {
  const record = asRecord(payload) || {};
  return asRecord(record.publishPayload) || record;
}

function getPayloadChannels(payload: unknown) {
  const publishPayload = getPublishPayload(payload);
  return normalizeChannels(
    publishPayload.channels ||
      publishPayload.selectedChannels ||
      asRecord(payload)?.channels,
  );
}

function getChannelPost(publishPayload: JsonRecord, channel: BoosterChannel) {
  const postByChannel = asRecord(publishPayload.postByChannel);
  const channelPost = asRecord(postByChannel?.[channel]);
  return channelPost || asRecord(publishPayload.post) || {};
}

type ChannelDeduplicationSignature = {
  content: string;
  media: string;
};

function getChannelContentSignature(payload: unknown, channel: BoosterChannel) {
  const publishPayload = getPublishPayload(payload);
  const post = getChannelPost(publishPayload, channel);
  const title = cleanText(post.title, 180);
  const content = cleanText(
    post.content || post.text || post.caption,
    6000,
  );
  const cta = cleanText(post.cta, 260);
  const hashtags = Array.isArray(post.hashtags)
    ? post.hashtags.map((tag) => cleanText(tag, 60)).filter(Boolean).sort()
    : [];

  const meaningfulText = `${title} ${content} ${cta}`.trim();
  if (meaningfulText.length < 18) return "";

  return stableHash({ title, content, cta, hashtags });
}

function getMediaIdentity(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return cleanText(value, 600);
  const record = asRecord(value);
  if (!record) return "";
  return cleanText(
    record.storagePath ||
      record.storage_path ||
      record.path ||
      record.originalStoragePath ||
      record.original_storage_path ||
      record.videoPath ||
      record.video_path ||
      record.publicUrl ||
      record.public_url ||
      record.renderedUrl ||
      record.rendered_url ||
      record.url ||
      record.originalUrl ||
      record.original_url ||
      record.imageKey ||
      record.image_key ||
      `${record.name || record.filename || ""}:${record.size || record.bytes || ""}:${record.duration || record.video_duration_seconds || ""}`,
    800,
  );
}

function getMediaIdentities(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(getMediaIdentity).filter(Boolean);
  }
  return [getMediaIdentity(value)].filter(Boolean);
}

function getChannelMediaSignature(payload: unknown, channel: BoosterChannel) {
  const publishPayload = getPublishPayload(payload);
  const mediaModeByChannel = asRecord(publishPayload.mediaModeByChannel);
  const mediaMode = cleanText(mediaModeByChannel?.[channel], 40);
  const imagesByChannel = asRecord(publishPayload.imagesByChannel);
  const videoByChannel = asRecord(publishPayload.videoByChannel);
  const mediaKeys = new Set<string>();

  if (channel === "instagram") {
    const settings = asRecord(publishPayload.instagramPublicationSettings);
    const placement = cleanText(settings?.placement || settings?.mode, 20);
    if (["reel", "reels", "story", "stories"].includes(placement)) {
      mediaKeys.add(`instagram-placement:${placement.startsWith("stor") ? "story" : "reel"}`);
    }
  }

  if (channel === "facebook") {
    const settings = asRecord(publishPayload.facebookPublicationSettings);
    const placement = cleanText(settings?.placement || settings?.mode, 20);
    if (["reel", "reels", "story", "stories"].includes(placement)) {
      mediaKeys.add(
        `facebook-placement:${placement.startsWith("stor") ? "story" : "reel"}`,
      );
    }
  }

  if (mediaMode === "video") {
    getMediaIdentities(videoByChannel?.[channel]).forEach((key) => mediaKeys.add(key));
    getMediaIdentities(publishPayload.video).forEach((key) => mediaKeys.add(key));
  } else {
    getMediaIdentities(imagesByChannel?.[channel]).forEach((key) => mediaKeys.add(key));
    getMediaIdentities(publishPayload.images).forEach((key) => mediaKeys.add(key));
    getMediaIdentities(publishPayload.imageAssets).forEach((key) => mediaKeys.add(key));
    getMediaIdentities(publishPayload.imageAsset).forEach((key) => mediaKeys.add(key));
    getMediaIdentities(publishPayload.mediaAsset).forEach((key) => mediaKeys.add(key));
  }

  if (!mediaKeys.size) {
    getMediaIdentities(publishPayload.media).forEach((key) => mediaKeys.add(key));
  }

  const keys = Array.from(mediaKeys).filter(Boolean).sort();
  return keys.length ? stableHash(keys) : "";
}

function buildDeduplicationSignatures(
  payload: unknown,
  channels: BoosterChannel[],
) {
  return Object.fromEntries(
    channels.map((channel) => [
      channel,
      {
        content: getChannelContentSignature(payload, channel),
        media: getChannelMediaSignature(payload, channel),
      },
    ]),
  ) as Partial<Record<BoosterChannel, ChannelDeduplicationSignature>>;
}

function hasAnyDeduplicationSignature(
  signatures: Partial<Record<BoosterChannel, ChannelDeduplicationSignature>>,
) {
  return Object.values(signatures).some(
    (signature) => Boolean(signature?.content || signature?.media),
  );
}

function isSamePublicationSignature(
  current: ChannelDeduplicationSignature | undefined,
  existing: ChannelDeduplicationSignature | undefined,
) {
  if (!current || !existing) return false;
  if (current.content && existing.content && current.content === existing.content) {
    return true;
  }
  return Boolean(current.media && existing.media && current.media === existing.media);
}

function getScheduledWindowIso(scheduledAt: string, minutes: number) {
  const time = new Date(scheduledAt).getTime();
  const delta = Math.max(1, minutes) * 60_000;
  return {
    from: new Date(time - delta).toISOString(),
    to: new Date(time + delta).toISOString(),
  };
}

function isMissingTableError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" ||
    message.includes("inr_agent_scheduled_actions")
  );
}

export async function findSimilarScheduledPublication(args: {
  supabase: SupabaseLike;
  userId: string;
  scheduledAt: string;
  channels: unknown;
  payload: unknown;
  excludeId?: string | null;
  windowMinutes?: number;
}): Promise<ScheduledPublicationDuplicate> {
  const windowMinutes = Math.max(
    5,
    Math.min(
      240,
      Math.round(args.windowMinutes || DEFAULT_DUPLICATE_WINDOW_MINUTES),
    ),
  );
  const channels = normalizeChannels(args.channels).length
    ? normalizeChannels(args.channels)
    : getPayloadChannels(args.payload);

  if (!channels.length) return { duplicate: false, windowMinutes };

  const currentSignatures = buildDeduplicationSignatures(args.payload, channels);
  if (!hasAnyDeduplicationSignature(currentSignatures)) {
    return { duplicate: false, windowMinutes };
  }

  const { from, to } = getScheduledWindowIso(args.scheduledAt, windowMinutes);
  const { data, error } = await args.supabase
    .from("inr_agent_scheduled_actions")
    .select(
      "id,title,scheduled_at,channels,payload,status,automation_key,action_type,target_tool",
    )
    .eq("user_id", args.userId)
    .eq("action_type", "publication")
    .eq("target_tool", "booster")
    .in("status", DUPLICATE_STATUSES)
    .gte("scheduled_at", from)
    .lte("scheduled_at", to)
    .limit(60);

  if (error) {
    if (isMissingTableError(error)) return { duplicate: false, windowMinutes };
    console.warn("[scheduled-publication-dedupe] duplicate lookup failed", error);
    return { duplicate: false, windowMinutes };
  }

  const rows = Array.isArray(data) ? data : [];
  const excludeId = String(args.excludeId || "").trim();
  for (const row of rows) {
    const rowId = String(row?.id || "").trim();
    if (excludeId && rowId === excludeId) continue;

    const existingPayload = asRecord(row?.payload) || {};
    const existingChannels = normalizeChannels(row?.channels).length
      ? normalizeChannels(row?.channels)
      : getPayloadChannels(existingPayload);
    const overlap = channels.filter((channel) => existingChannels.includes(channel));
    if (!overlap.length) continue;

    const existingSignatures = buildDeduplicationSignatures(existingPayload, overlap);
    const duplicateChannels = overlap.filter((channel) =>
      isSamePublicationSignature(
        currentSignatures[channel],
        existingSignatures[channel],
      ),
    );

    if (duplicateChannels.length) {
      return {
        duplicate: true,
        reason: "similar_scheduled_publication_same_content_or_media_same_slot",
        existingId: rowId,
        existingTitle: String(row?.title || "Action programmée"),
        existingScheduledAt: String(row?.scheduled_at || "") || null,
        overlappingChannels: duplicateChannels,
        windowMinutes,
      };
    }
  }

  return { duplicate: false, windowMinutes };
}

export async function findSimilarUpcomingScheduledPublication(args: {
  supabase: SupabaseLike;
  userId: string;
  channels: unknown;
  payload: unknown;
  nowIso?: string;
  lookaheadMinutes?: number;
}): Promise<ScheduledPublicationDuplicate> {
  const windowMinutes = Math.max(
    15,
    Math.min(
      1440,
      Math.round(
        args.lookaheadMinutes || DEFAULT_IMMEDIATE_DUPLICATE_LOOKAHEAD_MINUTES,
      ),
    ),
  );
  const channels = normalizeChannels(args.channels).length
    ? normalizeChannels(args.channels)
    : getPayloadChannels(args.payload);

  if (!channels.length) return { duplicate: false, windowMinutes };

  const currentSignatures = buildDeduplicationSignatures(args.payload, channels);
  if (!hasAnyDeduplicationSignature(currentSignatures)) {
    return { duplicate: false, windowMinutes };
  }

  const now = args.nowIso ? new Date(args.nowIso) : new Date();
  const nowMs = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const from = new Date(nowMs - 2 * 60_000).toISOString();
  const to = new Date(nowMs + windowMinutes * 60_000).toISOString();

  const { data, error } = await args.supabase
    .from("inr_agent_scheduled_actions")
    .select(
      "id,title,scheduled_at,channels,payload,status,automation_key,action_type,target_tool",
    )
    .eq("user_id", args.userId)
    .eq("action_type", "publication")
    .eq("target_tool", "booster")
    .in("status", DUPLICATE_STATUSES)
    .gte("scheduled_at", from)
    .lte("scheduled_at", to)
    .limit(80);

  if (error) {
    if (isMissingTableError(error)) return { duplicate: false, windowMinutes };
    console.warn(
      "[scheduled-publication-dedupe] immediate duplicate lookup failed",
      error,
    );
    return { duplicate: false, windowMinutes };
  }

  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    const existingPayload = asRecord(row?.payload) || {};
    const existingChannels = normalizeChannels(row?.channels).length
      ? normalizeChannels(row?.channels)
      : getPayloadChannels(existingPayload);
    const overlap = channels.filter((channel) =>
      existingChannels.includes(channel),
    );
    if (!overlap.length) continue;

    const existingSignatures = buildDeduplicationSignatures(existingPayload, overlap);
    const duplicateChannels = overlap.filter((channel) =>
      isSamePublicationSignature(
        currentSignatures[channel],
        existingSignatures[channel],
      ),
    );

    if (duplicateChannels.length) {
      return {
        duplicate: true,
        reason: "similar_upcoming_scheduled_publication_same_content_or_media",
        existingId: String(row?.id || "").trim(),
        existingTitle: String(row?.title || "Publication programmée"),
        existingScheduledAt: String(row?.scheduled_at || "") || null,
        overlappingChannels: duplicateChannels,
        windowMinutes,
      };
    }
  }

  return { duplicate: false, windowMinutes };
}
