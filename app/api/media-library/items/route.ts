import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { buildMediaLibraryContentUrl } from "@/lib/mediaLibraryContentUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadInrAgentVideoDerivativePaths } from "@/lib/inrAgentVideoContextCache";
import { MEDIA_LIBRARY_OPTIMIZATION_JOB_TYPES } from "@/lib/mediaLibraryOptimizationPolicy";
import { normalizeTransferredMediaMetadata } from "@/lib/mediaMetadataTransfer";

export const runtime = "nodejs";

const BUCKET = "inrcy-pro-media";
const AI_MEDIA_GENERATION_DRAFT_SOURCE = "ai_media_generation_draft";

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanTags(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((tag) => cleanText(tag, 60).toLowerCase()).filter(Boolean).slice(0, 30);
  }

  return cleanText(value)
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 30);
}

function jsonError(message: string, status = 500, detail?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    { status },
  );
}

function tableMissingError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("pro_media_library");
}

function isOwnedStoragePath(userId: string, storagePath: string) {
  return storagePath.startsWith(`users/${userId}/`);
}

type MediaDeleteUsage = {
  mediaId: string;
  source:
    | "inr_agent_action"
    | "inr_agent_scheduled_action"
    | "publish_draft"
    | "mail_campaign"
    | "send_item_draft";
  rowId: string;
  title: string;
  status?: string | null;
  scheduledFor?: string | null;
};

function isMissingOptionalUsageTable(error: { code?: string; message?: string } | null | undefined, tableName: string) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" ||
    message.includes(tableName.toLowerCase())
  );
}

function stringifyForUsageSearch(value: unknown) {
  try {
    return JSON.stringify(value || "");
  } catch {
    return "";
  }
}

