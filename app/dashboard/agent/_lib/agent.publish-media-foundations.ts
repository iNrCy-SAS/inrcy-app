import type { MediaLibraryPickerItem } from "@/app/dashboard/_components/MediaLibraryPickerModal";
import {
  getMediaImageInteractions,
  withMediaImageInteractions,
} from "../../../../lib/imageInteractions.ts";
import type { AgentMediaLibraryItem } from "./agent.types";

export function readAgentImageFileInfo(
  file: File,
): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        width: img.naturalWidth || img.width || null,
        height: img.naturalHeight || img.height || null,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: null, height: null });
    };
    img.src = objectUrl;
  });
}

export function readAgentVideoFileInfo(file: File): Promise<{
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        width: video.videoWidth || null,
        height: video.videoHeight || null,
        duration_seconds:
          Number.isFinite(video.duration) && video.duration > 0
            ? Math.round(video.duration * 100) / 100
            : null,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: null, height: null, duration_seconds: null });
    };
    video.src = objectUrl;
  });
}

export async function readAgentMediaFileInfo(
  file: File,
  mediaKind: "image" | "video",
): Promise<{
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}> {
  if (mediaKind === "video") return readAgentVideoFileInfo(file);
  const dimensions = await readAgentImageFileInfo(file);
  return { ...dimensions, duration_seconds: null };
}

export async function readAgentApiJson(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await response.json().catch(() => ({ error: fallbackMessage }));
  }
  const text = await response.text().catch(() => "");
  return { error: text.trim() || fallbackMessage };
}

export function mediaPatchFromLibraryItem(
  item: AgentMediaLibraryItem | MediaLibraryPickerItem,
) {
  const imageInteractions =
    item.media_type === "image" ? getMediaImageInteractions(item) : undefined;
  const imageMeta =
    item.media_type === "image"
      ? withMediaImageInteractions(
          item.width && item.height
            ? {
                width: item.width,
                height: item.height,
                ratio: item.width / item.height,
              }
            : {},
          item,
        )
      : null;
  return {
    id: item.id,
    bucket: item.bucket_name || "inrcy-pro-media",
    bucketName: item.bucket_name || "inrcy-pro-media",
    path: item.storage_path,
    storagePath: item.storage_path,
    publicUrl: item.signed_url || "",
    url: item.signed_url || "",
    name:
      item.title ||
      item.storage_path.split("/").pop() ||
      (item.media_type === "video" ? "Vidéo" : "Image"),
    title: item.title || "",
    type:
      item.mime_type ||
      (item.media_type === "video" ? "video/mp4" : "image/jpeg"),
    mimeType:
      item.mime_type ||
      (item.media_type === "video" ? "video/mp4" : "image/jpeg"),
    size: item.size_bytes || 0,
    width: item.width || null,
    height: item.height || null,
    duration: item.duration_seconds || null,
    duration_seconds: item.duration_seconds || null,
    kind: item.media_type,
    mediaType: item.media_type,
    source: "pro_media_library",
    ...(imageMeta && Object.keys(imageMeta).length ? { imageMeta } : {}),
    ...(imageInteractions ? { image_interactions: imageInteractions } : {}),
  };
}
