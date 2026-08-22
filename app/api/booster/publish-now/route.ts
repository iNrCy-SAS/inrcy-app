import { NextResponse, after } from "next/server";
import { requireUser } from "@/lib/requireUser";
import {
  buildInternalCronHeaders,
  getAppOriginFromRequest,
  getCronSecret,
  getCronUserIdFromRequest,
  isAuthorizedCronRequest,
} from "@/lib/cronAuth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  facebookPublishToPage,
  facebookPublishVideoToPage,
} from "@/lib/facebookPublish";
import {
  instagramPublishCarouselWithTokenFallback,
  instagramPublishPhotoWithTokenFallback,
  isInstagramAuthorizationErrorResult,
} from "@/lib/instagramPublish";
import {
  buildInstagramVideoRequestFingerprint,
  buildInstagramVideoSourceIdentity,
  instagramCreateVideoCheckpointWithTokenFallback,
  instagramPollVideoCheckpointWithTokenFallback,
  instagramPublishVideoCheckpointWithTokenFallback,
  parseInstagramVideoPublishCheckpoint,
  type InstagramVideoPhaseResult,
  type InstagramVideoPublishCheckpoint,
} from "@/lib/instagramVideoPublishPhases";
import {
  linkedinPublishImage,
  linkedinPublishMultiImage,
  linkedinPublishText,
  linkedinPublishVideo,
  linkedinResharePost,
} from "@/lib/linkedinPublish";
import { getGmbToken, gmbCreateLocalPost } from "@/lib/googleBusiness";
import { isGoogleBusinessPostOutcomeUnknown } from "@/lib/googleBusinessPostTransport";
import { buildDeterministicPublicationChildId } from "@/lib/deterministicPublicationId";
import { findSimilarUpcomingScheduledPublication } from "@/lib/scheduledPublicationDedupe";
import {
  acquireExecutionIdempotencyLock,
  buildCompletedExecutionResponse,
  buildRunningExecutionResponse,
  cleanExecutionIdempotencyKey,
  completeExecutionIdempotencyLock,
  failExecutionIdempotencyLock,
} from "@/lib/executionIdempotency";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { captureApiException } from "@/lib/observability/sentry";
import { withApi } from "@/lib/observability/withApi";
import { invalidateBoosterGenerationContext } from "@/lib/boosterGenerationContext";
import { getAppBubbleAccessMapForUser } from "@/lib/appBubbleAccessServer";
import { isBubbleEnabled, type AppBubbleKey } from "@/lib/bubbleAccess";
import {
  GOOGLE_BUSINESS_RECONNECT_USER_MESSAGE,
  INSTAGRAM_RECONNECT_USER_MESSAGE,
  getSimpleFrenchErrorMessage,
  isInstagramAuthorizationLikeMessage,
} from "@/lib/userFacingErrors";
import {
  getPublishChannelUserMessage,
  logPublishChannelFailure,
  markPublishChannelReconnectRequired,
} from "@/lib/channelPublishDiagnostics";
import { hasActiveInrcySite } from "@/lib/inrcySite";
import {
  buildBoosterGmbSummary,
  buildBoosterHashtagLine,
  buildBoosterInstagramCaption,
  buildBoosterMessage,
  buildCtaTextForChannel,
  getBoosterGmbCallToAction,
  sanitizeBoosterPostForStructuredCta,
} from "@/lib/boosterCta";
import { getLinkedInAccessToken } from "@/lib/linkedinOAuth";
import { normalizeTiktokSettings } from "@/lib/tiktokSettings";
import { isTiktokIntegrationActive } from "@/lib/tiktokRouteStorage";
import { buildTiktokMediaProxyUrl } from "@/lib/tiktokMediaUrl";
import { refreshTiktokAccessToken } from "@/lib/tiktokOAuth";
import {
  tiktokDirectPostPhotos,
  tiktokDirectPostVideoFileUpload,
  type TiktokPublicationSettings,
} from "@/lib/tiktokPublish";
import {
  probeTikTokRangeSource,
  type TikTokRangeSource,
  type TikTokVideoUploadCheckpoint,
} from "@/lib/tiktokRangeUpload";
import {
  fetchYoutubeMineChannel,
  isYoutubeShortsIntegrationActive,
  refreshYoutubeShortsAccessToken,
} from "@/lib/youtubeShortsOAuth";
import {
  createYoutubeResumableUploadCheckpoint,
  parseYoutubeResumableUploadCheckpoint,
  resumeYoutubeResumableUploadCheckpoint,
  uploadYoutubeShort,
  type YoutubeResumableUploadCheckpoint,
  type YoutubeResumableUploadPhaseResult,
  type YoutubeShortsUploadInput,
  type YoutubeShortsUploadResult,
} from "@/lib/youtubeShortsPublish";
import {
  getPinterestAccessToken,
  getPinterestApiBaseUrl,
} from "@/lib/pinterestOAuth";
import {
  createPinterestImagePin,
  createPinterestVideoPin,
  resolvePinterestVideoCoverImageUrl,
  withPinterestVideoProtocolAsset,
} from "@/lib/pinterestPublish";
import {
  advancePinterestVideoProtocol,
  type PinterestVideoDurableProtocolArgs,
  type PinterestVideoDurableStepResult,
  type PinterestVideoProtocolCheckpoint,
} from "@/lib/pinterestVideoProtocol";
import {
  buildVideoSettingsByChannel,
  getAutomaticVideoSettingsForPublication,
} from "@/lib/boosterVideoSettings";
import {
  buildVideoTransformSignature,
  getVideoPublicationProfileForChannel,
} from "@/lib/boosterVideoTransforms";
import { ensureSystemManagedInrSearch, notifyInrSearchIndexing, revalidateInrSearchPublicRoutes } from "@/lib/inrSearchProvisioning";
import { buildInrSearchPublicUrl, getInrSearchPublicStatus } from "@/lib/inrSearchPublic";
import { stripSiteTextFormattingPreserveLayout } from "@/lib/boosterFormatting";
import {
  MediaWorkspaceConsumptionError,
  resolveWorkspacePublicationConsumption,
  syncPublicationWorkspaceContext,
  type WorkspacePublicationConsumption,
} from "@/lib/mediaWorkspaceConsumption";
import { prepareWorkspaceMediaForPublication } from "@/lib/mediaWorkspacePublicationPreparation";
import { isLegacyMediaTransportCutoverEnabled } from "@/lib/mediaPipelineLegacyCutoverPolicy";
import { prepareBoosterImagesByChannelOnServer } from "@/lib/boosterImageServerPreparation";
import {
  prepareBoosterVideoVariantsOnServer,
  probeStoredBoosterVideoForPublication,
} from "@/lib/boosterVideoVariantServer";
import { canPublishVideoSourceDirectly } from "@/lib/mediaVideoSourceCompatibility";
import { applyServerVideoFallbackAttestation } from "@/lib/boosterVideoFallbackAttestation";
import {
  normalizeAsyncPreparationAttempt,
  resolveChannelDispatchMediaType,
  shouldPrepareMixedMediaBeforeDispatch,
} from "@/lib/boosterMixedMediaPreparationPolicy";
import {
  YOUTUBE_LONG_UPLOAD_THRESHOLD_SECONDS,
  getYoutubePublicationTypeForDuration,
  getVideoPublicationPolicy,
  normalizeYoutubeLongUploadsStatus,
  validateVideoDurationForChannel,
  validateVideoPublicationForChannel,
} from "@/lib/videoPublicationPolicy";
import {
  getGoogleBusinessVideoPreparationDecision,
} from "@/lib/googleBusinessMediaPolicy";
import { filterGoogleBusinessMediaUrls } from "@/lib/googleBusinessMediaProbe";
import {
  acquireAsyncPublicationPreparationLease,
  BOOSTER_ASYNC_CHANNEL_EVENT_TYPE,
  BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS,
  BOOSTER_ASYNC_CHANNEL_SCOPE,
  completeAsyncPublicationPreparationLease,
  failAsyncPublicationPreparationLease,
  finalizeAsyncPublicationIfReady,
  materializePreparingAsyncChannelEvent,
  updateAsyncChannelEvent,
  updateAsyncPublicationJobEvent,
} from "@/lib/boosterAsyncPublication";
import {
  enqueueBoosterPublication,
  normalizeClientPreflightFailuresByChannel,
} from "@/lib/boosterPublicationIngress";
import { normalizeBoosterPublicationChannels } from "@/lib/boosterPublicationPolicy";
import { buildBoosterPublicationDispatchPlan } from "@/lib/boosterPublicationDispatchPlan";
import {
  getChannelConnectionStates,
  type ChannelStates,
} from "@/lib/channelConnectionState";
import {
  isOfficialPublicationChannelConnected,
  publicationChannelRequiresReconnect,
} from "@/lib/publicationChannelAvailability";

import {
  EMPTY_IMAGE_FORMATS,
  IMMEDIATE_PUBLISH_DUPLICATE_LOOKAHEAD_MINUTES,
  PUBLISH_IDEMPOTENCY_SCOPE,
  PUBLISH_IDEMPOTENCY_TTL_MS,
  asRecord,
  buildAsyncPreparedImagePayloads,
  buildEditableImageAttachments,
  buildOriginalImageAttachments,
  buildImmediateDuplicateMessage,
  buildPublishIdempotencyKey,
  buildPublishIdempotencyMetadata,
  buildQueuedPublicationSummary,
  buildResultsSummary,
  getRequiredImageFormatsForChannel,
  hasFinalImageGeometryDecision,
  isExpired,
  mergeImageFormats,
  normalizeChannelMediaMode,
  normalizeHashtag,
  normalizePublicationMediaType,
  normalizePublicHttpUrl,
  normalizeTiktokPublicationSettings,
  slugify,
  type ChannelKey,
  type ChannelMediaMode,
  type ImagePayload,
  type ImageSet,
  type ImagesByChannel,
  type JsonRecord,
  type PersistedVideoAttachment,
  type PostByChannel,
  type PostPayload,
} from "./publishNow.foundations";

import {
  buildInstagramPublishTokenCandidates,
  getLatestIntegrationRow,
  isGoogleBusinessImageError,
  normalizeVideoPayload,
  uploadImageSet,
} from "./publishNow.server-preparation";

import {
  createPublishNowImageContext,
  createPublishNowPostResolver,
  createPublishNowVideoContext,
} from "./publishNow.channel-context";

export const runtime = "nodejs";
export const maxDuration = 180;

const PUBLICATION_BUBBLE_KEYS: Record<ChannelKey, AppBubbleKey> = {
  inrcy_site: "site_inrcy",
  site_web: "site_web",
  inr_search: "inr_search",
  gmb: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube_shorts: "youtube_shorts",
  pinterest: "pinterest",
};

const PUBLICATION_CHANNEL_LABELS: Record<ChannelKey, string> = {
  inrcy_site: "Site iNrCy",
  site_web: "Site web",
  inr_search: "iNr'Search",
  gmb: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube_shorts: "YouTube",
  pinterest: "Pinterest",
};

function getPublicationChannelState(
  states: ChannelStates,
  channel: ChannelKey,
) {
  switch (channel) {
    case "inrcy_site": return states.site_inrcy;
    case "site_web": return states.site_web;
    case "inr_search": return states.inr_search;
    case "gmb": return states.gmb;
    case "facebook": return states.facebook;
    case "instagram": return states.instagram;
    case "linkedin": return states.linkedin;
    case "tiktok": return states.tiktok;
    case "youtube_shorts": return states.youtube_shorts;
    case "pinterest": return states.pinterest;
    default: {
      const unsupportedChannel: never = channel;
      throw new Error(`Canal de publication inconnu: ${unsupportedChannel}`);
    }
  }
}

