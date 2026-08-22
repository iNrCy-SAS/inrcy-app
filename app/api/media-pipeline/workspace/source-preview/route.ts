import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeImageThumbnailBuffer } from "@/lib/mediaImageNormalizer";
import {
  buildImageNormalizationStoragePath,
  getImageNormalizationSignature,
  IMAGE_NORMALIZATION_PIPELINE_VERSION,
} from "@/lib/mediaImageNormalizationPolicy";
import {
  toExactStorageArrayBuffer,
  withStorageBinaryMetadata,
} from "@/lib/supabaseStorageBinary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SOURCE_PREVIEW_MAX_BYTES = 60 * 1024 * 1024;

function cleanText(value: unknown, fallback = "", max = 500) {
  return String(value ?? fallback).trim().slice(0, max);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonError(error: string, status = 400, code?: string) {
  return NextResponse.json(
    { ok: false, error, ...(code ? { code } : {}) },
    { status },
  );
}

async function ensureThumbnailVariant(params: {
  accountId: string;
  mediaId: string;
}) {
  const signature = getImageNormalizationSignature("thumbnail");
  const existing = await supabaseAdmin
    .from("media_variants")
    .select("id,status,bucket_name,storage_path")
    .eq("account_id", params.accountId)
    .eq("media_id", params.mediaId)
    .is("workspace_id", null)
    .eq("purpose", "thumbnail")
    .is("channel", null)
    .eq("signature", signature)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const inserted = await supabaseAdmin
    .from("media_variants")
    .insert({
      account_id: params.accountId,
      media_id: params.mediaId,
      workspace_id: null,
      purpose: "thumbnail",
      channel: null,
      signature,
      status: "pending",
      pipeline_version: IMAGE_NORMALIZATION_PIPELINE_VERSION,
      transform_spec: {
        recipe: "source_interface_thumbnail_v1",
        max_side: 480,
        crop: false,
      },
      variant_metadata: {},
    })
    .select("id,status,bucket_name,storage_path")
    .single();
  if (!inserted.error) return inserted.data;

  if (inserted.error.code === "23505") {
    const concurrent = await supabaseAdmin
      .from("media_variants")
      .select("id,status,bucket_name,storage_path")
      .eq("account_id", params.accountId)
      .eq("media_id", params.mediaId)
      .is("workspace_id", null)
      .eq("purpose", "thumbnail")
      .is("channel", null)
      .eq("signature", signature)
      .single();
    if (concurrent.error) throw concurrent.error;
    return concurrent.data;
  }
  throw inserted.error;
}

async function createSourceThumbnail(params: {
  accountId: string;
  media: {
    id: string;
    bucket_name: string;
    storage_path: string;
    mime_type: string | null;
    original_file_name: string | null;
    size_bytes: number | null;
    media_metadata: Record<string, unknown> | null;
  };
}) {
  const variant = await ensureThumbnailVariant({
    accountId: params.accountId,
    mediaId: params.media.id,
  });
  if (
    variant.status === "ready" &&
    variant.bucket_name &&
    variant.storage_path
  ) {
    return { mediaId: params.media.id, reused: true };
  }

  const sourceSize = Number(params.media.size_bytes || 0);
  if (!sourceSize || sourceSize > SOURCE_PREVIEW_MAX_BYTES) {
    throw new Error("source_preview_size_invalid");
  }

  const signedUrl = await createSafeStorageSignedUrl(
    params.media.bucket_name,
    params.media.storage_path,
    300,
  );
  if (!signedUrl) throw new Error("URL source indisponible pour la miniature.");

  const response = await fetch(signedUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`source_preview_download_failed:${response.status}`);
  }
  const sourceBuffer = Buffer.from(await response.arrayBuffer());
  if (!sourceBuffer.length || sourceBuffer.length > SOURCE_PREVIEW_MAX_BYTES) {
    throw new Error("source_preview_download_invalid");
  }

  const normalized = await normalizeImageThumbnailBuffer({
    buffer: sourceBuffer,
    mimeType: params.media.mime_type || "application/octet-stream",
    originalFileName: params.media.original_file_name,
  });
  const thumbnail = normalized.thumbnail;
  const bucket = "inrcy-pro-media";
  const storagePath = buildImageNormalizationStoragePath({
    accountId: params.accountId,
    mediaId: params.media.id,
    purpose: "thumbnail",
    extension: thumbnail.extension,
  });
  const uploaded = await supabaseAdmin.storage
    .from(bucket)
    .upload(
      storagePath,
      toExactStorageArrayBuffer(thumbnail.buffer),
      {
        upsert: true,
        contentType: thumbnail.mimeType,
        cacheControl: "31536000",
      },
    );
  if (uploaded.error) throw uploaded.error;

  const readyAt = new Date().toISOString();
  const updatedVariant = await supabaseAdmin
    .from("media_variants")
    .update({
      status: "ready",
      bucket_name: bucket,
      storage_path: storagePath,
      mime_type: thumbnail.mimeType,
      size_bytes: thumbnail.sizeBytes,
      width: thumbnail.width,
      height: thumbnail.height,
      duration_seconds: null,
      pipeline_version: IMAGE_NORMALIZATION_PIPELINE_VERSION,
      transform_spec: {
        ...thumbnail.transformSpec,
        mission: "source_metadata",
        interface_only: true,
      },
      variant_metadata: withStorageBinaryMetadata({
        ...thumbnail.metadata,
        mission: "source_metadata",
        interface_only: true,
      }),
      error_code: null,
      error_message: null,
      ready_at: readyAt,
    })
    .eq("id", variant.id)
    .eq("account_id", params.accountId)
    .eq("media_id", params.media.id);
  if (updatedVariant.error) throw updatedVariant.error;

  const existingMetadata = asRecord(params.media.media_metadata);
  const updatedMedia = await supabaseAdmin
    .from("pro_media_library")
    .update({
      width: normalized.source.width,
      height: normalized.source.height,
      media_metadata: {
        ...existingMetadata,
        source_interface_thumbnail: {
          version: 1,
          bucket,
          storage_path: storagePath,
          width: thumbnail.width,
          height: thumbnail.height,
          completed_at: readyAt,
        },
      },
    })
    .eq("id", params.media.id)
    .eq("user_id", params.accountId);
  if (updatedMedia.error) throw updatedMedia.error;

  return { mediaId: params.media.id, reused: false };
}

