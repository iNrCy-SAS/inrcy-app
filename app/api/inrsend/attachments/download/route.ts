import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { safeErrorMessage } from "@/lib/tsSafe";
import { ATTACHMENT_DOWNLOAD_BUCKETS, canAccountUseStorageReference, normalizeStorageDeliveryPath } from "@/lib/storageDeliveryPolicy";

export const runtime = "nodejs";

function encodeContentDisposition(filename: string) {
  const fallback = filename.replace(/[\r\n"]/g, "_") || "piece-jointe";
  const encoded = encodeURIComponent(filename || "piece-jointe");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(req: Request) {
  const { user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  try {
    const url = new URL(req.url);
    const bucket = String(url.searchParams.get("bucket") || "").trim();
    const path = normalizeStorageDeliveryPath(String(url.searchParams.get("path") || ""));
    const requestedName = String(url.searchParams.get("name") || "").trim();

    if (!bucket || !path) {
      return NextResponse.json({ error: "Pièce jointe introuvable." }, { status: 400 });
    }

    // Les pièces jointes iNr'Send sont stockées sous le préfixe utilisateur.
    // Cela évite qu'un pro puisse télécharger une pièce jointe d'un autre compte.
    if (!ATTACHMENT_DOWNLOAD_BUCKETS.has(bucket) || !canAccountUseStorageReference(bucket, path, activeUserId)) {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }

    const { data: blob, error } = await supabaseAdmin.storage.from(bucket).download(path);
    if (error || !blob) {
      return NextResponse.json({ error: "Pièce jointe indisponible." }, { status: 404 });
    }

    const arrayBuffer = await blob.arrayBuffer();
    const fileName = requestedName || path.split("/").pop() || "piece-jointe";
    const mimeType = blob.type || "application/octet-stream";
    const headers = new Headers({
      "Content-Type": mimeType,
      "Content-Disposition": encodeContentDisposition(fileName),
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    });
    headers.set("Content-Length", String(arrayBuffer.byteLength));

    return new Response(arrayBuffer, { status: 200, headers });
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error) || "Téléchargement impossible pour le moment." },
      { status: 500 },
    );
  }
}
