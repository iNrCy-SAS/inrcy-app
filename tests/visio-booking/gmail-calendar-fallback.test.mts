import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = readFileSync(
  "ops/google-apps-script/inrcy-gmail-calendar-fallback.js",
  "utf8",
);

test("le secours Gmail est syntaxiquement valide et ne tourne qu'une fois par heure", () => {
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /triggerHours:\s*1/);
  assert.match(script, /\.everyHours\(INRCY_CONFIG\.triggerHours\)/);
  assert.doesNotMatch(script, /everyMinutes/);
});

test("un quota Gmail déclenche une reprise progressive et non un gel fixe de 24 h", () => {
  assert.match(script, /gmailCooldownBaseHours:\s*2/);
  assert.match(script, /gmailCooldownMaxHours:\s*12/);
  assert.match(script, /Math\.pow\(2,/);
  assert.match(script, /INRCY_GMAIL_QUOTA_FAILURES/);
  assert.doesNotMatch(script, /gmailCooldownHours:\s*24/);
  assert.match(
    script,
    /function installerAutomatisation\(\)[\s\S]*?deleteProperty\(INRCY_CONFIG\.cooldownProperty\)/,
  );
});

test("le secours reconnaît le rappel direct et ne crée pas de doublon", () => {
  assert.match(script, /champ_\(body, "User ID"\)/);
  assert.match(script, /event\.getTag\("prospectUserId"\)/);
  assert.match(script, /champ_\(body, "E-mail"\)/);
  assert.match(script, /normaliser_\(eventDescription\)/);
  assert.match(script, /stats\.existing \+= 1/);
});

test("la déduplication couvre les rendez-vous convertis et déplacés", () => {
  assert.match(script, /dedupeLookbackDays:\s*31/);
  assert.match(script, /dedupeLookaheadDays:\s*61/);
  assert.match(script, /var knownCalendarEvents = calendar\.getEvents/);
  assert.match(
    script,
    /inscriptionExisteDeja_\(\s*knownCalendarEvents,\s*messageId,\s*prospectUserId,\s*contactEmail\s*\)/,
  );
  assert.match(script, /knownCalendarEvents\.push\(event\)/);
  assert.doesNotMatch(script, /new Date\(start\.getTime\(\) - 60000\)/);
});

test("un rendez-vous déjà converti reste détecté par identité métier", () => {
  const context: Record<string, unknown> = {};
  vm.runInNewContext(
    `${script}\nthis.__inscriptionExisteDeja = inscriptionExisteDeja_;`,
    context,
  );

  const inscriptionExisteDeja = context.__inscriptionExisteDeja as (
    events: unknown[],
    messageId: string,
    prospectUserId: string,
    contactEmail: string,
  ) => boolean;

  const movedBooking = {
    getDescription: () => "Nom : Pro Test\nE-mail : pro@example.com",
    getTag: (key: string) => (key === "prospectUserId" ? "prospect-123" : ""),
  };
  assert.equal(
    inscriptionExisteDeja(
      [movedBooking],
      "message-gmail-nouveau",
      "prospect-123",
      "pro@example.com",
    ),
    true,
  );

  const bookingWithHiddenTags = {
    getDescription: () => "Client inscrit — PRO@EXAMPLE.COM",
    getTag: () => {
      throw new Error("tag non lisible");
    },
  };
  assert.equal(
    inscriptionExisteDeja(
      [bookingWithHiddenTags],
      "message-gmail-nouveau",
      "prospect-123",
      "pro@example.com",
    ),
    true,
  );

  const unrelatedEvent = {
    getDescription: () => "Rendez-vous sans rapport",
    getTag: () => "",
  };
  assert.equal(
    inscriptionExisteDeja(
      [unrelatedEvent],
      "message-gmail-nouveau",
      "prospect-123",
      "pro@example.com",
    ),
    false,
  );
});
