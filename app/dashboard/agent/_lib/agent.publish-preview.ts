import type { ChannelKey as BoosterChannelKey } from "../../booster/publier/publishModal.shared";
import { channelPayloadKeys } from "./agent.config";
import type {
  AgentChannelPreview,
  AgentImageAsset,
  AgentMediaAdaptationPreview,
  AgentPreparedAction,
  AgentPublishMediaItem,
  AgentPublishMediaPreview,
  ChannelKey,
} from "./agent.types";
import { asRecord, firstSafeString, safeString } from "./agent.utils";
import {
  boosterChannelKeyFromAgentChannel,
  normalizeAgentCtaMode,
  recordValueForUiChannel,
} from "./agent.settings";

export function extractImageAsset(
  action: AgentPreparedAction,
): AgentImageAsset | null {
  const directAsset = action.imageAssets
    .map((asset) => {
      if (typeof asset === "string") return { url: asset };
      return asRecord(asset) as AgentImageAsset | null;
    })
    .find((asset): asset is AgentImageAsset => Boolean(asset));

  if (directAsset) return directAsset;

  const payload = action.payload || {};
  const candidates = [
    payload.video,
    payload.videoAsset,
    payload.image,
    payload.imageAsset,
    payload.selectedImage,
    payload.visual,
    payload.cover,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") return { url: candidate };
    const record = asRecord(candidate);
    if (record) return record as AgentImageAsset;
  }

  return null;
}

export function imageAssetUrl(asset: AgentImageAsset | null): string {
  if (!asset) return "";
  return firstSafeString(
    asset.url,
    asset.publicUrl,
    asset.renderedUrl,
    asset.src,
    asset.path,
    asset.originalPublicUrl,
    asset.originalUrl,
  );
}

export function imageAssetAlt(asset: AgentImageAsset | null): string {
  if (!asset) return "Aperçu du visuel préparé";
  return (
    firstSafeString(asset.alt, asset.title, asset.name) ||
    "Aperçu du visuel préparé"
  );
}

export function extractChannelPreview(
  action: AgentPreparedAction,
  channelKey: ChannelKey | null,
): AgentChannelPreview {
  const payload = action.payload || {};
  const postByChannel = asRecord(payload.postByChannel);

  if (channelKey && postByChannel) {
    for (const key of channelPayloadKeys[channelKey]) {
      const rawPost = postByChannel[key];

      if (typeof rawPost === "string") {
        const body = rawPost.trim();
        if (body) {
          return {
            title: action.title,
            body,
            cta: "",
            ctaMode: "none",
            ctaUrl: "",
            ctaPhone: "",
            hashtags: [],
          };
        }
      }

      const post = asRecord(rawPost);
      if (!post) continue;

      const title = firstSafeString(post.title, post.subject, action.title);
      const body = firstSafeString(
        post.content,
        post.text,
        post.caption,
        post.body,
        post.message,
      );
      const cta = firstSafeString(post.cta, post.callToAction);
      const ctaMode = normalizeAgentCtaMode(post.ctaMode || post.cta_mode);
      const ctaUrl = firstSafeString(
        post.ctaUrl,
        post.cta_url,
        post.buttonUrl,
        post.url,
        post.link,
        post.href,
      );
      const ctaPhone = firstSafeString(
        post.ctaPhone,
        post.cta_phone,
        post.phone,
        post.phoneNumber,
      );
      const hashtags = Array.isArray(post.hashtags)
        ? post.hashtags
            .map((hashtag) => safeString(hashtag))
            .filter(Boolean)
            .slice(0, 8)
        : [];

      if (title || body || cta || ctaUrl || ctaPhone || hashtags.length) {
        return {
          title: title || action.title,
          body,
          cta,
          ctaMode:
            ctaMode !== "none" || !cta
              ? ctaMode
              : ctaUrl
                ? "website"
                : ctaPhone
                  ? "call"
                  : "custom",
          ctaUrl,
          ctaPhone,
          hashtags,
        };
      }
    }
  }

  const title = firstSafeString(
    payload.campaignSubject,
    payload.subject,
    payload.title,
    action.title,
  );
  const body = firstSafeString(
    payload.campaignBody,
    payload.bodyText,
    payload.body,
    payload.message,
    payload.previewText,
    action.previewText,
    action.summary,
  );

  return {
    title,
    body,
    cta: "",
    ctaMode: "none",
    ctaUrl: "",
    ctaPhone: "",
    hashtags: [],
  };
}

