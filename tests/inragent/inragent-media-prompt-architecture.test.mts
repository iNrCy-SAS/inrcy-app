import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildInrAgentMediaGenerationRequest } from "../../lib/inrAgentMediaRequest.ts";
import type { InrAgentMediaMixResolution } from "../../lib/inrAgentMediaMix.ts";

const ROOT = new URL("../../", import.meta.url);

function source(pathname: string) {
  return readFileSync(new URL(pathname, ROOT), "utf8");
}

function mediaMix(
  overrides: Partial<InrAgentMediaMixResolution> = {}
): InrAgentMediaMixResolution {
  return {
    mode: "creative",
    studioMediaPreferencePercent: 0,
    appliedStudioBlockIds: [],
    format: "portrait",
    visualStyle: "premium",
    imageStyle: "photo",
    shotType: "wide",
    peopleMode: "auto",
    creativity: "bold",
    useBrandColors: true,
    logoMode: "discreet",
    teamVideoMode: "cinematic",
    teamVideoSpeechMode: "voiceover",
    durationSeconds: null,
    connectScenes: false,
    withMusic: false,
    withNarration: false,
    narrationVoice: null,
    ...overrides,
  } as InrAgentMediaMixResolution;
}

test("iNrAgent normalise Générer Image sur le contrat essentiel sans texte fournisseur", () => {
  const request = buildInrAgentMediaGenerationRequest({
    requestId: "inr-agent:image-originale-1",
    idea: "Photographier un artisan qui restaure une porte ancienne à Arras",
    theme: "realisations",
    kind: "image",
    mediaMix: mediaMix(),
  });

  assert.equal(request.operation, "generate");
  assert.equal(request.inputMode, "essential");
  assert.equal(request.generationMode, "ai_free");
  assert.equal(request.peopleCriterion, "auto");
  assert.equal(request.textMode, "none");
  assert.equal(request.withText, false);
  assert.deepEqual(request.textKeywords, []);
  assert.equal(request.typology, "showcase");
  assert.equal(request.kind, "image");
  assert.equal(request.durationSeconds, null);
  assert.equal(request.withNarration, false);
  assert.deepEqual(request.inspirationImages, []);
  assert.equal(request.source, "booster");
});

test("iNrAgent traduit le casting du mix en vrai mode IA avec critères", () => {
  const solo = buildInrAgentMediaGenerationRequest({
    requestId: "inr-agent:image-personne-1",
    idea: "Montrer une menuisière qui ajuste un meuble sur mesure",
    theme: "coulisses",
    kind: "image",
    mediaMix: mediaMix({ peopleMode: "solo" }),
  });
  const team = buildInrAgentMediaGenerationRequest({
    requestId: "inr-agent:video-equipe-1",
    idea: "Suivre une équipe qui installe une cuisine puis révèle le résultat",
    theme: "realisations",
    kind: "video",
    mediaMix: mediaMix({
      format: "story",
      peopleMode: "team",
      durationSeconds: 16,
      connectScenes: false,
      withMusic: true,
      withNarration: true,
      narrationVoice: "female",
    }),
  });

  assert.equal(solo.generationMode, "ai_criteria");
  assert.equal(solo.peopleCriterion, "one");
  assert.equal(solo.peopleMode, "solo");
  assert.equal(team.generationMode, "ai_criteria");
  assert.equal(team.peopleCriterion, "group");
  assert.equal(team.peopleMode, "team");
  assert.equal(team.sceneMode, "multi");
  assert.equal(team.connectScenes, false);
  assert.equal(team.durationSeconds, 16);
  assert.equal(team.withNarration, true);
  assert.equal(team.textMode, "none");
  assert.deepEqual(team.inspirationImages, []);
});

test("iNrAgent conserve la distinction scène continue et multiscène sur 8/16/24 s", () => {
  const continuous = buildInrAgentMediaGenerationRequest({
    requestId: "inr-agent:video-continue-24",
    idea: "Filmer la rénovation complète d'une façade en un mouvement continu",
    theme: "realisations",
    kind: "video",
    mediaMix: mediaMix({
      format: "story",
      durationSeconds: 24,
      connectScenes: true,
      withMusic: true,
      withNarration: true,
      narrationVoice: "male",
    }),
  });
  const short = buildInrAgentMediaGenerationRequest({
    requestId: "inr-agent:video-courte-8",
    idea: "Montrer le geste précis d'un céramiste au tour",
    theme: "coulisses",
    kind: "video",
    mediaMix: mediaMix({
      format: "story",
      durationSeconds: 8,
      connectScenes: false,
      withMusic: true,
      withNarration: true,
      narrationVoice: "female",
    }),
  });

  assert.equal(continuous.sceneMode, "single");
  assert.equal(continuous.connectScenes, true);
  assert.equal(short.sceneMode, "single");
  assert.equal(short.connectScenes, false);
});

