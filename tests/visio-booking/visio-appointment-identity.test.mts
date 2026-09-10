import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalVisioAppointmentIdentity,
  sharedVisioMirrorDeduplicationIdentity,
} from "../../lib/visioAppointmentIdentity.ts";

const start = "2026-09-12T08:00:00.000Z";

test("le nonce d'inscription identifie le rendez-vous à travers toutes ses copies", () => {
  const first = canonicalVisioAppointmentIdentity({
    id: "public-event",
    start: { dateTime: start },
    extendedProperties: { private: { bookingNonce: "BOOKING-123" } },
  });
  const mirror = canonicalVisioAppointmentIdentity({
    id: "admin-mirror",
    start: { dateTime: "2026-09-13T09:00:00.000Z" },
    extendedProperties: { private: { bookingNonce: "booking-123" } },
  });

  assert.equal(first, "booking:booking-123");
  assert.equal(first, mirror);
});

test("une occurrence iCal est unique malgré des identifiants Google différents", () => {
  const source = canonicalVisioAppointmentIdentity({
    id: "source-event",
    iCalUID: "SERIES@GOOGLE.COM",
    start: { dateTime: start },
  });
  const mirror = canonicalVisioAppointmentIdentity({
    id: "mirror-event",
    start: { dateTime: start },
    extendedProperties: {
      private: { sourceICalUID: "series@google.com" },
    },
  });

  assert.equal(source, mirror);
});

test("deux occurrences d'une série récurrente restent deux rendez-vous", () => {
  const first = canonicalVisioAppointmentIdentity({
    iCalUID: "series@google.com",
    start: { dateTime: "2026-09-12T08:00:00.000Z" },
  });
  const second = canonicalVisioAppointmentIdentity({
    iCalUID: "series@google.com",
    start: { dateTime: "2026-09-19T08:00:00.000Z" },
  });

  assert.notEqual(first, second);
});

test("le même lien Meet et la même heure réunissent les copies historiques", () => {
  const first = canonicalVisioAppointmentIdentity({
    id: "event-a",
    hangoutLink: "https://meet.google.com/ABC-DEFG-HIJ/?authuser=0#room",
    start: { dateTime: start },
  });
  const second = canonicalVisioAppointmentIdentity({
    id: "event-b",
    conferenceData: {
      entryPoints: [
        {
          entryPointType: "video",
          uri: "https://meet.google.com/abc-defg-hij",
        },
      ],
    },
    start: { dateTime: start },
  });

  assert.equal(first, second);
});

test("deux rendez-vous indépendants sans identifiant commun restent distincts", () => {
  const first = canonicalVisioAppointmentIdentity({
    id: "event-a",
    start: { dateTime: start },
  });
  const second = canonicalVisioAppointmentIdentity({
    id: "event-b",
    start: { dateTime: start },
  });

  assert.notEqual(first, second);
});

test("un miroir legacy et un miroir courant du même événement source partagent la même clé", () => {
  const source = {
    id: "source-event-42",
    iCalUID: "source-uid@google.com",
    start: { dateTime: "2026-09-12T10:00:00+02:00" },
    end: { dateTime: "2026-09-12T11:00:00+02:00" },
    summary: "Présentation iNrCy",
  };
  const currentMirror = {
    id: "tm-current",
    iCalUID: "shared-current@google.com",
    start: { dateTime: "2026-09-12T08:00:00.000Z" },
    end: { dateTime: "2026-09-12T09:00:00.000Z" },
    summary: "[Jimmy] Présentation iNrCy",
    extendedProperties: {
      private: {
        inrcyTeamMirror: "v1",
        sourceCalendarId: "contact@admin-inrcy.com",
        sourceEventId: "source-event-42",
      },
    },
  };
  const legacyMirror = {
    id: "tm-legacy",
    iCalUID: "shared-legacy@google.com",
    start: { dateTime: "2026-09-12T08:00:00.000Z" },
    end: { dateTime: "2026-09-12T09:00:00.000Z" },
    summary: "[Jimmy] Présentation iNrCy",
    extendedProperties: {
      private: {
        inrcyTeamMirror: "v1",
        sourceCalendarId: "contact@admin-inrcy.com",
        sourceEventId: "source-event-42",
      },
    },
  };

  const sourceIdentity = sharedVisioMirrorDeduplicationIdentity(source, {
    sourceCalendarId: "contact@admin-inrcy.com",
    managedOrganizerEmails: ["jimmy.wright@inrcy.com"],
  });
  assert.equal(
    sourceIdentity,
    sharedVisioMirrorDeduplicationIdentity(currentMirror),
  );
  assert.equal(
    sourceIdentity,
    sharedVisioMirrorDeduplicationIdentity(legacyMirror),
  );
});