export function isPublishPreparedAction(
  action: AgentPreparedAction | null,
): action is AgentPreparedAction {
  return Boolean(
    action &&
    action.automationKey === "publish" &&
    action.targetTool === "booster" &&
    action.actionType === "publication",
  );
}

export function publishPostParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function filenameFromUrl(url: string): string {
  if (!url) return "Pièce jointe";
  const clean = url.split("?")[0]?.split("#")[0] || url;
  try {
    return decodeURIComponent(
      clean.split("/").filter(Boolean).pop() || "Pièce jointe",
    );
  } catch {
    return clean.split("/").filter(Boolean).pop() || "Pièce jointe";
  }
}

export function mediaKindFromHints(
  type: string,
  url: string,
): "image" | "video" | "file" {
  const hint = `${type} ${url}`.toLowerCase();
  if (/\.(mp4|mov|m4v|webm|avi)(\?|#|$)/i.test(url) || hint.includes("video/"))
    return "video";
  if (
    /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(url) ||
    hint.includes("image/")
  )
    return "image";
  return "file";
}

export function firstAttachmentCandidate(value: unknown): unknown {
  if (Array.isArray(value)) return value.find(Boolean) || null;
  return value || null;
}

export function channelPostRecord(
  action: AgentPreparedAction,
  channelKey: ChannelKey | null,
): Record<string, unknown> | null {
  if (!channelKey) return null;
  const postByChannel = asRecord(action.payload?.postByChannel);
  if (!postByChannel) return null;

  for (const key of channelPayloadKeys[channelKey]) {
    const raw = postByChannel[key];
    const record = asRecord(raw);
    if (record) return record;
  }

  return null;
}

export function channelReadinessRecord(
  action: AgentPreparedAction | null,
  channelKey: ChannelKey | null,
): Record<string, unknown> | null {
  if (!action || !channelKey) return null;
  const readinessByChannel = asRecord(action.payload?.mediaReadinessByChannel);
  if (!readinessByChannel) return null;

  for (const key of channelPayloadKeys[channelKey]) {
    const record = asRecord(readinessByChannel[key]);
    if (record) return record;
  }

  return null;
}

export function channelReadinessIsBlocking(record: Record<string, unknown> | null) {
  if (!record) return false;
  const blockers = Array.isArray(record.blockers)
    ? record.blockers.filter(Boolean)
    : [];
  return (
    blockers.length > 0 ||
    record.status === "blocked" ||
    record.ready === false ||
    record.publishable === false
  );
}

export function channelReadinessReason(record: Record<string, unknown> | null) {
  if (!record) return "";
  const blockers = Array.isArray(record.blockers)
    ? record.blockers.filter(Boolean)
    : [];
  return firstSafeString(
    blockers[0],
    record.reason,
    record.message,
    record.label,
  );
}

export function channelRequiresMedia(channelKey: ChannelKey | null): boolean {
  return (
    channelKey === "instagram" ||
    channelKey === "tiktok" ||
    channelKey === "youtube"
  );
}

export function channelRequiresVideo(channelKey: ChannelKey | null): boolean {
  return channelKey === "youtube";
}

export function channelSupportsHashtags(channelKey: ChannelKey | null): boolean {
  return Boolean(
    channelKey &&
    ["facebook", "instagram", "linkedin", "tiktok", "youtube"].includes(
      channelKey,
    ),
  );
}

export function publishPayloadRecord(
  action: AgentPreparedAction,
): Record<string, unknown> {
  return asRecord(action.payload?.publishPayload) || {};
}

export function publishPayloadValue(
  action: AgentPreparedAction,
  key: string,
): unknown {
  const payload = action.payload || {};
  if (Object.prototype.hasOwnProperty.call(payload, key)) return payload[key];
  return publishPayloadRecord(action)[key];
}

export function publishMediaRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    return { url: value, name: filenameFromUrl(value) };
  }
  return asRecord(value);
}

export function publishMediaItemFromRecord(
  record: Record<string, unknown> | null,
): AgentPublishMediaItem | null {
  if (!record) return null;
  const asset = record as AgentImageAsset;
  const url = imageAssetUrl(asset);
  if (!url) return null;
  const type = firstSafeString(
    record.type,
    record.mimeType,
    record.mime_type,
    record.contentType,
  );
  const kind = mediaKindFromHints(type, url);
  const rawName =
    firstSafeString(record.name, record.title, record.alt, record.filename) ||
    filenameFromUrl(url);
  const name =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      rawName,
    )
      ? kind === "video"
        ? "Vidéo iNr’Agent"
        : "Image iNr’Agent"
      : rawName;
  return { record, name, url, kind };
}

