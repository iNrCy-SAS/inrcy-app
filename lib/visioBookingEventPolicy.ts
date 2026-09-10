export type VisioBookingPublicIdentity = {
  name: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  company: string;
  phone?: string;
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

export type PendingSignupCalendarEvent = {
  summary?: string;
  description?: string;
};

export type VisioAppointmentPublicDetails = {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  phone: string;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalizedEmail(value: unknown) {
  return clean(value).toLowerCase();
}

function normalizedLabel(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function publicCalendarValue(value: unknown) {
  return clean(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").slice(0, 180);
}

function labeledDescriptionValue(description: string, labels: string[]) {
  const expectedLabels = new Set(labels.map(normalizedLabel));
  for (const line of description.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const label = normalizedLabel(line.slice(0, separator));
    if (!expectedLabels.has(label)) continue;
    return publicCalendarValue(line.slice(separator + 1));
  }
  return "";
}

function splitLegacyProfessionalName(value: string) {
  const chunks = publicCalendarValue(value).split(/\s+/).filter(Boolean);
  if (chunks.length <= 1) return { firstName: "", lastName: chunks[0] || "" };
  return {
    firstName: chunks.slice(0, -1).join(" "),
    lastName: chunks[chunks.length - 1] || "",
  };
}

export function readVisioAppointmentPublicDetails(
  event: PendingSignupCalendarEvent,
): VisioAppointmentPublicDetails {
  const description = clean(event.description);
  const legacyProfessional = labeledDescriptionValue(description, [
    "Professionnel",
  ]);
  const legacyName = splitLegacyProfessionalName(legacyProfessional);
  return {
    firstName:
      labeledDescriptionValue(description, ["Prénom", "Prenom"]) ||
      legacyName.firstName,
    lastName:
      labeledDescriptionValue(description, ["Nom"]) || legacyName.lastName,
    email: labeledDescriptionValue(description, ["E-mail", "Email", "Mail"]),
    company: labeledDescriptionValue(description, [
      "Entreprise",
      "Société",
      "Societe",
    ]),
    phone: labeledDescriptionValue(description, [
      "Téléphone",
      "Telephone",
      "Tél",
      "Tel",
    ]),
  };
}

function publicDetailsFromIdentity(
  prospect: VisioBookingPublicIdentity,
): VisioAppointmentPublicDetails {
  const legacyName = splitLegacyProfessionalName(prospect.name);
  return {
    firstName: publicCalendarValue(prospect.firstName) || legacyName.firstName,
    lastName: publicCalendarValue(prospect.lastName) || legacyName.lastName,
    email: publicCalendarValue(prospect.email),
    company: publicCalendarValue(prospect.company),
    phone: publicCalendarValue(prospect.phone),
  };
}

export function buildVisioAppointmentCalendarContent(
  details: VisioAppointmentPublicDetails,
) {
  const safe = {
    firstName: publicCalendarValue(details.firstName),
    lastName: publicCalendarValue(details.lastName),
    email: publicCalendarValue(details.email),
    company: publicCalendarValue(details.company),
    phone: publicCalendarValue(details.phone),
  };
  const professionalLabel =
    safe.company ||
    [safe.firstName, safe.lastName].filter(Boolean).join(" ") ||
    safe.email ||
    "Professionnel";

  return {
    summary: `Inscription iNrCy - ${professionalLabel}`,
    description: [
      `Nom : ${safe.lastName || "—"}`,
      `Prénom : ${safe.firstName || "—"}`,
      `E-mail : ${safe.email || "—"}`,
      `Entreprise : ${safe.company || "—"}`,
      `Téléphone : ${safe.phone || "—"}`,
    ].join("\n"),
    location: "",
  };
}

/**
 * Public-safe waiting state for the signup calendar object. The original
 * monitoring message may contain acquisition, consent and technical data;
 * this explicit allowlist retains only the five contact fields requested for
 * operational follow-up. Assignment and lifecycle data stay private.
 */
export function buildPendingSignupCalendarContent(input: {
  event: PendingSignupCalendarEvent;
  assignedMember: Pick<VisioBookingTeamIdentity, "name">;
}) {
  void input.assignedMember;
  const content = buildVisioAppointmentCalendarContent(
    readVisioAppointmentPublicDetails(input.event),
  );

  return {
    ...content,
    reminders: { useDefault: false, overrides: [] as never[] },
  };
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
 * This is the complete visible payload exposed in the Google invitation.
 * It deliberately contains only the professional's own five contact fields.
 * Acquisition data, assignment, lifecycle and technical identifiers cannot
 * enter this function.
 */
export function buildPublicVisioBookingContent(input: {
  prospect: VisioBookingPublicIdentity;
  assignedMember: Pick<VisioBookingTeamIdentity, "name">;
}) {
  void input.assignedMember;
  return buildVisioAppointmentCalendarContent(
    publicDetailsFromIdentity(input.prospect),
  );
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