test("des invitations externes identiques sont dédupliquées par pro, créneau et contenu", () => {
  const base = {
    start: { dateTime: "2026-09-12T08:00:00.000Z" },
    end: { dateTime: "2026-09-12T09:00:00.000Z" },
    summary: "Facturation électronique : les 5 étapes pour être prêt à temps",
    organizer: { email: "no-reply@livestorm-events.com" },
  };
  const first = sharedVisioMirrorDeduplicationIdentity(
    {
      ...base,
      id: "external-a",
      iCalUID: "a@livestorm-events.com",
    },
    {
      sourceCalendarId: "contact@admin-inrcy.com",
      assignedMemberId: "jimmy",
      managedOrganizerEmails: ["jimmy.wright@inrcy.com"],
    },
  );
  const second = sharedVisioMirrorDeduplicationIdentity(
    {
      ...base,
      id: "external-b",
      iCalUID: "b@livestorm-events.com",
    },
    {
      sourceCalendarId: "contact@admin-inrcy.com",
      assignedMemberId: "jimmy",
      managedOrganizerEmails: ["jimmy.wright@inrcy.com"],
    },
  );

  assert.equal(first, second);
});

test("la clé externe ne mélange jamais deux professionnels", () => {
  const base = {
    start: { dateTime: start },
    end: { dateTime: "2026-09-12T09:00:00.000Z" },
    summary: "Démonstration externe",
    organizer: { email: "no-reply@example.com" },
  };
  const jimmy = sharedVisioMirrorDeduplicationIdentity(
    { ...base, id: "event-jimmy", iCalUID: "jimmy@example.com" },
    {
      sourceCalendarId: "contact@admin-inrcy.com",
      assignedMemberId: "jimmy",
    },
  );
  const oceane = sharedVisioMirrorDeduplicationIdentity(
    { ...base, id: "event-oceane", iCalUID: "oceane@example.com" },
    {
      sourceCalendarId: "oceane.pinceloup@inrcy.com",
      assignedMemberId: "oceane",
    },
  );

  assert.notEqual(jimmy, oceane);
});

test("un professionnel garde une seule identité malgré plusieurs anciens nonces", () => {
  const first = {
    id: "booking-a",
    start: { dateTime: "2026-09-12T08:00:00.000Z" },
    end: { dateTime: "2026-09-12T09:00:00.000Z" },
    extendedProperties: {
      private: {
        prospectUserId: "863fe7b1-d7e2-4f74-b2f7-f939707853b2",
        bookingNonce: "ancien-nonce-a",
      },
    },
  };
  const second = {
    ...first,
    id: "booking-b",
    start: { dateTime: "2026-09-14T13:00:00.000Z" },
    end: { dateTime: "2026-09-14T14:00:00.000Z" },
    extendedProperties: {
      private: {
        prospectUserId: "863fe7b1-d7e2-4f74-b2f7-f939707853b2",
        bookingNonce: "ancien-nonce-b",
      },
    },
  };

  assert.equal(
    canonicalVisioAppointmentIdentity(first),
    canonicalVisioAppointmentIdentity(second),
  );
  assert.equal(
    sharedVisioMirrorDeduplicationIdentity(first),
    sharedVisioMirrorDeduplicationIdentity(second),
  );
});
