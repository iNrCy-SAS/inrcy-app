import { getRestoredPublishWizardStep } from "./components/publishWizard";
import { filterMetaPilotPayload } from "@/lib/metaChannelUiAccess";
import { normalizeSiteWebPublicationPayload } from "@/lib/siteWebChannel";
import { normalizeMediaSoundtrackByChannel } from "@/lib/mediaSoundtrackSelection";
import { getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { normalizeAiPreferredEngine } from "@/lib/aiEnginePreference";
import { normalizeVideoAiContextReference, videoAiContextReferenceAliases } from "@/lib/videoAiContextReference";
import { CHANNEL_LABELS, buildVideoSettingsByChannel, normalizePost, normalizePublicationMediaType, normalizeVideoAdaptationMode, normalizeVideoFormat, type ChannelKey, type ChannelMediaMode, type VideoAdaptationMode, type VideoFormat, type BoosterVideoSourceMetadata, type VideoPayload } from "./publishModal.shared";
import { isChannelKey, isStyleKey, isThemeKey, sanitizePostsForEditor } from "./publishModal.foundations";
import { readVideoSourceMetadata } from "./publishModal.videoAiRuntime";
import { type TiktokPublicationSettings } from "./components/TiktokPublicationSettingsModal";
import { inferBoosterCreationMode } from "@/lib/boosterCreationMode";
import { normalizeThreadsPublicationMode } from "@/lib/threadsPublicationPreferences";
import { normalizeMetaPublicationSelection, type MetaPrimaryPublicationPlacement } from "@/lib/metaPublicationTargets";
import { loadMediaPublicationWorkspace } from "@/lib/mediaWorkspaceClient";
import { normalizeRestoredVideoVariants } from "./usePublishVideoController";
import { remapRestoredChannelImageEditors } from "./publishImageRecovery";
import type { LoadPublicationDraftContext, SavePublicationDraftContext } from "./publicationDraftContext";

function normalizeRestoredTiktokPublicationSettings(
  value: unknown,
): TiktokPublicationSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const privacyLevel = String(raw.privacyLevel || "").trim();
  if (!privacyLevel) return null;
  const commercialContent = ["none", "self", "branded", "both"].includes(
    String(raw.commercialContent || ""),
  )
    ? (String(raw.commercialContent) as TiktokPublicationSettings["commercialContent"])
    : "none";
  return {
    privacyLevel,
    allowComments: Boolean(raw.allowComments),
    allowDuo: Boolean(raw.allowDuo),
    allowStitch: Boolean(raw.allowStitch),
    commercialContent,
    aiContent: Boolean(raw.aiContent),
    photoAutoMusic: Boolean(raw.photoAutoMusic),
    musicUsageConfirmed: Boolean(raw.musicUsageConfirmed),
  };
}

async function restorePublicationDraftVideo(videoDraft: any): Promise<{
  file: File | null;
  previewUrl: string;
  duration: number | null;
  sourceMetadata: BoosterVideoSourceMetadata | null;
  storage: Pick<VideoPayload, "storagePath" | "publicUrl" | "url"> | null;
  transformedVariants: NonNullable<VideoPayload["transformedVariants"]>;
}> {
  const source = String(
    videoDraft?.publicUrl || videoDraft?.url || "",
  ).trim();
  if (!source)
    return {
      file: null as File | null,
      previewUrl: "",
      duration: null as number | null,
      sourceMetadata: null as BoosterVideoSourceMetadata | null,
      storage: null as Pick<
        VideoPayload,
        "storagePath" | "publicUrl" | "url"
      > | null,
      transformedVariants: [],
    };

  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error("Vidéo indisponible.");
    const blob = await response.blob();
    const name = String(videoDraft?.name || "video-inrcy.mp4");
    const type = String(videoDraft?.type || blob.type || "video/mp4");
    const lastModified = Number(videoDraft?.lastModified || Date.now());
    const file = new File([blob], name, { type, lastModified });
    const rawDuration = Number(videoDraft?.duration || 0);
    const duration =
      Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
    const sourceMetadata =
      videoDraft?.sourceMetadata &&
      typeof videoDraft.sourceMetadata === "object"
        ? (videoDraft.sourceMetadata as BoosterVideoSourceMetadata)
        : await readVideoSourceMetadata(file);
    const transformedVariants = normalizeRestoredVideoVariants(
      (videoDraft as any)?.transformedVariants,
    );
    return {
      file,
      previewUrl: URL.createObjectURL(file),
      duration: sourceMetadata?.duration ?? duration,
      sourceMetadata,
      storage: {
        storagePath: String(
          videoDraft?.storagePath || videoDraft?.path || "",
        ),
        publicUrl: source,
        url: source,
      },
      transformedVariants,
    };
  } catch {
    return {
      file: null as File | null,
      previewUrl: "",
      duration: null as number | null,
      sourceMetadata: null as BoosterVideoSourceMetadata | null,
      storage: null as Pick<
        VideoPayload,
        "storagePath" | "publicUrl" | "url"
      > | null,
      transformedVariants: normalizeRestoredVideoVariants(
        (videoDraft as any)?.transformedVariants,
      ),
    };
  }
}

