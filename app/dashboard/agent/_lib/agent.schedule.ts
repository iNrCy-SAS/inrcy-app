import { INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT } from "@/lib/mediaRules";
import type {
  ChannelKey as BoosterChannelKey,
  BoosterCtaMode,
} from "../../booster/publier/publishModal.shared";
import { apiChannelToUi, channelOptions } from "./agent.config";
import type {
  AgentImageAsset,
  AgentPreparedAction,
  AgentScheduledAction,
  AutomationConfig,
  AutomationKey,
  ChannelKey,
  PublishMediaMutation,
} from "./agent.types";
import { asRecord, firstSafeString, jsonClone, safeString } from "./agent.utils";
import {
  boosterChannelKeyFromAgentChannel,
  boosterDisplayKeyFromAgentChannel,
  canonicalizeRecordForBoosterChannels,
  firstRecordValueForUiChannels,
  normalizeConfigScheduleSlots,
  normalizeUiChannelKey,
  normalizeUiChannels,
  recordValueForUiChannel,
} from "./agent.settings";
import { imageAssetUrl, mediaKindFromHints } from "./agent.publish-preview";
import { formatReportDateLabel } from "./agent.reports";

export function scheduleDateParts(
  value: string | null | undefined,
  fallbackDate = "—",
  fallbackTime = "—",
  locale = "fr-FR",
) {
  const formatted = formatReportDateLabel(value, locale);
  return {
    date: formatted.date === "—" ? fallbackDate : formatted.date,
    time: formatted.time || fallbackTime,
  };
}

export function scheduledActionStatusLabel(status: AgentScheduledAction["status"]) {
  if (status === "running") return "En cours";
  if (status === "done") return "Exécuté";
  if (status === "failed") return "Échec";
  if (status === "cancelled") return "Annulé";
  return "Programmé";
}

export function scheduledActionSortDate(action: AgentScheduledAction) {
  return (
    action.executedAt ||
    action.updatedAt ||
    action.scheduledAt ||
    action.createdAt ||
    ""
  );
}

export function scheduleTypeLabelFromAutomation(
  key: AutomationKey | null | undefined,
) {
  if (key === "publish") return "Publication";
  if (key === "grow") return "Propulsion";
  if (key === "loyalty") return "Fidélisation";
  if (key === "stats") return "Statistiques";
  return "Action";
}

export function scheduleChannelLabelFromAutomation(
  key: AutomationKey | null | undefined,
  channel?: string | null,
) {
  if (key === "publish")
    return channel
      ? channelOptions[channel as ChannelKey]?.name || channel
      : "Publication";
  if (key === "stats") return "Bilan";
  return "Mails";
}

export function scheduledActionTypeLabel(action: AgentScheduledAction) {
  const targetTool = String(action.targetTool || "").toLowerCase();
  const actionType = String(action.actionType || "").toLowerCase();
  const kind = String(
    (action.payload as Record<string, unknown> | undefined)?.kind || "",
  ).toLowerCase();
  const workflow = String(
    (action.payload as Record<string, unknown> | undefined)
      ?.workflowFinalizerKind || "",
  ).toLowerCase();

  if (
    targetTool === "booster" ||
    actionType === "publication" ||
    kind === "manual_publish_schedule"
  )
    return "Publication";
  if (
    targetTool === "propulser" ||
    workflow === "propulser" ||
    action.automationKey === "grow"
  )
    return "Propulsion";
  if (
    targetTool === "fideliser" ||
    workflow === "fideliser" ||
    action.automationKey === "loyalty"
  )
    return "Fidélisation";
  if (
    targetTool === "mails" ||
    actionType === "mailing" ||
    kind === "mail_campaign"
  )
    return "Mail";
  if (action.automationKey)
    return scheduleTypeLabelFromAutomation(action.automationKey);
  return "Action";
}

export function scheduledActionPayloadRecord(action: AgentScheduledAction) {
  return asRecord(action.payload) || {};
}

export function isScheduledSimpleMailAction(action: AgentScheduledAction) {
  const payload = scheduledActionPayloadRecord(action);
  const kind = String(payload.kind || "").toLowerCase();
  const workflow = String(payload.workflowFinalizerKind || "").toLowerCase();
  const targetTool = String(action.targetTool || "").toLowerCase();
  const actionType = String(action.actionType || "").toLowerCase();

  return (
    (targetTool === "mails" || actionType === "mailing" || kind === "mail_campaign") &&
    targetTool !== "propulser" &&
    targetTool !== "fideliser" &&
    workflow !== "propulser" &&
    workflow !== "fideliser"
  );
}

