import "server-only";

import { createHash } from "node:crypto";

import type {
  AiMediaKind,
  AiMediaLibraryPickerItem,
} from "@/lib/aiMediaGenerationContracts";
import type { NormalizedAiMedia } from "@/lib/aiMediaNormalizer";
import { enqueueImageNormalization } from "@/lib/mediaImageNormalizationQueue";
import { buildMediaLibraryContentUrl } from "@/lib/mediaLibraryContentUrl";
import { UNIVERSAL_MEDIA_PIPELINE_VERSION } from "@/lib/mediaPipelineRegistry";
import { enqueueVideoNormalization } from "@/lib/mediaVideoNormalizationQueue";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const BUCKET = "inrcy-pro-media";
const CONTENT_URL_TTL_SECONDS = 10 * 60;
const GENERATED_SOURCE = "ai_media_generation";
const GENERATED_DRAFT_SOURCE = "ai_media_generation_draft";
const GENERATED_DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;

type RegistryRow = {
  id: string;
  bucket_name: string | null;
  storage_path: string;
  original_file_name: string | null;
  media_type: AiMediaKind;
  mime_type: string | null;
  size_bytes: number | null;
  title: string | null;
  tags: string[] | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: string | null;
  upload_status?: string | null;
  is_active?: boolean | null;
  source?: string | null;
  media_metadata?: Record<string, unknown> | null;
};

const REGISTRY_SELECT =
  "id,bucket_name,storage_path,original_file_name,media_type,mime_type,size_bytes,title,tags,width,height,duration_seconds,created_at,upload_status,is_active,source,media_metadata";

function safePathSegment(value: unknown, label: string) {
  const segment = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,179}$/.test(segment)) {
    throw new Error(`ai_media_${label}_invalid`);
  }
  return segment;
}

function clientMediaKey(jobId: string) {
  return `ai-media:${jobId}`;
}

function buildStoragePath(args: {
  accountId: string;
  jobId: string;
  kind: AiMediaKind;
  extension: string;
}) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `users/${safePathSegment(args.accountId, "account")}/ai-generated/${args.kind}/${year}/${month}/${safePathSegment(args.jobId, "job")}.${args.extension}`;
}

async function toPickerItem(
  row: RegistryRow,
  options: { signedUrl?: string | null } = {},
): Promise<AiMediaLibraryPickerItem> {
  // La signature est un confort de réponse court terme, pas une condition de
  // persistance. Une panne Storage après l'INSERT ne doit jamais faire croire
  // au quota que le média n'existe pas.
  // Une fois accepté, renvoyer l'URL applicative stable utilisée par toute la
  // Médiathèque. Elle recrée une signature Storage à chaque lecture : Booster
  // peut donc rejouer une insertion après une coupure mobile sans régénérer le
  // média. Le brouillon privé conserve une signature directe pour son aperçu,
  // car la route publique authentifiée refuse volontairement les lignes inactives.
  const signedUrl =
    (isAcceptedGeneratedMedia(row)
      ? buildMediaLibraryContentUrl(String(row.id || ""))
      : null) ||
    (options.signedUrl !== undefined
      ? options.signedUrl
      : await createSafeStorageSignedUrl(
          String(row.bucket_name || BUCKET),
          row.storage_path,
          CONTENT_URL_TTL_SECONDS,
        ).catch(() => null));
  return {
    id: String(row.id),
    bucket_name: row.bucket_name || BUCKET,
    storage_path: String(row.storage_path),
    original_file_name: row.original_file_name || null,
    media_type: row.media_type,
    mime_type: row.mime_type || null,
    size_bytes: Number(row.size_bytes || 0) || null,
    title: row.title || null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    width: Number(row.width || 0) || null,
    height: Number(row.height || 0) || null,
    duration_seconds: Number(row.duration_seconds || 0) || null,
    created_at: row.created_at || null,
    signed_url: signedUrl,
  };
}

async function readRegistryRow(accountId: string, jobId: string) {
  const result = await supabaseAdmin
    .from("pro_media_library")
    .select(REGISTRY_SELECT)
    .eq("user_id", accountId)
    .eq("client_media_key", clientMediaKey(jobId))
    .maybeSingle();
  if (result.error) throw result.error;
  return (result.data as RegistryRow | null) || null;
}

