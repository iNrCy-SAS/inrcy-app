import { NextResponse } from "next/server";

import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import {
  BOOSTER_ASYNC_CHANNEL_EVENT_TYPE,
  BOOSTER_ASYNC_JOB_EVENT_TYPE,
  buildAsyncPublicationAggregate,
  finalizeAsyncPublicationIfReady,
  updateAsyncChannelEvent,
  type BoosterAsyncChannelKey,
} from "@/lib/boosterAsyncPublication";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { refreshTiktokAccessToken } from "@/lib/tiktokOAuth";
import { fetchTiktokPublishStatus, getTiktokUserFacingError } from "@/lib/tiktokPublish";
import {
  hasMeaningfulTiktokResultChange,
  shouldUpdateTiktokDelivery,
} from "@/lib/tiktokStatusPersistence";
import { asRecord, asString } from "@/lib/tsSafe";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

type AppEventRow = {
  id: string | number;
  type?: string | null;
  payload?: unknown;
};

type TiktokEventContext = {
  parent: AppEventRow | null;
  channelEvent: AppEventRow | null;
  parentPayload: JsonRecord;
  channelPayload: JsonRecord;
  result: JsonRecord;
  async: boolean;
};

type TiktokDeliveryState = {
  status: string;
  error: string | null;
} | null;

const TIKTOK_LOCAL_CANCEL_MESSAGE =
  "Publication annulée dans iNrSend. Le suivi automatique est arrêté. Une tentative déjà acceptée par TikTok ne peut pas être interrompue à distance.";

function isTiktokCancelledResult(resultLike: unknown) {
  const result = asRecord(resultLike);
  const status = String(result.tiktok_status || result.status || "").toUpperCase();
  return result.cancelled === true || status === "CANCELLED" || status === "CANCELED";
}

function buildCancelledEventState(payloadLike: unknown) {
  const payload = asRecord(payloadLike);
  const results = asRecord(payload.results);
  const current = asRecord(results.tiktok);
  const diagnostics = asRecord(current.diagnostics);
  const message = isTiktokCancelledResult(current)
    ? String(current.tiktok_status_message || TIKTOK_LOCAL_CANCEL_MESSAGE)
    : TIKTOK_LOCAL_CANCEL_MESSAGE;
  const cancelledAt = String(
    current.tiktok_cancelled_at ||
      current.cancelled_at ||
      diagnostics.cancelled_at ||
      new Date().toISOString(),
  );
  const nextResult: JsonRecord = {
    ...current,
    status: "cancelled",
    cancelled: true,
    cancelled_at: cancelledAt,
    error: null,
    warning: false,
    warning_message: null,
    tiktok_status: "CANCELLED",
    tiktok_status_label: "Annulé",
    tiktok_status_message: message,
    tiktok_cancelled_at: cancelledAt,
    tiktok_status_fetch_failed: false,
    tiktok_stalled: false,
    diagnostics: {
      ...diagnostics,
      cancelled: true,
      cancelled_at: cancelledAt,
    },
  };
  const nextPayload: JsonRecord = {
    ...payload,
    results: {
      ...results,
      tiktok: nextResult,
    },
  };
  return { nextPayload, nextResult };
}

async function getTiktokDeliveryState(
  userId: string,
  publicationId: string,
): Promise<TiktokDeliveryState> {
  const { data, error } = await supabaseAdmin
    .from("publication_deliveries")
    .select("status,error")
    .eq("user_id", userId)
    .eq("publication_id", publicationId)
    .eq("channel", "tiktok")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    status: String(data.status || "").toLowerCase(),
    error: data.error == null ? null : String(data.error),
  };
}

async function ensureCancelledEventState({
  userId,
  event,
}: {
  userId: string;
  event: AppEventRow | null;
}) {
  const state = buildCancelledEventState(event?.payload);
  const currentResult = asRecord(asRecord(asRecord(event?.payload).results).tiktok);
  if (
    event?.id &&
    hasMeaningfulTiktokResultChange(currentResult, state.nextResult)
  ) {
    const { error } = await supabaseAdmin
      .from("app_events")
      .update({ payload: state.nextPayload })
      .eq("id", event.id)
      .eq("user_id", userId);
    if (error) throw error;
  }
  return {
    ...state,
    message: String(state.nextResult.tiktok_status_message || TIKTOK_LOCAL_CANCEL_MESSAGE),
    stalled: false,
    cancelled: true,
  };
}

