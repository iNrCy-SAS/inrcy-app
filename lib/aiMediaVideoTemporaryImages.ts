import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";
import { getAiMediaVideoSegmentDurations } from "./aiMediaVideoTimeline.ts";

const BUCKET = "inrcy-pro-media";
const SIGNED_URL_SECONDS = 30 * 60;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
type TemporaryImage = { data: string; mimeType: string };
type StorageClient = {
  getBucket(bucket: string): Promise<{ data: { public: boolean } | null; error: unknown }>;
  from(bucket: string): {
    upload(path: string, body: Uint8Array, options: { contentType: string; cacheControl: string; upsert: boolean }): Promise<{ error: unknown }>;
    createSignedUrl(path: string, seconds: number): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    remove(paths: string[]): Promise<{ error: unknown }>;
  };
};
async function storageOperation<T>(operation: () => Promise<T>, failureCode: string): Promise<T> {
  try { return await operation(); }
  catch { throw new Error(failureCode); }
}

/** Private, short-lived provider inputs; only this store's freshly created objects are removed. */
export function createAiMediaVideoTemporaryImageStore(args: {
  accountId: string; storage?: StorageClient; signal?: AbortSignal; warn?: (code: string) => void;
}) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(args.accountId)) throw new Error("ai_video_input_storage_account_invalid");
  const storage = args.storage ?? supabaseAdmin.storage;
  const folder = `${args.accountId}/_provider-temp/${randomUUID()}`;
  const paths: string[] = [];
  let verifiedPrivateBucket = false;
  let sequence = 0;
  const assertPrivateBucket = async () => {
    args.signal?.throwIfAborted();
    if (verifiedPrivateBucket) return;
    const bucket = await storageOperation(() => storage.getBucket(BUCKET), "ai_video_input_storage_private_bucket_required");
    if (bucket.error || !bucket.data || bucket.data.public !== false) throw new Error("ai_video_input_storage_private_bucket_required");
    verifiedPrivateBucket = true;
  };
  return {
    assertPrivateBucket,
    async uploadImages(images: readonly TemporaryImage[]): Promise<readonly string[]> {
      args.signal?.throwIfAborted();
      if (!images.length) return [];
      // No URLs supplied by a browser are accepted; bytes already passed the Studio's sanitization.
      const prepared = images.map((image) => {
        const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/png" ? "png" : image.mimeType === "image/webp" ? "webp" : null;
        const buffer = Buffer.from(image.data, "base64");
        if (!extension || !buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("ai_video_input_storage_image_invalid");
        return { ...image, extension, buffer };
      });
      await assertPrivateBucket();
      const urls: string[] = [];
      for (const image of prepared) {
        args.signal?.throwIfAborted();
        const path = `${folder}/${sequence++}.${image.extension}`;
        const uploaded = await storageOperation(() => storage.from(BUCKET).upload(path, image.buffer, {
          contentType: image.mimeType, cacheControl: "0", upsert: false,
        }), "ai_video_input_storage_upload_failed");
        if (uploaded.error) throw new Error("ai_video_input_storage_upload_failed");
        paths.push(path);
        args.signal?.throwIfAborted();
        const signed = await storageOperation(() => storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS), "ai_video_input_storage_sign_failed");
        if (signed.error || !signed.data?.signedUrl) throw new Error("ai_video_input_storage_sign_failed");
        let url: URL;
        try { url = new URL(signed.data.signedUrl); }
        catch { throw new Error("ai_video_input_storage_url_invalid"); }
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("ai_video_input_storage_url_invalid");
        urls.push(url.toString());
      }
      return urls;
    },
    async cleanup(): Promise<void> {
      if (!paths.length) return;
      try {
        const removed = await storage.from(BUCKET).remove([...paths]);
        if (removed.error) throw new Error("cleanup_failed");
        paths.length = 0;
      } catch {
        // Signed URLs, portraits and raw storage diagnostics must never enter logs or metadata.
        (args.warn ?? ((code: string) => console.warn(code)))("ai_video_input_storage_cleanup_unavailable");
      }
    },
  };
}

/** Read-only preflight before paying for a creative first frame or a video clip. */
export async function preflightAiMediaVideoTemporaryImages(args: {
  accountId: string;
  request: Pick<AiMediaGenerationRequest, "videoEngine" | "durationSeconds" | "videoResolution" | "sceneMode" | "inspirationImages">;
  signal?: AbortSignal;
  storage?: StorageClient;
}): Promise<void> {
  const engine = args.request.videoEngine;
  if (engine !== "minimax-h3" && engine !== "wan-flash") return;
  const segments = getAiMediaVideoSegmentDurations(args.request.durationSeconds ?? 8, engine, args.request.videoResolution, args.request.sceneMode);
  const needsHostedFrame = args.request.inspirationImages.length > 0 ||
    (segments.length > 1 && args.request.sceneMode !== "multi");
  if (!needsHostedFrame) return;
  const store = createAiMediaVideoTemporaryImageStore(args);
  try { await store.assertPrivateBucket(); }
  finally { await store.cleanup(); }
}