async function readRegistryRowById(accountId: string, mediaId: string) {
  const result = await supabaseAdmin
    .from("pro_media_library")
    .select(REGISTRY_SELECT)
    .eq("id", safePathSegment(mediaId, "media"))
    .eq("user_id", safePathSegment(accountId, "account"))
    .maybeSingle();
  if (result.error) throw result.error;
  return (result.data as RegistryRow | null) || null;
}

function isGeneratedDraft(row: RegistryRow | null) {
  return Boolean(
    row &&
      row.source === GENERATED_DRAFT_SOURCE &&
      row.is_active === false,
  );
}

function isAcceptedGeneratedMedia(row: RegistryRow | null) {
  return Boolean(
    row &&
      row.source === GENERATED_SOURCE &&
      row.is_active === true &&
      row.upload_status === "uploaded",
  );
}

function isReplayableGeneratedMedia(row: RegistryRow | null) {
  return Boolean(
    row &&
      row.upload_status === "uploaded" &&
      (isGeneratedDraft(row) || isAcceptedGeneratedMedia(row)),
  );
}

export async function getExistingGeneratedAiMedia(args: {
  accountId: string;
  jobId: string;
}) {
  const row = await readRegistryRow(args.accountId, args.jobId);
  if (!row || !isReplayableGeneratedMedia(row)) return null;
  return await toPickerItem(row);
}

/**
 * Vérification sans signature Storage, utilisable dans le chemin d'erreur.
 * Elle permet de ne jamais libérer un quota après une insertion réussie même
 * si la création de l'URL signée a temporairement échoué.
 */
export async function getPersistedGeneratedAiMediaId(args: {
  accountId: string;
  jobId: string;
}) {
  const row = await readRegistryRow(args.accountId, args.jobId);
  if (!row || !isReplayableGeneratedMedia(row)) return null;
  return row.id;
}

