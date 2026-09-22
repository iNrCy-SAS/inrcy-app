import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { buildMediaLibraryContentUrl } from "@/lib/mediaLibraryContentUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createSignedUploadUrlWithRetry } from "@/lib/supabaseStorageUpload";
import { INR_MEDIA_UPLOAD_BATCH_SIZE } from "@/lib/mediaRules";
import {
  MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES,
  MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES,
} from "@/lib/mediaLibraryOptimizationPolicy";
import {
  detectUniversalUploadMediaType,
  getUniversalMediaContentType,
  getUniversalMediaSafeExtension,
} from "@/lib/mediaUploadPolicy";

export const runtime = "nodejs";

const BUCKET = "inrcy-pro-media";
const MAX_FILES = INR_MEDIA_UPLOAD_BATCH_SIZE;
const MAX_IMAGE_BYTES = MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES;
const MAX_VIDEO_BYTES = MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES;

type PrepareFile = {
  client_id?: unknown;
  name?: unknown;
  type?: unknown;
  size?: unknown;
};

type FinalizeUpload = {
  client_id?: unknown;
  original_name?: unknown;
  storage_path?: unknown;
  mime_type?: unknown;
  size_bytes?: unknown;
  width?: unknown;
  height?: unknown;
  duration_seconds?: unknown;
  upload_protocol?: unknown;
  media_metadata?: unknown;
};

function jsonError(message: string, status = 500, detail?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      ...(detail ? { detail: String(detail) } : {}),
    },
    { status },
  );
}

function cleanText(raw: unknown, fallback = "", max = 500) {
  return String(raw ?? fallback)
    .trim()
    .slice(0, max);
}

function cleanNumber(raw: unknown) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function cleanNullableDimension(raw: unknown) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function cleanNullableDuration(raw: unknown) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

function cleanTags(raw: unknown) {
  if (Array.isArray(raw)) {
    return raw
      .map((tag) => cleanText(tag, "", 60).toLowerCase())
      .filter(Boolean)
      .slice(0, 30);
  }

  return String(raw ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 30);
}

function cleanMediaMetadata(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  try {
    const serialized = JSON.stringify(raw);
    if (serialized.length > 12_000) return {};
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mediaTypeFromFile(name: string, mime: string): "image" | "video" | null {
  return detectUniversalUploadMediaType({ name, mimeType: mime });
}

function extFromFile(name: string, mime: string) {
  const mediaType = mediaTypeFromFile(name, mime) || "image";
  return getUniversalMediaSafeExtension({
    name,
    mimeType: mime,
    mediaType,
  });
}

function safeFileStem(name: string) {
  const base = String(name || "media-inrcy")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return base || "media-inrcy";
}

function assertAllowedFile(name: string, mime: string, size: number) {
  const type = mediaTypeFromFile(name, mime);
  if (!type) {
    throw new Error(
      `${name || "Fichier"} : format non reconnu par le moteur média iNrCy.`,
    );
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`${name || "Fichier"} : taille invalide.`);
  }
  if (type === "image" && size > MAX_IMAGE_BYTES) {
    throw new Error(
      `${name || "Image"} : la Médiathèque accepte jusqu’à 300 Mo.`,
    );
  }
  if (type === "video" && size > MAX_VIDEO_BYTES) {
    throw new Error(
      `${name || "Vidéo"} : la Médiathèque accepte jusqu’à 300 Mo.`,
    );
  }
}

function buildStoragePath(
  userId: string,
  name: string,
  mime: string,
  index: number,
) {
  const type = mediaTypeFromFile(name, mime) || "image";
  const extension = extFromFile(name, mime);
  const safeIndex = String(index + 1).padStart(3, "0");
  const unique = randomUUID().slice(0, 10);
  const year = new Date().getFullYear();
  return `users/${userId}/${type}/${year}/${Date.now()}-${safeIndex}-${unique}-${safeFileStem(name)}.${extension}`;
}

function isOwnedStoragePath(userId: string, storagePath: string) {
  return storagePath.startsWith(`users/${userId}/`);
}

function tableMissingError(
  error: { code?: string; message?: string } | null | undefined,
) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("pro_media_library")
  );
}

async function handlePrepareUpload(
  userId: string,
  body: Record<string, unknown>,
) {
  const files = Array.isArray(body.files) ? (body.files as PrepareFile[]) : [];
  if (files.length === 0) return jsonError("Ajoute au moins un fichier.", 400);
  if (files.length > MAX_FILES)
    return jsonError(`Import limité à ${MAX_FILES} fichiers par lot.`, 400);

  const items = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const clientId = cleanText(file.client_id, `file-${index}`, 180);
    const name = cleanText(file.name, `media-${index + 1}`, 180);
    const mime = cleanText(file.type, "", 80);
    const size = cleanNumber(file.size);

    assertAllowedFile(name, mime, size);
    const storagePath = buildStoragePath(userId, name, mime, index);
    const signed = await createSignedUploadUrlWithRetry(() =>
      supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(storagePath),
    );
    if (signed.error || !signed.data?.token) {
      throw new Error(
        signed.error?.message || "Impossible de préparer l’upload Supabase.",
      );
    }

    items.push({
      client_id: clientId,
      original_name: name,
      bucket: BUCKET,
      storage_path: storagePath,
      token: signed.data.token,
      signed_url: signed.data.signedUrl,
      content_type: getUniversalMediaContentType({
        name,
        mimeType: mime,
        mediaType: mediaTypeFromFile(name, mime) || "image",
      }),
      media_type: mediaTypeFromFile(name, mime),
      max_image_bytes: MAX_IMAGE_BYTES,
      max_video_bytes: MAX_VIDEO_BYTES,
    });
  }

  return NextResponse.json({
    ok: true,
    bucket: BUCKET,
    items,
    max_files: MAX_FILES,
    max_image_bytes: MAX_IMAGE_BYTES,
    max_video_bytes: MAX_VIDEO_BYTES,
  });
}

