import { getPinterestApiBaseUrl } from "@/lib/pinterestOAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { asRecord, asString } from "@/lib/tsSafe";
import {
  isPinterestVideoOutcomeUnknown,
  publishPinterestVideoWithProtocol,
} from "@/lib/pinterestVideoProtocol";
import { buildPinterestImageMediaSource } from "@/lib/pinterestImagePinPayload";
import { preparePinterestCarouselImages } from "@/lib/pinterestCarouselImages";
import {
  ensureFrenchPublicationErrorMessage,
  getProviderPublicationErrorMessage,
} from "@/lib/publicationErrorFrench";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { getVideoPublicationPolicy } from "@/lib/videoPublicationPolicy";
import { toExactStorageArrayBuffer } from "@/lib/supabaseStorageBinary";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { createWriteStream, openAsBlob } from "fs";
import { access, chmod, mkdir, readFile, rm, stat } from "fs/promises";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import os from "os";
import path from "path";
import ffmpegStaticPath from "ffmpeg-static";

export type PinterestCreateImagePinArgs = {
  accessToken: string;
  userId: string;
  boardId: string;
  title: string;
  description?: string;
  imageUrl?: string;
  imageUrls?: string[];
  link?: string | null;
};

export type PinterestCreatePinResult = {
  ok: boolean;
  id: string | null;
  url: string | null;
  board_id: string | null;
  media_id?: string | null;
  media_status?: string | null;
  media_type?: "image" | "video";
  cover_image_url?: string | null;
  images_harmonized?: boolean;
  prepared_image_urls?: string[];
  target_width?: number | null;
  target_height?: number | null;
};

export type PinterestCreateVideoPinArgs = {
  accessToken: string;
  userId: string;
  boardId: string;
  title: string;
  description?: string;
  videoUrl: string;
  videoStoragePath?: string | null;
  videoContentType?: string | null;
  videoFileName?: string | null;
  coverImageUrl?: string | null;
  coverStoragePath?: string | null;
  coverBucket?: string | null;
  link?: string | null;
};

function cleanSingleLineText(value: unknown, maxLength: number) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

function cleanMultilineText(value: unknown, maxLength: number) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, maxLength)
    .trim();
}

function normalizePublicUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw;
}

function buildPinterestPinUrl(pinId: string | null) {
  return pinId
    ? `https://www.pinterest.com/pin/${encodeURIComponent(pinId)}/`
    : null;
}

type PinterestApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

async function pinterestApiRequest<T = unknown>(
  path: string,
  accessToken: string,
  options: { method: PinterestApiMethod; body?: unknown },
): Promise<T> {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const hasBody =
    options.body !== undefined &&
    options.method !== "DELETE" &&
    options.method !== "GET";
  const res = await fetch(`${getPinterestApiBaseUrl()}/v5${cleanPath}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      Accept: "application/json",
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const raw = await res.text().catch(() => "");
  let json: unknown = {};
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = { message: raw };
    }
  }

  if (!res.ok) {
    const rec = asRecord(json);
    const rawMessage =
      asString(rec.message) ||
      asString(rec.error_description) ||
      asString(rec.error) ||
      `Pinterest a refusé l'action (${res.status}).`;
    const message =
      getProviderPublicationErrorMessage("pinterest", rawMessage) ||
      ensureFrenchPublicationErrorMessage(
        rawMessage,
        `Pinterest a refusé l'action (${res.status}). Merci de réessayer.`,
      );
    const pinterestCode =
      asString(rec.code) || asString(rec.error_code) || asString(rec.error_type) || null;
    const error = new Error(message) as Error & {
      status?: number;
      pinterestCode?: string | null;
      pinterestRawMessage?: string | null;
    };
    error.status = res.status;
    error.pinterestCode = pinterestCode;
    error.pinterestRawMessage = rawMessage;
    throw error;
  }
  return json as T;
}

const execFileAsync = promisify(execFile);
const PINTEREST_VIDEO_POLICY = getVideoPublicationPolicy("pinterest");
const PINTEREST_COVER_BUCKET = "booster";
const PINTEREST_COVER_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;
const PINTEREST_VIDEO_TIMEOUT_MS = 120000;
const PINTEREST_SOURCE_DOWNLOAD_TIMEOUT_MS = 150000;