export async function loadPublicationDraft(context: LoadPublicationDraftContext, isCancelled: () => boolean) {
  const {
    setDraftMessage,
    i18nT,
    setPublishError,
    publicationDraftIdParam,
    metaPilotEnabled,
    adoptMediaWorkspace,
    CHANNEL_KEYS,
    channels,
    ctaDefaults,
    legacyMediaCutoverClientAvailable,
    restorePublicationDraftImages,
    defaultAiPreferredEngine,
    instagramPublicationPreferencesRef,
    facebookPublicationPreferencesRef,
    setDocumentFiles,
    setPdfAttachmentError,
    setIdea,
    setPublicationInstruction,
    setTheme,
    setContentStyle,
    setCreationMode,
    setWizardStep,
    aiEngineRestoredFromDraftRef,
    setSelectedAiPreferredEngine,
    setCreationModeError,
    setContentWorkspaceOpen,
    setActiveCard,
    draftChannelsRestoredRef,
    setChannels,
    manuallyEditedCtaChannelsRef,
    setPostsByChannel,
    setInstagramHashtagsInput,
    setXHashtagsInput,
    threadsModeTouchedRef,
    setThreadsPublicationMode,
    instagramPlacementTouchedRef,
    setInstagramPublicationPlacement,
    setInstagramStoryEnabled,
    facebookPlacementTouchedRef,
    setFacebookPublicationPlacement,
    setFacebookStoryEnabled,
    setSoundtrackByChannel,
    setPinterestBoardId,
    setPinterestBoardName,
    setTiktokPublicationSettings,
    setShowPublicationPreview,
    setPublicationMediaType,
    setChannelMediaModes,
    setVideoFormatByChannel,
    setVideoAdaptationModeByChannel,
    setImages,
    setImagePreviews,
    setRestoredClientMediaKeysByImageKey,
    setRecoveredPreviewErrors,
    setVideoFile,
    setVideoAiContextRef,
    setVideoPreviewUrl,
    setVideoDurationSeconds,
    setVideoSourceMetadata,
    setVideoStorageContext,
    setVideoTransformedVariants,
    setVideoVariantPreparationByChannel,
    buildVideoPreparationStateFromVariants,
    setUseImagesForAI,
    setImageMetaByKey,
    setChannelImageEditors,
    setLoadedPublicationDraftId,
    setLastPublicationDraftSnapshot,
  } = context;
  setDraftMessage(i18nT("chargement_du_brouillon_4c123bfd"));
  setPublishError("");
  try {
    const response = await fetch(
      `/api/booster/events?draftId=${encodeURIComponent(publicationDraftIdParam)}`,
      {
        cache: "no-store" as any,
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        String(result?.error || "Brouillon publication introuvable."),
      );
    const payload = filterMetaPilotPayload(normalizeSiteWebPublicationPayload((result?.payload || {}) as any), metaPilotEnabled);
    adoptMediaWorkspace(
      payload.mediaWorkspaceId,
      payload.mediaWorkspaceClientKey,
    );

    const rawChannels = Array.isArray(payload.channels)
      ? payload.channels
      : [];
    const savedChannels = rawChannels
      .map((value: unknown) => String(value || ""))
      .filter(isChannelKey).filter((key: ChannelKey) => key !== "threads" || metaPilotEnabled);
    const nextChannels = CHANNEL_KEYS.reduce(
      (acc, key) => {
        acc[key] = savedChannels.length
          ? savedChannels.includes(key)
          : Boolean(channels[key]);
        return acc;
      },
      {} as Record<ChannelKey, boolean>,
    );

    const nextTheme = isThemeKey(payload.theme) ? payload.theme : "";
    const nextContentStyle = isStyleKey(payload.contentStyle)
      ? payload.contentStyle
      : "equilibre";
    const nextPostsByChannel = sanitizePostsForEditor(
      payload.postByChannel && typeof payload.postByChannel === "object"
        ? payload.postByChannel
        : {},
      ctaDefaults,
    );
    const nextEditors =
      payload.imageSettingsByChannel &&
      typeof payload.imageSettingsByChannel === "object"
        ? payload.imageSettingsByChannel
        : {};
    // Images in Idée guide generation automatically, including restored drafts.
    const nextUseImagesForAI = true;
    let imageDrafts = Array.isArray(payload.imageDrafts)
      ? payload.imageDrafts
      : [];
    let videoDraft =
      payload.videoDraft && typeof payload.videoDraft === "object"
        ? payload.videoDraft
        : null;

    const linkedWorkspaceId = String(payload.mediaWorkspaceId || "").trim();
    if (
      legacyMediaCutoverClientAvailable &&
      linkedWorkspaceId &&
      !imageDrafts.length &&
      !videoDraft
    ) {
      const snapshot = await loadMediaPublicationWorkspace({
        workspaceId: linkedWorkspaceId,
      });
      const workspaceImages = snapshot.media.filter(
        (media) => media.mediaType === "image" && Boolean(media.publicUrl),
      );
      const workspaceVideo = snapshot.media.find(
        (media) => media.mediaType === "video" && Boolean(media.publicUrl),
      );
      imageDrafts = workspaceImages.map((media) => {
        const keyParts = String(media.clientMediaKey || "").split(":");
        const lastModified = Number(keyParts[keyParts.length - 1] || 0);
        return {
          name: media.fileName,
          type: media.mimeType,
          size: media.sizeBytes,
          clientMediaKey: media.clientMediaKey,
          requiresCanonical: media.requiresCanonical === true,
          lastModified:
            Number.isFinite(lastModified) && lastModified > 0
              ? lastModified
              : Date.now(),
          storagePath: media.storagePath,
          publicUrl: media.publicUrl,
        };
      });
      if (workspaceVideo) {
        const keyParts = String(workspaceVideo.clientMediaKey || "").split(":");
        const lastModified = Number(keyParts[keyParts.length - 1] || 0);
        videoDraft = {
          name: workspaceVideo.fileName,
          type: workspaceVideo.mimeType,
          size: workspaceVideo.sizeBytes,
          lastModified:
            Number.isFinite(lastModified) && lastModified > 0
              ? lastModified
              : Date.now(),
          duration: workspaceVideo.durationSeconds,
          storagePath: workspaceVideo.storagePath,
          publicUrl: workspaceVideo.publicUrl,
          url: workspaceVideo.publicUrl,
          sourceMetadata: {
            width: workspaceVideo.width,
            height: workspaceVideo.height,
            duration: workspaceVideo.durationSeconds,
          },
        };
      }
    }
    const nextVideoAiContextRef =
      normalizeVideoAiContextReference(payload.videoAiContextRef) ||
      normalizeVideoAiContextReference(videoDraft?.videoAiContextRef);
    const nextMediaType = normalizePublicationMediaType(payload.mediaType);
    const nextChannelMediaModes =
      payload.channelMediaModes &&
      typeof payload.channelMediaModes === "object"
        ? (payload.channelMediaModes as Partial<
            Record<ChannelKey, ChannelMediaMode>
          >)
        : {};
    const nextVideoFormatByChannel =
      payload.videoFormatByChannel &&
      typeof payload.videoFormatByChannel === "object"
        ? (Object.fromEntries(
            Object.entries(
              payload.videoFormatByChannel as Record<string, unknown>,
            )
              .filter(([channel]) => isChannelKey(channel))
              .map(([channel, value]) => [
                channel,
                normalizeVideoFormat(channel as ChannelKey, value),
              ]),
          ) as Partial<Record<ChannelKey, VideoFormat>>)
        : {};
    const rawVideoSettingsByChannel =
      payload.videoSettingsByChannel &&
      typeof payload.videoSettingsByChannel === "object"
        ? payload.videoSettingsByChannel
        : null;
    const nextVideoAdaptationModeByChannel =
      payload.videoAdaptationModeByChannel &&
      typeof payload.videoAdaptationModeByChannel === "object"
        ? (Object.fromEntries(
            Object.entries(
              payload.videoAdaptationModeByChannel as Record<
                string,
                unknown
              >,
            )
              .filter(([channel]) => isChannelKey(channel))
              .map(([channel, value]) => [
                channel,
                normalizeVideoAdaptationMode(value),
              ]),
          ) as Partial<Record<ChannelKey, VideoAdaptationMode>>)
        : {};
    const nextCanonicalVideoSettingsByChannel = buildVideoSettingsByChannel(
      {
        channels: CHANNEL_KEYS,
        videoSettingsByChannel: rawVideoSettingsByChannel,
        videoFormatByChannel: nextVideoFormatByChannel,
        videoAdaptationModeByChannel: nextVideoAdaptationModeByChannel,
      },
    );
    const nextCanonicalVideoFormatByChannel = Object.fromEntries(
      Object.entries(nextCanonicalVideoSettingsByChannel).map(
        ([channel, settings]) => [channel, settings?.format],
      ),
    ) as Partial<Record<ChannelKey, VideoFormat>>;
    const nextCanonicalVideoAdaptationModeByChannel = Object.fromEntries(
      Object.entries(nextCanonicalVideoSettingsByChannel).map(
        ([channel, settings]) => [channel, settings?.adaptationMode],
      ),
    ) as Partial<Record<ChannelKey, VideoAdaptationMode>>;
    const {
      restoredFiles,
      restoredPreviews,
      restoredMeta,
      restoredClientMediaKeysByImageKey,
      restoredImageKeyRemap,
    } =
      await restorePublicationDraftImages(imageDrafts, payload.imageInteractionsByKey);
    const restoredEditors = remapRestoredChannelImageEditors(
      nextEditors,
      restoredImageKeyRemap,
    );
    const restoredVideo = videoDraft
      ? await restorePublicationDraftVideo(videoDraft)
      : {
          file: null as File | null,
          previewUrl: "",
          duration: null as number | null,
          sourceMetadata: null as BoosterVideoSourceMetadata | null,
          storage: null as Pick<
            VideoPayload,
            "storagePath" | "publicUrl" | "url"
          > | null,
          transformedVariants: [] as NonNullable<
            VideoPayload["transformedVariants"]
          >,
        };

    if (isCancelled()) return;

    const nextIdea = String(payload.idea || "");
    const nextPublicationInstruction = String(
      payload.publicationInstruction || "",
    );
    const nextInstagramHashtags =
      String(payload.instagramHashtagsInput || "") ||
      (Array.isArray((nextPostsByChannel as any)?.instagram?.hashtags)
        ? (nextPostsByChannel as any).instagram.hashtags.join(" ")
        : "");
    const nextXHashtags = String(payload.xHashtagsInput || "");
    const hasDraftAiEngine = Boolean(
      String(payload.aiPreferredEngine || "").trim(),
    );
    const nextAiPreferredEngine = hasDraftAiEngine
      ? normalizeAiPreferredEngine(payload.aiPreferredEngine)
      : defaultAiPreferredEngine;
    const nextTiktokPublicationSettings =
      normalizeRestoredTiktokPublicationSettings(
        payload.tiktokPublicationSettings,
      );
    const nextActiveCard = isChannelKey(payload.activeCard) && CHANNEL_KEYS.includes(payload.activeCard)
      ? payload.activeCard
      : "site_web";
    const nextThreadsPublicationMode = normalizeThreadsPublicationMode(payload.threadsPublicationSettings?.mode);
    const restoredInstagramSelection = normalizeMetaPublicationSelection(
      payload.instagramPublicationSettings || {
        placement: payload.instagramPublicationPlacement,
        includeStory: payload.instagramStoryEnabled,
      },
    );
    const nextInstagramPublicationPlacement: MetaPrimaryPublicationPlacement =
      restoredInstagramSelection.primaryPlacement === "reel" &&
      instagramPublicationPreferencesRef.current.reelsEnabled
        ? "reel"
        : restoredInstagramSelection.primaryPlacement === "story" &&
            instagramPublicationPreferencesRef.current.storiesEnabled
          ? "story"
          : "classic";
    const nextInstagramStoryEnabled =
      restoredInstagramSelection.primaryPlacement !== "story" &&
      restoredInstagramSelection.includeStory &&
      instagramPublicationPreferencesRef.current.storiesEnabled;
    const restoredFacebookSelection = normalizeMetaPublicationSelection(
      payload.facebookPublicationSettings || {
        placement: payload.facebookPublicationPlacement,
        includeStory: payload.facebookStoryEnabled,
      },
    );
    const nextFacebookPublicationPlacement: MetaPrimaryPublicationPlacement =
      restoredFacebookSelection.primaryPlacement === "reel" &&
      facebookPublicationPreferencesRef.current.reelsEnabled
        ? "reel"
        : restoredFacebookSelection.primaryPlacement === "story" &&
            facebookPublicationPreferencesRef.current.storiesEnabled
          ? "story"
          : "classic";
    const nextFacebookStoryEnabled =
      restoredFacebookSelection.primaryPlacement !== "story" &&
      restoredFacebookSelection.includeStory &&
      facebookPublicationPreferencesRef.current.storiesEnabled;
    const nextSoundtrackByChannel = normalizeMediaSoundtrackByChannel(payload.soundtrackByChannel, payload.soundtrackId);
    const nextPinterestBoardId = String(
      payload.pinterestBoardId || "",
    ).trim();
    const nextPinterestBoardName = String(
      payload.pinterestBoardName || "",
    ).trim();
    const nextCreationMode = inferBoosterCreationMode({
      explicitMode: payload.creationMode,
      idea: nextIdea,
      publicationInstruction: nextPublicationInstruction,
      theme: nextTheme,
      contentStyle: nextContentStyle,
      postsByChannel: nextPostsByChannel,
    });

    // Le PDF sert uniquement de contexte à la génération courante. Il n'est
    // jamais sérialisé dans un brouillon ni réutilisé entre deux brouillons.
    setDocumentFiles([]);
    setPdfAttachmentError("");
    setIdea(nextIdea);
    setPublicationInstruction(nextPublicationInstruction);
    setTheme(nextTheme);
    setContentStyle(nextContentStyle);
    setCreationMode(nextCreationMode);
    setWizardStep(getRestoredPublishWizardStep(nextCreationMode, Object.values(nextPostsByChannel).some((post) => {
      const normalized = normalizePost(post);
      return Boolean(normalized.title.trim() || normalized.content.trim());
    })));
    aiEngineRestoredFromDraftRef.current = hasDraftAiEngine;
    setSelectedAiPreferredEngine(nextAiPreferredEngine);
    setCreationModeError("");
    setContentWorkspaceOpen(
      typeof payload.contentWorkspaceOpen === "boolean"
        ? payload.contentWorkspaceOpen
        : nextCreationMode === "manual" ||
            Object.values(nextPostsByChannel).some((post) => {
              const normalized = normalizePost(post);
              return Boolean(
                normalized.title.trim() || normalized.content.trim(),
              );
            }),
    );
    setActiveCard(nextActiveCard);
    draftChannelsRestoredRef.current = true;
    setChannels(nextChannels);
    for (const key of CHANNEL_KEYS) {
      if (nextPostsByChannel[key]?.ctaMode === "none") {
        manuallyEditedCtaChannelsRef.current.add(key);
      }
    }
    setPostsByChannel(nextPostsByChannel);
    setInstagramHashtagsInput(nextInstagramHashtags);
    setXHashtagsInput(nextXHashtags);
    threadsModeTouchedRef.current = true;
    setThreadsPublicationMode(nextThreadsPublicationMode);
    instagramPlacementTouchedRef.current = true;
    setInstagramPublicationPlacement(nextInstagramPublicationPlacement);
    setInstagramStoryEnabled(nextInstagramStoryEnabled);
    facebookPlacementTouchedRef.current = true;
    setFacebookPublicationPlacement(nextFacebookPublicationPlacement);
    setFacebookStoryEnabled(nextFacebookStoryEnabled);
    setSoundtrackByChannel(nextSoundtrackByChannel);
    setPinterestBoardId(nextPinterestBoardId);
    setPinterestBoardName(nextPinterestBoardName);
    setTiktokPublicationSettings(nextTiktokPublicationSettings);
    setShowPublicationPreview(Boolean(payload.showPublicationPreview));
    const effectiveMediaType = restoredVideo.file ? "video" : nextMediaType;
    setPublicationMediaType(effectiveMediaType);
    setChannelMediaModes(nextChannelMediaModes);
    setVideoFormatByChannel(nextCanonicalVideoFormatByChannel);
    setVideoAdaptationModeByChannel(
      nextCanonicalVideoAdaptationModeByChannel,
    );
    setImages(restoredFiles);
    setImagePreviews(restoredPreviews);
    setRestoredClientMediaKeysByImageKey(restoredClientMediaKeysByImageKey);
    setRecoveredPreviewErrors({});
    setVideoFile(restoredVideo.file);
    setVideoAiContextRef(restoredVideo.file ? nextVideoAiContextRef : null);
    setVideoPreviewUrl(restoredVideo.previewUrl);
    setVideoDurationSeconds(restoredVideo.duration);
    setVideoSourceMetadata(restoredVideo.sourceMetadata || null);
    setVideoStorageContext(restoredVideo.storage);
    setVideoTransformedVariants(restoredVideo.transformedVariants);
    const selectedDraftChannels = Object.entries(nextChannels)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key as ChannelKey);
    setVideoVariantPreparationByChannel(
      buildVideoPreparationStateFromVariants({
        channels: selectedDraftChannels,
        mediaModeByChannel: nextChannelMediaModes,
        variants: restoredVideo.transformedVariants,
        settingsByChannel: nextCanonicalVideoSettingsByChannel,
      }),
    );
    setUseImagesForAI(nextUseImagesForAI);
    setImageMetaByKey(restoredMeta);
    setChannelImageEditors(restoredEditors);
    setLoadedPublicationDraftId(publicationDraftIdParam);
    setDraftMessage(i18nT("brouillon_charge_f9b9174c"));

    const imageNames = restoredFiles.map((file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
    }));
    const videoName = restoredVideo.file
      ? {
          name: restoredVideo.file.name,
          type: restoredVideo.file.type,
          size: restoredVideo.file.size,
          duration: restoredVideo.duration,
          sourceMetadata: restoredVideo.sourceMetadata || null,
        }
      : null;
    setLastPublicationDraftSnapshot(
      JSON.stringify({
        creationMode: nextCreationMode,
        mediaType: effectiveMediaType,
        channelMediaModes: nextChannelMediaModes,
        videoFormatByChannel: nextCanonicalVideoFormatByChannel,
        videoAdaptationModeByChannel:
          nextCanonicalVideoAdaptationModeByChannel,
        videoSettingsByChannel: nextCanonicalVideoSettingsByChannel,
        idea: nextIdea.trim(),
        publicationInstruction: nextPublicationInstruction.trim(),
        theme: nextTheme,
        contentStyle: nextContentStyle,
        channels: selectedDraftChannels,
        postsByChannel: nextPostsByChannel,
        aiPreferredEngine: nextAiPreferredEngine,
        activeCard: nextActiveCard,
        contentWorkspaceOpen:
          typeof payload.contentWorkspaceOpen === "boolean"
            ? payload.contentWorkspaceOpen
            : nextCreationMode === "manual" ||
              Object.values(nextPostsByChannel).some((post) => {
                const normalized = normalizePost(post);
                return Boolean(
                  normalized.title.trim() || normalized.content.trim(),
                );
              }),
        instagramHashtagsInput: nextInstagramHashtags,
        xHashtagsInput: nextXHashtags,
        threadsPublicationSettings: { mode: nextThreadsPublicationMode },
        instagramPublicationPlacement:
          nextInstagramPublicationPlacement,
        instagramStoryEnabled: nextInstagramStoryEnabled,
        facebookPublicationPlacement:
          nextFacebookPublicationPlacement,
        facebookStoryEnabled: nextFacebookStoryEnabled,
        soundtrackByChannel: nextSoundtrackByChannel,
        pinterestBoardId: nextPinterestBoardId,
        pinterestBoardName: nextPinterestBoardName,
        tiktokPublicationSettings: nextTiktokPublicationSettings,
        showPublicationPreview: Boolean(payload.showPublicationPreview),
        imageNames,
        videoName,
        videoTransformedVariants: restoredVideo.transformedVariants,
        videoAiContextRef: nextVideoAiContextRef,
        useImagesForAI: nextUseImagesForAI,
        imageSettingsByChannel: restoredEditors,
      }),
    );
  } catch (error) {
    if (isCancelled()) return;
    setPublishError(
      getSimpleFrenchErrorMessage(error, i18nT("publication_draft_load_failed")),
    );
    setDraftMessage("");
  }

}