async function publishNowHandler(req: Request) {
  const publicationAttemptStartedAt = new Date().toISOString();
  let lifecycleWorkspaceId = "";
  let lifecycleUserId = "";
  let publishIdempotencyLockId: string | null = null;
  let shouldFailPublishIdempotencyLockOnError = false;
  let asyncFailureContext: {
    userId: string;
    publicationId: string;
    channel: ChannelKey;
    channelEventId: string;
    channelLockId: string | null;
  } | null = null;
  let asyncPreparationFailureContext: {
    userId: string;
    publicationId: string;
    preparationLockId: string | null;
  } | null = null;
  try {
    const cronUserId = isAuthorizedCronRequest(req)
      ? getCronUserIdFromRequest(req)
      : "";
    let userId = cronUserId;

    if (!userId) {
      const { user, errorResponse, activeUserId } = await requireUser();
      if (errorResponse) return errorResponse;
      userId = activeUserId;

      const rl = await enforceRateLimit({
        name: "booster_publish",
        identifier: userId,
        limit: 20,
        window: "1 m",
        failClosed: false,
        fallbackLimit: 5,
      });
      if (rl) return rl;
    }

    const body = await req.json().catch(() => null);
    if (!body)
      return NextResponse.json(
        { error: "Données invalides." },
        { status: 400 },
      );

    const internalAsyncRequested = body._asyncChannelDispatch === true;
    const internalAsyncPreparationRequested =
      body._asyncPreparationDispatch === true;
    const internalAsyncDispatch =
      internalAsyncRequested && Boolean(cronUserId) && isAuthorizedCronRequest(req);
    const internalAsyncPreparationDispatch =
      internalAsyncPreparationRequested &&
      Boolean(cronUserId) &&
      isAuthorizedCronRequest(req);
    const internalAsyncWorkerDispatch =
      internalAsyncDispatch || internalAsyncPreparationDispatch;
    if (
      (internalAsyncRequested && !internalAsyncDispatch) ||
      (internalAsyncPreparationRequested && !internalAsyncPreparationDispatch)
    ) {
      return NextResponse.json(
        { ok: false, code: "async_dispatch_unauthorized", error: "Dispatch interne non autorisé." },
        { status: 401 },
      );
    }
    const asyncPublicationId = cleanExecutionIdempotencyKey(
      body._asyncPublicationId,
    );
    const asyncChannelEventId = cleanExecutionIdempotencyKey(
      body._asyncChannelEventId,
    );

    const normalizedChannels = normalizeBoosterPublicationChannels(
      body.channels,
    );
    const post = (body.post || {}) as PostPayload;
    const postByChannel = ((body.postByChannel || {}) as PostByChannel) || {};
    const idea = String(body.idea || "").trim();
    const selected = normalizedChannels.channels;
    if (normalizedChannels.invalidChannels.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "unsupported_channel",
          retryable: false,
          error: "Un ou plusieurs canaux de publication ne sont pas pris en charge.",
          invalidChannels: normalizedChannels.invalidChannels,
        },
        { status: 400 },
      );
    }
    if (
      internalAsyncDispatch &&
      (selected.length !== 1 || !asyncPublicationId || !asyncChannelEventId)
    ) {
      return NextResponse.json(
        {
          ok: false,
          code: "async_dispatch_invalid",
          error: "Le dispatch interne doit cibler exactement un canal existant.",
        },
        { status: 400 },
      );
    }
    if (internalAsyncPreparationDispatch && !asyncPublicationId) {
      return NextResponse.json(
        {
          ok: false,
          code: "async_preparation_invalid",
          error: "Le job interne de préparation est invalide.",
        },
        { status: 400 },
      );
    }
    if (!selected.length) {
      return NextResponse.json(
        {
          ok: false,
          code: "channels_required",
          retryable: false,
          error: "Sélectionnez au moins 1 canal.",
        },
        { status: 400 },
      );
    }
    const clientPreflightFailuresByChannel =
      normalizeClientPreflightFailuresByChannel(
        body.clientPreflightFailuresByChannel,
        selected,
      );
    const dispatchableSelected = selected.filter(
      (channel) => !clientPreflightFailuresByChannel[channel],
    );
    const mediaWorkspaceId = String(body.mediaWorkspaceId || "").trim();
    const strictMediaCutover =
      body.mediaPipelineCutoverV1 === true &&
      isLegacyMediaTransportCutoverEnabled();
    lifecycleWorkspaceId = mediaWorkspaceId;
    lifecycleUserId = userId;

    const requestedOriginSource = String(
      body.source || body.origin?.source || "",
    )
      .trim()
      .toLowerCase();
    const workspacePurpose = internalAsyncWorkerDispatch
      ? body._asyncWorkspacePurpose === "schedule"
        ? "schedule"
        : "publish"
      : Boolean(cronUserId) ||
          requestedOriginSource === "booster_scheduled" ||
          Boolean(body.origin?.scheduledActionId)
        ? "schedule"
        : "publish";

    if (!internalAsyncWorkerDispatch) {
      const ingressWorkflowTool = String(body.workflowTool || "")
        .trim()
        .toLowerCase();
      const ingressWorkflowAction = String(body.workflowAction || "")
        .trim()
        .toLowerCase();
      const ingressTrackType = String(body.workflowTrackType || "")
        .trim()
        .toLowerCase();
      const ingressIsValorisation =
        ingressWorkflowTool === "propulser" &&
        (ingressWorkflowAction === "valoriser" ||
          ingressTrackType === "valorize");
      const ingressEventModule = ingressIsValorisation ? "propulser" : "booster";
      const ingressEventType = ingressIsValorisation ? "valorize" : "publish";
      // A 202 is emitted only after the full preparation request and one
      // placeholder per channel have been committed durably. Without the
      // internal secret there is no recoverable worker path, so fail closed.
      if (!getCronSecret()) {
        return NextResponse.json(
          {
            ok: false,
            code: "publication_worker_unavailable",
            retryable: true,
            error: "Le service de publication en arrière-plan est indisponible.",
          },
          { status: 503 },
        );
      }

      const ingressOrigin = asRecord(body.origin);
      const ingressIdempotencyKey = buildPublishIdempotencyKey({
        body,
        origin: ingressOrigin,
      });
      const ingress = await enqueueBoosterPublication({
        userId,
        body: asRecord(body),
        channels: selected,
        module: ingressEventModule,
        finalEventType: ingressEventType,
        workspacePurpose,
        idempotencyScope: PUBLISH_IDEMPOTENCY_SCOPE,
        idempotencyKey: ingressIdempotencyKey,
        idempotencyTtlMs: PUBLISH_IDEMPOTENCY_TTL_MS,
        idempotencyMetadata: buildPublishIdempotencyMetadata({
          origin: ingressOrigin,
          channels: selected,
          source: requestedOriginSource,
        }),
      });

      if (ingress.state === "completed") {
        return NextResponse.json(ingress.response);
      }
      if (ingress.state === "error") {
        return NextResponse.json(ingress.response, { status: ingress.status });
      }

      const appOrigin = getAppOriginFromRequest(req);
      const internalHeaders = buildInternalCronHeaders(userId);
      if (Object.keys(ingress.preparationRequest).length) {
        after(async () => {
          try {
            await fetch(`${appOrigin}/api/booster/publish-now`, {
              method: "POST",
              headers: internalHeaders,
              body: JSON.stringify(ingress.preparationRequest),
              cache: "no-store",
            });
          } catch (dispatchError) {
            // The durable parent remains queued; the one-minute cron owns retry.
            console.warn("[booster-async] initial preparation dispatch failed", {
              publicationId: ingress.publicationId,
              message:
                dispatchError instanceof Error
                  ? dispatchError.message
                  : String(dispatchError || ""),
            });
          }
        });
      }

      return NextResponse.json(ingress.response, { status: 202 });
    }

    if (internalAsyncPreparationDispatch) {
      const preparationLease = await acquireAsyncPublicationPreparationLease({
        userId,
        publicationId: asyncPublicationId,
      });
      if (
        preparationLease.state === "running" ||
        preparationLease.state === "completed"
      ) {
        return NextResponse.json(
          {
            ok: true,
            done: false,
            queued: true,
            asyncDispatch: true,
            status: "preparing",
            publication_id: asyncPublicationId,
          },
          { status: 202 },
        );
      }
      if (preparationLease.state === "unavailable") {
        return NextResponse.json(
          {
            ok: false,
            code: "async_preparation_lease_unavailable",
            retryable: true,
            error: "La préparation ne peut pas être verrouillée de façon sûre.",
          },
          { status: 503 },
        );
      }
      asyncPreparationFailureContext = {
        userId,
        publicationId: asyncPublicationId,
        preparationLockId: preparationLease.lock?.id || null,
      };
      await updateAsyncPublicationJobEvent({
        userId,
        publicationId: asyncPublicationId,
        patch: {
          status: "preparing",
          stage: "media_preparation",
          preparationAttempt: Math.max(
            1,
            Number(body._asyncPreparationAttempt || 1),
          ),
          preparationStartedAt: new Date().toISOString(),
          lastPreparationError: null,
        },
      });
    }
    const requestedMediaType = normalizePublicationMediaType(body.mediaType);
    const rawRequestedModes = asRecord(body.mediaModeByChannel);
    const requestContainsMedia = dispatchableSelected.some((channel) => {
      const mode = String(
        rawRequestedModes[channel] || requestedMediaType,
      ).trim();
      return mode === "images" || mode === "video";
    });
    const requestedMediaChannels = dispatchableSelected.filter((channel) => {
      const mode = String(
        rawRequestedModes[channel] || requestedMediaType,
      ).trim();
      return mode === "images" || mode === "video";
    });
    const requestedImageChannels = dispatchableSelected.filter((channel) => {
      const mode = String(
        rawRequestedModes[channel] || requestedMediaType,
      ).trim();
      return mode === "images";
    });
    const requestedVideoChannels = dispatchableSelected.filter((channel) => {
      const mode = String(
        rawRequestedModes[channel] || requestedMediaType,
      ).trim();
      return mode === "video";
    });
    const prepareMixedMediaBeforeDispatch = shouldPrepareMixedMediaBeforeDispatch({
      internalAsyncPreparationDispatch,
      preparationAttempt: body._asyncPreparationAttempt,
      imageChannelCount: requestedImageChannels.length,
      videoChannelCount: requestedVideoChannels.length,
    });
    let workspaceConsumption: WorkspacePublicationConsumption | null = null;
    let workspaceFallbackCode = "";
    let workspacePreparationState: Awaited<
      ReturnType<typeof prepareWorkspaceMediaForPublication>
    > | null = null;
    const deferredPreparationChannels = new Set<ChannelKey>();
    const terminalWorkspaceMediaChannels = new Set<ChannelKey>();
    if (
      internalAsyncPreparationDispatch &&
      Number(body._asyncPreparationAttempt || 1) <= 1 &&
      requestedMediaChannels.length > 0 &&
      dispatchableSelected.some(
        (channel) => !requestedMediaChannels.includes(channel),
      )
    ) {
      // First materialize and dispatch channels that need no media. The next
      // preparation attempt owns normalization for the deferred media set, so
      // one long FFmpeg job never delays a text-only channel.
      requestedMediaChannels.forEach((channel) =>
        deferredPreparationChannels.add(channel),
      );
    }

    const hasActiveRequestedMedia = requestedMediaChannels.some(
      (channel) => !deferredPreparationChannels.has(channel),
    );
    const activeRequestedMediaChannels = requestedMediaChannels.filter(
      (channel) => !deferredPreparationChannels.has(channel),
    );
    const activeRequestedMediaTypes = Array.from(
      new Set(
        activeRequestedMediaChannels.map((channel) =>
          String(rawRequestedModes[channel] || requestedMediaType).trim() ===
          "video"
            ? ("video" as const)
            : ("image" as const),
        ),
      ),
    );
    let consumableRequestedMediaChannels = activeRequestedMediaChannels;
    let consumableRequestedMediaTypes = activeRequestedMediaTypes;
    if (mediaWorkspaceId && hasActiveRequestedMedia) {
      try {
        if (
          internalAsyncPreparationDispatch &&
          strictMediaCutover &&
          requestContainsMedia
        ) {
          workspacePreparationState = await prepareWorkspaceMediaForPublication({
            accountId: userId,
            workspaceId: mediaWorkspaceId,
            mediaTypes: activeRequestedMediaTypes,
            videoChannels: activeRequestedMediaChannels.filter(
              (channel) =>
                String(
                  rawRequestedModes[channel] || requestedMediaType,
                ).trim() === "video",
            ),
          });
          if (
            activeRequestedMediaChannels.includes("pinterest") &&
            workspacePreparationState.terminalVideoThumbnailMediaIds.length > 0
          ) {
            terminalWorkspaceMediaChannels.add("pinterest");
          } else if (
            activeRequestedMediaChannels.includes("pinterest") &&
            workspacePreparationState.pendingVideoThumbnailMediaIds.length > 0
          ) {
            deferredPreparationChannels.add("pinterest");
          }

          if (prepareMixedMediaBeforeDispatch) {
            if (workspacePreparationState.terminalImageMediaIds.length > 0) {
              requestedImageChannels.forEach((channel) =>
                terminalWorkspaceMediaChannels.add(channel),
              );
            }
            if (workspacePreparationState.terminalVideoMediaIds.length > 0) {
              requestedVideoChannels.forEach((channel) =>
                terminalWorkspaceMediaChannels.add(channel),
              );
            }

            const mixedMediaStillPending = Boolean(
              workspacePreparationState.pendingMediaIds.length > 0 ||
                workspacePreparationState.pendingVideoThumbnailMediaIds.length > 0,
            );
            if (mixedMediaStillPending) {
              // Une publication mixte reste groupée tant qu'un média doit
              // réellement être préparé. Ainsi l'UI ne publie plus les photos,
              // puis ne revient plus tard à une préparation vidéo avant YouTube.
              requestedMediaChannels.forEach((channel) => {
                if (!terminalWorkspaceMediaChannels.has(channel)) {
                  deferredPreparationChannels.add(channel);
                }
              });
            }
          }
        }

        consumableRequestedMediaChannels = activeRequestedMediaChannels.filter(
          (channel) =>
            !deferredPreparationChannels.has(channel) &&
            !terminalWorkspaceMediaChannels.has(channel),
        );
        consumableRequestedMediaTypes = Array.from(
          new Set(
            consumableRequestedMediaChannels.map((channel) =>
              String(rawRequestedModes[channel] || requestedMediaType).trim() ===
              "video"
                ? ("video" as const)
                : ("image" as const),
            ),
          ),
        );

        if (consumableRequestedMediaTypes.length > 0) {
          workspaceConsumption = await resolveWorkspacePublicationConsumption({
            accountId: userId,
            workspaceId: mediaWorkspaceId,
            purpose: workspacePurpose,
            mediaTypes: consumableRequestedMediaTypes,
          });
        }
      } catch (workspaceError) {
        workspaceFallbackCode =
          workspaceError instanceof MediaWorkspaceConsumptionError
            ? workspaceError.code
            : "workspace_read_failed";
        const logWorkspaceFallback = workspaceFallbackCode === "workspace_media_not_ready"
          ? console.info
          : console.warn;
        logWorkspaceFallback("[booster-publish] workspace media fallback", {
          workspaceId: mediaWorkspaceId,
          purpose: workspacePurpose,
          code: workspaceFallbackCode,
          message:
            workspaceError instanceof Error
              ? workspaceError.message
              : String(workspaceError || "Erreur inconnue"),
        });
        if (strictMediaCutover) {
          if (internalAsyncPreparationDispatch) {
            const mediaChannels = consumableRequestedMediaChannels;
            const terminalMediaFailure = Boolean(
              workspacePreparationState?.terminalMediaIds.length,
            );
            const durableMediaStillPending = Boolean(
              workspacePreparationState?.pendingMediaIds.length,
            );
            if (terminalMediaFailure) {
              mediaChannels.forEach((channel) =>
                terminalWorkspaceMediaChannels.add(channel),
              );
            } else if (
              mediaChannels.length > 0 &&
              (durableMediaStillPending ||
                dispatchableSelected.some(
                  (channel) => !mediaChannels.includes(channel),
                ))
            ) {
              // Let channels without media leave immediately. Media channels
              // remain in their durable `preparing` placeholders and are
              // retried by the preparation cron once normalization is ready.
              mediaChannels.forEach((channel) =>
                deferredPreparationChannels.add(channel),
              );
            } else {
              throw workspaceError instanceof Error
                ? workspaceError
                : new Error("workspace_read_failed");
            }
          } else {
            const status =
              workspaceError instanceof MediaWorkspaceConsumptionError
                ? workspaceError.status
                : 503;
            return NextResponse.json(
              {
                ok: false,
                code: workspaceFallbackCode,
                error:
                  workspaceError instanceof Error
                    ? workspaceError.message
                    : "Le workspace média n'est pas prêt. Réessayez dans quelques instants.",
              },
              { status },
            );
          }
        }
      }
    }

    if (strictMediaCutover && requestContainsMedia && !mediaWorkspaceId) {
      if (internalAsyncPreparationDispatch) {
        requestedMediaChannels.forEach((channel) => {
          deferredPreparationChannels.delete(channel);
          terminalWorkspaceMediaChannels.add(channel);
        });
      } else {
        return NextResponse.json(
          {
            ok: false,
            code: "media_workspace_required",
            error: "Le workspace média est requis pour publier avec le nouveau pipeline.",
          },
          { status: 409 },
        );
      }
    }

    const activePreparationSelected = dispatchableSelected.filter(
      (channel) =>
        !deferredPreparationChannels.has(channel) &&
        !terminalWorkspaceMediaChannels.has(channel),
    );
    const workspaceHasImages = Boolean(workspaceConsumption?.images.length);
    const workspaceHasVideo = Boolean(workspaceConsumption?.video);

    let mediaType = requestedMediaType;
    if (workspaceHasVideo && !workspaceHasImages) mediaType = "video";
    if (workspaceHasImages && !workspaceHasVideo) mediaType = "images";

    const rawModeByChannel = (body.mediaModeByChannel || {}) as Record<
      string,
      unknown
    >;
    const defaultMediaMode: ChannelMediaMode =
      mediaType === "video" ? "video" : "images";
    const mediaModeByChannel = Object.fromEntries(
      selected.map((channel) => [
        channel,
        normalizeChannelMediaMode(rawModeByChannel[channel], defaultMediaMode),
      ]),
    ) as Partial<Record<ChannelKey, ChannelMediaMode>>;
    const preflightFailuresByChannel: Partial<
      Record<ChannelKey, JsonRecord>
    > = { ...clientPreflightFailuresByChannel };
    const setPreflightFailure = (
      channel: ChannelKey,
      failure: {
        code: string;
        error: string;
        retryable?: boolean;
        [key: string]: unknown;
      },
    ) => {
      if (preflightFailuresByChannel[channel]) return;
      preflightFailuresByChannel[channel] = {
        ok: false,
        retryable: failure.retryable !== false,
        ...failure,
      };
    };
    const videoSettingsByChannel = buildVideoSettingsByChannel({
      channels: selected,
      videoSettingsByChannel: body.videoSettingsByChannel,
      videoFormatByChannel: body.videoFormatByChannel,
      videoAdaptationModeByChannel: body.videoAdaptationModeByChannel,
    });
    const tiktokPublicationSettings = normalizeTiktokPublicationSettings(
      body.tiktokPublicationSettings,
    );
    const pinterestPublicationSettings = asRecord(
      body.pinterestPublicationSettings,
    );
    const requestedPinterestBoardId = String(
      pinterestPublicationSettings.boardId ||
        pinterestPublicationSettings.board_id ||
        "",
    ).trim();
    const requestedPinterestBoardName = String(
      pinterestPublicationSettings.boardName ||
        pinterestPublicationSettings.board_name ||
        "",
    ).trim();
    const hasAnyImageChannel = activePreparationSelected.some(
      (channel) => mediaModeByChannel[channel] === "images",
    );
    const hasAnyVideoChannel = activePreparationSelected.some(
      (channel) => mediaModeByChannel[channel] === "video",
    );
    const rawImagesByChannelPayload = asRecord(body.imagesByChannel);
    const rawBaseImagesPayload: unknown[] = Array.isArray(body.images)
      ? body.images
      : [];
    const hasUsableImagePayload = (value: unknown) => {
      const image = asRecord(value);
      return Boolean(
        image.storagePath ||
          image.publicUrl ||
          image.renderedUrl ||
          image.originalPublicUrl ||
          image.originalUrl ||
          image.url ||
          image.dataUrl,
      );
    };
    const hasImageFallbackForChannel = (channel: ChannelKey) => {
      const channelImages = rawImagesByChannelPayload[channel];
      return (
        (Array.isArray(channelImages) &&
          channelImages.some((image: unknown) => hasUsableImagePayload(image))) ||
        rawBaseImagesPayload.some((image: unknown) =>
          hasUsableImagePayload(image),
        )
      );
    };
    if (strictMediaCutover) {
      selected.forEach((channel) => {
        const expectedMode = mediaModeByChannel[channel];
        if (
          expectedMode !== "images" &&
          expectedMode !== "video"
        ) {
          return;
        }
        if (deferredPreparationChannels.has(channel)) return;
        if (terminalWorkspaceMediaChannels.has(channel)) {
          setPreflightFailure(channel, {
            code: "workspace_media_preparation_failed",
            error:
              "La préparation serveur du média a échoué. Retirez-le puis ajoutez-le de nouveau.",
            retryable: false,
          });
          return;
        }
        if (expectedMode === "images" && workspaceHasImages) return;
        if (expectedMode === "video" && workspaceHasVideo) return;
        if (expectedMode === "images" && hasImageFallbackForChannel(channel)) {
          return;
        }
        setPreflightFailure(channel, {
          code: "workspace_media_mismatch",
          error:
            workspaceConsumption?.mediaType === "none"
              ? "Le média est encore absent du workspace. Réessayez dans quelques instants."
              : "Le type de média du workspace ne correspond plus à ce canal.",
        });
      });
    }

    let images = hasAnyImageChannel
      ? ((Array.isArray(body.images) ? body.images : []) as ImagePayload[])
      : [];
    if (
      hasAnyImageChannel &&
      workspaceHasImages &&
      workspaceConsumption &&
      workspaceConsumption.images.length
    ) {
      images = workspaceConsumption.images;
    }

    let imagesByChannel = hasAnyImageChannel
      ? (((body.imagesByChannel || {}) as ImagesByChannel) || {})
      : {};
    let imageSettingsByChannel = hasAnyImageChannel
      ? ((body.imageSettingsByChannel || {}) as Record<string, unknown>)
      : {};

    if (
      strictMediaCutover &&
      hasAnyImageChannel &&
      workspaceHasImages &&
      workspaceConsumption
    ) {
      const imageChannels = activePreparationSelected.filter(
        (channel) =>
          mediaModeByChannel[channel] === "images" &&
          !preflightFailuresByChannel[channel],
      );
      const preparedImagesByChannel: ImagesByChannel = {};
      const preparedImageSettingsByChannel: Record<string, unknown> = {
        ...imageSettingsByChannel,
      };
      let imagePreparation: Awaited<
        ReturnType<typeof prepareBoosterImagesByChannelOnServer>
      > | null = null;
      try {
        imagePreparation = await prepareBoosterImagesByChannelOnServer({
          accountId: userId,
          workspaceId: mediaWorkspaceId,
          channels: imageChannels,
          images: workspaceConsumption.images,
          settingsByChannel: imageSettingsByChannel as any,
        });
      } catch (preparationError) {
        imageChannels.forEach((channel) => {
          setPreflightFailure(channel, {
            code: "workspace_image_preparation_failed",
            error: "Les images du workspace n'ont pas pu être préparées pour ce canal.",
            preparationError:
              preparationError instanceof Error
                ? preparationError.message
                : String(preparationError || ""),
          });
        });
      }
      imageChannels.forEach((channel) => {
        if (!imagePreparation) return;
        preparedImagesByChannel[channel] =
          (imagePreparation.imagesByChannel[channel] as unknown as ImagePayload[]) || [];
        preparedImageSettingsByChannel[channel] =
          imagePreparation.imageSettingsByChannel[channel] ||
          imageSettingsByChannel[channel];
        if (!preparedImagesByChannel[channel]?.length) {
          setPreflightFailure(channel, {
            code: "workspace_image_preparation_failed",
            error: "Les images du workspace n'ont pas pu être préparées pour ce canal.",
            warnings: imagePreparation.warnings.filter(
              (warning) => warning.channel === channel,
            ),
          });
        }
      });
      imagesByChannel = preparedImagesByChannel;
      imageSettingsByChannel = preparedImageSettingsByChannel;
    }

    // En cutover strict, seule la vidéo canonique résolue depuis le workspace
    // peut atteindre les fournisseurs. Le payload historique reste disponible
    // uniquement lorsque le flag de rollback désactive le cutover.
    const legacyVideoResult = hasAnyVideoChannel && !strictMediaCutover
      ? await normalizeVideoPayload(body.video)
      : {
          video: null as PersistedVideoAttachment | null,
          error: undefined as string | undefined,
        };
    let publicationVideo = legacyVideoResult.video;
    let videoPayloadError = legacyVideoResult.error;
    let fallbackVideoCompatibilityProbedByServer = false;

    if (
      hasAnyVideoChannel &&
      workspaceHasVideo &&
      workspaceConsumption &&
      workspaceConsumption.video
    ) {
      const workspaceVideoResult = await normalizeVideoPayload(
        workspaceConsumption.video,
      );
      if (workspaceVideoResult.video) {
        publicationVideo = {
          ...workspaceVideoResult.video,
          thumbnailUrl:
            workspaceVideoResult.video.thumbnailUrl ||
            (!strictMediaCutover
              ? legacyVideoResult.video?.thumbnailUrl
              : null) ||
            null,
          thumbnailStoragePath:
            workspaceVideoResult.video.thumbnailStoragePath ||
            (!strictMediaCutover
              ? legacyVideoResult.video?.thumbnailStoragePath
              : null) ||
            null,
          thumbnailBucket:
            workspaceVideoResult.video.thumbnailBucket ||
            (!strictMediaCutover
              ? legacyVideoResult.video?.thumbnailBucket
              : null) ||
            null,
          transformedVariants: strictMediaCutover
            ? []
            : legacyVideoResult.video?.transformedVariants || [],
        };
        videoPayloadError = undefined;
      } else if (!publicationVideo) {
        videoPayloadError = workspaceVideoResult.error;
      }
    }

    if (
      !strictMediaCutover &&
      internalAsyncPreparationDispatch &&
      hasAnyVideoChannel &&
      publicationVideo &&
      !workspaceHasVideo
    ) {
      try {
        const fallbackProbe = await probeStoredBoosterVideoForPublication({
          accountId: userId,
          bucket: publicationVideo.bucket,
          storagePath: publicationVideo.storagePath,
        });
        publicationVideo = applyServerVideoFallbackAttestation(
          publicationVideo,
          fallbackProbe,
        );
        fallbackVideoCompatibilityProbedByServer = true;
        videoPayloadError = undefined;
      } catch (fallbackProbeError) {
        console.warn("[booster-publish] durable fallback video probe failed", {
          publicationId: asyncPublicationId,
          storagePath: publicationVideo.storagePath,
          message:
            fallbackProbeError instanceof Error
              ? fallbackProbeError.message
              : String(fallbackProbeError || ""),
        });
        // Keep only video channels in the durable preparation phase. Images
        // and text already leave independently; the cron retries the bounded
        // Storage probe and eventually reports a per-channel failure.
        if (internalAsyncPreparationDispatch) {
          activePreparationSelected
            .filter((channel) => mediaModeByChannel[channel] === "video")
            .forEach((channel) => deferredPreparationChannels.add(channel));
        }
      }
    }

    if (
      publicationVideo &&
      activePreparationSelected.includes("youtube_shorts") &&
      mediaModeByChannel.youtube_shorts === "video"
    ) {
      videoSettingsByChannel.youtube_shorts =
        getAutomaticVideoSettingsForPublication({
          channel: "youtube_shorts",
          settings: videoSettingsByChannel.youtube_shorts,
          durationSeconds:
            workspaceHasVideo &&
            (publicationVideo.sourceMetadata?.compatibilityProof ===
              "server_ffmpeg" ||
              publicationVideo.sourceMetadata?.compatibilityProof ===
                "canonical_derivative")
              ? publicationVideo.duration
              : null,
        });
    }

    // A legacy/client payload can describe a video for the UI, but only the
    // workspace resolver can attest the bytes probed by FFmpeg (or a canonical
    // derivative produced by our pipeline). Never let client codec/FPS,
    // dimensions or duration authorize _or block_ the final dispatch.
    const hasTrustedPublicationVideoCompatibilityProof = Boolean(
      (workspaceHasVideo ||
        fallbackVideoCompatibilityProbedByServer ||
        (internalAsyncDispatch &&
          body._asyncTrustedVideoCompatibilityProof === true)) &&
        (publicationVideo?.sourceMetadata?.compatibilityProof ===
          "server_ffmpeg" ||
          publicationVideo?.sourceMetadata?.compatibilityProof ===
            "canonical_derivative"),
    );
    const trustedPublicationVideoMetadata =
      hasTrustedPublicationVideoCompatibilityProof
        ? publicationVideo?.sourceMetadata || null
        : null;
    const trustedPublicationVideoDuration =
      hasTrustedPublicationVideoCompatibilityProof
        ? publicationVideo?.duration ?? null
        : null;

    if (strictMediaCutover && hasAnyVideoChannel && publicationVideo) {
      const sourceWidth = Number(trustedPublicationVideoMetadata?.width || 0) || null;
      const sourceHeight = Number(trustedPublicationVideoMetadata?.height || 0) || null;
      const videoVariantRequest = activePreparationSelected
        .filter(
          (channel) =>
            mediaModeByChannel[channel] === "video" &&
            !deferredPreparationChannels.has(channel) &&
            !preflightFailuresByChannel[channel],
        )
        .flatMap((channel) => {
          if (channel === "gmb") {
            const decision = getGoogleBusinessVideoPreparationDecision({
              name: publicationVideo?.name,
              type: publicationVideo?.type,
              storagePath: publicationVideo?.storagePath,
              sizeBytes: publicationVideo?.size,
              durationSeconds: trustedPublicationVideoDuration,
              width: sourceWidth,
              height: sourceHeight,
              videoCodec: trustedPublicationVideoMetadata?.videoCodec,
              audioCodec: trustedPublicationVideoMetadata?.audioCodec,
              frameRate: trustedPublicationVideoMetadata?.frameRate,
              hasAudio: trustedPublicationVideoMetadata?.hasAudio,
              containerFormats:
                trustedPublicationVideoMetadata?.containerFormats,
              pixelFormat: trustedPublicationVideoMetadata?.pixelFormat,
            });
            if (decision.action === "block") {
              setPreflightFailure("gmb", {
                code: decision.errorCode,
                error: decision.errorMessage,
                retryable: false,
              });
              return [];
            }
          }
          const settings = videoSettingsByChannel[channel];
          if ((settings?.format || "original") === "original") {
            const validation = validateVideoPublicationForChannel({
              channel,
              name: publicationVideo?.name || "video.mp4",
              type: publicationVideo?.type,
              storagePath: publicationVideo?.storagePath,
              sizeBytes: publicationVideo?.size,
              durationSeconds: trustedPublicationVideoDuration,
              width: sourceWidth,
              height: sourceHeight,
              videoCodec: trustedPublicationVideoMetadata?.videoCodec,
              audioCodec: trustedPublicationVideoMetadata?.audioCodec,
              frameRate: trustedPublicationVideoMetadata?.frameRate,
              hasAudio: trustedPublicationVideoMetadata?.hasAudio,
              containerFormats:
                trustedPublicationVideoMetadata?.containerFormats,
              pixelFormat: trustedPublicationVideoMetadata?.pixelFormat,
              requireCodecProof: true,
            });
            if (!validation.ok) {
              setPreflightFailure(channel, {
                code: validation.reason,
                error: validation.message,
                retryable: false,
              });
            }
            // Original signifie réellement original : aucune recherche de
            // variante, aucun téléchargement et aucun FFmpeg au clic Publier.
            return [];
          }
          return [{
            key: `${channel}-${settings?.format || "original"}-${settings?.adaptationMode || "safe_frame"}`,
            channel: channel as any,
            format: settings?.format,
            adaptationMode: settings?.adaptationMode,
            publicationProfile: getVideoPublicationProfileForChannel(channel as any),
          }];
        });
      const videoSource = publicationVideo;
      const preparePublicationVariants = async (generateMissing: boolean) =>
        await prepareBoosterVideoVariantsOnServer({
          accountId: userId,
          workspaceId: mediaWorkspaceId,
          mediaId: videoSource.mediaId || undefined,
          generateMissing,
          source: {
            bucket: videoSource.bucket || "booster",
            storagePath: videoSource.storagePath,
            publicUrl: videoSource.publicUrl,
            url: videoSource.url,
            name: videoSource.name,
            type: videoSource.type,
            size: videoSource.size,
            duration: videoSource.duration,
            sourceMetadata: videoSource.sourceMetadata,
          },
          trustedSourceCompatibilityProof:
            hasTrustedPublicationVideoCompatibilityProof,
          variants: videoVariantRequest,
        });

      const collectInvalidVideoChannels = (
        candidateResult: Awaited<ReturnType<typeof preparePublicationVariants>>,
      ) =>
        videoVariantRequest.flatMap((request) => {
          const signature = buildVideoTransformSignature(
            request.format || "original",
            request.adaptationMode || "safe_frame",
            request.publicationProfile,
          );
          const variant = candidateResult.variants.find(
            (candidate) => candidate.signature === signature,
          );
          if (!variant?.publicUrl || !variant?.storagePath) {
            return [{
              channel: request.channel,
              signature,
              reason: "video_variant_required",
              message: "La variante vidéo explicitement choisie doit être prête avant publication sur ce canal.",
            }];
          }
          const validation = validateVideoPublicationForChannel({
            channel: request.channel,
            name: variant.name || `video-${request.channel}.mp4`,
            type: variant.contentType,
            storagePath: variant.storagePath,
            sizeBytes: variant.size,
            durationSeconds: variant.duration ?? videoSource.duration,
            width: variant.width,
            height: variant.height,
          });
          if (validation.ok) return [];
          return [{
            channel: request.channel,
            signature,
            reason: validation.reason,
            message: validation.message,
          }];
        });

      // Only the durable preparation worker may run FFmpeg. Channel workers
      // receive the persisted derivatives and therefore never regenerate.
      // A failed derivative is converted below into one channel preflight
      // failure; it never prevents the other channel jobs from being queued.
      const variantResult = await preparePublicationVariants(
        internalAsyncPreparationDispatch,
      );
      const invalidVideoChannels = collectInvalidVideoChannels(
        variantResult,
      );

      publicationVideo = {
        ...videoSource,
        transformedVariants: variantResult.variants,
      };
      invalidVideoChannels.forEach((invalid) => {
        const reason = String(
          invalid.reason || "workspace_video_preparation_pending",
        );
        setPreflightFailure(invalid.channel as ChannelKey, {
          code: reason,
          error:
            invalid.message ||
            "La vidéo est encore en cours de préparation pour ce canal. Patientez quelques instants puis relancez la publication.",
          retryable: ![
            "video_duration_too_long",
            "video_duration_too_short",
            "video_duration_account_limit_unknown",
            "video_duration_long_upload_not_allowed",
          ].includes(reason),
          signature: invalid.signature,
          preparationErrors: variantResult.errors,
        });
      });
    }

    const {
      getPublicationVideoForChannel,
      buildPublicationVideoByChannel,
    } = createPublishNowVideoContext({
      publicationVideo,
      videoSettingsByChannel,
      selected,
      mediaModeByChannel,
    });

    if (!strictMediaCutover && hasAnyVideoChannel && publicationVideo) {
      const invalidLegacyVideoChannels = activePreparationSelected
        .filter(
          (channel) =>
            mediaModeByChannel[channel] === "video" &&
            !deferredPreparationChannels.has(channel) &&
            !preflightFailuresByChannel[channel],
        )
        .flatMap((channel) => {
          if (channel === "gmb") {
            const decision = getGoogleBusinessVideoPreparationDecision({
              name: publicationVideo?.name,
              type: publicationVideo?.type,
              storagePath: publicationVideo?.storagePath,
              sizeBytes: publicationVideo?.size,
              durationSeconds: trustedPublicationVideoDuration,
              width: trustedPublicationVideoMetadata?.width,
              height: trustedPublicationVideoMetadata?.height,
              videoCodec: trustedPublicationVideoMetadata?.videoCodec,
              audioCodec: trustedPublicationVideoMetadata?.audioCodec,
              frameRate: trustedPublicationVideoMetadata?.frameRate,
              hasAudio: trustedPublicationVideoMetadata?.hasAudio,
              containerFormats:
                trustedPublicationVideoMetadata?.containerFormats,
              pixelFormat: trustedPublicationVideoMetadata?.pixelFormat,
            });
            if (decision.action === "block") {
              setPreflightFailure("gmb", {
                code: decision.errorCode,
                error: decision.errorMessage,
                retryable: false,
              });
              return [];
            }
          }
          const settings = videoSettingsByChannel[channel];
          const usesOriginalSource =
            !settings || settings.format === "original";
          const profile = getVideoPublicationProfileForChannel(channel as any);
          const signature = settings
            ? buildVideoTransformSignature(
                settings.format,
                settings.adaptationMode,
                profile,
              )
            : "";
          const variant = settings
            ? publicationVideo.transformedVariants?.find(
                (candidate) => candidate.signature === signature,
              )
            : null;
          const variantValidation = variant?.publicUrl && variant?.storagePath
            ? validateVideoPublicationForChannel({
                channel,
                name: variant.name || `video-${channel}.mp4`,
                type: variant.contentType,
                storagePath: variant.storagePath,
                sizeBytes: variant.size,
                durationSeconds: variant.duration ?? publicationVideo.duration,
                width: variant.width,
                height: variant.height,
              })
            : null;
          if (variantValidation?.ok) return [];

          const policy = getVideoPublicationPolicy(channel);
          const sourceValidation = validateVideoPublicationForChannel({
            channel,
            name: publicationVideo.name,
            type: publicationVideo.type,
            storagePath: publicationVideo.storagePath,
            sizeBytes: publicationVideo.size,
            durationSeconds: trustedPublicationVideoDuration,
            width: trustedPublicationVideoMetadata?.width,
            height: trustedPublicationVideoMetadata?.height,
            videoCodec: trustedPublicationVideoMetadata?.videoCodec,
            audioCodec: trustedPublicationVideoMetadata?.audioCodec,
            frameRate: trustedPublicationVideoMetadata?.frameRate,
            hasAudio: trustedPublicationVideoMetadata?.hasAudio,
            containerFormats:
              trustedPublicationVideoMetadata?.containerFormats,
            pixelFormat: trustedPublicationVideoMetadata?.pixelFormat,
            requireCodecProof: true,
          });
          const sourceDirectlyPublishable =
            hasTrustedPublicationVideoCompatibilityProof &&
            canPublishVideoSourceDirectly({
              name: publicationVideo.name,
              type: publicationVideo.type,
              storagePath: publicationVideo.storagePath,
              sizeBytes: publicationVideo.size,
              maxBytes: policy.maxBytes,
              videoCodec: trustedPublicationVideoMetadata?.videoCodec,
              audioCodec: trustedPublicationVideoMetadata?.audioCodec,
              frameRate: trustedPublicationVideoMetadata?.frameRate,
              hasAudio: trustedPublicationVideoMetadata?.hasAudio,
              containerFormats:
                trustedPublicationVideoMetadata?.containerFormats,
              pixelFormat: trustedPublicationVideoMetadata?.pixelFormat,
              requireCodecProof: true,
            }) && sourceValidation.ok;
          if (usesOriginalSource && sourceDirectlyPublishable) {
            return [];
          }

          const failedValidation =
            variantValidation && !variantValidation.ok
              ? variantValidation
              : sourceValidation;
          return [{
            channel,
            signature: signature || null,
            reason: failedValidation.ok
              ? "publishable_video_missing"
              : failedValidation.reason,
            message: failedValidation.ok
              ? "La variante vidéo demandée n’est pas encore prête."
              : failedValidation.message,
          }];
        });
      invalidLegacyVideoChannels.forEach((invalid) => {
        const reason = String(invalid.reason || "video_variant_required");
        setPreflightFailure(invalid.channel as ChannelKey, {
          code: reason,
          error:
            invalid.message ||
            "La vidéo doit être préparée en MP4 compatible avec les limites de ce canal avant publication.",
          retryable: ![
            "video_duration_too_long",
            "video_duration_too_short",
            "video_duration_account_limit_unknown",
            "video_duration_long_upload_not_allowed",
          ].includes(reason),
          signature: invalid.signature,
        });
      });
    }

    if (hasAnyVideoChannel && videoPayloadError) {
      selected
        .filter((channel) => mediaModeByChannel[channel] === "video")
        .forEach((channel) =>
          setPreflightFailure(channel, {
            code: "video_payload_invalid",
            error: videoPayloadError,
            retryable: false,
          }),
        );
    }
    if (hasAnyVideoChannel && !publicationVideo) {
      selected
        .filter((channel) => mediaModeByChannel[channel] === "video")
        .forEach((channel) =>
          setPreflightFailure(channel, {
            code: "video_required",
            error: "Ajoutez une vidéo avant de publier sur ce canal.",
            retryable: false,
          }),
        );
    }

    const workflowToolRaw = String(body.workflowTool || "")
      .trim()
      .toLowerCase();
    const workflowActionRaw = String(body.workflowAction || "")
      .trim()
      .toLowerCase();
    const workflowTrackTypeRaw = String(body.workflowTrackType || "")
      .trim()
      .toLowerCase();
    const isValorisation =
      workflowToolRaw === "propulser" &&
      (workflowActionRaw === "valoriser" ||
        workflowTrackTypeRaw === "valorize");
    const eventModule = isValorisation ? "propulser" : "booster";
    const eventType = isValorisation ? "valorize" : "publish";
    const workflowAction = isValorisation ? "valoriser" : "publier";
    const originSource = String(
      body.source || body.origin?.source || "",
    ).trim();
    const origin = (() => {
      if (originSource === "inr_agent") {
        return {
          source: "inr_agent",
          label:
            String(body.origin?.label || "iNr'Agent").trim() || "iNr'Agent",
          agentActionId:
            String(
              body.inrAgentActionId || body.origin?.agentActionId || "",
            ).trim() || null,
          scheduledActionId:
            String(body.origin?.scheduledActionId || "").trim() || null,
          automationKey:
            String(
              body.automationKey || body.origin?.automationKey || "publish",
            ).trim() || "publish",
          workflowTool: eventModule,
          workflowAction,
        };
      }
      if (originSource === "booster_scheduled") {
        return {
          source: "booster_scheduled",
          label:
            String(body.origin?.label || "Booster programmé").trim() ||
            "Booster programmé",
          scheduledActionId:
            String(body.origin?.scheduledActionId || "").trim() || null,
          automationKey:
            String(body.origin?.automationKey || "publish").trim() || "publish",
          workflowTool: eventModule,
          workflowAction,
        };
      }
      if (originSource === "booster_manual" || originSource === "manual") {
        return {
          source: originSource,
          label:
            String(
              body.origin?.label ||
                (originSource === "booster_manual" ? "Booster" : "Manuel"),
            ).trim() || "Booster",
          workflowTool: eventModule,
          workflowAction,
        };
      }
      return null;
    })();
    const originRecord = asRecord(origin);
    const scheduledActionId = String(
      body.origin?.scheduledActionId || originRecord.scheduledActionId || "",
    ).trim();
    const isScheduledExecution =
      internalAsyncWorkerDispatch
        ? workspacePurpose === "schedule"
        : Boolean(cronUserId) ||
          origin?.source === "booster_scheduled" ||
          Boolean(origin?.source === "inr_agent" && scheduledActionId);
    const shouldCheckImmediateDuplicate =
      !internalAsyncDispatch &&
      eventType === "publish" &&
      !isScheduledExecution &&
      body.skipScheduledDuplicateCheck !== true &&
      body.allowDuplicateImmediatePublish !== true;

    const syncMediaWorkspaceLifecycle = async (
      status: "publishing" | "published" | "failed",
      metadata: Record<string, unknown> = {},
    ) => {
      if (!mediaWorkspaceId) return;
      await syncPublicationWorkspaceContext({
        accountId: userId,
        workspaceId: mediaWorkspaceId,
        operation: "publish",
        idea,
        selectedChannels: selected,
        generatedContent: { postByChannel },
        status,
        metadata: {
          executionSource: origin?.source || originSource || "manual",
          scheduledExecution: isScheduledExecution,
          consumptionSource: strictMediaCutover ? "workspace_cutover_v1" : workspaceConsumption?.source || "legacy_fallback",
          consumptionPurpose: workspacePurpose,
          workspaceRevisionRead: workspaceConsumption?.workspaceRevision || null,
          workspaceFallbackCode: workspaceFallbackCode || null,
          ...metadata,
        },
      }).catch((workspaceSyncError) => {
        console.warn("[booster-publish] workspace lifecycle sync skipped", {
          workspaceId: mediaWorkspaceId,
          status,
          message:
            workspaceSyncError instanceof Error
              ? workspaceSyncError.message
              : String(workspaceSyncError || "Erreur inconnue"),
        });
      });
    };

    if (shouldCheckImmediateDuplicate) {
      const duplicate = await findSimilarUpcomingScheduledPublication({
        supabase: supabaseAdmin,
        userId,
        channels: selected,
        payload: {
          ...body,
          channels: selected,
          post,
          postByChannel,
        },
        lookaheadMinutes: IMMEDIATE_PUBLISH_DUPLICATE_LOOKAHEAD_MINUTES,
      });

      if (duplicate.duplicate) {
        const duplicateMessage = buildImmediateDuplicateMessage(duplicate);
        if (internalAsyncPreparationDispatch) {
          const persistedEventIds = asRecord(body._asyncChannelEventIds);
          const duplicateFailure = {
            ok: false,
            code: "scheduled_publication_duplicate",
            retryable: false,
            error: duplicateMessage,
            duplicate,
          };
          await Promise.all(
            selected.map((channel) =>
              updateAsyncChannelEvent({
                userId,
                eventId: cleanExecutionIdempotencyKey(
                  persistedEventIds[channel],
                ),
                patch: {
                  status: "failed",
                  channel,
                  result: duplicateFailure,
                  completedAt: new Date().toISOString(),
                },
              }),
            ),
          );
          await completeAsyncPublicationPreparationLease({
            lockId: asyncPreparationFailureContext?.preparationLockId || null,
            publicationId: asyncPublicationId,
          });
          asyncPreparationFailureContext = null;
          const finalization = await finalizeAsyncPublicationIfReady({
            userId,
            publicationId: asyncPublicationId,
          });
          return NextResponse.json({
            ...asRecord(finalization.payload),
            ok: false,
            queued: false,
            asyncDispatch: true,
            publication_id: asyncPublicationId,
          });
        }
        return NextResponse.json(
          {
            ok: false,
            error: duplicateMessage,
            user_message: duplicateMessage,
            code: "scheduled_publication_duplicate",
            duplicate,
          },
          { status: 409 },
        );
      }
    }

    const publishIdempotencyKey = internalAsyncWorkerDispatch
      ? cleanExecutionIdempotencyKey(body._asyncParentIdempotencyKey)
      : buildPublishIdempotencyKey({ body, origin });
    const publishIdempotency = internalAsyncWorkerDispatch
      ? { state: "acquired" as const, lock: null }
      : publishIdempotencyKey
        ? await acquireExecutionIdempotencyLock({
            supabase: supabaseAdmin,
            userId,
            scope: PUBLISH_IDEMPOTENCY_SCOPE,
            idempotencyKey: publishIdempotencyKey,
            ttlMs: PUBLISH_IDEMPOTENCY_TTL_MS,
            metadata: buildPublishIdempotencyMetadata({
              origin,
              channels: selected,
              source: origin?.source || originSource || "",
            }),
          })
        : { state: "acquired" as const, lock: null };

    if (publishIdempotency.state === "completed") {
      return NextResponse.json(
        buildCompletedExecutionResponse(publishIdempotency.lock),
      );
    }

    if (publishIdempotency.state === "running") {
      return NextResponse.json(
        buildRunningExecutionResponse(publishIdempotency.lock),
        {
          status: 425,
          headers: { "Retry-After": "60" },
        },
      );
    }

    publishIdempotencyLockId = internalAsyncWorkerDispatch
      ? cleanExecutionIdempotencyKey(body._asyncParentIdempotencyLockId) || null
      : publishIdempotency.lock?.id || null;
    shouldFailPublishIdempotencyLockOnError =
      !internalAsyncWorkerDispatch && Boolean(publishIdempotencyLockId);

    const hadAnyImageInput =
      hasAnyImageChannel &&
      (images.length > 0 ||
        workspaceHasImages ||
        Object.values(imagesByChannel).some(
          (value) => Array.isArray(value) && value.length > 0,
        ));

    const publicationId = internalAsyncWorkerDispatch
      ? asyncPublicationId
      : randomUUID();
    let asyncChannelLockId: string | null = null;

    if (internalAsyncDispatch) {
      const channel = selected[0];
      const instagramVideoContinuationAttempt = Math.max(
        0,
        Math.floor(Number(body._instagramVideoContinuationAttempt || 0)),
      );
      const youtubeUploadContinuationAttempt = Math.max(
        0,
        Math.floor(Number(body._youtubeUploadContinuationAttempt || 0)),
      );
      const pinterestVideoContinuationAttempt = Math.max(
        0,
        Math.floor(Number(body._pinterestVideoContinuationAttempt || 0)),
      );
      const channelIdempotencyKey =
        channel === "instagram" &&
        Object.keys(asRecord(body._instagramVideoCheckpoint)).length > 0 &&
        instagramVideoContinuationAttempt > 0
          ? `${publicationId}:${channel}:video:${instagramVideoContinuationAttempt}`
          : channel === "youtube_shorts" &&
              Object.keys(asRecord(body._youtubeUploadCheckpoint)).length > 0 &&
              youtubeUploadContinuationAttempt > 0
            ? `${publicationId}:${channel}:video:${youtubeUploadContinuationAttempt}`
            : channel === "pinterest" &&
                body._pinterestVideoCheckpoint !== null &&
                body._pinterestVideoCheckpoint !== undefined &&
                pinterestVideoContinuationAttempt > 0
              ? `${publicationId}:${channel}:video:${pinterestVideoContinuationAttempt}`
              : `${publicationId}:${channel}`;
      const channelExecution = await acquireExecutionIdempotencyLock({
        supabase: supabaseAdmin,
        userId,
        scope: BOOSTER_ASYNC_CHANNEL_SCOPE,
        idempotencyKey: channelIdempotencyKey,
        ttlMs: BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS,
        metadata: {
          publicationId,
          channel,
          channelEventId: asyncChannelEventId,
          asyncDispatch: true,
        },
      });

      if (channelExecution.state === "completed") {
        await finalizeAsyncPublicationIfReady({ userId, publicationId }).catch(
          () => undefined,
        );
        return NextResponse.json(
          buildCompletedExecutionResponse(channelExecution.lock),
        );
      }

      if (channelExecution.state === "running") {
        return NextResponse.json(
          {
            ...buildRunningExecutionResponse(channelExecution.lock),
            queued: true,
            asyncDispatch: true,
            publication_id: publicationId,
            channel,
          },
          { status: 425, headers: { "Retry-After": "60" } },
        );
      }

      // Le claim arrive avant tout upload/dérivé par canal. Le départ initial
      // compte déjà comme tentative 1 dans l'événement créé par le parent ; le
      // worker ne double donc plus le compteur du cron.
      asyncChannelLockId = channelExecution.lock?.id || null;
      asyncFailureContext = {
        userId,
        publicationId,
        channel,
        channelEventId: asyncChannelEventId,
        channelLockId: asyncChannelLockId,
      };
      await updateAsyncChannelEvent({
        userId,
        eventId: asyncChannelEventId,
        patch: {
          status: "processing",
          startedAt: new Date().toISOString(),
          channel,
        },
      });
      await supabaseAdmin
        .from("publication_deliveries")
        .update({ status: "processing", error: null })
        .eq("publication_id", publicationId)
        .eq("user_id", userId)
        .eq("channel", channel);
    }
    const publicationVideoByChannel = buildPublicationVideoByChannel();

    const getChannelPost = createPublishNowPostResolver({
      post,
      postByChannel,
    });

    const firstPost = getChannelPost(selected[0]);

    if (!internalAsyncDispatch) {
      await syncMediaWorkspaceLifecycle("publishing", {
        publicationId,
        attemptedChannels: selected,
      });
    }

    const selectedImageFormats = hasAnyImageChannel
      ? mergeImageFormats(
          ...activePreparationSelected
            .filter(
              (channel) =>
                mediaModeByChannel[channel] === "images" &&
                !preflightFailuresByChannel[channel],
            )
            .map((channel) => getRequiredImageFormatsForChannel(channel)),
        )
      : EMPTY_IMAGE_FORMATS;

    // 1) Upload images to Supabase Storage (bucket: booster) + collect diagnostics.
    // Only prepare the image derivatives required by the selected channels.
    const { imageSet: baseImageSet, uploadErrors } = await uploadImageSet(
      userId,
      strictMediaCutover ? [] : images,
      selectedImageFormats,
    );
    const uploadedUrls = baseImageSet.images;
    const publishableUrls = baseImageSet.publishableUrls;
    const instagramPublishableUrls = baseImageSet.instagramPublishableUrls;
    const socialFeedPublishableUrls = baseImageSet.socialFeedPublishableUrls;
    const siteCardPublishableUrls = baseImageSet.siteCardPublishableUrls;
    const gmbPublishableUrls = baseImageSet.gmbPublishableUrls;

    const originalSourceUrlByKey = new Map<string, string>();
    (baseImageSet.imageKeys || []).forEach((key, index) => {
      const normalizedKey = String(key || "").trim();
      const url = String(baseImageSet.images[index] || "").trim();
      if (normalizedKey && url) originalSourceUrlByKey.set(normalizedKey, url);
    });

    const channelImageSets: Partial<Record<ChannelKey, ImageSet>> = {};
    for (const channel of activePreparationSelected) {
      if (preflightFailuresByChannel[channel]) continue;
      const rawChannelImages = Array.isArray(imagesByChannel?.[channel])
        ? (imagesByChannel[channel] as ImagePayload[])
        : [];
      const channelImagesToUpload = rawChannelImages.slice(0, 5);
      if (!channelImagesToUpload.length) continue;
      const { imageSet, uploadErrors: channelErrors } = await uploadImageSet(
        userId,
        channelImagesToUpload,
        getRequiredImageFormatsForChannel(channel),
      );
      channelImageSets[channel] = {
        ...imageSet,
        editableAttachments: buildEditableImageAttachments(
          channelImagesToUpload,
          imageSet,
          originalSourceUrlByKey,
        ),
      };
      uploadErrors.push(
        ...channelErrors.map((entry) => ({
          ...entry,
          stage: `${channel}:${entry.stage}`,
        })),
      );
    }

    const fallbackImageSet =
      activePreparationSelected
        .map((channel) => channelImageSets[channel])
        .find((value): value is ImageSet =>
          Boolean(
            value &&
            (value.images.length ||
              value.publishableUrls.length ||
              value.instagramPublishableUrls.length ||
              value.socialFeedPublishableUrls.length ||
              value.siteCardPublishableUrls.length ||
              value.gmbPublishableUrls.length),
          ),
        ) || null;

    const publicationImageSet = baseImageSet.images.length
      ? baseImageSet
      : fallbackImageSet || baseImageSet;
    const originalPublicationImageAttachments =
      buildOriginalImageAttachments(publicationImageSet);
    const getOriginalImagesForChannel = (channel: ChannelKey) =>
      buildOriginalImageAttachments(
        channelImageSets[channel] || publicationImageSet,
      );

    // Hard fail only if images were provided somewhere but none could be uploaded/prepared.
    if (
      hadAnyImageInput &&
      !publicationImageSet.images.length &&
      !publicationImageSet.publishableUrls.length &&
      !publicationImageSet.instagramPublishableUrls.length &&
      !publicationImageSet.socialFeedPublishableUrls.length &&
      !publicationImageSet.siteCardPublishableUrls.length &&
      !publicationImageSet.gmbPublishableUrls.length
    ) {
      const imageFailureMessage =
        "Les images sélectionnées n'ont pas pu être envoyées. Merci de réessayer.";
      selected
        .filter((channel) => mediaModeByChannel[channel] === "images")
        .forEach((channel) =>
          setPreflightFailure(channel, {
            code: "image_upload_failed",
            error: imageFailureMessage,
            uploadErrors,
          }),
        );
    }
    const channelPreflightPlan = buildBoosterPublicationDispatchPlan(
      selected,
      preflightFailuresByChannel as Partial<
        Record<
          ChannelKey,
          { ok: false; code: string; error: string; [key: string]: unknown }
        >
      >,
    );
    if (!internalAsyncDispatch) {
      // 2) Persist publication
      const inrSearchSelected = selected.includes("inr_search");
      const inrSearchMediaMode = mediaModeByChannel.inr_search || "none";
      const inrSearchImageSet =
        channelImageSets.inr_search || publicationImageSet;
      const inrSearchImageAttachments =
        inrSearchSelected && inrSearchMediaMode === "images"
          ? getOriginalImagesForChannel("inr_search")
          : [];
      const inrSearchPreparedVideo =
        inrSearchSelected && inrSearchMediaMode === "video"
          ? getPublicationVideoForChannel("inr_search")
          : null;
      const durableInrSearchVideo =
        inrSearchMediaMode === "video"
          ? publicationVideo ||
            inrSearchPreparedVideo?.sourceVideo ||
            inrSearchPreparedVideo ||
            null
          : null;
      const inrSearchSnapshot = inrSearchSelected
        ? {
            post: getChannelPost("inr_search"),
            mediaMode: inrSearchMediaMode,
            images: inrSearchImageAttachments
              .map((attachment) => String(asRecord(attachment).url || "").trim())
              .filter(Boolean),
            attachments: inrSearchImageAttachments,
            storagePaths: inrSearchImageSet.storagePaths,
            publishableStoragePaths:
              inrSearchImageSet.publishableStoragePaths,
            socialFeedStoragePaths:
              inrSearchImageSet.socialFeedStoragePaths,
            publishableUrls: inrSearchImageSet.publishableUrls,
            socialFeedPublishableUrls:
              inrSearchImageSet.socialFeedPublishableUrls,
            siteCardPublishableUrls:
              inrSearchImageSet.siteCardPublishableUrls,
            video: durableInrSearchVideo,
          }
        : null;
      const publicationInsert: JsonRecord = {
        id: publicationId,
        user_id: userId,
        title: firstPost.title,
        content: firstPost.content,
        cta: firstPost.cta,
        hashtags: firstPost.hashtags,
        images: hasAnyImageChannel ? uploadedUrls : [],
        idea,
      };

      if (inrSearchSnapshot) {
        publicationInsert.media_metadata = { inrSearch: inrSearchSnapshot };
      }

      // Champs ajoutés par ops/sql/2026-05-29_booster_video_publication_columns.sql.
      if (hasAnyVideoChannel && publicationVideo) {
        publicationInsert.media_type = "video";
        publicationInsert.video_url = publicationVideo.publicUrl;
        publicationInsert.video_path = publicationVideo.storagePath;
        publicationInsert.video_mime = publicationVideo.type;
        publicationInsert.video_size = publicationVideo.size;
        publicationInsert.video_duration_seconds = publicationVideo.duration;
        publicationInsert.video_thumbnail_url = publicationVideo.thumbnailUrl;
        publicationInsert.media_metadata = {
          ...asRecord(publicationInsert.media_metadata),
          video: publicationVideo,
          videoByChannel: publicationVideoByChannel,
        };
      }

      const { error: pubErr } = await supabaseAdmin
        .from("publications")
        .upsert(publicationInsert, { onConflict: "id" });

      if (pubErr) {
        throw new Error(`publication_insert_failed:${pubErr.message || "unknown"}`);
      }

      await invalidateBoosterGenerationContext(userId, "publications");

      // 3) Create deliveries
      const asyncDeliveryIds = asRecord(body._asyncDeliveryIds);
      const deliveries = channelPreflightPlan.entries.map((entry) => ({
        id:
          cleanExecutionIdempotencyKey(asyncDeliveryIds[entry.channel]) ||
          randomUUID(),
        publication_id: publicationId,
        user_id: userId,
        channel: entry.channel,
        status: entry.status,
        error: entry.result
          ? String(entry.result.error || "Échec du préflight média.")
          : null,
      }));

      const { error: deliveriesError } = await supabaseAdmin
        .from("publication_deliveries")
        .upsert(deliveries, { onConflict: "id" });
      if (deliveriesError) {
        throw new Error(
          `publication_deliveries_insert_failed:${deliveriesError.message || "unknown"}`,
        );
      }

      const asyncSecret = getCronSecret();
      if (!asyncSecret) throw new Error("publication_worker_unavailable");
      if (asyncSecret) {
        const persistedPostByChannelForAsync = Object.fromEntries(
          selected.map((channel) => {
            const rawBaseValue = (postByChannel as Record<string, unknown>)[
              channel
            ] as Record<string, unknown> | undefined;
            const baseValue = {
              ...(rawBaseValue || {}),
              ...getChannelPost(channel),
            };
            const channelPersistedVideo =
              mediaModeByChannel[channel] === "video"
                ? getPublicationVideoForChannel(channel)
                : null;
            const originalVideo =
              publicationVideo ||
              channelPersistedVideo?.sourceVideo ||
              channelPersistedVideo;

            if (mediaModeByChannel[channel] === "video" && originalVideo) {
              return [
                channel,
                {
                  ...baseValue,
                  images: [],
                  attachments: [originalVideo],
                  video: originalVideo,
                  sourceVideo: originalVideo,
                  mediaMode: "video",
                  videoSettings: videoSettingsByChannel[channel] || null,
                  videoFormat: videoSettingsByChannel[channel]?.format || null,
                  videoAdaptationMode:
                    videoSettingsByChannel[channel]?.adaptationMode || null,
                },
              ];
            }

            if (mediaModeByChannel[channel] === "none") {
              return [
                channel,
                {
                  ...baseValue,
                  images: [],
                  attachments: [],
                  mediaMode: "none",
                  videoSettings: videoSettingsByChannel[channel] || null,
                },
              ];
            }

            const imageSet = channelImageSets[channel] || baseImageSet;
            const originalImages = getOriginalImagesForChannel(channel);
            return [
              channel,
              {
                ...baseValue,
                images: originalImages.map((attachment) => attachment.url),
                attachments: originalImages,
                publishableUrls: imageSet.publishableUrls,
                instagramPublishableUrls: imageSet.instagramPublishableUrls,
                socialFeedPublishableUrls: imageSet.socialFeedPublishableUrls,
                siteCardPublishableUrls: imageSet.siteCardPublishableUrls,
                gmbPublishableUrls: imageSet.gmbPublishableUrls,
                storagePaths: imageSet.storagePaths,
                publishableStoragePaths: imageSet.publishableStoragePaths,
                socialFeedStoragePaths: imageSet.socialFeedStoragePaths,
                mediaMode: "images",
                videoSettings: videoSettingsByChannel[channel] || null,
              },
            ];
          }),
        );

        const preparedImagesByChannel = Object.fromEntries(
          selected
            .filter((channel) => mediaModeByChannel[channel] === "images")
            .map((channel) => {
              const rawChannelImages = Array.isArray(imagesByChannel[channel])
                ? (imagesByChannel[channel] as ImagePayload[])
                : images;
              const imageSet = channelImageSets[channel] || baseImageSet;
              return [
                channel,
                buildAsyncPreparedImagePayloads(
                  channel,
                  rawChannelImages,
                  imageSet,
                ),
              ];
            }),
        ) as ImagesByChannel;

        const persistedChannelEventIds = asRecord(body._asyncChannelEventIds);
        const channelEventIds = Object.fromEntries(
          selected.map((channel) => [
            channel,
            cleanExecutionIdempotencyKey(persistedChannelEventIds[channel]) ||
              randomUUID(),
          ]),
        ) as Record<ChannelKey, string>;
        const finalPayloadBase = {
          workflowTool: eventModule,
          workflowAction,
          ...(origin ? { origin, source: origin.source } : {}),
          mediaType,
          mediaModeByChannel,
          videoSettingsByChannel,
          video: hasAnyVideoChannel ? publicationVideo : null,
          videoByChannel: publicationVideoByChannel,
          attachments: hasAnyVideoChannel && publicationVideo
            ? [publicationVideo]
            : originalPublicationImageAttachments,
          idea,
          post: firstPost,
          postByChannel: persistedPostByChannelForAsync,
          imageSettingsByChannel,
          images: uploadedUrls,
          publishableUrls,
          instagramPublishableUrls,
          socialFeedPublishableUrls,
          siteCardPublishableUrls,
          gmbPublishableUrls,
          uploadErrors,
          publication_id: publicationId,
          mediaWorkspaceId: mediaWorkspaceId || null,
          mediaWorkspaceRevision: workspaceConsumption?.workspaceRevision || null,
          mediaWorkspaceConsumptionSource:
            strictMediaCutover
              ? "workspace_cutover_v1"
              : workspaceConsumption?.source || "legacy_fallback",
          idempotencyKey: publishIdempotencyKey || null,
          idempotencyLockId: publishIdempotencyLockId || null,
        };

        const parentPayload = {
          status: "dispatching",
          stage: "channel_dispatch",
          asyncVersion: 2,
          publication_id: publicationId,
          channels: selected,
          channelEventIds,
          finalEventType: eventType,
          finalPayloadBase,
          mediaWorkspaceId: mediaWorkspaceId || null,
          parentIdempotencyLockId: publishIdempotencyLockId || null,
          parentIdempotencyKey: publishIdempotencyKey || null,
          preparationMaterializedAt: new Date().toISOString(),
        };

        const channelRows = selected.map((channel) => {
          const preflightFailure = preflightFailuresByChannel[channel] || null;
          const preparationDeferred =
            deferredPreparationChannels.has(channel);
          const channelPost = getChannelPost(channel);
          const channelPreparedVideo =
            mediaModeByChannel[channel] === "video"
              ? getPublicationVideoForChannel(channel)
              : null;
          const channelDispatchVideo = channelPreparedVideo
            ? {
                ...channelPreparedVideo,
                transformedVariants: channelPreparedVideo.transformedVariant
                  ? [channelPreparedVideo.transformedVariant]
                  : [],
                sourceVideo: null,
              }
            : null;
          const channelMediaMode = mediaModeByChannel[channel] || "none";
          const channelMediaType =
            resolveChannelDispatchMediaType(channelMediaMode);
          const channelDispatchRequest = {
            workflowTool: body.workflowTool,
            workflowAction: body.workflowAction,
            workflowTrackType: body.workflowTrackType,
            source: body.source,
            origin: body.origin,
            automationKey: body.automationKey,
            inrAgentActionId: body.inrAgentActionId,
            channels: [channel],
            idea,
            post: channelPost,
            postByChannel: { [channel]: channelPost },
            mediaPipelineCutoverV1: false,
            mediaType: channelMediaType,
            mediaModeByChannel: {
              [channel]: channelMediaMode,
            },
            videoSettingsByChannel: {
              [channel]: videoSettingsByChannel[channel],
            },
            videoFormatByChannel: {
              [channel]: videoSettingsByChannel[channel]?.format,
            },
            videoAdaptationModeByChannel: {
              [channel]: videoSettingsByChannel[channel]?.adaptationMode,
            },
            video: channelMediaMode === "video" ? channelDispatchVideo : null,
            images: [],
            imagesByChannel: {
              [channel]:
                channelMediaMode === "images"
                  ? preparedImagesByChannel[channel] || []
                  : [],
            },
            imageSettingsByChannel: {
              [channel]: imageSettingsByChannel[channel],
            },
            ...(channel === "tiktok"
              ? { tiktokPublicationSettings }
              : {}),
            ...(channel === "pinterest"
              ? { pinterestPublicationSettings }
              : {}),
            skipScheduledDuplicateCheck: true,
            _asyncChannelDispatch: true,
            _asyncPublicationId: publicationId,
            _asyncChannelEventId: channelEventIds[channel],
            _asyncParentEventId: publicationId,
            _asyncParentIdempotencyLockId: publishIdempotencyLockId || null,
            _asyncParentIdempotencyKey: publishIdempotencyKey || null,
            _asyncWorkspacePurpose: workspacePurpose,
            // Ce bit n'est honoré que par une requête cron authentifiée. Il
            // transporte jusqu'au worker canal la preuve FFmpeg de l'original
            // (ou d'un ancien dérivé), sans relire le workspace.
            _asyncTrustedVideoCompatibilityProof:
              channelMediaMode === "video" &&
              hasTrustedPublicationVideoCompatibilityProof,
          };
          return {
            id: channelEventIds[channel],
            user_id: userId,
            module: eventModule,
            type: BOOSTER_ASYNC_CHANNEL_EVENT_TYPE,
            payload: preflightFailure
              ? {
                  status: "failed",
                  publication_id: publicationId,
                  parentEventId: publicationId,
                  channel,
                  attempt: 0,
                  result: preflightFailure,
                  completedAt: new Date().toISOString(),
                  createdAt: new Date().toISOString(),
                }
              : preparationDeferred
                ? {
                    status: "preparing",
                    publication_id: publicationId,
                    parentEventId: publicationId,
                    channel,
                    attempt: 0,
                    preparationPending: true,
                    createdAt: new Date().toISOString(),
                  }
              : {
                  status: "queued",
                  publication_id: publicationId,
                  parentEventId: publicationId,
                  channel,
                  attempt: 1,
                  dispatchRequest: channelDispatchRequest,
                  createdAt: new Date().toISOString(),
                },
          };
        });

        const updatedParent = await updateAsyncPublicationJobEvent({
          userId,
          publicationId,
          patch: parentPayload,
        });
        if (!updatedParent) throw new Error("async_parent_job_missing");
        const durableChannelRows = await Promise.all(
          channelRows.map(async (row) => ({
            ...row,
            payload: await materializePreparingAsyncChannelEvent({
              userId,
              eventId: row.id,
              payload: asRecord(row.payload),
            }),
          })),
        );
        if (deferredPreparationChannels.size > 0) {
          await updateAsyncPublicationJobEvent({
            userId,
            publicationId,
            patch: {
              status: "queued",
              stage: "media_preparation",
              ...(workspacePreparationState?.pendingMediaIds.length
                ? {
                    preparationAttempt:
                      normalizeAsyncPreparationAttempt(
                        body._asyncPreparationAttempt,
                      ),
                  }
                : {}),
              lastPreparationError: "workspace_media_processing",
              lastPreparationDispatchAt: new Date().toISOString(),
            },
          });
          await failAsyncPublicationPreparationLease({
            lockId: asyncPreparationFailureContext?.preparationLockId || null,
            publicationId,
            error: "workspace_media_processing",
          });
        } else {
          await updateAsyncPublicationJobEvent({
            userId,
            publicationId,
            patch: {
              preparationRequest: null,
              preparationCompletedAt: new Date().toISOString(),
            },
          });
          await completeAsyncPublicationPreparationLease({
            lockId: asyncPreparationFailureContext?.preparationLockId || null,
            publicationId,
          });
        }
        asyncPreparationFailureContext = null;

        {
          const queuedChannelRows = durableChannelRows.filter(
            (row) => asRecord(row.payload).status === "queued",
          );
          const deferredChannelRows = durableChannelRows.filter(
            (row) =>
              asRecord(row.payload).status === "preparing" &&
              asRecord(row.payload).preparationPending === true,
          );
          if (!queuedChannelRows.length && !deferredChannelRows.length) {
            const finalization = await finalizeAsyncPublicationIfReady({
              userId,
              publicationId,
            });
            const finalPayload = asRecord(finalization.payload);
            return NextResponse.json({
              ...finalPayload,
              ok: false,
              queued: false,
              asyncDispatch: true,
              publication_id: publicationId,
              results:
                finalPayload.results ||
                Object.fromEntries(
                  selected.map((channel) => [
                    channel,
                    preflightFailuresByChannel[channel],
                  ]),
                ),
              summary:
                finalPayload.summary ||
                buildResultsSummary(
                  preflightFailuresByChannel as Record<string, unknown>,
                  selected,
                ),
            });
          }
          const appOrigin = getAppOriginFromRequest(req);
          const internalHeaders = buildInternalCronHeaders(userId);
          after(async () => {
            await Promise.allSettled(
              queuedChannelRows.map(async (row) => {
                const dispatchRequest = asRecord(row.payload).dispatchRequest;
                try {
                  await fetch(`${appOrigin}/api/booster/publish-now`, {
                    method: "POST",
                    headers: internalHeaders,
                    body: JSON.stringify(dispatchRequest),
                    cache: "no-store",
                  });
                } catch (dispatchError) {
                  console.warn("[booster-async] initial channel dispatch failed", {
                    publicationId,
                    channel: asRecord(row.payload).channel,
                    message:
                      dispatchError instanceof Error
                        ? dispatchError.message
                        : String(dispatchError || ""),
                  });
                }
              }),
            );
          });

          const queuedSummaryBase = buildQueuedPublicationSummary(selected);
          const failedChannels = selected.filter((channel) =>
            Boolean(preflightFailuresByChannel[channel]),
          );
          const queuedSummary = {
            ...queuedSummaryBase,
            failureCount: failedChannels.length,
            pendingCount:
              queuedChannelRows.length + deferredChannelRows.length,
            entries: queuedSummaryBase.entries.map((entry) => {
              const failure = preflightFailuresByChannel[entry.channel];
              if (failure) {
                return {
                  ...entry,
                  ok: false,
                  status: "failed",
                  technicalStatus: "failed",
                  code: String(failure.code || "media_preflight_failed"),
                  retryable: failure.retryable !== false,
                  error: String(failure.error || "Échec du préflight média."),
                };
              }
              if (deferredPreparationChannels.has(entry.channel)) {
                return {
                  ...entry,
                  ok: null,
                  status: "preparing",
                  technicalStatus: "preparing",
                };
              }
              return entry;
            }),
            failedChannels,
          };
          return NextResponse.json(
            {
              ok: true,
              queued: true,
              asyncDispatch: true,
              publication_id: publicationId,
              mediaType,
              mediaModeByChannel,
              videoSettingsByChannel,
              video: hasAnyVideoChannel ? publicationVideo : null,
              videoByChannel: publicationVideoByChannel,
              images: uploadedUrls,
              uploadErrors,
              results: Object.fromEntries(
                selected.map((channel) => [
                  channel,
                  preflightFailuresByChannel[channel] || {
                    ok: true,
                    queued: true,
                    status: deferredPreparationChannels.has(channel)
                      ? "preparing"
                      : "queued",
                  },
                ]),
              ),
              summary: queuedSummary,
              idempotencyKey: publishIdempotencyKey || null,
              mediaWorkspaceId: mediaWorkspaceId || null,
            },
            { status: 202 },
          );
        }

      }
    }

    // 4) Publish now
    const results: Record<string, unknown> = Object.fromEntries(
      selected.flatMap((channel) => {
        const failure = preflightFailuresByChannel[channel];
        return failure ? [[channel, failure] as const] : [];
      }),
    );

    const [fbRow, gmbRow, igRow, liRow, tiktokRow, youtubeRow, pinterestRow] =
      await Promise.all([
        selected.some((channel) =>
          ["facebook", "instagram"].includes(channel),
        )
          ? getLatestIntegrationRow(
              userId,
              "facebook",
              "facebook",
              "facebook",
              "status,resource_id,access_token_enc,expires_at",
            )
          : Promise.resolve(null),
        selected.includes("gmb")
          ? getLatestIntegrationRow(
              userId,
              "google",
              "gmb",
              "gmb",
              "status,resource_id,meta,expires_at",
            )
          : Promise.resolve(null),
        selected.includes("instagram")
          ? getLatestIntegrationRow(
              userId,
              "instagram",
              "instagram",
              "instagram",
              "status,resource_id,access_token_enc,resource_label,meta,expires_at",
            )
          : Promise.resolve(null),
        selected.includes("linkedin")
          ? getLatestIntegrationRow(
              userId,
              "linkedin",
              "linkedin",
              "linkedin",
              "status,resource_id,access_token_enc,meta,expires_at",
            )
          : Promise.resolve(null),
        selected.includes("tiktok")
          ? getLatestIntegrationRow(
              userId,
              "tiktok",
              "tiktok",
              "tiktok",
              "status,resource_id,resource_label,display_name,access_token_enc,refresh_token_enc,scopes,meta,expires_at",
            )
          : Promise.resolve(null),
        selected.includes("youtube_shorts")
          ? getLatestIntegrationRow(
              userId,
              "youtube",
              "youtube_shorts",
              "youtube_shorts",
              "status,resource_id,resource_label,display_name,email_address,access_token_enc,refresh_token_enc,scopes,meta,expires_at",
            )
          : Promise.resolve(null),
        selected.includes("pinterest")
          ? getLatestIntegrationRow(
              userId,
              "pinterest",
              "pinterest",
              "pinterest",
              "status,resource_id,resource_label,display_name,access_token_enc,refresh_token_enc,scopes,meta,expires_at",
            )
          : Promise.resolve(null),
      ]);

    // Internal URLs/phone are only needed by website, Meta, Pinterest and GMB.
    // LinkedIn, TikTok and YouTube workers no longer pay three unrelated reads.
    const needsInternalPublishingContext = selected.some((channel) =>
      [
        "inrcy_site",
        "site_web",
        "facebook",
        "instagram",
        "pinterest",
        "gmb",
      ].includes(channel),
    );
    const [profileRes, inrcyCfgRes, proCfgRes] = await Promise.all([
      needsInternalPublishingContext
        ? supabaseAdmin
            .from("profiles")
            .select("inrcy_site_ownership,phone")
            .eq("user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      needsInternalPublishingContext
        ? supabaseAdmin
            .from("inrcy_site_configs")
            .select("site_url")
            .eq("user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      needsInternalPublishingContext
        ? supabaseAdmin
            .from("pro_tools_configs")
            .select("settings")
            .eq("user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const profile = asRecord(profileRes.data);
    const inrcyCfg = asRecord(inrcyCfgRes.data);
    const proCfg = asRecord(proCfgRes.data);
    const proSettings = asRecord(proCfg["settings"]);
    const proSiteWeb = asRecord(proSettings["site_web"]);
    const proPinterest = asRecord(proSettings["pinterest"]);
    const configuredPinterestDefaultBoardId = String(
      proPinterest["defaultBoardId"] || "",
    ).trim();

    const ownership = String(profile["inrcy_site_ownership"] ?? "none");
    const businessPhone = String(profile["phone"] ?? "").trim();
    const inrcySiteUrl = String(inrcyCfg["site_url"] ?? "").trim();
    const siteWebUrl = String(proSiteWeb["url"] ?? "").trim();

    const {
      externalImageUrls,
      socialFeedImageUrls,
      instagramImageUrls,
      gmbImageUrls,
      getChannelImageSet,
      getExpectedChannelImageCount,
      pickCompleteChannelImageUrls,
    } = createPublishNowImageContext({
      publicationImageSet,
      channelImageSets,
      baseImageSet,
      imagesByChannel,
    });

    async function setDelivery(channel: ChannelKey, patch: JsonRecord) {
      const nextStatus = String(patch.status ?? "").trim();
      const nextError = String(patch.error ?? patch.last_error ?? "").trim();
      const payload: JsonRecord = {};
      if (nextStatus) payload.status = nextStatus;
      payload.error = nextError || null;

      const { error } = await supabaseAdmin
        .from("publication_deliveries")
        .update(payload)
        .eq("publication_id", publicationId)
        .eq("user_id", userId)
        .eq("channel", channel);

      if (error) {
        console.error("[Booster] publication_deliveries update failed", {
          channel,
          payload,
          error: error.message,
        });
      }
    }

    function getTikTokStorageContentType(
      video: PersistedVideoAttachment,
    ) {
      const declared = String(video.type || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (["video/mp4", "video/quicktime", "video/webm"].includes(declared)) {
        return declared;
      }
      const name = String(video.name || video.storagePath || "").toLowerCase();
      if (name.endsWith(".webm")) return "video/webm";
      if (name.endsWith(".mov")) return "video/quicktime";
      return "video/mp4";
    }

    function createTikTokStorageRangeSource(
      video: PersistedVideoAttachment,
    ): TikTokRangeSource | null {
      const storagePath = String(video.storagePath || "").trim();
      const bucket = String(video.bucket || "booster").trim() || "booster";
      if (!storagePath) return null;
      return {
        sourceKey: `supabase:${bucket}:${storagePath}`,
        declaredContentType: getTikTokStorageContentType(video),
        getUrl: async () => {
          if (bucket === "booster") {
            const publicUrl =
              supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath).data
                .publicUrl || "";
            if (!publicUrl) {
              throw new Error("tiktok_storage_public_url_missing");
            }
            return publicUrl;
          }
          const signedUrl = await createSafeStorageSignedUrl(
            bucket,
            storagePath,
            15 * 60,
          );
          if (!signedUrl) throw new Error("tiktok_storage_signed_url_failed");
          return signedUrl;
        },
      };
    }

    async function loadFirstAvailableTikTokVideo(
      candidates: Array<{
        video: PersistedVideoAttachment | null | undefined;
        kind: "channel_variant" | "source_video" | "publication_source";
      }>,
    ) {
      const attempted: Array<{ path: string; bucket: string; kind: string }> = [];
      const seen = new Set<string>();

      for (const candidate of candidates) {
        const storagePath = String(candidate.video?.storagePath || "").trim();
        const bucket =
          String(candidate.video?.bucket || "booster").trim() || "booster";
        if (!storagePath) continue;
        const key = `${bucket}:${storagePath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        attempted.push({ path: storagePath, bucket, kind: candidate.kind });

        const source = createTikTokStorageRangeSource(candidate.video!);
        if (!source) continue;
        try {
          // Un seul octet suffit pour vérifier côté serveur la présence, la
          // longueur totale et le support strict de Range avant l'init TikTok.
          const probe = await probeTikTokRangeSource({ source });
          return { source, probe, kind: candidate.kind, attempted };
        } catch (error) {
          console.warn("[Booster] TikTok range source candidate rejected", {
            bucket,
            storagePath,
            kind: candidate.kind,
            message:
              error instanceof Error ? error.message : String(error || ""),
          });
        }
      }

      return { source: null, probe: null, kind: null, attempted };
    }

    async function persistTikTokUploadCheckpoint(
      checkpoint: TikTokVideoUploadCheckpoint,
    ) {
      if (!internalAsyncDispatch || !asyncChannelEventId) return;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await updateAsyncChannelEvent({
            userId,
            eventId: asyncChannelEventId,
            patch: { tiktokUploadCheckpoint: checkpoint },
          });
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 250 * 2 ** attempt),
            );
          }
        }
      }
      throw lastError || new Error("tiktok_checkpoint_persist_failed");
    }

    async function persistInstagramVideoCheckpoint(
      checkpoint: InstagramVideoPublishCheckpoint,
      patch: JsonRecord = {},
    ) {
      if (!internalAsyncDispatch || !asyncChannelEventId) {
        throw new Error("instagram_video_checkpoint_requires_async_worker");
      }
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await updateAsyncChannelEvent({
            userId,
            eventId: asyncChannelEventId,
            patch: {
              ...patch,
              instagramVideoCheckpoint: checkpoint,
              instagramVideoPhase: checkpoint.state,
            },
          });
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 200 * 2 ** attempt),
            );
          }
        }
      }
      throw lastError || new Error("instagram_video_checkpoint_persist_failed");
    }

    async function queueInstagramVideoContinuation(params: {
      checkpoint: InstagramVideoPublishCheckpoint;
      phaseResult: InstagramVideoPhaseResult;
    }) {
      const requestedRetryAfterMs =
        "retryAfterMs" in params.phaseResult
          ? Number(params.phaseResult.retryAfterMs || 0)
          : 0;
      const retryAfterMs = Math.max(
        1_000,
        Math.min(60_000, requestedRetryAfterMs || 3_000),
      );
      await persistInstagramVideoCheckpoint(params.checkpoint, {
        status: "queued",
        instagramVideoContinuation: true,
        instagramVideoNextPollAt: new Date(
          Date.now() + retryAfterMs,
        ).toISOString(),
        lastInstagramVideoPhaseResult: {
          ok: params.phaseResult.ok,
          phase: params.phaseResult.phase,
          outcome: params.phaseResult.outcome,
          code: params.phaseResult.ok ? null : params.phaseResult.code,
        },
      });
      await setDelivery("instagram", { status: "processing", error: null });
      await failExecutionIdempotencyLock({
        supabase: supabaseAdmin,
        lockId: asyncChannelLockId,
        error: "instagram_video_continuation",
        result: {
          ok: true,
          pending: true,
          code: "instagram_video_processing",
          publication_id: publicationId,
          channel: "instagram",
          container_id: params.checkpoint.containerId,
          phase: params.checkpoint.state,
        },
        metadata: {
          publicationId,
          channel: "instagram",
          asyncDispatch: true,
          continuation: true,
        },
      });
      asyncFailureContext = null;
      const pendingResult = {
        ok: true,
        pending: true,
        status: "processing",
        code: "instagram_video_processing",
        container_id: params.checkpoint.containerId,
        phase: params.checkpoint.state,
      };
      return NextResponse.json(
        {
          ok: true,
          done: false,
          queued: true,
          asyncDispatch: true,
          publication_id: publicationId,
          channel: "instagram",
          pollAfterMs: retryAfterMs,
          results: { instagram: pendingResult },
        },
        {
          status: 202,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
          },
        },
      );
    }

    async function persistYoutubeUploadCheckpoint(
      checkpoint: YoutubeResumableUploadCheckpoint,
      patch: JsonRecord = {},
    ) {
      if (!internalAsyncDispatch || !asyncChannelEventId) {
        throw new Error("youtube_upload_checkpoint_requires_async_worker");
      }
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await updateAsyncChannelEvent({
            userId,
            eventId: asyncChannelEventId,
            patch: {
              ...patch,
              youtubeUploadCheckpoint: checkpoint,
              youtubeUploadPhase: checkpoint.state,
              youtubeUploadOffset: checkpoint.offset,
              youtubeUploadTotalBytes: checkpoint.totalBytes,
            },
          });
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 200 * 2 ** attempt),
            );
          }
        }
      }
      throw lastError || new Error("youtube_upload_checkpoint_persist_failed");
    }

    async function queueYoutubeUploadContinuation(params: {
      checkpoint: YoutubeResumableUploadCheckpoint;
      phaseResult: YoutubeResumableUploadPhaseResult;
    }) {
      const requestedRetryAfterMs = Number(
        "retryAfterMs" in params.phaseResult
          ? params.phaseResult.retryAfterMs || 0
          : 0,
      );
      const retryAfterMs = Math.max(
        1_000,
        Math.min(60_000, requestedRetryAfterMs || 2_000),
      );
      await persistYoutubeUploadCheckpoint(params.checkpoint, {
        status: "queued",
        youtubeUploadContinuation: true,
        youtubeUploadNextRunAt: new Date(
          Date.now() + retryAfterMs,
        ).toISOString(),
        lastYoutubeUploadPhaseResult: {
          ok: params.phaseResult.ok,
          phase: params.phaseResult.phase,
          outcome: params.phaseResult.outcome,
          code: params.phaseResult.ok ? null : params.phaseResult.code,
        },
      });
      await setDelivery("youtube_shorts", {
        status: "processing",
        error: null,
      });
      await failExecutionIdempotencyLock({
        supabase: supabaseAdmin,
        lockId: asyncChannelLockId,
        error: "youtube_upload_continuation",
        result: {
          ok: true,
          pending: true,
          code: "youtube_upload_processing",
          publication_id: publicationId,
          channel: "youtube_shorts",
          offset: params.checkpoint.offset,
          total_bytes: params.checkpoint.totalBytes,
        },
        metadata: {
          publicationId,
          channel: "youtube_shorts",
          asyncDispatch: true,
          continuation: true,
        },
      });
      asyncFailureContext = null;
      return NextResponse.json(
        {
          ok: true,
          done: false,
          queued: true,
          asyncDispatch: true,
          publication_id: publicationId,
          channel: "youtube_shorts",
          pollAfterMs: retryAfterMs,
          results: {
            youtube_shorts: {
              ok: true,
              pending: true,
              status: "processing",
              code: "youtube_upload_processing",
              offset: params.checkpoint.offset,
              total_bytes: params.checkpoint.totalBytes,
            },
          },
        },
        {
          status: 202,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
          },
        },
      );
    }

    async function persistPinterestVideoCheckpoint(
      checkpoint: PinterestVideoProtocolCheckpoint,
      patch: JsonRecord = {},
    ) {
      if (!internalAsyncDispatch || !asyncChannelEventId) {
        throw new Error("pinterest_video_checkpoint_requires_async_worker");
      }
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await updateAsyncChannelEvent({
            userId,
            eventId: asyncChannelEventId,
            patch: {
              pinterestVideoCheckpoint: checkpoint,
              pinterestVideoPhase: checkpoint.phase,
              pinterestVideoNextPollAt: checkpoint.nextPollAt || null,
              ...patch,
            },
          });
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 200 * 2 ** attempt),
            );
          }
        }
      }
      throw lastError || new Error("pinterest_video_checkpoint_persist_failed");
    }

    async function queuePinterestVideoContinuation(params: {
      step: PinterestVideoDurableStepResult;
    }) {
      const requestedNextRunAt = Date.parse(
        String(
          params.step.retryAt ||
            params.step.checkpoint.nextPollAt ||
            "",
        ),
      );
      const nextRunAt = new Date(
        Number.isFinite(requestedNextRunAt) && requestedNextRunAt > Date.now()
          ? requestedNextRunAt
          : Date.now() + 1_000,
      ).toISOString();
      await persistPinterestVideoCheckpoint(params.step.checkpoint, {
        status: "queued",
        pinterestVideoContinuation: true,
        pinterestVideoNextPollAt: nextRunAt,
        lastPinterestVideoStepState: params.step.state,
      });
      await setDelivery("pinterest", { status: "processing", error: null });
      await failExecutionIdempotencyLock({
        supabase: supabaseAdmin,
        lockId: asyncChannelLockId,
        error: "pinterest_video_continuation",
        result: {
          ok: true,
          pending: true,
          code: "pinterest_video_processing",
          publication_id: publicationId,
          channel: "pinterest",
          phase: params.step.checkpoint.phase,
          media_id: params.step.checkpoint.mediaId || null,
        },
        metadata: {
          publicationId,
          channel: "pinterest",
          asyncDispatch: true,
          continuation: true,
        },
      });
      asyncFailureContext = null;
      const retryAfterMs = Math.max(
        1_000,
        Date.parse(nextRunAt) - Date.now(),
      );
      return NextResponse.json(
        {
          ok: true,
          done: false,
          queued: true,
          asyncDispatch: true,
          publication_id: publicationId,
          channel: "pinterest",
          pollAfterMs: retryAfterMs,
          results: {
            pinterest: {
              ok: true,
              pending: true,
              status: "processing",
              code: "pinterest_video_processing",
              phase: params.step.checkpoint.phase,
              media_id: params.step.checkpoint.mediaId || null,
            },
          },
        },
        {
          status: 202,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
          },
        },
      );
    }

    async function getTiktokAccessToken(rowLike: unknown) {
      const row = asRecord(rowLike);
      let accessToken =
        tryDecryptToken(String(row.access_token_enc || "")) || "";
      const refreshToken =
        tryDecryptToken(String(row.refresh_token_enc || "")) || "";

      if (accessToken && !isExpired(row.expires_at, 120)) return accessToken;
      if (!refreshToken) return accessToken;
      if (isExpired(asRecord(row.meta).refresh_expires_at, 120)) return "";

      const refreshed = await refreshTiktokAccessToken(refreshToken);
      const nextAccessToken = String(refreshed.access_token || "").trim();
      const nextRefreshToken =
        String(refreshed.refresh_token || "").trim() || refreshToken;
      const expiresIn = Number(refreshed.expires_in || 0);
      const refreshExpiresIn = Number(refreshed.refresh_expires_in || 0);
      const expiresAt =
        Number.isFinite(expiresIn) && expiresIn > 0
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : null;
      const nextMeta = {
        ...asRecord(row.meta),
        refresh_expires_at:
          Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
            ? new Date(Date.now() + refreshExpiresIn * 1000).toISOString()
            : asRecord(row.meta).refresh_expires_at || null,
        tiktok_token_refreshed_at: new Date().toISOString(),
      };

      if (nextAccessToken) {
        await supabaseAdmin
          .from("integrations")
          .update({
            access_token_enc: encryptToken(nextAccessToken),
            refresh_token_enc: nextRefreshToken
              ? encryptToken(nextRefreshToken)
              : row.refresh_token_enc || null,
            expires_at: expiresAt || row.expires_at || null,
            meta: nextMeta,
          })
          .eq("user_id", userId)
          .eq("provider", "tiktok")
          .eq("source", "tiktok")
          .eq("product", "tiktok");
        accessToken = nextAccessToken;
      }

      return accessToken;
    }

    async function getYoutubeShortsAccessToken(rowLike: unknown) {
      const row = asRecord(rowLike);
      let accessToken =
        tryDecryptToken(String(row.access_token_enc || "")) || "";
      const refreshToken =
        tryDecryptToken(String(row.refresh_token_enc || "")) || "";

      if (accessToken && !isExpired(row.expires_at, 120)) return accessToken;
      if (!refreshToken) return accessToken;

      const refreshed = await refreshYoutubeShortsAccessToken(refreshToken);
      const nextAccessToken = String(refreshed.access_token || "").trim();
      if (!nextAccessToken) return accessToken;
      const expiresIn = Number(refreshed.expires_in || 0);
      const expiresAt =
        Number.isFinite(expiresIn) && expiresIn > 0
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : row.expires_at || null;
      const nextMeta = {
        ...asRecord(row.meta),
        youtube_token_refreshed_at: new Date().toISOString(),
      };

      await supabaseAdmin
        .from("integrations")
        .update({
          access_token_enc: encryptToken(nextAccessToken),
          expires_at: expiresAt,
          meta: nextMeta,
        })
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .eq("source", "youtube_shorts")
        .eq("product", "youtube_shorts");
      accessToken = nextAccessToken;
      return accessToken;
    }

    for (const ch of selected) {
      // Final authority check, deliberately performed after every media
      // preparation step and immediately before this channel is dispatched.
      // This closes the race where a credential expires or an administrator
      // disables a channel while a long image/video preparation is running.
      let liveChannelStates: ChannelStates;
      let liveBubbleAccess: Awaited<ReturnType<typeof getAppBubbleAccessMapForUser>>;
      try {
        [liveChannelStates, liveBubbleAccess] = await Promise.all([
          getChannelConnectionStates(supabaseAdmin, userId),
          getAppBubbleAccessMapForUser(supabaseAdmin as any, userId),
        ]);
      } catch (availabilityError) {
        const unavailableMessage = `${PUBLICATION_CHANNEL_LABELS[ch]} est temporairement indisponible : son état n'a pas pu être vérifié.`;
        logPublishChannelFailure({
          route: "booster_publish_now",
          channel: ch,
          userId,
          publicationId,
          stage: "availability_guard",
          error: availabilityError,
          userMessage: unavailableMessage,
        });
        await setDelivery(ch, { status: "failed", error: unavailableMessage });
        results[ch] = {
          ok: false,
          error: unavailableMessage,
          code: "channel_state_unavailable",
          retryable: true,
        };
        continue;
      }

      try {
        const liveChannelState = getPublicationChannelState(
          liveChannelStates,
          ch,
        );
        if (!isOfficialPublicationChannelConnected(liveChannelState)) {
          const reconnectRequired =
            publicationChannelRequiresReconnect(liveChannelState);
          const label = PUBLICATION_CHANNEL_LABELS[ch];
          const connectionError = reconnectRequired
            ? `${label} à reconnecter. Rendez-vous dans Canaux.`
            : `${label} à connecter. Rendez-vous dans Canaux.`;
          logPublishChannelFailure({
            route: "booster_publish_now",
            channel: ch,
            userId,
            publicationId,
            stage: "connection_guard",
            error: reconnectRequired
              ? "channel_requires_reconnect"
              : "channel_not_connected",
            userMessage: connectionError,
            diagnostics: {
              connected: liveChannelState.connected,
              expired: liveChannelState.expired,
              requiresUpdate: liveChannelState.requiresUpdate,
              connectionStatus: liveChannelState.connection_status,
            },
          });
          await setDelivery(ch, {
            status: "failed",
            error: connectionError,
          });
          results[ch] = {
            ok: false,
            error: connectionError,
            code: reconnectRequired
              ? "channel_requires_reconnect"
              : "channel_not_connected",
            retryable: false,
          };
          continue;
        }

        const bubbleKey = PUBLICATION_BUBBLE_KEYS[ch];
        if (!isBubbleEnabled(liveBubbleAccess, bubbleKey)) {
          const disabledMessage = `${PUBLICATION_CHANNEL_LABELS[ch]} est désactivé dans Bubble Access.`;
          logPublishChannelFailure({
            route: "booster_publish_now",
            channel: ch,
            userId,
            publicationId,
            stage: "bubble_access_guard",
            error: "bubble_access_disabled",
            userMessage: disabledMessage,
            diagnostics: { bubble_key: bubbleKey, enabled: false },
          });
          await setDelivery(ch, { status: "failed", error: disabledMessage });
          results[ch] = {
            ok: false,
            error: disabledMessage,
            code: "bubble_access_disabled",
            retryable: false,
          };
          continue;
        }

        const preflightFailure = preflightFailuresByChannel[ch];
        if (preflightFailure) {
          await setDelivery(ch, {
            status: "failed",
            error: String(
              preflightFailure.error || "Le média n'est pas publiable sur ce canal.",
            ),
          });
          results[ch] = preflightFailure;
          continue;
        }
        if (ch === "inr_search") {
          const provisioned = await ensureSystemManagedInrSearch(supabaseAdmin as any, userId);
          const publicStatus = await getInrSearchPublicStatus(provisioned.inrSearch.slug);
          if (!publicStatus.published) {
            const unavailableMessage = "La page iNr'Search n'est pas encore publiable.";
            await setDelivery(ch, { status: "failed", error: unavailableMessage });
            results[ch] = { ok: false, error: unavailableMessage, code: publicStatus.reason };
            continue;
          }

          await setDelivery(ch, { status: "delivered", error: null });
          results[ch] = {
            ok: true,
            internal: true,
            status: "published",
            external_url: buildInrSearchPublicUrl(provisioned.inrSearch.slug),
          };
          continue;
        }

        const channelPost = getChannelPost(ch);
        const canonMessage = buildBoosterMessage(ch, channelPost, {
          websiteUrl: siteWebUrl || inrcySiteUrl,
          phone: businessPhone,
        });
        const channelVideo =
          mediaModeByChannel[ch] === "video"
            ? getPublicationVideoForChannel(ch)
            : null;

        if (ch === "inrcy_site" || ch === "site_web") {
          // We treat "publication" as an "article/actu" for the site.
          // This creates a record that your iNrCy site renderer (or your pro's website connector)
          // can consume to display the article.
          const targetUrl = ch === "inrcy_site" ? inrcySiteUrl : siteWebUrl;
          if (
            ch === "inrcy_site" &&
            (!hasActiveInrcySite(ownership) || !targetUrl)
          ) {
            await setDelivery(ch, {
              status: "failed",
              error: "Le site iNrCy n'est pas encore correctement configuré.",
            });
            results[ch] = {
              ok: false,
              error: "Le site iNrCy n'est pas encore correctement configuré.",
            };
            continue;
          }
          if (ch === "site_web" && !targetUrl) {
            await setDelivery(ch, {
              status: "failed",
              error: "Le site web n'est pas encore correctement configuré.",
            });
            results[ch] = {
              ok: false,
              error: "Le site web n'est pas encore correctement configuré.",
            };
            continue;
          }

          const legacySiteImageSet = getChannelImageSet(ch);
          const legacySiteImageUrls = legacySiteImageSet.images.length
            ? legacySiteImageSet.images
            : legacySiteImageSet.socialFeedPublishableUrls.length
              ? legacySiteImageSet.socialFeedPublishableUrls
              : legacySiteImageSet.siteCardPublishableUrls;
          const siteImageUrls =
            mediaModeByChannel[ch] === "images"
              ? pickCompleteChannelImageUrls({
                  channel: ch,
                  candidates: ["images", "publishableUrls"],
                  legacyFallback: legacySiteImageUrls,
                  limit: 5,
                })
              : [];
          if (
            mediaModeByChannel[ch] === "images" &&
            getExpectedChannelImageCount(ch) > 0 &&
            !siteImageUrls.length
          ) {
            const siteImageError =
              "Les images du site n'ont pas pu être préparées sans modifier le rendu.";
            await setDelivery(ch, { status: "failed", error: siteImageError });
            results[ch] = { ok: false, error: siteImageError };
            continue;
          }

          // A restarted channel worker reuses the same local resource instead
          // of creating a duplicate article after a lost response.
          const articleId = buildDeterministicPublicationChildId({
            publicationId,
            channel: ch,
            resource: "site_article",
          });
          const slug = slugify(channelPost.title) || "actu";
          const externalUrl = targetUrl
            ? `${targetUrl.replace(/\/+$/g, "")}/actu/${slug}-${articleId}`
            : null;

          // IMPORTANT: keep this insert compatible with your current `public.site_articles` table.
          // Your table currently contains at least: id, created_at, user_id, source, title, content.
          // (If you later add more columns, you can extend this insert.)
          const { error: artErr } = await supabaseAdmin
            .from("site_articles")
            .upsert({
              id: articleId,
              user_id: userId,
              source: ch,
              title: channelPost.title,
              content: channelPost.content,
              cta: channelPost.cta,
              hashtags: channelPost.hashtags,
              // For website embeds, keep the channel-specific prepared source.
              // Never borrow another channel's crop/ratio as a fallback.
              images: siteImageUrls,
              ...(mediaModeByChannel[ch] === "video" && channelVideo
                ? {
                    media_type: "video",
                    video_url: channelVideo.publicUrl,
                    video_path: channelVideo.storagePath,
                    video_mime: channelVideo.type,
                    video_size: channelVideo.size,
                    video_duration_seconds: channelVideo.duration,
                    video_thumbnail_url: channelVideo.thumbnailUrl,
                    media_metadata: { video: channelVideo },
                  }
                : {}),
              external_url: externalUrl, // ✅ si tu veux (optionnel)
              site_url: targetUrl || null, // ✅ si tu veux (optionnel)
            }, { onConflict: "id" });

          if (artErr) {
            const siteUserError = getPublishChannelUserMessage(
              ch,
              artErr,
              "Impossible de créer l'article pour le moment.",
            );
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: ch,
              userId,
              publicationId,
              stage: "site_article",
              error: artErr,
              userMessage: siteUserError,
            });
            await setDelivery(ch, { status: "failed", error: siteUserError });
            results[ch] = {
              ok: false,
              error: siteUserError,
              raw_error: artErr.message || String(artErr),
            };
            continue;
          }

          await setDelivery(ch, {
            status: "delivered",
            error: null,
          });
          results[ch] = {
            ok: true,
            external_id: articleId,
            external_url: externalUrl,
          };
          continue;
        }

        if (ch === "facebook") {
          const fb = asRecord(fbRow);
          const pageId = String(fb["resource_id"] ?? "");
          const pageTokenRaw = String(fb["access_token_enc"] ?? "");
          const pageToken = tryDecryptToken(pageTokenRaw) || "";
          const fbMeta = asRecord(fb["meta"]);
          const fbExpired =
            isExpired(fb["expires_at"]) &&
            !String(fbMeta["selected"] ?? "") &&
            !pageId;
          if (
            String(fb["status"] ?? "") !== "connected" ||
            !pageId ||
            !pageToken ||
            fbExpired
          ) {
            const facebookUserError = fbExpired
              ? getPublishChannelUserMessage("facebook", "token expired")
              : "Facebook à connecter. Rendez-vous dans Canaux.";
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "facebook",
              userId,
              publicationId,
              stage: "precheck",
              error: fbExpired ? "token_expired" : "not_connected",
              userMessage: facebookUserError,
            });
            await markPublishChannelReconnectRequired({
              channel: "facebook",
              userId,
              stage: "precheck",
              attemptStartedAt: publicationAttemptStartedAt,
              error: fbExpired ? "token_expired" : "not_connected",
              userMessage: facebookUserError,
            });
            await setDelivery(ch, {
              status: "failed",
              error: facebookUserError,
            });
            results[ch] = { ok: false, error: facebookUserError };
            continue;
          }

          const facebookImageUrls = pickCompleteChannelImageUrls({
            channel: ch,
            candidates: [
              "socialFeedPublishableUrls",
              "publishableUrls",
              "images",
            ],
            legacyFallback: socialFeedImageUrls,
            limit: 5,
          });
          if (
            mediaModeByChannel[ch] === "images" &&
            getExpectedChannelImageCount(ch) > 0 &&
            !facebookImageUrls.length
          ) {
            const facebookUserError =
              "Les images Facebook n'ont pas pu être préparées sans modifier le rendu.";
            await setDelivery(ch, {
              status: "failed",
              error: facebookUserError,
            });
            results[ch] = { ok: false, error: facebookUserError };
            continue;
          }

          let facebookWarning: { code: string; message: string } | null = null;
          const resp =
            mediaModeByChannel[ch] === "video" && channelVideo
              ? await facebookPublishVideoToPage({
                  pageId,
                  pageAccessToken: pageToken,
                  description: canonMessage,
                  title: channelPost.title || undefined,
                  videoUrl: channelVideo.publicUrl,
                })
              : await facebookPublishToPage({
                  pageId,
                  pageAccessToken: pageToken,
                  message: canonMessage,
                  imageUrls: facebookImageUrls,
                });

          if (!resp.ok) {
            const facebookUserError = getPublishChannelUserMessage(
              "facebook",
              resp.error,
            );
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "facebook",
              userId,
              publicationId,
              stage: "publish",
              error: resp.error,
              userMessage: facebookUserError,
              diagnostics: resp,
            });
            await markPublishChannelReconnectRequired({
              channel: "facebook",
              userId,
              stage: "publish",
              attemptStartedAt: publicationAttemptStartedAt,
              error: resp.error,
              userMessage: facebookUserError,
            });
            await setDelivery(ch, {
              status: "failed",
              error: facebookUserError,
            });
            results[ch] = {
              ok: false,
              error: facebookUserError,
              raw_error: resp.error,
              diagnostics: resp,
              ...(resp.requestMayHaveSucceeded
                ? { code: "provider_status_unknown", retryable: false }
                : {}),
            };
            continue;
          }

          if (
            mediaModeByChannel[ch] === "images" &&
            facebookImageUrls.length > 0 &&
            Number(resp.failedImages || 0) > 0
          ) {
            facebookWarning = Number(resp.uploadedImages || 0) > 0
              ? {
                  code: "published_with_partial_images",
                  message:
                    "Facebook a publié uniquement les images acceptées. Une ou plusieurs images n'ont pas pu être jointes.",
                }
              : {
                  code: "published_without_image",
                  message:
                    "Facebook a publié le texte, mais aucune image n'a pu être jointe cette fois-ci.",
                };
          }

          await setDelivery(ch, {
            status: "delivered",
            error: null,
          });

          results[ch] = {
            ok: true,
            external_id: resp.postId,
            diagnostics: resp,
            ...(facebookWarning
              ? {
                  warning: facebookWarning.code,
                  warning_message: facebookWarning.message,
                }
              : {}),
          };
          continue;
        }

        if (ch === "instagram") {
          const ig = asRecord(igRow);
          const igUserId = String(ig["resource_id"] ?? "");
          const igTokenRaw = String(ig["access_token_enc"] ?? "");
          const igToken = tryDecryptToken(igTokenRaw) || "";
          const igMeta = asRecord(ig["meta"]);
          const igExpired =
            isExpired(ig["expires_at"]) &&
            !String(igMeta["page_id"] ?? "") &&
            !igUserId;
          if (
            String(ig["status"] ?? "") !== "connected" ||
            !igUserId ||
            !igToken ||
            igExpired
          ) {
            const instagramUserError = igExpired
              ? INSTAGRAM_RECONNECT_USER_MESSAGE
              : "Instagram à connecter. Rendez-vous dans Canaux.";
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "instagram",
              userId,
              publicationId,
              stage: "precheck",
              error: igExpired ? "token_expired" : "not_connected",
              userMessage: instagramUserError,
            });
            await markPublishChannelReconnectRequired({
              channel: "instagram",
              userId,
              stage: "precheck",
              attemptStartedAt: publicationAttemptStartedAt,
              error: igExpired ? "token_expired" : "not_connected",
              userMessage: instagramUserError,
            });
            await setDelivery(ch, {
              status: "failed",
              error: instagramUserError,
            });
            results[ch] = { ok: false, error: instagramUserError };
            continue;
          }

          const instagramCaption = buildBoosterInstagramCaption(channelPost, {
            websiteUrl: siteWebUrl || inrcySiteUrl,
            phone: businessPhone,
          });
          const instagramTokenCandidates = buildInstagramPublishTokenCandidates(
            ig,
            fbRow,
          );
          if (mediaModeByChannel[ch] === "video" && channelVideo) {
            const videoSourceIdentity = buildInstagramVideoSourceIdentity({
              bucket: channelVideo.bucket,
              storagePath: channelVideo.storagePath,
              videoUrl: channelVideo.publicUrl,
            });
            const expectedRequestFingerprint =
              buildInstagramVideoRequestFingerprint({
                igUserId,
                videoUrl: channelVideo.publicUrl,
                videoSourceIdentity,
                caption: instagramCaption,
                shareToFeed: true,
              });
            const compatibleRequestFingerprints = [
              buildInstagramVideoRequestFingerprint({
                igUserId,
                videoUrl: channelVideo.publicUrl,
                caption: instagramCaption,
                shareToFeed: true,
              }),
            ];
            const rawCheckpoint = internalAsyncDispatch
              ? asRecord(body._instagramVideoCheckpoint)
              : {};
            const persistedCheckpoint =
              parseInstagramVideoPublishCheckpoint(rawCheckpoint);
            let videoPhaseResult: InstagramVideoPhaseResult;

            if (!internalAsyncDispatch || !asyncChannelEventId) {
              videoPhaseResult = {
                ok: false,
                phase: "create",
                outcome: "failed",
                error:
                  "La publication video Instagram exige le worker durable.",
                code: "instagram_video_async_worker_required",
                retryable: false,
                requestMayHaveSucceeded: false,
                authorizationError: false,
              };
            } else if (
              Object.keys(rawCheckpoint).length > 0 &&
              !persistedCheckpoint
            ) {
              // Never recreate when durable state says a previous create may
              // already have returned a provider container.
              videoPhaseResult = {
                ok: false,
                phase: "create",
                outcome: "ambiguous",
                error: "Le checkpoint video Instagram est incoherent.",
                code: "instagram_video_checkpoint_invalid",
                retryable: false,
                requestMayHaveSucceeded: true,
                authorizationError: false,
              };
            } else if (!persistedCheckpoint) {
              videoPhaseResult =
                await instagramCreateVideoCheckpointWithTokenFallback({
                  igUserId,
                  accessToken: igToken,
                  tokenCandidates: instagramTokenCandidates,
                  caption: instagramCaption,
                  videoUrl: channelVideo.publicUrl,
                  videoSourceIdentity,
                  shareToFeed: true,
                });
            } else if (
              ["ready", "published", "publish_unknown"].includes(
                persistedCheckpoint.state,
              )
            ) {
              videoPhaseResult =
                await instagramPublishVideoCheckpointWithTokenFallback({
                  checkpoint: persistedCheckpoint,
                  igUserId,
                  accessToken: igToken,
                  tokenCandidates: instagramTokenCandidates,
                  expectedRequestFingerprint,
                  compatibleRequestFingerprints,
                });
            } else {
              videoPhaseResult =
                await instagramPollVideoCheckpointWithTokenFallback({
                  checkpoint: persistedCheckpoint,
                  accessToken: igToken,
                  tokenCandidates: instagramTokenCandidates,
                  expectedRequestFingerprint,
                  compatibleRequestFingerprints,
                });
            }

            // Commit the provider container before the first status request.
            if (
              videoPhaseResult.ok &&
              videoPhaseResult.outcome === "checkpoint"
            ) {
              await persistInstagramVideoCheckpoint(
                videoPhaseResult.checkpoint,
                { status: "processing", instagramVideoContinuation: true },
              );
              videoPhaseResult =
                await instagramPollVideoCheckpointWithTokenFallback({
                  checkpoint: videoPhaseResult.checkpoint,
                  accessToken: igToken,
                  tokenCandidates: instagramTokenCandidates,
                  expectedRequestFingerprint,
                  compatibleRequestFingerprints,
                });
            }

            // Commit FINISHED before the only media_publish request.
            if (
              videoPhaseResult.ok &&
              videoPhaseResult.outcome === "ready"
            ) {
              await persistInstagramVideoCheckpoint(
                videoPhaseResult.checkpoint,
                { status: "processing", instagramVideoContinuation: true },
              );
              videoPhaseResult =
                await instagramPublishVideoCheckpointWithTokenFallback({
                  checkpoint: videoPhaseResult.checkpoint,
                  igUserId,
                  accessToken: igToken,
                  tokenCandidates: instagramTokenCandidates,
                  expectedRequestFingerprint,
                  compatibleRequestFingerprints,
                });
            }

            const shouldContinue =
              (videoPhaseResult.ok &&
                ["checkpoint", "processing"].includes(
                  videoPhaseResult.outcome,
                )) ||
              (!videoPhaseResult.ok && videoPhaseResult.retryable);
            if (shouldContinue && videoPhaseResult.checkpoint) {
              return queueInstagramVideoContinuation({
                checkpoint: videoPhaseResult.checkpoint,
                phaseResult: videoPhaseResult,
              });
            }

            if (
              videoPhaseResult.ok &&
              videoPhaseResult.outcome === "published" &&
              videoPhaseResult.mediaId
            ) {
              await persistInstagramVideoCheckpoint(
                videoPhaseResult.checkpoint,
                {
                  status: "processing",
                  instagramVideoContinuation: false,
                  instagramVideoNextPollAt: null,
                },
              );
              await setDelivery(ch, { status: "delivered", error: null });
              results[ch] = {
                ok: true,
                external_id: videoPhaseResult.mediaId,
                instagram_media_type: "REELS",
                instagram_parent_media_id: videoPhaseResult.mediaId,
                instagram_child_media_ids: [],
                diagnostics: videoPhaseResult,
              };
              continue;
            }

            // Terminal provider states are durable too. In particular, a
            // publish_unknown checkpoint must replace the previous `ready`
            // state before this worker closes as failed; otherwise a later
            // recovery could issue media_publish a second time.
            if (!videoPhaseResult.ok && videoPhaseResult.checkpoint) {
              await persistInstagramVideoCheckpoint(
                videoPhaseResult.checkpoint,
                {
                  instagramVideoContinuation: false,
                  instagramVideoNextPollAt: null,
                },
              );
            }

            const rawVideoError = videoPhaseResult.ok
              ? "Instagram n'a retourne aucun resultat video exploitable."
              : videoPhaseResult.error;
            const instagramUserError =
              (!videoPhaseResult.ok && videoPhaseResult.authorizationError) ||
              isInstagramAuthorizationLikeMessage(
                `instagram ${rawVideoError}`,
              )
                ? INSTAGRAM_RECONNECT_USER_MESSAGE
                : getSimpleFrenchErrorMessage(
                    `instagram ${rawVideoError}`,
                    rawVideoError || "La publication Instagram a echoue.",
                  );
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "instagram",
              userId,
              publicationId,
              stage: videoPhaseResult.phase,
              error: rawVideoError,
              userMessage: instagramUserError,
              diagnostics: videoPhaseResult,
            });
            await markPublishChannelReconnectRequired({
              channel: "instagram",
              userId,
              stage: videoPhaseResult.phase,
              attemptStartedAt: publicationAttemptStartedAt,
              error: rawVideoError,
              userMessage: instagramUserError,
            });
            await setDelivery(ch, {
              status: "failed",
              error: instagramUserError,
            });
            results[ch] = {
              ok: false,
              error: instagramUserError,
              raw_error: rawVideoError,
              code: videoPhaseResult.ok
                ? "instagram_video_missing_result"
                : videoPhaseResult.code,
              requestMayHaveSucceeded:
                !videoPhaseResult.ok &&
                videoPhaseResult.requestMayHaveSucceeded,
              diagnostics: videoPhaseResult,
            };
            continue;
          }

          const instagramImages = pickCompleteChannelImageUrls({
              channel: ch,
              candidates: ["instagramPublishableUrls"],
              legacyFallback: instagramImageUrls,
              limit: 10,
            });
            if (!instagramImages.length) {
              await setDelivery(ch, {
                status: "failed",
                error: "Instagram nécessite au moins 1 image",
              });
              results[ch] = {
                ok: false,
                error: "Instagram a besoin d'au moins une image pour publier.",
              };
              continue;
            }
          const resp = instagramImages.length > 1
                ? await instagramPublishCarouselWithTokenFallback({
                    igUserId,
                    accessToken: igToken,
                    tokenCandidates: instagramTokenCandidates,
                    caption: instagramCaption,
                    imageUrls: instagramImages,
                  })
                : await instagramPublishPhotoWithTokenFallback({
                    igUserId,
                    accessToken: igToken,
                    tokenCandidates: instagramTokenCandidates,
                    caption: instagramCaption,
                    imageUrl: instagramImages[0],
                  });

          if (!resp.ok) {
            const instagramUserError =
              isInstagramAuthorizationErrorResult(resp) ||
              isInstagramAuthorizationLikeMessage(`instagram ${resp.error}`)
                ? INSTAGRAM_RECONNECT_USER_MESSAGE
                : getSimpleFrenchErrorMessage(
                    `instagram ${resp.error}`,
                    resp.error || "La publication Instagram a échoué.",
                  );
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "instagram",
              userId,
              publicationId,
              stage: "publish",
              error: resp.error,
              userMessage: instagramUserError,
              diagnostics: resp,
            });
            await markPublishChannelReconnectRequired({
              channel: "instagram",
              userId,
              stage: "publish",
              attemptStartedAt: publicationAttemptStartedAt,
              error: resp.error,
              userMessage: instagramUserError,
            });
            await setDelivery(ch, {
              status: "failed",
              error: instagramUserError,
            });
            results[ch] = {
              ok: false,
              error: instagramUserError,
              raw_error: resp.error,
              diagnostics: resp,
            };
            continue;
          }

          await setDelivery(ch, {
            status: "delivered",
            error: null,
          });

          results[ch] = {
            ok: true,
            external_id: resp.mediaId,
            instagram_media_type: resp.mediaType,
            instagram_parent_media_id: resp.parentMediaId || resp.mediaId,
            instagram_child_media_ids:
              resp.childMediaIds || resp.childContainerIds || [],
            diagnostics: resp,
          };
          continue;
        }

        if (ch === "linkedin") {
          const li = asRecord(liRow);
          const auth = await getLinkedInAccessToken({ userId });
          const accessToken = auth.accessToken || "";
          const liMeta = asRecord(li["meta"]);
          const linkedinSettings = asRecord(proSettings["linkedin"]);
          const shouldShareLinkedInPageToProfile =
            linkedinSettings["shareToPersonalProfile"] === true ||
            linkedinSettings["shareToPersonalProfile"] === "true" ||
            linkedinSettings["autoShareToPersonalProfile"] === true ||
            linkedinSettings["autoShareToPersonalProfile"] === "true";
          const rawAuthorUrn =
            auth.authorUrn || String(li["resource_id"] ?? "");
          const authorUrn = rawAuthorUrn.startsWith("urn:li:person:")
            ? rawAuthorUrn
            : "";
          const selectedOrgId = String(liMeta["org_id"] || "").trim();
          const orgUrn =
            auth.orgUrn ||
            String(liMeta["org_urn"] || "") ||
            (selectedOrgId ? `urn:li:organization:${selectedOrgId}` : "");
          const useAuthor = orgUrn || authorUrn;
          if (
            String(li["status"] ?? "") !== "connected" ||
            !accessToken ||
            !useAuthor
          ) {
            const liRawError =
              auth.error && auth.refreshTokenPresent
                ? `token refresh failed: ${auth.error}`
                : auth.error && !auth.refreshTokenPresent
                  ? `token expired: ${auth.error}`
                  : "not_connected";
            const liError = getPublishChannelUserMessage(
              "linkedin",
              liRawError,
              "LinkedIn à connecter. Rendez-vous dans Canaux.",
            );
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "linkedin",
              userId,
              publicationId,
              stage: "precheck",
              error: liRawError,
              userMessage: liError,
              diagnostics: {
                refreshTokenPresent: auth.refreshTokenPresent,
                refreshed: auth.refreshed,
                canReconnectSilently: auth.canReconnectSilently,
              },
            });
            await markPublishChannelReconnectRequired({
              channel: "linkedin",
              userId,
              stage: "precheck",
              attemptStartedAt: publicationAttemptStartedAt,
              error: liRawError,
              userMessage: liError,
            });
            await setDelivery(ch, { status: "failed", error: liError });
            results[ch] = {
              ok: false,
              error: liError,
              raw_error: auth.error || null,
            };
            continue;
          }
          const linkedInImages = pickCompleteChannelImageUrls({
            channel: ch,
            candidates: [
              "socialFeedPublishableUrls",
              "publishableUrls",
              "images",
            ],
            legacyFallback: socialFeedImageUrls.length
              ? socialFeedImageUrls
              : externalImageUrls,
            limit: 20,
          });
          if (
            mediaModeByChannel[ch] === "images" &&
            getExpectedChannelImageCount(ch) > 0 &&
            !linkedInImages.length
          ) {
            const linkedInUserError =
              "Les images LinkedIn n'ont pas pu être préparées sans modifier le rendu.";
            await setDelivery(ch, {
              status: "failed",
              error: linkedInUserError,
            });
            results[ch] = { ok: false, error: linkedInUserError };
            continue;
          }

          const isLinkedInVideo = Boolean(
            mediaModeByChannel[ch] === "video" && channelVideo,
          );
          let linkedInWarning: { code: string; message: string } | null = null;
          let resp = isLinkedInVideo
            ? await linkedinPublishVideo({
                accessToken,
                authorUrn: useAuthor,
                text: canonMessage,
                videoUrl: channelVideo!.publicUrl || channelVideo!.url || "",
                title: channelPost.title || undefined,
              })
            : linkedInImages.length > 1
              ? await linkedinPublishMultiImage({
                  accessToken,
                  authorUrn: useAuthor,
                  text: canonMessage,
                  imageUrls: linkedInImages,
                  title: channelPost.title || undefined,
                })
              : linkedInImages[0]
                ? await linkedinPublishImage({
                    accessToken,
                    authorUrn: useAuthor,
                    text: canonMessage,
                    imageUrl: linkedInImages[0],
                    title: channelPost.title || undefined,
                  })
                : await linkedinPublishText({
                    accessToken,
                    authorUrn: useAuthor,
                    text: canonMessage,
                  });

          if (
            !resp.ok &&
            !isLinkedInVideo &&
            linkedInImages.length > 0 &&
            resp.safeTextFallback === true
          ) {
            const mediaResp = resp;
            const fallbackResp = await linkedinPublishText({
              accessToken,
              authorUrn: useAuthor,
              text: canonMessage,
            });
            if (fallbackResp.ok) {
              linkedInWarning = {
                code: "published_without_image",
                message:
                  "LinkedIn a publié le texte, mais les images n'ont pas pu être jointes cette fois-ci.",
              };
              resp = {
                ...fallbackResp,
                diagnostics: {
                  mediaPublishError: mediaResp.error,
                  mediaPublishDiagnostics: mediaResp.diagnostics,
                  fallback: "text_only",
                },
              };
            }
          }

          if (!resp.ok) {
            const linkedInUserError = getPublishChannelUserMessage(
              "linkedin",
              resp.error,
            );
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "linkedin",
              userId,
              publicationId,
              stage: "publish",
              error: resp.error,
              userMessage: linkedInUserError,
              diagnostics: resp,
            });
            await markPublishChannelReconnectRequired({
              channel: "linkedin",
              userId,
              stage: "publish",
              attemptStartedAt: publicationAttemptStartedAt,
              error: resp.error,
              userMessage: linkedInUserError,
            });
            await setDelivery(ch, {
              status: "failed",
              error: linkedInUserError,
            });
            results[ch] = {
              ok: false,
              error: linkedInUserError,
              raw_error: resp.error,
              diagnostics: resp,
              ...(resp.requestMayHaveSucceeded
                ? { code: "provider_status_unknown", retryable: false }
                : {}),
            };
            continue;
          }

          let linkedInDiagnostics: any = resp;
          let linkedInPersonalShareUrn: string | null = null;
          const canSharePagePostToProfile = Boolean(
            shouldShareLinkedInPageToProfile &&
            orgUrn &&
            authorUrn &&
            resp.postUrn,
          );

          if (canSharePagePostToProfile) {
            const shareResp = await linkedinResharePost({
              accessToken,
              authorUrn,
              parentPostUrn: String(resp.postUrn),
            });
            if (shareResp.ok) {
              linkedInPersonalShareUrn = shareResp.postUrn || null;
              linkedInDiagnostics = {
                ...resp,
                personalProfileShare: shareResp,
              };
            } else {
              linkedInDiagnostics = {
                ...resp,
                personalProfileShare: {
                  ok: false,
                  error: shareResp.error,
                  diagnostics: shareResp.diagnostics,
                },
              };
              logPublishChannelFailure({
                route: "booster_publish_now",
                channel: "linkedin",
                userId,
                publicationId,
                stage: "share_to_profile",
                error: shareResp.error,
                userMessage:
                  "Publié sur la page LinkedIn. Le partage sur le profil personnel a échoué.",
                diagnostics: shareResp,
              });
            }
          } else if (shouldShareLinkedInPageToProfile) {
            linkedInDiagnostics = {
              ...resp,
              personalProfileShare: {
                ok: false,
                skipped: true,
                reason: !orgUrn
                  ? "no_organization_post"
                  : !authorUrn
                    ? "no_personal_profile_author"
                    : "missing_parent_post_urn",
              },
            };
          }

          await setDelivery(ch, {
            status: "delivered",
            error: null,
          });

          results[ch] = {
            ok: true,
            external_id: resp.postUrn || null,
            linkedin_personal_share_id: linkedInPersonalShareUrn,
            diagnostics: linkedInDiagnostics,
            ...(linkedInWarning
              ? {
                  warning: linkedInWarning.code,
                  warning_message: linkedInWarning.message,
                }
              : {}),
          };
          continue;
        }

        if (ch === "youtube_shorts") {
          const youtubeSettings = asRecord(proSettings["youtube_shorts"]);
          const youtubeActive = isYoutubeShortsIntegrationActive(youtubeRow);
          const youtubeAccessToken = youtubeActive
            ? await getYoutubeShortsAccessToken(youtubeRow)
            : "";
          const youtubeMeta = asRecord(asRecord(youtubeRow).meta);
          const channelUrl = String(
            youtubeMeta.channel_url ||
              youtubeSettings.channelUrl ||
              youtubeSettings.url ||
              "",
          ).trim();

          if (!youtubeActive || !youtubeAccessToken) {
            const youtubeUserError = youtubeActive
              ? "YouTube à reconnecter. Rendez-vous dans Canaux."
              : "YouTube à connecter. Rendez-vous dans Canaux.";
            await markPublishChannelReconnectRequired({
              channel: "youtube_shorts",
              userId,
              stage: "precheck",
              attemptStartedAt: publicationAttemptStartedAt,
              error: youtubeActive ? "access_token_unavailable" : "not_connected",
              userMessage: youtubeUserError,
            });
            await setDelivery(ch, {
              status: "failed",
              error: youtubeUserError,
            });
            results[ch] = { ok: false, error: youtubeUserError };
            continue;
          }

          if (mediaModeByChannel[ch] !== "video" || !channelVideo) {
            const youtubeUserError = "YouTube nécessite une vidéo.";
            await setDelivery(ch, {
              status: "failed",
              error: youtubeUserError,
            });
            results[ch] = { ok: false, error: youtubeUserError };
            continue;
          }

          const youtubeDefaults = asRecord(youtubeSettings.defaults);
          const visibilityRaw = String(
            youtubeDefaults.defaultVisibility || "public",
          );
          const privacyStatus = (
            ["public", "unlisted", "private"].includes(visibilityRaw)
              ? visibilityRaw
              : "public"
          ) as "public" | "unlisted" | "private";
          const madeForKids = Boolean(youtubeDefaults.madeForKids);
          const youtubeDuration = Number(channelVideo.duration || 0);
          let youtubeLongUploadsStatus = normalizeYoutubeLongUploadsStatus(
            youtubeMeta.long_uploads_status,
          );
          if (
            Number.isFinite(youtubeDuration) &&
            youtubeDuration > YOUTUBE_LONG_UPLOAD_THRESHOLD_SECONDS
          ) {
            try {
              const channelInfo = await fetchYoutubeMineChannel(
                youtubeAccessToken,
              );
              youtubeLongUploadsStatus = normalizeYoutubeLongUploadsStatus(
                channelInfo?.longUploadsStatus,
              );
            } catch {
              youtubeLongUploadsStatus = "unknown";
            }
          }
          const youtubeDurationValidation =
            validateVideoDurationForChannel({
              channel: "youtube_shorts",
              durationSeconds: youtubeDuration,
              youtubeLongUploadsStatus,
              enforceAccountCapabilities: true,
            });
          if (!youtubeDurationValidation.ok) {
            await setDelivery(ch, {
              status: "failed",
              error: youtubeDurationValidation.message,
            });
            results[ch] = {
              ok: false,
              code: youtubeDurationValidation.reason,
              retryable: false,
              error: youtubeDurationValidation.message,
            };
            continue;
          }
          const youtubePublicationType =
            getYoutubePublicationTypeForDuration(youtubeDuration);
          const youtubeFormat =
            videoSettingsByChannel.youtube_shorts?.format || "original";
          const hashtags = Array.isArray(channelPost.hashtags)
            ? channelPost.hashtags
            : [];
          const normalizedTags = hashtags
            .map((tag) => normalizeHashtag(String(tag)))
            .filter(Boolean)
            .slice(0, 8);
          const autoHashtags = youtubeDefaults.autoHashtags !== false;
          const youtubeTags = autoHashtags
            ? Array.from(new Set(["iNrCy", ...normalizedTags]))
            : normalizedTags;
          const tagLine = buildBoosterHashtagLine(
            { ...channelPost, hashtags: youtubeTags },
            canonMessage,
            8,
          );
          const description = [canonMessage, tagLine]
            .filter(Boolean)
            .join("\n\n");

          const youtubeUploadInput: YoutubeShortsUploadInput = {
            accessToken: youtubeAccessToken,
            videoUrl: channelVideo.publicUrl || channelVideo.url || "",
            title: channelPost.title || post.title || "Vidéo iNrCy",
            description,
            privacyStatus,
            madeForKids,
            mimeType: channelVideo.type,
            tags: youtubeTags,
            publicationType: youtubePublicationType,
          };
          let upload: YoutubeShortsUploadResult;

          if (internalAsyncDispatch && asyncChannelEventId) {
            const uploadBudgetEndsAt = Date.now() + 35_000;
            const hasRawYoutubeCheckpoint =
              body._youtubeUploadCheckpoint !== null &&
              body._youtubeUploadCheckpoint !== undefined;
            const rawYoutubeCheckpoint = asRecord(
              body._youtubeUploadCheckpoint,
            );
            const persistedYoutubeCheckpoint =
              parseYoutubeResumableUploadCheckpoint(rawYoutubeCheckpoint);
            let uploadPhase: YoutubeResumableUploadPhaseResult;

            if (
              hasRawYoutubeCheckpoint &&
              !persistedYoutubeCheckpoint
            ) {
              // A corrupt durable record may still represent an existing
              // provider session. Fail closed instead of creating a second
              // videos.insert operation.
              uploadPhase = {
                ok: false,
                phase: "upload",
                outcome: "ambiguous",
                error: "Le checkpoint d'upload YouTube est incohérent.",
                code: "youtube_upload_checkpoint_invalid",
                retryable: false,
                requestMayHaveSucceeded: true,
              };
            } else if (!persistedYoutubeCheckpoint) {
              uploadPhase =
                await createYoutubeResumableUploadCheckpoint(
                  youtubeUploadInput,
                );
            } else {
              uploadPhase =
                await resumeYoutubeResumableUploadCheckpoint({
                  ...youtubeUploadInput,
                  checkpoint: persistedYoutubeCheckpoint,
                });
            }

            // Persist Location before sending the first byte. A process restart
            // can query this exact session instead of issuing videos.insert
            // again.
            if (uploadPhase.ok && uploadPhase.outcome === "checkpoint") {
              await persistYoutubeUploadCheckpoint(uploadPhase.checkpoint, {
                status: "processing",
                youtubeUploadContinuation: true,
              });
              uploadPhase =
                await resumeYoutubeResumableUploadCheckpoint({
                  ...youtubeUploadInput,
                  checkpoint: uploadPhase.checkpoint,
                });
            }

            // Stream several bounded chunks while this worker has budget. Every
            // acknowledged offset is committed before the following PUT, so a
            // timeout loses at most one response and never resends blindly.
            let uploadedChunksThisRun = 0;
            while (
              uploadPhase.ok &&
              uploadPhase.outcome === "processing"
            ) {
              await persistYoutubeUploadCheckpoint(uploadPhase.checkpoint, {
                status: "processing",
                youtubeUploadContinuation: true,
              });
              uploadedChunksThisRun += 1;
              if (
                Date.now() >= uploadBudgetEndsAt ||
                uploadedChunksThisRun >= 24
              ) {
                break;
              }
              uploadPhase =
                await resumeYoutubeResumableUploadCheckpoint({
                  ...youtubeUploadInput,
                  checkpoint: uploadPhase.checkpoint,
                });
            }

            const shouldContinueYoutubeUpload =
              (uploadPhase.ok &&
                ["checkpoint", "processing"].includes(
                  uploadPhase.outcome,
                )) ||
              (!uploadPhase.ok && uploadPhase.retryable);
            if (shouldContinueYoutubeUpload && uploadPhase.checkpoint) {
              return queueYoutubeUploadContinuation({
                checkpoint: uploadPhase.checkpoint,
                phaseResult: uploadPhase,
              });
            }

            if (
              uploadPhase.ok &&
              uploadPhase.outcome === "published" &&
              uploadPhase.videoId
            ) {
              await persistYoutubeUploadCheckpoint(uploadPhase.checkpoint, {
                status: "processing",
                youtubeUploadContinuation: false,
                youtubeUploadNextRunAt: null,
              });
              upload = uploadPhase;
            } else {
              if (!uploadPhase.ok && uploadPhase.checkpoint) {
                await persistYoutubeUploadCheckpoint(
                  uploadPhase.checkpoint,
                  {
                    youtubeUploadContinuation: false,
                    youtubeUploadNextRunAt: null,
                  },
                );
              }
              upload = {
                ok: false,
                error: uploadPhase.ok
                  ? "YouTube n'a retourné aucun résultat exploitable."
                  : uploadPhase.error,
                status: uploadPhase.ok ? undefined : uploadPhase.status,
                reason: uploadPhase.ok ? null : uploadPhase.reason,
                raw: uploadPhase,
              };
            }
          } else {
            upload = await uploadYoutubeShort(youtubeUploadInput);
          }

          if (!upload.ok) {
            const youtubeUserError = getPublishChannelUserMessage(
              "youtube_shorts",
              upload.error || "youtube_upload_failed",
              "Publication YouTube impossible.",
            );
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "youtube_shorts",
              userId,
              publicationId,
              stage: "publish",
              error: upload.error,
              userMessage: youtubeUserError,
              diagnostics: upload,
            });
            await markPublishChannelReconnectRequired({
              channel: "youtube_shorts",
              userId,
              stage: "publish",
              attemptStartedAt: publicationAttemptStartedAt,
              error: upload.error,
              userMessage: youtubeUserError,
            });
            await setDelivery(ch, {
              status: "failed",
              error: youtubeUserError,
            });
            results[ch] = {
              ok: false,
              error: youtubeUserError,
              diagnostics: upload,
            };
            continue;
          }

          const youtubeExternalUrl =
            youtubePublicationType === "short"
              ? upload.shortsUrl || upload.videoUrl || null
              : upload.videoUrl || upload.shortsUrl || null;

          await setDelivery(ch, {
            status: "delivered",
            external_id: upload.videoId || null,
            external_url: youtubeExternalUrl,
            error: null,
          });

          results[ch] = {
            ok: true,
            external_id: upload.videoId || null,
            external_url: youtubeExternalUrl,
            video_url: upload.videoUrl || null,
            shorts_url: upload.shortsUrl || null,
            channel_url: channelUrl || null,
            privacy_status: upload.privacyStatus || privacyStatus,
            processing_status: upload.processingStatus || null,
            upload_status: upload.uploadStatus || null,
            media_type: "video",
            youtube_publication_type: youtubePublicationType,
            youtube_format: youtubeFormat,
            youtube_duration_seconds:
              youtubeDuration || channelVideo.duration || null,
            diagnostics: upload,
          };
          continue;
        }

        if (ch === "tiktok") {
          const tiktokSettings = normalizeTiktokSettings(proSettings["tiktok"]);
          const activeTiktok = isTiktokIntegrationActive(tiktokRow);
          const tiktokAccessToken = activeTiktok
            ? await getTiktokAccessToken(tiktokRow)
            : "";

          if (!activeTiktok || !tiktokAccessToken) {
            const tiktokUserError = activeTiktok
              ? "TikTok à reconnecter. Rendez-vous dans Canaux."
              : "TikTok à connecter. Rendez-vous dans Canaux.";
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "tiktok",
              userId,
              publicationId,
              stage: "precheck",
              error: activeTiktok ? "access_token_unavailable" : "not_connected",
              userMessage: tiktokUserError,
            });
            await markPublishChannelReconnectRequired({
              channel: "tiktok",
              userId,
              stage: "precheck",
              attemptStartedAt: publicationAttemptStartedAt,
              error: activeTiktok ? "access_token_unavailable" : "not_connected",
              userMessage: tiktokUserError,
            });
            await setDelivery(ch, { status: "failed", error: tiktokUserError });
            results[ch] = { ok: false, error: tiktokUserError };
            continue;
          }

          const tiktokMode = mediaModeByChannel[ch] || "none";
          const tiktokImageSet = getChannelImageSet(ch);
          const tiktokRawImages = Array.isArray(imagesByChannel?.tiktok)
            ? (imagesByChannel.tiktok as ImagePayload[])
            : [];
          const tiktokGeometryLocked =
            tiktokRawImages.length > 0 &&
            tiktokRawImages.every((image) =>
              hasFinalImageGeometryDecision(image),
            );
          const expectedTiktokImageCount = getExpectedChannelImageCount(ch);
          const explicitTiktokImageSet = channelImageSets[ch];
          const socialStoragePaths = (
            tiktokImageSet.socialFeedStoragePaths || []
          ).filter(Boolean);
          const sourceStoragePaths = (
            tiktokImageSet.publishableStoragePaths?.length
              ? tiktokImageSet.publishableStoragePaths
              : tiktokImageSet.storagePaths || []
          ).filter(Boolean);
          const hasCompleteTikTokPaths = (paths: string[]) =>
            expectedTiktokImageCount > 0
              ? paths.length >= expectedTiktokImageCount
              : paths.length > 0;
          const tiktokImageStoragePaths = explicitTiktokImageSet
            ? hasCompleteTikTokPaths(socialStoragePaths)
              ? socialStoragePaths.slice(0, expectedTiktokImageCount)
              : hasCompleteTikTokPaths(sourceStoragePaths)
                ? sourceStoragePaths.slice(0, expectedTiktokImageCount)
                : []
            : (socialStoragePaths.length
                ? socialStoragePaths
                : sourceStoragePaths
              ).slice(0, 35);
          const legacyTiktokFallbackImageUrls = (
            tiktokImageSet.publishableUrls.length
              ? tiktokImageSet.publishableUrls
              : tiktokImageSet.socialFeedPublishableUrls.length
                ? tiktokImageSet.socialFeedPublishableUrls
                : tiktokImageSet.images.length
                  ? tiktokImageSet.images
                  : externalImageUrls
          ).filter(Boolean);
          const tiktokFallbackImageUrls = pickCompleteChannelImageUrls({
            channel: ch,
            candidates: [
              "socialFeedPublishableUrls",
              "publishableUrls",
              "images",
            ],
            legacyFallback: legacyTiktokFallbackImageUrls,
            limit: 35,
          });
          const tiktokImageUrls = tiktokImageStoragePaths.length
            ? tiktokImageStoragePaths
                .map((path) =>
                  buildTiktokMediaProxyUrl(req.url, path, undefined, {
                    variant: tiktokGeometryLocked ? "photo_locked" : "photo",
                  }),
                )
                .filter(Boolean)
                .slice(0, 35)
            : tiktokFallbackImageUrls;

          if (tiktokMode === "video" && !channelVideo) {
            const tiktokUserError =
              "TikTok nécessite une vidéo pour ce format.";
            await setDelivery(ch, { status: "failed", error: tiktokUserError });
            results[ch] = { ok: false, error: tiktokUserError };
            continue;
          }

          if (tiktokMode === "images" && !tiktokImageUrls.length) {
            const tiktokUserError =
              "TikTok nécessite au moins 1 photo ou 1 vidéo.";
            await setDelivery(ch, { status: "failed", error: tiktokUserError });
            results[ch] = { ok: false, error: tiktokUserError };
            continue;
          }

          if (tiktokMode !== "video" && tiktokMode !== "images") {
            const tiktokUserError =
              "TikTok nécessite une vidéo ou au moins 1 photo.";
            await setDelivery(ch, { status: "failed", error: tiktokUserError });
            results[ch] = { ok: false, error: tiktokUserError };
            continue;
          }

          const isVideo = tiktokMode === "video";
          const videoUrl =
            isVideo &&
            channelVideo?.storagePath &&
            channelVideo.bucket === "booster"
              ? buildTiktokMediaProxyUrl(req.url, channelVideo.storagePath)
              : isVideo
                ? String(
                    channelVideo?.publicUrl || channelVideo?.url || "",
                  ).trim()
                : "";

          if (
            !tiktokPublicationSettings?.privacyLevel ||
            !tiktokPublicationSettings.musicUsageConfirmed ||
            !["none", "self", "branded", "both"].includes(
              String(tiktokPublicationSettings.commercialContent || ""),
            )
          ) {
            const tiktokUserError =
              "Validez les paramètres TikTok avant publication.";
            await setDelivery(ch, { status: "failed", error: tiktokUserError });
            results[ch] = { ok: false, error: tiktokUserError };
            continue;
          }

          const tiktokHashtagLine = buildBoosterHashtagLine(
            channelPost,
            canonMessage,
            8,
          );
          const tiktokTitle =
            [canonMessage, tiktokHashtagLine]
              .filter(Boolean)
              .join("\n\n")
              .slice(0, 2200) ||
            channelPost.content ||
            channelPost.title ||
            "Publication iNrCy";
          const tiktokVideoLoad = isVideo
            ? await loadFirstAvailableTikTokVideo([
                { video: channelVideo, kind: "channel_variant" },
                { video: channelVideo?.sourceVideo, kind: "source_video" },
                { video: publicationVideo, kind: "publication_source" },
              ])
            : { source: null, probe: null, kind: null, attempted: [] };
          const tiktokVideoSource = tiktokVideoLoad.source;

          if (isVideo && !tiktokVideoSource) {
            const tiktokUserError =
              "La vidéo TikTok n'est pas disponible dans le stockage iNrCy. Réimportez-la puis relancez la publication.";
            await setDelivery(ch, { status: "failed", error: tiktokUserError });
            results[ch] = {
              ok: false,
              error: tiktokUserError,
              diagnostics: {
                provider: "tiktok",
                mode: "direct_post",
                transfer: "FILE_UPLOAD_ONLY",
                storage_path: channelVideo?.storagePath || null,
                attempted_storage_paths: tiktokVideoLoad.attempted,
                code: "tiktok_video_file_upload_required",
              },
            };
            continue;
          }

          if (!isVideo) {
            const prewarmResults = await Promise.all(
              tiktokImageUrls.map(async (imageUrl) => {
                try {
                  const response = await fetch(imageUrl, {
                    method: "HEAD",
                    cache: "no-store",
                  });
                  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
                  const contentLength = Number(response.headers.get("content-length") || 0);
                  return {
                    ok: response.ok &&
                      (contentType === "image/jpeg" || contentType === "image/webp") &&
                      contentLength > 0,
                    status: response.status,
                    contentType,
                    contentLength,
                  };
                } catch (error) {
                  return {
                    ok: false,
                    status: 0,
                    contentType: "",
                    contentLength: 0,
                    error: error instanceof Error ? error.message : String(error || ""),
                  };
                }
              }),
            );
            const invalidPrewarm = prewarmResults.find((entry) => !entry.ok);
            if (invalidPrewarm) {
              const tiktokUserError =
                "L'image TikTok n'a pas pu être préparée de façon stable. Réessayez avec une image JPEG ou WebP.";
              await setDelivery(ch, { status: "failed", error: tiktokUserError });
              results[ch] = {
                ok: false,
                error: tiktokUserError,
                diagnostics: {
                  provider: "tiktok",
                  stage: "photo_prewarm",
                  prewarmResults,
                },
              };
              continue;
            }
          }

          const tiktokResult = isVideo
            ? await tiktokDirectPostVideoFileUpload({
                accessToken: tiktokAccessToken,
                rangeSource: tiktokVideoSource!,
                verifiedSourceProbe: tiktokVideoLoad.probe,
                checkpoint: internalAsyncDispatch
                  ? body._tiktokUploadCheckpoint
                  : null,
                onCheckpoint: persistTikTokUploadCheckpoint,
                title: tiktokTitle,
                publicationSettings:
                  tiktokPublicationSettings as TiktokPublicationSettings,
                videoDurationSeconds: channelVideo?.duration || null,
              })
            : await tiktokDirectPostPhotos({
                accessToken: tiktokAccessToken,
                imageUrls: tiktokImageUrls,
                title: channelPost.title || "Publication iNrCy",
                description: tiktokTitle,
                publicationSettings:
                  tiktokPublicationSettings as TiktokPublicationSettings,
              });

          if (!tiktokResult.ok) {
            const tiktokUserError =
              tiktokResult.error || "TikTok n'a pas accepté la publication.";
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "tiktok",
              userId,
              publicationId,
              stage: "publish",
              error: tiktokResult.error || "tiktok_publish_failed",
              userMessage: tiktokUserError,
              diagnostics: tiktokResult,
            });
            await markPublishChannelReconnectRequired({
              channel: "tiktok",
              userId,
              stage: "publish",
              attemptStartedAt: publicationAttemptStartedAt,
              error: tiktokResult.error,
              userMessage: tiktokUserError,
            });
            await setDelivery(ch, { status: "failed", error: tiktokUserError });
            results[ch] = {
              ok: false,
              error: tiktokUserError,
              diagnostics: tiktokResult,
            };
            continue;
          }

          await setDelivery(ch, {
            status: tiktokResult.status?.pending ? "processing" : "delivered",
            error: null,
          });

          const tiktokPendingMessage = tiktokResult.status?.statusFetchFailed
            ? `TikTok a accepté l'envoi, mais le statut n'est pas lisible pour le moment : ${tiktokResult.status.failReason || "vérification temporairement indisponible"}.`
            : tiktokResult.status?.pending
              ? "TikTok a accepté l'envoi. iNrSend vérifie automatiquement sa finalisation."
              : null;

          const tiktokOpenUrl =
            String(
              tiktokResult.shareUrl || tiktokSettings.profileUrl || "",
            ).trim() || null;

          results[ch] = {
            ok: true,
            external_id: tiktokResult.publishId || null,
            external_url: tiktokOpenUrl,
            share_url: tiktokResult.shareUrl || null,
            tiktok_status: tiktokResult.status?.status || "PUBLISH_COMPLETE",
            tiktok_status_label: tiktokResult.status?.statusFetchFailed
              ? "Vérification impossible"
              : tiktokResult.status?.pending
                ? "En traitement"
                : "Publié",
            tiktok_status_message: tiktokPendingMessage,
            tiktok_status_checked_at: new Date().toISOString(),
            tiktok_submitted_at: new Date().toISOString(),
            tiktok_status_fetch_failed: Boolean(tiktokResult.status?.statusFetchFailed),
            tiktok_uploaded_bytes: tiktokResult.status?.uploadedBytes ?? null,
            tiktok_downloaded_bytes: tiktokResult.status?.downloadedBytes ?? null,
            tiktok_public_post_ids: tiktokResult.status?.publiclyAvailablePostIds || [],
            tiktok_media_type: isVideo ? "video" : "photos",
            warning: Boolean(tiktokPendingMessage),
            warning_message: tiktokPendingMessage,
            media_type: isVideo ? "video" : "photos",
            media_count: isVideo ? 1 : tiktokImageUrls.length,
            username: tiktokSettings.username,
            profile_url: tiktokSettings.profileUrl || null,
            diagnostics: {
              provider: "tiktok",
              mode: "direct_post",
              transfer: isVideo ? "FILE_UPLOAD" : "PULL_FROM_URL",
              publish_id: tiktokResult.publishId || null,
              mediaType: isVideo ? "video" : "photos",
              privacyLevel: tiktokResult.privacyLevel || null,
              mediaUrls: isVideo ? (videoUrl ? [videoUrl] : []) : tiktokImageUrls,
              publicationSettings: tiktokPublicationSettings,
              status: tiktokResult.status || null,
              share_url: tiktokResult.shareUrl || null,
              raw: tiktokResult.raw,
            },
          };
          continue;
        }

        if (ch === "pinterest") {
          const pinterestStatus = String(asRecord(pinterestRow).status || "");
          // Chaque publication Pinterest doit porter le tableau explicitement choisi pour cette action.
          const boardId = String(
            requestedPinterestBoardId ||
              configuredPinterestDefaultBoardId ||
              "",
          ).trim();
          const boardName = String(requestedPinterestBoardName || "").trim();
          const pinterestAccessToken =
            pinterestStatus === "connected" ||
            pinterestStatus === "account_connected"
              ? await getPinterestAccessToken(userId, req.url)
              : "";

          if (!pinterestAccessToken) {
            const pinterestWasConnected = pinterestStatus === "connected" || pinterestStatus === "account_connected";
            const pinterestUserError = pinterestWasConnected
              ? "Pinterest à reconnecter. Rendez-vous dans Canaux."
              : "Pinterest à connecter. Rendez-vous dans Canaux.";
            await markPublishChannelReconnectRequired({
              channel: "pinterest",
              userId,
              stage: "precheck",
              attemptStartedAt: publicationAttemptStartedAt,
              error: pinterestWasConnected ? "access_token_unavailable" : "not_connected",
              userMessage: pinterestUserError,
            });
            await setDelivery(ch, {
              status: "failed",
              error: pinterestUserError,
            });
            results[ch] = { ok: false, error: pinterestUserError };
            continue;
          }

          if (!boardId) {
            const pinterestUserError =
              "Choisissez un tableau Pinterest avant de publier.";
            await setDelivery(ch, {
              status: "failed",
              error: pinterestUserError,
            });
            results[ch] = { ok: false, error: pinterestUserError };
            continue;
          }

          const pinterestPost = sanitizeBoosterPostForStructuredCta(
            channelPost,
            {
              websiteUrl: siteWebUrl || inrcySiteUrl,
              phone: businessPhone,
            },
          );
          const pinterestContent = stripSiteTextFormattingPreserveLayout(
            pinterestPost.content || "",
          );
          if (pinterestContent.length > 500) {
            const pinterestUserError =
              "Le contenu Pinterest dépasse 500 caractères. Raccourcissez-le avant de publier pour conserver exactement votre mise en page.";
            await setDelivery(ch, {
              status: "failed",
              error: pinterestUserError,
            });
            results[ch] = { ok: false, error: pinterestUserError };
            continue;
          }

          const pinterestCta = buildCtaTextForChannel("pinterest", pinterestPost, {
            websiteUrl: siteWebUrl || inrcySiteUrl,
            phone: businessPhone,
          });
          const pinterestTagLine = buildBoosterHashtagLine(
            pinterestPost,
            [pinterestContent, pinterestCta].filter(Boolean).join("\n\n"),
            8,
          );
          let description = pinterestContent;
          for (const optionalPart of [pinterestCta, pinterestTagLine]) {
            if (!optionalPart) continue;
            const candidate = [description, optionalPart].filter(Boolean).join("\n\n");
            if (candidate.length <= 500) description = candidate;
          }
          const pinterestLink =
            normalizePublicHttpUrl(channelPost.ctaUrl) ||
            normalizePublicHttpUrl(siteWebUrl) ||
            normalizePublicHttpUrl(inrcySiteUrl);

          if (mediaModeByChannel[ch] === "video") {
            const pinterestVideoUrl = String(
              channelVideo?.publicUrl || channelVideo?.url || "",
            ).trim();
            if (
              !channelVideo ||
              (!pinterestVideoUrl &&
                !String(channelVideo.storagePath || "").trim())
            ) {
              const pinterestUserError =
                "Veuillez ajouter une vidéo valide pour publier sur Pinterest.";
              await setDelivery(ch, {
                status: "failed",
                error: pinterestUserError,
              });
              results[ch] = { ok: false, error: pinterestUserError };
              continue;
            }

            // The public/direct compatibility path remains synchronous. The
            // async worker uses the durable phase machine below so a Vercel
            // interruption never re-registers media or creates a second Pin.
            if (!internalAsyncDispatch || !asyncChannelEventId) {
              const pin = await createPinterestVideoPin({
                accessToken: pinterestAccessToken,
                userId,
                boardId,
                title: channelPost.title || post.title || "Publication iNrCy",
                description,
                videoUrl: pinterestVideoUrl,
                videoStoragePath: channelVideo.storagePath,
                videoContentType: channelVideo.type,
                videoFileName: channelVideo.name,
                coverImageUrl: channelVideo.thumbnailUrl,
                coverStoragePath: channelVideo.thumbnailStoragePath,
                coverBucket: channelVideo.thumbnailBucket,
                link: pinterestLink,
              });

              await setDelivery(ch, {
                status: "delivered",
                error: null,
              });
              results[ch] = {
                ok: true,
                external_id: pin.id || null,
                external_url: pin.url || null,
                board_id: boardId,
                board_name: boardName || null,
                media_type: "video",
                media_id: pin.media_id || null,
                media_status: pin.media_status || null,
                cover_image_url: pin.cover_image_url || null,
              };
              continue;
            }

            const pinterestVideoStoragePath = String(
              channelVideo.storagePath || "",
            ).trim();
            const pinterestVideoSize = Math.floor(
              Number(channelVideo.size || 0),
            );
            if (
              !pinterestVideoStoragePath ||
              !Number.isSafeInteger(pinterestVideoSize) ||
              pinterestVideoSize <= 0
            ) {
              const pinterestUserError =
                "La vidéo Pinterest n'a pas de source durable exploitable. Remplacez-la dans le bloc Médias.";
              await setDelivery(ch, {
                status: "failed",
                error: pinterestUserError,
              });
              results[ch] = {
                ok: false,
                error: pinterestUserError,
                code: "pinterest_video_source_not_durable",
                retryable: false,
              };
              continue;
            }

            const pinterestCoverImageUrl =
              await resolvePinterestVideoCoverImageUrl({
                coverImageUrl: channelVideo.thumbnailUrl,
                coverStoragePath: channelVideo.thumbnailStoragePath,
                coverBucket: channelVideo.thumbnailBucket,
              });
            if (!pinterestCoverImageUrl) {
              const pinterestUserError =
                "La vidéo Pinterest nécessite une image de couverture publique. Remplacez-la dans le bloc Médias.";
              await setDelivery(ch, {
                status: "failed",
                error: pinterestUserError,
              });
              results[ch] = {
                ok: false,
                error: pinterestUserError,
                code: "pinterest_video_cover_missing",
                retryable: false,
              };
              continue;
            }

            const pinterestVariant = asRecord(
              channelVideo.transformedVariant,
            );
            const pinterestVideoSettings = videoSettingsByChannel[ch];
            const pinterestVariantIdentity =
              String(pinterestVariant.signature || "").trim() ||
              [
                String(pinterestVideoSettings?.format || "original"),
                String(
                  pinterestVideoSettings?.adaptationMode || "source",
                ),
              ].join(":");
            // Signed URLs are deliberately excluded. The identity survives a
            // refreshed Supabase URL and distinguishes every adapted variant.
            const pinterestSourceFingerprint = [
              pinterestVideoStoragePath,
              pinterestVideoSize,
              pinterestVariantIdentity,
            ].join(":");
            const pinterestOperationId = `${publicationId}:${asyncChannelEventId}`;
            const hasRawPinterestCheckpoint =
              body._pinterestVideoCheckpoint !== null &&
              body._pinterestVideoCheckpoint !== undefined;
            const rawPinterestCheckpoint = hasRawPinterestCheckpoint
              ? body._pinterestVideoCheckpoint
              : undefined;
            const pinterestProtocolBase: PinterestVideoDurableProtocolArgs = {
              apiBaseUrl: getPinterestApiBaseUrl(),
              accessToken: pinterestAccessToken,
              operationId: pinterestOperationId,
              sourceFingerprint: pinterestSourceFingerprint,
              boardId,
              title: String(
                channelPost.title || post.title || "Publication iNrCy",
              )
                .trim()
                .slice(0, 100),
              description,
              link: pinterestLink,
              coverImageUrl: pinterestCoverImageUrl,
              videoSize: pinterestVideoSize,
              videoContentType: channelVideo.type || "video/mp4",
              videoFileName: channelVideo.name || "video-inrcy.mp4",
              checkpoint: rawPinterestCheckpoint,
              persistCheckpoint: persistPinterestVideoCheckpoint,
            };

            const pinterestPhaseDeadline = Date.now() + 35_000;
            let pinterestPhaseAdvances = 0;
            let pinterestStep = await advancePinterestVideoProtocol(
              pinterestProtocolBase,
            );

            for (;;) {
              if (pinterestStep.state === "needs_video_file") {
                if (pinterestPhaseAdvances >= 8) break;
                pinterestStep = await withPinterestVideoProtocolAsset(
                  {
                    userId,
                    videoUrl: pinterestVideoUrl,
                    videoStoragePath: pinterestVideoStoragePath,
                    videoContentType: channelVideo.type,
                    videoFileName: channelVideo.name,
                    coverImageUrl: pinterestCoverImageUrl,
                  },
                  async (asset) =>
                    await advancePinterestVideoProtocol({
                      ...pinterestProtocolBase,
                      checkpoint: pinterestStep.checkpoint,
                      videoFile: asset.videoFile,
                      videoSize: asset.videoSize,
                      videoContentType: asset.videoContentType,
                      videoFileName: asset.videoFileName,
                      coverImageUrl: asset.coverImageUrl,
                    }),
                );
                pinterestPhaseAdvances += 1;
                continue;
              }

              if (
                pinterestStep.state === "continue" &&
                pinterestPhaseAdvances < 8 &&
                Date.now() < pinterestPhaseDeadline
              ) {
                pinterestStep = await advancePinterestVideoProtocol({
                  ...pinterestProtocolBase,
                  checkpoint: pinterestStep.checkpoint,
                });
                pinterestPhaseAdvances += 1;
                continue;
              }

              if (
                pinterestStep.state === "waiting" &&
                pinterestPhaseAdvances < 8
              ) {
                const requestedRetryAt = Date.parse(
                  String(
                    pinterestStep.retryAt ||
                      pinterestStep.checkpoint.nextPollAt ||
                      "",
                  ),
                );
                const waitMs = Number.isFinite(requestedRetryAt)
                  ? Math.max(0, Math.min(5_000, requestedRetryAt - Date.now()))
                  : 1_200;
                const remainingMs = pinterestPhaseDeadline - Date.now();
                if (waitMs + 1_000 >= remainingMs) break;

                // Pinterest alone needs a provider-side readiness poll for
                // video. We keep sending the original file unchanged and use
                // the request's existing time budget before falling back to
                // the durable minute cron.
                if (waitMs > 0) {
                  await new Promise<void>((resolve) =>
                    setTimeout(resolve, waitMs),
                  );
                }
                pinterestStep = await advancePinterestVideoProtocol({
                  ...pinterestProtocolBase,
                  checkpoint: pinterestStep.checkpoint,
                  respectNextPollAt: false,
                });
                pinterestPhaseAdvances += 1;
                continue;
              }
              break;
            }

            if (
              pinterestStep.state === "continue" ||
              pinterestStep.state === "waiting"
            ) {
              return await queuePinterestVideoContinuation({
                step: pinterestStep,
              });
            }

            if (
              pinterestStep.state === "completed" &&
              pinterestStep.result
            ) {
              await persistPinterestVideoCheckpoint(
                pinterestStep.checkpoint,
                {
                  pinterestVideoContinuation: false,
                  pinterestVideoNextPollAt: null,
                },
              );
              const pin = asRecord(pinterestStep.result.pin);
              const pinId = String(
                pin.id ||
                  pin.pin_id ||
                  pinterestStep.checkpoint.pinId ||
                  "",
              ).trim();
              const pinUrl =
                normalizePublicHttpUrl(pin.url) ||
                normalizePublicHttpUrl(pin.link) ||
                (pinId
                  ? `https://www.pinterest.com/pin/${encodeURIComponent(pinId)}/`
                  : null);
              await setDelivery(ch, {
                status: "delivered",
                error: null,
              });
              results[ch] = {
                ok: true,
                external_id: pinId || null,
                external_url: pinUrl,
                board_id: String(pin.board_id || boardId),
                board_name: boardName || null,
                media_type: "video",
                media_id: pinterestStep.result.mediaId,
                media_status: pinterestStep.result.mediaStatus,
                cover_image_url: pinterestCoverImageUrl,
              };
              continue;
            }

            if (
              pinterestStep.state === "failed" ||
              pinterestStep.state === "expired" ||
              pinterestStep.state === "outcome_unknown"
            ) {
              await persistPinterestVideoCheckpoint(
                pinterestStep.checkpoint,
                {
                  pinterestVideoContinuation: false,
                  pinterestVideoNextPollAt: null,
                },
              );
              const outcomeUnknown =
                pinterestStep.state === "outcome_unknown";
              const protocolFailure = outcomeUnknown
                ? pinterestStep.checkpoint.outcomeUnknown
                : pinterestStep.checkpoint.failure;
              const pinterestUserError =
                protocolFailure?.message ||
                (outcomeUnknown
                  ? "Pinterest a peut-être reçu la publication. Vérifiez le canal avant toute nouvelle tentative."
                  : "Pinterest n'a pas pu finaliser la publication vidéo.");
              await setDelivery(ch, {
                status: "failed",
                error: pinterestUserError,
              });
              results[ch] = {
                ok: false,
                error: pinterestUserError,
                code: outcomeUnknown
                  ? "pinterest_video_outcome_unknown"
                  : protocolFailure?.code ||
                    `pinterest_video_${pinterestStep.state}`,
                retryable: false,
                ...(outcomeUnknown
                  ? {
                      outcome_unknown: true,
                      requestMayHaveSucceeded: true,
                    }
                  : {}),
                diagnostics: {
                  state: pinterestStep.state,
                  phase: pinterestStep.checkpoint.phase,
                  media_id: pinterestStep.checkpoint.mediaId || null,
                },
              };
              continue;
            }

            const pinterestUserError =
              "Pinterest n'a pas pu reprendre la préparation de cette vidéo.";
            await setDelivery(ch, {
              status: "failed",
              error: pinterestUserError,
            });
            results[ch] = {
              ok: false,
              error: pinterestUserError,
              code: "pinterest_video_invalid_durable_state",
              retryable: false,
            };
            continue;
          }

          if (mediaModeByChannel[ch] !== "images") {
            const pinterestUserError =
              "Pinterest nécessite une image ou une vidéo.";
            await setDelivery(ch, {
              status: "failed",
              error: pinterestUserError,
            });
            results[ch] = { ok: false, error: pinterestUserError };
            continue;
          }

          const pinterestImageUrls = pickCompleteChannelImageUrls({
            channel: ch,
            candidates: [
              "socialFeedPublishableUrls",
              "publishableUrls",
              "images",
            ],
            legacyFallback: externalImageUrls,
            limit: 5,
          });

          if (!pinterestImageUrls.length) {
            const pinterestUserError =
              "Veuillez ajouter au moins 1 image pour publier sur Pinterest.";
            await setDelivery(ch, {
              status: "failed",
              error: pinterestUserError,
            });
            results[ch] = { ok: false, error: pinterestUserError };
            continue;
          }

          const pin = await createPinterestImagePin({
            accessToken: pinterestAccessToken,
            userId,
            boardId,
            title: channelPost.title || post.title || "Publication iNrCy",
            description,
            imageUrls: pinterestImageUrls,
            link: pinterestLink,
          });

          await setDelivery(ch, {
            status: "delivered",
            error: null,
          });
          results[ch] = {
            ok: true,
            external_id: pin.id || null,
            external_url: pin.url || null,
            board_id: boardId,
            board_name: boardName || null,
            media_type: "image",
            image_count: pinterestImageUrls.length,
            images_harmonized: Boolean(pin.images_harmonized),
            image_preparation_message: pin.images_harmonized
              ? "Les images Pinterest ont été harmonisées automatiquement pour conserver un format identique."
              : null,
            target_width: pin.target_width || null,
            target_height: pin.target_height || null,
          };
          continue;
        }

        if (ch === "gmb") {
          const gmb = asRecord(gmbRow);
          const gmbState = liveChannelStates.gmb;
          const locationName = String(gmbState?.resource_id || "").trim();
          const accountName = String(gmbState?.account_name || "").trim();
          if (
            !isOfficialPublicationChannelConnected(gmbState) ||
            !locationName ||
            !accountName
          ) {
            const gmbUserError =
              "Google Business à connecter. Rendez-vous dans Canaux.";
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "gmb",
              userId,
              publicationId,
              stage: "precheck",
              error: "not_connected",
              userMessage: gmbUserError,
              diagnostics: {
                official_connected: Boolean(gmbState?.connected),
                connection_status: gmbState?.connection_status || null,
                requires_update: Boolean(gmbState?.requiresUpdate),
                raw_status: String(gmb["status"] || "") || null,
                has_location: Boolean(locationName),
                has_account: Boolean(accountName),
              },
            });
            await setDelivery(ch, { status: "failed", error: gmbUserError });
            results[ch] = { ok: false, error: gmbUserError };
            continue;
          }

          // The publication request already resolved the active iNrCy account.
          // Reuse that durable server identity instead of asking Supabase Auth to
          // authenticate the browser cookie a second time. Long-running video
          // publications and internal workers may no longer have that cookie
          // context even though the Google Business integration is still valid.
          const tok = await getGmbToken({
            supabase: supabaseAdmin,
            userId,
          });
          if (!tok?.accessToken) {
            const gmbUserError = GOOGLE_BUSINESS_RECONNECT_USER_MESSAGE;
            logPublishChannelFailure({
              route: "booster_publish_now",
              channel: "gmb",
              userId,
              publicationId,
              stage: "token",
              error: "missing_or_expired_token",
              userMessage: gmbUserError,
            });
            await markPublishChannelReconnectRequired({
              channel: "gmb",
              userId,
              stage: "token",
              attemptStartedAt: publicationAttemptStartedAt,
              error: "missing_or_expired_token",
              userMessage: gmbUserError,
            });
            await setDelivery(ch, { status: "failed", error: gmbUserError });
            results[ch] = { ok: false, error: gmbUserError };
            continue;
          }

          let gmbWarning: { code: string; message: string } | null = null;

          const rawGmbChannelImages =
            mediaModeByChannel[ch] === "images"
              ? pickCompleteChannelImageUrls({
                  channel: ch,
                  candidates: [
                    "gmbPublishableUrls",
                    "publishableUrls",
                    "images",
                  ],
                  legacyFallback: gmbImageUrls,
                  limit: 5,
                })
              : [];
          const probedGmbImages = rawGmbChannelImages.length
            ? await filterGoogleBusinessMediaUrls({
                urls: rawGmbChannelImages,
                kind: "image",
              })
            : { acceptedUrls: [] as string[] };
          const gmbChannelImages = probedGmbImages.acceptedUrls.slice(0, 5);
          if (
            mediaModeByChannel[ch] === "images" &&
            getExpectedChannelImageCount(ch) > 0 &&
            gmbChannelImages.length < rawGmbChannelImages.length
          ) {
            gmbWarning = {
              code: gmbChannelImages.length
                ? "published_with_partial_images"
                : "published_without_image",
              message: gmbChannelImages.length
                ? "Google Business a publié uniquement les images accessibles et conformes. Les autres médias ont été écartés avant l’envoi."
                : "Google Business publiera le texte sans image, car aucune image n’était encore accessible ou conforme au moment de l’envoi.",
            };
          }
          if (
            mediaModeByChannel[ch] === "images" &&
            getExpectedChannelImageCount(ch) > 0 &&
            !gmbChannelImages.length &&
            !gmbWarning
          ) {
            gmbWarning = {
              code: "published_without_image",
              message:
                "Google Business publiera le texte sans image, car le média n’a pas pu être préparé de façon conforme.",
            };
          }

          const rawGmbChannelVideos =
            mediaModeByChannel[ch] === "video" &&
            channelVideo
              ? [channelVideo.publicUrl].filter(Boolean).slice(0, 1)
              : [];
          const probedGmbVideos = rawGmbChannelVideos.length
            ? await filterGoogleBusinessMediaUrls({
                urls: rawGmbChannelVideos,
                kind: "video",
              })
            : { acceptedUrls: [] as string[] };
          const gmbChannelVideos = probedGmbVideos.acceptedUrls.slice(0, 1);
          if (
            mediaModeByChannel[ch] === "video" &&
            rawGmbChannelVideos.length > 0 &&
            !gmbChannelVideos.length
          ) {
            const gmbVideoError =
              "Google Business n’a pas reçu la vidéo : l’URL ou le fichier préparé n’était plus accessible ou conforme au moment de l’envoi.";
            await setDelivery(ch, { status: "failed", error: gmbVideoError });
            results[ch] = {
              ok: false,
              code: "video_conversion_or_probe_failed",
              retryable: true,
              error: gmbVideoError,
            };
            continue;
          }
          if (
            mediaModeByChannel[ch] === "video" &&
            !gmbChannelVideos.length &&
            !gmbWarning
          ) {
            const gmbVideoError =
              "La variante vidéo Google Business n’était pas disponible. La publication texte n’a pas été envoyée à la place.";
            await setDelivery(ch, { status: "failed", error: gmbVideoError });
            results[ch] = {
              ok: false,
              code: "video_variant_required",
              retryable: true,
              error: gmbVideoError,
            };
            continue;
          }

          const gmbSummary = buildBoosterGmbSummary(channelPost, {
            websiteUrl: siteWebUrl || inrcySiteUrl,
            phone: businessPhone,
          });
          const gmbCallToAction = getBoosterGmbCallToAction(channelPost, {
            websiteUrl: siteWebUrl || inrcySiteUrl,
            phone: businessPhone,
          });
          let gmbResp: any;

          try {
            gmbResp = await gmbCreateLocalPost({
              accessToken: tok.accessToken,
              accountName,
              locationName,
              summary: gmbSummary,
              imageUrls: gmbChannelImages.length ? gmbChannelImages : undefined,
              videoUrls: gmbChannelVideos.length ? gmbChannelVideos : undefined,
              languageCode: "fr-FR",
              callToAction: gmbCallToAction || undefined,
            });
          } catch (gmbErr: unknown) {
            // A timed-out POST may already have created the remote post. A
            // degraded retry would therefore risk publishing it twice.
            if (isGoogleBusinessPostOutcomeUnknown(gmbErr)) {
              throw gmbErr;
            }
            const hasMedia = Boolean(
              gmbChannelImages.length || gmbChannelVideos.length,
            );
            const retryWithoutMedia = async () =>
              gmbCreateLocalPost({
                accessToken: tok.accessToken,
                accountName,
                locationName,
                summary: gmbSummary,
                languageCode: "fr-FR",
                callToAction: gmbCallToAction || undefined,
              });
            const retryWithoutCta = async () =>
              gmbCreateLocalPost({
                accessToken: tok.accessToken,
                accountName,
                locationName,
                summary: gmbSummary,
                imageUrls: gmbChannelImages.length
                  ? gmbChannelImages
                  : undefined,
                videoUrls: gmbChannelVideos.length
                  ? gmbChannelVideos
                  : undefined,
                languageCode: "fr-FR",
              });
            try {
              if (!hasMedia) throw gmbErr;
              if (mediaModeByChannel[ch] === "video") throw gmbErr;
              gmbResp = await retryWithoutMedia();
              gmbWarning = {
                code: isGoogleBusinessImageError(gmbErr)
                  ? "published_without_image"
                  : "published_after_retry_without_image",
                message: isGoogleBusinessImageError(gmbErr)
                  ? "Google Business a publié le texte, mais n'a pas pu récupérer l'image. Vérifiez que l'image reste publique et accessible sans connexion."
                  : "Google Business a publié le texte après une reprise automatique. L'image n'a pas pu être jointe cette fois-ci.",
              };
            } catch (retryError: unknown) {
              if (isGoogleBusinessPostOutcomeUnknown(retryError)) {
                throw retryError;
              }
              if (gmbCallToAction) {
                try {
                  gmbResp = await retryWithoutCta();
                  gmbWarning = {
                    code: "published_without_cta",
                    message:
                      "Google Business a publié le texte sans bouton CTA.",
                  };
                } catch (ctaError: unknown) {
                  if (isGoogleBusinessPostOutcomeUnknown(ctaError)) {
                    throw ctaError;
                  }
                  throw retryError;
                }
              } else {
                throw retryError;
              }
            }
          }

          const gmbRespRec = asRecord(gmbResp);
          const externalId = String(gmbRespRec["name"] ?? "");
          await setDelivery(ch, {
            status: "delivered",
            error: null,
          });
          results[ch] = {
            ok: true,
            external_id: externalId || null,
            ...(gmbWarning
              ? {
                  warning: gmbWarning.code,
                  warning_message: gmbWarning.message,
                }
              : {}),
          };
          continue;
        }

        const unsupportedChannelMessage =
          "Ce canal de publication n'est pas pris en charge.";
        await setDelivery(ch, {
          status: "failed",
          error: unsupportedChannelMessage,
        });
        results[ch] = {
          ok: false,
          error: unsupportedChannelMessage,
          code: "unsupported_channel",
          retryable: false,
        };
      } catch (e: unknown) {
        const exceptionRecord = asRecord(e);
        const exceptionCode = String(exceptionRecord.code || "").trim();
        const exceptionRetryable = exceptionRecord.retryable;
        const outcomeUnknown = isGoogleBusinessPostOutcomeUnknown(e);
        const msg = getPublishChannelUserMessage(
          ch,
          e,
          "L'action n'a pas pu être finalisée.",
        );
        logPublishChannelFailure({
          route: "booster_publish_now",
          channel: ch,
          userId,
          publicationId,
          stage: "exception",
          error: e,
          userMessage: msg,
        });
        await markPublishChannelReconnectRequired({
          channel: ch,
          userId,
          stage: "exception",
          attemptStartedAt: publicationAttemptStartedAt,
          error: e,
          userMessage: msg,
        });
        await setDelivery(ch, { status: "failed", error: msg });
        results[ch] = {
          ok: false,
          error: msg,
          raw_error: e instanceof Error ? e.message : String(e || ""),
          ...(exceptionCode ? { code: exceptionCode } : {}),
          ...(typeof exceptionRetryable === "boolean"
            ? { retryable: exceptionRetryable }
            : {}),
          ...(outcomeUnknown
            ? { outcome_unknown: true, retryable: false }
            : {}),
        };
      }
    }

    if (internalAsyncDispatch) {
      const channel = selected[0];
      const channelResult = Object.keys(asRecord(results[channel])).length
        ? asRecord(results[channel])
        : {
            ok: false,
            error: "Le canal n'a retourné aucun résultat exploitable.",
            code: "missing_channel_result",
          };
      const channelSucceeded = channelResult.ok !== false;
      if (!channelSucceeded) {
        await supabaseAdmin
          .from("publication_deliveries")
          .update({
            status: "failed",
            error: String(channelResult.error || "Échec de publication."),
          })
          .eq("publication_id", publicationId)
          .eq("user_id", userId)
          .eq("channel", channel);
      }

      await updateAsyncChannelEvent({
        userId,
        eventId: asyncChannelEventId,
        patch: {
          status: channelSucceeded ? "completed" : "failed",
          result: channelResult,
          completedAt: new Date().toISOString(),
        },
      });
      await completeExecutionIdempotencyLock({
        supabase: supabaseAdmin,
        lockId: asyncChannelLockId,
        result: {
          ok: channelSucceeded,
          publication_id: publicationId,
          channel,
          result: channelResult,
          asyncDispatch: true,
        },
        metadata: { publicationId, channel, asyncDispatch: true },
      });

      if (channel === "inr_search" && channelSucceeded) {
        const provisioned = await ensureSystemManagedInrSearch(
          supabaseAdmin as any,
          userId,
        );
        const slug = String(
          provisioned.inrSearch?.publishedSlug ||
            provisioned.inrSearch?.slug ||
            "",
        );
        revalidateInrSearchPublicRoutes(slug);
        await notifyInrSearchIndexing(slug);
      }

      const finalization = await finalizeAsyncPublicationIfReady({
        userId,
        publicationId,
      });
      asyncFailureContext = null;
      const summary = buildResultsSummary(
        { [channel]: channelResult },
        [channel],
      );
      return NextResponse.json({
        ok: channelSucceeded,
        queued: false,
        asyncDispatch: true,
        publication_id: publicationId,
        channel,
        results: { [channel]: channelResult },
        summary,
        finalized: finalization.finalized === true,
      });
    }

    const persistedVideo =
      hasAnyVideoChannel && publicationVideo ? publicationVideo : null;
    const videoByChannel = publicationVideoByChannel;

    const persistedPostByChannel = Object.fromEntries(
      selected.map((channel) => {
        const rawBaseValue = (postByChannel as Record<string, unknown>)[
          channel
        ] as Record<string, unknown> | undefined;
        const baseValue = {
          ...(rawBaseValue || {}),
          ...getChannelPost(channel),
        };
        const channelPersistedVideo =
          mediaModeByChannel[channel] === "video"
            ? getPublicationVideoForChannel(channel)
            : null;
        const originalVideo =
          persistedVideo ||
          channelPersistedVideo?.sourceVideo ||
          channelPersistedVideo;

        if (mediaModeByChannel[channel] === "video" && originalVideo) {
          return [
            channel,
            {
              ...(baseValue || {}),
              images: [],
              attachments: [originalVideo],
              video: originalVideo,
              sourceVideo: originalVideo,
              mediaMode: "video",
              videoSettings: videoSettingsByChannel[channel] || null,
              videoFormat: videoSettingsByChannel[channel]?.format || null,
              videoAdaptationMode:
                videoSettingsByChannel[channel]?.adaptationMode || null,
            },
          ];
        }

        if (mediaModeByChannel[channel] === "none") {
          return [
            channel,
            {
              ...(baseValue || {}),
              images: [],
              attachments: [],
              mediaMode: "none",
              videoSettings: videoSettingsByChannel[channel] || null,
            },
          ];
        }

        const imageSet = channelImageSets[channel];
        const originalImages = getOriginalImagesForChannel(channel);
        return [
          channel,
          imageSet
            ? {
                ...(baseValue || {}),
                images: originalImages.map((attachment) => attachment.url),
                attachments: originalImages,
                publishableUrls: imageSet.publishableUrls,
                instagramPublishableUrls: imageSet.instagramPublishableUrls,
                socialFeedPublishableUrls: imageSet.socialFeedPublishableUrls,
                siteCardPublishableUrls: imageSet.siteCardPublishableUrls,
                gmbPublishableUrls: imageSet.gmbPublishableUrls,
                storagePaths: imageSet.storagePaths,
                publishableStoragePaths: imageSet.publishableStoragePaths,
                socialFeedStoragePaths: imageSet.socialFeedStoragePaths,
                mediaMode: "images",
                videoSettings: videoSettingsByChannel[channel] || null,
              }
            : {
                ...(baseValue || {}),
                mediaMode: "images",
                videoSettings: videoSettingsByChannel[channel] || null,
              },
        ];
      }),
    );

    const summary = buildResultsSummary(results, selected);

    // Sécurité compteur/stats : on ne valide l'action Booster que si au moins un canal a réellement publié.
    // Ainsi, les compteurs, missions et UI ne montent pas quand tous les canaux échouent.
    if (summary.successCount <= 0) {
      await syncMediaWorkspaceLifecycle("failed", {
        publicationId,
        failureStage: "publish_results",
        summary,
      });
      await failExecutionIdempotencyLock({
        supabase: supabaseAdmin,
        lockId: publishIdempotencyLockId,
        error: "Aucun canal publié avec succès.",
        result: { publicationId, summary },
        metadata: { stage: "publish_results" },
      });
      shouldFailPublishIdempotencyLockOnError = false;
      return NextResponse.json(
        {
          ok: false,
          error:
            "Aucun canal n'a pu publier. Les compteurs et les UI n'ont pas été mis à jour.",
          publication_id: publicationId,
          mediaType,
          mediaModeByChannel,
          videoSettingsByChannel,
          video: persistedVideo,
          videoByChannel,
          images: uploadedUrls,
          publishableUrls,
          instagramPublishableUrls,
          socialFeedPublishableUrls,
          siteCardPublishableUrls,
          gmbPublishableUrls,
          uploadErrors,
          results,
          summary,
          historyEventId: null,
          historyPersisted: false,
        },
        { status: 200 },
      );
    }

    // 5) Log publication / valorisation event uniquement après succès réel.
    // Historique iNrSend uniquement après un succès réel.
    // Une publication canal ne doit jamais être relancée parce que son journal a
    // rencontré un incident transitoire : on réessaie seulement l'écriture du log,
    // avec le même identifiant, puis le filet de réconciliation iNrAgent prend le relais.
    const historyEventId = randomUUID();
    const historyEventRow = {
      id: historyEventId,
      user_id: userId,
      module: eventModule,
      type: eventType,
      payload: {
        workflowTool: eventModule,
        workflowAction,
        ...(origin ? { origin, source: origin.source } : {}),
        mediaType,
        mediaModeByChannel,
        videoSettingsByChannel,
        video: persistedVideo,
        videoByChannel,
        attachments: persistedVideo
          ? [persistedVideo]
          : originalPublicationImageAttachments,
        idea,
        channels: summary.successChannels,
        attemptedChannels: selected,
        post: firstPost,
        postByChannel: persistedPostByChannel,
        imageSettingsByChannel,
        images: uploadedUrls,
        publishableUrls,
        instagramPublishableUrls,
        socialFeedPublishableUrls,
        siteCardPublishableUrls,
        gmbPublishableUrls,
        uploadErrors,
        publication_id: publicationId,
        mediaWorkspaceId: mediaWorkspaceId || null,
        mediaWorkspaceRevision: workspaceConsumption?.workspaceRevision || null,
        mediaWorkspaceConsumptionSource:
          strictMediaCutover ? "workspace_cutover_v1" : workspaceConsumption?.source || "legacy_fallback",
        idempotencyKey: publishIdempotencyKey || null,
        idempotencyLockId: publishIdempotencyLockId || null,
        results,
        summary,
      },
    };

    let historyPersisted = false;
    let historyPersistenceError: string | null = null;
    const { error: historyInsertError } = await supabaseAdmin
      .from("app_events")
      .insert(historyEventRow);

    if (!historyInsertError) {
      historyPersisted = true;
    } else {
      const { error: historyRetryError } = await supabaseAdmin
        .from("app_events")
        .upsert(historyEventRow, { onConflict: "id" });
      historyPersisted = !historyRetryError;
      historyPersistenceError = historyRetryError?.message || historyInsertError.message;
    }

    if (!historyPersisted) {
      console.error("[booster-publish] iNrSend history persistence failed", {
        userId,
        publicationId,
        historyEventId,
        originSource: origin?.source || null,
        error: historyPersistenceError,
      });
    }

    if (summary.successChannels.includes("inr_search")) {
      const provisioned = await ensureSystemManagedInrSearch(supabaseAdmin as any, userId);
      const slug = String(provisioned.inrSearch?.publishedSlug || provisioned.inrSearch?.slug || "");
      revalidateInrSearchPublicRoutes(slug);
      await notifyInrSearchIndexing(slug);
    }

    const responsePayload = {
      ok: true,
      publication_id: publicationId,
      mediaType,
      mediaModeByChannel,
      videoSettingsByChannel,
      video: persistedVideo,
      videoByChannel,
      images: uploadedUrls,
      publishableUrls,
      instagramPublishableUrls,
      socialFeedPublishableUrls,
      gmbPublishableUrls,
      uploadErrors,
      results,
      summary,
      historyEventId,
      historyPersisted,
      idempotencyKey: publishIdempotencyKey || null,
      mediaWorkspaceId: mediaWorkspaceId || null,
      mediaWorkspaceRevision: workspaceConsumption?.workspaceRevision || null,
      mediaWorkspaceConsumptionSource:
        strictMediaCutover ? "workspace_cutover_v1" : workspaceConsumption?.source || "legacy_fallback",
    };

    await syncMediaWorkspaceLifecycle("published", {
      publicationId,
      successfulChannels: summary.successChannels,
      summary,
    });

    await completeExecutionIdempotencyLock({
      supabase: supabaseAdmin,
      lockId: publishIdempotencyLockId,
      result: responsePayload,
      metadata: { publicationId, summary },
    });
    shouldFailPublishIdempotencyLockOnError = false;

    return NextResponse.json(responsePayload);
  } catch (e: unknown) {
    if (asyncPreparationFailureContext) {
      const message = getSimpleFrenchErrorMessage(
        e,
        "La préparation des médias n'a pas pu être finalisée.",
      );
      await updateAsyncPublicationJobEvent({
        userId: asyncPreparationFailureContext.userId,
        publicationId: asyncPreparationFailureContext.publicationId,
        patch: {
          status: "queued",
          stage: "media_preparation",
          lastPreparationError: message,
          lastPreparationFailedAt: new Date().toISOString(),
        },
      }).catch(() => undefined);
      await failAsyncPublicationPreparationLease({
        lockId: asyncPreparationFailureContext.preparationLockId,
        publicationId: asyncPreparationFailureContext.publicationId,
        error: message,
      }).catch(() => undefined);
      captureApiException(req, e, {
        area: "booster",
        operation: "POST /api/booster/publish-now preparation worker",
        statusCode: 503,
      });
      return NextResponse.json(
        {
          ok: false,
          done: false,
          queued: true,
          asyncDispatch: true,
          retryable: true,
          code: "async_preparation_failed",
          error: message,
          publication_id: asyncPreparationFailureContext.publicationId,
        },
        { status: 503 },
      );
    }

    if (asyncFailureContext) {
      const message = getSimpleFrenchErrorMessage(
        e,
        "La publication n'a pas pu être finalisée sur ce canal.",
      );
      const failedResult = {
        ok: false,
        error: message,
        raw_error: e instanceof Error ? e.message : String(e || ""),
        code: "async_channel_unhandled_exception",
      };
      await supabaseAdmin
        .from("publication_deliveries")
        .update({ status: "failed", error: message })
        .eq("publication_id", asyncFailureContext.publicationId)
        .eq("user_id", asyncFailureContext.userId)
        .eq("channel", asyncFailureContext.channel)
        .then(() => undefined);
      await updateAsyncChannelEvent({
        userId: asyncFailureContext.userId,
        eventId: asyncFailureContext.channelEventId,
        patch: {
          status: "failed",
          result: failedResult,
          completedAt: new Date().toISOString(),
        },
      }).catch(() => undefined);
      await completeExecutionIdempotencyLock({
        supabase: supabaseAdmin,
        lockId: asyncFailureContext.channelLockId,
        result: {
          ok: false,
          publication_id: asyncFailureContext.publicationId,
          channel: asyncFailureContext.channel,
          result: failedResult,
          asyncDispatch: true,
        },
        metadata: {
          publicationId: asyncFailureContext.publicationId,
          channel: asyncFailureContext.channel,
          asyncDispatch: true,
        },
      });
      await finalizeAsyncPublicationIfReady({
        userId: asyncFailureContext.userId,
        publicationId: asyncFailureContext.publicationId,
      }).catch(() => undefined);
      return NextResponse.json({
        ok: false,
        queued: false,
        asyncDispatch: true,
        publication_id: asyncFailureContext.publicationId,
        channel: asyncFailureContext.channel,
        results: { [asyncFailureContext.channel]: failedResult },
      });
    }

    if (lifecycleWorkspaceId && lifecycleUserId) {
      await syncPublicationWorkspaceContext({
        accountId: lifecycleUserId,
        workspaceId: lifecycleWorkspaceId,
        operation: "publish",
        status: "failed",
        metadata: {
          failureStage: "unhandled_exception",
          failureMessage: e instanceof Error ? e.message : String(e || "Erreur inconnue"),
        },
      }).catch(() => undefined);
    }
    if (
      shouldFailPublishIdempotencyLockOnError &&
      publishIdempotencyLockId
    ) {
      const failureMessage = getSimpleFrenchErrorMessage(
        e,
        "L'action n'a pas pu être finalisée.",
      );
      await failExecutionIdempotencyLock({
        supabase: supabaseAdmin,
        lockId: publishIdempotencyLockId,
        error: failureMessage,
        result: {
          ok: false,
          code: "publish_now_failed",
        },
        metadata: { stage: "unhandled_exception" },
      }).catch(() => undefined);
      shouldFailPublishIdempotencyLockOnError = false;
    }
    captureApiException(req, e, {
      area: "booster",
      operation: "POST /api/booster/publish-now",
      statusCode: 500,
    });
    return jsonUserFacingError(e, {
      status: 500,
      fallback: "L'action n'a pas pu être finalisée.",
      code: "publish_now_failed",
    });
  }
}

export const POST = withApi(publishNowHandler, { route: "/api/booster/publish-now" });
