import { NextResponse } from "next/server";

import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildTiktokMediaProxyUrl } from "@/lib/tiktokMediaUrl";
import { refreshTiktokAccessToken } from "@/lib/tiktokOAuth";
import {
  getTiktokUserFacingError,
  tiktokDirectPostPhotos,
  tiktokDirectPostVideoFileUpload,
  type TiktokPublicationSettings,
} from "@/lib/tiktokPublish";
import { asNumber, asRecord, asString } from "@/lib/tsSafe";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

type AppEventRow = {
  id: string | number;
  payload?: unknown;
};

function isExpired(expiresAt: unknown, skewSeconds = 120) {
  const raw = asString(expiresAt) || "";
  if (!raw) return false;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp <= Date.now() + skewSeconds * 1000;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const stringValue = asString(value);
    if (stringValue && stringValue.trim()) return stringValue.trim();
  }
  return "";
}

function firstArrayOfStrings(...values: unknown[]) {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const strings = value.map((entry) => asString(entry)?.trim() || "").filter(Boolean);
    if (strings.length) return strings;
  }
  return [];
}

function isUsableTiktokSettings(value: unknown): value is TiktokPublicationSettings {
  const settings = asRecord(value);
  return Boolean(
    firstString(settings.privacyLevel) &&
      settings.musicUsageConfirmed === true &&
      ["none", "self", "branded", "both"].includes(firstString(settings.commercialContent)),
  );
}