export function isScheduledStatsAction(action: AgentScheduledAction) {
  const targetTool = String(action.targetTool || "").toLowerCase();
  const actionType = String(action.actionType || "").toLowerCase();
  return (
    action.automationKey === "stats" ||
    targetTool === "stats" ||
    actionType === "stats" ||
    actionType === "statistics"
  );
}

export function channelDisplayName(channel: string | null | undefined) {
  const normalized = String(channel || "").trim();
  const mapped: Record<string, ChannelKey> = {
    inrcy_site: "siteInrcy",
    site_inrcy: "siteInrcy",
    siteInrcy: "siteInrcy",
    site_web: "siteWeb",
    siteWeb: "siteWeb",
    inr_search: "inrSearch",
    inrSearch: "inrSearch",
    gmb: "gmb",
    google_business: "gmb",
    facebook: "facebook",
    instagram: "instagram",
    linkedin: "linkedin",
    tiktok: "tiktok",
    youtube: "youtube",
    youtube_shorts: "youtube",
    mails: "mails",
    mail: "mails",
  };
  const key = mapped[normalized] || (normalized as ChannelKey);
  return channelOptions[key]?.name || normalized || "—";
}

export function scheduledActionChannelLabels(action: AgentScheduledAction) {
  const typeLabel = scheduledActionTypeLabel(action);
  if (typeLabel === "Publication") {
    const labels = Array.from(
      new Set(
        action.channels
          .map((channel) => channelDisplayName(channel))
          .filter((label) => label && label !== "—"),
      ),
    );
    return labels.length > 0 ? labels : ["Publication"];
  }
  if (typeLabel === "Statistiques") return ["Bilan"];
  return ["Mails"];
}

export function scheduledActionChannelLabel(action: AgentScheduledAction) {
  const labels = scheduledActionChannelLabels(action);
  return labels[0] || "—";
}

export function preparedActionDirtySignature(action: AgentPreparedAction) {
  return JSON.stringify({
    title: action.title,
    summary: action.summary,
    previewText: action.previewText,
    targetChannels: action.targetChannels,
    targetThemes: action.targetThemes,
    recipients: action.recipients,
    imageAssets: action.imageAssets,
    payload: action.payload,
  });
}

export function scheduledAutomationKey(action: AgentScheduledAction): AutomationKey {
  if (action.automationKey && ["publish", "grow", "loyalty", "stats"].includes(action.automationKey)) {
    return action.automationKey;
  }
  const payload = asRecord(action.payload) || {};
  const campaign = asRecord(payload.campaign) || {};
  const metadata = asRecord(campaign.metadata) || asRecord(payload.metadata) || {};
  const metadataAutomationKey = String(metadata.automationKey || "");
  if (["publish", "grow", "loyalty", "stats"].includes(metadataAutomationKey)) {
    return metadataAutomationKey as AutomationKey;
  }
  const targetTool = String(action.targetTool || "").toLowerCase();
  if (targetTool === "booster") return "publish";
  if (targetTool === "fideliser") return "loyalty";
  if (targetTool === "propulser" || targetTool === "mails") return "grow";
  return "publish";
}

