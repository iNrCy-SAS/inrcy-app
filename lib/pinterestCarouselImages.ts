import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  BOOSTER_AUTO_CROP_MAX_LOSS,
  getImageCropLossFraction,
} from "@/lib/boosterImageDecision";
import {
  buildPinterestCarouselGeometryPlan,
  type PinterestImageMetadataLike,
} from "@/lib/pinterestCarouselPolicy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { toExactStorageArrayBuffer } from "@/lib/supabaseStorageBinary";

const PINTEREST_CAROUSEL_PIPELINE_VERSION = 1;
const PINTEREST_CAROUSEL_BUCKET = "booster";
const PINTEREST_IMAGE_DOWNLOAD_TIMEOUT_MS = 20_000;
const PINTEREST_IMAGE_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const PINTEREST_IMAGE_MAX_INPUT_PIXELS = 100_000_000;
const PINTEREST_BACKGROUND = { r: 0, g: 0, b: 0, alpha: 1 } as const;

export type PinterestCarouselImagePreparation = {
  imageUrls: string[];
  harmonized: boolean;
  reason: "single_image" | "already_uniform" | "mixed_ratios" | "first_image_too_tall";
  targetWidth: number | null;
  targetHeight: number | null;
  requestedCount: number;
  preparedCount: number;
  rejectedImages: Array<{
    index: number;
    url: string;
    stage: "validation" | "download" | "render" | "upload";
    error: string;
  }>;
};

function normalizePublicImageUrl(value: unknown): string {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    return new URL(raw).toString();
  } catch {
    return "";
  }
}

function safeStorageSegment(value: unknown, fallback: string): string {
  const clean = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return clean || fallback;
}