function isExpired(expiresAt: unknown, skewSeconds = 120) {
  const raw = asString(expiresAt) || "";
  if (!raw) return false;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp <= Date.now() + skewSeconds * 1000;
}

async function getLatestTiktokIntegration(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("status,resource_id,resource_label,display_name,access_token_enc,refresh_token_enc,scopes,meta,expires_at")
    .eq("user_id", userId)
    .eq("provider", "tiktok")
    .eq("source", "tiktok")
    .eq("product", "tiktok")
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : null;
}

async function getTiktokAccessToken(userId: string, rowLike: unknown) {
  const row = asRecord(rowLike);
  let accessToken = tryDecryptToken(String(row.access_token_enc || "")) || "";
  const refreshToken = tryDecryptToken(String(row.refresh_token_enc || "")) || "";

  if (accessToken && !isExpired(row.expires_at, 120)) return accessToken;
  if (!refreshToken) return accessToken;

  const refreshed = await refreshTiktokAccessToken(refreshToken);
  const nextAccessToken = (asString(refreshed.access_token) || "").trim();
  const nextRefreshToken = (asString(refreshed.refresh_token) || "").trim() || refreshToken;
  const expiresIn = Number(refreshed.expires_in || 0);
  const refreshExpiresIn = Number(refreshed.refresh_expires_in || 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;
  const nextMeta = {
    ...asRecord(row.meta),
    refresh_expires_at: Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
      ? new Date(Date.now() + refreshExpiresIn * 1000).toISOString()
      : asRecord(row.meta).refresh_expires_at || null,
    tiktok_token_refreshed_at: new Date().toISOString(),
  };

  if (nextAccessToken) {
    await supabaseAdmin
      .from("integrations")
      .update({
        access_token_enc: encryptToken(nextAccessToken),
        refresh_token_enc: nextRefreshToken ? encryptToken(nextRefreshToken) : row.refresh_token_enc || null,
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

function tiktokStatusLabel(
  status: string | null | undefined,
  statusFetchFailed = false,
  stalled = false,
) {
  if (statusFetchFailed) return "Vérification impossible";
  if (stalled) return "Traitement prolongé";
  const value = String(status || "").toUpperCase();
  if (value === "PUBLISH_COMPLETE" || value === "DONE" || value === "SUCCESS") return "Publié";
  if (value === "FAILED" || value === "PUBLISH_FAILED" || value === "ERROR") return "Échec";
  if (value === "PROCESSING_UPLOAD") return "Upload TikTok en cours";
  if (value === "PROCESSING_DOWNLOAD") return "Téléchargement TikTok en cours";
  if (value.includes("PROCESS")) return "En traitement";
  return value || "En traitement";
}

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${Math.round(bytes)} octets`;
}

function tiktokStatusMessage(
  status: Awaited<ReturnType<typeof fetchTiktokPublishStatus>>,
  stalled = false,
) {
  if (status.statusFetchFailed) {
    return getTiktokUserFacingError(status.failReason || status.providerErrorCode || "tiktok_status_fetch_failed");
  }
  if (status.failed) {
    return getTiktokUserFacingError(status.failReason || status.status || "tiktok_publish_failed");
  }
  if (status.complete) {
    return "TikTok confirme que la publication est terminée. Si la visibilité est privée, elle peut apparaître uniquement sur le compte connecté.";
  }
  if (stalled) {
    return "TikTok conserve la publication en traitement sans progression récente. iNrSend continue le suivi ; vérifiez le compte avant toute relance pour éviter un doublon.";
  }
  const uploaded = formatBytes(status.uploadedBytes);
  if (String(status.status || "").toUpperCase() === "PROCESSING_UPLOAD" && uploaded) {
    return `TikTok a reçu ${uploaded} et traite encore la vidéo. iNrSend vérifiera automatiquement la suite.`;
  }
  return "TikTok traite encore la publication. iNrSend vérifiera automatiquement son résultat.";
}

function dateMs(value: unknown) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

const BOOSTER_PUBLICATION_CHANNELS = new Set<BoosterAsyncChannelKey>([
  "site_web",
  "inrcy_site",
  "inr_search",
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "youtube_shorts",
  "pinterest",
  "gmb",
]);

function publicationChannels(
  payload: JsonRecord,
  results: JsonRecord,
): BoosterAsyncChannelKey[] {
  const values = [
    ...(Array.isArray(payload.attemptedChannels)
      ? payload.attemptedChannels
      : []),
    ...(Array.isArray(payload.channels) ? payload.channels : []),
    ...Object.keys(results),
  ];
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  ).filter((channel): channel is BoosterAsyncChannelKey =>
    BOOSTER_PUBLICATION_CHANNELS.has(channel as BoosterAsyncChannelKey),
  );
}

async function loadTiktokEventContext(
  userId: string,
  publicationId: string,
): Promise<TiktokEventContext> {
  const { data: exactParent, error: exactParentError } = await supabaseAdmin
    .from("app_events")
    .select("id,type,payload")
    .eq("id", publicationId)
    .eq("user_id", userId)
    .eq("module", "booster")
    .in("type", ["publish", BOOSTER_ASYNC_JOB_EVENT_TYPE])
    .maybeSingle();

  if (exactParentError) throw exactParentError;

  let parent = (exactParent || null) as AppEventRow | null;
  if (!parent) {
    // Compatibilite avec les publications synchrones historiques, dont l'id
    // d'app_event etait distinct de publication_id. Le chemin durable courant
    // est toujours resolu par sa cle primaire ci-dessus.
    const { data: legacyParents, error: legacyParentError } = await supabaseAdmin
      .from("app_events")
      .select("id,type,payload")
      .eq("user_id", userId)
      .eq("module", "booster")
      .eq("type", "publish")
      .eq("payload->>publication_id", publicationId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (legacyParentError) throw legacyParentError;
    parent = ((legacyParents || []) as AppEventRow[])[0] || null;
  }

  const parentPayload = asRecord(parent?.payload);
  const isAsync = String(parent?.type || "") === BOOSTER_ASYNC_JOB_EVENT_TYPE;
  if (!parent || !isAsync) {
    return {
      parent,
      channelEvent: null,
      parentPayload,
      channelPayload: {},
      result: asRecord(asRecord(parentPayload.results).tiktok),
      async: false,
    };
  }

  const channelEventId = String(
    asRecord(parentPayload.channelEventIds).tiktok || "",
  ).trim();
  if (!channelEventId) {
    return {
      parent,
      channelEvent: null,
      parentPayload,
      channelPayload: {},
      result: {},
      async: true,
    };
  }

  const { data: channelEvent, error: channelEventError } = await supabaseAdmin
    .from("app_events")
    .select("id,type,payload")
    .eq("id", channelEventId)
    .eq("user_id", userId)
    .eq("module", "booster")
    .eq("type", BOOSTER_ASYNC_CHANNEL_EVENT_TYPE)
    .maybeSingle();

  if (channelEventError) throw channelEventError;
  const typedChannelEvent = (channelEvent || null) as AppEventRow | null;
  const channelPayload = asRecord(typedChannelEvent?.payload);
  return {
    parent,
    channelEvent: typedChannelEvent,
    parentPayload,
    channelPayload,
    result: asRecord(channelPayload.result),
    async: true,
  };
}

async function persistTerminalParentTiktokResult(params: {
  userId: string;
  context: TiktokEventContext;
  nextResult: JsonRecord;
  terminal: boolean;
}) {
  const results = {
    ...asRecord(params.context.parentPayload.results),
    tiktok: params.nextResult,
  };
  const selectedChannels = publicationChannels(
    params.context.parentPayload,
    results,
  );
  const aggregate = buildAsyncPublicationAggregate(results, selectedChannels);
  const nowIso = new Date().toISOString();
  const nextPayload = {
    ...params.context.parentPayload,
    attemptedChannels: selectedChannels,
    channels: aggregate.summary.successChannels,
    results,
    summary: aggregate.summary,
    status: aggregate.status,
    outcome: aggregate.outcome,
    updatedAt: nowIso,
    ...(params.terminal
      ? { completedAt: nowIso, externalCompletedAt: nowIso }
      : {}),
  };

  if (params.context.parent?.id) {
    const { error } = await supabaseAdmin
      .from("app_events")
      .update({ payload: nextPayload })
      .eq("id", params.context.parent.id)
      .eq("user_id", params.userId)
      .eq("type", "publish");
    if (error) throw error;
  }

  return nextPayload;
}

async function persistAsyncTiktokResult(params: {
  userId: string;
  publicationId: string;
  context: TiktokEventContext;
  nextResult: JsonRecord;
  providerTerminal: boolean;
}) {
  const eventId = String(params.context.channelEvent?.id || "").trim();
  if (!eventId) throw new Error("async_tiktok_channel_event_missing");

  const currentTechnicalStatus = String(
    params.context.channelPayload.status || "completed",
  ).toLowerCase();
  const nextTechnicalStatus =
    params.nextResult.ok === false
      ? "failed"
      : currentTechnicalStatus === "failed"
        ? "failed"
        : currentTechnicalStatus === "completed"
          ? "completed"
          : params.providerTerminal
            ? "completed"
            : currentTechnicalStatus;

  const updatedChannelPayload = await updateAsyncChannelEvent({
    userId: params.userId,
    eventId,
    patch: {
      status: nextTechnicalStatus,
      result: params.nextResult,
      ...(nextTechnicalStatus === "completed" || nextTechnicalStatus === "failed"
        ? { completedAt: new Date().toISOString() }
        : {}),
    },
  });

  // Le dernier worker peut convertir le parent et supprimer les enfants entre
  // notre lecture et cette ecriture. Dans ce cas, persister le resultat sur le
  // parent terminal evite de laisser le bilan iNrSend sur un ancien "pending".
  if (!updatedChannelPayload) {
    const refreshed = await loadTiktokEventContext(
      params.userId,
      params.publicationId,
    );
    if (!refreshed.async) {
      return persistTerminalParentTiktokResult({
        userId: params.userId,
        context: refreshed,
        nextResult: params.nextResult,
        terminal: params.providerTerminal,
      });
    }
    throw new Error("async_tiktok_channel_event_missing");
  }

  if (nextTechnicalStatus === "completed" || nextTechnicalStatus === "failed") {
    await finalizeAsyncPublicationIfReady({
      userId: params.userId,
      publicationId: params.publicationId,
    });
  }

  return {
    ...params.context.parentPayload,
    publication_id: params.publicationId,
    results: { tiktok: params.nextResult },
  };
}

function buildTiktokResponsePayload(
  context: TiktokEventContext,
  publicationId: string,
  nextResult: JsonRecord,
) {
  return {
    ...context.parentPayload,
    publication_id: publicationId,
    results: context.async
      ? { tiktok: nextResult }
      : {
          ...asRecord(context.parentPayload.results),
          tiktok: nextResult,
        },
  };
}

function needsTerminalEventPersistence(
  context: TiktokEventContext,
  providerTerminal: boolean,
) {
  if (!providerTerminal) return false;
  if (context.async) {
    const technicalStatus = String(
      context.channelPayload.status || "completed",
    ).toLowerCase();
    return technicalStatus !== "completed" && technicalStatus !== "failed";
  }

  const summary = asRecord(context.parentPayload.summary);
  return Boolean(
    !context.parentPayload.completedAt ||
      Number(summary.pendingCount || 0) > 0 ||
      String(context.parentPayload.outcome || "").toLowerCase() ===
        "external_processing",
  );
}

async function persistTiktokStatus({
  userId,
  publicationId,
  publishId,
  status,
  deliveryState,
  eventContext,
}: {
  userId: string;
  publicationId: string;
  publishId: string;
  status: Awaited<ReturnType<typeof fetchTiktokPublishStatus>>;
  deliveryState: TiktokDeliveryState;
  eventContext: TiktokEventContext;
}) {
  const context = eventContext;
  const current = context.result;
  if (isTiktokCancelledResult(current)) {
    return ensureCancelledEventState({ userId, event: context.parent });
  }
  const diagnostics = asRecord(current.diagnostics);
  const diagnosticStatus = asRecord(diagnostics.status);
  const nowIso = new Date().toISOString();
  const previousStatus = String(
    current.tiktok_status || diagnosticStatus.status || "",
  ).toUpperCase();
  const previousUploadedBytes = Number(
    current.tiktok_uploaded_bytes ?? diagnosticStatus.uploadedBytes ?? -1,
  );
  const previousDownloadedBytes = Number(
    current.tiktok_downloaded_bytes ?? diagnosticStatus.downloadedBytes ?? -1,
  );
  const nextUploadedBytes =
    status.uploadedBytes ??
    current.tiktok_uploaded_bytes ??
    diagnosticStatus.uploadedBytes ??
    null;
  const nextDownloadedBytes =
    status.downloadedBytes ??
    current.tiktok_downloaded_bytes ??
    diagnosticStatus.downloadedBytes ??
    null;
  const progressChanged =
    Boolean(status.status && String(status.status).toUpperCase() !== previousStatus) ||
    (nextUploadedBytes !== null && nextUploadedBytes !== previousUploadedBytes) ||
    (nextDownloadedBytes !== null && nextDownloadedBytes !== previousDownloadedBytes);
  const submittedAt = String(current.tiktok_submitted_at || diagnostics.submitted_at || nowIso);
  const previousProgressAt = String(current.tiktok_status_progress_at || diagnostics.status_progress_at || submittedAt);
  const progressAt = progressChanged ? nowIso : previousProgressAt;
  const submittedAtMs = dateMs(submittedAt);
  const progressAtMs = dateMs(progressAt);
  const nowMs = Date.now();
  const stalled = Boolean(
    status.pending &&
      !status.statusFetchFailed &&
      submittedAtMs !== null &&
      progressAtMs !== null &&
      nowMs - submittedAtMs >= 15 * 60 * 1000 &&
      nowMs - progressAtMs >= 10 * 60 * 1000,
  );
  const message = tiktokStatusMessage(status, stalled);
  const nextResult: JsonRecord = {
    ...current,
    ok: status.complete ? true : status.failed ? false : current.ok !== false,
    external_id: publishId,
    share_url: status.shareUrl || current.share_url || null,
    external_url: status.shareUrl || current.share_url || current.external_url || current.profile_url || null,
    tiktok_status: status.status || current.tiktok_status || null,
    tiktok_status_label: tiktokStatusLabel(status.status, Boolean(status.statusFetchFailed), stalled),
    tiktok_status_message: message,
    tiktok_status_checked_at: nowIso,
    tiktok_submitted_at: submittedAt,
    tiktok_status_progress_at: progressAt,
    tiktok_status_fetch_failed: Boolean(status.statusFetchFailed),
    tiktok_status_fetch_error: status.statusFetchFailed ? status.failReason || status.providerErrorCode || null : null,
    tiktok_fail_reason: status.failed ? status.failReason || null : null,
    tiktok_provider_error_code: status.providerErrorCode || null,
    tiktok_status_retryable: Boolean(status.retryable),
    tiktok_uploaded_bytes: nextUploadedBytes,
    tiktok_downloaded_bytes: nextDownloadedBytes,
    tiktok_public_post_ids: status.publiclyAvailablePostIds?.length
      ? status.publiclyAvailablePostIds
      : current.tiktok_public_post_ids || [],
    tiktok_stalled: stalled,
    warning: Boolean(status.pending || status.statusFetchFailed),
    warning_message: status.pending || status.statusFetchFailed ? message : null,
    error: status.failed ? message : null,
    diagnostics: {
      ...diagnostics,
      publish_id: publishId,
      status,
      share_url: status.shareUrl || diagnostics.share_url || null,
      submitted_at: submittedAt,
      status_progress_at: progressAt,
      status_checked_at: nowIso,
      stalled,
    },
  };

  const providerTerminal = Boolean(status.complete || status.failed);
  const shouldPersistEvent =
    hasMeaningfulTiktokResultChange(current, nextResult) ||
    needsTerminalEventPersistence(context, providerTerminal);
  let nextPayload: JsonRecord = buildTiktokResponsePayload(
    context,
    publicationId,
    nextResult,
  );

  if (shouldPersistEvent) {
    nextPayload = context.async
      ? await persistAsyncTiktokResult({
          userId,
          publicationId,
          context,
          nextResult,
          providerTerminal,
        })
      : await persistTerminalParentTiktokResult({
          userId,
          context,
          nextResult,
          terminal: providerTerminal,
        });
  }

  const nextDeliveryStatus = status.failed
    ? "failed"
    : status.complete
      ? "delivered"
      : "processing";
  const nextDeliveryError = status.failed ? message : null;
  const shouldPersistDelivery = shouldUpdateTiktokDelivery(
    deliveryState,
    nextDeliveryStatus,
    nextDeliveryError,
  );
  if (shouldPersistDelivery) {
    const { error: deliveryUpdateError } = await supabaseAdmin
      .from("publication_deliveries")
      .update({
        status: nextDeliveryStatus,
        error: nextDeliveryError,
      })
      .eq("user_id", userId)
      .eq("publication_id", publicationId)
      .eq("channel", "tiktok")
      .neq("status", "deleted");
    if (deliveryUpdateError) throw deliveryUpdateError;
  }

  if (shouldPersistEvent || shouldPersistDelivery) {
    const deliveryAfterPersistence = await getTiktokDeliveryState(
      userId,
      publicationId,
    );
    if (deliveryAfterPersistence?.status === "deleted") {
      const latestContext = await loadTiktokEventContext(userId, publicationId);
      return ensureCancelledEventState({ userId, event: latestContext.parent });
    }
  }

  return { nextPayload, nextResult, message, stalled, cancelled: false };
}

async function handler(_request: Request, context: { params: Promise<{ publicationId: string }> }) {
  try {
    const { user, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const params = await context.params;
    const publicationId = String(params.publicationId || "").trim();
    if (!publicationId) return jsonUserFacingError("Paramètres invalides.", { status: 400, code: "invalid_input" });

    const { data: delivery, error: deliveryError } = await supabaseAdmin
      .from("publication_deliveries")
      .select("status,error,channel")
      .eq("user_id", activeUserId)
      .eq("publication_id", publicationId)
      .eq("channel", "tiktok")
      .maybeSingle();

    if (deliveryError) throw deliveryError;

    const eventContext = await loadTiktokEventContext(activeUserId, publicationId);
    const eventResult = eventContext.result;
    const diagnostics = asRecord(eventResult.diagnostics);
    const publishId = String(eventResult.external_id || diagnostics.publish_id || "").trim();

    if (isTiktokCancelledResult(eventResult) || String(delivery?.status || "").toLowerCase() === "deleted") {
      const cancelledState = await ensureCancelledEventState({
        userId: activeUserId,
        event: eventContext.parent,
      });
      return NextResponse.json({
        ok: true,
        cancelled: true,
        publication_id: publicationId,
        channel: "tiktok",
        publish_id: publishId || null,
        status: {
          ok: true,
          status: "CANCELLED",
          pending: false,
          complete: false,
          failed: false,
        },
        status_label: "Annulé",
        message: cancelledState.message,
        result: cancelledState.nextResult,
        payload: cancelledState.nextPayload,
      });
    }

    if (!publishId) {
      return jsonUserFacingError("Identifiant TikTok introuvable pour cette publication.", { status: 404, code: "missing_tiktok_publish_id" });
    }

    const integration = await getLatestTiktokIntegration(activeUserId);
    const accessToken = await getTiktokAccessToken(activeUserId, integration);
    if (!accessToken) {
      return jsonUserFacingError("Connexion TikTok expirée. Reconnecte TikTok dans Canaux.", { status: 401, code: "tiktok_reconnect_required" });
    }

    const status = await fetchTiktokPublishStatus(accessToken, publishId);
    const persisted = await persistTiktokStatus({
      userId: activeUserId,
      publicationId,
      publishId,
      status,
      deliveryState: delivery
        ? {
            status: String(delivery.status || "").toLowerCase(),
            error: delivery.error == null ? null : String(delivery.error),
          }
        : null,
      eventContext,
    });

    return NextResponse.json({
      ok: status.ok,
      publication_id: publicationId,
      channel: "tiktok",
      publish_id: publishId,
      status,
      status_label: persisted.cancelled
        ? "Annulé"
        : tiktokStatusLabel(status.status, Boolean(status.statusFetchFailed), persisted.stalled),
      message: persisted.message,
      result: persisted.nextResult,
      payload: persisted.nextPayload,
      cancelled: persisted.cancelled,
    });
  } catch (e: unknown) {
    return jsonUserFacingError(e, {
      status: 500,
      fallback: "Impossible de vérifier le statut TikTok pour le moment.",
      code: "tiktok_status_check_failed",
    });
  }
}

export const GET = handler;
export const POST = handler;