export function scheduledActionToPreparedAction(
  scheduledAction: AgentScheduledAction,
): AgentPreparedAction | null {
  const payload = asRecord(scheduledAction.payload) || {};
  const kind = String(payload.kind || "").toLowerCase();
  const automationKey = scheduledAutomationKey(scheduledAction);
  const now = new Date().toISOString();
  const typeLabel = scheduledActionTypeLabel(scheduledAction);

  if (
    typeLabel === "Publication" ||
    kind === "manual_publish_schedule" ||
    String(scheduledAction.targetTool || "").toLowerCase() === "booster"
  ) {
    const publishPayload = asRecord(payload.publishPayload) || payload;
    const channels = normalizeUiChannels(
      publishPayload.channels,
      payload.selectedChannels,
      payload.channels,
      scheduledAction.channels,
    );
    const finalChannels = channels.length
      ? channels
      : normalizeUiChannels(scheduledAction.channels);
    const boosterChannels = finalChannels.map(boosterChannelKeyFromAgentChannel);
    const postByChannel =
      asRecord(publishPayload.postByChannel) || asRecord(payload.postByChannel) || {};
    const canonicalPostByChannel = canonicalizeRecordForBoosterChannels(
      postByChannel,
      boosterChannels,
    );
    const images = Array.isArray(publishPayload.images)
      ? publishPayload.images.filter(Boolean)
      : Array.isArray(payload.images)
        ? payload.images.filter(Boolean)
        : [];
    const imagesByChannel =
      asRecord(publishPayload.imagesByChannel) ||
      asRecord(payload.imagesByChannel) ||
      {};
    const firstChannelImagesRaw = firstRecordValueForUiChannels(
      imagesByChannel,
      finalChannels,
    );
    const firstChannelImages = Array.isArray(firstChannelImagesRaw)
      ? firstChannelImagesRaw.filter(Boolean)
      : [];
    const video = asRecord(publishPayload.video) || asRecord(payload.video) || null;
    const firstChannelPost = asRecord(
      firstRecordValueForUiChannels(postByChannel, finalChannels),
    );
    const mediaAsset =
      video ||
      (asRecord(firstChannelImages[0]) as Record<string, unknown> | null) ||
      (asRecord(images[0]) as Record<string, unknown> | null) ||
      asRecord(firstChannelPost?.media) ||
      asRecord(firstChannelPost?.mediaAsset) ||
      asRecord(firstChannelPost?.image) ||
      asRecord(firstChannelPost?.imageAsset) ||
      null;
    const mediaHint = String(
      mediaAsset?.type || mediaAsset?.mimeType || mediaAsset?.kind || "",
    ).toLowerCase();
    const isVideo = Boolean(mediaAsset && mediaHint.includes("video"));
    const firstPost = finalChannels
      .map((channel) => recordValueForUiChannel(postByChannel, channel))
      .map((value) => {
        const record = asRecord(value);
        return record
          ? firstSafeString(record.content, record.text, record.caption, record.body, record.message)
          : safeString(value);
      })
      .find(Boolean);
    const actionPayload: Record<string, unknown> = {
      ...payload,
      ...publishPayload,
      publishPayload: {
        ...publishPayload,
        channels: boosterChannels,
        postByChannel: canonicalPostByChannel,
      },
      postByChannel: canonicalPostByChannel,
      selectedChannels: finalChannels,
      channels: finalChannels,
      boosterChannels,
      mediaAsset,
      media: mediaAsset,
      imageAsset: mediaAsset && !isVideo ? mediaAsset : images[0] || null,
      image: mediaAsset && !isVideo ? mediaAsset : images[0] || null,
      images,
      videoAsset: video || (isVideo ? mediaAsset : null),
      video: video || (isVideo ? mediaAsset : null),
      sourceScheduledActionId: scheduledAction.id,
      scheduledEditMode: true,
    };

    return {
      id: `scheduled-${scheduledAction.id}`,
      automationKey: "publish",
      actionType: "publication",
      targetTool: "booster",
      title: scheduledAction.title || "Publication programmée",
      summary:
        firstPost ||
        scheduledAction.summary ||
        "Publication programmée avec iNr’Agent.",
      previewText: firstPost || scheduledAction.summary || "",
      targetChannels: finalChannels,
      targetThemes: [],
      recipients: [],
      imageAssets: video
        ? [video]
        : firstChannelImages.length
          ? firstChannelImages
          : mediaAsset
            ? [mediaAsset]
            : images,
      payload: actionPayload,
      validationRequired: true,
      executionPolicy: "manual_validation",
      status: "pending_validation",
      scheduledFor: scheduledAction.scheduledAt,
      preparedAt: scheduledAction.createdAt || now,
      completedAt: null,
      createdAt: scheduledAction.createdAt || now,
    };
  }

  if (
    typeLabel === "Propulsion" ||
    typeLabel === "Fidélisation" ||
    typeLabel === "Mail" ||
    kind === "mail_campaign"
  ) {
    const campaign = asRecord(payload.campaign) || {};
    const metadata = asRecord(campaign.metadata) || asRecord(payload.metadata) || {};
    const recipients = Array.isArray(campaign.recipients)
      ? campaign.recipients
      : Array.isArray(payload.recipients)
        ? payload.recipients
        : [];
    const attachments = Array.isArray(campaign.attachments)
      ? campaign.attachments
      : Array.isArray(payload.attachments)
        ? payload.attachments
        : [];
    const subject = firstSafeString(
      campaign.subject,
      payload.campaignSubject,
      payload.subject,
      scheduledAction.title,
    );
    const text = firstSafeString(
      campaign.text,
      payload.campaignBody,
      payload.bodyText,
      payload.text,
      campaign.html,
      scheduledAction.summary,
    );
    const targetTool =
      scheduledAction.targetTool === "fideliser"
        ? "fideliser"
        : scheduledAction.targetTool === "mails"
          ? "mails"
          : "propulser";
    const finalAutomationKey =
      automationKey === "loyalty" || targetTool === "fideliser" ? "loyalty" : "grow";
    const actionPayload: Record<string, unknown> = {
      ...payload,
      campaign: {
        ...campaign,
        subject,
        text,
        recipients,
        attachments,
        metadata,
      },
      accountId: firstSafeString(campaign.accountId, payload.accountId),
      campaignSubject: subject,
      subject,
      campaignBody: text,
      bodyText: text,
      bodyHtml: firstSafeString(campaign.html, payload.bodyHtml, payload.html),
      recipients,
      recipientCount: recipients.length,
      folder: firstSafeString(campaign.folder, payload.folder),
      trackKind: firstSafeString(campaign.trackKind, metadata.trackKind, payload.trackKind),
      trackType: firstSafeString(campaign.trackType, metadata.trackType, payload.trackType),
      templateKey: firstSafeString(campaign.templateKey, metadata.templateKey, payload.templateKey),
      attachments,
      signatureAutomatic: metadata.signatureAutomatic !== false,
      sourceScheduledActionId: scheduledAction.id,
      scheduledEditMode: true,
    };

    return {
      id: `scheduled-${scheduledAction.id}`,
      automationKey: finalAutomationKey,
      actionType: "campaign",
      targetTool,
      title: subject || scheduledAction.title || "Campagne programmée",
      summary: text || scheduledAction.summary || "Campagne programmée avec iNr’Agent.",
      previewText: text || scheduledAction.summary || "",
      targetChannels: ["mails"],
      targetThemes: firstSafeString(actionPayload.trackType) ? [firstSafeString(actionPayload.trackType)] : [],
      recipients,
      imageAssets: [],
      payload: actionPayload,
      validationRequired: true,
      executionPolicy: "manual_validation",
      status: "pending_validation",
      scheduledFor: scheduledAction.scheduledAt,
      preparedAt: scheduledAction.createdAt || now,
      completedAt: null,
      createdAt: scheduledAction.createdAt || now,
    };
  }

  return null;
}

