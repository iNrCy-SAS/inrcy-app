import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/adminSecurity";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  VISIO_BOOKING_INTEGRATION,
  getVisioSharedCalendarAccess,
  getVisioTeamMembers,
  getVisioTeamCalendarAccess,
} from "@/lib/visioBookingGoogle";

export const runtime = "nodejs";

export async function GET() {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("status,email_address,expires_at,updated_at")
    .eq("provider", "google")
    .eq("source", VISIO_BOOKING_INTEGRATION.source)
    .eq("product", VISIO_BOOKING_INTEGRATION.product)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Impossible de lire la configuration." },
      { status: 503 },
    );
  }
  const row = (data || {}) as Record<string, unknown>;
  const connected = row.status === "connected";
  const sharedCalendarConfigured = Boolean(process.env.INRCY_VISIO_SHARED_CALENDAR_ID);
  const [calendarAccess, sharedCalendarAccess] = connected
    ? await Promise.all([
        getVisioTeamCalendarAccess().catch(() => null),
        sharedCalendarConfigured
          ? getVisioSharedCalendarAccess().catch(() => null)
          : Promise.resolve(null),
      ])
    : [null, null];
  return NextResponse.json({
    ok: true,
    connected,
    account: typeof row.email_address === "string" ? row.email_address : null,
    shared_calendar_configured: sharedCalendarConfigured,
    shared_calendar_access: sharedCalendarAccess,
    team: getVisioTeamMembers().map((member) => ({
      id: member.id,
      name: member.name,
      email: member.email,
      calendar_configured: Boolean(member.calendarId),
    })),
    calendar_access: calendarAccess,
  });
}
