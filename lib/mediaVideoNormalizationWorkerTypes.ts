import { type VideoNormalizationVariantKey } from "@/lib/mediaVideoNormalizationPolicy";

export type ClaimedVideoJob = {
  id: string;
  account_id: string;
  media_id: string;
  workspace_id: string | null;
  variant_id: string | null;
  status: string;
  progress: number;
  attempt_count: number;
  max_attempts: number;
  payload: Record<string, unknown> | null;
};

export type MediaRow = {
  id: string;
  user_id: string;
  bucket_name: string;
  storage_path: string;
  media_type: string;
  mime_type: string | null;
  detected_mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  upload_status: string;
  processing_status: string;
  publication_status: string;
  original_file_name: string | null;
  media_metadata: Record<string, unknown> | null;
  updated_at: string;
};

export type VariantRow = {
  id: string;
  purpose: string;
  signature: string;
  status: string;
  key: VideoNormalizationVariantKey;
  bucket_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  variant_metadata: Record<string, unknown> | null;
};

export type ProcessedJobSummary = {
  jobId: string;
  mediaId: string;
  status: "succeeded" | "queued" | "retry_wait" | "failed" | "cancelled";
  errorCode?: string;
};
