import { NextRequest, NextResponse } from "next/server";

import { verifyMediaLibraryContentToken } from "@/lib/mediaLibraryContentUrl";
import { requireUser } from "@/lib/requireUser";
import {
  createSafeStorageSignedUrl,
  probeStorageObject,
} from "@/lib/safeStorageSignedUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function notFound() {
  return NextResponse.json({ error: "Média introuvable." }, { status: 404 });
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

  if (!id || !verifyMediaLibraryContentToken(id, token)) return notFound();

  const { data: row, error } = await supabaseAdmin
    .from("pro_media_library")
    .select("id,user_id,bucket_name,storage_path,mime_type,is_active")
    .eq("id", id)
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (error || !row || row.is_active === false) return notFound();

  const bucket = String(row.bucket_name || "inrcy-pro-media").trim();
  const storagePath = String(row.storage_path || "").trim();
  if (!bucket || !storagePath) return notFound();

  const probe = await probeStorageObject(bucket, storagePath);
  if (probe === "unknown") {
    return NextResponse.json(
      { error: "Stockage momentanément indisponible." },
      { status: 503 },
    );
  }
  if (probe === "missing") {
    await supabaseAdmin
      .from("pro_media_library")
      .update({ is_active: false })
      .eq("id", id)
      .eq("user_id", row.user_id);
    return notFound();
  }

  // Never proxy the object through the Vercel function: a 100-300 MB Blob would
  // be fully materialized in memory and could terminate the process. A 307 keeps
  // Range requests intact while Supabase Storage streams the bytes directly.
  const signedUrl = await createSafeStorageSignedUrl(bucket, storagePath, 120);
  if (!signedUrl) {
    return NextResponse.json(
      { error: "Lecture du média momentanément indisponible." },
      { status: 503 },
    );
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
