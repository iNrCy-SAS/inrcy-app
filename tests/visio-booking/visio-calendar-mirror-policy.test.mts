import assert from "node:assert/strict";
import test from "node:test";

import { INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY } from "../../lib/inrCalendarGoogleSyncConstants.ts";
import {
  TEAM_CALENDAR_MIRROR_KEY,
  TEAM_CALENDAR_MIRROR_VALUE,
  buildTeamCalendarMirrorBody,
  hasAutomaticGoogleCalendarReminders,
  isPendingSignupReminderForProspect,
  pendingSignupReminderProspectUserId,
  shouldMirrorTeamCalendarEvent,
  teamCalendarExternalAttendees,
  teamCalendarMirrorContentSignature,
  teamCalendarMirrorSourceKey,
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

test("le miroir est interne, sans invité ni nouvelle conférence, et conserve le lien Meet", () => {
  const body = buildTeamCalendarMirrorBody({
    event: sourceEvent({
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
  assert.equal("conferenceData" in body, false);
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
