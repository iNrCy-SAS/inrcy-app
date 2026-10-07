import { NextRequest, NextResponse } from "next/server";

import { verifyMediaLibraryContentToken } from "@/lib/mediaLibraryContentUrl";
import { requireUser } from "@/lib/requireUser";
import {
  createSafeStorageSignedUrl,
  probeStorageObject,
} from "@/lib/safeStorageSignedUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMediaImageRecoverySummary } from "@/lib/mediaImageRecoverySummary";
import { getImageNormalizationSignature } from "@/lib/mediaImageNormalizationPolicy";

export const runtime = "nodejs";

function notFound() {
  return NextResponse.json({ error: "Média introuvable." }, { status: 404 });
}

const MIME_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

function sanitizeDownloadFileName(value: unknown) {
  const leaf = String(value || "").split(/[\\/]/).pop() || "";
  return leaf
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
}

function buildDownloadFileName(row: {
  original_file_name?: unknown;
  storage_path?: unknown;
  title?: unknown;
  mime_type?: unknown;
  media_type?: unknown;
}) {
  const originalName = sanitizeDownloadFileName(row.original_file_name);
  const storageName = sanitizeDownloadFileName(row.storage_path);
  const storageExtension = storageName.match(/\.[a-z0-9]{2,10}$/i)?.[0] || "";
  const mimeExtension = MIME_EXTENSION_BY_TYPE[String(row.mime_type || "").toLowerCase()] || "";
  const extension = storageExtension || mimeExtension || (row.media_type === "video" ? ".mp4" : ".jpg");
  const baseName =
    originalName ||
    sanitizeDownloadFileName(row.title) ||
    (row.media_type === "video" ? "video-inrcy" : "image-inrcy");

  return /\.[a-z0-9]{2,10}$/i.test(baseName)
    ? baseName
    : `${baseName}${extension}`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const { id: rawId } = await context.params;
  const id = String(rawId || "").trim();
  const token = request.nextUrl.searchParams.get("token") || "";
  const downloadRequested = request.nextUrl.searchParams.get("download") === "1";
  const recoveredPreviewRequested = request.nextUrl.searchParams.get("variant") === "canonical";

  if (!id || !verifyMediaLibraryContentToken(id, token)) return notFound();

  const { data: row, error } = await supabaseAdmin
    .from("pro_media_library")
    .select("id,user_id,bucket_name,storage_path,mime_type,media_type,title,original_file_name,is_active,media_metadata")
    .eq("id", id)
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (error || !row || row.is_active === false) return notFound();

  let bucket = String(row.bucket_name || "inrcy-pro-media").trim();
  let storagePath = String(row.storage_path || "").trim();
  if (recoveredPreviewRequested) {
    if (row.media_type !== "image" || !getMediaImageRecoverySummary(row.media_metadata).requiresCanonical) return notFound();
    const variant = await supabaseAdmin.from("media_variants")
      .select("bucket_name,storage_path")
      .eq("account_id", activeUserId).eq("media_id", id)
      .eq("purpose", "canonical").eq("signature", getImageNormalizationSignature("canonical"))
      .eq("status", "ready").maybeSingle();
    if (variant.error || !variant.data) return notFound();
    bucket = String(variant.data.bucket_name || "");
    storagePath = String(variant.data.storage_path || "");
  }
  if (!bucket || !storagePath) return notFound();

  const probe = await probeStorageObject(bucket, storagePath);
  if (probe === "unknown") {
    return NextResponse.json(
      { error: "Stockage momentanément indisponible." },
      { status: 503 },
    );
  }
  if (probe === "missing") {
    if (!recoveredPreviewRequested) await supabaseAdmin
      .from("pro_media_library")
      .update({ is_active: false })
      .eq("id", id)
      .eq("user_id", row.user_id);
    return notFound();
  }

  // Never proxy the object through the Vercel function: a 100-300 MB Blob would
  // be fully materialized in memory and could terminate the process. A 307 keeps
  // Range requests intact while Supabase Storage streams the bytes directly.
  let signedUrl = await createSafeStorageSignedUrl(bucket, storagePath, 120);
  if (!signedUrl) {
    return NextResponse.json(
      { error: "Lecture du média momentanément indisponible." },
      { status: 503 },
    );
  }

  // Supabase Storage honours the `download` query parameter by returning an
  // attachment with this filename. The large file still streams directly from
  // Storage: neither Next.js nor Vercel buffers it in memory.
  if (downloadRequested) {
    const downloadUrl = new URL(signedUrl);
    downloadUrl.searchParams.set("download", buildDownloadFileName(row));
    signedUrl = downloadUrl.toString();
  }

  return new Response(null, {
    status: 307,
    headers: {
      Location: signedUrl,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
