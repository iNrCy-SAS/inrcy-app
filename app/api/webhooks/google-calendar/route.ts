import { after, NextResponse } from "next/server";

import { syncVisioSharedCalendarToInrCalendar } from "@/lib/inrCalendarGoogleSync";
import {
  syncVisioTeamCalendarsToShared,
} from "@/lib/visioBookingGoogle";
import {
  calendarIdFromVisioWatchToken,
  claimVisioCalendarWebhookSync,
  isWatchedVisioCalendar,
} from "@/lib/visioCalendarWatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export async function POST(request: Request) {
  const channelId = String(request.headers.get("x-goog-channel-id") || "").trim();
  const resourceState = normalized(request.headers.get("x-goog-resource-state"));
  const calendarId = calendarIdFromVisioWatchToken(
    request.headers.get("x-goog-channel-token"),
  );
  if (
    !channelId ||
    !calendarId ||
    !isWatchedVisioCalendar(calendarId) ||
    !["sync", "exists", "not_exists"].includes(resourceState)
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_google_calendar_notification" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Google sends this handshake when a watch channel is created. It does not
  // describe an event mutation and must not trigger a full multi-calendar sync.
  if (resourceState === "sync") {
    return NextResponse.json(
      { ok: true, accepted: true, ignored: "initial_sync" },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!(await claimVisioCalendarWebhookSync())) {
    return NextResponse.json(
      { ok: true, accepted: true, coalesced: true },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }

  after(async () => {
    try {
      // The shared calendar also receives the raw signup reminder. Running the
      // team reconciliation on every trusted notification attributes it at
      // once; the second notification caused by that patch is idempotent.
      const teamCalendar = await syncVisioTeamCalendarsToShared();
      if (!teamCalendar.locked) {
        await syncVisioSharedCalendarToInrCalendar();
      }
    } catch (error) {
      console.error(
        "[google-calendar-webhook][sync-failed]",
        error instanceof Error ? error.message : "sync_failed",
      );
    }
  });

  return NextResponse.json(
    { ok: true, accepted: true },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
