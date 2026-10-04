import assert from "node:assert/strict";
import test from "node:test";

import { INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY } from "../../lib/inrCalendarGoogleSyncConstants.ts";
import {
  TEAM_CALENDAR_AUTOMATION_SNAPSHOT_KEY,
  TEAM_CALENDAR_MANUAL_OVERRIDE_KEY,
  TEAM_CALENDAR_MANUAL_OVERRIDE_VALUE,
  TEAM_CALENDAR_MIRROR_KEY,
  TEAM_CALENDAR_MIRROR_VALUE,
  buildTeamCalendarMirrorBody,
  detachedTeamCalendarAdminAssignmentPatch,
  hasTeamCalendarAutomationSnapshotDiverged,
  hasAutomaticGoogleCalendarReminders,
  isRecoverableDeterministicTeamCalendarMirror,
  isPendingSignupReminderForProspect,
  pendingSignupReminderProspectUserId,
  shouldMirrorTeamCalendarEvent,
  teamCalendarAutomationDecision,
  teamCalendarAutomationSnapshot,
  teamCalendarExternalAttendees,
  teamCalendarEventMeetUrl,
  teamCalendarManualContentSignature,
  teamCalendarMirrorContentSignature,
  teamCalendarMirrorScheduleReconciliationDecision,
  teamCalendarMirrorSourceKey,
  teamCalendarNativeMeetUrl,
  teamCalendarReplicaReconciliationDecision,
  type TeamCalendarEvent,
  type TeamCalendarMember,
} from "../../lib/visioCalendarMirrorPolicy.ts";

const member: TeamCalendarMember = {
  id: "apolline",
  name: "Apolline",
  email: "apolline.benedyczak@inrcy.com",
  calendarId: "apolline.benedyczak@inrcy.com",
};
const sharedCalendarId = "shared@group.calendar.google.com";

function sourceEvent(overrides: TeamCalendarEvent = {}): TeamCalendarEvent {
  return {
    id: "event-123",
    status: "confirmed",
    summary: "Présentation client",
    description: "Détails internes",
    location: "Google Meet",
    htmlLink: "https://calendar.google.com/event?eid=source",
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    iCalUID: "shared-logical-appointment@example.com",
    start: { dateTime: "2026-09-08T09:00:00.000Z" },
    end: { dateTime: "2026-09-08T10:00:00.000Z" },
    organizer: { email: member.email },
    ...overrides,
  };
}

test("seul l'événement portant exactement l'id miroir déterministe est réparable", () => {
  const expectedEventId = "tm0123456789abcdef0123456789abcdef01234567";
  assert.equal(
    isRecoverableDeterministicTeamCalendarMirror({
      existing: { id: expectedEventId, status: "cancelled" },
      expectedEventId,
      mirrorEventId: expectedEventId,
    }),
    true,
  );
  assert.equal(
    isRecoverableDeterministicTeamCalendarMirror({
      existing: { id: expectedEventId, status: "confirmed" },
      expectedEventId,
      mirrorEventId: expectedEventId,
    }),
    true,
  );
  assert.equal(
    isRecoverableDeterministicTeamCalendarMirror({
      existing: { id: "tm-other", status: "cancelled" },
      expectedEventId,
      mirrorEventId: expectedEventId,
    }),
    false,
  );
  assert.equal(
    isRecoverableDeterministicTeamCalendarMirror({
      existing: { id: expectedEventId, status: "cancelled" },
      expectedEventId,
      mirrorEventId: "explicit-non-deterministic-id",
    }),
    false,
  );
  assert.equal(
    isRecoverableDeterministicTeamCalendarMirror({
      existing: { id: "manual-event", status: "confirmed" },
      expectedEventId: "manual-event",
      mirrorEventId: "manual-event",
    }),
    false,
  );
});

test("un rendez-vous personnel éligible est reflété", () => {
  assert.equal(
    shouldMirrorTeamCalendarEvent({
      event: sourceEvent(),
      memberEmail: member.email,
      sharedCalendarId,
    }),
    true,
  );
  assert.notEqual(
    teamCalendarMirrorSourceKey(member.calendarId, "event-123"),
    teamCalendarMirrorSourceKey(member.calendarId, "event-124"),
  );
});