function isTiktokCancelledResult(resultLike: unknown) {
  const result = asRecord(resultLike);
  const status = String(result.tiktok_status || result.status || "").toUpperCase();
  return result.cancelled === true || status === "CANCELLED" || status === "CANCELED";
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

async function loadAppEvent(userId: string, publicationId: string) {
  const { data, error } = await supabaseAdmin
    .from("app_events")
    .select("id,payload")
    .eq("user_id", userId)
    .eq("module", "booster")
    .eq("type", "publish")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return ((data || []) as AppEventRow[]).find((row) => String(asRecord(row.payload).publication_id || "") === publicationId) || null;
}

async function loadBoosterVideo(storagePath: string) {
  const cleanPath = storagePath.trim();
  if (!cleanPath) return null;
  const { data, error } = await supabaseAdmin.storage.from("booster").download(cleanPath);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  if (!buffer.length) return null;
  return {
    buffer,
    contentType: data.type || "application/octet-stream",
    size: buffer.length,
  };
}

function pickTiktokVideo(payload: JsonRecord) {
  const videoByChannel = asRecord(payload.videoByChannel);
  const candidate = asRecord(videoByChannel.tiktok);
  const fallback = asRecord(payload.video);
  return Object.keys(candidate).length ? candidate : fallback;
}

function pickTiktokTitle(payload: JsonRecord) {
  const postByChannel = asRecord(payload.postByChannel);
  const tiktokPost = asRecord(postByChannel.tiktok);
  const post = asRecord(payload.post);
  return firstString(
    tiktokPost.content,
    tiktokPost.text,
    tiktokPost.title,
    post.content,
    post.text,
    post.title,
    payload.content,
    payload.title,
    "Publication iNrCy",
  );
}

function buildRetryResult({
  previous,
  result,
  mediaType,
  mediaUrls,
  settings,
}: {
  previous: JsonRecord;
  result: any;
  mediaType: "video" | "photos";
  mediaUrls: string[];
  settings: TiktokPublicationSettings;
}) {
  const pendingMessage = result.status?.statusFetchFailed
    ? `TikTok a accepté le nouvel envoi, mais le statut n'est pas lisible pour le moment : ${result.status.failReason || "vérification temporairement indisponible"}.`
    : result.status?.pending
      ? "TikTok a accepté le nouvel envoi. iNrSend vérifie automatiquement sa finalisation."
      : null;
  const profileUrl = firstString(previous.profile_url, previous.external_url, previous.externalUrl);
  const shareUrl = firstString(result.shareUrl);
  const openUrl = shareUrl || profileUrl || null;

  return {
    ...previous,
    ok: true,
    error: null,
    warning: Boolean(pendingMessage),
    warning_message: pendingMessage,
    external_id: result.publishId || null,
    external_url: openUrl,
    share_url: shareUrl || null,
    tiktok_status: result.status?.status || "PUBLISH_COMPLETE",
    tiktok_status_label: result.status?.statusFetchFailed
      ? "Vérification impossible"
      : result.status?.pending
        ? "En traitement"
        : "Publié",
    tiktok_status_message: pendingMessage,
    tiktok_status_checked_at: new Date().toISOString(),
    tiktok_submitted_at: new Date().toISOString(),
    tiktok_status_fetch_failed: Boolean(result.status?.statusFetchFailed),
    tiktok_uploaded_bytes: result.status?.uploadedBytes ?? null,
    tiktok_downloaded_bytes: result.status?.downloadedBytes ?? null,
    tiktok_public_post_ids: result.status?.publiclyAvailablePostIds || [],
    tiktok_media_type: mediaType,
    media_type: mediaType,
    media_count: mediaType === "video" ? 1 : mediaUrls.length,
    diagnostics: {
      ...asRecord(previous.diagnostics),
      provider: "tiktok",
      mode: "direct_post",
      transfer: mediaType === "video" ? "FILE_UPLOAD" : "PULL_FROM_URL",
      retry_at: new Date().toISOString(),
      publish_id: result.publishId || null,
      mediaType,
      mediaUrls,
      publicationSettings: settings,
      status: result.status || null,
      share_url: shareUrl || null,
      raw: result.raw,
    },
  } satisfies JsonRecord;
}

async function persistRetryResult({
  userId,
  publicationId,
  eventId,
  payload,
  nextResult,
  status,
  error,
}: {
  userId: string;
  publicationId: string;
  eventId: string | number;
  payload: JsonRecord;
  nextResult: JsonRecord;
  status: "delivered" | "processing" | "failed";
  error?: string | null;
}) {
  const results = asRecord(payload.results);
  const nextPayload = {
    ...payload,
    results: {
      ...results,
      tiktok: nextResult,
    },
  } satisfies JsonRecord;

  await supabaseAdmin.from("app_events").update({ payload: nextPayload }).eq("id", eventId).eq("user_id", userId);
  await supabaseAdmin
    .from("publication_deliveries")
    .update({ status, error: error || null })
    .eq("user_id", userId)
    .eq("publication_id", publicationId)
    .eq("channel", "tiktok");

  return nextPayload;
}

async function handler(request: Request, context: { params: Promise<{ publicationId: string }> }) {
  try {
    const { errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const params = await context.params;
    const publicationId = String(params.publicationId || "").trim();
    if (!publicationId) return jsonUserFacingError("Paramètres invalides.", { status: 400, code: "invalid_input" });

    const event = await loadAppEvent(activeUserId, publicationId);
    if (!event?.id) return jsonUserFacingError("Publication iNrSend introuvable.", { status: 404, code: "publication_not_found" });

    const payload = asRecord(event.payload);
    const results = asRecord(payload.results);
    const previous = asRecord(results.tiktok);
    if (isTiktokCancelledResult(previous)) {
      return jsonUserFacingError(
        "Cette publication a été annulée dans iNrSend. Crée une nouvelle publication depuis Booster pour la renvoyer.",
        { status: 409, code: "tiktok_publication_cancelled" },
      );
    }
    const diagnostics = asRecord(previous.diagnostics);
    const settingsCandidate = diagnostics.publicationSettings || previous.publicationSettings;
    if (!isUsableTiktokSettings(settingsCandidate)) {
      return jsonUserFacingError("Paramètres TikTok introuvables. Relance la publication depuis Booster pour revalider l'écran TikTok.", { status: 400, code: "missing_tiktok_settings" });
    }
    const publicationSettings = settingsCandidate;

    const integration = await getLatestTiktokIntegration(activeUserId);
    const accessToken = await getTiktokAccessToken(activeUserId, integration);
    if (!accessToken) {
      return jsonUserFacingError("Connexion TikTok expirée. Reconnecte TikTok dans Canaux.", { status: 401, code: "tiktok_reconnect_required" });
    }

    const rawMediaType = firstString(previous.tiktok_media_type, previous.media_type, diagnostics.mediaType, asRecord(payload.mediaModeByChannel).tiktok).toLowerCase();
    const isVideo = rawMediaType === "video";
    const title = pickTiktokTitle(payload);

    const mediaUrls = firstArrayOfStrings(diagnostics.mediaUrls, previous.mediaUrls, payload.publishableUrls, payload.socialFeedPublishableUrls);
    let publishResult: any;
    let nextMediaUrls = mediaUrls;

    if (isVideo) {
      const video = pickTiktokVideo(payload);
      const storagePath = firstString(video.storagePath, video.storage_path, video.path, payload.video_path);
      const videoDurationSeconds = asNumber(video.duration) ?? asNumber(video.durationSeconds) ?? asNumber(video.video_duration_seconds);
      const file = storagePath ? await loadBoosterVideo(storagePath) : null;
      if (!storagePath || !file) {
        return jsonUserFacingError(
          "La vidéo TikTok n'est plus disponible dans le stockage iNrCy. Réimporte-la depuis Booster avant de retenter.",
          { status: 404, code: "tiktok_video_file_upload_required" },
        );
      }
      publishResult = await tiktokDirectPostVideoFileUpload({
        accessToken,
        videoBuffer: file.buffer,
        contentType: file.contentType,
        title,
        publicationSettings,
        videoDurationSeconds,
      });
      const proxyUrl = buildTiktokMediaProxyUrl(request.url, storagePath);
      nextMediaUrls = proxyUrl ? [proxyUrl] : mediaUrls;
    } else {
      nextMediaUrls = mediaUrls.filter(Boolean).slice(0, 35);
      if (!nextMediaUrls.length) return jsonUserFacingError("Photos TikTok introuvables pour retenter l'envoi.", { status: 404, code: "missing_tiktok_photos" });
      publishResult = await tiktokDirectPostPhotos({
        accessToken,
        imageUrls: nextMediaUrls,
        title: firstString(asRecord(asRecord(payload.postByChannel).tiktok).title, asRecord(payload.post).title, "Publication iNrCy"),
        description: title,
        publicationSettings,
      });
    }

    if (!publishResult.ok) {
      const message = publishResult.error || getTiktokUserFacingError("tiktok_publish_failed");
      const failedResult = {
        ...previous,
        ok: false,
        error: message,
        warning: false,
        warning_message: null,
        external_id: publishResult.publishId || previous.external_id || null,
        tiktok_status: publishResult.status?.status || "FAILED",
        tiktok_status_label: "Échec",
        tiktok_status_message: message,
        tiktok_fail_reason: publishResult.status?.failReason || null,
        tiktok_status_checked_at: new Date().toISOString(),
        diagnostics: {
          ...diagnostics,
          retry_at: new Date().toISOString(),
          publish_id: publishResult.publishId || diagnostics.publish_id || null,
          status: publishResult.status || null,
          raw: publishResult.raw,
        },
      } satisfies JsonRecord;
      const nextPayload = await persistRetryResult({
        userId: activeUserId,
        publicationId,
        eventId: event.id,
        payload,
        nextResult: failedResult,
        status: "failed",
        error: message,
      });
      return NextResponse.json({ ok: false, publication_id: publicationId, message, result: failedResult, payload: nextPayload });
    }

    const nextResult = buildRetryResult({
      previous,
      result: publishResult,
      mediaType: isVideo ? "video" : "photos",
      mediaUrls: nextMediaUrls,
      settings: publicationSettings,
    });
    const nextStatus = publishResult.status?.pending ? "processing" : "delivered";
    const nextPayload = await persistRetryResult({
      userId: activeUserId,
      publicationId,
      eventId: event.id,
      payload,
      nextResult,
      status: nextStatus,
      error: null,
    });

    return NextResponse.json({
      ok: true,
      publication_id: publicationId,
      message: publishResult.status?.pending
        ? "Nouvel envoi TikTok accepté. Vérifie le statut dans quelques instants."
        : "Nouvel envoi TikTok publié.",
      result: nextResult,
      payload: nextPayload,
    });
  } catch (e: unknown) {
    return jsonUserFacingError(e, {
      status: 500,
      fallback: "Impossible de retenter l'envoi TikTok pour le moment.",
      code: "tiktok_retry_failed",
    });
  }
}

export const POST = handler;