export function updateScheduledEditPublishText(
  action: AgentPreparedAction,
  channel: ChannelKey,
  draft: {
    title: string;
    body: string;
    cta: string;
    ctaMode: BoosterCtaMode;
    ctaUrl: string;
    ctaPhone: string;
    hashtags: string;
  },
): AgentPreparedAction {
  const displayKey = boosterDisplayKeyFromAgentChannel(channel);
  const payload = jsonClone(action.payload || {});
  const postByChannel = {
    ...(asRecord(payload.postByChannel) || {}),
  };
  const nextPost = {
    ...(asRecord(postByChannel[displayKey]) || {}),
    title: draft.title,
    content: draft.body,
    text: draft.body,
    cta: draft.cta,
    ctaMode: draft.ctaMode,
    ctaUrl: draft.ctaUrl,
    ctaPhone: draft.ctaPhone,
    hashtags: draft.hashtags.split(/[\s,;]+/).filter(Boolean),
  };
  postByChannel[displayKey] = nextPost;
  const nextPayload = { ...payload, postByChannel };
  const firstPreview = firstSafeString(draft.body, action.previewText, action.summary);
  return {
    ...action,
    summary: channel === apiChannelToUi[action.targetChannels[0] || ""] ? firstPreview : action.summary,
    previewText: firstPreview,
    payload: nextPayload,
  };
}

