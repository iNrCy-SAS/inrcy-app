import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../app/dashboard/gps/noticeContent.ts", import.meta.url),
  "utf8",
);

test("GPS startup follows the two cockpit entries, then analysis, company review and communication", () => {
  const profile = source.indexOf('"startup_step_profile_20260905"');
  const channels = source.indexOf('"startup_step_channels_20260905"');
  const analysis = source.indexOf('"startup_step_analyze_20260905"');
  const dna = source.indexOf('"startup_step_complete_dna_20260905"');
  const ai = source.indexOf('"startup_step_configure_ai_20260905"');

  assert.ok(profile >= 0);
  assert.ok(channels < analysis);
  assert.ok(analysis < profile);
  assert.ok(profile < dna);
  assert.ok(dna < ai);
  assert.match(source, /maxSteps: 5/);
});

test("GPS startup actions open channels and the three real personalization tabs", () => {
  assert.match(source, /label: "ouvrir_les_canaux_9322102a", href: "\/dashboard"/);
  assert.match(source, /href: "\/dashboard\/personnalisation"/);
  assert.match(source, /href: "\/dashboard\/personnalisation\?section=company"/);
  assert.match(source, /href: "\/dashboard\/personnalisation\?section=communication"/);
  assert.doesNotMatch(source, /href: "\/dashboard\/(?:mon-profil|adn-entreprise|configuration-ia)(?:\?|"|\/)/);
});