test("iNrAgent ne transforme jamais un mix sans référence en dialogue biométrique", () => {
  const request = buildInrAgentMediaGenerationRequest({
    requestId: "inr-agent:video-sans-identite",
    idea: "Montrer les outils d'un atelier puis la pièce terminée",
    theme: "coulisses",
    kind: "video",
    mediaMix: mediaMix({
      format: "story",
      peopleMode: "none",
      durationSeconds: 8,
      teamVideoMode: "cinematic",
      teamVideoSpeechMode: "characters",
      withMusic: false,
      withNarration: true,
      narrationVoice: "male",
    }),
  });

  assert.equal(request.peopleCriterion, "none");
  assert.equal(request.peopleMode, "none");
  assert.equal(request.teamVideoSpeechMode, "voiceover");
  assert.equal(request.withNarration, true);
  assert.deepEqual(request.inspirationImages, []);
  assert.equal(request.identityMode, "auto");
});

test("iNrAgent n'a aucun prompt parallèle et passe uniquement par le composeur Studio v23", () => {
  const agentGeneration = source("lib/inrAgentMediaGeneration.ts");
  const requestAdapter = source("lib/inrAgentMediaRequest.ts");
  const server = source("lib/aiMediaGenerationServer.ts");
  const copywriter = source("lib/aiMediaCopywriter.ts");
  const narration = source("lib/aiMediaNarration.ts");
  const prepare = source("app/api/agent/actions/prepare-publish/route.ts");
  const regenerate = source("app/api/agent/actions/regenerate-channel/route.ts");

  assert.match(agentGeneration, /generateAndSaveAiMedia/);
  assert.match(agentGeneration, /buildInrAgentMediaGenerationRequest/);
  assert.doesNotMatch(
    agentGeneration,
    /buildAiMediaPrompt|generateAiMediaImage|generateOriginalAiVideoClips/
  );
  assert.match(requestAdapter, /normalizeAiMediaGenerationRequest/);
  assert.doesNotMatch(
    requestAdapter,
    /buildAiMediaPrompt|aiGenerate|generateAiMediaImage|generateOriginalAiVideoClips/
  );
  assert.match(prepare, /generateInrAgentMedia/);
  assert.match(regenerate, /generateInrAgentMedia/);
  assert.doesNotMatch(
    `${prepare}\n${regenerate}`,
    /buildAiMediaPrompt|generateAiMediaImage|generateOriginalAiVideoClips/
  );

  assert.match(server, /buildAiMediaPrompt\(\{/);
  assert.match(server, /writeAiMediaHeadline\(\{/);
  assert.match(
    server,
    /teamVideoSpeechMode === "characters" \|\|\s*providerRequest\.withNarration/
  );
  assert.match(copywriter, /voiceoverNarrationRequested/);
  assert.match(copywriter, /spokenCopyRequested/);
  assert.match(copywriter, /identifiant_de_variation: args\.request\.requestId/);
  assert.match(copywriter, /repeatsRecentVisibleCopy/);
  assert.match(narration, /publications_recentes_a_ne_pas_reprendre/);
  assert.match(narration, /identifiant_de_variation: args\.request\.requestId/);
  assert.match(narration, /repeatsRecentNarration/);
});

test("les anciens slogans ne sont plus des secours actifs iNrAgent", () => {
  const production = [
    source("lib/inrAgentMediaGeneration.ts"),
    source("lib/inrAgentMediaRequest.ts"),
    source("lib/aiMediaCreativePlan.ts"),
  ].join("\n");

  for (const obsolete of [
    "Votre projet entre de bonnes mains",
    "Votre projet prend vie",
    "Cap sur ",
    "Notre savoir-faire en images",
    "La qualité dans chaque détail",
    "Notre expertise",
    "À vos côtés",
  ]) {
    assert.equal(
      production.includes(obsolete),
      false,
      `ancien secours détecté: ${obsolete}`
    );
  }
});