export async function savePublicationDraft(context: SavePublicationDraftContext, options?: { updateRoute?: boolean }): Promise<string | null> {
  const {
    saving,
    draftSaving,
    voiceInputBusy,
    setPublishError,
    setDraftMessage,
    hasDraftablePublicationContent,
    i18nT,
    scrollToPublishArea,
    selectedChannels,
    filterPostsForSelectedChannels,
    buildPreparedPostsByChannel,
    images,
    videoFile,
    videoDurationSeconds,
    setDraftSaving,
    mediaPipelineCutoverEnabled,
    mediaWorkspaceId,
    uploadPublicationDraftImages,
    buildPublicationDraftVideoPayload,
    lastSavedStudioVideoDraftRef,
    videoAiContextRef,
    loadedPublicationDraftId,
    publicationDraftIdParam,
    creationMode,
    soundtrackByChannel,
    mediaWorkspaceClientKey,
    idea,
    publicationInstruction,
    theme,
    contentStyle,
    selectedAiPreferredEngine,
    activeCard,
    contentWorkspaceOpen,
    channelMediaModes,
    videoFormatByChannel,
    videoAdaptationModeByChannel,
    videoSettingsByChannel,
    videoSourceMetadata,
    imageMetaByKey,
    useImagesForAI,
    getDraftImageSettingsByChannel,
    threadsPublicationMode,
    instagramHashtagsInput,
    xHashtagsInput,
    instagramPublicationPlacement,
    instagramStoryEnabled,
    facebookPublicationPlacement,
    facebookStoryEnabled,
    pinterestBoardId,
    pinterestBoardName,
    tiktokPublicationSettings,
    showPublicationPreview,
    setVideoStorageContext,
    setVideoTransformedVariants,
    setVideoVariantPreparationByChannel,
    buildVideoPreparationStateFromVariants,
    linkPersistentWorkspaceDraft,
    setLoadedPublicationDraftId,
    router,
    setLastPublicationDraftSnapshot,
    currentPublicationDraftSnapshot,
  } = context;
  if (saving || draftSaving || voiceInputBusy) return null;

  setPublishError("");
  setDraftMessage("");

  if (!hasDraftablePublicationContent) {
    setPublishError(
      i18nT("ajoutez_un_contenu_ou_un_media_b14123ad"),
    );
    scrollToPublishArea("smooth");
    return null;
  }

  if (!selectedChannels.length) {
    setPublishError(
      i18nT("selectionnez_au_moins_1_canal_avant_ce44da85"),
    );
    scrollToPublishArea("smooth");
    return null;
  }

  const preparedPostsByChannel = filterPostsForSelectedChannels(
    buildPreparedPostsByChannel(),
    selectedChannels,
  );
  const imageNames = images.map((file) => ({
    name: file.name,
    type: file.type,
    size: file.size,
  }));
  const videoName = videoFile
    ? {
        name: videoFile.name,
        type: videoFile.type,
        size: videoFile.size,
        duration: videoDurationSeconds,
      }
    : null;
  const channelLabels = selectedChannels
    .map((channel) => CHANNEL_LABELS[channel] || channel)
    .join(" / ");
  const firstTitle = selectedChannels
    .map((channel) =>
      String(preparedPostsByChannel[channel]?.title || "").trim(),
    )
    .find(Boolean);
  const firstContent = selectedChannels
    .map((channel) =>
      String(preparedPostsByChannel[channel]?.content || "").trim(),
    )
    .find(Boolean);

  setDraftSaving(true);
  try {
    setDraftMessage(videoFile ? "Sauvegarde vidéo…" : "Enregistrement…");
    const imageDrafts =
      images.length && !(mediaPipelineCutoverEnabled && mediaWorkspaceId)
        ? await uploadPublicationDraftImages()
        : [];
    const rawVideoDraft = mediaPipelineCutoverEnabled && mediaWorkspaceId
      ? null
      : await buildPublicationDraftVideoPayload();
    lastSavedStudioVideoDraftRef.current = rawVideoDraft;
    const videoDraft = rawVideoDraft
      ? {
          ...rawVideoDraft,
          ...videoAiContextReferenceAliases(videoAiContextRef),
        }
      : null;
    const response = await fetch("/api/booster/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "publish_draft",
        draftId:
          loadedPublicationDraftId || publicationDraftIdParam || undefined,
        payload: {
          status: "draft",
          creationMode,
          soundtrackByChannel,
          mediaWorkspaceId,
          mediaWorkspaceClientKey,
          mediaPipelineCutoverV1: mediaPipelineCutoverEnabled,
          title: firstTitle || "Brouillon publication",
          preview: firstContent || idea.trim() || channelLabels,
          content: firstContent || "",
          idea: idea.trim(),
          publicationInstruction: publicationInstruction.trim(),
          theme,
          contentStyle,
          aiPreferredEngine: selectedAiPreferredEngine,
          activeCard,
          contentWorkspaceOpen,
          channel: channelLabels,
          channels: selectedChannels,
          postByChannel: preparedPostsByChannel,
          mediaType: videoFile ? "video" : "images",
          channelMediaModes,
          videoFormatByChannel,
          videoAdaptationModeByChannel,
          videoSettingsByChannel,
          imageNames: imageNames,
          videoName: videoName,
          videoSourceMetadata,
          imageDrafts,
          imageInteractionsByKey: Object.fromEntries(
            Object.entries(imageMetaByKey)
              .filter(([, meta]) => meta.interactions)
              .map(([key, meta]) => [key, meta.interactions]),
          ),
          videoDraft,
          ...videoAiContextReferenceAliases(videoAiContextRef),
          useImagesForAI,
          imageSettingsByChannel: getDraftImageSettingsByChannel(),
          threadsPublicationSettings: { mode: threadsPublicationMode },
          instagramHashtagsInput,
          xHashtagsInput,
          instagramPublicationPlacement,
          instagramStoryEnabled,
          facebookPublicationPlacement,
          facebookStoryEnabled,
          pinterestBoardId,
          pinterestBoardName,
          tiktokPublicationSettings,
          showPublicationPreview,
          saved_at: new Date().toISOString(),
        },
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        String(
          result?.error ||
            "Impossible d’enregistrer le brouillon publication.",
        ),
      );
    }
    const savedDraftId = String(
      result?.id || loadedPublicationDraftId || publicationDraftIdParam || "",
    ).trim();
    if (videoDraft) {
      const draftVariants = normalizeRestoredVideoVariants(
        (videoDraft as any).transformedVariants,
      );
      setVideoStorageContext({
        storagePath: videoDraft.storagePath || "",
        publicUrl: videoDraft.publicUrl || videoDraft.url || "",
        url: videoDraft.url || videoDraft.publicUrl || "",
      });
      if (draftVariants.length) {
        setVideoTransformedVariants(draftVariants);
        setVideoVariantPreparationByChannel((prev) => ({
          ...prev,
          ...buildVideoPreparationStateFromVariants({
            channels: selectedChannels,
            mediaModeByChannel: channelMediaModes,
            variants: draftVariants,
          }),
        }));
      }
    }
    if (savedDraftId) {
      await linkPersistentWorkspaceDraft(savedDraftId).catch((error) => {
        console.warn("[media-pipeline] workspace draft link skipped", error);
      });
      setLoadedPublicationDraftId(savedDraftId);
      if (options?.updateRoute !== false) {
        router.replace(
          `/dashboard?action=publish&draftId=${encodeURIComponent(savedDraftId)}`,
          { scroll: false },
        );
      }
    }
    setLastPublicationDraftSnapshot(currentPublicationDraftSnapshot);
    // Saving a draft does not end the publication or disable its exit guard.
    // Local documents are still protected by the editor's workspace state.
    setDraftMessage(i18nT("brouillon_enregistre_5b3c3ae3"));
    return savedDraftId || null;
  } catch (e) {
    setPublishError(
      getSimpleFrenchErrorMessage(e, i18nT("publication_draft_save_failed")),
    );
    return null;
  } finally {
    setDraftSaving(false);
  }

}