test("les copies du partagé, annulations, refus et emplacements de travail sont exclus", () => {
  const cases: TeamCalendarEvent[] = [
    sourceEvent({ status: "cancelled" }),
    sourceEvent({ organizer: { email: sharedCalendarId } }),
    sourceEvent({ eventType: "workingLocation" }),
    sourceEvent({
      attendees: [{ email: member.email, self: true, responseStatus: "declined" }],
    }),
    sourceEvent({
      extendedProperties: {
        private: { [TEAM_CALENDAR_MIRROR_KEY]: TEAM_CALENDAR_MIRROR_VALUE },
      },
    }),
  ];
  for (const event of cases) {
    assert.equal(
      shouldMirrorTeamCalendarEvent({
        event,
        memberEmail: member.email,
        sharedCalendarId,
      }),
      false,
    );
  }
});

test("la copie invitée d'un autre organisateur iNrCy n'est jamais reflétée", () => {
  const oceaneEmail = "oceane.pinceloup@inrcy.com";
  assert.equal(
    shouldMirrorTeamCalendarEvent({
      event: sourceEvent({
        organizer: { email: oceaneEmail },
        attendees: [
          { email: oceaneEmail, organizer: true, responseStatus: "accepted" },
          { email: member.email, self: true, responseStatus: "accepted" },
        ],
      }),
      memberEmail: member.email,
      memberCalendarId: member.calendarId,
      managedCalendarIds: [member.email, member.calendarId, oceaneEmail],
      sharedCalendarId,
    }),
    false,
  );
});

test("une invitation organisée à l'extérieur reste visible dans l'agenda du membre", () => {
  assert.equal(
    shouldMirrorTeamCalendarEvent({
      event: sourceEvent({ organizer: { email: "client@example.com" } }),
      memberEmail: member.email,
      memberCalendarId: member.calendarId,
      managedCalendarIds: [member.email, member.calendarId],
      sharedCalendarId,
    }),
    true,
  );
});

test("un transfert conserve les invités externes et retire toutes les adresses iNrCy", () => {
  assert.deepEqual(
    teamCalendarExternalAttendees(
      sourceEvent({
        attendees: [
          { email: "oceane.pinceloup@inrcy.com", responseStatus: "accepted" },
          { email: "contact@admin-inrcy.com", responseStatus: "accepted" },
          {
            email: "PRO@example.com",
            displayName: "Le pro",
            responseStatus: "accepted",
            self: true,
          },
        ],
      }),
      ["apolline.benedyczak@inrcy.com", "contact@admin-inrcy.com"],
    ),
    [{
      email: "pro@example.com",
      displayName: "Le pro",
      responseStatus: "accepted",
    }],
  );
});

