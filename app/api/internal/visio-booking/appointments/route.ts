import { NextResponse } from "next/server";

import { syncVisioSharedCalendarToInrCalendar } from "@/lib/inrCalendarGoogleSync";
import { requireVisioTeamApi } from "@/lib/visioTeamAccess";
import {
  getVisioTeamMembers,
  listVisioTeamAppointments,
  reassignVisioTeamAppointment,
} from "@/lib/visioBookingGoogle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isCrossSiteMutation(request: Request) {
  const fetchSite = String(request.headers.get("sec-fetch-site") || "").toLowerCase();
  return fetchSite === "cross-site";
}

function assignmentErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message.split(":")[0] : "unknown_error";
  if (code === "visio_slot_busy") {
    return NextResponse.json(
      { ok: false, error: "Ce rendez-vous est déjà en cours de modification." },
      { status: 409 },
    );
  }
  if (code === "visio_team_assignment_sync_busy") {
    return NextResponse.json(
      {
        ok: false,
        error: "Une synchronisation Google est en cours. Réessayez dans quelques secondes.",
      },
      { status: 409 },
    );
  }
  if (
    code === "visio_team_assignment_invalid" ||
    code === "visio_team_assignment_mirror_missing" ||
    code === "visio_team_assignment_source_missing"
  ) {
    return NextResponse.json(
      { ok: false, error: "Ce rendez-vous n’est plus disponible. Actualisez la liste." },
      { status: 404 },
    );
  }
  if (code === "visio_team_assignment_external_organizer") {
    return NextResponse.json(
      {
        ok: false,
        error: "Ce rendez-vous appartient à un organisateur externe et ne peut pas être réattribué.",
      },
      { status: 409 },
    );
  }
  console.error(
    "[visio-booking][team-appointments-api]",
    error instanceof Error ? error.message : "unknown_error",
  );
  return NextResponse.json(
    { ok: false, error: "La réattribution n’a pas pu être finalisée. Réessayez." },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const authorization = await requireVisioTeamApi();
  if (!authorization.ok) return authorization.response;

  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const appointments = await listVisioTeamAppointments({
      // The team screen is a focused operational history: one week behind,
      // then the two coming weeks, whatever the appointment category.
      pastDays: 7,
      futureDays: 14,
      // The cron keeps the shared calendar synchronized. A full Google refresh
      // is only requested explicitly from the team screen.
      refresh,
    });
    const inrCalendarSync = refresh
      ? await syncVisioSharedCalendarToInrCalendar({ pastDays: 30, futureDays: 365 })
      : null;
    return NextResponse.json({
      ok: true,
      appointments,
      inrCalendarSynced: inrCalendarSync?.ok ?? null,
      members: getVisioTeamMembers().map(({ id, name }) => ({ id, name })),
      viewer: {
        email: authorization.actor.email,
        name: authorization.actor.name,
      },
    });
  } catch (error) {
    return assignmentErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const authorization = await requireVisioTeamApi();
  if (!authorization.ok) return authorization.response;
  if (isCrossSiteMutation(request)) {
    return NextResponse.json({ ok: false, error: "Requête non autorisée." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as {
    mirrorEventId?: unknown;
    appointmentIdentity?: unknown;
    appointmentStart?: unknown;
    targetMemberId?: unknown;
  } | null;
  const mirrorEventId = String(body?.mirrorEventId || "").trim();
  const appointmentIdentity = String(body?.appointmentIdentity || "").trim();
  const appointmentStart = String(body?.appointmentStart || "").trim();
  const targetMemberId = String(body?.targetMemberId || "").trim();
  if (
    !/^[a-zA-Z0-9_-]{5,1024}$/.test(mirrorEventId) ||
    (appointmentIdentity && appointmentIdentity.length > 2048) ||
    (appointmentStart && !Number.isFinite(new Date(appointmentStart).getTime())) ||
    !getVisioTeamMembers().some((member) => member.id === targetMemberId)
  ) {
    return NextResponse.json({ ok: false, error: "Demande invalide." }, { status: 400 });
  }

  try {
    const result = await reassignVisioTeamAppointment({
      mirrorEventId,
      appointmentIdentity,
      appointmentStart,
      targetMemberId,
      actor: authorization.actor,
    });
    const inrCalendarSync = await syncVisioSharedCalendarToInrCalendar({
      pastDays: 30,
      futureDays: 365,
    }).catch((error: unknown) => {
      console.error(
        "[visio-booking][inrcalendar-sync-after-reassignment]",
        error instanceof Error ? error.message : "unknown_error",
      );
      return null;
    });
    if (inrCalendarSync && !inrCalendarSync.ok) {
      console.error(
        "[visio-booking][inrcalendar-sync-after-reassignment]",
        inrCalendarSync.errors.join(",") || "sync_failed",
      );
    }
    return NextResponse.json({
      ok: true,
      ...result,
      inrCalendarSynced: inrCalendarSync?.ok ?? false,
    });
  } catch (error) {
    return assignmentErrorResponse(error);
  }
}
