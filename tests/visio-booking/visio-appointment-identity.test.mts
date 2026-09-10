import assert from "node:assert/strict";
import test from "node:test";

import { canonicalVisioAppointmentIdentity } from "../../lib/visioAppointmentIdentity.ts";

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
