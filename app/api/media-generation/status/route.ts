import { NextResponse } from "next/server";

import { getExistingGeneratedAiMediaContext } from "@/lib/aiGeneratedMediaRegistry";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const REQUEST_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{7,179}$/i;
const FORMATS = ["square", "portrait", "story", "landscape"] as const;
type Job = {
  id: string;
  status: "reserved" | "processing" | "completed" | "failed" | "expired";
  metadata: { format?: unknown } | null;
};

/** Recover an existing attempt without reserving credits or starting AI work. */
export async function GET(request: Request) {
  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", error: "Non authentifié." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
    const requestId = new URL(request.url).searchParams.get("requestId") || "";
    if (!REQUEST_KEY_PATTERN.test(requestId)) return NextResponse.json(
      { ok: false, code: "AI_MEDIA_REQUEST_ID_INVALID", error: "Identifiant de génération invalide." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
    const accountId = current.scope.activeUserId;
    const result = await supabaseAdmin.from("ai_media_generation_jobs")
      .select("id,status,metadata").eq("account_id", accountId)
      .eq("request_key", requestId).maybeSingle();
    if (result.error) throw result.error;
    const job = result.data as Job | null;
    if (!job) return NextResponse.json(
      { ok: false, status: "missing", code: "AI_MEDIA_GENERATION_NOT_FOUND" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
    if (job.status === "completed") {
      const context = await getExistingGeneratedAiMediaContext({ accountId, jobId: job.id });
      if (!context) return NextResponse.json(
        { ok: false, status: "completed", code: "AI_MEDIA_RESULT_UNAVAILABLE", error: "Le média enregistré n’est plus disponible." },
        { status: 410, headers: NO_STORE_HEADERS },
      );
      const format = FORMATS.find((value) => value === job.metadata?.format);
      return NextResponse.json({
        ok: true, status: "completed", ...context, ...(format ? { format } : {}),
        soundtrack: null, videoEngineResult: null, recovered: true,
      }, { headers: NO_STORE_HEADERS });
    }
    if (job.status === "failed" || job.status === "expired") return NextResponse.json(
      { ok: true, status: job.status }, { headers: NO_STORE_HEADERS },
    );
    return NextResponse.json({ ok: true, status: "processing" }, { status: 202, headers: NO_STORE_HEADERS });
  } catch {
    // Provider diagnostics and raw job metadata never belong in this response.
    return NextResponse.json(
      { ok: false, code: "AI_MEDIA_STATUS_UNAVAILABLE", error: "La vérification de la génération est momentanément indisponible." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
