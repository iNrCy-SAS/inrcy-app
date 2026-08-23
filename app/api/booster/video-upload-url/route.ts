import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit } from "@/lib/rateLimit";
import { normalizeStorageDeliveryUrl } from "@/lib/storageUrlSanitization";
import {
  INR_MEDIA_VIDEO_FORMATS_LABEL,
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
  INR_MEDIA_VIDEO_TOO_LARGE_MESSAGE,
} from "@/lib/mediaRules";

const MAX_VIDEO_BYTES = INR_MEDIA_VIDEO_SOURCE_MAX_BYTES;
const DEFAULT_UPLOAD_FOLDER = "booster-videos";

const MIME_EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/x-m4v": "mp4",
  "video/quicktime": "mov",
  "application/mp4": "mp4",
};

const ALLOWED_VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov"]);

function normalizeMime(type: string) {
  return (
    String(type || "")
      .toLowerCase()
      .split(";")[0]
      ?.trim() || ""
  );
}

function isAllowedVideoMime(type: string) {
  return Object.hasOwn(MIME_EXTENSION, normalizeMime(type));
}

function isAllowedVideoFile(name: string, type: string) {
  const rawName =
    String(name || "")
      .split(/[\\/]/)
      .pop() || "";
  const ext = rawName.includes(".")
    ? rawName.split(".").pop()?.toLowerCase() || ""
    : "";
  if (!ALLOWED_VIDEO_EXTENSIONS.has(ext)) return false;
  const mimeType = normalizeMime(type);
  return (
    !mimeType ||
    mimeType === "application/octet-stream" ||
    isAllowedVideoMime(mimeType)
  );
}

function normalizeSafeSegment(value: string, fallback: string) {
  const safe = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 90);

  return safe || fallback;
}

function sanitizeUserId(userId: string) {
  return normalizeSafeSegment(userId, randomUUID()).replace(/\./g, "-");
}

function getSafeExtension(name: string, mimeType: string) {
  const mimeExtension = MIME_EXTENSION[normalizeMime(mimeType)];
  if (mimeExtension) return mimeExtension;

  const rawName =
    String(name || "")
      .split(/[\\/]/)
      .pop() || "";
  const ext = rawName.includes(".")
    ? rawName.split(".").pop()?.toLowerCase() || ""
    : "";
  return ALLOWED_VIDEO_EXTENSIONS.has(ext)
    ? ext === "m4v"
      ? "mp4"
      : ext
    : "mp4";
}

function getSafeContentType(name: string, type: string) {
  const mime = normalizeMime(type);
  if (mime === "video/quicktime" || /\.mov$/i.test(name)) {
    return "video/quicktime";
  }
  if (isAllowedVideoMime(mime)) return "video/mp4";
  return "video/mp4";
}

function sanitizeFileName(name: string, mimeType: string) {
  const rawName =
    String(name || "video-inrcy")
      .split(/[\\/]/)
      .pop() || "video-inrcy";
  const withoutExtension = rawName.replace(/\.[^.]*$/, "");
  const base = normalizeSafeSegment(withoutExtension, "video-inrcy");
  return `${base}.${getSafeExtension(rawName, mimeType)}`.toLowerCase();
}

function sanitizeStorageFolder(folder: string) {
  return normalizeSafeSegment(folder, DEFAULT_UPLOAD_FOLDER)
    .replace(/\./g, "-")
    .toLowerCase();
}

