"use client";

import { uploadUniversalMediaFile } from "@/lib/universalMediaUploadClient";

/** Fallback for a source the browser cannot decode. The original File is retained by the caller. */
export async function prepareMediaImageEditMaster(file: File) {
  const uploaded = await uploadUniversalMediaFile(file, {
    target: "ai_identity_reference",
    requestedFolder: "studio-identity-reference",
    source: "studio",
  });
  const storagePath = String(uploaded.storagePath || "");
  if (!storagePath) throw new Error("La conversion de cette image n’a pas pu démarrer.");
  try {
    const response = await fetch("/api/media-generation/normalize-reference", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storagePath, fileName: file.name, mimeType: uploaded.contentType || file.type, purpose: "edit_master" }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || "Cette image n’a pas pu être convertie.");
    }
    const blob = await response.blob();
    const width = Number(response.headers.get("X-Image-Source-Width"));
    const height = Number(response.headers.get("X-Image-Source-Height"));
    const masterWidth = Number(response.headers.get("X-Image-Master-Width"));
    const masterHeight = Number(response.headers.get("X-Image-Master-Height"));
    if (blob.type !== "image/png" || !blob.size || ![width, height, masterWidth, masterHeight].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error("La copie de travail de cette image est invalide.");
    }
    return {
      file: new File([blob], `${file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "image-source"}-master.png`, { type: blob.type, lastModified: file.lastModified }),
      width,
      height,
      masterWidth,
      masterHeight,
      hasAlpha: response.headers.get("X-Image-Source-Has-Alpha") === "true",
    };
  } catch (error) {
    await fetch("/api/media-generation/normalize-reference", {
      method: "DELETE", credentials: "include", cache: "no-store", keepalive: true,
      headers: { "content-type": "application/json" }, body: JSON.stringify({ storagePath }),
    }).catch(() => undefined);
    throw error;
  }
}
