import { NextRequest, NextResponse } from "next/server";
import {
  MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES,
  MEDIA_LIBRARY_OPTIMIZATION_MAX_ATTEMPTS,
  MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES,
  buildMediaLibraryOptimizationIdempotencyKey,
  getMediaLibraryOptimizationRequirements,
  getMediaLibraryOptimizationJobType,
  normalizeMediaLibraryOptimizationTarget,
  type MediaLibraryOptimizationMediaType,
} from "@/lib/mediaLibraryOptimizationPolicy";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 500, code?: string) {
  return NextResponse.json(
    { ok: false, error: message, ...(code ? { code } : {}) },
    { status },
  );
}

function cleanText(value: unknown, max = 180) {
  return String(value || "").trim().slice(0, max);
}

export async function POST(request: NextRequest) {
  const { user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await request.json().catch(() => ({}));
  const mediaId = cleanText(body?.mediaId, 80);
  if (!mediaId) return jsonError("Média obligatoire.", 400, "media_id_missing");

  const mediaResult = await supabaseAdmin
    .from("pro_media_library")
    .select(
      "id,user_id,media_type,size_bytes,is_active,upload_status,title,original_file_name,storage_path,mime_type,detected_mime_type",
    )
    .eq("id", mediaId)
    .eq("user_id", activeUserId)
    .maybeSingle();
  if (mediaResult.error) {
    return jsonError(
      "Impossible de vérifier ce média.",
      500,
      mediaResult.error.code,
    );
  }
  if (!mediaResult.data) {
    return jsonError("Média introuvable.", 404, "media_not_found");
  }

  const mediaType = String(mediaResult.data.media_type || "") as MediaLibraryOptimizationMediaType;
  if (mediaType !== "image" && mediaType !== "video") {
    return jsonError("Ce format ne peut pas être optimisé.", 400, "media_type_invalid");
  }
  if (!mediaResult.data.is_active || mediaResult.data.upload_status !== "uploaded") {
    return jsonError("Ce média n’est plus disponible.", 409, "media_unavailable");
  }

  const sizeBytes = Number(mediaResult.data.size_bytes || 0);
  const targetBytes = normalizeMediaLibraryOptimizationTarget({
    mediaType,
    targetBytes: Number(body?.targetBytes || 0) || null,
  });
  const requirements = getMediaLibraryOptimizationRequirements({
    mediaType,
    sizeBytes,
    targetBytes,
    name:
      mediaResult.data.original_file_name ||
      mediaResult.data.storage_path ||
      mediaResult.data.title,
    mimeType:
      mediaResult.data.detected_mime_type || mediaResult.data.mime_type,
  });
  if (!requirements.needsOptimization) {
    return jsonError(
      "Ce média est déjà compatible et respecte le plafond de cet outil.",
      409,
      "media_already_optimized",
    );
  }
  const sourceLimit =
    mediaType === "video"
      ? MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES
      : MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES;
  if (sizeBytes > sourceLimit) {
    return jsonError(
      "Ce fichier dépasse le plafond de 300 Mo de la Médiathèque.",
      413,
      "media_source_too_large",
    );
  }

  const jobType = getMediaLibraryOptimizationJobType(mediaType);
  const idempotencyKey = buildMediaLibraryOptimizationIdempotencyKey({
    mediaId,
    mediaType,
    targetBytes,
  });
  const existing = await supabaseAdmin
    .from("media_processing_jobs")
    .select(
      "id,account_id,media_id,job_type,status,progress,result,error_code,error_message,attempt_count,max_attempts,created_at,updated_at",
    )
    .eq("account_id", activeUserId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) {
    return jsonError(
      "Impossible de préparer l’optimisation.",
      500,
      existing.error.code,
    );
  }

  const now = new Date().toISOString();
  if (existing.data) {
    const status = String(existing.data.status || "");
    if (status === "failed" || status === "cancelled") {
      const reset = await supabaseAdmin
        .from("media_processing_jobs")
        .update({
          status: "queued",
          progress: 0,
          attempt_count: 0,
          max_attempts: MEDIA_LIBRARY_OPTIMIZATION_MAX_ATTEMPTS,
          payload: {
            jobType,
            mediaType,
            authUserId: user?.id || null,
            requestedAt: now,
            targetBytes,
            operation: requirements.operation,
            needsCompression: requirements.needsCompression,
            needsConversion: requirements.needsConversion,
          },
          result: { stage: "En attente" },
          available_at: now,
          locked_at: null,
          lock_expires_at: null,
          locked_by: null,
          error_code: null,
          error_message: null,
          started_at: null,
          completed_at: null,
          updated_at: now,
        })
        .eq("id", existing.data.id)
        .eq("account_id", activeUserId)
        .select(
          "id,media_id,job_type,status,progress,result,error_code,error_message,attempt_count,max_attempts,created_at,updated_at",
        );
      if (reset.error) {
        return jsonError("Impossible de relancer l’optimisation.", 500, reset.error.code);
      }
      const resetJob = reset.data?.[0] ?? null;
      if (!resetJob) {
        return jsonError(
          "La tâche d’optimisation n’existe plus.",
          404,
          "optimization_job_missing",
        );
      }
      return NextResponse.json({ ok: true, queued: true, job: resetJob }, { status: 202 });
    }
    return NextResponse.json(
      { ok: true, queued: status !== "succeeded", job: existing.data },
      { status: status === "succeeded" ? 200 : 202 },
    );
  }

  const insert = await supabaseAdmin
    .from("media_processing_jobs")
    .insert({
      account_id: activeUserId,
      media_id: mediaId,
      job_type: jobType,
      status: "queued",
      priority: 150,
      attempt_count: 0,
      max_attempts: MEDIA_LIBRARY_OPTIMIZATION_MAX_ATTEMPTS,
      progress: 0,
      idempotency_key: idempotencyKey,
      payload: {
        jobType,
        mediaType,
        authUserId: user?.id || null,
        requestedAt: now,
        targetBytes,
        operation: requirements.operation,
        needsCompression: requirements.needsCompression,
        needsConversion: requirements.needsConversion,
      },
      result: { stage: "En attente" },
      available_at: now,
    })
    .select(
      "id,media_id,job_type,status,progress,result,error_code,error_message,attempt_count,max_attempts,created_at,updated_at",
    )
    .single();
  if (insert.error) {
    if (insert.error.code === "23505") {
      const duplicate = await supabaseAdmin
        .from("media_processing_jobs")
        .select(
          "id,media_id,job_type,status,progress,result,error_code,error_message,attempt_count,max_attempts,created_at,updated_at",
        )
        .eq("account_id", activeUserId)
        .eq("idempotency_key", idempotencyKey)
        .single();
      if (!duplicate.error) {
        return NextResponse.json({ ok: true, queued: true, job: duplicate.data }, { status: 202 });
      }
    }
    return jsonError("Impossible de créer la tâche d’optimisation.", 500, insert.error.code);
  }

  return NextResponse.json({ ok: true, queued: true, job: insert.data }, { status: 202 });
}
