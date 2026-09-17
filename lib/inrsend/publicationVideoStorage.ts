import "server-only";

import { authorizeStoredVideoProbeSource } from "@/lib/boosterStoredVideoProbePolicy";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  resolveInrSendVideoDeliveryUrl,
  type InrSendVideoRegistryIdentity,
} from "@/lib/inrsend/publicationVideoStoragePolicy";

const VIDEO_DELIVERY_URL_TTL_SECONDS = 60 * 60 * 24;

async function loadOwnedUploadedVideoRegistryRow(params: {
  accountId: string;
  bucket: string;
  storagePath: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("pro_media_library")
    .select("user_id,bucket_name,storage_path,media_type,upload_status")
    .eq("user_id", params.accountId)
    .eq("bucket_name", params.bucket)
    .eq("storage_path", params.storagePath)
    .eq("media_type", "video")
    .eq("upload_status", "uploaded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as InrSendVideoRegistryIdentity | null) || null;
}

export async function refreshInrSendPublicationVideoUrl(params: {
  accountId: string;
  bucket?: unknown;
  storagePath?: unknown;
  currentUrl?: unknown;
}) {
  return resolveInrSendVideoDeliveryUrl(params, {
    loadRegistryRow: loadOwnedUploadedVideoRegistryRow,
    authorizeSource: authorizeStoredVideoProbeSource,
    signAuthorizedUrl: (bucket, storagePath) =>
      createSafeStorageSignedUrl(
        bucket,
        storagePath,
        VIDEO_DELIVERY_URL_TTL_SECONDS,
      ),
    getPublicUrl: (bucket, storagePath) =>
      supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl || null,
  });
}
