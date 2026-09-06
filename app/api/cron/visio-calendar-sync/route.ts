import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { syncVisioTeamCalendarsToShared } from "@/lib/visioBookingGoogle";

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
    const result = await syncVisioTeamCalendarsToShared();
    if (!result.ok) {
      console.error("[visio-calendar-sync][partial]", result.errors);
    }
    return NextResponse.json(result, {
      status: result.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      "[visio-calendar-sync][failed]",
      error instanceof Error ? error.message : "sync_failed",
    );
    return NextResponse.json(
      { ok: false, error: "visio_calendar_sync_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
