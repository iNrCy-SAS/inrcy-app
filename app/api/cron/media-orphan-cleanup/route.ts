import { NextResponse } from "next/server";
import { purgeExpiredGeneratedAiMediaDrafts } from "@/lib/aiGeneratedMediaRegistry";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isAuthorizedCron(request: Request) {
  const secret =
    process.env.VERCEL_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!secret) return false;
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerSecret = (request.headers.get("x-cron-secret") || "").trim();
  const querySecret = new URL(request.url).searchParams.get("secret") || "";
  return (
    bearer === secret || headerSecret === secret || querySecret === secret
  );
}

async function runCleanup(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ ok: false, error: "Non autorisé." }, { status: 401 });
  }

  const generatedDrafts = await purgeExpiredGeneratedAiMediaDrafts({
    limit: 50,
  }).catch((error) => ({
    inspected: 0,
    discarded: 0,
    accepted: 0,
    errors: [
      {
        mediaId: "ai-generated-drafts",
        error: error instanceof Error ? error.message : String(error),
      },
    ],
  }));

  const now = new Date().toISOString();
  const candidates = await supabaseAdmin
    .from("pro_media_library")
    .select(
      "id,user_id,bucket_name,storage_path,canonical_bucket_name,canonical_storage_path",
    )
    .eq("source", "booster_workspace")
    .eq("is_active", true)
    .is("original_deleted_at", null)
    .not("original_retention_until", "is", null)
    .lte("original_retention_until", now)
    .limit(50);
  if (candidates.error) throw candidates.error;

  let removed = 0;
  let retained = 0;
  const errors: Array<{ mediaId: string; error: string }> = [];

  for (const media of candidates.data || []) {
    const mediaId = String(media.id || "");
    if (!mediaId) continue;
    try {
      const associations = await supabaseAdmin
        .from("publication_workspace_media")
        .select("media_id", { count: "exact", head: true })
        .eq("media_id", mediaId);
      if (associations.error) throw associations.error;
      if ((associations.count || 0) > 0) {
        retained += 1;
        const reset = await supabaseAdmin
          .from("pro_media_library")
          .update({ original_retention_until: null })
          .eq("id", mediaId)
          .eq("user_id", media.user_id);
        if (reset.error) throw reset.error;
        continue;
      }

      const variants = await supabaseAdmin
        .from("media_variants")
        .select("id,bucket_name,storage_path")
        .eq("media_id", mediaId)
        .eq("account_id", media.user_id)
        .neq("status", "removed");
      if (variants.error) throw variants.error;

      const pathsByBucket = new Map<string, Set<string>>();
      const addPath = (bucketValue: unknown, pathValue: unknown) => {
        const bucket = String(bucketValue || "").trim();
        const storagePath = String(pathValue || "").trim();
        if (!bucket || !storagePath) return;
        if (!pathsByBucket.has(bucket)) pathsByBucket.set(bucket, new Set());
        pathsByBucket.get(bucket)?.add(storagePath);
      };
      addPath(media.bucket_name, media.storage_path);
      addPath(media.canonical_bucket_name, media.canonical_storage_path);
      for (const variant of variants.data || []) {
        addPath(variant.bucket_name, variant.storage_path);
      }

      for (const [bucket, paths] of pathsByBucket) {
        const deletion = await supabaseAdmin.storage
          .from(bucket)
          .remove(Array.from(paths));
        if (deletion.error) throw deletion.error;
      }

      const markedVariants = await supabaseAdmin
        .from("media_variants")
        .update({
          status: "removed",
          error_code: "orphan_retention_expired",
          error_message: "Média détaché supprimé après le délai de récupération.",
        })
        .eq("media_id", mediaId)
        .eq("account_id", media.user_id);
      if (markedVariants.error) throw markedVariants.error;

      const markedMedia = await supabaseAdmin
        .from("pro_media_library")
        .update({
          is_active: false,
          upload_status: "removed",
          publication_status: "removed",
          original_deleted_at: now,
          original_retention_until: null,
        })
        .eq("id", mediaId)
        .eq("user_id", media.user_id);
      if (markedMedia.error) throw markedMedia.error;
      removed += 1;
    } catch (error) {
      errors.push({
        mediaId,
        error:
          error instanceof Error ? error.message : "Nettoyage du média impossible.",
      });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0 && generatedDrafts.errors.length === 0,
    inspected: candidates.data?.length || 0,
    removed,
    retained,
    errors,
    generatedDrafts,
  });
}

export async function GET(request: Request) {
  try {
    return await runCleanup(request);
  } catch (error) {
    console.error("[media-pipeline] orphan cleanup failed", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Nettoyage des médias orphelins impossible.",
      },
      { status: 500 },
    );
  }
}

export const POST = GET;