export function updateScheduledEditPublishMedia(
  action: AgentPreparedAction,
  channel: ChannelKey,
  media: Record<string, unknown> | null,
  requestedIndex = 0,
  mutation: PublishMediaMutation = media ? "replace" : "remove",
): AgentPreparedAction {
  const displayKey = boosterDisplayKeyFromAgentChannel(channel);
  const payload = jsonClone(action.payload || {});
  const currentPublishPayload = asRecord(payload.publishPayload) || {};
  const postByChannel = {
    ...(asRecord(payload.postByChannel) ||
      asRecord(currentPublishPayload.postByChannel) ||
      {}),
  };
  const imagesByChannel = {
    ...(asRecord(payload.imagesByChannel) ||
      asRecord(currentPublishPayload.imagesByChannel) ||
      {}),
  };
  const mediaModeByChannel = {
    ...(asRecord(payload.mediaModeByChannel) ||
      asRecord(currentPublishPayload.mediaModeByChannel) ||
      {}),
  };
  const videoSettingsByChannel = {
    ...(asRecord(payload.videoSettingsByChannel) ||
      asRecord(currentPublishPayload.videoSettingsByChannel) ||
      {}),
  };
  const videoFormatByChannel = {
    ...(asRecord(payload.videoFormatByChannel) ||
      asRecord(currentPublishPayload.videoFormatByChannel) ||
      {}),
  };
  const videoAdaptationModeByChannel = {
    ...(asRecord(payload.videoAdaptationModeByChannel) ||
      asRecord(currentPublishPayload.videoAdaptationModeByChannel) ||
      {}),
  };
  const currentPost = asRecord(postByChannel[displayKey]) || {};
  const currentImages = Array.isArray(imagesByChannel[displayKey])
    ? [...(imagesByChannel[displayKey] as unknown[])]
    : [];
  const currentMode = String(mediaModeByChannel[displayKey] || "").toLowerCase();
  const mediaAsset = media ? (media as AgentImageAsset) : null;
  const mediaUrl = imageAssetUrl(mediaAsset);
  const mediaType = firstSafeString(
    media?.type,
    media?.mimeType,
    media?.mime_type,
    media?.kind,
  );
  const mediaKind = media && mediaUrl
    ? mediaKindFromHints(mediaType, mediaUrl)
    : "none";
  let nextImages = currentImages;
  let nextVideo =
    asRecord(payload.video) || asRecord(currentPublishPayload.video) || null;

  if (mediaKind === "image" && media) {
    const channelImages = currentMode === "images" ? currentImages : [];
    if (mutation === "append") {
      nextImages = [...channelImages, media].slice(
        0,
        INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
      );
    } else {
      const replaceIndex = channelImages.length
        ? Math.min(Math.max(0, requestedIndex), channelImages.length - 1)
        : 0;
      nextImages = channelImages.length ? [...channelImages] : [];
      if (nextImages.length) nextImages[replaceIndex] = media;
      else nextImages.push(media);
    }
    imagesByChannel[displayKey] = nextImages;
    mediaModeByChannel[displayKey] = "images";
    delete videoSettingsByChannel[displayKey];
    delete videoFormatByChannel[displayKey];
    delete videoAdaptationModeByChannel[displayKey];
    postByChannel[displayKey] = {
      ...currentPost,
      media,
      mediaAsset: media,
      imageAsset: media,
      image: media,
      imageUrl: mediaUrl,
      videoAsset: null,
      video: null,
      mediaMode: "images",
    };
  } else if (mediaKind === "video" && media) {
    const originalVideo = asRecord(media.originalVideo);
    const mediaSettingsByChannel = asRecord(media.videoSettingsByChannel);
    const selectedVideoSettings =
      asRecord(mediaSettingsByChannel?.[displayKey]) ||
      asRecord(media.videoSettings);
    const transformedVariants = Array.isArray(media.transformedVariants)
      ? media.transformedVariants
      : Array.isArray(originalVideo?.transformedVariants)
        ? originalVideo.transformedVariants
        : [];

    // L'aperçu peut pointer vers la variante transformée du canal. On garde
    // toutefois la vidéo source comme racine du payload et les variantes dans
    // transformedVariants, afin de ne pas remplacer l'original pour les autres
    // canaux lors d'une simple modification de format.
    nextVideo = originalVideo
      ? {
          ...originalVideo,
          transformedVariants,
          videoSettingsByChannel:
            mediaSettingsByChannel ||
            asRecord(originalVideo.videoSettingsByChannel) ||
            {},
        }
      : media;

    if (selectedVideoSettings) {
      videoSettingsByChannel[displayKey] = selectedVideoSettings;
      const format = firstSafeString(selectedVideoSettings.format);
      const adaptationMode = firstSafeString(
        selectedVideoSettings.adaptationMode,
        selectedVideoSettings.adaptation_mode,
      );
      if (format) videoFormatByChannel[displayKey] = format;
      if (adaptationMode) {
        videoAdaptationModeByChannel[displayKey] = adaptationMode;
      }
    }
    imagesByChannel[displayKey] = [];
    mediaModeByChannel[displayKey] = "video";
    postByChannel[displayKey] = {
      ...currentPost,
      media,
      mediaAsset: media,
      imageAsset: null,
      image: null,
      imageUrl: "",
      videoAsset: media,
      video: media,
      mediaMode: "video",
    };
  } else if (!media) {
    if (currentMode === "images" && currentImages.length) {
      const removeIndex = Math.min(
        Math.max(0, requestedIndex),
        currentImages.length - 1,
      );
      nextImages = currentImages.filter((_, index) => index !== removeIndex);
      imagesByChannel[displayKey] = nextImages;
      mediaModeByChannel[displayKey] = nextImages.length ? "images" : "none";
      delete videoSettingsByChannel[displayKey];
      delete videoFormatByChannel[displayKey];
      delete videoAdaptationModeByChannel[displayKey];
      const fallbackImage = asRecord(nextImages[0]);
      postByChannel[displayKey] = {
        ...currentPost,
        media: fallbackImage,
        mediaAsset: fallbackImage,
        imageAsset: fallbackImage,
        image: fallbackImage,
        imageUrl: fallbackImage ? imageAssetUrl(fallbackImage as AgentImageAsset) : "",
        videoAsset: null,
        video: null,
        mediaMode: nextImages.length ? "images" : "none",
      };
    } else {
      imagesByChannel[displayKey] = [];
      mediaModeByChannel[displayKey] = "none";
      delete videoSettingsByChannel[displayKey];
      delete videoFormatByChannel[displayKey];
      delete videoAdaptationModeByChannel[displayKey];
      postByChannel[displayKey] = {
        ...currentPost,
        media: null,
        mediaAsset: null,
        imageAsset: null,
        image: null,
        imageUrl: "",
        videoAsset: null,
        video: null,
        mediaMode: "none",
      };
    }
  }

  const nextPublishPayload = {
    ...currentPublishPayload,
    postByChannel,
    imagesByChannel,
    mediaModeByChannel,
    videoSettingsByChannel,
    videoFormatByChannel,
    videoAdaptationModeByChannel,
    video: nextVideo,
  };
  const selectedChannelAssets =
    mediaModeByChannel[displayKey] === "video" && nextVideo
      ? [nextVideo]
      : Array.isArray(imagesByChannel[displayKey])
        ? (imagesByChannel[displayKey] as unknown[])
        : [];
  const primaryAsset = asRecord(selectedChannelAssets[0]);

  return {
    ...action,
    imageAssets: selectedChannelAssets,
    payload: {
      ...payload,
      publishPayload: nextPublishPayload,
      postByChannel,
      imagesByChannel,
      mediaModeByChannel,
      videoSettingsByChannel,
      videoFormatByChannel,
      videoAdaptationModeByChannel,
      media: primaryAsset,
      mediaAsset: primaryAsset,
      imageAsset:
        mediaModeByChannel[displayKey] === "images" ? primaryAsset : null,
      image: mediaModeByChannel[displayKey] === "images" ? primaryAsset : null,
      videoAsset: nextVideo,
      video: nextVideo,
    },
  };
}