test("le miroir de réservation reprend le Meet natif du rendez-vous sans en créer un autre", () => {
  const body = buildTeamCalendarMirrorBody({
    event: sourceEvent({
      conferenceData: {
        entryPoints: [
          { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
        ],
      },
      attendees: [
        { email: member.email, self: true, responseStatus: "accepted" },
        { email: "pro@example.com", displayName: "Le pro", responseStatus: "accepted" },
      ],
      extendedProperties: {
        private: {
          inrcyBooking: "signup-visio",
          bookingNonce: "nonce",
          prospectUserId: "user-id",
        },
      },
    }),
    member,
    sharedCalendarId,
    mirrorEventId: "tm123",
    fingerprint: "fingerprint",
  });
  assert.equal(body.summary, "[Apolline] Présentation client");
  assert.equal(body.visibility, "default");
  assert.match(body.description, /Responsable iNrCy : Apolline/);
  assert.match(body.description, /https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.equal("attendees" in body, false);
  assert.equal(
    teamCalendarNativeMeetUrl(body),
    "https://meet.google.com/abc-defg-hij",
  );
  assert.equal("createRequest" in (body.conferenceData || {}), false);
  assert.equal(body.reminders.useDefault, false);
  assert.deepEqual(body.reminders.overrides, []);
  assert.equal(body.extendedProperties.private.inrcyBooking, "signup-visio");
  assert.equal(body.extendedProperties.private.sourceFingerprint, "fingerprint");
  assert.equal(
    body.extendedProperties.private.sourceICalUID,
    "shared-logical-appointment@example.com",
  );
  assert.equal(
    body.extendedProperties.private.sourceOrganizerEmail,
    member.email,
  );
  assert.equal(body.extendedProperties.private.sourceCalendarIsOrganizer, "true");
  assert.equal(
    body.extendedProperties.private[INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY],
    JSON.stringify(["pro@example.com"]),
  );
});

test("le miroir d'une réservation directe conserve son cycle métier et son identité logique", () => {
  const body = buildTeamCalendarMirrorBody({
    event: sourceEvent({
      colorId: "9",
      extendedProperties: {
        private: {
          inrcyBooking: "signup-visio",
          bookingNonce: "nonce-direct",
          prospectUserId: "prospect-direct",
          inrcyAppointmentStatus: "appointment_scheduled_direct",
          inrcyAppointmentOrigin: "signup_with_appointment",
          inrcyAppointmentLifecycleVersion: "v1",
          inrcyLogicalAppointmentId: "prospect:prospect-direct",
        },
      },
    }),
    member,
    sharedCalendarId,
    // Le rappel orange est réutilisé : son id diffère donc volontairement de
    // l'id déterministe du rendez-vous public.
    mirrorEventId: "pending-signup-reminder-id",
    fingerprint: "direct-booking-fingerprint",
  });

  assert.equal(body.colorId, "9");
  assert.equal(
    body.extendedProperties.private.inrcyAppointmentStatus,
    "appointment_scheduled_direct",
  );
  assert.equal(
    body.extendedProperties.private.inrcyAppointmentOrigin,
    "signup_with_appointment",
  );
  assert.equal(
    body.extendedProperties.private.inrcyAppointmentLifecycleVersion,
    "v1",
  );
  assert.equal(
    body.extendedProperties.private.inrcyLogicalAppointmentId,
    "prospect:prospect-direct",
  );
});

test("un Meet ajouté sur une ancienne copie ne remplace jamais celui envoyé au pro", () => {
  const mirror = sourceEvent({
    hangoutLink: "https://meet.google.com/other-room",
    extendedProperties: {
      private: {
        [TEAM_CALENDAR_MIRROR_KEY]: TEAM_CALENDAR_MIRROR_VALUE,
        inrcyBooking: "signup-visio",
        sourceMeetUrl: "https://meet.google.com/abc-defg-hij",
      },
    },
  });
  assert.equal(
    teamCalendarEventMeetUrl(mirror),
    "https://meet.google.com/abc-defg-hij",
  );
  assert.equal(
    teamCalendarNativeMeetUrl(mirror),
    "https://meet.google.com/other-room",
  );
});

test("une réattribution conserve le Meet source et détecte une ancienne conférence à réparer", () => {
  const target: TeamCalendarMember = {
    id: "oceane",
    name: "Océane",
    email: "oceane@inrcy.com",
    calendarId: "public@inrcy.com",
  };
  const body = buildTeamCalendarMirrorBody({
    event: sourceEvent({
      organizer: { email: "public@inrcy.com" },
      conferenceData: {
        entryPoints: [
          { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
        ],
      },
      extendedProperties: {
        private: {
          inrcyBooking: "signup-visio",
          bookingNonce: "nonce",
          assignedMemberId: "oceane",
        },
      },
    }),
    member: target,
    sharedCalendarId,
    mirrorEventId: "tm123",
    fingerprint: "reassigned",
  });
  const staleMirror: TeamCalendarEvent = {
    ...body,
    conferenceData: {
      entryPoints: [
        { entryPointType: "video", uri: "https://meet.google.com/other-room" },
      ],
    },
  };
  assert.equal(body.extendedProperties.private.assignedMemberId, "oceane");
  assert.match(body.description, /Responsable iNrCy : Océane/);
  assert.equal(teamCalendarNativeMeetUrl(body), "https://meet.google.com/abc-defg-hij");
  assert.notEqual(
    teamCalendarMirrorContentSignature(staleMirror),
    teamCalendarMirrorContentSignature(body),
  );
});

test("les autres événements ne reçoivent pas de nouvelle conférence native", () => {
  const body = buildTeamCalendarMirrorBody({
    event: sourceEvent({
      conferenceData: {
        entryPoints: [
          { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
        ],
      },
    }),
    member,
    sharedCalendarId,
    mirrorEventId: "tm-other",
    fingerprint: "other-fingerprint",
  });
  assert.equal("conferenceData" in body, false);
});

test("un événement privé n'expose pas son titre ni sa description", () => {
  const body = buildTeamCalendarMirrorBody({
    event: sourceEvent({ visibility: "private", summary: "Sujet confidentiel" }),
    member,
    sharedCalendarId,
    mirrorEventId: "tm-private",
    fingerprint: "private-fingerprint",
  });
  assert.equal(body.summary, "Indisponible — Apolline");
  assert.equal(body.visibility, "private");
  assert.doesNotMatch(body.description, /Sujet confidentiel|Détails internes/);
  assert.equal(
    INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY in body.extendedProperties.private,
    false,
  );
});

test("les événements confidentiels ou issus de Gmail restent masqués", () => {
  for (const event of [
    sourceEvent({ visibility: "confidential" }),
    sourceEvent({ eventType: "fromGmail" }),
  ]) {
    const body = buildTeamCalendarMirrorBody({
      event: { ...event, summary: "Détail sensible", description: "Secret" },
      member,
      sharedCalendarId,
      mirrorEventId: "tm-sensitive",
      fingerprint: "sensitive-fingerprint",
    });
    assert.equal(body.summary, "Indisponible — Apolline");
    assert.doesNotMatch(body.description, /Détail sensible|Secret/);
  }
});

test("un événement sans fin exploitable n'est pas reflété", () => {
  assert.equal(
    shouldMirrorTeamCalendarEvent({
      event: sourceEvent({ end: undefined }),
      memberEmail: member.email,
      sharedCalendarId,
    }),
    false,
  );
});

test("le rappel orange d'inscription est identifié uniquement par son User ID", () => {
  const reminder = sourceEvent({
    summary: "Inscription - A traiter",
    description: [
      "STATUT : A traiter",
      "Nouvelle inscription iNrCy",
      "User ID : 4b6eceb7-d627-4447-b453-4f5e1e749272",
      "Provider : email",
    ].join("\n"),
    colorId: "5",
    organizer: { email: sharedCalendarId },
  });

  assert.equal(
    pendingSignupReminderProspectUserId(reminder),
    "4b6eceb7-d627-4447-b453-4f5e1e749272",
  );
  assert.equal(
    isPendingSignupReminderForProspect(
      reminder,
      "4b6eceb7-d627-4447-b453-4f5e1e749272",
    ),
    true,
  );
  assert.equal(
    isPendingSignupReminderForProspect(reminder, "un-autre-utilisateur"),
    false,
  );
  assert.equal(
    pendingSignupReminderProspectUserId({
      ...reminder,
      summary: "Inscription - Mpicka à rappeler par SMS",
    }),
    "4b6eceb7-d627-4447-b453-4f5e1e749272",
  );
  assert.equal(
    pendingSignupReminderProspectUserId({
      ...reminder,
      summary: "Inscription — Belle à croquer — Apolline",
      description: "Inscription iNrCy en attente de rendez-vous.",
      extendedProperties: {
        private: {
          inrcySignupAssignment: "v1",
          prospectUserId: "4b6eceb7-d627-4447-b453-4f5e1e749272",
        },
      },
    }),
    "4b6eceb7-d627-4447-b453-4f5e1e749272",
  );
});

test("les rappels Google historiques sont détectés pour être nettoyés", () => {
  assert.equal(hasAutomaticGoogleCalendarReminders(sourceEvent()), true);
  assert.equal(
    hasAutomaticGoogleCalendarReminders(
      sourceEvent({ reminders: { useDefault: true } }),
    ),
    true,
  );
  assert.equal(
    hasAutomaticGoogleCalendarReminders(
      sourceEvent({
        reminders: {
          useDefault: false,
          overrides: [{ method: "email", minutes: 1440 }],
        },
      }),
    ),
    true,
  );
  assert.equal(
    hasAutomaticGoogleCalendarReminders(
      sourceEvent({ reminders: { useDefault: false, overrides: [] } }),
    ),
    false,
  );
});

test("une liste de rappels vide omise par Google garde la même signature", () => {
  const googleResponse = sourceEvent({
    reminders: { useDefault: false },
  });
  const inrcyRequest = sourceEvent({
    reminders: { useDefault: false, overrides: [] },
  });

  assert.equal(
    teamCalendarMirrorContentSignature(googleResponse),
    teamCalendarMirrorContentSignature(inrcyRequest),
  );
});

test("les valeurs Google implicites gardent la même signature", () => {
  const googleResponse = sourceEvent({
    visibility: undefined,
    transparency: undefined,
    start: { dateTime: "2026-09-08T09:00:00.000Z" },
    end: { dateTime: "2026-09-08T10:00:00.000Z" },
  });
  const inrcyRequest = sourceEvent({
    visibility: "default",
    transparency: "opaque",
    start: {
      dateTime: "2026-09-08T09:00:00.000Z",
      date: undefined,
      timeZone: undefined,
    },
    end: {
      dateTime: "2026-09-08T10:00:00.000Z",
      date: undefined,
      timeZone: undefined,
    },
  });

  assert.equal(
    teamCalendarMirrorContentSignature(googleResponse),
    teamCalendarMirrorContentSignature(inrcyRequest),
  );
});

test("deux offsets équivalents ne simulent pas une modification manuelle", () => {
  const first = sourceEvent({
    start: { dateTime: "2026-09-08T11:00:00+02:00" },
    end: { dateTime: "2026-09-08T12:00:00+02:00" },
  });
  const normalizedByGoogle = sourceEvent({
    start: { dateTime: "2026-09-08T09:00:00Z" },
    end: { dateTime: "2026-09-08T10:00:00Z" },
  });
  assert.equal(
    teamCalendarManualContentSignature(first),
    teamCalendarManualContentSignature(normalizedByGoogle),
  );
  assert.equal(
    teamCalendarAutomationSnapshot(first),
    teamCalendarAutomationSnapshot(normalizedByGoogle),
  );
  assert.equal(
    teamCalendarMirrorContentSignature(first),
    teamCalendarMirrorContentSignature(normalizedByGoogle),
  );
});

test("un miroir normalisé par Google conserve sa signature de contenu", () => {
  const desired = buildTeamCalendarMirrorBody({
    event: sourceEvent({
      start: {
        dateTime: "2026-09-08T11:00:00+02:00",
        timeZone: "Europe/Paris",
      },
      end: {
        dateTime: "2026-09-08T12:00:00+02:00",
        timeZone: "Europe/Paris",
      },
    }),
    member,
    sharedCalendarId,
    mirrorEventId: "tm-google-normalized",
    fingerprint: "unchanged-source",
  });
  const googleResponse: TeamCalendarEvent = {
    ...desired,
    start: { dateTime: "2026-09-08T09:00:00.000Z" },
    end: { dateTime: "2026-09-08T10:00:00.000Z", timeZone: "UTC" },
    reminders: { useDefault: false },
    visibility: undefined,
    transparency: undefined,
  };

  assert.equal(
    teamCalendarMirrorContentSignature(googleResponse),
    teamCalendarMirrorContentSignature(desired),
  );
});

test("la signature du miroir distingue les déplacements et les journées entières", () => {
  const timed = sourceEvent();
  for (const changed of [
    sourceEvent({ start: { dateTime: "2026-09-08T09:15:00Z" } }),
    sourceEvent({ end: { dateTime: "2026-09-08T10:15:00Z" } }),
    sourceEvent({ start: { date: "2026-09-08" } }),
  ]) {
    assert.notEqual(
      teamCalendarMirrorContentSignature(timed),
      teamCalendarMirrorContentSignature(changed),
    );
  }

  const allDay = sourceEvent({
    start: { date: "2026-09-08" },
    end: { date: "2026-09-09" },
  });
  assert.notEqual(
    teamCalendarMirrorContentSignature(allDay),
    teamCalendarMirrorContentSignature({
      ...allDay,
      start: { date: "2026-09-09" },
      end: { date: "2026-09-10" },
    }),
  );
});

test("la signature du miroir conserve le fuseau des horaires sans offset", () => {
  const paris = sourceEvent({
    start: { dateTime: "2026-09-08T09:00:00", timeZone: "Europe/Paris" },
    end: { dateTime: "2026-09-08T10:00:00", timeZone: "Europe/Paris" },
  });
  const london = sourceEvent({
    start: { dateTime: "2026-09-08T09:00:00", timeZone: "Europe/London" },
    end: { dateTime: "2026-09-08T10:00:00", timeZone: "Europe/London" },
  });
  assert.notEqual(
    teamCalendarMirrorContentSignature(paris),
    teamCalendarMirrorContentSignature(london),
  );
});

test("une modification manuelle d'un miroir le détache définitivement", () => {
  const desired = buildTeamCalendarMirrorBody({
    event: sourceEvent({
      colorId: "9",
      extendedProperties: {
        private: {
          inrcyAppointmentStatus: "appointment_scheduled_direct",
          inrcyAppointmentOrigin: "signup_with_appointment",
          inrcyAppointmentLifecycleVersion: "v1",
          inrcyLogicalAppointmentId: "prospect:user-1",
        },
      },
    }),
    member,
    sharedCalendarId,
    mirrorEventId: "tm-manual",
    fingerprint: "source-v1",
  });
  const managed = {
    ...desired,
    extendedProperties: {
      private: {
        ...desired.extendedProperties.private,
        [TEAM_CALENDAR_AUTOMATION_SNAPSHOT_KEY]:
          teamCalendarAutomationSnapshot(desired),
      },
    },
  };
  const manuallyEdited = {
    ...managed,
    summary: "Titre choisi manuellement",
    colorId: "5",
  };

  assert.equal(hasTeamCalendarAutomationSnapshotDiverged(managed), false);
  assert.equal(
    hasTeamCalendarAutomationSnapshotDiverged(manuallyEdited),
    true,
  );

  assert.equal(
    teamCalendarAutomationDecision({
      existing: manuallyEdited,
      desired: managed,
      currentSourceFingerprint: "source-v1",
    }),
    "manual_override",
  );

  const detached = {
    ...manuallyEdited,
    extendedProperties: {
      private: {
        ...manuallyEdited.extendedProperties.private,
        [TEAM_CALENDAR_MANUAL_OVERRIDE_KEY]:
          TEAM_CALENDAR_MANUAL_OVERRIDE_VALUE,
      },
    },
  };
  assert.equal(
    teamCalendarAutomationDecision({
      existing: detached,
      desired: managed,
      currentSourceFingerprint: "source-v2",
    }),
    "detached",
  );
});

test("une attribution Admin met à jour un miroir détaché sans toucher aux choix manuels", () => {
  const detached: TeamCalendarEvent = {
    id: "tm-detached",
    summary: "Titre choisi manuellement",
    description: "Notes choisies manuellement",
    colorId: "5",
    start: { dateTime: "2026-10-01T09:15:00+02:00" },
    end: { dateTime: "2026-10-01T10:15:00+02:00" },
    attendees: [{ email: "client@example.com" }],
    extendedProperties: {
      private: {
        [TEAM_CALENDAR_MIRROR_KEY]: TEAM_CALENDAR_MIRROR_VALUE,
        [TEAM_CALENDAR_MANUAL_OVERRIDE_KEY]:
          TEAM_CALENDAR_MANUAL_OVERRIDE_VALUE,
        [TEAM_CALENDAR_AUTOMATION_SNAPSHOT_KEY]: "manual-snapshot",
        assignedMemberId: "jimmy",
        assignedMemberEmail: "jimmy@inrcy.com",
        sourceCalendarId: "jimmy@inrcy.com",
        sourceEventId: "source-before",
        customManualProperty: "keep-me",
      },
    },
  };
  const desired = buildTeamCalendarMirrorBody({
    event: sourceEvent({ id: "source-after" }),
    member,
    sharedCalendarId,
    mirrorEventId: "tm-detached",
    fingerprint: "source-after-fingerprint",
  });
  const patch = detachedTeamCalendarAdminAssignmentPatch({
    existing: detached,
    desired,
  });
  assert.ok(patch);

  const reassigned = { ...detached, ...patch };
  assert.equal(reassigned.summary, detached.summary);
  assert.equal(reassigned.description, detached.description);
  assert.equal(reassigned.colorId, detached.colorId);
  assert.deepEqual(reassigned.start, detached.start);
  assert.deepEqual(reassigned.end, detached.end);
  assert.deepEqual(reassigned.attendees, detached.attendees);
  assert.equal(
    reassigned.extendedProperties?.private?.[TEAM_CALENDAR_MANUAL_OVERRIDE_KEY],
    TEAM_CALENDAR_MANUAL_OVERRIDE_VALUE,
  );
  assert.equal(
    reassigned.extendedProperties?.private?.[TEAM_CALENDAR_AUTOMATION_SNAPSHOT_KEY],
    "manual-snapshot",
  );
  assert.equal(
    reassigned.extendedProperties?.private?.customManualProperty,
    "keep-me",
  );
  assert.equal(reassigned.extendedProperties?.private?.assignedMemberId, member.id);
  assert.equal(
    reassigned.extendedProperties?.private?.assignedMemberEmail,
    member.email,
  );
  assert.equal(
    reassigned.extendedProperties?.private?.sourceCalendarId,
    member.calendarId,
  );
  assert.equal(
    reassigned.extendedProperties?.private?.sourceEventId,
    "source-after",
  );
  assert.equal(
    teamCalendarAutomationDecision({
      existing: reassigned,
      desired,
      currentSourceFingerprint: "source-after-fingerprint",
    }),
    "detached",
  );
});

test("les métadonnées et l'ordre Google ne changent pas la signature de conférence", () => {
  type GoogleConferenceData = NonNullable<TeamCalendarEvent["conferenceData"]> & {
    conferenceId?: string;
    signature?: string;
  };
  const googleResponse = sourceEvent({
    conferenceData: {
      conferenceId: "meet-id-from-google",
      signature: "server-signature",
      entryPoints: [
        { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
        { entryPointType: "phone", uri: "tel:+33123456789" },
      ],
    } as GoogleConferenceData,
  });
  const inrcyRequest = sourceEvent({
    conferenceData: {
      entryPoints: [
        { entryPointType: "phone", uri: "tel:+33123456789" },
        { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
      ],
    },
  });

  assert.equal(
    teamCalendarMirrorContentSignature(googleResponse),
    teamCalendarMirrorContentSignature(inrcyRequest),
  );
});

test("une réplique stable ne demande aucun accès Google supplémentaire", () => {
  assert.equal(
    teamCalendarReplicaReconciliationDecision({
      storedFingerprint: "fingerprint-v1",
      actualFingerprint: "fingerprint-v1",
      canonicalFingerprint: "fingerprint-v1",
      contentMatchesCanonical: true,
    }),
    "stable",
  );
  assert.equal(
    teamCalendarReplicaReconciliationDecision({
      storedFingerprint: "fingerprint-v1",
      actualFingerprint: "fingerprint-v1",
      canonicalFingerprint: "fingerprint-v1",
      contentMatchesCanonical: false,
    }),
    "repair",
  );
  assert.equal(
    teamCalendarReplicaReconciliationDecision({
      actualFingerprint: "legacy",
      canonicalFingerprint: "current-canonical",
      contentMatchesCanonical: true,
    }),
    "repair",
  );
  assert.equal(
    teamCalendarReplicaReconciliationDecision({
      storedFingerprint: "fingerprint-from-an-older-signature-version",
      actualFingerprint: "fingerprint-from-the-current-signature-version",
      canonicalFingerprint: "fingerprint-from-the-current-signature-version",
      contentMatchesCanonical: true,
    }),
    "stable",
  );
  assert.equal(
    teamCalendarReplicaReconciliationDecision({
      storedFingerprint: "fingerprint-v1",
      actualFingerprint: "changed-by-user",
      canonicalFingerprint: "fingerprint-v1",
      contentMatchesCanonical: false,
    }),
    "replica_changed",
  );
  assert.equal(
    teamCalendarReplicaReconciliationDecision({
      storedFingerprint: "former-canonical-snapshot",
      actualFingerprint: "former-snapshot-normalized-by-google",
      canonicalFingerprint: "current-canonical-snapshot",
      contentMatchesCanonical: false,
    }),
    "repair",
    "une ancienne copie Google ne doit jamais restaurer l'ancienne date ou couleur",
  );
});

test("un déplacement dans l’agenda partagé met à jour une source organisatrice inchangée", () => {
  assert.equal(
    teamCalendarMirrorScheduleReconciliationDecision({
      source: sourceEvent(),
      mirror: sourceEvent({
        start: { dateTime: "2026-09-09T12:00:00.000Z" },
        end: { dateTime: "2026-09-09T13:00:00.000Z" },
      }),
      storedSourceFingerprint: "source-v1",
      currentSourceFingerprint: "source-v1",
      sourceIsOrganizer: true,
    }),
    "mirror_changed",
  );
});

test("une source modifiée en parallèle ne peut pas être restaurée par une ancienne copie", () => {
  assert.equal(
    teamCalendarMirrorScheduleReconciliationDecision({
      source: sourceEvent({
        start: { dateTime: "2026-09-10T08:00:00+02:00" },
        end: { dateTime: "2026-09-10T09:00:00+02:00" },
      }),
      mirror: sourceEvent(),
      storedSourceFingerprint: "source-v1",
      currentSourceFingerprint: "source-v2",
      sourceIsOrganizer: true,
    }),
    "source_wins",
  );
});

test("une copie d’invitation externe ne déplace jamais l’événement de l’organisateur", () => {
  assert.equal(
    teamCalendarMirrorScheduleReconciliationDecision({
      source: sourceEvent(),
      mirror: sourceEvent({
        start: { dateTime: "2026-09-09T12:00:00.000Z" },
        end: { dateTime: "2026-09-09T13:00:00.000Z" },
      }),
      storedSourceFingerprint: "source-v1",
      currentSourceFingerprint: "source-v1",
      sourceIsOrganizer: false,
    }),
    "source_wins",
  );
});

test("deux offsets représentant le même horaire restent stables", () => {
  assert.equal(
    teamCalendarMirrorScheduleReconciliationDecision({
      source: sourceEvent({
        start: { dateTime: "2026-09-08T11:00:00+02:00" },
        end: { dateTime: "2026-09-08T12:00:00+02:00" },
      }),
      mirror: sourceEvent({
        start: { dateTime: "2026-09-08T09:00:00.000Z" },
        end: { dateTime: "2026-09-08T10:00:00.000Z" },
      }),
      storedSourceFingerprint: "source-v1",
      currentSourceFingerprint: "source-v1",
      sourceIsOrganizer: true,
    }),
    "stable",
  );
});

test("un vrai rendez-vous ou un rappel sans identifiant n'est jamais supprimable", () => {
  assert.equal(
    pendingSignupReminderProspectUserId(
      sourceEvent({
        summary: "Présentation iNrCy",
        description: "Nouvelle inscription iNrCy\nUser ID : prospect-123",
      }),
    ),
    "",
  );
  assert.equal(
    pendingSignupReminderProspectUserId(
      sourceEvent({
        summary: "Inscription - A traiter",
        description: "E-mail : prospect@example.com",
      }),
    ),
    "",
  );
  assert.equal(
    pendingSignupReminderProspectUserId(
      sourceEvent({
        summary: "Inscription - A traiter",
        description: "User ID : prospect-123",
        extendedProperties: { private: { inrcyBooking: "signup-visio" } },
      }),
    ),
    "",
  );
});