async function enqueueLibraryNormalization(args: {
  accountId: string;
  mediaId: string;
  kind: AiMediaKind;
}) {
  try {
    if (args.kind === "image") {
      return await enqueueImageNormalization({
        accountId: args.accountId,
        mediaId: args.mediaId,
      });
    }
    return await enqueueVideoNormalization({
      accountId: args.accountId,
      mediaId: args.mediaId,
    });
  } catch (error) {
    console.warn("[ai-media] normalization deferred to repair cron", {
      accountId: args.accountId,
      mediaId: args.mediaId,
      kind: args.kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function saveGeneratedAiMediaDraft(args: {
  accountId: string;
  authUserId: string;
  jobId: string;
  title: string;
  media: NormalizedAiMedia;
  metadata: Record<string, unknown>;
}): Promise<AiMediaLibraryPickerItem> {
  const alreadyRegistered = await getExistingGeneratedAiMedia({
    accountId: args.accountId,
    jobId: args.jobId,
  });
  if (alreadyRegistered) return alreadyRegistered;

  const storagePath = buildStoragePath({
    accountId: args.accountId,
    jobId: args.jobId,
    kind: args.media.kind,
    extension: args.media.extension,
  });
  const originalFileName = `inrcy-ia-${args.media.kind}-${args.jobId}.${args.media.extension}`;
  const contentHash = createHash("sha256")
    .update(args.media.buffer)
    .digest("hex");
  const now = new Date().toISOString();
  const tags = [
    "ia",
    "généré par inrcy",
    args.media.kind === "image" ? "image ia" : "vidéo ia",
  ];

  const uploaded = await supabaseAdmin.storage.from(BUCKET).upload(
    storagePath,
    args.media.buffer,
    {
      contentType: args.media.mimeType,
      cacheControl: "31536000",
      upsert: true,
    },
  );
  if (uploaded.error) throw uploaded.error;

  // L'objet vient d'être confirmé par Storage : sa signature peut être créée
  // pendant l'INSERT du registre au lieu d'ajouter deux allers-retours réseau
  // après celui-ci. L'échec éventuel reste non bloquant comme auparavant.
  const draftSignedUrlTask = createSafeStorageSignedUrl(
    BUCKET,
    storagePath,
    CONTENT_URL_TTL_SECONDS,
  ).catch(() => null);

  const payload = {
    user_id: args.accountId,
    created_by_auth_user_id: args.authUserId,
    bucket_name: BUCKET,
    storage_path: storagePath,
    media_type: args.media.kind,
    mime_type: args.media.mimeType,
    size_bytes: args.media.buffer.byteLength,
    title: args.title,
    tags,
    source: GENERATED_DRAFT_SOURCE,
    width: args.media.width,
    height: args.media.height,
    duration_seconds: args.media.durationSeconds,
    // Le média existe physiquement pour pouvoir solder le quota, mais reste
    // invisible de toute la Médiathèque tant que le pro ne l'a pas accepté.
    is_active: false,
    original_file_name: originalFileName,
    content_hash_sha256: contentHash,
    client_media_key: clientMediaKey(args.jobId),
    upload_protocol: "server_legacy",
    upload_status: "uploaded",
    upload_progress: 100,
    uploaded_at: now,
    upload_started_at: now,
    processing_status: "not_requested",
    processing_progress: 0,
    publication_status: "not_requested",
    pipeline_version: UNIVERSAL_MEDIA_PIPELINE_VERSION,
    media_metadata: {
      ...args.metadata,
      schema_version: 1,
      origin: "ai_generation",
      lifecycle: "temporary_draft",
      draft_expires_at: new Date(Date.now() + GENERATED_DRAFT_TTL_MS).toISOString(),
      generation_job_id: args.jobId,
      active_account_id: args.accountId,
      content_sha256: contentHash,
      storage_bucket: BUCKET,
      storage_path: storagePath,
    },
  };

  const inserted = await supabaseAdmin
    .from("pro_media_library")
    .insert(payload)
    .select(REGISTRY_SELECT)
    .single();

  let row: RegistryRow | null = null;
  if (!inserted.error && inserted.data) {
    row = inserted.data as RegistryRow;
  } else if (inserted.error?.code === "23505") {
    row = await readRegistryRow(args.accountId, args.jobId);
  }

  if (!row) {
    await supabaseAdmin.storage
      .from(BUCKET)
      .remove([storagePath])
      .catch(() => undefined);
    throw inserted.error || new Error("ai_media_registry_insert_failed");
  }

  return await toPickerItem(row, { signedUrl: await draftSignedUrlTask });
}

/**
 * Promotion idempotente du brouillon IA. Le filtre de transition garantit
 * qu'un DELETE concurrent ne peut jamais supprimer un média déjà accepté.
 */
export async function acceptGeneratedAiMediaDraft(args: {
  accountId: string;
  authUserId: string;
  mediaId: string;
}): Promise<AiMediaLibraryPickerItem | null> {
  const existing = await readRegistryRowById(args.accountId, args.mediaId);
  if (!existing) return null;
  if (isAcceptedGeneratedMedia(existing)) {
    await enqueueLibraryNormalization({
      accountId: args.accountId,
      mediaId: existing.id,
      kind: existing.media_type,
    });
    return await toPickerItem(existing);
  }
  if (!isGeneratedDraft(existing) || existing.upload_status !== "uploaded") {
    return null;
  }

  const acceptedAt = new Date().toISOString();
  const promoted = await supabaseAdmin
    .from("pro_media_library")
    .update({
      source: GENERATED_SOURCE,
      is_active: true,
      created_by_auth_user_id: args.authUserId,
      original_deleted_at: null,
      original_retention_until: null,
      media_metadata: {
        ...(existing.media_metadata || {}),
        lifecycle: "accepted",
        accepted_at: acceptedAt,
        accepted_by_auth_user_id: args.authUserId,
      },
    })
    .eq("id", existing.id)
    .eq("user_id", args.accountId)
    .eq("source", GENERATED_DRAFT_SOURCE)
    .eq("is_active", false)
    .eq("upload_status", "uploaded")
    .select(REGISTRY_SELECT);
  if (promoted.error) throw promoted.error;

  const row = (promoted.data?.[0] as RegistryRow | undefined) ||
    (await readRegistryRowById(args.accountId, args.mediaId));
  if (!row || !isAcceptedGeneratedMedia(row)) return null;

  await enqueueLibraryNormalization({
    accountId: args.accountId,
    mediaId: row.id,
    kind: row.media_type,
  });
  return await toPickerItem(row);
}

export type GeneratedAiMediaDraftDiscardOutcome =
  | "discarded"
  | "accepted"
  | "missing";

/**
 * Refus idempotent d'un brouillon. On réclame d'abord la ligne par une
 * transition uploaded -> removed, puis seulement l'objet Storage. Un clic
 * d'acceptation concurrent gagne donc soit entièrement, soit pas du tout.
 * Le job de quota reste completed et son FK passe à null via ON DELETE SET
 * NULL : un refus ne rembourse jamais la génération déjà réussie.
 */
export async function discardGeneratedAiMediaDraft(args: {
  accountId: string;
  mediaId: string;
}): Promise<GeneratedAiMediaDraftDiscardOutcome> {
  const existing = await readRegistryRowById(args.accountId, args.mediaId);
  if (!existing) return "missing";
  if (isAcceptedGeneratedMedia(existing)) return "accepted";
  if (!isGeneratedDraft(existing)) return "missing";

  let claimed = existing;
  if (existing.upload_status === "uploaded") {
    const discardedAt = new Date().toISOString();
    const claim = await supabaseAdmin
      .from("pro_media_library")
      .update({
        upload_status: "removed",
        publication_status: "removed",
        original_deleted_at: discardedAt,
        media_metadata: {
          ...(existing.media_metadata || {}),
          lifecycle: "discarded",
          discarded_at: discardedAt,
        },
      })
      .eq("id", existing.id)
      .eq("user_id", args.accountId)
      .eq("source", GENERATED_DRAFT_SOURCE)
      .eq("is_active", false)
      .eq("upload_status", "uploaded")
      .select(REGISTRY_SELECT);
    if (claim.error) throw claim.error;
    if (claim.data?.[0]) {
      claimed = claim.data[0] as RegistryRow;
    } else {
      const current = await readRegistryRowById(args.accountId, args.mediaId);
      if (!current) return "missing";
      if (isAcceptedGeneratedMedia(current)) return "accepted";
      if (!isGeneratedDraft(current) || current.upload_status !== "removed") {
        return "missing";
      }
      claimed = current;
    }
  } else if (existing.upload_status !== "removed") {
    return "missing";
  }

  const bucket = String(claimed.bucket_name || BUCKET).trim();
  const storagePath = String(claimed.storage_path || "").trim();
  if (
    bucket !== BUCKET ||
    !storagePath.startsWith(`users/${args.accountId}/ai-generated/`)
  ) {
    throw new Error("ai_media_draft_storage_scope_invalid");
  }

  const removed = await supabaseAdmin.storage.from(bucket).remove([storagePath]);
  if (removed.error) throw removed.error;

  const deleted = await supabaseAdmin
    .from("pro_media_library")
    .delete()
    .eq("id", claimed.id)
    .eq("user_id", args.accountId)
    .eq("source", GENERATED_DRAFT_SOURCE)
    .eq("is_active", false)
    .eq("upload_status", "removed");
  if (deleted.error) throw deleted.error;
  return "discarded";
}

export async function purgeExpiredGeneratedAiMediaDrafts(args?: {
  limit?: number;
  now?: Date;
}) {
  const limit = Math.max(1, Math.min(100, Math.round(args?.limit || 50)));
  const now = args?.now || new Date();
  const cutoff = new Date(now.getTime() - GENERATED_DRAFT_TTL_MS).toISOString();
  const candidates = await supabaseAdmin
    .from("pro_media_library")
    .select("id,user_id")
    .eq("source", GENERATED_DRAFT_SOURCE)
    .eq("is_active", false)
    .in("upload_status", ["uploaded", "removed"])
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (candidates.error) throw candidates.error;

  let discarded = 0;
  let accepted = 0;
  const errors: Array<{ mediaId: string; error: string }> = [];
  for (const candidate of candidates.data || []) {
    const mediaId = String(candidate.id || "");
    const accountId = String(candidate.user_id || "");
    if (!mediaId || !accountId) continue;
    try {
      const outcome = await discardGeneratedAiMediaDraft({ accountId, mediaId });
      if (outcome === "discarded" || outcome === "missing") discarded += 1;
      else accepted += 1;
    } catch (error) {
      errors.push({
        mediaId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    inspected: candidates.data?.length || 0,
    discarded,
    accepted,
    errors,
  };
}

// Alias conservé pour les imports historiques côté serveur. La sémantique v2
// est désormais volontairement temporaire jusqu'à l'acceptation explicite.
export const saveGeneratedAiMedia = saveGeneratedAiMediaDraft;