export function updateScheduledEditCampaign(
  action: AgentPreparedAction,
  patch: Record<string, unknown>,
): AgentPreparedAction {
  const payload = jsonClone(action.payload || {});
  const campaign = {
    ...(asRecord(payload.campaign) || {}),
  };
  const editType = String(patch.editType || "");

  if (editType === "campaign_text") {
    const subject = firstSafeString(patch.subject);
    const bodyText = firstSafeString(patch.bodyText);
    campaign.subject = subject;
    campaign.text = bodyText;
    payload.campaignSubject = subject;
    payload.subject = subject;
    payload.campaignBody = bodyText;
    payload.bodyText = bodyText;
  }

  if (editType === "campaign_recipients" && Array.isArray(patch.recipients)) {
    campaign.recipients = patch.recipients;
    payload.recipients = patch.recipients;
    payload.recipientCount = patch.recipients.length;
  }

  if (editType === "campaign_mail_account") {
    const accountId = firstSafeString(patch.accountId);
    campaign.accountId = accountId;
    payload.accountId = accountId;
  }

  if (editType === "campaign_attachments" && Array.isArray(patch.attachments)) {
    campaign.attachments = patch.attachments;
    payload.attachments = patch.attachments;
  }

  payload.campaign = campaign;
  return {
    ...action,
    title: firstSafeString(payload.campaignSubject, payload.subject, action.title),
    summary: firstSafeString(payload.campaignBody, payload.bodyText, action.summary),
    previewText: firstSafeString(payload.campaignBody, payload.bodyText, action.previewText),
    recipients: Array.isArray(payload.recipients) ? payload.recipients : action.recipients,
    payload,
  };
}

export function filterRecordForScheduledChannels(
  input: unknown,
  channels: BoosterChannelKey[],
): Record<string, unknown> {
  return canonicalizeRecordForBoosterChannels(input, channels);
}

