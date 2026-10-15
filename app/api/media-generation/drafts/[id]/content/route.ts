import { NextResponse } from "next/server";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Read-only, account-bound preview. Renew signatures without promoting the draft. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const reply = (status: number, error: string) => NextResponse.json({ error }, { status, headers: HEADERS });
  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) return reply(401, "Non authentifié.");
    const { id } = await context.params;
    if (!UUID.test(id)) return reply(404, "Média introuvable.");
    const accountId = current.scope.activeUserId;
    const { data: row, error } = await supabaseAdmin.from("pro_media_library")
      .select("id,bucket_name,storage_path,source,is_active,upload_status,media_metadata")
      .eq("id", id).eq("user_id", accountId).maybeSingle();
    if (error) return reply(503, "Lecture du média momentanément indisponible.");
    const draft = row?.source === "ai_media_generation_draft" && row.is_active === false;
    const accepted = row?.source === "ai_media_generation" && row.is_active === true;
    if (!row || (!draft && !accepted) || row.upload_status !== "uploaded") return reply(404, "Média introuvable.");
    const path = String(row.storage_path || "");
    if (row.bucket_name !== "inrcy-pro-media" || !path.startsWith(`users/${accountId}/ai-generated/`) ||
      path.split("/").some((part) => part === ".." || part === "." || !part) || path.includes("\\")) {
      return reply(404, "Média introuvable.");
    }
    // Retention is enforced by the cleanup job, just like acceptance/status.
    // A still-present draft must not recover successfully then show a broken preview.
    const signedUrl = await createSafeStorageSignedUrl("inrcy-pro-media", path, 600);
    if (!signedUrl) return reply(503, "Lecture du média momentanément indisponible.");
    // Storage streams large files directly; a 307 preserves byte-range requests.
    return new Response(null, { status: 307, headers: { ...HEADERS, Location: signedUrl } });
  } catch {
    return reply(503, "Lecture du média momentanément indisponible.");
  }
}
