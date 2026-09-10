export type VisioBookingPublicIdentity = {
  name: string;
  company: string;
};

export type VisioBookingTeamIdentity = {
  id: string;
  name: string;
  email: string;
};

export type VisioBookingAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  optional?: boolean;
  resource?: boolean;
  additionalGuests?: number;
  comment?: string;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalizedEmail(value: unknown) {
  return clean(value).toLowerCase();
}

function writableAttendee(attendee: VisioBookingAttendee | undefined) {
  if (!attendee) return {};
  return {
    ...(clean(attendee.displayName) ? { displayName: clean(attendee.displayName) } : {}),
    ...(clean(attendee.responseStatus)
      ? { responseStatus: clean(attendee.responseStatus) }
      : {}),
    ...(typeof attendee.optional === "boolean" ? { optional: attendee.optional } : {}),
    ...(typeof attendee.resource === "boolean" ? { resource: attendee.resource } : {}),
    ...(typeof attendee.additionalGuests === "number"
      ? { additionalGuests: attendee.additionalGuests }
      : {}),
    ...(clean(attendee.comment) ? { comment: clean(attendee.comment) } : {}),
  };
}

/**
 * This is the complete public payload exposed in the Google invitation.
 * Contact details, acquisition data and internal identifiers deliberately do
 * not enter this function, which makes an accidental leak much harder.
 */
export function buildPublicVisioBookingContent(input: {
  prospect: VisioBookingPublicIdentity;
  assignedMember: Pick<VisioBookingTeamIdentity, "name">;
}) {
  const prospectLabel = clean(input.prospect.company) || clean(input.prospect.name);
  const memberName = clean(input.assignedMember.name) || "Équipe iNrCy";
  return {
    summary: `Présentation iNrCy — ${prospectLabel || "Professionnel"}`,
    description: [
      "Rendez-vous de présentation iNrCy.",
      `Votre interlocuteur : ${memberName}.`,
      "Le lien Google Meet est joint à cette invitation.",
    ].join("\n"),
    location: "Google Meet",
  };
}

/**
 * Every internal calendar receives the same Google event, but exactly one
 * administrator is marked as its active owner. External guests are retained
 * unchanged and never become part of the internal assignment mechanism.
 */
export function buildSingleAssigneeVisioAttendees(input: {
  teamMembers: VisioBookingTeamIdentity[];
  assignedMemberId: string;
  currentAttendees?: VisioBookingAttendee[];
  externalAttendees?: VisioBookingAttendee[];
}) {
  const teamEmails = new Set(
    input.teamMembers.map((member) => normalizedEmail(member.email)).filter(Boolean),
  );
  const currentByEmail = new Map(
    (input.currentAttendees || [])
      .map((attendee) => [normalizedEmail(attendee.email), attendee] as const)
      .filter(([email]) => Boolean(email)),
  );
  const byEmail = new Map<string, VisioBookingAttendee>();

  for (const member of input.teamMembers) {
    const email = normalizedEmail(member.email);
    if (!email) continue;
    const current = currentByEmail.get(email);
    byEmail.set(email, {
      ...writableAttendee(current),
      email,
      displayName: clean(current?.displayName) || clean(member.name),
      optional: member.id !== input.assignedMemberId,
    });
  }

  for (const attendee of [
    ...(input.currentAttendees || []),
    ...(input.externalAttendees || []),
  ]) {
    const email = normalizedEmail(attendee.email);
    if (!email || teamEmails.has(email)) continue;
    const current = byEmail.get(email);
    byEmail.set(email, {
      ...writableAttendee(current),
      ...writableAttendee(attendee),
      email,
      displayName: clean(attendee.displayName) || clean(current?.displayName) || undefined,
    });
  }

  return [...byEmail.values()];
}