async function insertMediaRows(userId: string, body: Record<string, unknown>) {
  const uploads = Array.isArray(body.uploads)
    ? (body.uploads as FinalizeUpload[])
    : [];
  if (uploads.length === 0) return jsonError("Aucun média à finaliser.", 400);
  if (uploads.length > MAX_FILES)
    return jsonError(
      `Finalisation limitée à ${MAX_FILES} fichiers par lot.`,
      400,
    );

  const tags = cleanTags(body.tags);
  const baseTitle = cleanText(body.title, "", 180);
  const source = cleanText(body.source, "mediatheque", 80) || "mediatheque";
  const results: Array<{
    id?: string;
    bucket_name?: string;
    storage_path?: string;
    original_name: string;
    title?: string;
    media_type?: "image" | "video";
    mime_type?: string;
    size_bytes?: number;
    width?: number | null;
    height?: number | null;
    duration_seconds?: number | null;
    signed_url?: string | null;
    ok: boolean;
    error?: string;
  }> = [];

  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index];
    const originalName = cleanText(
      upload.original_name,
      `media-${index + 1}`,
      180,
    );
    const storagePath = cleanText(upload.storage_path, "", 500);
    const mimeType = cleanText(upload.mime_type, "", 80);
    const sizeBytes = cleanNumber(upload.size_bytes);
    const width = cleanNullableDimension(upload.width);
    const height = cleanNullableDimension(upload.height);
    const durationSeconds = cleanNullableDuration(upload.duration_seconds);
    const uploadProtocol =
      cleanText(upload.upload_protocol, "signed", 20) === "tus"
        ? "tus"
        : "signed";
    const mediaMetadata = cleanMediaMetadata(upload.media_metadata);

    try {
      assertAllowedFile(originalName, mimeType, sizeBytes);
      if (!storagePath || !isOwnedStoragePath(userId, storagePath)) {
        throw new Error("Chemin Storage invalide pour votre médiathèque.");
      }

      const mediaType = mediaTypeFromFile(originalName, mimeType);
      if (!mediaType) throw new Error("Format non autorisé.");

      const safeIndex = String(index + 1).padStart(3, "0");
      const title =
        baseTitle ||
        originalName.replace(/\.[a-z0-9]{2,5}$/i, "") ||
        `Média ${safeIndex}`;
      const insert = await supabaseAdmin
        .from("pro_media_library")
        .insert({
          user_id: userId,
          bucket_name: BUCKET,
          storage_path: storagePath,
          media_type: mediaType,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          title,
          tags,
          source,
          width,
          height,
          duration_seconds: durationSeconds,
          is_active: true,
          original_file_name: originalName,
          upload_protocol: uploadProtocol,
          upload_status: "uploaded",
          upload_progress: 100,
          uploaded_at: new Date().toISOString(),
          pipeline_version: 1,
          media_metadata: mediaMetadata,
        })
        .select("id,storage_path")
        .single();

      if (insert.error) {
        await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
        if (tableMissingError(insert.error)) {
          throw new Error(
            "La table pro_media_library n’existe pas encore. Lance le SQL fourni dans Supabase.",
          );
        }
        throw insert.error;
      }

      const contentUrl = buildMediaLibraryContentUrl(String(insert.data?.id || ""));

      results.push({
        ok: true,
        id: insert.data?.id,
        bucket_name: BUCKET,
        storage_path: insert.data?.storage_path,
        original_name: originalName,
        title,
        media_type: mediaType,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        width,
        height,
        duration_seconds: durationSeconds,
        signed_url: contentUrl,
      });
    } catch (error: any) {
      if (storagePath && isOwnedStoragePath(userId, storagePath)) {
        await supabaseAdmin.storage
          .from(BUCKET)
          .remove([storagePath])
          .catch(() => null);
      }

      results.push({
        ok: false,
        original_name: originalName,
        error: error?.message || "Finalisation impossible.",
      });
    }
  }

  return NextResponse.json({
    ok: results.some((result) => result.ok),
    uploaded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  });
}

async function handleFinalizeUpload(
  userId: string,
  body: Record<string, unknown>,
) {
  return insertMediaRows(userId, body);
}

export async function POST(request: NextRequest) {
  const { user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  try {
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object")
      return jsonError("Requête d’import invalide.", 400);

    const mode = cleanText(body.mode, "", 40);
    if (mode === "prepare") return await handlePrepareUpload(activeUserId, body);
    if (mode === "finalize") return await handleFinalizeUpload(activeUserId, body);

    return jsonError("Mode d’import inconnu.", 400);
  } catch (error: any) {
    return jsonError(
      error?.message || "Import médiathèque impossible.",
      500,
      error?.detail || error?.code,
    );
  }
}
