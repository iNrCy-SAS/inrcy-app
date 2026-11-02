import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit } from "@/lib/rateLimit";
import {
  INR_MEDIA_IMAGE_MAX_BYTES,
  INR_MEDIA_IMAGE_MAX_MB_LABEL,
} from "@/lib/mediaRules";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { toExactStorageArrayBuffer } from "@/lib/supabaseStorageBinary";

const MAX_IMAGE_BYTES = INR_MEDIA_IMAGE_MAX_BYTES;
const DEFAULT_UPLOAD_FOLDER = "booster-prepublish";

const MIME_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
};

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "heic",
  "heif",
]);

function isAllowedImageMime(type: string) {
  return /^image\/(png|jpe?g|webp|gif|avif|heic|heif)$/i.test(type || "");
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
  const mimeExtension = MIME_EXTENSION[String(mimeType || "").toLowerCase()];
  if (mimeExtension) return mimeExtension;

  const rawName =
    String(name || "")
      .split(/[\\/]/)
      .pop() || "";
  const ext = rawName.includes(".")
    ? rawName.split(".").pop()?.toLowerCase() || ""
    : "";
  return ALLOWED_IMAGE_EXTENSIONS.has(ext)
    ? ext === "jpeg"
      ? "jpg"
      : ext
    : "jpg";
}

function sanitizeFileName(name: string, mimeType: string) {
  const rawName =
    String(name || "image")
      .split(/[\\/]/)
      .pop() || "image";
  const withoutExtension = rawName.replace(/\.[^.]*$/, "");
  const base = normalizeSafeSegment(withoutExtension, "image");
  return `${base}.${getSafeExtension(rawName, mimeType)}`.toLowerCase();
}

function sanitizeStorageFolder(folder: string) {
  return normalizeSafeSegment(folder, DEFAULT_UPLOAD_FOLDER)
    .replace(/\./g, "-")
    .toLowerCase();
}

function getRequestedFolder(path: string, userId: string) {
  const safeUserId = sanitizeUserId(userId);
  const cleanParts = String(path || "")
    .replace(/\\/g, "/")
    .replace(/\u0000/g, "")
    .replace(/^\/+/, "")
    .trim()
    .split("/")
    .filter(Boolean);

  if (cleanParts[0] === userId || cleanParts[0] === safeUserId)
    cleanParts.shift();
  const firstFolder = cleanParts.find((part) => part !== "." && part !== "..");
  return sanitizeStorageFolder(firstFolder || DEFAULT_UPLOAD_FOLDER);
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
  const folder = getRequestedFolder(requestedPath, userId);
  return `${safeUserId}/${folder}/${randomUUID()}-${sanitizeFileName(fallbackName, mimeType)}`;
}

async function uploadToBoosterStorage(
  storagePath: string,
  buffer: Buffer,
  contentType: string,
) {
  return await supabaseAdmin.storage
    .from("booster")
    .upload(storagePath, toExactStorageArrayBuffer(buffer), {
      contentType: contentType || "application/octet-stream",
      upsert: false,
      cacheControl: "3600",
    });
}

export async function POST(req: Request) {
  try {
    const { errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const rateLimited = await enforceRateLimit({
      name: "booster_upload_prepared",
      identifier: activeUserId,
      // Une programmation multicanale peut préparer l'original + une version
      // par canal pour chaque image. La marge couvre plusieurs canaux et une
      // reprise immédiate après une coupure réseau, sans ouvrir l'endpoint aux
      // rafales illimitées.
      limit: 180,
      window: "2 m",
      fallbackLimit: 180,
      // Ne bloque pas l upload si Upstash / KV est momentanement indisponible.
      // Sinon l ajout d une photo empeche la publication avec une erreur 503.
      failClosed: false,
    });
    if (rateLimited) return rateLimited;

    const formData = await req.formData().catch(() => null);
    if (!formData)
      return NextResponse.json(
        { error: "Données invalides." },
        { status: 400 },
      );

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Fichier manquant." }, { status: 400 });
    }

    if (!isAllowedImageMime(file.type)) {
      return NextResponse.json(
        { error: "Format d’image non autorisé." },
        { status: 400 },
      );
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        {
          error: `Image trop lourde. Taille maximale : ${INR_MEDIA_IMAGE_MAX_MB_LABEL}.`,
        },
        { status: 413 },
      );
    }

    const requestedPath = String(formData.get("path") || "");
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    let storagePath = sanitizeStoragePath(
      requestedPath,
      file.name || "image",
      activeUserId,
      file.type,
    );

    let upload = await uploadToBoosterStorage(
      storagePath,
      buffer,
      file.type || "application/octet-stream",
    );

    // Sécurité anti-casse : si Supabase refuse encore une clé ou si elle existe déjà,
    // on retente avec un nom 100 % généré côté serveur.
    if (upload.error) {
      const fallbackPath = buildFallbackStoragePath(
        activeUserId,
        file.name || "image",
        file.type,
        requestedPath,
      );
      if (fallbackPath !== storagePath) {
        const retry = await uploadToBoosterStorage(
          fallbackPath,
          buffer,
          file.type || "application/octet-stream",
        );
        if (!retry.error) {
          storagePath = fallbackPath;
          upload = retry;
        }
      }
    }

    if (upload.error) {
      return NextResponse.json(
        { error: getSimpleFrenchErrorMessage(upload.error, "Upload impossible.") },
        { status: 500 },
      );
    }

    const publicUrl =
      supabaseAdmin.storage.from("booster").getPublicUrl(storagePath)?.data
        ?.publicUrl || null;

    return NextResponse.json({
      ok: true,
      storagePath,
      publicUrl,
    });
  } catch (e) {
    console.error("[Booster] upload-prepared failed", e);
    return NextResponse.json(
      { error: "Impossible d'uploader l'image préparée." },
      { status: 500 },
    );
  }
}
