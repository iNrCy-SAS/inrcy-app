import "server-only";

import { requireUser } from "@/lib/requireUser";
import { normalizeImageAiPreviewBuffer } from "./mediaImageNormalizer.ts";
import { AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS, AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES, resolveAiMediaPreviewFormat } from "./aiMediaGenerationContracts.ts";

type OwnedImageRow = {
  user_id: string; media_type: string; mime_type: string | null; size_bytes: number | null;
  bucket_name: string; storage_path: string; original_file_name: string | null; is_active: boolean | null; source: string | null;
};

async function bounded<T>(work: () => PromiseLike<T>, milliseconds: number, cancel?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { cancel?.(); reject(new Error("owned_image_unavailable")); }, milliseconds);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function readImageStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  try {
    return await bounded(async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES) throw new Error("owned_image_unavailable");
        chunks.push(chunk.value);
      }
      if (size === 0) throw new Error("owned_image_unavailable");
      return Buffer.concat(chunks, size);
    }, 8_000, cancel);
  } catch (error) { cancel(); throw error; }
  finally { reader.releaseLock(); }
}

/** Fixed authenticated Storage lookup. Neither URLs nor buckets come from AI. */
export async function loadInrAssistantImageReference(mediaId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mediaId)) throw new Error("invalid_media");
  const auth = await bounded(() => requireUser(), 5_000);
  if (auth.errorResponse) throw new Error("unauthenticated_media");
  const controller = new AbortController();
  const { data, error } = await bounded<{ data: OwnedImageRow | null; error: unknown }>(() => auth.supabase.from("pro_media_library")
    .select("id,user_id,media_type,mime_type,size_bytes,bucket_name,storage_path,original_file_name,is_active,source")
    .eq("id", mediaId).eq("user_id", auth.activeUserId).abortSignal(controller.signal).maybeSingle(), 5_000, () => controller.abort());
  if (error || !data || data.user_id !== auth.activeUserId || data.media_type !== "image" || data.is_active !== true || data.source === "ai_media_generation_draft" ||
    !Number.isSafeInteger(Number(data.size_bytes)) || Number(data.size_bytes) <= 0 || Number(data.size_bytes) > AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES ||
    data.bucket_name !== "inrcy-pro-media" || typeof data.storage_path !== "string" || !data.storage_path.startsWith(`users/${auth.activeUserId}/`) ||
    data.storage_path.includes("..") || data.storage_path.includes("\\")) throw new Error("owned_image_unavailable");
  // This installed Storage SDK has no download AbortSignal option. Its stream
  // API avoids buffering an oversized response; cancel the reader at our cap.
  let downloadExpired = false;
  const downloading = Promise.resolve(auth.supabase.storage.from("inrcy-pro-media").download(data.storage_path).asStream()).then(result => {
    if (downloadExpired && result.data) void result.data.cancel().catch(() => undefined);
    return result;
  });
  const downloaded = await bounded(() => downloading, 8_000, () => { downloadExpired = true; });
  if (downloaded.error || !downloaded.data) throw new Error("owned_image_unavailable");
  const buffer = await readImageStream(downloaded.data);
  const normalized = await bounded(() => normalizeImageAiPreviewBuffer({ buffer, mimeType: data.mime_type ?? "", originalFileName: data.original_file_name }), 15_000);
  const encoded = normalized.aiPreview.buffer.toString("base64");
  if (encoded.length > AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS) throw new Error("image_reference_too_large");
  return { reference: { mimeType: normalized.aiPreview.mimeType, data: encoded, role: "inspiration" as const, usage: "required" as const },
    width: normalized.source.width, height: normalized.source.height,
    format: resolveAiMediaPreviewFormat({ width: normalized.source.width, height: normalized.source.height, fallback: "square" }) };
}