export function publishChannelImages(
  action: AgentPreparedAction,
  channelKey: ChannelKey | null,
): Record<string, unknown>[] {
  if (!channelKey) return [];
  const imagesByChannel =
    asRecord(publishPayloadValue(action, "imagesByChannel")) || {};
  const raw = recordValueForUiChannel(imagesByChannel, channelKey);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => publishMediaRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

export function publishChannelMediaMode(
  action: AgentPreparedAction,
  channelKey: ChannelKey | null,
): string {
  if (!channelKey) return "";
  const mediaModeByChannel =
    asRecord(publishPayloadValue(action, "mediaModeByChannel")) || {};
  return String(recordValueForUiChannel(mediaModeByChannel, channelKey) || "")
    .trim()
    .toLowerCase();
}

export function publishChannelVideoSettings(
  action: AgentPreparedAction,
  channelKey: ChannelKey | null,
): Record<string, unknown> | null {
  if (!channelKey) return null;
  const settingsByChannel =
    asRecord(publishPayloadValue(action, "videoSettingsByChannel")) || {};
  return asRecord(recordValueForUiChannel(settingsByChannel, channelKey));
}

export function publishChannelVideo(
  action: AgentPreparedAction,
  channelKey: ChannelKey | null,
): Record<string, unknown> | null {
  const baseVideo =
    publishMediaRecord(publishPayloadValue(action, "video")) ||
    publishMediaRecord(publishPayloadValue(action, "videoAsset"));
  if (!baseVideo) return null;

  const transformedVariants = Array.isArray(baseVideo.transformedVariants)
    ? baseVideo.transformedVariants
        .map((variant) => publishMediaRecord(variant))
        .filter((variant): variant is Record<string, unknown> => Boolean(variant))
    : [];
  const channel = boosterChannelKeyFromAgentChannel(channelKey);
  const settings = publishChannelVideoSettings(action, channelKey);
  const signature = settings
    ? `${String(settings.format || "original")}:${String(
        settings.adaptationMode || settings.adaptation_mode || "safe_frame",
      )}`
    : "";
  const selectedVariant =
    transformedVariants.find(
      (variant) => String(variant.channel || "") === channel,
    ) ||
    transformedVariants.find(
      (variant) => signature && String(variant.signature || "") === signature,
    ) ||
    null;

  return {
    ...baseVideo,
    ...(selectedVariant || {}),
    transformedVariants,
    videoSettings: settings || asRecord(baseVideo.videoSettings) || null,
    videoSettingsByChannel:
      asRecord(publishPayloadValue(action, "videoSettingsByChannel")) ||
      asRecord(baseVideo.videoSettingsByChannel) ||
      {},
    originalVideo: baseVideo,
  };
}

export function getPublishMediaRecords(
  action: AgentPreparedAction | null,
  channelKey: ChannelKey | null,
): Record<string, unknown>[] {
  if (!action) return [];
  const mode = publishChannelMediaMode(action, channelKey);
  const channelImages = publishChannelImages(action, channelKey);
  const video = publishChannelVideo(action, channelKey);

  if (mode === "video" && video) return [video];
  if (mode === "images" && channelImages.length) return channelImages;
  if (channelImages.length) return channelImages;
  if (video) return [video];

  const payload = action.payload || {};
  const genericImages = [
    ...(Array.isArray(publishPayloadValue(action, "images"))
      ? (publishPayloadValue(action, "images") as unknown[])
      : []),
    ...(Array.isArray(publishPayloadValue(action, "mediaAssets"))
      ? (publishPayloadValue(action, "mediaAssets") as unknown[])
      : []),
    ...action.imageAssets,
  ]
    .map((item) => publishMediaRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const uniqueGenericImages = genericImages.filter((item, index, list) => {
    const key = firstSafeString(
      item.id,
      item.storagePath,
      item.storage_path,
      item.url,
      item.publicUrl,
    );
    return (
      Boolean(key) &&
      list.findIndex(
        (candidate) =>
          firstSafeString(
            candidate.id,
            candidate.storagePath,
            candidate.storage_path,
            candidate.url,
            candidate.publicUrl,
          ) === key,
      ) === index
    );
  });
  if (uniqueGenericImages.length) return uniqueGenericImages;

  const post = channelPostRecord(action, channelKey);
  const directCandidates = [
    post?.media,
    post?.mediaAsset,
    post?.image,
    post?.imageAsset,
    post?.imageUrl,
    post?.visual,
    post?.cover,
    post?.video,
    post?.videoAsset,
    post?.file,
    post?.attachment,
    firstAttachmentCandidate(post?.attachments),
    payload.media,
    payload.mediaAsset,
    payload.image,
    payload.imageAsset,
    payload.selectedImage,
    payload.visual,
    payload.cover,
    firstAttachmentCandidate(payload.attachments),
    firstAttachmentCandidate(payload.files),
  ];

  const direct = directCandidates
    .map((candidate) => publishMediaRecord(candidate))
    .find(Boolean);
  if (direct) return [direct];

  const fallback = extractImageAsset(action);
  const fallbackRecord = publishMediaRecord(fallback);
  return fallbackRecord ? [fallbackRecord] : [];
}

export function extractPublishMediaPreview(
  action: AgentPreparedAction | null,
  channelKey: ChannelKey | null,
  requestedIndex = 0,
): AgentPublishMediaPreview {
  const emptyItems: AgentPublishMediaItem[] = [];
  if (!action) {
    return {
      name: "Aucune",
      typeLabel: "Texte",
      statusLabel: "—",
      statusTone: "neutral",
      url: "",
      kind: "none",
      note: "Aucune publication préparée.",
      items: emptyItems,
      count: 0,
      activeIndex: 0,
    };
  }

  const items = getPublishMediaRecords(action, channelKey)
    .map((record) => publishMediaItemFromRecord(record))
    .filter((item): item is AgentPublishMediaItem => Boolean(item));
  const activeIndex = items.length
    ? Math.min(Math.max(0, requestedIndex), items.length - 1)
    : 0;
  const selected = items[activeIndex] || null;
  const needsVideo = channelRequiresVideo(channelKey);
  const needsMedia = channelRequiresMedia(channelKey);
  const readiness = channelReadinessRecord(action, channelKey);
  const readinessBlocks = channelReadinessIsBlocking(readiness);
  const readinessReason = channelReadinessReason(readiness);

  if (selected) {
    const invalidVideo = needsVideo && selected.kind !== "video";
    const countLabel =
      items.length > 1 && selected.kind === "image"
        ? `${items.length} images`
        : selected.kind === "video"
          ? "Vidéo"
          : selected.kind === "image"
            ? "Image"
            : "Fichier";
    return {
      name: selected.name || countLabel,
      typeLabel: countLabel,
      statusLabel: invalidVideo || readinessBlocks ? "Bloquant" : "Prêt",
      statusTone: invalidVideo || readinessBlocks ? "blocked" : "ready",
      url: selected.url,
      kind: selected.kind,
      note: invalidVideo
        ? "Ce canal exige une vidéo. Remplacez le média avant validation."
        : readinessBlocks
          ? readinessReason || "Ce canal doit être complété avant publication."
          : selected.kind === "video"
            ? "Vidéo préparée pour ce canal."
            : items.length > 1
              ? `${items.length} images préparées pour ce canal.`
              : selected.kind === "image"
                ? "Image préparée pour ce canal."
                : "Fichier associé à ce canal.",
      items,
      count: items.length,
      activeIndex,
    };
  }

  if (needsMedia || readinessBlocks) {
    return {
      name: needsVideo ? "Vidéo requise" : "Média manquant",
      typeLabel: needsVideo ? "Vidéo" : "Image / vidéo",
      statusLabel: "Bloquant",
      statusTone: "blocked",
      url: "",
      kind: "none",
      note:
        readinessReason ||
        (needsVideo
          ? "YouTube nécessite une vidéo avant publication."
          : "Ce canal nécessite un média avant publication."),
      items: emptyItems,
      count: 0,
      activeIndex: 0,
    };
  }

  return {
    name: "Aucune",
    typeLabel: "Texte seul",
    statusLabel: "Prêt",
    statusTone: "ready",
    url: "",
    kind: "none",
    note: "Publication texte prête pour ce canal.",
    items: emptyItems,
    count: 0,
    activeIndex: 0,
  };
}

export function getPublishMediaRecord(
  action: AgentPreparedAction | null,
  channelKey: ChannelKey | null,
  requestedIndex = 0,
): Record<string, unknown> | null {
  const records = getPublishMediaRecords(action, channelKey);
  if (!records.length) return null;
  const activeIndex = Math.min(Math.max(0, requestedIndex), records.length - 1);
  return records[activeIndex] || null;
}

export function getMediaVideoSettingsRecord(
  media: Record<string, unknown> | null,
  channel: BoosterChannelKey,
) {
  const settingsByChannel = asRecord(media?.videoSettingsByChannel);
  const direct = asRecord(settingsByChannel?.[channel]);
  return direct || asRecord(media?.videoSettings) || null;
}

export function extractPublishMediaAdaptationPreview(
  action: AgentPreparedAction | null,
  channelKey: ChannelKey | null,
): AgentMediaAdaptationPreview {
  if (!action || !channelKey) {
    return {
      strategy: "none",
      mediaType: "none",
      note: "Aucune adaptation média à préparer.",
      userEditable: false,
    };
  }

  const adaptationByChannel = asRecord(
    action.payload?.mediaAdaptationByChannel,
  );
  if (adaptationByChannel) {
    for (const key of channelPayloadKeys[channelKey]) {
      const record = asRecord(adaptationByChannel[key]);
      if (record) {
        const mediaTypeRaw = safeString(record.mediaType || record.media_type);
        return {
          strategy: safeString(record.strategy) || "booster_auto",
          mediaType:
            mediaTypeRaw === "video"
              ? "video"
              : mediaTypeRaw === "image"
                ? "image"
                : mediaTypeRaw === "file"
                  ? "file"
                  : "none",
          note:
            safeString(record.note) ||
            "iNrAgent prépare automatiquement une version compatible avec le canal.",
          userEditable: record.userEditable !== false,
        };
      }
    }
  }

  const media = extractPublishMediaPreview(action, channelKey);
  if (media.kind === "video") {
    return {
      strategy: "booster_video_format",
      mediaType: "video",
      note: "La vidéo source sera préparée par Booster selon les spécificités du canal avant publication.",
      userEditable: true,
    };
  }
  if (media.kind === "image") {
    return {
      strategy: "booster_image_adapter",
      mediaType: "image",
      note: "L’image source sera adaptée par Booster selon les dimensions du canal sans modifier l’original.",
      userEditable: true,
    };
  }

  return {
    strategy: "text_only",
    mediaType: "none",
    note: "Aucun média à adapter pour ce canal.",
    userEditable: false,
  };
}

export function publishContentKindLabel(args: {
  media: AgentPublishMediaPreview | null;
  hasText: boolean;
}): string {
  const { media, hasText } = args;
  const kind = media?.kind || "none";
  if (kind === "video") return hasText ? "Texte + Vidéo" : "Vidéo seule";
  if (kind === "image")
    return hasText ? "Texte + Photo(s)" : "Photo(s) seule(s)";
  if (kind === "file") return hasText ? "Texte + Média" : "Média seul";
  return hasText ? "Texte seul" : "—";
}

export function publishStatusLabel(args: {
  action: AgentPreparedAction | null;
  media: AgentPublishMediaPreview | null;
  hasText: boolean;
}): { label: string; tone: "ready" | "blocked" | "warning" | "neutral" } {
  const { action, media, hasText } = args;
  if (!action) return { label: "—", tone: "neutral" };
  if (media?.statusTone === "blocked")
    return { label: "Bloquant", tone: "blocked" };
  if (media?.statusTone === "warning")
    return { label: media.statusLabel || "À vérifier", tone: "warning" };
  if (!hasText && media?.kind === "none")
    return { label: "Bloquant", tone: "blocked" };
  return { label: "Prêt", tone: "ready" };
}

export function extractPublishCtaLine(
  action: AgentPreparedAction | null,
  channelKey: ChannelKey | null,
  preview: AgentChannelPreview | null,
): string {
  if (!action) return "—";
  const payload = action.payload || {};
  const post = channelPostRecord(action, channelKey);
  const ctaLabel = firstSafeString(
    preview?.cta,
    post?.cta,
    post?.callToAction,
    post?.buttonLabel,
    post?.buttonText,
    payload.cta,
    payload.callToAction,
    payload.buttonLabel,
    payload.buttonText,
  );
  const ctaUrl = firstSafeString(
    preview?.ctaUrl,
    post?.ctaUrl,
    post?.cta_url,
    post?.buttonUrl,
    post?.url,
    post?.link,
    post?.href,
    payload.ctaUrl,
    payload.cta_url,
    payload.buttonUrl,
    payload.url,
    payload.link,
    payload.href,
  );
  const ctaPhone = firstSafeString(
    preview?.ctaPhone,
    post?.ctaPhone,
    post?.cta_phone,
    post?.phone,
    post?.phoneNumber,
    payload.ctaPhone,
    payload.cta_phone,
    payload.phone,
    payload.phoneNumber,
  );

  if (ctaLabel && ctaUrl) return `${ctaLabel} — ${ctaUrl}`;
  if (ctaLabel && ctaPhone) return `${ctaLabel} — ${ctaPhone}`;
  return ctaLabel || ctaUrl || ctaPhone || "—";
}
