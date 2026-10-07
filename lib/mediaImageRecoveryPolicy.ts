export const JPEG_RECOVERY_REPLAY_VERSION = 1;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** A recovered derivative is safe to consume; its damaged original is not. */
export function imageSourceRequiresCanonical(source: unknown) {
  const proof = record(source);
  return proof.requiresCanonical === true ||
    record(proof.recovery).kind === "truncated_jpeg";
}

export function isLegacyTruncatedJpegMessage(value: unknown) {
  // Historical worker errors collapsed repeated libvips lines into spaces.
  return /^(?:(?:VipsJpeg:\s*)?(?:premature end of JPEG image|Corrupt JPEG data: premature end of data segment)\s*)+$/i.test(String(value || "").trim());
}

export function getImageRecoveryFailure(error: unknown) {
  const details = record(error);
  const message = error instanceof Error ? error.message : String(details.message || error || "");
  const code = String(details.code || message);
  if (code === "image_recovery_source_too_large") {
    return {
      code,
      message: "Cette image JPEG est incomplète et trop volumineuse pour être récupérée. Réimportez le fichier original complet.",
    };
  }
  if (code === "image_recovery_failed" || isLegacyTruncatedJpegMessage(message)) {
    return {
      code: "image_recovery_failed",
      message: "Cette image JPEG est incomplète et n’a pas pu être récupérée. Réimportez le fichier original complet.",
    };
  }
  return null;
}

export function canReplayLegacyTruncatedJpeg(row: Record<string, unknown>) {
  const metadata = record(row.media_metadata);
  const mime = String(row.detected_mime_type || row.mime_type || "").toLowerCase().split(";")[0].trim();
  const name = String(row.original_file_name || "");
  const accountId = String(row.user_id || "");
  const sourcePath = String(row.storage_path || "");
  const ownedSource = accountId && [
    `users/${accountId}/workspace-source/`,
    `users/${accountId}/image/`,
    `users/${accountId}/ai-generated/image/`,
  ].some((prefix) => sourcePath.startsWith(prefix));
  return Boolean(
    row.media_type === "image" && row.upload_status === "uploaded" &&
    row.processing_status === "failed_terminal" &&
    row.bucket_name === "inrcy-pro-media" && ownedSource &&
    (mime === "image/jpeg" || /\.jpe?g$/i.test(name)) &&
    ["image_worker_temporary_failure", "image_decode_failed"].includes(String(row.processing_error_code || "")) &&
    isLegacyTruncatedJpegMessage(row.processing_error_message) &&
    Number(record(metadata.jpeg_recovery_replay).version || 0) < JPEG_RECOVERY_REPLAY_VERSION
  );
}

/** The timestamp compare-and-set grants at most one replay for this version. */
export async function claimLegacyTruncatedJpegReplay(params: {
  supabase: any;
  accountId: string;
  mediaId: string;
  workspaceId: string;
}) {
  if (!params.accountId || !params.mediaId || !params.workspaceId) return false;
  const linked = await params.supabase.from("publication_workspace_media")
    .select("media_id,publication_workspaces!inner(account_id)")
    .eq("workspace_id", params.workspaceId).eq("media_id", params.mediaId)
    .eq("publication_workspaces.account_id", params.accountId).maybeSingle();
  if (linked.error) throw linked.error;
  if (!linked.data) return false;

  const current = await params.supabase.from("pro_media_library")
    .select("id,user_id,media_type,bucket_name,storage_path,mime_type,detected_mime_type,original_file_name,upload_status,processing_status,processing_error_code,processing_error_message,media_metadata,updated_at")
    .eq("id", params.mediaId).eq("user_id", params.accountId).maybeSingle();
  if (current.error) throw current.error;
  const row = current.data;
  if (!row || !row.updated_at || !canReplayLegacyTruncatedJpeg(row)) return false;

  const claimed = await params.supabase.from("pro_media_library").update({
    processing_status: "not_requested",
    publication_status: "not_requested",
    processing_progress: 0,
    processing_error_code: null,
    processing_error_message: null,
    processing_completed_at: null,
    media_metadata: {
      ...record(row.media_metadata),
      pipeline_mission: "publication_preparation",
      preparation_scope: "publication_preparation",
      jpeg_recovery_replay: {
        version: JPEG_RECOVERY_REPLAY_VERSION,
        attempted_at: new Date().toISOString(),
        previous_error_code: row.processing_error_code,
      },
    },
  }).eq("id", params.mediaId).eq("user_id", params.accountId)
    .eq("processing_status", "failed_terminal").eq("updated_at", row.updated_at).select("id");
  if (claimed.error) throw claimed.error;
  return Boolean(claimed.data?.length);
}

