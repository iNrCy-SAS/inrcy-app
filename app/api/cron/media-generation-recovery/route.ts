import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { recoverNextAiMediaCompositionCheckpoint } from "@/lib/aiMediaCompositionRecovery";
import { expireAiMediaGenerationReservations } from "@/lib/aiMediaGenerationQuota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/** One leased montage per invocation; never submits a generation to an AI provider. */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const started = Date.now();
  try {
    const result = await recoverNextAiMediaCompositionCheckpoint();
    const expired = await expireAiMediaGenerationReservations({ batchSize: 100 });
    console.info("[ai-media] composition recovery processed", {
      outcome: result.status, elapsedMs: Date.now() - started,
      ...(result.status !== "idle" ? { jobId: result.jobId } : {}), expired,
    });
    return NextResponse.json({ ok: result.status !== "failed", result, expired }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    console.error("[ai-media] composition recovery unavailable", { elapsedMs: Date.now() - started });
    return NextResponse.json({ ok: false, code: "AI_MEDIA_RECOVERY_UNAVAILABLE" }, { status: 503 });
  }
}
export const POST = GET;