export function agentChannelsToBoosterChannels(channels: unknown): BoosterChannelKey[] {
  if (!Array.isArray(channels)) return [];
  return Array.from(
    new Set(
      channels
        .map((channel) => {
          const raw = String(channel || "").trim();
          const uiChannel = apiChannelToUi[raw] || apiChannelToUi[raw.toLowerCase()] || raw;
          return boosterChannelKeyFromAgentChannel(uiChannel as ChannelKey);
        })
        .filter(Boolean) as BoosterChannelKey[],
    ),
  );
}

export function scheduledEditUpdateFromAction(
  action: AgentPreparedAction,
  options: {
    scheduledAt?: string | null;
    channels?: BoosterChannelKey[];
  } = {},
): Record<string, unknown> {
  const payload = jsonClone(action.payload || {});
  const scheduledAt = options.scheduledAt || action.scheduledFor || null;

  if (
    action.automationKey === "publish" ||
    action.targetTool === "booster" ||
    action.actionType === "publication"
  ) {
    const publishPayload = asRecord(payload.publishPayload) || {};
    const channels = options.channels?.length
      ? options.channels
      : agentChannelsToBoosterChannels(
          payload.boosterChannels || payload.selectedChannels || payload.channels || action.targetChannels,
        );
    const uiChannels = channels
      .map((channel) => normalizeUiChannelKey(channel))
      .filter((channel): channel is ChannelKey => Boolean(channel));
    const rawPostByChannel =
      asRecord(payload.postByChannel) || asRecord(publishPayload.postByChannel) || {};
    const canonicalPostByChannel = canonicalizeRecordForBoosterChannels(
      rawPostByChannel,
      channels,
    );
    const firstPost =
      channels
        .map((channel) => asRecord(canonicalPostByChannel[channel]))
        .find((post) => post && (post.title || post.content || post.text)) ||
      asRecord(publishPayload.post) ||
      {};
    const images = Array.isArray(payload.images)
      ? payload.images
      : Array.isArray(publishPayload.images)
        ? publishPayload.images
        : [];
    const video = asRecord(payload.video) || asRecord(publishPayload.video) || null;
    const nextPublishPayload = {
      ...publishPayload,
      channels,
      post: firstPost,
      postByChannel: canonicalPostByChannel,
      idea: firstSafeString(payload.idea, publishPayload.idea, action.summary),
      mediaType: firstSafeString(
        payload.mediaType,
        publishPayload.mediaType,
        video ? "video" : "images",
      ),
      mediaModeByChannel: filterRecordForScheduledChannels(
        payload.mediaModeByChannel || publishPayload.mediaModeByChannel,
        channels,
      ),
      videoSettingsByChannel: filterRecordForScheduledChannels(
        payload.videoSettingsByChannel || publishPayload.videoSettingsByChannel,
        channels,
      ),
      videoFormatByChannel: filterRecordForScheduledChannels(
        payload.videoFormatByChannel || publishPayload.videoFormatByChannel,
        channels,
      ),
      videoAdaptationModeByChannel: filterRecordForScheduledChannels(
        payload.videoAdaptationModeByChannel ||
          publishPayload.videoAdaptationModeByChannel,
        channels,
      ),
      imageSettingsByChannel: filterRecordForScheduledChannels(
        payload.imageSettingsByChannel || publishPayload.imageSettingsByChannel,
        channels,
      ),
      imagesByChannel: filterRecordForScheduledChannels(
        payload.imagesByChannel || publishPayload.imagesByChannel,
        channels,
      ),
      images,
      video,
      workflowTool: "booster",
      workflowAction: "publier",
      source: "inr_agent",
      inrAgentActionId: firstSafeString(
        payload.sourceActionId,
        payload.inrAgentActionId,
        action.id,
      ),
    };

    return {
      title: action.title || "Publication programmée",
      summary: action.summary || action.previewText || "Publication programmée avec iNr’Agent.",
      scheduledAt,
      automationKey: "publish",
      actionType: "publication",
      targetTool: "booster",
      channels,
      payload: {
        ...payload,
        kind: "manual_publish_schedule",
        publishPayload: nextPublishPayload,
        channels,
        selectedChannels: channels,
        uiChannels,
        scheduleGrouping: {
          mode: channels.length > 1 ? "multichannel_single_action" : "single_channel",
          channelCount: channels.length,
          updatedFrom: "scheduled_edit",
        },
      },
    };
  }

  const campaign = { ...(asRecord(payload.campaign) || {}) };
  const recipients = Array.isArray(campaign.recipients)
    ? campaign.recipients
    : Array.isArray(payload.recipients)
      ? payload.recipients
      : action.recipients;
  const attachments = Array.isArray(campaign.attachments)
    ? campaign.attachments
    : Array.isArray(payload.attachments)
      ? payload.attachments
      : [];
  const subject = firstSafeString(campaign.subject, payload.campaignSubject, payload.subject, action.title);
  const body = firstSafeString(campaign.text, payload.campaignBody, payload.bodyText, action.summary);
  const targetTool =
    action.targetTool === "fideliser"
      ? "fideliser"
      : action.targetTool === "mails"
        ? "mails"
        : "propulser";
  const automationKey =
    action.automationKey === "loyalty" || targetTool === "fideliser"
      ? "loyalty"
      : "grow";

  const nextCampaign = {
    ...campaign,
    accountId: firstSafeString(campaign.accountId, payload.accountId),
    type: "mail",
    subject,
    text: body,
    html: firstSafeString(campaign.html, payload.bodyHtml, payload.html),
    recipients,
    folder: firstSafeString(campaign.folder, payload.folder),
    trackKind: firstSafeString(campaign.trackKind, payload.trackKind),
    trackType: firstSafeString(campaign.trackType, payload.trackType),
    templateKey: firstSafeString(campaign.templateKey, payload.templateKey),
    attachments,
    metadata: {
      ...(asRecord(campaign.metadata) || {}),
      source: "inr_agent",
      label: "iNr’Agent",
      automationKey,
      targetTool,
      actionType: action.actionType,
      signatureAutomatic: payload.signatureAutomatic !== false,
      updatedFrom: "scheduled_edit",
    },
  };

  return {
    title: subject || action.title || "Campagne programmée",
    summary: body || action.summary || "Campagne programmée avec iNr’Agent.",
    scheduledAt,
    automationKey,
    actionType: "campaign",
    targetTool,
    channels: ["mails"],
    payload: {
      ...payload,
      kind: "mail_campaign",
      campaign: nextCampaign,
      subject,
      campaignSubject: subject,
      bodyText: body,
      campaignBody: body,
      bodyHtml: nextCampaign.html,
      recipients,
      recipientCount: recipients.length,
      attachments,
      accountId: nextCampaign.accountId,
      folder: nextCampaign.folder,
      trackKind: nextCampaign.trackKind,
      trackType: nextCampaign.trackType,
      templateKey: nextCampaign.templateKey,
    },
  };
}

