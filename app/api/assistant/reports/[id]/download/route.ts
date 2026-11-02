import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ownedInrAssistantStatsReportDocument } from "@/lib/inrAssistantStatsReportDocument";

export const runtime = "nodejs";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const unavailable = (status: number) => Response.json({ error: status === 410 ? "Ce bilan PDF n’est plus disponible." : status === 503 ? "Le bilan est momentanément indisponible." : "Bilan introuvable dans cet établissement." }, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(); if (auth.errorResponse) return auth.errorResponse;
    const { id } = await context.params;
    if (!UUID.test(id) || !auth.activeUserId || request.signal.aborted) return unavailable(404);
    const result = await supabaseAdmin.from("inr_agent_actions").select("id,user_id,automation_key,action_type,target_tool,payload")
      .eq("user_id", auth.activeUserId).eq("id", id).eq("automation_key", "stats").eq("action_type", "stats_report").eq("target_tool", "inrstats")
      .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(8000)])).maybeSingle();
    if (result.error) return unavailable(503);
    const record = row(result.data);
    if (record.id !== id || record.user_id !== auth.activeUserId || record.automation_key !== "stats" || record.action_type !== "stats_report" || record.target_tool !== "inrstats") return unavailable(404);
    const document = ownedInrAssistantStatsReportDocument(row(record.payload).reportDocument, auth.activeUserId);
    if (!document) return unavailable(410);
    const file = await supabaseAdmin.storage.from(document.bucket).download(document.storagePath);
    if (file.error) return unavailable(String(row(file.error).statusCode || row(file.error).status) === "404" ? 410 : 503);
    if (!file.data) return unavailable(410);
    if (file.data.size <= 0 || file.data.size > 8 * 1024 * 1024) return unavailable(410);
    const content = await file.data.arrayBuffer();
    if (new TextDecoder().decode(content.slice(0, 5)) !== "%PDF-") return unavailable(410);
    const current = await requireUser();
    if (current.errorResponse || current.activeUserId !== auth.activeUserId || current.authUserId !== auth.authUserId || request.signal.aborted) return unavailable(404);
    return new Response(content, { headers: { "Content-Type": "application/pdf", "Content-Length": String(content.byteLength), "Content-Disposition": `attachment; filename="bilan-inrstats.pdf"; filename*=UTF-8''${encodeURIComponent(document.filename)}`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" } });
  } catch { return unavailable(503); }
}
