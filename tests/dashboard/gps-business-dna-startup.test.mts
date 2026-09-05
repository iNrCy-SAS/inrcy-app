import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../app/dashboard/gps/noticeContent.ts", import.meta.url),
  "utf8",
);

test("GPS startup follows profile, channels, analysis, DNA and AI configuration", () => {
  const profile = source.indexOf('"startup_step_profile_20260905"');
  const channels = source.indexOf('"startup_step_channels_20260905"');
  const analysis = source.indexOf('"startup_step_analyze_20260905"');
  const dna = source.indexOf('"startup_step_complete_dna_20260905"');
  const ai = source.indexOf('"startup_step_configure_ai_20260905"');

  assert.ok(profile >= 0);
  assert.ok(profile < channels);
  assert.ok(channels < analysis);
  assert.ok(analysis < dna);
  assert.ok(dna < ai);
  assert.match(source, /maxSteps: 5/);
});

test("GPS startup actions open the four real workspaces", () => {
  assert.match(source, /href: "\/dashboard\/mon-profil"/);
  assert.match(source, /label: "ouvrir_les_canaux_9322102a", href: "\/dashboard"/);
  assert.match(source, /href: "\/dashboard\/adn-entreprise"/);
  assert.match(source, /href: "\/dashboard\/configuration-ia"/);
});
