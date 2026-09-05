import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const generation = read("lib/boosterPublishGeneration.ts");
const agentRoute = read("app/api/agent/actions/prepare-publish/route.ts");
const boosterRoute = read("app/api/booster/generate/route.ts");
const liveQaRoute = read("app/api/internal/ai-live-qa/route.ts");

test("le contexte média reste séparé des instructions d'exécution jusqu'au prompt final", () => {
  assert.match(generation, /mediaContext\?: string;/);
  assert.match(
    generation,
    /hasAudioTranscript: \/transcription audio\/i\.test\(String\(args\.mediaContext \|\| ""\)\)/,
  );
  assert.match(generation, /existingContext: args\.mediaContext/);
  assert.match(
    generation,
    /mediaContext:\s*args\.mediaContext \|\| args\.generationProfile\.request\.media\.context/,
  );
  assert.match(generation, /extraInstructions: args\.extraInstructions/);
});

test("iNrAgent transmet le contexte vidéo structuré et garde ses consignes techniques à part", () => {
  assert.match(agentRoute, /mediaContext: args\.mediaContext/);
  assert.match(agentRoute, /extraInstructions: `CONTEXTE iNr(?:’)?Agent/);
  assert.match(agentRoute, /mediaContext: selectedMediaContext/);
  assert.doesNotMatch(
    agentRoute,
    /extraInstructions:\s*\[[\s\S]{0,1200}args\.mediaContext/,
  );
});

test("l'appel principal et l'unique réparation conservent le même contexte vidéo", () => {
  assert.ok(
    (generation.match(/mediaContext: preparedMedia\.writerContext/g) || []).length >= 2,
  );
  assert.match(generation, /mediaContext: args\.mediaContext/);
  assert.match(
    generation,
    /extraInstructions:\s*\[\s*args\.extraInstructions,\s*buildSingleRepairInstructions/,
  );
});

test("les quatre niveaux de fallback vidéo sont tracés sans bloquer la génération", () => {
  for (const mode of ["full", "visual_only", "audio_only", "metadata_only"]) {
    assert.match(agentRoute, new RegExp(`return "${mode}" as const`));
  }
  assert.match(agentRoute, /videoGenerationContextMode/);
  assert.match(agentRoute, /generationContextMode: videoGenerationContextMode/);
  assert.match(agentRoute, /cleanLongContext\(videoPreparation\?\.transcript, 4_200\)/);
});

test("Booster manuel et la QA utilisent aussi le canal média dédié", () => {
  assert.match(boosterRoute, /mediaContext: mediaGenerationInstructions/);
  assert.doesNotMatch(boosterRoute, /extraInstructions: mediaGenerationInstructions/);
  assert.match(liveQaRoute, /mediaContext: videoContext/);
});
