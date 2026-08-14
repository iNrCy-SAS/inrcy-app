import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { safeErrorMessage } from "@/lib/tsSafe";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ fileId?: string }>;
};

function encodeContentDisposition(filename: string) {
  const fallback = filename.replace(/[\r\n"]/g, "_") || "piece-jointe";
  const encoded = encodeURIComponent(filename || "piece-jointe");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_req: Request, context: RouteContext) {
  const { user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  try {
    const params = await context.params;
    const fileId = String(params?.fileId || "").trim();
    if (!fileId) {
      return NextResponse.json({ error: "Fichier introuvable." }, { status: 400 });
    }

    const { data: file, error } = await supabaseAdmin
      .from("inrsend_history_files")
      .select("id, user_id, category, file_role, file_name, mime_type, size_bytes, storage_bucket, storage_path")
      .eq("id", fileId)
      .eq("user_id", activeUserId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: getSimpleFrenchErrorMessage(error, "Impossible de télécharger ce fichier.") }, { status: 500 });
    }
    if (!file?.id) {
      return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
    }

    const dashboardEdition = await getDashboardEditionForAccountId(activeUserId);
    const isPublicationFile =
      String(file.category || "").trim().toLowerCase() === "publications" ||
      String(file.file_role || "").trim().toLowerCase() === "publication_media";
    if (dashboardEdition === "standard" && !isPublicationFile) {
      return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
    }

    const bucket = String(file.storage_bucket || "").trim();
    const path = String(file.storage_path || "").trim();
    if (!bucket || !path) {
      return NextResponse.json({ error: "Fichier mal configuré." }, { status: 500 });
    }

    const { data: blob, error: downloadError } = await supabaseAdmin.storage.from(bucket).download(path);
    if (downloadError || !blob) {
      return NextResponse.json({ error: "Fichier indisponible." }, { status: 404 });
    }

    const arrayBuffer = await blob.arrayBuffer();
    const fileName = String(file.file_name || path.split("/").pop() || "piece-jointe");
    const mimeType = String(file.mime_type || blob.type || "application/octet-stream");
    const headers = new Headers({
      "Content-Type": mimeType,
      "Content-Disposition": encodeContentDisposition(fileName),
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    });
    const size = Number(file.size_bytes || arrayBuffer.byteLength || 0);
    if (Number.isFinite(size) && size > 0) headers.set("Content-Length", String(size));

    return new Response(arrayBuffer, { status: 200, headers });
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error) || "Téléchargement impossible pour le moment." },
      { status: 500 },
    );
  }
}
