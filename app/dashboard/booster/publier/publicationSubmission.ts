import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { type PublishExecutionSummary } from "../../_components/PublishExecutionResultModal";
import { getPublicationDestinationStatus, type PublicationProgressDestination } from "../../_components/PublishExecutionProgress";
import { mergePreflightFailuresIntoPublicationSummary } from "@/lib/boosterPublicationOutcome";
import { buildStorySequenceResumeByChannel, isRetryablePublicationEntry } from "@/lib/publicationStorySequenceRetry";
import { postBoosterScheduledAction } from "@/lib/boosterScheduleClient";
import { getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { mapProgressRange, resolvePublicationBilanProgress } from "@/lib/boosterProgressPhases";
import type { BoosterPublishProgressUpdate } from "@/lib/boosterPublishClient";
import { isBoosterPublicationPendingStatus } from "@/lib/boosterPublicationStatus";
import { CHANNEL_LABELS, clampPercent, getAutomaticVideoSettingsForPublication, uploadPreparedImages, type ChannelImagePayload, type ChannelImageSettingsPayload, type ChannelKey, type ChannelMediaMode, type ChannelPost, type VideoAdaptationMode, type VideoFormat, type ImagePayload } from "./publishModal.shared";
import { EMPTY_CHANNEL_DETAILS, normalizeExternalHref, type PendingImmediatePublishAfterSchedule } from "./publishModal.foundations";
import { type TiktokPublicationSettings } from "./components/TiktokPublicationSettingsModal";
import { type PublishScheduleSelection } from "./components/PublishScheduleModal";
import { buildMetaPublicationSelection } from "@/lib/metaPublicationTargets";
import { MEDIA_WORKSPACE_READINESS_TIMEOUT_MS } from "@/lib/mediaWorkspaceTimeout";
import { buildChannelRecord, buildChannelUnknownRecord, mergeRetriedPublicationSummary } from "./publicationSubmissionPayload";
import type { PublicationSubmissionContext } from "./publicationSubmissionContext";

const BOOSTER_PUBLISH_VISIBLE_CAP_MS = 60_000;
const BOOSTER_PUBLISH_WITH_MEDIA_FINALIZATION_VISIBLE_CAP_MS = 90_000;

/** Own the publish/schedule workflows together, including retry and explicit
 * scheduled-to-immediate chaining. Read the render snapshot only at invocation. */
export function createPublicationSubmission(readContext: () => PublicationSubmissionContext) {
  const runPublish = async (options?: {
    skipEmptyContentWarnings?: boolean;
    preparedPostsByChannel?: Partial<Record<ChannelKey, ChannelPost>>;
    tiktokPublicationSettings?: TiktokPublicationSettings | null;
    channels?: ChannelKey[];
    closeOnSuccess?: boolean;
    suppressPublishSuccess?: boolean;
    throwOnError?: boolean;
    retryPreviousSummary?: PublishExecutionSummary;
  }) => {
    const context = readContext();
    const {
      saving,
      draftSaving,
      voiceInputBusy,
      publishStartGuardRef,
      authoritativeChannelsRef,
      connectedChannelsScopeRef,
      activeAccountId,
      i18nT,
      publicationActorScopeRef,
      actorUserId,
      latestPublicationSummaryRef,
      selectedChannels,
      phasedPublicationProgressRef,
      facebookPublicationPlacement,
      facebookStoryEnabled,
      pinterestBoardId,
      creationMode,
      idea,
      theme,
      tiktokPublicationSettings,
      threadsPublicationMode,
      instagramPublicationPlacement,
      instagramStoryEnabled,
      pinterestBoardName,
      channelDetails,
    } = context.state;
    const {
      persistentMediaWorkspaceEnabled,
      mediaPipelineCutoverEnabled,
      images,
      videoFile,
      videoSettingsByChannel,
      videoDurationSeconds,
      videoSourceMetadata,
      persistentMediaSynchronizing,
      persistentMediaStates,
      videoVariantPreparationByChannel,
      channelImageEditors,
      imageMetaByKey,
      unifiedMediaConsumptionClientAvailable,
      mediaWorkspaceClientKey,
      videoFormatByChannel,
      videoAdaptationModeByChannel,
    } = context.media;
    const {
      buildPreparedPostsByChannel,
      getImagePreparationIssue,
      resolveChannelMediaMode,
      waitForPersistentWorkspaceIdle,
      buildFinalReviewItems,
      waitForPersistentWorkspaceReadiness,
      buildChannelImageSettingsPayload,
      buildChannelImagesPayload,
      uploadOriginalImagesForPublication,
      uploadPublicationVideoForPublish,
      preparePublicationVideoVariants,
      getPublicationSoundtracks,
      filterPostsForSelectedChannels,
    } = context.preparation;
    const {
      setPublishError,
      setDraftMessage,
      setImgError,
      setPublishProgress,
      setPublishProgressLabel,
      resetPublicationProgressPhases,
      scrollToPublishArea,
      setPublicationDestinations,
      setSaving,
      setPublicationProgressPhase,
      setPostsByChannel,
      setPendingPublishPosts,
      setEmptyContentWarningChannels,
      setEmptyContentWarningIndex,
      closeEmptyContentWarnings,
      trackEvent,
      completePublicationProgress,
      onUnsavedChange,
      setChannelDetails,
      archivePersistentMediaWorkspace,
      onPublishSuccess,
      onClose,
    } = context.actions;
    if (
      saving ||
      draftSaving ||
      voiceInputBusy ||
      publishStartGuardRef.current
    ) return;
    if (!authoritativeChannelsRef.current || connectedChannelsScopeRef.current !== (getActiveBrowserUserId() || activeAccountId || null)) {
      setPublishError(i18nT("connections_loading"));
      return;
    }
    const publishAccountId = getActiveBrowserUserId() || activeAccountId || null;
    const isCurrentPublishScope = () => publicationActorScopeRef.current.actorUserId === actorUserId && publicationActorScopeRef.current.accountId === publishAccountId &&
      (getActiveBrowserUserId() || activeAccountId || null) === publishAccountId;
    if (!isCurrentPublishScope()) return;
    if (!options?.retryPreviousSummary) latestPublicationSummaryRef.current = null;
    const publishStartedAt = Date.now();
    const preparedPostsByChannel =
      options?.preparedPostsByChannel || buildPreparedPostsByChannel();
    const publishTargetChannels = Array.from(
      new Set(
        options?.channels !== undefined ? options.channels : selectedChannels,
      ),
    ).filter((channel): channel is ChannelKey => Boolean(channel));

    setPublishError("");
    setDraftMessage("");
    setImgError("");
    setPublishProgress(0);
    setPublishProgressLabel("");
    resetPublicationProgressPhases();
    scrollToPublishArea("smooth");

    if (!publishTargetChannels.length) {
      setPublishError(i18nT("selectionnez_au_moins_1_canal_ccf98c0c"));
      return;
    }
    const imagePreparationIssue = getImagePreparationIssue(publishTargetChannels);
    if (imagePreparationIssue) {
      setPublishError(imagePreparationIssue);
      return;
    }

    publishStartGuardRef.current = true;
    phasedPublicationProgressRef.current = true;
    setPublicationDestinations((current) => {
      const destinations = options?.retryPreviousSummary && current.length
        ? current
        : publishTargetChannels.map((key) => ({ key, label: CHANNEL_LABELS[key] }));
      return destinations.map<PublicationProgressDestination>((destination) => {
        if (publishTargetChannels.includes(destination.key as ChannelKey)) return { ...destination, status: "pending", details: undefined, href: undefined };
        const previousEntry = options?.retryPreviousSummary?.entries?.find((entry) => entry.channel === destination.key);
        return previousEntry ? { ...destination, status: getPublicationDestinationStatus(previousEntry) } : destination;
      });
    });
    setSaving(true);
    setPublicationProgressPhase(
      "verification",
      i18nT("publication_request_received"),
      5,
    );
    let publishDispatchStarted = false;
    let publicationFinalWaitTimeoutId: number | null = null;

    try {
      setPublicationProgressPhase(
        "channel_verification",
        i18nT("publication_checking_channels"),
        11,
      );
      const requestedWorkspaceMediaTypes = [
        ...(publishTargetChannels.some(
          (channel) => resolveChannelMediaMode(channel) === "images",
        )
          ? (["image"] as const)
          : []),
        ...(publishTargetChannels.some(
          (channel) => resolveChannelMediaMode(channel) === "video",
        )
          ? (["video"] as const)
          : []),
      ];
      const settledWorkspaceStates = persistentMediaWorkspaceEnabled
        ? await waitForPersistentWorkspaceIdle(
            (progress, label) => {
              setPublicationProgressPhase(
                "media_verification",
                label || i18nT("publication_checking_media"),
                mapProgressRange(progress, 0, 100, 13, 21),
              );
            },
            {
              mediaTypes: requestedWorkspaceMediaTypes,
              tolerateFailures: true,
            },
          )
        : undefined;
      const reviewItems = buildFinalReviewItems(
        preparedPostsByChannel,
        publishTargetChannels,
        settledWorkspaceStates,
      );
      setPublicationProgressPhase(
        "media_verification",
        i18nT("publication_channels_media_verified"),
        21,
      );
    const preflightFailedChannels = reviewItems
      .filter((item) => item.blockers.length > 0)
      .map((item) => ({
        channel: item.channel,
        label: item.label,
        blockers: item.blockers,
        code: item.blockerCodes?.[0] || "prepublish_validation_failed",
      }));

    const publishableChannels = reviewItems
      .filter((item) => item.blockers.length === 0)
      .map((item) => item.channel);

    if (!publishableChannels.length) {
      setPublishError(
        i18nT("aucun_canal_n_est_pret_corrigez_89c1e7f2"),
      );
      return;
    }

    const clientPreflightFailuresByChannel = Object.fromEntries(
      preflightFailedChannels.map((failure) => [
        failure.channel,
        {
          code: String(failure.code || "prepublish_validation_failed").slice(
            0,
            100,
          ),
          error: String(
            failure.blockers?.[0] || "Ce canal n'est pas prêt à publier.",
          ).slice(0, 600),
          retryable: false,
        },
      ]),
    );
    const publishTargetMediaModeByChannel = Object.fromEntries(
      publishTargetChannels.map((channel) => [
        channel,
        resolveChannelMediaMode(channel),
      ]),
    ) as Partial<Record<ChannelKey, ChannelMediaMode>>;
    const publishMediaModeByChannel = Object.fromEntries(
      publishableChannels.map((channel) => [
        channel,
        resolveChannelMediaMode(channel),
      ]),
    ) as Partial<Record<ChannelKey, ChannelMediaMode>>;
    const hasAnyVideoPublish = publishableChannels.some(
      (channel) => publishMediaModeByChannel[channel] === "video",
    );
    const hasAnyImagePublish = publishableChannels.some(
      (channel) => publishMediaModeByChannel[channel] === "images",
    );
    const pendingMediaPreparationLabel = "Préparation des médias";
    const requiredPublishMediaTypes = [
      ...(hasAnyImagePublish ? (["image"] as const) : []),
      ...(hasAnyVideoPublish ? (["video"] as const) : []),
    ];
    const publishWorkspaceReadinessTimeoutMs =
      MEDIA_WORKSPACE_READINESS_TIMEOUT_MS;
    // Les deux familles coexistent dans le workspace. Leur présence réelle,
    // et non le dernier onglet média activé, décide si un fallback est requis.
    const workspaceCarriesImagesForPublish =
      mediaPipelineCutoverEnabled && images.length > 0;
    const workspaceCarriesVideoForPublish =
      mediaPipelineCutoverEnabled && Boolean(videoFile);
    const shouldBuildImageFallbackPayload =
      hasAnyImagePublish && !workspaceCarriesImagesForPublish;
    const shouldBuildVideoFallbackPayload =
      hasAnyVideoPublish && !workspaceCarriesVideoForPublish;
    const publishTargetVideoSettingsByChannel = Object.fromEntries(
      publishTargetChannels.map((channel) => [
        channel,
        getAutomaticVideoSettingsForPublication({
          channel,
          settings: videoSettingsByChannel[channel],
          durationSeconds:
            videoDurationSeconds ?? videoSourceMetadata?.duration ?? null,
        }),
      ]),
    ) as Partial<
      Record<
        ChannelKey,
        { format: VideoFormat; adaptationMode: VideoAdaptationMode }
      >
    >;
    const publishVideoSettingsByChannel = buildChannelRecord(
      publishTargetVideoSettingsByChannel,
      publishableChannels,
    );
    const mediaFinalizationExpected =
      persistentMediaSynchronizing ||
      shouldBuildImageFallbackPayload ||
      shouldBuildVideoFallbackPayload ||
      Object.values(persistentMediaStates).some(
        (media) =>
          media.status === "queued" || media.status === "uploading",
      ) ||
      publishableChannels.some(
        (channel) =>
          publishMediaModeByChannel[channel] === "video" &&
          publishVideoSettingsByChannel[channel]?.format !== "original" &&
          videoVariantPreparationByChannel[channel]?.status !== "ready",
      );
    const visiblePublicationCapMs = mediaFinalizationExpected
      ? BOOSTER_PUBLISH_WITH_MEDIA_FINALIZATION_VISIBLE_CAP_MS
      : BOOSTER_PUBLISH_VISIBLE_CAP_MS;

    if (hasAnyVideoPublish && !videoFile) {
      setImgError(
        i18nT("ajoutez_une_video_avant_de_publier_74e6e32f"),
      );
      return;
    }

    const missingContentChannels = publishableChannels.filter(
      (ch) => !String(preparedPostsByChannel[ch]?.content || "").trim(),
    );
    if (missingContentChannels.length && !options?.skipEmptyContentWarnings) {
      setPostsByChannel(preparedPostsByChannel);
      setPendingPublishPosts(preparedPostsByChannel);
      setEmptyContentWarningChannels(missingContentChannels);
      setEmptyContentWarningIndex(0);
      return;
    }

    closeEmptyContentWarnings();
    setPendingPublishPosts(null);
    setPostsByChannel(preparedPostsByChannel);

    if (publishableChannels.includes("instagram")) {
      const instagramMode = publishMediaModeByChannel.instagram || "none";
      const instagramImages = channelImageEditors.instagram?.imageKeys || [];
      if (instagramMode === "none") {
        setImgError(i18nT("instagram_necessite_une_video_ou_au_dc42bf8d"));
        return;
      }
      if (instagramMode === "images" && !instagramImages.length) {
        setImgError(
          i18nT("veuillez_ajouter_au_moins_1_image_2804ca41"),
        );
        return;
      }
      if (instagramMode === "video" && !videoFile) {
        setImgError(i18nT("veuillez_ajouter_une_video_pour_publier_9e530780"));
        return;
      }
    }

    if (
      publishableChannels.includes("facebook") &&
      ((facebookPublicationPlacement === "reel" || facebookStoryEnabled) ||
        facebookPublicationPlacement === "story")
    ) {
      const facebookMode = publishMediaModeByChannel.facebook || "none";
      const facebookImages = channelImageEditors.facebook?.imageKeys || [];
      if (facebookMode === "none") {
        setImgError(i18nT("instagram_necessite_une_video_ou_au_dc42bf8d"));
        return;
      }
      if (facebookMode === "images" && !facebookImages.length) {
        setImgError(i18nT("veuillez_ajouter_au_moins_1_image_2804ca41"));
        return;
      }
      if (facebookMode === "video" && !videoFile) {
        setImgError(i18nT("veuillez_ajouter_une_video_pour_publier_9e530780"));
        return;
      }
    }

    if (publishableChannels.includes("pinterest")) {
      if (!pinterestBoardId) {
        setPublishError(i18nT("choisissez_un_tableau_pinterest_avant_de_60a6ce70"));
        return;
      }
      const pinterestMode = publishMediaModeByChannel.pinterest || "none";
      const pinterestImages = channelImageEditors.pinterest?.imageKeys || [];
      if (pinterestMode === "none") {
        setImgError(i18nT("pinterest_necessite_une_image_ou_une_e2a7f196"));
        return;
      }
      if (pinterestMode === "images" && !pinterestImages.length) {
        setImgError(
          i18nT("veuillez_ajouter_au_moins_1_image_b3487d4c"),
        );
        return;
      }
      if (pinterestMode === "video" && !videoFile) {
        setImgError(i18nT("veuillez_ajouter_une_video_pour_publier_392ad3f1"));
        return;
      }
    }

    const preflightFailureChannels = new Set(
      preflightFailedChannels.map((failure) => failure.channel),
    );
    let dispatchPreparationShown = false;
    let publicationDispatchShown = false;
    let mediaPreparationProgressUpdates = 0;
    const videoChannelsUseOriginal = publishableChannels
      .filter((channel) => publishMediaModeByChannel[channel] === "video")
      .every(
        (channel) =>
          (publishVideoSettingsByChannel[channel]?.format || "original") ===
          "original",
      );
    const armPublicationFinalWait = () => {
      if (publicationFinalWaitTimeoutId !== null) return;
      publicationFinalWaitTimeoutId = window.setTimeout(() => {
        publicationFinalWaitTimeoutId = null;
        setPublicationProgressPhase(
          "final_wait",
          i18nT("publication_finalizing"),
          99,
        );
      }, 8_000);
    };

    const onPublicationProgress = (update: BoosterPublishProgressUpdate) => {
      const payload =
        update.payload && typeof update.payload === "object"
          ? update.payload
          : {};
      const summary =
        payload.summary && typeof payload.summary === "object"
          ? (payload.summary as Record<string, any>)
          : {};
      const mediaPreparation =
        payload.mediaPreparation && typeof payload.mediaPreparation === "object"
          ? (payload.mediaPreparation as Record<string, any>)
          : null;
      const mediaPreparationProgress = mediaPreparation
        ? Math.min(
            100,
            Math.max(0, Number(mediaPreparation.progress || 0)),
          )
        : null;
      const mediaPreparationLabelProgress = mediaPreparationProgress;
      const entries = Array.isArray(summary.entries)
        ? (summary.entries.filter(
            (entry): entry is Record<string, any> =>
              Boolean(entry && typeof entry === "object"),
          ) as Record<string, any>[])
        : [];
      const terminalChannels = new Set<string>(preflightFailureChannels);
      // Reuse the existing server snapshots for display only; accepted jobs remain pending.
      setPublicationDestinations((current) => current.map((destination) => {
        if (!publishTargetChannels.includes(destination.key as ChannelKey)) return destination;
        const entry = entries.find((item) => item.channel === destination.key);
        if (!entry) return preflightFailureChannels.has(destination.key as ChannelKey)
          ? { ...destination, status: "skipped" }
          : destination;
        return { ...destination, status: getPublicationDestinationStatus(entry) };
      }));
      let preparingCount = 0;
      entries.forEach((entry) => {
        const channel = String(entry.channel || "");
        const status = String(
          entry.technicalStatus || entry.status || "",
        ).toLowerCase();
        const terminal =
          typeof entry.ok === "boolean" ||
          [
            "failed",
            "error",
            "published",
            "published_with_warning",
            "completed",
            "success",
            "succeeded",
          ].includes(status);
        if (terminal) terminalChannels.add(channel);
        if (status === "preparing") preparingCount += 1;
      });

      const totalCount = Math.max(1, publishTargetChannels.length);
      const terminalCount = Math.min(totalCount, terminalChannels.size);
      const mediaPreparationInProgress =
        preparingCount > 0 ||
        String(payload.status || "").toLowerCase() === "preparing" ||
        (mediaPreparationProgress !== null && mediaPreparationProgress < 100);
      if (mediaPreparationInProgress) {
        mediaPreparationProgressUpdates += 1;
        const progress = mediaPreparationProgress ?? 0;
        const preparationLabel =
          hasAnyVideoPublish &&
          videoChannelsUseOriginal &&
          mediaPreparationProgressUpdates === 1
            ? "Vérification de la vidéo"
            : "Préparation des médias";
        const label = `${preparationLabel}${
          mediaPreparationLabelProgress === null
            ? ""
            : ` · ${Math.round(mediaPreparationLabelProgress)} %`
        }`;
        setPublicationProgressPhase(
          "media_preparation",
          label,
          mapProgressRange(progress, 0, 100, 23, 39),
        );
        return;
      }
      if (update.stage === "request_accepted") {
        setPublicationProgressPhase(
          "file_preparation",
          i18nT("publication_preparing_sends"),
          49,
        );
        dispatchPreparationShown = true;
        return;
      }
      if (update.stage === "released_to_background") {
        setPublicationProgressPhase(
          "status_collection",
          i18nT("publication_pending_channels_confirmation", { value0: Math.max(0, totalCount - terminalCount), value1: totalCount - terminalCount > 1 ? "canaux finalisent" : "canal finalise" }),
          93,
        );
        return;
      }
      if (update.stage === "completed") {
        setPublicationProgressPhase(
          "inrsend_recording",
          i18nT("publication_recording_inrsend"),
          96,
        );
        return;
      }
      if (terminalCount >= totalCount) {
        setPublicationProgressPhase(
          "status_collection",
          i18nT("publication_platform_confirmation_count", { value0: totalCount, value1: totalCount }),
          93,
        );
      } else if (terminalCount > 0) {
        if (!dispatchPreparationShown) {
          setPublicationProgressPhase(
            "file_preparation",
            i18nT("publication_preparing_sends"),
            49,
          );
          dispatchPreparationShown = true;
          return;
        }
        armPublicationFinalWait();
        const nextChannel = publishTargetChannels.find(
          (channel) => !terminalChannels.has(channel),
        );
        const nextChannelLabel = nextChannel
          ? CHANNEL_LABELS[nextChannel] || nextChannel
          : "le prochain canal";
        setPublicationProgressPhase(
          "publication_finalization",
          i18nT("publication_channel_progress", { value0: Math.min(totalCount, terminalCount + 1), value1: totalCount, value2: nextChannelLabel }),
          mapProgressRange(terminalCount, 0, totalCount, 67, 81),
        );
        publicationDispatchShown = true;
      } else {
        if (!dispatchPreparationShown) {
          setPublicationProgressPhase(
            "file_preparation",
            i18nT("publication_preparing_sends"),
            49,
          );
          dispatchPreparationShown = true;
          return;
        }
        armPublicationFinalWait();
        const firstChannel = publishTargetChannels[0];
        const firstChannelLabel = firstChannel
          ? CHANNEL_LABELS[firstChannel] || firstChannel
          : "le canal sélectionné";
        setPublicationProgressPhase(
          "channel_dispatch",
          i18nT("publication_first_channel_progress", { value0: totalCount, value1: firstChannelLabel }),
          mapProgressRange(update.pollAttempt, 0, 12, 51, 65),
        );
        publicationDispatchShown = true;
      }
    };

      const readyMediaWorkspaceId =
        await waitForPersistentWorkspaceReadiness(
          "publish",
          (progress) => {
            setPublicationProgressPhase(
              "media_preparation",
              progress > 24 ? pendingMediaPreparationLabel : i18nT("publication_verifying_preparing_media"),
              progress <= 24
                ? mapProgressRange(progress, 6, 24, 23, 34)
                : 35,
            );
          },
          requiredPublishMediaTypes,
          publishWorkspaceReadinessTimeoutMs,
        );

      setPublicationProgressPhase(
        "media_preparation",
        pendingMediaPreparationLabel,
        37,
      );

      // Les formats originaux sont déjà validés dans le bloc Médias. Une
      // adaptation explicite doit, elle, être prête avant d'arriver ici.
      setPublicationProgressPhase(
        "media_preparation",
        pendingMediaPreparationLabel,
        38,
      );

      const emptyChannelImages = {} as ChannelImagePayload;
      const emptyChannelSettings = {} as ChannelImageSettingsPayload;
      const { channelImages, channelSettings } = !hasAnyImagePublish
        ? {
            channelImages: emptyChannelImages,
            channelSettings: emptyChannelSettings,
          }
        : workspaceCarriesImagesForPublish
          ? {
              channelImages: emptyChannelImages,
              channelSettings: buildChannelImageSettingsPayload(),
            }
          : await buildChannelImagesPayload((current, total) => {
            if (!total) {
              setPublicationProgressPhase(
                "media_preparation",
                i18nT("progress_media_preparation"),
                38,
              );
              return;
            }
            const ratio = current / total;
            setPublicationProgressPhase(
              "media_preparation",
              i18nT("publication_media_progress", { value0: clampPercent(ratio * 100) }),
              mapProgressRange(ratio, 0, 1, 35, 38),
            );
          }, publishableChannels.filter(channel => resolveChannelMediaMode(channel) === "images"));

      const originalImageByKey: Record<string, ImagePayload> =
        !shouldBuildImageFallbackPayload
          ? {}
          : await (async () => {
              setPublicationProgressPhase(
                "media_preparation",
                i18nT("progress_media_preparation"),
                38,
              );
              return await uploadOriginalImagesForPublication(
                (current, total) => {
                  if (!total) return;
                  const ratio = current / total;
                  setPublicationProgressPhase(
                    "media_preparation",
                    i18nT("publication_media_progress", { value0: clampPercent(ratio * 100) }),
                    mapProgressRange(ratio, 0, 1, 36, 39),
                  );
                },
              );
            })();

      if (hasAnyImagePublish) {
        setPublicationProgressPhase(
          "media_preparation",
          i18nT("progress_media_preparation"),
          39,
        );
      }

      const uploadedChannelImages = {} as ChannelImagePayload;
      const uploadTargets = !hasAnyImagePublish
        ? 0
        : publishableChannels.reduce(
            (sum, channel) =>
              sum +
              (channelImages[channel] || []).filter((image) => !!image?.dataUrl)
                .length,
            0,
          );
      let uploadedCount = 0;
      if (shouldBuildImageFallbackPayload) {
        await Promise.all(
          publishableChannels.map(async (channel) => {
            if (publishMediaModeByChannel[channel] !== "images") return;
            const uploadedImages = await uploadPreparedImages(
              channelImages[channel] || [],
              (current, total) => {
                if (!total) return;
                uploadedCount += 1;
                const ratio = uploadTargets ? uploadedCount / uploadTargets : 1;
                setPublicationProgressPhase(
                  "media_preparation",
                  i18nT("publication_media_progress", { value0: clampPercent(ratio * 100) }),
                  mapProgressRange(ratio, 0, 1, 37, 39),
                );
              },
            );
            const imageKeysForChannel =
              channelSettings[channel]?.imageKeys || [];
            uploadedChannelImages[channel] = uploadedImages.map(
              (image, index) => {
                const imageKey = imageKeysForChannel[index] || "";
                const original = imageKey
                  ? originalImageByKey[imageKey]
                  : undefined;
                const originalUrl = String(
                  original?.publicUrl ||
                    original?.originalPublicUrl ||
                    original?.originalUrl ||
                    "",
                ).trim();
                return {
                  ...image,
                  renderedUrl: image.publicUrl || image.renderedUrl || "",
                  imageKey,
                  originalUrl,
                  originalPublicUrl: originalUrl,
                  originalStoragePath:
                    original?.storagePath || original?.originalStoragePath || "",
                  originalName: original?.name || image.name,
                  originalType: original?.type || image.type,
                  transform: imageKey
                    ? channelSettings[channel]?.transforms?.[imageKey]
                    : undefined,
                  imageMeta:
                    image.imageMeta ||
                    (imageKey ? imageMetaByKey[imageKey] : undefined),
                };
              },
            );
          }),
        );
      }

      let publicationVideo: any = null;
      if (shouldBuildVideoFallbackPayload) {
        setPublicationProgressPhase(
          "media_preparation",
          i18nT("progress_media_preparation"),
          39,
        );
        publicationVideo = await uploadPublicationVideoForPublish();
        if (!publicationVideo?.publicUrl && !publicationVideo?.url) {
          throw new Error(
            "La vidéo n’a pas pu être préparée pour la publication.",
          );
        }
        publicationVideo = await preparePublicationVideoVariants(
          publicationVideo,
          publishableChannels,
          publishMediaModeByChannel,
          { settingsByChannel: publishVideoSettingsByChannel },
        );
      }

      publishDispatchStarted = true;
      if (!isCurrentPublishScope()) throw new Error(i18nT("connections_loading"));
      const result = await trackEvent("publish", {
        _onPublicationProgress: onPublicationProgress,
        _clientVisibleWaitMs: Math.max(
          0,
          visiblePublicationCapMs - (Date.now() - publishStartedAt),
        ),
        creationMode,
        soundtrackByChannel: getPublicationSoundtracks(publishTargetChannels),
        mediaWorkspaceId:
          unifiedMediaConsumptionClientAvailable && readyMediaWorkspaceId
            ? readyMediaWorkspaceId
            : undefined,
        mediaWorkspaceClientKey:
          unifiedMediaConsumptionClientAvailable && readyMediaWorkspaceId
            ? mediaWorkspaceClientKey
            : undefined,
        mediaPipelineCutoverV1: mediaPipelineCutoverEnabled,
        mediaType: hasAnyVideoPublish ? "video" : "images",
        mediaModeByChannel: buildChannelRecord(
          publishTargetMediaModeByChannel,
          publishTargetChannels,
        ),
        videoFormatByChannel: buildChannelRecord(
          videoFormatByChannel,
          publishTargetChannels,
        ),
        videoAdaptationModeByChannel: buildChannelRecord(
          videoAdaptationModeByChannel,
          publishTargetChannels,
        ),
        videoSettingsByChannel: buildChannelRecord(
          publishTargetVideoSettingsByChannel,
          publishTargetChannels,
        ),
        video: publicationVideo,
        idea: idea.trim(),
        theme,
        channels: publishTargetChannels,
        storySequenceResumeByChannel: options?.retryPreviousSummary
          ? buildStorySequenceResumeByChannel(options.retryPreviousSummary, publishTargetChannels)
          : undefined,
        clientPreflightFailuresByChannel,
        postByChannel: filterPostsForSelectedChannels(
          preparedPostsByChannel,
          publishTargetChannels,
        ),
        // Avoid sending the same images twice (base images + channel images),
        // which can make the JSON body too large and trigger HTTP 413.
        // The API now rebuilds the fallback/base image set from channel images.
        images: [],
        imagesByChannel: buildChannelRecord(
          uploadedChannelImages,
          publishableChannels.filter(channel => resolveChannelMediaMode(channel) === "images"),
        ),
        imageSettingsByChannel: buildChannelRecord(
          channelSettings,
          publishTargetChannels.filter(channel => resolveChannelMediaMode(channel) === "images"),
        ),
        tiktokPublicationSettings: publishTargetChannels.includes("tiktok")
          ? options?.tiktokPublicationSettings || tiktokPublicationSettings
          : null,
        threadsPublicationSettings: publishTargetChannels.includes("threads") ? { mode: threadsPublicationMode } : null,
        instagramPublicationSettings: publishTargetChannels.includes(
          "instagram",
        )
          ? buildMetaPublicationSelection(
              instagramPublicationPlacement,
              instagramStoryEnabled,
            )
          : null,
        facebookPublicationSettings: publishTargetChannels.includes(
          "facebook",
        )
          ? buildMetaPublicationSelection(
              facebookPublicationPlacement,
              facebookStoryEnabled,
            )
          : null,
        pinterestPublicationSettings: publishTargetChannels.includes("pinterest")
          ? { boardId: pinterestBoardId, boardName: pinterestBoardName }
          : null,
      });

      if (!dispatchPreparationShown) {
        setPublicationProgressPhase(
          "file_preparation",
          i18nT("publication_preparing_sends"),
          49,
        );
        dispatchPreparationShown = true;
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      if (!publicationDispatchShown) {
        setPublicationProgressPhase(
          "publication_finalization",
          i18nT("publication_publishing_channels"),
          81,
        );
        publicationDispatchShown = true;
        armPublicationFinalWait();
        await new Promise((resolve) => window.setTimeout(resolve, 240));
      }

      // trackEvent attend jusqu’au premier des deux événements : tous les
      // canaux sont terminés, ou la fenêtre visible est écoulée. Dans ce
      // second cas, le bilan s’ouvre avec les canaux encore en traitement et
      // les workers durables poursuivent l’envoi sans dépendre du navigateur.
      const resultEntries = Array.isArray(result?.summary?.entries)
        ? result.summary.entries
        : [];
      const retryFailedChannels = resultEntries
        .filter(
          (entry: any) =>
            isRetryablePublicationEntry(entry) &&
            publishableChannels.includes(entry?.channel as ChannelKey),
        )
        .map((entry: any) => entry.channel as ChannelKey);
      const failureCount = Math.max(
        0,
        Number(result?.summary?.failureCount || retryFailedChannels.length),
      );
      const pendingCount = Math.max(
        0,
        Number(
          result?.summary?.pendingCount ||
            resultEntries.filter((entry: any) => {
              const status = String(entry?.status || "").trim().toLowerCase();
              const technicalStatus = String(entry?.technicalStatus || "")
                .trim()
                .toLowerCase();
              return (
                isBoosterPublicationPendingStatus(status) ||
                isBoosterPublicationPendingStatus(technicalStatus)
              );
            }).length,
        ),
      );
      const warningCount = Math.max(
        0,
        Number(
          result?.summary?.warningCount ||
            resultEntries.filter(
              (entry: any) => entry?.status === "published_with_warning",
            ).length,
        ),
      );
      const publicationAccepted =
        result?.summary?.allFailed !== true &&
        (Number(result?.summary?.successCount || 0) > 0 || pendingCount > 0);
      const publicationComplete = publicationAccepted && pendingCount === 0;
      const bilanProgress = resolvePublicationBilanProgress(pendingCount);

      setPublicationProgressPhase(
        "status_collection",
        pendingCount > 0 ? pendingCount > 1 ? i18nT("publication_pending_multiple", { value0: pendingCount }) : i18nT("publication_pending_one") : i18nT("publication_platform_confirmation_count", { value0: publishableChannels.length, value1: publishableChannels.length }),
        93,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      setPublicationProgressPhase(
        "inrsend_recording",
        i18nT("publication_recording_inrsend"),
        96,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 220));

      if (publicationFinalWaitTimeoutId !== null) {
        window.clearTimeout(publicationFinalWaitTimeoutId);
        publicationFinalWaitTimeoutId = null;
      }
      setPublicationProgressPhase(
        "final_wait",
        i18nT("publication_finalizing_report"),
        99,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 540));

      completePublicationProgress(
        bilanProgress.backgroundFinalization ? bilanProgress.pendingCount > 1 ? i18nT("publication_report_pending_multiple", { value0: bilanProgress.pendingCount }) : i18nT("publication_report_pending_one") : result?.summary?.allFailed ? i18nT("publication_report_all_failed") : failureCount > 0 ? i18nT("publication_report_failures", { value0: failureCount, value1: failureCount > 1 ? "s" : "" }) : warningCount > 0 ? i18nT("publication_report_warning") : i18nT("publication_report_complete"),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      if (publicationAccepted) {
        onUnsavedChange?.(false);
      }
      let recoveredPinterestHref = "";
      if (
        publishableChannels.includes("pinterest") &&
        !normalizeExternalHref(channelDetails.pinterest?.href)
      ) {
        try {
          const pinterestResponse = await fetch(
            "/api/integrations/pinterest/status?live=1",
            { cache: "no-store" as any },
          );
          const pinterestStatus = pinterestResponse.ok
            ? await pinterestResponse.json().catch(() => null)
            : null;
          const username = String(pinterestStatus?.username || "")
            .replace(/^@+/, "")
            .trim();
          recoveredPinterestHref = normalizeExternalHref(
            pinterestStatus?.profileUrl ||
              pinterestStatus?.publicProfileUrl ||
              (username
                ? `https://www.pinterest.fr/${encodeURIComponent(username)}/`
                : ""),
          );
          if (recoveredPinterestHref) {
            const accountLabel = String(
              pinterestStatus?.accountName || username || recoveredPinterestHref,
            ).trim();
            setChannelDetails((current) => ({
              ...current,
              pinterest: {
                ...(current.pinterest || EMPTY_CHANNEL_DETAILS.pinterest),
                type: "account",
                label: accountLabel || "Compte Pinterest connecté",
                href: recoveredPinterestHref,
              },
            }));
          }
        } catch {
          recoveredPinterestHref = "";
        }
      }
      const channelLinks = { ...options?.retryPreviousSummary?.channelLinks, ...Object.fromEntries(
        publishableChannels.map((channel) => [
          channel,
          channel === "pinterest"
            ? normalizeExternalHref(channelDetails[channel]?.href) ||
              recoveredPinterestHref
            : normalizeExternalHref(channelDetails[channel]?.href),
        ]),
      ) };
      if (publicationComplete) {
        void archivePersistentMediaWorkspace().catch((error) => {
          console.warn("[media-pipeline] workspace archive skipped", error);
        });
      }

      const completedSummary = mergeRetriedPublicationSummary(
        options?.retryPreviousSummary,
        mergePreflightFailuresIntoPublicationSummary(result?.summary, preflightFailedChannels),
        String(result?.publication_id || result?.publicationId || "").trim() || null,
        publishTargetChannels,
      );
      completedSummary.channelLinks = channelLinks;
      latestPublicationSummaryRef.current = completedSummary;
      const remainingRetryChannels = (completedSummary.entries || [])
        .filter(isRetryablePublicationEntry)
        .map((entry) => entry.channel as ChannelKey);
      const retryFailed = remainingRetryChannels.length || completedSummary.pendingCount
        ? async () => {
            if (!isCurrentPublishScope()) return;
            const retryPreviousSummary = latestPublicationSummaryRef.current || completedSummary;
            const channels = (retryPreviousSummary.entries || [])
              .filter(isRetryablePublicationEntry)
              .map((entry) => entry.channel as ChannelKey);
            if (!channels.length) return;
            await runPublish({
              channels,
              retryPreviousSummary,
              preparedPostsByChannel,
              tiktokPublicationSettings:
                options?.tiktokPublicationSettings ||
                tiktokPublicationSettings,
              closeOnSuccess: true,
              suppressPublishSuccess: false,
              throwOnError: true,
            });
          }
        : undefined;

      if (!options?.suppressPublishSuccess) {
        onPublishSuccess?.({
          ...result,
          summary: completedSummary,
          channelLinks,
          preflightFailedChannels,
          retryFailedChannels: remainingRetryChannels,
          retryFailed,
        });
      }
      // The acknowledged result stays in this wizard, beneath the same header.
      // Standalone callers without a result handler retain their close behavior.
      if (options?.closeOnSuccess !== false && publicationAccepted && (!onPublishSuccess || options?.suppressPublishSuccess)) {
        onClose();
      }
    } catch (e) {
      if (publicationFinalWaitTimeoutId !== null) {
        window.clearTimeout(publicationFinalWaitTimeoutId);
        publicationFinalWaitTimeoutId = null;
      }
      setPublishProgress(0);
      setPublishProgressLabel("");
      resetPublicationProgressPhases();
      const baseMessage = getSimpleFrenchErrorMessage(
        e,
        "La publication n'a pas pu être envoyée. Merci de réessayer.",
      );
      const networkLike = /connexion au serveur impossible|connexion interrompue|failed to fetch|networkerror|network request failed/i.test(
        `${e instanceof Error ? e.message : String(e || "")} ${baseMessage}`,
      );
      const message = networkLike
        ? publishDispatchStarted
          ? "Connexion interrompue pendant la publication. L’envoi peut encore être en cours : vérifiez iNr’Send avant de relancer."
          : "Connexion interrompue pendant la préparation des médias. Aucun envoi n’a été confirmé : réessayez dans quelques instants."
        : baseMessage;
      setPublishError(message);
      if (options?.throwOnError) {
        throw new Error(message);
      }
    } finally {
      if (publicationFinalWaitTimeoutId !== null) {
        window.clearTimeout(publicationFinalWaitTimeoutId);
        publicationFinalWaitTimeoutId = null;
      }
      publishStartGuardRef.current = false;
      phasedPublicationProgressRef.current = false;
      setSaving(false);
    }
  };

  const performSchedulePublication = async (
    selections: PublishScheduleSelection[],
    preparedPostsByChannel: Partial<Record<ChannelKey, ChannelPost>>,
    tiktokSettingsForSchedule: TiktokPublicationSettings | null,
    immediateChannels: ChannelKey[] = [],
  ): Promise<PendingImmediatePublishAfterSchedule | null | undefined> => {
    const context = readContext();
    const {
      authoritativeChannelsRef,
      connectedChannelsScopeRef,
      activeAccountId,
      i18nT,
      saving,
      draftSaving,
      scheduleSaving,
      voiceInputBusy,
      scheduleStartGuardRef,
      selectedChannels,
      creationMode,
      idea,
      theme,
      threadsPublicationMode,
      instagramPublicationPlacement,
      instagramStoryEnabled,
      facebookPublicationPlacement,
      facebookStoryEnabled,
      pinterestBoardId,
      pinterestBoardName,
    } = context.state;
    const {
      persistentMediaWorkspaceEnabled,
      mediaPipelineCutoverEnabled,
      images,
      videoFile,
      videoSettingsByChannel,
      videoDurationSeconds,
      videoSourceMetadata,
      imageMetaByKey,
      unifiedMediaConsumptionClientAvailable,
      mediaWorkspaceClientKey,
      videoFormatByChannel,
      videoAdaptationModeByChannel,
    } = context.media;
    const {
      getImagePreparationIssue,
      resolveChannelMediaMode,
      waitForPersistentWorkspaceIdle,
      buildFinalReviewItems,
      waitForPersistentWorkspaceReadiness,
      ensureCutoverVideoVariantsReady,
      buildChannelImageSettingsPayload,
      buildChannelImagesPayload,
      uploadOriginalImagesForPublication,
      uploadPublicationVideoForPublish,
      preparePublicationVideoVariants,
      getPublicationSoundtracks,
      filterPostsForSelectedChannels,
    } = context.preparation;
    const {
      setScheduleError,
      setPublishError,
      setScheduleSaving,
      setDraftMessage,
      setImgError,
      setPublishProgress,
      setPublishProgressLabel,
      scrollToPublishArea,
      setChannels,
      setPendingImmediatePublishAfterSchedule,
      setScheduleReviewPosts,
      setTiktokPublicationSettings,
      setTiktokSettingsFlow,
      setPendingScheduleRequest,
      onUnsavedChange,
    } = context.actions;
    if (!authoritativeChannelsRef.current || connectedChannelsScopeRef.current !== (getActiveBrowserUserId() || activeAccountId || null)) {
      setScheduleError(i18nT("connections_loading"));
      return;
    }
    if (
      saving ||
      draftSaving ||
      scheduleSaving ||
      voiceInputBusy ||
      scheduleStartGuardRef.current
    ) {
      return;
    }

    const requestedChannelsToSchedule = Array.from(
      new Set(selections.map((selection) => selection.channel)),
    ).filter((channel): channel is ChannelKey =>
      selectedChannels.includes(channel),
    );

    if (!requestedChannelsToSchedule.length) {
      setScheduleError(i18nT("schedule_select_channel_error"));
      return;
    }

    const imagePreparationIssue = getImagePreparationIssue([
      ...requestedChannelsToSchedule,
      ...immediateChannels,
    ]);
    if (imagePreparationIssue) {
      setScheduleError(imagePreparationIssue);
      setPublishError(imagePreparationIssue);
      return;
    }

    const immediateChannelsToPublish = Array.from(new Set(immediateChannels))
      .filter((channel): channel is ChannelKey =>
        selectedChannels.includes(channel),
      )
      .filter((channel) => !requestedChannelsToSchedule.includes(channel));

    scheduleStartGuardRef.current = true;
    setScheduleSaving(true);
    setPublishError("");
    setScheduleError("");
    setDraftMessage("");
    setImgError("");
    setPublishProgress(5);
    setPublishProgressLabel(i18nT("schedule_preparing"));
    scrollToPublishArea("smooth");

    try {
      const requestedWorkspaceMediaTypes = [
        ...(requestedChannelsToSchedule.some(
          (channel) => resolveChannelMediaMode(channel) === "images",
        )
          ? (["image"] as const)
          : []),
        ...(requestedChannelsToSchedule.some(
          (channel) => resolveChannelMediaMode(channel) === "video",
        )
          ? (["video"] as const)
          : []),
      ];
      const settledWorkspaceStates = persistentMediaWorkspaceEnabled
        ? await waitForPersistentWorkspaceIdle(
            (progress, label) => {
              setPublishProgress((current) => Math.max(current, progress));
              setPublishProgressLabel(
                label || i18nT("schedule_checking_media"),
              );
            },
            {
              mediaTypes: requestedWorkspaceMediaTypes,
              tolerateFailures: true,
            },
          )
        : undefined;
      const reviewItems = buildFinalReviewItems(
        preparedPostsByChannel,
        requestedChannelsToSchedule,
        settledWorkspaceStates,
      );
    const blocked = reviewItems.filter((item) => item.blockers.length > 0);
    const channelsToSchedule = reviewItems
      .filter((item) => item.blockers.length === 0)
      .map((item) => item.channel);
    if (!channelsToSchedule.length) {
      setScheduleError(
        i18nT("aucun_canal_ne_peut_etre_programme_5dcc0e18", { value0: blocked
          .map(
            (item) =>
              `${item.label} — ${item.blockers[0] || "canal non prêt"}`,
          )
          .join(" / ") }),
      );
      return;
    }

    const publishMediaModeByChannel = Object.fromEntries(
      channelsToSchedule.map((channel) => [
        channel,
        resolveChannelMediaMode(channel),
      ]),
    ) as Partial<Record<ChannelKey, ChannelMediaMode>>;
    const hasAnyVideoPublish = channelsToSchedule.some(
      (channel) => publishMediaModeByChannel[channel] === "video",
    );
    const hasAnyImagePublish = channelsToSchedule.some(
      (channel) => publishMediaModeByChannel[channel] === "images",
    );
    const requiredScheduleMediaTypes = [
      ...(hasAnyImagePublish ? (["image"] as const) : []),
      ...(hasAnyVideoPublish ? (["video"] as const) : []),
    ];
    const scheduleWorkspaceReadinessTimeoutMs =
      MEDIA_WORKSPACE_READINESS_TIMEOUT_MS;
    const workspaceCarriesImagesForSchedule =
      mediaPipelineCutoverEnabled && images.length > 0;
    const workspaceCarriesVideoForSchedule =
      mediaPipelineCutoverEnabled && Boolean(videoFile);
    const shouldBuildScheduleImageFallback =
      hasAnyImagePublish && !workspaceCarriesImagesForSchedule;
    const shouldBuildScheduleVideoFallback =
      hasAnyVideoPublish && !workspaceCarriesVideoForSchedule;
    const scheduleVideoSettingsByChannel = Object.fromEntries(
      channelsToSchedule.map((channel) => [
        channel,
        getAutomaticVideoSettingsForPublication({
          channel,
          settings: videoSettingsByChannel[channel],
          durationSeconds:
            videoDurationSeconds ?? videoSourceMetadata?.duration ?? null,
        }),
      ]),
    ) as Partial<
      Record<
        ChannelKey,
        { format: VideoFormat; adaptationMode: VideoAdaptationMode }
      >
    >;

    if (hasAnyVideoPublish && !videoFile) {
      setScheduleError(i18nT("ajoutez_une_video_avant_de_programmer_f54a63bc"));
      return;
    }

      const readyMediaWorkspaceId =
        await waitForPersistentWorkspaceReadiness(
          "schedule",
          (progress, label) => {
            setPublishProgress((current) => Math.max(current, progress));
            setPublishProgressLabel(label || i18nT("schedule_checking_media"));
          },
          requiredScheduleMediaTypes,
          scheduleWorkspaceReadinessTimeoutMs,
        );

      if (hasAnyVideoPublish && workspaceCarriesVideoForSchedule) {
        const videoChannels = channelsToSchedule.filter(
          (channel) => publishMediaModeByChannel[channel] === "video",
        );
        setPublishProgress((current) => Math.max(current, 43));
        setPublishProgressLabel(i18nT("progress_media_preparation"));
        await ensureCutoverVideoVariantsReady(
          videoChannels,
          scheduleVideoSettingsByChannel,
          {
            generateMissingVideoVariants: false,
            allowPartialChannelFailures: true,
          },
        );
        setPublishProgress((current) => Math.max(current, 57));
        setPublishProgressLabel(i18nT("progress_media_preparation"));
      }

      const emptyChannelImages = {} as ChannelImagePayload;
      const emptyChannelSettings = {} as ChannelImageSettingsPayload;
      const { channelImages, channelSettings } = !hasAnyImagePublish
        ? {
            channelImages: emptyChannelImages,
            channelSettings: emptyChannelSettings,
          }
        : workspaceCarriesImagesForSchedule
          ? {
              channelImages: emptyChannelImages,
              channelSettings: buildChannelImageSettingsPayload(),
            }
          : await buildChannelImagesPayload((current, total) => {
            if (!total) {
              setPublishProgress((current) => Math.max(current, 20));
              setPublishProgressLabel(i18nT("schedule_preparing_contents"));
              return;
            }
            const ratio = current / total;
            setPublishProgress((current) =>
              Math.max(current, clampPercent(8 + ratio * 22)),
            );
            setPublishProgressLabel(
              i18nT("schedule_preparing_images_progress", { value0: clampPercent(ratio * 100) }),
            );
          }, channelsToSchedule.filter(channel => resolveChannelMediaMode(channel) === "images"));

      const originalImageByKey: Record<string, ImagePayload> =
        !shouldBuildScheduleImageFallback
          ? {}
          : await (async () => {
              setPublishProgress((current) => Math.max(current, 32));
              setPublishProgressLabel(i18nT("schedule_upload_original_images"));
              return await uploadOriginalImagesForPublication(
                (current, total) => {
                  if (!total) return;
                  const ratio = current / total;
                  setPublishProgress((current) =>
                    Math.max(current, clampPercent(32 + ratio * 12)),
                  );
                  setPublishProgressLabel(
                    i18nT("schedule_upload_original_images_progress", { value0: clampPercent(ratio * 100) }),
                  );
                },
              );
            })();

      const uploadedChannelImages = {} as ChannelImagePayload;
      if (shouldBuildScheduleImageFallback) {
        setPublishProgress((current) => Math.max(current, 48));
        setPublishProgressLabel(i18nT("schedule_upload_adapted_images"));
        let uploadedCount = 0;
        const uploadTargets = channelsToSchedule.reduce(
          (sum, channel) =>
            sum +
            (channelImages[channel] || []).filter((image) => !!image?.dataUrl)
              .length,
          0,
        );
        for (const channel of channelsToSchedule) {
          if (publishMediaModeByChannel[channel] !== "images") continue;
          const uploadedImages = await uploadPreparedImages(
            channelImages[channel] || [],
            () => {
              uploadedCount += 1;
              const ratio = uploadTargets ? uploadedCount / uploadTargets : 1;
              setPublishProgress((current) =>
                Math.max(current, clampPercent(48 + ratio * 22)),
              );
              setPublishProgressLabel(
                i18nT("schedule_upload_adapted_images_progress", { value0: clampPercent(ratio * 100) }),
              );
            },
          );
          const imageKeysForChannel = channelSettings[channel]?.imageKeys || [];
          uploadedChannelImages[channel] = uploadedImages.map(
            (image, index) => {
              const imageKey = imageKeysForChannel[index] || "";
              const original = imageKey
                ? originalImageByKey[imageKey]
                : undefined;
              const originalUrl = String(
                original?.publicUrl ||
                  original?.originalPublicUrl ||
                  original?.originalUrl ||
                  "",
              ).trim();
              return {
                ...image,
                renderedUrl: image.publicUrl || image.renderedUrl || "",
                imageKey,
                originalUrl,
                originalPublicUrl: originalUrl,
                originalStoragePath:
                  original?.storagePath || original?.originalStoragePath || "",
                originalName: original?.name || image.name,
                originalType: original?.type || image.type,
                transform: imageKey
                  ? channelSettings[channel]?.transforms?.[imageKey]
                  : undefined,
                imageMeta:
                  image.imageMeta ||
                  (imageKey ? imageMetaByKey[imageKey] : undefined),
              };
            },
          );
        }
      }

      let publicationVideo: any = null;
      if (shouldBuildScheduleVideoFallback) {
        setPublishProgress(48);
        setPublishProgressLabel(i18nT("schedule_upload_video"));
        publicationVideo = await uploadPublicationVideoForPublish();
        if (!publicationVideo?.publicUrl && !publicationVideo?.url) {
          throw new Error(
            "La vidéo n’a pas pu être préparée pour la programmation.",
          );
        }
        publicationVideo = await preparePublicationVideoVariants(
          publicationVideo,
          channelsToSchedule,
          publishMediaModeByChannel,
          { settingsByChannel: scheduleVideoSettingsByChannel },
        );
      }

      setPublishProgress(76);
      setPublishProgressLabel(i18nT("schedule_recording_agent"));

      const selectionByChannel = new Map(
        selections.map((selection) => [
          selection.channel,
          selection.scheduledAt,
        ]),
      );

      const scheduleGroups = Array.from(
        channelsToSchedule.reduce((groups, channel) => {
          const scheduledAt = selectionByChannel.get(channel);
          if (!scheduledAt) return groups;
          const existing = groups.get(scheduledAt) || [];
          existing.push(channel);
          groups.set(scheduledAt, existing);
          return groups;
        }, new Map<string, ChannelKey[]>()),
      );

      for (let index = 0; index < scheduleGroups.length; index += 1) {
        const [scheduledAt, groupChannels] = scheduleGroups[index];
        const labels = groupChannels
          .map((channel) => CHANNEL_LABELS[channel] || channel)
          .join(", ");
        const isMultichannel = groupChannels.length > 1;
        await postBoosterScheduledAction({
          automationKey: "publish",
          actionType: "publication",
          targetTool: "booster",
          source: "manual",
          title: isMultichannel
            ? `Publication multicanale (${groupChannels.length} canaux)`
            : `Publication ${labels}`,
          summary: isMultichannel
            ? `Publication programmée sur ${labels}`
            : `Publication programmée sur ${labels}`,
          scheduledAt,
          timezone: "Europe/Paris",
          channels: groupChannels,
          payload: {
              creationMode,
              origin: {
                source: "booster_scheduled",
                label: i18nT("booster_programme_865e1b6b"),
                workflowTool: "booster",
                workflowAction: "publier",
              },
              kind: "manual_publish_schedule",
              scheduleGrouping: {
                mode: "multichannel_single_action",
                channelCount: groupChannels.length,
                createdFrom: "booster_publish_schedule",
              },
              publishPayload: {
                creationMode,
                soundtrackByChannel: getPublicationSoundtracks(groupChannels),
                mediaWorkspaceId:
                  unifiedMediaConsumptionClientAvailable && readyMediaWorkspaceId
                    ? readyMediaWorkspaceId
                    : undefined,
                mediaWorkspaceClientKey:
                  unifiedMediaConsumptionClientAvailable && readyMediaWorkspaceId
                    ? mediaWorkspaceClientKey
                    : undefined,
                mediaPipelineCutoverV1: mediaPipelineCutoverEnabled,
                source: "booster_scheduled",
                origin: {
                  source: "booster_scheduled",
                  label: i18nT("booster_programme_865e1b6b"),
                  workflowTool: "booster",
                  workflowAction: "publier",
                },
                mediaType: hasAnyVideoPublish ? "video" : "images",
                mediaModeByChannel: buildChannelUnknownRecord(
                  publishMediaModeByChannel,
                  groupChannels,
                ),
                videoFormatByChannel: buildChannelUnknownRecord(
                  videoFormatByChannel,
                  groupChannels,
                ),
                videoAdaptationModeByChannel: buildChannelUnknownRecord(
                  videoAdaptationModeByChannel,
                  groupChannels,
                ),
                videoSettingsByChannel: buildChannelUnknownRecord(
                  scheduleVideoSettingsByChannel as Partial<
                    Record<ChannelKey, unknown>
                  >,
                  groupChannels,
                ),
                video: publicationVideo,
                idea: idea.trim(),
                theme,
                channels: groupChannels,
                postByChannel: filterPostsForSelectedChannels(
                  preparedPostsByChannel,
                  groupChannels,
                ),
                images: [],
                imagesByChannel: buildChannelRecord(
                  uploadedChannelImages,
                  groupChannels.filter(channel => resolveChannelMediaMode(channel) === "images"),
                ),
                imageSettingsByChannel: buildChannelRecord(
                  channelSettings,
                  groupChannels.filter(channel => resolveChannelMediaMode(channel) === "images"),
                ),
                tiktokPublicationSettings: groupChannels.includes("tiktok")
                  ? tiktokSettingsForSchedule
                  : null,
                threadsPublicationSettings: groupChannels.includes("threads") ? { mode: threadsPublicationMode } : null,
                instagramPublicationSettings: groupChannels.includes(
                  "instagram",
                )
                  ? buildMetaPublicationSelection(
                      instagramPublicationPlacement,
                      instagramStoryEnabled,
                    )
                  : null,
                facebookPublicationSettings: groupChannels.includes(
                  "facebook",
                )
                  ? buildMetaPublicationSelection(
                      facebookPublicationPlacement,
                      facebookStoryEnabled,
                    )
                  : null,
                pinterestPublicationSettings: groupChannels.includes(
                  "pinterest",
                )
                  ? { boardId: pinterestBoardId, boardName: pinterestBoardName }
                  : null,
              },
          },
        });
        setPublishProgress(
          clampPercent(76 + ((index + 1) / scheduleGroups.length) * 20),
        );
      }

      setChannels((prev) => {
        const next = { ...prev };
        for (const channel of [
          ...channelsToSchedule,
          ...immediateChannelsToPublish,
        ]) {
          next[channel] = false;
        }
        return next;
      });
      setPublishProgress(100);
      setPublishProgressLabel(
        immediateChannelsToPublish.length ? i18nT("schedule_saved_other_channels") : i18nT("schedule_delegated_agent"),
      );
      const scheduledMessage =
        channelsToSchedule.length > 1
          ? `Publication multicanale programmée dans iNr’Agent (${channelsToSchedule.length} canaux).`
          : "Publication programmée dans iNr’Agent.";
      const blockedMessage = blocked.length
        ? `${blocked.length > 1 ? " Canaux non programmés" : " Canal non programmé"} : ${blocked
            .map(
              (item) =>
                `${item.label} — ${item.blockers[0] || "canal non prêt"}`,
            )
            .join(" / ")}.`
        : "";
      setDraftMessage(`${scheduledMessage}${blockedMessage}`);

      const immediatePublishRequest = immediateChannelsToPublish.length
        ? {
            immediateChannels: immediateChannelsToPublish,
            preparedPostsByChannel,
            tiktokSettingsForSchedule: immediateChannelsToPublish.includes(
              "tiktok",
            )
              ? tiktokSettingsForSchedule
              : null,
          }
        : null;
      setPendingImmediatePublishAfterSchedule(immediatePublishRequest);

      setScheduleReviewPosts(null);
      setTiktokPublicationSettings(null);
      setTiktokSettingsFlow(null);
      setPendingScheduleRequest(null);
      onUnsavedChange?.(blocked.length > 0);
      return immediatePublishRequest;
    } catch (e) {
      const message = getSimpleFrenchErrorMessage(
        e,
        "Programmation de la publication impossible.",
      );
      setScheduleError(message);
      setPublishError(message);
      throw new Error(message);
    } finally {
      scheduleStartGuardRef.current = false;
      setScheduleSaving(false);
    }
  };

  function publishImmediateChannelsAfterSchedule(
    request: PendingImmediatePublishAfterSchedule,
  ) {
    if (!request.immediateChannels.length) return;
    void runPublish({
      skipEmptyContentWarnings: true,
      preparedPostsByChannel: request.preparedPostsByChannel,
      tiktokPublicationSettings: request.tiktokSettingsForSchedule,
      channels: request.immediateChannels,
      closeOnSuccess: false,
      throwOnError: false,
    });
  }

  return { runPublish, performSchedulePublication, publishImmediateChannelsAfterSchedule };
}
