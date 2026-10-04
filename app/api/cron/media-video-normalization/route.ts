import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pro + Fluid Compute: enough budget for one bounded probe or capture mission
// on an accepted original (75,000,000 bytes maximum). No compression runs here.
export const maxDuration = 1800;

function isAuthorizedCron(req: Request) {
  const cronSecret =
    process.env.VERCEL_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!cronSecret) return false;
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerSecret = (req.headers.get("x-cron-secret") || "").trim();
  const querySecret = new URL(req.url).searchParams.get("secret") || "";
  return (
    bearer === cronSecret ||
    headerSecret === cronSecret ||
    querySecret === cronSecret
  );
}

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const startedAt = Date.now();
  const requestId = req.headers.get("x-vercel-id");
  let stage = "queue_import";
  console.info("[media-pipeline] video normalization cron entered", { requestId });

  try {
    const { repairPendingVideoNormalizationQueue } = await import(
      "@/lib/mediaVideoNormalizationQueue"
    );
    stage = "worker_import";
    const { processVideoNormalizationJobs } = await import(
      "@/lib/mediaVideoNormalizationWorker"
    );
    console.info("[media-pipeline] video normalization worker_loaded", {
      requestId,
      elapsedMs: Date.now() - startedAt,
    });
    stage = "queue_repair";
    const repaired = await repairPendingVideoNormalizationQueue({ limit: 10 });
    stage = "worker_execution";
    const processed = await processVideoNormalizationJobs({ limit: 1 });
    stage = "response";
    console.info("[media-pipeline] video normalization completed", {
      requestId,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      success: true,
      repaired,
      processed,
    });
  } catch (error) {
    console.error(
      "[media-pipeline] video normalization cron failed",
      {
        requestId,
        stage,
        reason: error instanceof Error ? error.name : typeof error,
        elapsedMs: Date.now() - startedAt,
      },
      error,
    );
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Traitement des vidéos impossible.",
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return POST(req);
}