export function computeNextOccurrence(config: AutomationConfig): string | null {
  if (!config.enabled) return null;

  const weekdayMap: Record<string, number> = {
    Dimanche: 0,
    Lundi: 1,
    Mardi: 2,
    Mercredi: 3,
    Jeudi: 4,
    Vendredi: 5,
    Samedi: 6,
  };
  const normalizedSlots =
    config.frequency === "2 fois par semaine"
      ? normalizeConfigScheduleSlots(config).slice(0, 2)
      : [{ day: config.day, time: config.time }];
  const now = new Date();
  const isFirstWeekday = (date: Date, targetDay: number) =>
    date.getDay() === targetDay && date.getDate() <= 7;
  const isThirdWeekday = (date: Date, targetDay: number) =>
    date.getDay() === targetDay && date.getDate() >= 15 && date.getDate() <= 21;

  for (let offset = 0; offset <= 120; offset += 1) {
    const candidates = normalizedSlots
      .map((slot) => {
        const targetDay = weekdayMap[slot.day] ?? 1;
        const [hour, minute] = slot.time
          .split(":")
          .map((value) => Number(value || 0));
        const candidate = new Date(now.getTime());
        candidate.setSeconds(0, 0);
        candidate.setDate(candidate.getDate() + offset);
        candidate.setHours(hour, minute, 0, 0);
        if (candidate.getTime() <= now.getTime()) return null;
        const ok =
          config.frequency === "2 fois par semaine"
            ? candidate.getDay() === targetDay
            : config.frequency === "Tous les 15 jours" ||
                config.frequency === "2 fois par mois"
              ? isFirstWeekday(candidate, targetDay) ||
                isThirdWeekday(candidate, targetDay)
              : config.frequency === "Chaque mois" ||
                  config.frequency === "1 fois par mois"
                ? isFirstWeekday(candidate, targetDay)
                : config.frequency === "Chaque trimestre"
                  ? [0, 3, 6, 9].includes(candidate.getMonth()) &&
                    isFirstWeekday(candidate, targetDay)
                  : candidate.getDay() === targetDay;
        return ok ? candidate : null;
      })
      .filter((candidate): candidate is Date => Boolean(candidate))
      .sort((a, b) => a.getTime() - b.getTime());

    if (candidates[0]) return candidates[0].toISOString();
  }

  return null;
}
