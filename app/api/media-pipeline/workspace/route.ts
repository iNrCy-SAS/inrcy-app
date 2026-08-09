import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createSafeStorageSignedUrl,
  probeStorageObject,
} from "@/lib/safeStorageSignedUrl";

export const runtime = "nodejs";

type WorkspaceAction =
  | "ensure"
  | "clear_media"
  | "archive"
  | "link_draft";

function cleanText(value: unknown, fallback = "", max = 500) {
  return String(value ?? fallback).trim().slice(0, max);
}

function cleanStringArray(value: unknown, max = 30) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => cleanText(item, "", 80))
        .filter(Boolean)
        .slice(0, max),
    ),
  );
}

function isWorkspaceAction(value: unknown): value is WorkspaceAction {
  return ["ensure", "clear_media", "archive", "link_draft"].includes(
    String(value || ""),
  );
}

function jsonError(error: string, status = 400, code?: string) {
  return NextResponse.json(
    { ok: false, error, ...(code ? { code } : {}) },
    { status },
  );
}

const STORAGE_OBJECT_MISSING_CODE = "storage_object_missing";

async function signWorkspaceSource(params: {
  accountId: string;
  mediaId: string;
  bucket: string;
  storagePath: string;
  uploadStatus: string;
  uploadErrorCode: string;
  originalDeletedAt: unknown;
}) {
  if (
    params.uploadStatus !== "uploaded" ||
    params.uploadErrorCode === STORAGE_OBJECT_MISSING_CODE ||
    params.originalDeletedAt
  ) {
    return null;
  }

  const signedUrl = await createSafeStorageSignedUrl(
    params.bucket,
    params.storagePath,
    60 * 60 * 24,
  );
  if (signedUrl) return signedUrl;
  if ((await probeStorageObject(params.bucket, params.storagePath)) !== "missing") {
    return null;
  }

  const marked = await supabaseAdmin
    .from("pro_media_library")
    .update({
      upload_error_code: STORAGE_OBJECT_MISSING_CODE,
      upload_error_message:
        "Le fichier source est absent du stockage. Un nouvel envoi est nécessaire.",
    })
    .eq("id", params.mediaId)
    .eq("user_id", params.accountId)
    .eq("upload_status", "uploaded");
  if (marked.error) {
    console.warn("[media-pipeline] missing workspace source marker failed", {
      mediaId: params.mediaId,
      message: marked.error.message,
    });
  }
  return null;
}

