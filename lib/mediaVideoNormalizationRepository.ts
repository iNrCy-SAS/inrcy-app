import { VIDEO_NORMALIZATION_PIPELINE_VERSION, VIDEO_NORMALIZATION_VARIANT_KEYS, VIDEO_NORMALIZATION_WORKER_LEASE_SECONDS, getVideoNormalizationKeyFromSignature, getVideoNormalizationSignature } from "@/lib/mediaVideoNormalizationPolicy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { type ClaimedVideoJob, type MediaRow, type VariantRow } from "@/lib/mediaVideoNormalizationWorkerTypes";
import { VideoNormalizationError, compactMessage } from "@/lib/mediaVideoNormalizationWorkerPolicy";

export async function hasReadyCanonicalVariant(params: {
  accountId: string;
  mediaId: string;
}) {
  const result = await supabaseAdmin
    .from("media_variants")
    .select("id")
    .eq("account_id", params.accountId)
    .eq("media_id", params.mediaId)
    .is("workspace_id", null)
    .eq("purpose", "canonical")
    .eq("signature", getVideoNormalizationSignature("canonical"))
    .eq("status", "ready")
    .limit(1);
  if (result.error) throw result.error;
  return Boolean(result.data?.length);
}

export async function updateJobProgress(job: ClaimedVideoJob, progress: number) {
  const safe = Math.max(1, Math.min(99, Math.round(progress)));
  const now = new Date().toISOString();
  const [jobUpdate, mediaUpdate, publicationStatusUpdate] = await Promise.all([
    supabaseAdmin
      .from("media_processing_jobs")
      .update({
        progress: safe,
        lock_expires_at: new Date(
          Date.now() + VIDEO_NORMALIZATION_WORKER_LEASE_SECONDS * 1_000,
        ).toISOString(),
        updated_at: now,
      })
      .eq("id", job.id)
      .eq("account_id", job.account_id)
      .eq("status", "processing")
      .select("id"),
    supabaseAdmin
      .from("pro_media_library")
      .update({
        processing_status: "processing",
        processing_progress: safe,
        processing_started_at: now,
        processing_error_code: null,
        processing_error_message: null,
      })
      .eq("id", job.media_id)
      .eq("user_id", job.account_id),
    supabaseAdmin
      .from("pro_media_library")
      .update({ publication_status: "processing" })
      .eq("id", job.media_id)
      .eq("user_id", job.account_id)
      .neq("publication_status", "ready"),
  ]);
  if (mediaUpdate.error) {
    console.warn("[media-pipeline] video media progress update failed", {
      jobId: job.id,
      mediaId: job.media_id,
      progress: safe,
      message: compactMessage(mediaUpdate.error),
    });
  }
  if (publicationStatusUpdate.error) {
    console.warn("[media-pipeline] video publication progress update failed", {
      jobId: job.id,
      mediaId: job.media_id,
      progress: safe,
      message: compactMessage(publicationStatusUpdate.error),
    });
  }
  if (jobUpdate.error || !jobUpdate.data?.[0]) {
    throw new VideoNormalizationError(
      "video_job_lease_refresh_failed",
      jobUpdate.error
        ? compactMessage(jobUpdate.error)
        : "Le verrou du traitement video n'est plus actif.",
      true,
    );
  }
}

export async function loadMedia(job: ClaimedVideoJob): Promise<MediaRow> {
  const result = await supabaseAdmin
    .from("pro_media_library")
    .select(
      "id,user_id,bucket_name,storage_path,media_type,mime_type,detected_mime_type,size_bytes,width,height,duration_seconds,upload_status,processing_status,publication_status,original_file_name,media_metadata,updated_at",
    )
    .eq("id", job.media_id)
    .eq("user_id", job.account_id)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    throw new VideoNormalizationError(
      "video_media_not_found",
      "Média vidéo introuvable.",
      false,
    );
  }
  return result.data as MediaRow;
}

export async function loadVariants(job: ClaimedVideoJob): Promise<VariantRow[]> {
  const signatures = VIDEO_NORMALIZATION_VARIANT_KEYS.map((key) =>
    getVideoNormalizationSignature(key),
  );
  const result = await supabaseAdmin
    .from("media_variants")
    .select(
      "id,purpose,signature,status,bucket_name,storage_path,mime_type,size_bytes,width,height,duration_seconds,variant_metadata",
    )
    .eq("account_id", job.account_id)
    .eq("media_id", job.media_id)
    .is("workspace_id", null)
    .in("signature", signatures);
  if (result.error) throw result.error;

  const rows = (result.data || [])
    .map((row: any) => {
      const key = getVideoNormalizationKeyFromSignature(String(row.signature));
      return key ? ({ ...row, key } as VariantRow) : null;
    })
    .filter((row): row is VariantRow => Boolean(row));
  const keys = new Set(rows.map((row) => row.key));
  for (const key of VIDEO_NORMALIZATION_VARIANT_KEYS) {
    if (!keys.has(key)) {
      throw new VideoNormalizationError(
        "video_variant_missing",
        `Variante vidéo ${key} absente du registre.`,
        true,
      );
    }
  }
  return rows;
}

export async function markVariantsProcessing(
  job: ClaimedVideoJob,
  variants: VariantRow[],
) {
  if (!variants.length) return;
  const result = await supabaseAdmin
    .from("media_variants")
    .update({
      status: "processing",
      error_code: null,
      error_message: null,
      pipeline_version: VIDEO_NORMALIZATION_PIPELINE_VERSION,
    })
    .eq("account_id", job.account_id)
    .eq("media_id", job.media_id)
    .in(
      "id",
      variants.map((variant) => variant.id),
    );
  if (result.error) throw result.error;
}
