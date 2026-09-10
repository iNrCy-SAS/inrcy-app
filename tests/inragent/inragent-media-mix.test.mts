import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAiMediaGeneratorPreferences,
} from "../../lib/aiMediaGenerationPreferences.ts";
import { resolveInrAgentMediaMix } from "../../lib/inrAgentMediaMix.ts";
import { normalizeInrAgentStudioMediaPreferencePercent } from "../../lib/inrAgentSettings.ts";

test("le curseur iNrAgent est borné et ses décisions sont déterministes", () => {
  assert.equal(normalizeInrAgentStudioMediaPreferencePercent(94, 80), 100);
  assert.equal(normalizeInrAgentStudioMediaPreferencePercent(69, 80), 60);
  assert.equal(normalizeInrAgentStudioMediaPreferencePercent("invalid", 80), 80);

  const studio = resolveInrAgentMediaMix({
    kind: "video",
    theme: "conseils",
    studioMediaPreferencePercent: 150,
    seed: "always-studio",
  });
  const creative = resolveInrAgentMediaMix({
    kind: "image",
    theme: "conseils",
    studioMediaPreferencePercent: -20,
    seed: "always-creative",
  });

  assert.equal(studio.mode, "studio");
  assert.equal(studio.studioMediaPreferencePercent, 100);
  assert.equal(creative.mode, "creative");
  assert.equal(creative.studioMediaPreferencePercent, 0);

  const first = resolveInrAgentMediaMix({
    kind: "video",
    theme: "offres",
    studioMediaPreferencePercent: 70,
    seed: "same-action:0",
  });
  const retry = resolveInrAgentMediaMix({
    kind: "video",
    theme: "offres",
    studioMediaPreferencePercent: 70,
    seed: "same-action:0",
  });
  assert.deepEqual(retry, first);
});

test("le pourcentage produit bien un mix borné entre Studio et variations", () => {
  let studioCount = 0;
  for (let index = 0; index < 1_000; index += 1) {
    const result = resolveInrAgentMediaMix({
      kind: "image",
      theme: "services",
      studioMediaPreferencePercent: 70,
      seed: `batch:${index}`,
    });
    if (result.mode === "studio") studioCount += 1;
  }

  // Le hash FNV-1a doit rester proche de la cible sans introduire de
  // dépendance à Math.random ou à l'état d'un serveur.
  assert.ok(studioCount >= 600 && studioCount <= 800);
});

test("les blocs Studio sauvegardés sont appliqués sans réutiliser l'identité", () => {
  const preferences = normalizeAiMediaGeneratorPreferences(null);
  preferences.blocks[1] = {
    saved: true,
    defaults: { kind: "image", subjectSource: "profile" },
  };
  preferences.blocks[2] = {
    saved: true,
    defaults: { typology: "offer", format: "landscape" },
  };
  preferences.blocks[3] = {
    saved: true,
    defaults: {
      visualStyle: "premium",
      creativity: "bold",
      useBrandColors: false,
      logoMode: "none",
    },
  };
  preferences.blocks[4] = {
    saved: true,
    defaults: { imageStyle: "illustration", shotType: "close" },
  };
  preferences.blocks[5] = {
    saved: true,
    defaults: {
      peopleMode: "team",
      identityMode: "reference_team",
      teamVideoMode: "cinematic",
      teamVideoSpeechMode: "characters",
    },
  };
  preferences.blocks[6] = {
    saved: true,
    defaults: {
      durationSeconds: 16,
      connectScenes: true,
      withText: true,
      withMusic: false,
      withNarration: false,
      narrationVoice: "male",
    },
  };

  const result = resolveInrAgentMediaMix({
    kind: "video",
    theme: "conseils",
    studioMediaPreferencePercent: 100,
    studioPreferences: preferences,
    seed: "studio-settings",
  });

  assert.equal(result.mode, "studio");
  assert.deepEqual(result.appliedStudioBlockIds, [2, 3, 4, 5, 6]);
  assert.equal(result.format, "landscape");
  assert.equal(result.visualStyle, "premium");
  assert.equal(result.imageStyle, "illustration");
  assert.equal(result.shotType, "close");
  assert.equal(result.peopleMode, "team");
  assert.equal(result.teamVideoMode, "cinematic");
  assert.equal(result.teamVideoSpeechMode, "characters");
  assert.equal(result.durationSeconds, 16);
  assert.equal(result.connectScenes, true);
  assert.equal(result.withMusic, false);
  assert.equal(result.withNarration, false);
  assert.equal(result.narrationVoice, "male");
  // Le mode d'identité et le consentement sont ponctuels : ils ne font pas
  // partie de la résolution automatique iNrAgent.
  assert.equal("identityMode" in result, false);
  assert.equal("identityConsent" in result, false);
});
