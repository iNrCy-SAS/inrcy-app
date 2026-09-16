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
