import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { syncVisioSharedCalendarToInrCalendar } from "@/lib/inrCalendarGoogleSync";
import { syncVisioTeamCalendarsToShared } from "@/lib/visioBookingGoogle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function syncErrorCode(error: unknown) {
  return error instanceof Error
    ? error.message.split(":")[0].slice(0, 100)
    : "unknown_sync_error";
}

export async function GET(request: Request) {
  const hasHeaderCredential =
    (request.headers.get("authorization") || "").startsWith("Bearer ") ||
    Boolean((request.headers.get("x-cron-secret") || "").trim());
  if (!hasHeaderCredential || !isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    let teamCalendar:
      | Awaited<ReturnType<typeof syncVisioTeamCalendarsToShared>>
      | { ok: false; errors: Array<{ memberId: "system"; code: string }> };
    try {
      teamCalendar = await syncVisioTeamCalendarsToShared();
    } catch (error) {
      teamCalendar = {
        ok: false,
        errors: [{ memberId: "system", code: syncErrorCode(error) }],
      };
    }
    const inrCalendar = await syncVisioSharedCalendarToInrCalendar();
    const ok = teamCalendar.ok && inrCalendar.ok;
    if (!ok) {
      console.error("[visio-calendar-sync][partial]", {
        teamCalendar: teamCalendar.errors,
        inrCalendar: inrCalendar.errors,
      });
    }
    return NextResponse.json({ ok, teamCalendar, inrCalendar }, {
      status: ok ? 200 : 503,
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
