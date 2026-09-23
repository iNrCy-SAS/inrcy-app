"use client";

import type { MediaGenerationInspirationImage } from "@/app/dashboard/_hooks/useMediaGeneration";
import {
  AI_MEDIA_INSPIRATION_MAX_DIMENSION,
  AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS,
  AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES,
  AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES,
} from "@/lib/aiMediaGenerationContracts";
import {
  INR_MEDIA_IMAGE_FORMATS_LABEL,
  INR_MEDIA_IMAGE_MAX_MB_LABEL,
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL,
  isInrMediaVideoFile,
  isInrMediaImageFile,
} from "@/lib/mediaRules";
import { uploadUniversalMediaFile } from "@/lib/universalMediaUploadClient";

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error("L’image d’inspiration n’a pas pu être préparée.")
            ),
      "image/jpeg",
      quality
    );
  });
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("L’image d’inspiration n’a pas pu être lue."));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const separator = value.indexOf(",");
      if (separator < 0) {
        reject(new Error("L’image d’inspiration est invalide."));
        return;
      }
      resolve(value.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function prepareInspirationImageInBrowser(
  file: File
): Promise<MediaGenerationInspirationImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("L’image d’inspiration est illisible."));
      image.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("L’image d’inspiration est illisible.");
    }

    let scale = Math.min(
      1,
      AI_MEDIA_INSPIRATION_MAX_DIMENSION /
        Math.max(image.naturalWidth, image.naturalHeight)
    );
    let output: Blob | null = null;
    for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context)
        throw new Error("L’image d’inspiration n’a pas pu être préparée.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      for (const quality of [0.88, 0.78, 0.68]) {
        const candidate = await canvasBlob(canvas, quality);
        if (candidate.size <= AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES) {
          output = candidate;
          break;
        }
      }
      if (output) break;
      scale *= 0.78;
    }
    if (!output) {
      throw new Error("L’image reste trop volumineuse après optimisation.");
    }
    return {
      mimeType: "image/jpeg",
      data: await blobBase64(output),
      name: file.name.slice(0, 120) || "inspiration.jpg",
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function discardTransientInspirationImage(storagePath: string) {
  if (!storagePath) return;
  await fetch("/api/media-generation/normalize-reference", {
    method: "DELETE",
    credentials: "include",
    cache: "no-store",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storagePath }),
  }).catch(() => undefined);
}

async function prepareInspirationImageOnServer(
  file: File
): Promise<MediaGenerationInspirationImage> {
  const uploaded = await uploadUniversalMediaFile(file, {
    target: "ai_identity_reference",
    requestedFolder: "studio-identity-reference",
    source: "studio",
  });
  const storagePath = String(uploaded.storagePath || "");
  if (!storagePath) {
    throw new Error("La conversion de cette image n’a pas pu démarrer.");
  }

  try {
    const response = await fetch("/api/media-generation/normalize-reference", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storagePath,
        fileName: file.name,
        mimeType: uploaded.contentType || file.type,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        String(
          payload?.error ||
            "Cette image n’a pas pu être convertie automatiquement."
        )
      );
    }
    const image = payload?.image;
    const data = typeof image?.data === "string" ? image.data.trim() : "";
    if (
      image?.mimeType !== "image/jpeg" ||
      data.length < 64 ||
      data.length > AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    ) {
      throw new Error("L’image convertie est invalide.");
    }
    return {
      mimeType: "image/jpeg",
      data,
      name:
        typeof image?.name === "string" && image.name.trim()
          ? image.name.trim().slice(0, 120)
          : `${
              file.name.replace(/\.[^.]+$/, "").slice(0, 110) || "reference"
            }.jpg`,
    };
  } catch (error) {
    await discardTransientInspirationImage(storagePath);
    throw error;
  }
}

export async function prepareMediaGenerationImageReference(
  file: File
): Promise<MediaGenerationInspirationImage> {
  if (!isInrMediaImageFile(file)) {
    throw new Error(`Formats acceptés : ${INR_MEDIA_IMAGE_FORMATS_LABEL}.`);
  }
  if (!file.size || file.size > AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES) {
    throw new Error(
      `L’image d’inspiration doit peser moins de ${INR_MEDIA_IMAGE_MAX_MB_LABEL}.`
    );
  }

  try {
    return await prepareInspirationImageInBrowser(file);
  } catch {
    // HEIC/HEIF/TIFF et certains AVIF/BMP ne sont pas décodables par tous les
    // navigateurs. Le binaire va directement dans Storage, est converti par le
    // normaliseur commun à Booster, puis supprimé avant le retour au client.
    return await prepareInspirationImageOnServer(file);
  }
}

/**
 * Modifier accepte aussi une vidéo source. L’API de génération utilise un
 * cadre image comme référence ; on extrait donc proprement la première image
 * décodable de la vidéo et on la soumet au même normaliseur que les images.
 */
export async function prepareVideoReferenceFrame(
  file: File
): Promise<MediaGenerationInspirationImage> {
  if (!isInrMediaVideoFile(file)) {
    throw new Error("Formats vidéo acceptés : MP4, M4V ou MOV.");
  }
  if (!file.size || file.size > INR_MEDIA_VIDEO_SOURCE_MAX_BYTES) {
    throw new Error(
      `La vidéo source doit peser moins de ${INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL}.`
    );
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("La vidéo source est illisible."));
    });
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("La vidéo source est illisible.");
    }
    const targetTime = Number.isFinite(video.duration)
      ? Math.min(Math.max(0, video.duration / 2), 1)
      : 0;
    if (targetTime > 0) {
      video.currentTime = targetTime;
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () =>
          reject(new Error("La vidéo source est illisible."));
      });
    }
    const scale = Math.min(
      1,
      AI_MEDIA_INSPIRATION_MAX_DIMENSION /
        Math.max(video.videoWidth, video.videoHeight)
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("La vidéo source n’a pas pu être préparée.");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const output = await canvasBlob(canvas, 0.86);
    if (output.size > AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES) {
      throw new Error("La première image de la vidéo reste trop volumineuse.");
    }
    return {
      mimeType: "image/jpeg",
      data: await blobBase64(output),
      name: `${
        file.name.replace(/\.[^.]+$/, "").slice(0, 110) || "video"
      }-frame.jpg`,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