function sanitizeStoragePath(value: unknown) {
  const clean = String(value || "")
    .replace(/\\/g, "/")
    .replace(/\u0000/g, "")
    .replace(/^\/+/, "")
    .trim();
  if (!clean || clean.includes("..")) return "";
  return clean;
}

function sanitizePathSegment(value: unknown, fallback: string) {
  const clean = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 90);
  return clean || fallback;
}

function inferPinterestVideoFormat(params: {
  contentType?: string | null;
  fileName?: string | null;
  videoUrl?: string | null;
}) {
  const contentType = String(params.contentType || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  const source = `${params.fileName || ""} ${params.videoUrl || ""}`
    .toLowerCase()
    .split("?")[0];

  if (contentType === "video/quicktime" || /\.mov(?:\s|$)/.test(source)) {
    return { extension: "mov", contentType: "video/quicktime", supported: true };
  }
  if (contentType === "video/x-m4v" || /\.m4v(?:\s|$)/.test(source)) {
    return { extension: "m4v", contentType: "video/x-m4v", supported: true };
  }
  if (contentType === "video/mp4" || /\.mp4(?:\s|$)/.test(source)) {
    return { extension: "mp4", contentType: "video/mp4", supported: true };
  }
  if (contentType === "video/webm" || /\.webm(?:\s|$)/.test(source)) {
    return { extension: "webm", contentType: "video/webm", supported: false };
  }
  return { extension: "mp4", contentType: "video/mp4", supported: true };
}

function getFfmpegCandidates() {
  return [
    process.env.FFMPEG_PATH,
    ffmpegStaticPath,
    "ffmpeg",
  ]
    .map((candidate) => String(candidate || "").trim())
    .filter(Boolean);
}

async function ensureFfmpegAvailable() {
  const errors: string[] = [];
  for (const candidate of getFfmpegCandidates()) {
    try {
      if (candidate !== "ffmpeg" && process.platform !== "win32") {
        try {
          await access(/* turbopackIgnore: true */ candidate);
          await chmod(candidate, 0o755);
        } catch {
          // Le test -version ci-dessous donnera l'erreur exacte.
        }
      }
      await execFileAsync(candidate, ["-version"], {
        timeout: 6000,
        maxBuffer: 1024 * 1024,
      });
      return candidate;
    } catch (error) {
      errors.push(
        `${candidate}: ${String((error as any)?.message || error || "indisponible").slice(0, 180)}`,
      );
    }
  }
  throw new Error(
    `Pinterest nécessite FFmpeg pour préparer la couverture vidéo. ${errors.join(" | ")}`,
  );
}

async function downloadPinterestVideoSource(params: {
  videoUrl: string;
  storagePath?: string | null;
  destinationPath: string;
}) {
  const storagePath = sanitizeStoragePath(params.storagePath);
  let videoUrl = normalizePublicUrl(params.videoUrl);
  if (storagePath) {
    const signedUrl = normalizePublicUrl(
      await createSafeStorageSignedUrl(
        PINTEREST_COVER_BUCKET,
        storagePath,
        60 * 60,
      ),
    );
    if (signedUrl) {
      videoUrl = signedUrl;
    }
  }

  if (!videoUrl) {
    throw new Error("Pinterest nécessite une URL vidéo publique valide.");
  }
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    PINTEREST_SOURCE_DOWNLOAD_TIMEOUT_MS,
  );
  try {
    const response = await fetch(videoUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: abortController.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(
        `Impossible de télécharger la vidéo pour Pinterest (${response.status}).`,
      );
    }
    const announcedSize = Number(response.headers.get("content-length") || 0);
    if (
      Number.isFinite(announcedSize) &&
      announcedSize > PINTEREST_VIDEO_POLICY.maxBytes
    ) {
      throw new Error(
        `La vidéo Pinterest dépasse ${PINTEREST_VIDEO_POLICY.maxBytesLabel}, limite source iNrCy.`,
      );
    }

    let receivedBytes = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        receivedBytes += Buffer.byteLength(chunk);
        if (receivedBytes > PINTEREST_VIDEO_POLICY.maxBytes) {
          callback(
            new Error(
              `La vidéo Pinterest dépasse ${PINTEREST_VIDEO_POLICY.maxBytesLabel}, limite source iNrCy.`,
            ),
          );
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as never),
      limit,
      createWriteStream(params.destinationPath, { flags: "wx" }),
    );
    if (!receivedBytes) throw new Error("La vidéo Pinterest est vide.");
    return { path: params.destinationPath, size: receivedBytes };
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadPinterestCover(params: {
  userId: string;
  coverBuffer: Buffer;
}) {
  const safeUserId = sanitizePathSegment(params.userId, randomUUID()).replace(
    /\./g,
    "-",
  );
  const storagePath = `${safeUserId}/pinterest-video-covers/${randomUUID()}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from(PINTEREST_COVER_BUCKET)
    .upload(storagePath, toExactStorageArrayBuffer(params.coverBuffer), {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });
  if (error) {
    throw new Error(
      error.message || "Impossible d'enregistrer la couverture Pinterest.",
    );
  }
  const publicUrl = supabaseAdmin.storage
    .from(PINTEREST_COVER_BUCKET)
    .getPublicUrl(storagePath).data.publicUrl;
  if (!normalizePublicUrl(publicUrl)) {
    throw new Error("La couverture Pinterest n'est pas publiquement accessible.");
  }
  return { publicUrl, storagePath };
}

async function preparePinterestVideoAsset(params: {
  userId: string;
  sourcePath: string;
  sourceSize: number;
  tempDir: string;
  videoUrl: string;
  videoContentType?: string | null;
  videoFileName?: string | null;
  coverImageUrl?: string | null;
}) {
  const sourceFormat = inferPinterestVideoFormat({
    contentType: params.videoContentType,
    fileName: params.videoFileName,
    videoUrl: params.videoUrl,
  });
  const directCover = normalizePublicUrl(params.coverImageUrl);
  const needsFfmpeg = !sourceFormat.supported || !directCover;

  if (!needsFfmpeg) {
    return {
      videoPath: params.sourcePath,
      videoSize: params.sourceSize,
      videoContentType: sourceFormat.contentType,
      videoFileName: sanitizePathSegment(
        params.videoFileName,
        `video-inrcy.${sourceFormat.extension}`,
      ),
      coverImageUrl: directCover,
      coverStoragePath: null as string | null,
    };
  }

  const ffmpegPath = await ensureFfmpegAvailable();
  {
    const sourcePath = params.sourcePath;
    let finalPath = sourcePath;
    let finalContentType = sourceFormat.contentType;
    let finalFileName = sanitizePathSegment(
      params.videoFileName,
      `video-inrcy.${sourceFormat.extension}`,
    );

    if (!sourceFormat.supported) {
      finalPath = path.join(params.tempDir, "pinterest-video.mp4");
      await execFileAsync(
        ffmpegPath,
        [
          "-y",
          "-i",
          sourcePath,
          "-map",
          "0:v:0",
          "-map",
          "0:a?",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "27",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "96k",
          "-movflags",
          "+faststart",
          "-threads",
          "2",
          finalPath,
        ],
        { timeout: PINTEREST_VIDEO_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      );
      finalContentType = "video/mp4";
      finalFileName = `${path.parse(finalFileName).name || "video-inrcy"}.mp4`;
    }

    const finalFile = await stat(/* turbopackIgnore: true */ finalPath);
    if (!finalFile.size) {
      throw new Error("La préparation vidéo Pinterest a produit un fichier vide.");
    }
    if (finalFile.size > PINTEREST_VIDEO_POLICY.maxBytes) {
      throw new Error(
        `La vidéo préparée pour Pinterest dépasse ${PINTEREST_VIDEO_POLICY.maxBytesLabel}, limite source iNrCy.`,
      );
    }

    let coverImageUrl = directCover;
    let coverStoragePath: string | null = null;
    if (!coverImageUrl) {
      const coverPath = path.join(params.tempDir, "pinterest-cover.jpg");
      try {
        await execFileAsync(
          ffmpegPath,
          [
            "-y",
            "-ss",
            "0.2",
            "-i",
            finalPath,
            "-frames:v",
            "1",
            "-q:v",
            "2",
            coverPath,
          ],
          { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
        );
      } catch {
        await execFileAsync(
          ffmpegPath,
          ["-y", "-i", finalPath, "-frames:v", "1", "-q:v", "2", coverPath],
          { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
        );
      }
      const coverBuffer = await readFile(
        /* turbopackIgnore: true */ coverPath,
      );
      if (!coverBuffer.length) {
        throw new Error("Pinterest n'a pas pu générer l'image de couverture.");
      }
      const uploadedCover = await uploadPinterestCover({
        userId: params.userId,
        coverBuffer,
      });
      coverImageUrl = uploadedCover.publicUrl;
      coverStoragePath = uploadedCover.storagePath;
    }

    return {
      videoPath: finalPath,
      videoSize: finalFile.size,
      videoContentType: finalContentType,
      videoFileName: finalFileName,
      coverImageUrl,
      coverStoragePath,
    };
  }
}


export function isPinterestPinEditRestrictedError(error: unknown) {
  const rec = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const message = [
    error instanceof Error ? error.message : rec.message || error || "",
    rec.pinterestRawMessage || "",
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  const code = String(rec.pinterestCode || rec.code || "").toLowerCase();
  return (
    message.includes("pin_edit") ||
    code.includes("pin_edit") ||
    (message.includes("restricted feature") && message.includes("edit"))
  );
}

export async function createPinterestImagePin({
  accessToken,
  userId,
  boardId,
  title,
  description,
  imageUrl,
  imageUrls,
  link,
}: PinterestCreateImagePinArgs): Promise<PinterestCreatePinResult> {
  const token = String(accessToken || "").trim();
  const cleanUserId = String(userId || "").trim();
  const cleanBoardId = String(boardId || "").trim();
  const requestedImageUrls = Array.isArray(imageUrls) && imageUrls.length
    ? imageUrls
    : [imageUrl];

  if (!token)
    throw new Error("Pinterest à connecter. Rendez-vous dans Canaux.");
  if (!cleanUserId)
    throw new Error("Compte iNrCy introuvable pour préparer les images Pinterest.");
  if (!cleanBoardId)
    throw new Error("Choisissez un tableau Pinterest avant de publier.");

  const preparedImages = await preparePinterestCarouselImages({
    userId: cleanUserId,
    imageUrls: requestedImageUrls,
  });
  const mediaSource = buildPinterestImageMediaSource(preparedImages.imageUrls);

  const payload: Record<string, unknown> = {
    board_id: cleanBoardId,
    title: cleanSingleLineText(title || "Publication iNrCy", 100),
    description: cleanMultilineText(description || "", 500),
    media_source: mediaSource,
  };

  const cleanLink = normalizePublicUrl(link);
  if (cleanLink) payload.link = cleanLink;

  const json = asRecord(
    await pinterestApiRequest("/pins", token, {
      method: "POST",
      body: payload,
    }),
  );
  const id = asString(json.id) || asString(json.pin_id) || null;

  return {
    ok: true,
    id,
    url: asString(json.url) || asString(json.link) || buildPinterestPinUrl(id),
    board_id: asString(json.board_id) || cleanBoardId,
    media_type: "image",
    images_harmonized: preparedImages.harmonized,
    prepared_image_urls: preparedImages.imageUrls,
    target_width: preparedImages.targetWidth,
    target_height: preparedImages.targetHeight,
  };
}

export async function resolvePinterestVideoCoverImageUrl(params: {
  coverImageUrl?: string | null;
  coverStoragePath?: string | null;
  coverBucket?: string | null;
}) {
  const coverStoragePath = sanitizeStoragePath(params.coverStoragePath);
  const requestedBucket = String(params.coverBucket || "").trim();
  const coverBucket =
    requestedBucket &&
    !requestedBucket.includes("/") &&
    !requestedBucket.includes("\\") &&
    !requestedBucket.includes("..")
      ? requestedBucket
      : PINTEREST_COVER_BUCKET;

  // The durable registry owns both the bucket and the path. Re-sign the real
  // object on every worker invocation so a private inrcy-pro-media thumbnail
  // remains fetchable by Pinterest throughout background processing. Never
  // rebuild an inrcy-pro-media path inside the unrelated booster bucket.
  if (coverStoragePath) {
    const signedUrl = await createSafeStorageSignedUrl(
      coverBucket,
      coverStoragePath,
      PINTEREST_COVER_SIGNED_URL_TTL_SECONDS,
    );
    const cleanSignedUrl = normalizePublicUrl(signedUrl);
    if (cleanSignedUrl) return cleanSignedUrl;
  }

  // Compatibility fallback for old publications that only persisted a URL.
  return normalizePublicUrl(params.coverImageUrl);
}

export async function withPinterestVideoProtocolAsset<T>(
  params: {
    userId: string;
    videoUrl: string;
    videoStoragePath?: string | null;
    videoContentType?: string | null;
    videoFileName?: string | null;
    coverImageUrl: string;
  },
  consumeAsset: (asset: {
    videoFile: Blob;
    videoSize: number;
    videoContentType: string;
    videoFileName: string;
    coverImageUrl: string;
  }) => Promise<T>,
) {
  const cleanVideoUrl = normalizePublicUrl(params.videoUrl);
  const storagePath = sanitizeStoragePath(params.videoStoragePath);
  if (!cleanVideoUrl && !storagePath) {
    throw new Error("Pinterest nécessite une vidéo publique valide.");
  }
  const sourceFormat = inferPinterestVideoFormat({
    contentType: params.videoContentType,
    fileName: params.videoFileName,
    videoUrl: cleanVideoUrl,
  });
  const tempDir = path.join(os.tmpdir(), `inrcy-pinterest-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  try {
    const source = await downloadPinterestVideoSource({
      videoUrl: cleanVideoUrl,
      storagePath,
      destinationPath: path.join(tempDir, `source.${sourceFormat.extension}`),
    });
    const prepared = await preparePinterestVideoAsset({
      userId: String(params.userId || "").trim(),
      sourcePath: source.path,
      sourceSize: source.size,
      tempDir,
      videoUrl: cleanVideoUrl,
      videoContentType: params.videoContentType,
      videoFileName: params.videoFileName,
      // The durable route resolves this from thumbnailStoragePath before
      // registration, so preparation never creates a random replacement cover.
      coverImageUrl: params.coverImageUrl,
    });
    const videoFile = await openAsBlob(
      /* turbopackIgnore: true */ prepared.videoPath,
      {
      type: prepared.videoContentType,
      },
    );
    return await consumeAsset({
      videoFile,
      videoSize: prepared.videoSize,
      videoContentType: prepared.videoContentType,
      videoFileName: prepared.videoFileName,
      coverImageUrl: prepared.coverImageUrl,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function createPinterestVideoPin({
  accessToken,
  userId,
  boardId,
  title,
  description,
  videoUrl,
  videoStoragePath,
  videoContentType,
  videoFileName,
  coverImageUrl,
  coverStoragePath,
  coverBucket,
  link,
}: PinterestCreateVideoPinArgs): Promise<PinterestCreatePinResult> {
  const token = String(accessToken || "").trim();
  const cleanUserId = String(userId || "").trim();
  const cleanBoardId = String(boardId || "").trim();
  const cleanVideoUrl = normalizePublicUrl(videoUrl);

  if (!token) throw new Error("Pinterest à connecter. Rendez-vous dans Canaux.");
  if (!cleanUserId) throw new Error("Compte iNrCy introuvable pour Pinterest.");
  if (!cleanBoardId)
    throw new Error("Choisissez un tableau Pinterest avant de publier.");
  if (!cleanVideoUrl && !sanitizeStoragePath(videoStoragePath)) {
    throw new Error("Pinterest nécessite une vidéo publique valide.");
  }
  const cleanCoverUrl = await resolvePinterestVideoCoverImageUrl({
    coverImageUrl,
    coverStoragePath,
    coverBucket,
  });

  const sourceFormat = inferPinterestVideoFormat({
    contentType: videoContentType,
    fileName: videoFileName,
    videoUrl: cleanVideoUrl,
  });
  const tempDir = path.join(os.tmpdir(), `inrcy-pinterest-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    const source = await downloadPinterestVideoSource({
      videoUrl: cleanVideoUrl,
      storagePath: videoStoragePath,
      destinationPath: path.join(tempDir, `source.${sourceFormat.extension}`),
    });
    const prepared = await preparePinterestVideoAsset({
      userId: cleanUserId,
      sourcePath: source.path,
      sourceSize: source.size,
      tempDir,
      videoUrl: cleanVideoUrl,
      videoContentType,
      videoFileName,
      coverImageUrl: cleanCoverUrl,
    });
    const videoFile = await openAsBlob(
      /* turbopackIgnore: true */ prepared.videoPath,
      {
        type: prepared.videoContentType,
      },
    );
    const protocolResult = await publishPinterestVideoWithProtocol({
      apiBaseUrl: getPinterestApiBaseUrl(),
      accessToken: token,
      boardId: cleanBoardId,
      title: cleanSingleLineText(title || "Publication iNrCy", 100),
      description: cleanMultilineText(description || "", 500),
      link: normalizePublicUrl(link) || null,
      coverImageUrl: prepared.coverImageUrl,
      videoFile,
      videoSize: prepared.videoSize,
      videoContentType: prepared.videoContentType,
      videoFileName: prepared.videoFileName,
    });

    const json = asRecord(protocolResult.pin);
    const id = asString(json.id) || asString(json.pin_id) || null;

    return {
      ok: true,
      id,
      url: asString(json.url) || asString(json.link) || buildPinterestPinUrl(id),
      board_id: asString(json.board_id) || cleanBoardId,
      media_id: protocolResult.mediaId,
      media_status: protocolResult.mediaStatus,
      media_type: "video",
      cover_image_url: prepared.coverImageUrl,
    };
  } catch (protocolError) {
    // Pinterest does not expose an idempotency key for Create Pin. Preserve the
    // durable protocol error so the worker can checkpoint/reconcile it instead
    // of wrapping it as a generic error that a cron might replay blindly.
    if (isPinterestVideoOutcomeUnknown(protocolError)) throw protocolError;
    const source =
      protocolError instanceof Error
        ? protocolError.message
        : String(protocolError || "");
    const message =
      getProviderPublicationErrorMessage("pinterest", source) ||
      ensureFrenchPublicationErrorMessage(
        source,
        "Pinterest n'a pas pu finaliser la publication vidéo. Merci de réessayer.",
      );
    const sourceRecord =
      protocolError && typeof protocolError === "object"
        ? (protocolError as Record<string, unknown>)
        : {};
    const wrapped = new Error(message) as Error & {
      status?: number;
      pinterestCode?: string | null;
      pinterestRawMessage?: string | null;
    };
    wrapped.status = Number(sourceRecord.status || 0) || undefined;
    wrapped.pinterestCode = asString(sourceRecord.pinterestCode) || null;
    wrapped.pinterestRawMessage = source || null;
    throw wrapped;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type PinterestUpdatePinArgs = {
  accessToken: string;
  pinId: string;
  title: string;
  description?: string;
  link?: string | null;
  boardId?: string | null;
};

export async function updatePinterestPin({
  accessToken,
  pinId,
  title,
  description,
  link,
  boardId,
}: PinterestUpdatePinArgs): Promise<PinterestCreatePinResult> {
  const token = String(accessToken || "").trim();
  const cleanPinId = String(pinId || "").trim();
  if (!token)
    throw new Error("Pinterest à connecter. Rendez-vous dans Canaux.");
  if (!cleanPinId) throw new Error("Épingle Pinterest introuvable.");

  const payload: Record<string, unknown> = {
    title: cleanSingleLineText(title || "Publication iNrCy", 100),
    description: cleanMultilineText(description || "", 500),
  };

  const cleanBoardId = String(boardId || "").trim();
  if (cleanBoardId) payload.board_id = cleanBoardId;

  const cleanLink = normalizePublicUrl(link);
  payload.link = cleanLink || null;

  const json = asRecord(
    await pinterestApiRequest(
      `/pins/${encodeURIComponent(cleanPinId)}`,
      token,
      {
        method: "PATCH",
        body: payload,
      },
    ),
  );
  const id = asString(json.id) || asString(json.pin_id) || cleanPinId;

  return {
    ok: true,
    id,
    url: asString(json.url) || buildPinterestPinUrl(id),
    board_id: asString(json.board_id) || cleanBoardId || null,
  };
}

export async function deletePinterestPin(
  accessToken: string,
  pinId: string,
): Promise<void> {
  const token = String(accessToken || "").trim();
  const cleanPinId = String(pinId || "").trim();
  if (!token)
    throw new Error("Pinterest à connecter. Rendez-vous dans Canaux.");
  if (!cleanPinId) throw new Error("Épingle Pinterest introuvable.");

  try {
    await pinterestApiRequest(
      `/pins/${encodeURIComponent(cleanPinId)}`,
      token,
      { method: "DELETE" },
    );
  } catch (error) {
    const status = Number((error as Error & { status?: number })?.status || 0);
    if (status === 404) return;
    throw error;
  }
}