function sanitizeStoragePath(
  path: string,
  fallbackName: string,
  userId: string,
  mimeType: string,
) {
  const safeUserId = sanitizeUserId(userId);
  const rawParts = String(path || "")
    .replace(/\\/g, "/")
    .replace(/\u0000/g, "")
    .replace(/^\/+/, "")
    .trim()
    .split("/")
    .filter(Boolean);

  if (rawParts[0] === userId || rawParts[0] === safeUserId) rawParts.shift();

  const cleanParts = rawParts.filter((part) => part !== "." && part !== "..");
  const rawFileName = cleanParts.length
    ? cleanParts[cleanParts.length - 1]
    : fallbackName;
  const fileName = sanitizeFileName(rawFileName || fallbackName, mimeType);
  const folders = cleanParts
    .slice(0, -1)
    .map(sanitizeStorageFolder)
    .filter(Boolean)
    .slice(0, 4);

  const relativePath = [
    ...(folders.length ? folders : [DEFAULT_UPLOAD_FOLDER]),
    fileName,
  ].join("/");
  return `${safeUserId}/${relativePath}`;
}

function buildFallbackStoragePath(
  userId: string,
  fallbackName: string,
  mimeType: string,
  requestedPath: string,
) {
  const safeUserId = sanitizeUserId(userId);
  const firstFolder = String(requestedPath || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .find((part) => part !== userId && part !== safeUserId);
  const folder = sanitizeStorageFolder(firstFolder || DEFAULT_UPLOAD_FOLDER);
  return `${safeUserId}/${folder}/${randomUUID()}-${sanitizeFileName(fallbackName, mimeType)}`;
}

async function createSignedUpload(storagePath: string) {
  return await supabaseAdmin.storage
    .from("booster")
    .createSignedUploadUrl(storagePath);
}

export async function POST(req: Request) {
  try {
    const { user, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const rateLimited = await enforceRateLimit({
      name: "booster_video_signed_upload",
      identifier: activeUserId,
      limit: 20,
      window: "1 m",
      failClosed: false,
    });
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Données vidéo invalides." },
        { status: 400 },
      );
    }

    const name = String((body as any).name || "video-inrcy.mp4");
    const type = String((body as any).type || "");
    const size = Number((body as any).size || 0);
    const requestedPath = String((body as any).path || "");

    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json(
        { error: "Taille vidéo invalide." },
        { status: 400 },
      );
    }

    if (size > MAX_VIDEO_BYTES) {
      return NextResponse.json(
        {
          error: INR_MEDIA_VIDEO_TOO_LARGE_MESSAGE,
        },
        { status: 413 },
      );
    }

    if (!isAllowedVideoFile(name, type)) {
      return NextResponse.json(
        {
          error: `Format vidéo non autorisé. Formats acceptés : ${INR_MEDIA_VIDEO_FORMATS_LABEL}.`,
        },
        { status: 400 },
      );
    }

    const contentType = getSafeContentType(name, type);
    let storagePath = sanitizeStoragePath(
      requestedPath,
      name || "video-inrcy.mp4",
      activeUserId,
      contentType,
    );

    let signed = await createSignedUpload(storagePath);

    if (signed.error) {
      const fallbackPath = buildFallbackStoragePath(
        activeUserId,
        name || "video-inrcy.mp4",
        contentType,
        requestedPath,
      );
      if (fallbackPath !== storagePath) {
        const retry = await createSignedUpload(fallbackPath);
        if (!retry.error) {
          storagePath = fallbackPath;
          signed = retry;
        }
      }
    }

    if (signed.error || !signed.data?.token) {
      return NextResponse.json(
        {
          error:
            signed.error?.message || "Impossible de préparer l’upload vidéo.",
        },
        { status: 500 },
      );
    }

    const { data: publicData } = supabaseAdmin.storage
      .from("booster")
      .getPublicUrl(storagePath);

    return NextResponse.json({
      ok: true,
      bucket: "booster",
      storagePath,
      path: storagePath,
      token: signed.data.token,
      signedUrl: normalizeStorageDeliveryUrl(signed.data.signedUrl),
      publicUrl: publicData.publicUrl,
      contentType,
      name: sanitizeFileName(name, contentType),
      size,
    });
  } catch (e: any) {
    console.error("[Booster] video-upload-url failed", e);
    return NextResponse.json(
      { error: e?.message || "Préparation upload vidéo impossible." },
      { status: 500 },
    );
  }
}