function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function downloadPinterestImage(
  imageUrl: string,
  index: number,
): Promise<{ buffer: Buffer; metadata: PinterestImageMetadataLike }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PINTEREST_IMAGE_DOWNLOAD_TIMEOUT_MS,
  );

  try {
    const response = await fetch(imageUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "image/*" },
    });
    if (!response.ok) {
      throw new Error(
        `Pinterest n’a pas pu récupérer l’image ${index + 1} (${response.status}).`,
      );
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > PINTEREST_IMAGE_MAX_DOWNLOAD_BYTES
    ) {
      throw new Error(
        `L’image Pinterest ${index + 1} est trop volumineuse pour être préparée.`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new Error(`L’image Pinterest ${index + 1} est vide ou illisible.`);
    }
    if (buffer.length > PINTEREST_IMAGE_MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `L’image Pinterest ${index + 1} est trop volumineuse pour être préparée.`,
      );
    }

    const metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: PINTEREST_IMAGE_MAX_INPUT_PIXELS,
      pages: 1,
      sequentialRead: true,
    }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error(
        `Impossible de lire les dimensions de l’image Pinterest ${index + 1}.`,
      );
    }

    return {
      buffer,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Le chargement de l’image Pinterest ${index + 1} a pris trop de temps.`,
      );
    }
    if (error instanceof Error && /Pinterest|image Pinterest/i.test(error.message)) {
      throw error;
    }
    throw new Error(
      `Pinterest n’a pas pu préparer l’image ${index + 1}. Vérifiez qu’elle reste publique et accessible.`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function renderPinterestCarouselImage(params: {
  buffer: Buffer;
  sourceRatio: number;
  targetRatio: number;
  targetWidth: number;
  targetHeight: number;
}): Promise<Buffer> {
  const cropLoss = getImageCropLossFraction(
    params.sourceRatio,
    params.targetRatio,
  );
  const fit =
    cropLoss <= BOOSTER_AUTO_CROP_MAX_LOSS ? ("cover" as const) : ("contain" as const);

  return sharp(params.buffer, {
    failOn: "error",
    limitInputPixels: PINTEREST_IMAGE_MAX_INPUT_PIXELS,
    pages: 1,
    sequentialRead: true,
  })
    .rotate()
    .resize({
      width: params.targetWidth,
      height: params.targetHeight,
      fit,
      position: "centre",
      background: PINTEREST_BACKGROUND,
      withoutEnlargement: false,
      fastShrinkOnLoad: true,
    })
    .toColourspace("srgb")
    .flatten({ background: PINTEREST_BACKGROUND })
    .jpeg({
      quality: 88,
      mozjpeg: true,
      progressive: true,
      chromaSubsampling: "4:2:0",
      optimiseScans: true,
    })
    .toBuffer();
}

async function uploadPinterestCarouselImages(params: {
  userId: string;
  buffers: Buffer[];
  targetWidth: number;
  targetHeight: number;
  sourceIndexes?: number[];
}): Promise<{
  imageUrls: string[];
  failures: Array<{
    index: number;
    url: string;
    stage: "upload";
    error: string;
  }>;
}> {
  const userSegment = safeStorageSegment(params.userId, "compte");
  const outputHashes = params.buffers.map((buffer) => sha256(buffer));
  const setHash = sha256(
    [
      `v${PINTEREST_CAROUSEL_PIPELINE_VERSION}`,
      `${params.targetWidth}x${params.targetHeight}`,
      ...outputHashes,
    ].join(":"),
  ).slice(0, 32);

  const settled = await Promise.allSettled(
    params.buffers.map(async (buffer, index) => {
      const storagePath = `${userSegment}/pinterest/carousel-v${PINTEREST_CAROUSEL_PIPELINE_VERSION}/${setHash}/image-${index + 1}.jpg`;
      const upload = await supabaseAdmin.storage
        .from(PINTEREST_CAROUSEL_BUCKET)
        .upload(storagePath, toExactStorageArrayBuffer(buffer), {
          contentType: "image/jpeg",
          cacheControl: "31536000",
          upsert: true,
        });
      if (upload.error) {
        throw new Error(
          `Pinterest n’a pas pu enregistrer l’image harmonisée ${index + 1}.`,
        );
      }

      const publicUrl = String(
        supabaseAdmin.storage
          .from(PINTEREST_CAROUSEL_BUCKET)
          .getPublicUrl(storagePath).data.publicUrl || "",
      ).trim();
      if (!publicUrl) {
        throw new Error(
          `Pinterest n’a pas pu obtenir l’URL publique de l’image harmonisée ${index + 1}.`,
        );
      }
      return {
        index: params.sourceIndexes?.[index] ?? index,
        publicUrl,
      };
    }),
  );
  const imageUrls: string[] = [];
  const failures: Array<{
    index: number;
    url: string;
    stage: "upload";
    error: string;
  }> = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      imageUrls.push(result.value.publicUrl);
      return;
    }
    failures.push({
      index: params.sourceIndexes?.[index] ?? index,
      url: "",
      stage: "upload",
      error:
        result.reason instanceof Error
          ? result.reason.message
          : "Pinterest n’a pas pu enregistrer cette image harmonisée.",
    });
  });
  return { imageUrls, failures };
}

/**
 * Ultimate Pinterest safety net shared by Booster, iNrAgent, scheduled sends,
 * retries and iNrSend edits. Originals are kept when their ratios are already
 * identical. Mixed carousels are rendered on one exact canvas, with a light
 * crop only below the existing 8% safety threshold and otherwise a solid
 * black frame. No blurred background is ever generated.
 */
export async function preparePinterestCarouselImages(params: {
  userId: string;
  imageUrls: readonly unknown[];
}): Promise<PinterestCarouselImagePreparation> {
  const requestedImageUrls = params.imageUrls
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (!requestedImageUrls.length) {
    throw new Error("Pinterest nécessite au moins 1 image publique valide.");
  }
  if (requestedImageUrls.length > 5) {
    throw new Error("Pinterest accepte au maximum 5 images par épingle.");
  }

  const rejectedImages: PinterestCarouselImagePreparation["rejectedImages"] = [];
  const candidates = requestedImageUrls
    .map((rawUrl, index) => ({
      index,
      rawUrl,
      imageUrl: normalizePublicImageUrl(rawUrl),
    }))
    .filter((entry) => {
      if (entry.imageUrl) return true;
      rejectedImages.push({
        index: entry.index,
        url: entry.rawUrl,
        stage: "validation",
        error: "Pinterest nécessite une image publique valide.",
      });
      return false;
    });
  if (!candidates.length) {
    throw new Error("Pinterest nécessite au moins 1 image publique valide.");
  }

  const downloaded: Array<
    Awaited<ReturnType<typeof downloadPinterestImage>> & {
      index: number;
      imageUrl: string;
    }
  > = [];
  for (const candidate of candidates) {
    try {
      downloaded.push({
        ...(await downloadPinterestImage(
          candidate.imageUrl,
          candidate.index,
        )),
        index: candidate.index,
        imageUrl: candidate.imageUrl,
      });
    } catch (error) {
      rejectedImages.push({
        index: candidate.index,
        url: candidate.imageUrl,
        stage: "download",
        error:
          error instanceof Error
            ? error.message
            : "Pinterest n’a pas pu préparer cette image.",
      });
    }
  }

  if (!downloaded.length) {
    throw new Error(
      rejectedImages[0]?.error ||
        "Pinterest n’a pu préparer aucune des images demandées.",
    );
  }
  if (downloaded.length === 1) {
    return {
      imageUrls: [downloaded[0].imageUrl],
      harmonized: false,
      reason: "single_image",
      targetWidth: null,
      targetHeight: null,
      requestedCount: requestedImageUrls.length,
      preparedCount: 1,
      rejectedImages,
    };
  }

  const plan = buildPinterestCarouselGeometryPlan(
    downloaded.map((image) => image.metadata),
  );

  if (!plan.harmonize || !plan.targetRatio || !plan.targetWidth || !plan.targetHeight) {
    return {
      imageUrls: downloaded.map((image) => image.imageUrl),
      harmonized: false,
      reason: plan.reason,
      targetWidth: null,
      targetHeight: null,
      requestedCount: requestedImageUrls.length,
      preparedCount: downloaded.length,
      rejectedImages,
    };
  }

  const rendered: Array<{ buffer: Buffer; sourceIndex: number }> = [];
  for (let index = 0; index < downloaded.length; index += 1) {
    const image = downloaded[index];
    try {
      rendered.push({
        buffer: await renderPinterestCarouselImage({
          buffer: image.buffer,
          sourceRatio: plan.geometries[index].ratio,
          targetRatio: plan.targetRatio!,
          targetWidth: plan.targetWidth!,
          targetHeight: plan.targetHeight!,
        }),
        sourceIndex: image.index,
      });
    } catch (error) {
      rejectedImages.push({
        index: image.index,
        url: image.imageUrl,
        stage: "render",
        error:
          error instanceof Error
            ? error.message
            : "Pinterest n’a pas pu harmoniser cette image.",
      });
    }
  }
  if (!rendered.length) {
    throw new Error("Pinterest n’a pu harmoniser aucune des images demandées.");
  }
  const uploaded = await uploadPinterestCarouselImages({
    userId: params.userId,
    buffers: rendered.map((image) => image.buffer),
    sourceIndexes: rendered.map((image) => image.sourceIndex),
    targetWidth: plan.targetWidth,
    targetHeight: plan.targetHeight,
  });
  rejectedImages.push(...uploaded.failures);
  if (!uploaded.imageUrls.length) {
    throw new Error(
      uploaded.failures[0]?.error ||
        "Pinterest n’a pu enregistrer aucune des images harmonisées.",
    );
  }

  return {
    imageUrls: uploaded.imageUrls,
    harmonized: true,
    reason: uploaded.imageUrls.length === 1 ? "single_image" : plan.reason,
    targetWidth: plan.targetWidth,
    targetHeight: plan.targetHeight,
    requestedCount: requestedImageUrls.length,
    preparedCount: uploaded.imageUrls.length,
    rejectedImages,
  };
}
