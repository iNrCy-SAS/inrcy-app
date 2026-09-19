import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { processMetaConversionEvents } from "@/lib/metaConversionOutbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const hasHeaderCredential =
    (request.headers.get("authorization") || "").startsWith("Bearer ") ||
    Boolean((request.headers.get("x-cron-secret") || "").trim());
  if (!hasHeaderCredential || !isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processMetaConversionEvents({ limit: 10 });
    if (!result.ok) {
      console.error("[meta-conversions][partial]", result);
    }
    return NextResponse.json(result, {
      status: result.uncertain > 0 ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      "[meta-conversions][failed]",
      error instanceof Error ? error.message : "meta_conversion_worker_failed",
    );
    return NextResponse.json(
      { ok: false, error: "meta_conversion_worker_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