export function isCompleteSourcePreviewDownload(params: {
  status: number;
  contentRange: string | null;
  expectedBytes: number;
  actualBytes: number;
}) {
  return params.status === 200 && !params.contentRange &&
    params.expectedBytes > 0 && params.actualBytes === params.expectedBytes;
}

export function mergeCompletedImageNormalizationMetadata(params: {
  metadata: unknown;
  source: Record<string, unknown>;
  variants: Record<string, unknown>;
  sourceDecoded: boolean;
  pipelineVersion: number;
  mission: string;
  completedAt: string;
}): Record<string, unknown> {
  const metadata = record(params.metadata);
  const previous = record(metadata.image_normalization);
  const previousSource = record(previous.source);
  const preserveRecovery = imageSourceRequiresCanonical(previousSource) &&
    !imageSourceRequiresCanonical(params.source);
  // No generated output means metadata probing alone did not validate the scan.
  const source = preserveRecovery || (!params.sourceDecoded && Object.keys(previousSource).length)
    ? previousSource
    : params.sourceDecoded ? params.source : { ...params.source, requiresCanonical: true };
  return {
    ...metadata,
    image_normalization: {
      ...previous,
      version: params.pipelineVersion,
      source,
      variants: { ...record(previous.variants), ...params.variants },
      last_mission: params.mission,
      completed_at: params.completedAt,
    },
  };
}

/** All image writers must merge metadata from the same revision they update. */
export async function persistOwnedImageMediaUpdate(params: {
  supabase: any;
  accountId: string;
  mediaId: string;
  buildPatch: (current: Record<string, unknown>) => Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await params.supabase.from("pro_media_library")
      .select("media_metadata,updated_at,publication_status")
      .eq("id", params.mediaId).eq("user_id", params.accountId).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data?.updated_at) throw new Error("image_media_missing");
    const patch = params.buildPatch(current.data);
    const updated = await params.supabase.from("pro_media_library").update(patch)
      .eq("id", params.mediaId).eq("user_id", params.accountId)
      .eq("updated_at", current.data.updated_at).select("id");
    if (updated.error) throw updated.error;
    if (updated.data?.length) return record(patch.media_metadata);
  }
  throw new Error("image_media_metadata_changed");
}

/** Merge against a fresh row so a thumbnail cannot erase a worker's proof. */
export async function persistImageSourcePreviewMetadata(params: {
  supabase: any;
  accountId: string;
  mediaId: string;
  source: Record<string, unknown>;
  thumbnail: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await params.supabase.from("pro_media_library")
      .select("media_metadata,updated_at")
      .eq("id", params.mediaId).eq("user_id", params.accountId).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data?.updated_at) throw new Error("source_preview_media_missing");
    const metadata = record(current.data.media_metadata);
    const normalization = record(metadata.image_normalization);
    const currentProof = record(normalization.source);
    const recovered = imageSourceRequiresCanonical(params.source);
    // A canonical input may be smaller than the original probed by the worker.
    const dimensionSource = currentProof.probeProvenance === "server_sharp"
      ? currentProof
      : params.source;
    const merged = {
      ...metadata,
      source_interface_thumbnail: params.thumbnail,
      ...(recovered ? {
        image_normalization: {
          ...normalization,
          source: imageSourceRequiresCanonical(currentProof) ? currentProof : params.source,
        },
      } : {}),
    };
    const updated = await params.supabase.from("pro_media_library").update({
      width: dimensionSource.width,
      height: dimensionSource.height,
      media_metadata: merged,
    }).eq("id", params.mediaId).eq("user_id", params.accountId)
      .eq("updated_at", current.data.updated_at).select("id");
    if (updated.error) throw updated.error;
    if (updated.data?.length) return merged;
  }
  throw new Error("source_preview_metadata_changed");
}