async function signReadyWorkspaceVariant(params: {
  accountId: string;
  variant: Record<string, unknown> | null | undefined;
}) {
  const variantId = cleanText(params.variant?.id, "", 80);
  const bucket = cleanText(params.variant?.bucket_name, "", 120);
  const storagePath = cleanText(params.variant?.storage_path, "", 1_500);
  if (!variantId || !bucket || !storagePath) return null;

  const signedUrl = await createSafeStorageSignedUrl(
    bucket,
    storagePath,
    60 * 60 * 24,
  );
  if (signedUrl) return signedUrl;
  if ((await probeStorageObject(bucket, storagePath)) !== "missing") return null;

  const marked = await supabaseAdmin
    .from("media_variants")
    .update({
      status: "failed",
      error_code: STORAGE_OBJECT_MISSING_CODE,
      error_message:
        "La variante annoncée comme prête est absente du stockage.",
      ready_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", variantId)
    .eq("account_id", params.accountId)
    .eq("status", "ready");
  if (marked.error) {
    console.warn("[media-pipeline] missing workspace variant marker failed", {
      variantId,
      message: marked.error.message,
    });
  }
  return null;
}

async function readOwnedWorkspace(workspaceId: string, accountId: string) {
  const result = await supabaseAdmin
    .from("publication_workspaces")
    .select(
      "id,account_id,client_workspace_key,status,revision,selected_channels,workspace_metadata,created_at,updated_at",
    )
    .eq("id", workspaceId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function ensureWorkspace(params: {
  accountId: string;
  authUserId: string;
  clientWorkspaceKey: string;
  sourceModule: string;
  draftId: string;
  selectedChannels: string[];
}) {
  const existing = await supabaseAdmin
    .from("publication_workspaces")
    .select(
      "id,client_workspace_key,status,revision,selected_channels,workspace_metadata",
    )
    .eq("account_id", params.accountId)
    .eq("client_workspace_key", params.clientWorkspaceKey)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const now = new Date().toISOString();
  if (existing.data) {
    const currentMetadata =
      existing.data.workspace_metadata &&
      typeof existing.data.workspace_metadata === "object" &&
      !Array.isArray(existing.data.workspace_metadata)
        ? existing.data.workspace_metadata
        : {};
    const patch = await supabaseAdmin
      .from("publication_workspaces")
      .update({
        last_opened_at: now,
        selected_channels: params.selectedChannels,
        status: ["draft", "active", "waiting_media", "ready", "failed"].includes(
          String(existing.data.status || ""),
        )
          ? "active"
          : existing.data.status,
        workspace_metadata: {
          ...currentMetadata,
          ...(params.draftId ? { draft_id: params.draftId } : {}),
          media_pipeline_step: 8,
          last_client_opened_at: now,
        },
      })
      .eq("id", existing.data.id)
      .eq("account_id", params.accountId)
      .select("id,client_workspace_key,status,revision")
      .single();
    if (patch.error) throw patch.error;
    return patch.data;
  }

  const inserted = await supabaseAdmin
    .from("publication_workspaces")
    .insert({
      account_id: params.accountId,
      created_by_auth_user_id: params.authUserId,
      client_workspace_key: params.clientWorkspaceKey,
      source_module: params.sourceModule || "booster",
      status: "active",
      selected_channels: params.selectedChannels,
      last_opened_at: now,
      workspace_metadata: {
        ...(params.draftId ? { draft_id: params.draftId } : {}),
        media_pipeline_step: 8,
        created_from: "booster_media_insertion",
      },
    })
    .select("id,client_workspace_key,status,revision")
    .single();
  if (!inserted.error) return inserted.data;

  if (inserted.error.code === "23505") {
    const concurrent = await supabaseAdmin
      .from("publication_workspaces")
      .select("id,client_workspace_key,status,revision")
      .eq("account_id", params.accountId)
      .eq("client_workspace_key", params.clientWorkspaceKey)
      .single();
    if (concurrent.error) throw concurrent.error;
    return concurrent.data;
  }

  throw inserted.error;
}

export async function GET(request: Request) {
  try {
    const { errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const url = new URL(request.url);
    const workspaceId = cleanText(url.searchParams.get("workspaceId"), "", 80);
    const includeUrls = url.searchParams.get("includeUrls") !== "0";
    if (!workspaceId) return jsonError("Espace média manquant.");

    const workspace = await readOwnedWorkspace(workspaceId, activeUserId);
    if (!workspace) return jsonError("Espace média introuvable.", 404);

    const mediaResult = await supabaseAdmin
      .from("publication_workspace_media")
      .select(
        "position,media_id,pro_media_library!inner(id,user_id,media_type,upload_status,upload_progress,upload_error_code,original_deleted_at,bucket_name,storage_path,original_file_name,client_media_key,mime_type,size_bytes,width,height,duration_seconds,processing_status,processing_progress,processing_error_code,processing_error_message,publication_status)",
      )
      .eq("workspace_id", workspaceId)
      .eq("pro_media_library.user_id", activeUserId)
      .order("position", { ascending: true });
    if (mediaResult.error) throw mediaResult.error;

    const mediaIds = (mediaResult.data || [])
      .map((row: any) => String(row.media_id || ""))
      .filter(Boolean);
    const variantsResult = mediaIds.length
      ? await supabaseAdmin
          .from("media_variants")
          .select(
            "id,media_id,purpose,status,bucket_name,storage_path,width,height",
          )
          .eq("account_id", activeUserId)
          .in("media_id", mediaIds)
          .eq("status", "ready")
          .in("purpose", ["thumbnail", "canonical"])
      : { data: [], error: null };
    if (variantsResult.error) throw variantsResult.error;
    const variantsByMedia = new Map<string, any[]>();
    for (const variant of variantsResult.data || []) {
      const mediaId = String((variant as any).media_id || "");
      if (!mediaId) continue;
      variantsByMedia.set(mediaId, [
        ...(variantsByMedia.get(mediaId) || []),
        variant,
      ]);
    }

    const media = await Promise.all(
      (mediaResult.data || []).map(async (row: any) => {
        const item = Array.isArray(row.pro_media_library)
          ? row.pro_media_library[0]
          : row.pro_media_library;
        const bucket = String(item?.bucket_name || "");
        const storagePath = String(item?.storage_path || "");
        const publicUrl =
          includeUrls && bucket && storagePath
            ? await signWorkspaceSource({
                accountId: activeUserId,
                mediaId: String(row.media_id || item?.id || ""),
                bucket,
                storagePath,
                uploadStatus: String(item?.upload_status || ""),
                uploadErrorCode: String(item?.upload_error_code || ""),
                originalDeletedAt: item?.original_deleted_at,
              })
            : null;
        const normalizedVariants = variantsByMedia.get(
          String(row.media_id || item?.id || ""),
        ) || [];
        const canonicalVariant = normalizedVariants.find(
          (variant) => variant.purpose === "canonical",
        );
        const previewVariant =
          normalizedVariants.find((variant) => variant.purpose === "thumbnail") ||
          canonicalVariant;
        const signedVariantUrls = new Map<string, Promise<string | null>>();
        const signVariant = (variant: Record<string, unknown> | undefined) => {
          if (!variant) return Promise.resolve(null);
          const key = String(
            variant.id || `${variant.bucket_name || ""}:${variant.storage_path || ""}`,
          );
          const active = signedVariantUrls.get(key);
          if (active) return active;
          const request = signReadyWorkspaceVariant({
            accountId: activeUserId,
            variant,
          });
          signedVariantUrls.set(key, request);
          return request;
        };
        const [previewUrl, canonicalUrl] = includeUrls
          ? await Promise.all([
              signVariant(previewVariant),
              signVariant(canonicalVariant),
            ])
          : [null, null];
        return {
          mediaId: String(row.media_id || item?.id || ""),
          mediaType: item?.media_type,
          position: Number(row.position || 0),
          uploadStatus: item?.upload_status,
          uploadProgress: Number(item?.upload_progress || 0),
          processingStatus: String(item?.processing_status || "not_requested"),
          processingProgress: Number(item?.processing_progress || 0),
          processingErrorCode: item?.processing_error_code
            ? String(item.processing_error_code)
            : null,
          processingErrorMessage: item?.processing_error_message
            ? String(item.processing_error_message)
            : null,
          publicationStatus: String(item?.publication_status || "not_requested"),
          bucket,
          storagePath,
          publicUrl,
          previewUrl,
          canonicalUrl,
          fileName: String(item?.original_file_name || "media-inrcy"),
          clientMediaKey: String(item?.client_media_key || ""),
          mimeType: String(item?.mime_type || "application/octet-stream"),
          sizeBytes: Number(item?.size_bytes || 0),
          width: Number(item?.width || 0) || null,
          height: Number(item?.height || 0) || null,
          durationSeconds: Number(item?.duration_seconds || 0) || null,
        };
      }),
    );

    return NextResponse.json({
      ok: true,
      workspace: {
        workspaceId: workspace.id,
        clientWorkspaceKey: workspace.client_workspace_key,
        status: workspace.status,
        revision: workspace.revision,
        media,
      },
    });
  } catch (error) {
    console.error("[media-pipeline] workspace read failed", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Impossible de charger l’espace média.",
      500,
    );
  }
}

export async function POST(request: Request) {
  try {
    const { errorResponse, activeUserId, authUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const limited = await enforceRateLimit({
      name: "media_pipeline_workspace",
      identifier: activeUserId,
      limit: 180,
      fallbackLimit: 180,
      window: "2 m",
      failClosed: false,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    if (!body || !isWorkspaceAction(body.action)) {
      return jsonError("Action d’espace média invalide.");
    }

    if (body.action === "ensure") {
      const clientWorkspaceKey = cleanText(body.clientWorkspaceKey, "", 500);
      if (!clientWorkspaceKey) {
        return jsonError("Clé d’espace média manquante.", 400, "workspace_key_required");
      }
      const workspace = await ensureWorkspace({
        accountId: activeUserId,
        authUserId,
        clientWorkspaceKey,
        sourceModule: cleanText(body.sourceModule, "booster", 80),
        draftId: cleanText(body.draftId, "", 100),
        selectedChannels: cleanStringArray(body.selectedChannels),
      });
      return NextResponse.json({
        ok: true,
        workspace: {
          id: workspace.id,
          clientWorkspaceKey: workspace.client_workspace_key,
          status: workspace.status,
          revision: workspace.revision,
        },
      });
    }

    const workspaceId = cleanText(body.workspaceId, "", 80);
    if (!workspaceId) return jsonError("Espace média manquant.");
    const workspace = await readOwnedWorkspace(workspaceId, activeUserId);
    if (!workspace) return jsonError("Espace média introuvable.", 404);

    if (body.action === "clear_media") {
      const requestedMediaType =
        body.mediaType === "image" || body.mediaType === "video"
          ? body.mediaType
          : null;
      const linked = await supabaseAdmin
        .from("publication_workspace_media")
        .select("media_id,pro_media_library!inner(media_type)")
        .eq("workspace_id", workspaceId);
      if (linked.error) throw linked.error;
      const detachedMediaIds = Array.from(
        new Set(
          (linked.data || [])
            .filter((row: any) => {
              if (!requestedMediaType) return true;
              const media = Array.isArray(row.pro_media_library)
                ? row.pro_media_library[0]
                : row.pro_media_library;
              return String(media?.media_type || "") === requestedMediaType;
            })
            .map((row: any) => String(row.media_id || ""))
            .filter(Boolean),
        ),
      );
      if (detachedMediaIds.length) {
        const deleted = await supabaseAdmin
          .from("publication_workspace_media")
          .delete()
          .eq("workspace_id", workspaceId)
          .in("media_id", detachedMediaIds);
        if (deleted.error) throw deleted.error;
      }
      const retentionUntil = new Date(
        Date.now() + 24 * 60 * 60 * 1_000,
      ).toISOString();
      for (const mediaId of detachedMediaIds) {
        const remaining = await supabaseAdmin
          .from("publication_workspace_media")
          .select("media_id", { count: "exact", head: true })
          .eq("media_id", mediaId);
        if (remaining.error) throw remaining.error;
        if ((remaining.count || 0) > 0) continue;
        const retained = await supabaseAdmin
          .from("pro_media_library")
          .update({ original_retention_until: retentionUntil })
          .eq("id", mediaId)
          .eq("user_id", activeUserId)
          .eq("source", "booster_workspace");
        if (retained.error) throw retained.error;
      }
      const updated = await supabaseAdmin
        .from("publication_workspaces")
        .update({
          status: "active",
          revision: Number(workspace.revision || 1) + 1,
          last_opened_at: new Date().toISOString(),
          workspace_metadata: {
            ...(workspace.workspace_metadata || {}),
            last_media_clear_reason: cleanText(body.reason, "workspace_sync", 120),
            last_media_clear_at: new Date().toISOString(),
            last_media_clear_type: requestedMediaType || "all",
          },
        })
        .eq("id", workspaceId)
        .eq("account_id", activeUserId);
      if (updated.error) throw updated.error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "link_draft") {
      const draftId = cleanText(body.draftId, "", 100);
      if (!draftId) return jsonError("Identifiant de brouillon manquant.");
      const updated = await supabaseAdmin
        .from("publication_workspaces")
        .update({
          workspace_metadata: {
            ...(workspace.workspace_metadata || {}),
            draft_id: draftId,
            draft_linked_at: new Date().toISOString(),
          },
        })
        .eq("id", workspaceId)
        .eq("account_id", activeUserId);
      if (updated.error) throw updated.error;
      return NextResponse.json({ ok: true });
    }

    const archived = await supabaseAdmin
      .from("publication_workspaces")
      .update({
        status: "archived",
        archived_at: new Date().toISOString(),
        workspace_metadata: {
          ...(workspace.workspace_metadata || {}),
          archive_reason: cleanText(body.reason, "publication_completed", 120),
        },
      })
      .eq("id", workspaceId)
      .eq("account_id", activeUserId);
    if (archived.error) throw archived.error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[media-pipeline] workspace action failed", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Impossible de mettre à jour l’espace média.",
      500,
    );
  }
}
