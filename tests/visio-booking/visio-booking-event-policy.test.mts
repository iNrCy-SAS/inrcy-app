import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPendingSignupCalendarContent,
  buildPublicVisioBookingContent,
  buildSingleAssigneeVisioAttendees,
} from "../../lib/visioBookingEventPolicy.ts";

const teamMembers = [
  { id: "oceane", name: "Océane", email: "oceane@inrcy.com" },
  { id: "apolline", name: "Apolline", email: "apolline@inrcy.com" },
  { id: "jimmy", name: "Jimmy", email: "jimmy@inrcy.com" },
];

test("le rappel d'inscription ne conserve que l'identité publique utile", () => {
  const content = buildPendingSignupCalendarContent({
    event: {
      summary: "Inscription - A traiter",
      description: [
        "STATUT : A traiter",
        "Couleurs conseillées : jaune = a traiter, bleu = appelé, vert = valide, rouge = refusé.",
        "",
        "Nouvelle inscription iNrCy",
        "Nom : Mpicka",
        "Prénom : Josiane",
        "E-mail : pro@example.com",
        "Société : Belle à croquer",
        "Téléphone : 0600000000",
        "Consentement : Oui",
        "",
        "Provenance de l'inscription",
        "Campagne : acquisition-secrète",
        "",
        "Données techniques",
        "User ID : 4b6eceb7-d627-4447-b453-4f5e1e749272",
        "Provider : email",
      ].join("\n"),
    },
    assignedMember: teamMembers[1],
  });

  assert.equal(content.summary, "Inscription — Belle à croquer — Apolline");
  assert.equal(
    content.description,
    [
      "Inscription iNrCy en attente de rendez-vous.",
      "Professionnel : Josiane Mpicka",
      "Société : Belle à croquer",
      "Responsable iNrCy : Apolline",
    ].join("\n"),
  );
  assert.equal(content.location, "");
  assert.deepEqual(content.reminders, { useDefault: false, overrides: [] });
  assert.doesNotMatch(
    JSON.stringify(content),
    /statut|couleur|e-mail|téléphone|consentement|provenance|campagne|user id|provider|0600000000|pro@example/i,
  );
});

test("un titre de suivi saisi par l'équipe est conservé sans recopier le mail", () => {
  const content = buildPendingSignupCalendarContent({
    event: {
      summary: "Inscription - Mpicka à rappeler par SMS",
      description: "Professionnel : Josiane Mpicka\nSociété : Belle à croquer\nUser ID : secret",
    },
    assignedMember: teamMembers[0],
  });

  assert.equal(content.summary, "Inscription - Mpicka à rappeler par SMS");
  assert.doesNotMatch(content.description, /secret|user id/i);
});

test("l'invitation du professionnel ne contient que le libellé public du rendez-vous", () => {
  const content = buildPublicVisioBookingContent({
    prospect: { name: "Jeanne Martin", company: "Atelier Jeanne" },
    assignedMember: teamMembers[0],
  });

  assert.equal(content.summary, "Présentation iNrCy — Atelier Jeanne");
  assert.equal(
    content.description,
    [
      "Rendez-vous de présentation iNrCy.",
      "Votre interlocuteur : Océane.",
      "Le lien Google Meet est joint à cette invitation.",
    ].join("\n"),
  );
  assert.equal(content.location, "Google Meet");
  assert.doesNotMatch(
    JSON.stringify(content),
    /user id|téléphone|e-mail|campagne|source|nonce|secret|interne/i,
  );
});

test("un seul administrateur est actif tout en gardant le même événement visible par l'équipe", () => {
  const attendees = buildSingleAssigneeVisioAttendees({
    teamMembers,
    assignedMemberId: "apolline",
    externalAttendees: [
      { email: "PRO@example.com", displayName: "Le pro", optional: false },
    ],
  });

  assert.equal(attendees.length, 4);
  assert.deepEqual(
    attendees.filter((attendee) =>
      attendee.email?.endsWith("@inrcy.com") && attendee.optional === false,
    ).map((attendee) => attendee.email),
    ["apolline@inrcy.com"],
  );
  assert.equal(attendees.find((attendee) => attendee.email === "pro@example.com")?.optional, false);
});

test("une réattribution change le seul responsable sans dupliquer ni perdre le professionnel", () => {
  const attendees = buildSingleAssigneeVisioAttendees({
    teamMembers,
    assignedMemberId: "jimmy",
    currentAttendees: [
      { email: "oceane@inrcy.com", optional: false, responseStatus: "accepted" },
      { email: "apolline@inrcy.com", optional: true, responseStatus: "accepted" },
      { email: "jimmy@inrcy.com", optional: true, responseStatus: "accepted" },
      { email: "pro@example.com", displayName: "Le pro", responseStatus: "accepted" },
      { email: "PRO@example.com", displayName: "Doublon", responseStatus: "accepted" },
    ],
  });

  assert.equal(attendees.length, 4);
  assert.equal(attendees.find((attendee) => attendee.email === "jimmy@inrcy.com")?.optional, false);
  assert.equal(attendees.find((attendee) => attendee.email === "oceane@inrcy.com")?.optional, true);
  assert.equal(attendees.filter((attendee) => attendee.email === "pro@example.com").length, 1);
  assert.equal(
    attendees.find((attendee) => attendee.email === "pro@example.com")?.responseStatus,
    "accepted",
  );
});
