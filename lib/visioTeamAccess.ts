import "server-only";

import { NextResponse } from "next/server";

import { ADMIN_USER_IDS } from "@/lib/roles";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { getVisioPublicCalendarId, getVisioTeamMembers } from "@/lib/visioBookingGoogle";

export type VisioTeamActor = {
  userId: string;
  email: string;
  name: string;
};

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function getVisioTeamAllowedEmails() {
  const configured = String(process.env.INRCY_VISIO_TEAM_ACCESS_EMAILS || "")
    .split(/[;,]/)
    .map(normalizeEmail)
    .filter(Boolean);

  return new Set([
    ...getVisioTeamMembers().map((member) => normalizeEmail(member.email)),
    normalizeEmail(getVisioPublicCalendarId()),
    ...configured,
  ]);
}

export async function getVisioTeamActor(): Promise<VisioTeamActor | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user) return null;

  const email = normalizeEmail(user.email);
  const isHardAdmin = ADMIN_USER_IDS.includes(user.id as (typeof ADMIN_USER_IDS)[number]);
  if (!isHardAdmin && (!email || !getVisioTeamAllowedEmails().has(email))) {
    return null;
  }

  const member = getVisioTeamMembers().find(
    (candidate) => normalizeEmail(candidate.email) === email,
  );
  return {
    userId: user.id,
    email,
    name: member?.name || (isHardAdmin ? "Jimmy" : email),
  };
}

export async function requireVisioTeamApi() {
  const actor = await getVisioTeamActor();
  if (!actor) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "Accès réservé à l’équipe iNrCy." },
        { status: 403 },
      ),
    };
  }
  return { ok: true as const, actor };
}

