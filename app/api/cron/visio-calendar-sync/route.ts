import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { syncVisioSharedCalendarToInrCalendar } from "@/lib/inrCalendarGoogleSync";
import {
  reconcileVisioBookingConfirmationIntents,
  reconcileVisioBookingInternalAlertIntents,
  syncVisioTeamCalendarsToShared,
} from "@/lib/visioBookingGoogle";
import { ensureVisioCalendarWatches } from "@/lib/visioCalendarWatch";
import { processVisioBookingInternalAlerts } from "@/lib/visioBookingInternalAlert";
import { processVisioBookingConfirmations } from "@/lib/visioBookingConfirmation";

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
    const bookingAlertIntents = await reconcileVisioBookingInternalAlertIntents(10)
      .catch((error: unknown) => ({
        ok: false as const,
        scanned: 0,
        promoted: 0,
        waiting: 0,
        discarded: 0,
        error: syncErrorCode(error),
      }));
    const bookingAlerts = await processVisioBookingInternalAlerts({ limit: 10 })
      .catch((error: unknown) => ({
        ok: false as const,
        claimed: 0,
        accepted: 0,
        retrying: 0,
        dead: 0,
        uncertain: 0,
        error: syncErrorCode(error),
      }));
    const bookingConfirmationIntents = await reconcileVisioBookingConfirmationIntents(10)
      .catch((error: unknown) => ({
        ok: false as const,
        scanned: 0,
        promoted: 0,
        waiting: 0,
        discarded: 0,
        error: syncErrorCode(error),
      }));
    const bookingConfirmations = await processVisioBookingConfirmations({ limit: 10 })
      .catch((error: unknown) => ({
        ok: false as const,
        claimed: 0,
        accepted: 0,
        retrying: 0,
        dead: 0,
        uncertain: 0,
        error: syncErrorCode(error),
      }));
    const watches = await ensureVisioCalendarWatches().catch((error: unknown) => ({
      ok: false,
      configured: false,
      created: 0,
      active: 0,
      errors: [{ calendarId: "system", code: syncErrorCode(error) }],
    }));
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
    // If another worker owns the full team reconciliation, it will also make
    // the shared event canonical. Avoid doubling Google reads during that run.
    const inrCalendar = "locked" in teamCalendar && teamCalendar.locked
      ? { ok: true as const, skipped: true as const, reason: "team_sync_locked", errors: [] }
      : await syncVisioSharedCalendarToInrCalendar();
    const ok = bookingAlertIntents.ok && bookingAlerts.ok && bookingConfirmationIntents.ok && bookingConfirmations.ok && teamCalendar.ok && inrCalendar.ok && watches.ok;
    if (!ok) {
      console.error("[visio-calendar-sync][partial]", {
        bookingAlertIntents,
        bookingAlerts,
        bookingConfirmationIntents,
        bookingConfirmations,
        teamCalendar: teamCalendar.errors,
        inrCalendar: inrCalendar.errors,
        watches: watches.errors,
      });
    }
    return NextResponse.json({ ok, bookingAlertIntents, bookingAlerts, bookingConfirmationIntents, bookingConfirmations, watches, teamCalendar, inrCalendar }, {
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