function buildMediaUsageMarkers(rows: Array<{ id: string; storage_path?: string | null; bucket_name?: string | null }>) {
  return rows.map((row) => {
    const markers = [
      row.id,
      row.storage_path || "",
      row.bucket_name && row.storage_path ? `${row.bucket_name}/${row.storage_path}` : "",
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return { mediaId: row.id, markers };
  });
}

function findMatchingMediaIds(haystack: string, markersByMedia: ReturnType<typeof buildMediaUsageMarkers>) {
  if (!haystack) return [];
  return markersByMedia
    .filter(({ markers }) => markers.some((marker) => haystack.includes(marker)))
    .map(({ mediaId }) => mediaId);
}

async function findProtectedMediaUsages(
  userId: string,
  mediaRows: Array<{ id: string; storage_path?: string | null; bucket_name?: string | null }>,
): Promise<MediaDeleteUsage[]> {
  const markersByMedia = buildMediaUsageMarkers(mediaRows);
  if (!markersByMedia.length) return [];

  const usages: MediaDeleteUsage[] = [];

  const { data: agentActions, error: agentError } = await supabaseAdmin
    .from("inr_agent_actions")
    .select("id,title,status,scheduled_for,payload,image_assets")
    .eq("user_id", userId)
    .in("status", [
      "prepared",
      "pending_validation",
      "pending",
      "draft",
      "scheduled",
      "validated",
      "executing",
    ])
    .limit(500);

  if (agentError && !isMissingOptionalUsageTable(agentError, "inr_agent_actions")) {
    throw agentError;
  }

  for (const action of Array.isArray(agentActions) ? (agentActions as any[]) : []) {
    const haystack = stringifyForUsageSearch([action.payload, action.image_assets]);
    for (const mediaId of findMatchingMediaIds(haystack, markersByMedia)) {
      usages.push({
        mediaId,
        source: "inr_agent_action",
        rowId: String(action.id || ""),
        title: cleanText(action.title || "Action iNr’Agent", 160),
        status: cleanText(action.status, 40) || null,
        scheduledFor: cleanText(action.scheduled_for, 80) || null,
      });
    }
  }

  const { data: scheduledActions, error: scheduledError } = await supabaseAdmin
    .from("inr_agent_scheduled_actions")
    .select("id,title,status,scheduled_at,payload")
    .eq("user_id", userId)
    .in("status", ["scheduled", "running"])
    .limit(500);

  if (scheduledError && !isMissingOptionalUsageTable(scheduledError, "inr_agent_scheduled_actions")) {
    throw scheduledError;
  }

  for (const action of Array.isArray(scheduledActions) ? (scheduledActions as any[]) : []) {
    const haystack = stringifyForUsageSearch(action.payload);
    for (const mediaId of findMatchingMediaIds(haystack, markersByMedia)) {
      usages.push({
        mediaId,
        source: "inr_agent_scheduled_action",
        rowId: String(action.id || ""),
        title: cleanText(action.title || "Programmation iNr’Agent", 160),
        status: cleanText(action.status, 40) || null,
        scheduledFor: cleanText(action.scheduled_at, 80) || null,
      });
    }
  }

  const { data: publishDrafts, error: draftError } = await supabaseAdmin
    .from("app_events")
    .select("id,type,module,payload,created_at")
    .eq("user_id", userId)
    .eq("module", "booster")
    .eq("type", "publish_draft")
    .limit(500);

  if (draftError && !isMissingOptionalUsageTable(draftError, "app_events")) {
    throw draftError;
  }

  for (const draft of Array.isArray(publishDrafts) ? (publishDrafts as any[]) : []) {
    const haystack = stringifyForUsageSearch(draft.payload);
    const draftPayload = draft.payload && typeof draft.payload === "object" ? (draft.payload as Record<string, unknown>) : {};
    for (const mediaId of findMatchingMediaIds(haystack, markersByMedia)) {
      usages.push({
        mediaId,
        source: "publish_draft",
        rowId: String(draft.id || ""),
        title: cleanText(draftPayload.title || draftPayload.preview || "Brouillon publication", 160),
        status: "draft",
        scheduledFor: cleanText(draft.created_at, 80) || null,
      });
    }
  }

  const { data: mailCampaigns, error: campaignError } = await supabaseAdmin
    .from("mail_campaigns")
    .select("id,subject,status,created_at,updated_at,attachments,body_text,body_html")
    .eq("user_id", userId)
    .in("status", ["queued", "processing"])
    .limit(500);

  if (campaignError && !isMissingOptionalUsageTable(campaignError, "mail_campaigns")) {
    throw campaignError;
  }

  for (const campaign of Array.isArray(mailCampaigns) ? (mailCampaigns as any[]) : []) {
    const haystack = stringifyForUsageSearch([
      campaign.attachments,
      campaign.body_text,
      campaign.body_html,
    ]);
    for (const mediaId of findMatchingMediaIds(haystack, markersByMedia)) {
      usages.push({
        mediaId,
        source: "mail_campaign",
        rowId: String(campaign.id || ""),
        title: cleanText(campaign.subject || "Campagne programmée", 160),
        status: cleanText(campaign.status, 40) || null,
        scheduledFor: cleanText(campaign.created_at || campaign.updated_at, 80) || null,
      });
    }
  }

  const { data: sendItemDrafts, error: sendItemError } = await supabaseAdmin
    .from("send_items")
    .select("id,subject,status,created_at,attachments,body_text,body_html")
    .eq("user_id", userId)
    .eq("status", "draft")
    .limit(500);

  if (sendItemError && !isMissingOptionalUsageTable(sendItemError, "send_items")) {
    throw sendItemError;
  }

  for (const draft of Array.isArray(sendItemDrafts) ? (sendItemDrafts as any[]) : []) {
    const haystack = stringifyForUsageSearch([
      draft.attachments,
      draft.body_text,
      draft.body_html,
    ]);
    for (const mediaId of findMatchingMediaIds(haystack, markersByMedia)) {
      usages.push({
        mediaId,
        source: "send_item_draft",
        rowId: String(draft.id || ""),
        title: cleanText(draft.subject || "Brouillon iNrSend", 160),
        status: "draft",
        scheduledFor: cleanText(draft.created_at, 80) || null,
      });
    }
  }

  const seen = new Set<string>();
  return usages.filter((usage) => {
    const key = `${usage.mediaId}:${usage.source}:${usage.rowId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET(request: NextRequest) {
  const { user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const type = cleanText(url.searchParams.get("type"), 20) || "all";
  const active = cleanText(url.searchParams.get("active"), 20) || "active";
  const q = cleanText(url.searchParams.get("q"), 120);
  const mediaId = cleanText(url.searchParams.get("id"), 80);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 120), 1), 240);
  const fetchLimit = mediaId ? 1 : q ? 500 : limit;

  let query = supabaseAdmin
    .from("pro_media_library")
    .select("id,user_id,bucket_name,storage_path,media_type,mime_type,size_bytes,title,tags,source,width,height,duration_seconds,is_active,usage_count,last_used_at,created_at,updated_at,original_file_name,media_metadata")
    .eq("user_id", activeUserId)
    // Les apercus IA temporaires appartiennent au workflow de generation, pas
    // a la Mediatheque. Ils restent invisibles meme dans les vues Masques/Tous
    // jusqu'a leur promotion explicite par la route d'acceptation dediee.
    .neq("source", AI_MEDIA_GENERATION_DRAFT_SOURCE)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (mediaId) query = query.eq("id", mediaId);
  if (type === "image" || type === "video") query = query.eq("media_type", type);
  if (active === "active") query = query.eq("is_active", true);
  else if (active === "inactive") query = query.eq("is_active", false);

  const { data, error } = await query;
  if (error) {
    if (tableMissingError(error)) {
      return jsonError("La Médiathèque n’est pas encore installée. Lance le SQL fourni dans Supabase.", 503, error.message);
    }
    return jsonError("Impossible de charger la médiathèque.", 500, error.message);
  }

  const rawRows = data ?? [];
  const normalizedQ = q.toLowerCase();
  const rows = (normalizedQ
    ? rawRows.filter((row: any) => {
        const haystack = [
          row.title,
          row.storage_path,
          row.source,
          row.media_type,
          ...(Array.isArray(row.tags) ? row.tags : []),
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        return haystack.includes(normalizedQ);
      })
    : rawRows
  ).slice(0, limit);

  const mediaIds = rows.map((row: any) => String(row.id || "")).filter(Boolean);
  const optimizationByMediaId = new Map<string, Record<string, unknown>>();
  if (mediaIds.length) {
    const jobs = await supabaseAdmin
      .from("media_processing_jobs")
      .select(
        "id,media_id,job_type,status,progress,result,error_code,error_message,attempt_count,max_attempts,created_at,updated_at",
      )
      .eq("account_id", activeUserId)
      .in("media_id", mediaIds)
      .in("job_type", [...MEDIA_LIBRARY_OPTIMIZATION_JOB_TYPES])
      .order("created_at", { ascending: false })
      .limit(Math.min(960, Math.max(40, mediaIds.length * 3)));
    if (jobs.error) {
      if (!isMissingOptionalUsageTable(jobs.error, "media_processing_jobs")) {
        console.warn("[media-library] optimization states unavailable", jobs.error);
      }
    } else {
      for (const job of jobs.data || []) {
        const mediaId = String((job as any).media_id || "");
        if (mediaId && !optimizationByMediaId.has(mediaId)) {
          optimizationByMediaId.set(mediaId, job as Record<string, unknown>);
        }
      }
    }
  }

  const withUrls = rows.map((row: any) => {
    const metadata = normalizeTransferredMediaMetadata(row);
    return {
      ...row,
      // Postgres peut renvoyer NUMERIC sous forme de chaîne. Booster reçoit
      // toujours ici des nombres utilisables, y compris pour les anciennes
      // lignes dont les colonnes sont complétées par la preuve FFmpeg.
      width: metadata.width,
      height: metadata.height,
      duration_seconds: metadata.durationSeconds,
      optimization: optimizationByMediaId.get(String(row.id || "")) || null,
      // URL applicative stable : aucun token Supabase temporaire n'est conservé
      // dans l'interface après expiration.
      signed_url: buildMediaLibraryContentUrl(String(row.id || "")),
    };
  });

  const stats = {
    total: rows.length,
    images: rows.filter((row: any) => row.media_type === "image").length,
    videos: rows.filter((row: any) => row.media_type === "video").length,
    total_bytes: rows.reduce((sum: number, row: any) => sum + Number(row.size_bytes || 0), 0),
  };

  return NextResponse.json({ ok: true, items: withUrls, stats });
}

export async function PATCH(request: NextRequest) {
  const { user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await request.json().catch(() => ({}));
  const id = cleanText(body?.id, 80);
  if (!id) return jsonError("Média obligatoire.", 400);

  const existing = await supabaseAdmin
    .from("pro_media_library")
    .select("id,source")
    .eq("id", id)
    .eq("user_id", activeUserId)
    .maybeSingle();
  if (existing.error) {
    if (tableMissingError(existing.error)) {
      return jsonError("La table pro_media_library n’existe pas encore.", 503, existing.error.message);
    }
    return jsonError("Impossible de vérifier le média.", 500, existing.error.message);
  }
  if (!existing.data) return jsonError("Média introuvable.", 404);
  if (existing.data.source === AI_MEDIA_GENERATION_DRAFT_SOURCE) {
    return jsonError(
      "Cet aperçu IA doit être validé ou abandonné depuis l’outil de génération.",
      409,
    );
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    patch.title = cleanText(body.title, 180) || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "tags")) {
    patch.tags = cleanTags(body.tags);
  }
  if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
    patch.is_active = Boolean(body.is_active);
  }
  if (Object.prototype.hasOwnProperty.call(body, "source")) {
    patch.source = cleanText(body.source, 80) || "mediatheque";
  }

  const { data: updatedRows, error } = await supabaseAdmin
    .from("pro_media_library")
    .update(patch)
    .eq("id", id)
    .eq("user_id", activeUserId)
    .neq("source", AI_MEDIA_GENERATION_DRAFT_SOURCE)
    .select("id");

  if (error) {
    if (tableMissingError(error)) return jsonError("La table pro_media_library n’existe pas encore.", 503, error.message);
    return jsonError("Impossible de mettre à jour le média.", 500, error.message);
  }
  const data = updatedRows?.[0] ?? null;
  if (!data) return jsonError("Média introuvable.", 404);

  return NextResponse.json({ ok: true, item: data });
}

export async function DELETE(request: NextRequest) {
  const { user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const forceDelete = url.searchParams.get("force") === "1" || Boolean(body?.force);

  const requestedIds = [
    cleanText(url.searchParams.get("id"), 80),
    ...url.searchParams.getAll("ids").map((value) => cleanText(value, 80)),
    ...(Array.isArray(body?.ids)
      ? body.ids.map((value: unknown) => cleanText(value, 80))
      : []),
  ]
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, 200);

  if (!requestedIds.length) return jsonError("Média obligatoire.", 400);

  const { data: rows, error: fetchError } = await supabaseAdmin
    .from("pro_media_library")
    .select("id,bucket_name,storage_path,source")
    .eq("user_id", activeUserId)
    .in("id", requestedIds);

  if (fetchError) {
    if (tableMissingError(fetchError)) return jsonError("La table pro_media_library n’existe pas encore.", 503, fetchError.message);
    return jsonError("Impossible de retrouver les médias.", 500, fetchError.message);
  }

  const foundRows = Array.isArray(rows) ? rows : [];
  if (!foundRows.length) return jsonError("Média introuvable.", 404);
  if (
    foundRows.some(
      (row: any) => row.source === AI_MEDIA_GENERATION_DRAFT_SOURCE,
    )
  ) {
    return jsonError(
      "Cet aperçu IA doit être validé ou abandonné depuis l’outil de génération.",
      409,
    );
  }

  for (const row of foundRows as any[]) {
    const storagePath = String(row.storage_path || "");
    if (!isOwnedStoragePath(activeUserId, storagePath)) return jsonError("Chemin Storage invalide.", 403);
  }

  if (!forceDelete) {
    let usages: MediaDeleteUsage[] = [];
    try {
      usages = await findProtectedMediaUsages(
        activeUserId,
        (foundRows as any[]).map((row) => ({
          id: String(row.id || ""),
          bucket_name: String(row.bucket_name || BUCKET),
          storage_path: String(row.storage_path || ""),
        })),
      );
    } catch (usageError) {
      return jsonError(
        "Impossible de vérifier si ce média est utilisé par iNr’Agent.",
        500,
        usageError instanceof Error ? usageError.message : usageError,
      );
    }

    if (usages.length) {
      return NextResponse.json(
        {
          ok: false,
          requiresConfirmation: true,
          error:
            "Ce média est utilisé dans iNr’Agent, une programmation, une campagne ou un brouillon. Confirmez la suppression pour continuer.",
          usageCount: usages.length,
          usages: usages.slice(0, 20),
        },
        { status: 409 },
      );
    }
  }

  const foundIds = (foundRows as any[])
    .map((row) => String(row.id || ""))
    .filter(Boolean);
  const videoDerivativePaths = await loadInrAgentVideoDerivativePaths({
    userId: activeUserId,
    mediaIds: foundIds,
  });

  const pathsByBucket = new Map<string, string[]>();
  for (const row of foundRows as any[]) {
    const bucket = String(row.bucket_name || BUCKET);
    const storagePath = String(row.storage_path || "");
    if (!storagePath) continue;
    const paths = pathsByBucket.get(bucket) || [];
    paths.push(storagePath);
    const derivatives = videoDerivativePaths.get(String(row.id || ""));
    if (derivatives?.bucket === bucket) {
      paths.push(...derivatives.paths);
    } else if (derivatives?.paths.length) {
      const derivativeBucketPaths = pathsByBucket.get(derivatives.bucket) || [];
      derivativeBucketPaths.push(...derivatives.paths);
      pathsByBucket.set(derivatives.bucket, derivativeBucketPaths);
    }
    pathsByBucket.set(bucket, paths);
  }

  for (const [bucket, rawPaths] of pathsByBucket.entries()) {
    const paths = Array.from(new Set(rawPaths));
    const remove = await supabaseAdmin.storage.from(bucket).remove(paths);
    if (remove.error) return jsonError("Impossible de supprimer les fichiers Storage.", 500, remove.error.message);
  }

  const del = await supabaseAdmin
    .from("pro_media_library")
    .delete()
    .eq("user_id", activeUserId)
    .in("id", foundIds);
  if (del.error) return jsonError("Impossible de supprimer les lignes Supabase.", 500, del.error.message);

  return NextResponse.json({ ok: true, deleted: foundIds.length });
}
