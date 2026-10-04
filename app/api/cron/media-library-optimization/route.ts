import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 1_800;

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const requestId = request.headers.get("x-vercel-id");
  let stage = "worker_import";
  console.info("[media-library-optimization] cron entered", { requestId });

  try {
    const { processMediaLibraryOptimizationJobs } = await import(
      "@/lib/mediaLibraryOptimizationWorker"
    );
    console.info("[media-library-optimization] worker_loaded", {
      requestId,
      elapsedMs: Date.now() - startedAt,
    });
    stage = "worker_execution";
    const result = await processMediaLibraryOptimizationJobs({ limit: 1 });
    stage = "response";
    console.info("[media-library-optimization] completed", {
      requestId,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      "[media-library-optimization] cron failed",
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
        ok: false,
        error: error instanceof Error ? error.message : "Worker indisponible.",
      },
      { status: 500 },
    );
  }
}

export const GET = POST;
