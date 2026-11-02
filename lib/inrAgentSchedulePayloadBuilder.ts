import "server-only";

import { filterInrAgentPublicationChannels } from "@/lib/inrAgentPublicationChannelSelection";
import { normalizeBoosterSoundtrackId, normalizeBoosterSoundtrackByChannel } from "@/lib/boosterSoundtracks";
import { readInrAgentThreadsPublicationSettings, projectInrAgentThreadsPublishPayload } from "@/lib/inrAgentThreadsPublication";
import { isMetaChannelPilotEnabledForAccount } from "@/lib/metaChannelRolloutServer";
import { buildVideoSettingsByChannel } from "@/lib/boosterVideoSettings";
import { inrAgentChannelImages, readInrAgentMediaFormatVariants } from "@/lib/inrAgentMediaFormats";
import { prepareInrAgentPublicationImages } from "@/lib/inrAgentMediaPreparation";
import { ensureInrAgentMediaFormats } from "@/lib/inrAgentMediaFormatGeneration";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { buildAbsoluteStorageContentUrl } from "@/lib/storageContentUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { publicationSettingsForInrAgentChannel } from "@/lib/inrAgentPublicationPlacement";
import { readInrAgentPinterestBoardSelection } from "@/lib/inrAgentPinterestBoard";
import { getScheduledPublicationMediaWorkspaceId } from "@/lib/scheduledPublicationMediaSnapshot";
import { normalizeTiktokPublicationSettings } from "@/app/api/booster/publish-now/publishNow.foundations";
import { type JsonRecord, type BoosterChannel, type BoosterPost } from "@/lib/inrAgentScheduleTypes";
import { UUID_PATTERN, canPublishWithoutMedia, isVideoOnlyChannel, isImageRequiredChannel, asRecord, cleanText, filterRecordByChannels, normalizePost, ensurePublishablePost, normalizeBoosterChannels, getFirstPost, normalizeCampaignRecipients, normalizeCampaignAttachments, isCampaignAgentAction, isManualEditorialPublicationAction } from "@/lib/inrAgentSchedulePolicy";

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

  const imageMeta: JsonRecord = { ...(asRecord(media.imageMeta) || {}),
    ...(Number(media.width) > 0 && Number(media.height) > 0 ? { width: Number(media.width), height: Number(media.height) } : {}) };
  const sourceMetadata = asRecord(media.sourceMetadata) || {};
  const bucket =
    cleanText(
      media.bucket ||
        media.bucketName ||
        media.bucket_name ||
        imageMeta.bucket ||
        sourceMetadata.bucket ||
        "inrcy-image-bank",
      120,
    ) || "inrcy-image-bank";
  const storagePath = cleanText(
    media.storagePath ||
      media.storage_path ||
      media.path ||
      imageMeta.storagePath ||
      imageMeta.storage_path ||
      imageMeta.path ||
      sourceMetadata.storagePath ||
      sourceMetadata.storage_path ||
      sourceMetadata.path ||
      "",
    800,
  );
  const title = cleanText(media.title || media.name || "image-iNrAgent", 120);
  const rawMediaId = cleanText(media.mediaId || media.id, 120);
  const mediaId = UUID_PATTERN.test(rawMediaId) ? rawMediaId : "";

  if (storagePath) {
    const mime =
      cleanText(media.mimeType || media.mime_type || media.type, 120) ||
      mimeFromPath(storagePath);
    const extension =
      mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const durableUrl =
      buildAbsoluteStorageContentUrl(bucket, storagePath) ||
      cleanText(media.publicUrl || media.url || media.src, 2000);
    return {
      ...media,
      ...(mediaId ? { mediaId } : {}),
      name: cleanText(media.name, 180) || `${title}.${extension}`,
      type: mime,
      bucket,
      storagePath,
      publicUrl: durableUrl,
      renderedUrl: durableUrl,
      originalUrl: durableUrl,
      originalPublicUrl: durableUrl,
      originalStoragePath:
        cleanText(media.originalStoragePath, 800) || storagePath,
      originalName: cleanText(media.originalName, 180) || title,
      originalType: cleanText(media.originalType, 120) || mime,
      imageKey: cleanText(media.imageKey || media.id || actionId, 120),
      imageMeta: {
        ...imageMeta,
        source: cleanText(media.source, 120) || "inr_agent",
        bucket,
        storagePath,
        title,
      },
      publicationReady: true,
    };
  }

  const dataUrl = cleanText(media.dataUrl || media.data_url, 20_000_000);
  if (dataUrl.startsWith("data:image/")) {
    const mime =
      cleanText(media.type || media.mimeType || media.mime_type, 120) ||
      dataUrl.slice(5, dataUrl.indexOf(";")) ||
      "image/jpeg";
    return {
      ...media,
      ...(mediaId ? { mediaId } : {}),
      name: cleanText(media.name, 180) || `${title}.jpg`,
      type: mime,
      dataUrl,
      originalName: cleanText(media.originalName, 180) || title,
      originalType: cleanText(media.originalType, 120) || mime,
      imageKey: cleanText(media.imageKey || media.id || actionId, 120),
    };
  }

  const publicUrl = cleanText(
    media.url || media.publicUrl || media.src || "",
    2000,
  );
  if (!publicUrl) return null;
  return {
    ...(mediaId ? { mediaId } : {}),
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

function imageCandidatesFromChannelMap(value: unknown) {
  const record = asRecord(value);
  if (!record) return [];
  return Object.values(record).flatMap((item) =>
    Array.isArray(item) ? item : item ? [item] : [],
  );
}

async function buildImagePayloadsFromAgentAction(
  payload: JsonRecord,
  actionId: string,
  actionImageAssets: unknown[],
  channel?: string,
  override?: unknown[],
) {
  const publishPayload = asRecord(payload.publishPayload) || {};
  const selected = override || inrAgentChannelImages(payload, channel);
  const candidates = (selected || [
    ...imageCandidatesFromChannelMap(payload.imagesByChannel),
    ...imageCandidatesFromChannelMap(publishPayload.imagesByChannel),
    ...(Array.isArray(payload.images) ? payload.images : []),
    ...(Array.isArray(publishPayload.images) ? publishPayload.images : []),
    ...(Array.isArray(payload.mediaAssets) ? payload.mediaAssets : []),
    ...(Array.isArray(actionImageAssets) ? actionImageAssets : []),
    getAgentMediaRecord(payload),
  ])
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
        media.publicUrl ||
        media.dataUrl,
      20_000_000,
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
  for (const media of unique.slice(0, 5)) {
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
    mediaId:
      cleanText(media.mediaId || media.media_id || media.id, 100) || null,
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
    thumbnailBucket:
      cleanText(media.thumbnailBucket || media.thumbnail_bucket, 120) ||
      bucket,
    ...(Object.keys(sourceMetadata).length ? { sourceMetadata } : {}),
    ...(videoSettings ? { videoSettings } : {}),
    ...(videoSettingsByChannel ? { videoSettingsByChannel } : {}),
    videoFormat: cleanText(media.videoFormat, 40) || null,
    videoAdaptationMode: cleanText(media.videoAdaptationMode, 40) || null,
    transformedVariants,
  };
}

export async function buildScheduledPayload(
  action: ReturnType<typeof rowToInrAgentAction>,
  accountId: string,
  requestedTiktokPublicationSettings?: unknown,
  actorAuthUserId?: string,
) {
  let payload = action.payload || {};
  if (payload.mediaFormatVariants && isManualEditorialPublicationAction(action)) {
    payload = (await ensureInrAgentMediaFormats({ supabase: supabaseAdmin, accountId,
      actorAuthUserId: actorAuthUserId || accountId, actionId: action.id, payload,
      channels: filterInrAgentPublicationChannels(payload, normalizeBoosterChannels(payload.selectedChannels || payload.channels || action.targetChannels)), fallbackAssets: action.imageAssets, allowGeneration: false })).payload;
  }
  const nestedPublishPayload = asRecord(payload.publishPayload) || {};
  const tiktokPublicationSettings = normalizeTiktokPublicationSettings(
    requestedTiktokPublicationSettings ||
      payload.tiktokPublicationSettings ||
      nestedPublishPayload.tiktokPublicationSettings,
  );

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
    const soundtrackId = normalizeBoosterSoundtrackId(Object.hasOwn(payload, "soundtrackId") ? payload.soundtrackId : nestedPublishPayload.soundtrackId);
    const soundtrackByChannel = {
      ...normalizeBoosterSoundtrackByChannel(nestedPublishPayload.soundtrackByChannel),
      ...normalizeBoosterSoundtrackByChannel(payload.soundtrackByChannel),
    };
    // Preserve the workspace identity when the action was prepared from the
    // unified media pipeline. It is replaced by a private snapshot immediately
    // after this endpoint creates each scheduled row.
    // Native format groups can contain more than one source per carousel
    // position. A former single-source workspace must not replace those files.
    const hasNativeFormatGroups = readInrAgentMediaFormatVariants(payload) !== null;
    const sourceMediaWorkspaceId = hasNativeFormatGroups ? "" : getScheduledPublicationMediaWorkspaceId(payload);
    const sourceMediaWorkspaceClientKey = cleanText(
      payload.mediaWorkspaceClientKey || nestedPublishPayload.mediaWorkspaceClientKey,
      180,
    );
    const sourceMediaPipelineCutoverV1 =
      !hasNativeFormatGroups && (payload.mediaPipelineCutoverV1 === true ||
      nestedPublishPayload.mediaPipelineCutoverV1 === true);
    const selectedChannels = filterInrAgentPublicationChannels(payload, normalizeBoosterChannels(
      payload.selectedChannels || payload.channels || action.targetChannels,
    ));
    if (!selectedChannels.length) throw new Error("Choisissez au moins un canal avant de valider.");
    if (selectedChannels.includes("threads") && !(await isMetaChannelPilotEnabledForAccount(supabaseAdmin, accountId))) throw new Error("Threads est réservé aux comptes ADMIN.");
    const imagePayloads = await buildImagePayloadsFromAgentAction(
      payload,
      action.id,
      action.imageAssets,
      selectedChannels.length === 1 ? selectedChannels[0] : undefined,
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
    const sourceMediaModeByChannel = asRecord(
      payload.mediaModeByChannel || nestedPublishPayload.mediaModeByChannel,
    ) || {};
    const sourceImagesByChannel = asRecord(
      payload.imagesByChannel || nestedPublishPayload.imagesByChannel,
    ) || {};
    const sourceVideoByChannel = asRecord(
      payload.videoByChannel || nestedPublishPayload.videoByChannel,
    ) || {};
    const channelMediaMode = (channel: BoosterChannel) => {
      if (channel === "threads" && readInrAgentThreadsPublicationSettings(payload).mode === "ghost") return "none";
      const configured = cleanText(sourceMediaModeByChannel[channel], 20).toLowerCase();
      return configured === "video" || configured === "images" || configured === "none"
        ? configured
        : activeMediaMode;
    };
    const channelHasImages = (channel: BoosterChannel) =>
      (Array.isArray(sourceImagesByChannel[channel]) &&
        sourceImagesByChannel[channel].length > 0) ||
      hasImagePayload;
    const channelHasVideo = (channel: BoosterChannel) =>
      Object.keys(asRecord(sourceVideoByChannel[channel]) || {}).length > 0 ||
      hasVideoPayload;
    const threadsPublicationSettings = selectedChannels.includes("threads")
      ? readInrAgentThreadsPublicationSettings(payload)
      : null;
    const instagramPublicationSettings = selectedChannels.includes("instagram")
      ? publicationSettingsForInrAgentChannel(payload, "instagram")
      : null;
    const facebookPublicationSettings = selectedChannels.includes("facebook")
      ? publicationSettingsForInrAgentChannel(payload, "facebook")
      : null;
    const pinterestPublicationSettings = selectedChannels.includes("pinterest")
      ? readInrAgentPinterestBoardSelection(payload)
      : null;
    const publishChannels = selectedChannels.filter((channel) => {
      const mode = channelMediaMode(channel);
      const hasChannelImagePayload = channelHasImages(channel);
      if (mode === "video") return channelHasVideo(channel);
      if (isVideoOnlyChannel(channel)) return false;
      if (channel === "facebook" && facebookPublicationSettings) {
        return hasChannelImagePayload;
      }
      if (isImageRequiredChannel(channel)) return hasChannelImagePayload;
      return canPublishWithoutMedia(channel) || hasChannelImagePayload;
    });
    const autoDisabledChannels = selectedChannels.filter(
      (channel) =>
        isVideoOnlyChannel(channel) && !publishChannels.includes(channel),
    );
    const blockedChannels = selectedChannels.filter(
      (channel) =>
        !publishChannels.includes(channel) &&
        !autoDisabledChannels.includes(channel),
    );
    if (blockedChannels.length)
      throw new Error(
        `Programmation complète impossible : média requis pour ${blockedChannels.join(", ")}. Ajoutez le média attendu puis relancez.`,
      );
    if (!publishChannels.length && autoDisabledChannels.length)
      throw new Error(
        "YouTube a été désactivé automatiquement : une vidéo est obligatoire pour programmer sur ce canal. Activez un autre canal compatible avec les images.",
      );
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
      publishChannels.map((channel) => [channel, channelMediaMode(channel)]),
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
            channels: publishChannels.filter((channel) => channel !== "threads" || threadsPublicationSettings?.mode !== "ghost") as any,
            videoSettingsByChannel: videoSettingsSource,
            sourceMetadata: (videoPayload as any)?.sourceMetadata || null,
          })
        : {};
    const preparedImages =
      activeMediaMode === "images" && imagePayloads.length
        ? await prepareInrAgentPublicationImages({
            accountId,
            channels: publishChannels.filter((channel) => channel !== "threads" || threadsPublicationSettings?.mode !== "ghost"),
            payload,
            readImages: (channel, override) => buildImagePayloadsFromAgentAction(payload, action.id, action.imageAssets, channel, override),
          })
        : {
            imagesByChannel: {},
            imageSettingsByChannel: {},
            warnings: [],
            failuresByChannel: {},
            imagesByPlacement: {},
          };
    return {
      actionType: "publication" as const,
      targetTool: "booster" as const,
      channels: publishChannels,
      payload: {
        kind: "manual_publish_schedule",
        sourceActionId: action.id,
        publicationChannelSelection: payload.publicationChannelSelection,
        retainedPublicationPayload: payload,
        publishPayload: projectInrAgentThreadsPublishPayload({
          channels: publishChannels,
          autoDisabledChannels,
          ...(sourceMediaWorkspaceId
            ? { mediaWorkspaceId: sourceMediaWorkspaceId }
            : {}),
          ...(sourceMediaWorkspaceClientKey
            ? { mediaWorkspaceClientKey: sourceMediaWorkspaceClientKey }
            : {}),
          ...(sourceMediaPipelineCutoverV1
            ? { mediaPipelineCutoverV1: true }
            : {}),
          post: firstPost,
          postByChannel: normalizedPostByChannel,
          idea: cleanText(payload.idea || action.summary, 500),
          mediaType: activeMediaMode === "video" ? "video" : "images",
          mediaModeByChannel,
          videoSettingsByChannel,
          images: imagePayloads,
          imagesByChannel: preparedImages.imagesByChannel,
          imagesByPlacement: preparedImages.imagesByPlacement,
          mediaFormatVariants: payload.mediaFormatVariants,
          clientPreflightFailuresByChannel: preparedImages.failuresByChannel,
          videoByChannel: filterRecordByChannels(
            sourceVideoByChannel,
            publishChannels,
          ),
          imageSettingsByChannel: preparedImages.imageSettingsByChannel,
          soundtrackId,
          soundtrackByChannel,
          imagePreparationWarnings: preparedImages.warnings,
          video: videoPayload,
          ...(instagramPublicationSettings
            ? { instagramPublicationSettings }
            : {}),
          ...(facebookPublicationSettings
            ? { facebookPublicationSettings }
            : {}),
          ...(threadsPublicationSettings ? { threadsPublicationSettings } : {}),
          ...(pinterestPublicationSettings
            ? { pinterestPublicationSettings }
            : {}),
          ...(tiktokPublicationSettings
            ? { tiktokPublicationSettings }
            : {}),
          workflowTool: "booster",
          workflowAction: "publier",
          source: "inr_agent",
          inrAgentActionId: action.id,
        }),
      },
    };
  }

  throw new Error("Cette action iNr’Agent ne peut pas être programmée.");
}
