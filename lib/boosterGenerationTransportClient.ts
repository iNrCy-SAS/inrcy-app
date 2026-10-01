import type { BoosterPdfAttachmentRef } from "./boosterPdfAttachmentPolicy.ts";

type BoosterBinaryImagePayload = {
  name?: string;
  type?: string;
  dataUrl: string;
  [key: string]: unknown;
};

type BoosterGenerationPayload = Record<string, unknown> & {
  imagesForAI?: BoosterBinaryImagePayload[];
  videoForAI?: (Record<string, unknown> & {
    visualFrames?: BoosterBinaryImagePayload[];
  }) | null;
  documentForAI?: BoosterPdfAttachmentRef | null;
};

export type BoosterGenerationRequestTransport = "json" | "multipart";

export type BoosterGenerationRequest = {
  body: BodyInit;
  headers?: HeadersInit;
  transport: BoosterGenerationRequestTransport;
};

const BOOSTER_GENERATION_MULTIPART_VERSION = "1";
const DATA_URL_RE =
  /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

function sanitizeMultipartFileName(value: unknown, fallback: string) {
  const normalized = String(value || "")
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "-")
    .trim()
    .slice(0, 120);
  return normalized || fallback;
}

function stripBinaryData<T extends BoosterBinaryImagePayload>(payload: T) {
  const { dataUrl: _dataUrl, ...metadata } = payload;
  return metadata;
}

function dataUrlToBlob(payload: BoosterBinaryImagePayload): Blob {
  if (
    typeof Blob !== "function" ||
    typeof atob !== "function" ||
    typeof payload.dataUrl !== "string"
  ) {
    throw new Error("Transport binaire indisponible.");
  }

  const match = DATA_URL_RE.exec(payload.dataUrl.trim());
  if (!match) throw new Error("Image IA invalide.");

  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function buildMultipartBody(payload: BoosterGenerationPayload): FormData {
  if (typeof FormData !== "function") {
    throw new Error("FormData indisponible.");
  }

  const images = Array.isArray(payload.imagesForAI)
    ? payload.imagesForAI
    : [];
  const video =
    payload.videoForAI && typeof payload.videoForAI === "object"
      ? payload.videoForAI
      : null;
  const frames = Array.isArray(video?.visualFrames) ? video.visualFrames : [];

  const metadataPayload: Record<string, unknown> = {
    ...payload,
    imagesForAI: images.map(stripBinaryData),
    videoForAI: video
      ? {
          ...video,
          visualFrames: frames.map(stripBinaryData),
        }
      : null,
  };

  const formData = new FormData();
  formData.append("transportVersion", BOOSTER_GENERATION_MULTIPART_VERSION);
  formData.append("payload", JSON.stringify(metadataPayload));

  images.forEach((image, index) => {
    const blob = dataUrlToBlob(image);
    formData.append(
      `aiImage${index}`,
      blob,
      sanitizeMultipartFileName(image.name, `image-${index + 1}.jpg`),
    );
  });

  frames.forEach((frame, index) => {
    const blob = dataUrlToBlob(frame);
    formData.append(
      `videoFrame${index}`,
      blob,
      sanitizeMultipartFileName(frame.name, `video-frame-${index + 1}.jpg`),
    );
  });

  return formData;
}

export function buildBoosterGenerationRequest(
  payload: BoosterGenerationPayload,
): BoosterGenerationRequest {
  const images = Array.isArray(payload.imagesForAI)
    ? payload.imagesForAI
    : [];
  const frames = Array.isArray(payload.videoForAI?.visualFrames)
    ? payload.videoForAI.visualFrames
    : [];
  const hasBinaryMedia = images.length > 0 || frames.length > 0;

  if (hasBinaryMedia) {
    try {
      return {
        body: buildMultipartBody(payload),
        transport: "multipart",
      };
    } catch (error) {
      // Le JSON Base64 historique reste le fallback intégral si le navigateur
      // ne sait pas préparer FormData ou si une donnée locale est illisible.
      console.warn("[booster-generate] fallback transport JSON", {
        message:
          error instanceof Error ? error.message : String(error || "Erreur"),
      });
    }
  }

  return {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    transport: "json",
  };
}