export async function POST(request: Request) {
  try {
    const { errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const limited = await enforceRateLimit({
      name: "media_pipeline_source_preview",
      identifier: activeUserId,
      limit: 40,
      fallbackLimit: 40,
      window: "10 m",
      failClosed: false,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const workspaceId = cleanText(body?.workspaceId, "", 80);
    if (!workspaceId) {
      return jsonError("Espace média manquant.", 400, "workspace_required");
    }

    const workspace = await supabaseAdmin
      .from("publication_workspaces")
      .select("id")
      .eq("id", workspaceId)
      .eq("account_id", activeUserId)
      .maybeSingle();
    if (workspace.error) throw workspace.error;
    if (!workspace.data) {
      return jsonError("Espace média introuvable.", 404, "workspace_not_found");
    }

    const graph = await supabaseAdmin
      .from("publication_workspace_media")
      .select(
        "position,pro_media_library!inner(id,user_id,media_type,upload_status,bucket_name,storage_path,mime_type,original_file_name,size_bytes,media_metadata)",
      )
      .eq("workspace_id", workspaceId)
      .eq("pro_media_library.user_id", activeUserId)
      .eq("pro_media_library.media_type", "image")
      .eq("pro_media_library.upload_status", "uploaded")
      .order("position", { ascending: true });
    if (graph.error) throw graph.error;

    const candidates = (graph.data || [])
      .map((row: any) =>
        Array.isArray(row.pro_media_library)
          ? row.pro_media_library[0]
          : row.pro_media_library,
      )
      .filter((media: any) => {
        const metadata = asRecord(media?.media_metadata);
        const sourceMetadata = asRecord(metadata.source_metadata);
        return (
          media?.id &&
          (metadata.interface_preview_required === true ||
            sourceMetadata.interface_preview_required === true)
        );
      })
      .slice(0, 5);

    const results = [];
    for (const media of candidates) {
      results.push(
        await createSourceThumbnail({
          accountId: activeUserId,
          media,
        }),
      );
    }

    return NextResponse.json({
      ok: true,
      workspaceId,
      prepared: results.length,
      media: results,
    });
  } catch (error) {
    console.error("[media-pipeline] source preview failed", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Impossible de préparer la miniature du média.",
      500,
      "source_preview_failed",
    );
  }
}
