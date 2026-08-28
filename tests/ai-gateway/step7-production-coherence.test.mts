import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("matrix/full live QA goes through the real production generation pipeline", () => {
  const script = read("scripts/qa-ai-gateway-live.mjs");
  const route = read("app/api/internal/ai-live-qa/route.ts");

  assert.match(script, /\/api\/internal\/ai-live-qa/);
  assert.match(script, /productionPipeline/);
  assert.doesNotMatch(script, /function\s+requestGateway\s*\(/);
  assert.doesNotMatch(script, /function\s+neutralVisionAnalysis\s*\(/);
  assert.match(route, /generateSharedBoosterPosts\s*\(/);
  assert.match(route, /AI_GATEWAY_LIVE_QA_SECRET/);
});

test("iNrAgent sends the selected image into shared AI media understanding", () => {
  const route = read("app/api/agent/actions/prepare-publish/route.ts");

  assert.match(route, /prepareAgentSelectedImageForAI/);
  assert.match(route, /imagesForAI:\s*args\.imagesForAI/);
  assert.match(route, /imagesForAI,\s*\n\s*mediaContext:/);
  assert.match(route, /selected media AI routing/);
});

test("one creative seed is frozen across primary and targeted repair", () => {
  const generator = read("lib/boosterPublishGeneration.ts");

  assert.match(generator, /const operationHiddenAngle/);
  assert.ok((generator.match(/hiddenAngle:\s*operationHiddenAngle/g) || []).length >= 2);
});

test("unsupported raw vision never silently swaps the selected writer engine", () => {
  const routing = read("lib/aiEnginePreference.ts");

  assert.match(routing, /ne jamais remplacer silencieusement l'auteur choisi/i);
  assert.match(routing, /préanalyse visuelle neutre/i);
  assert.doesNotMatch(routing, /model:\s*visionFallbackModel/);
});

test("full live QA certifies all nine supported languages", () => {
  const script = read("scripts/qa-ai-gateway-live.mjs");
  for (const code of ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"]) {
    assert.match(script, new RegExp(`language:\\s*"${code}"`));
  }
});

test("iNrAgent reuses Booster cached professional and publication context", () => {
  const route = read("app/api/agent/actions/prepare-publish/route.ts");

  assert.match(route, /getBoosterGenerationContext/);
  assert.match(route, /const \{ profile, business, recentPublications \}/);
  assert.match(route, /professionalContextSource/);
  assert.match(route, /publicationsContextSource/);
  assert.doesNotMatch(route, /fetchRecentPublicationMemory/);
  assert.doesNotMatch(route, /from\("profiles"\)\s*\.select\("\*"\)/);
  assert.doesNotMatch(route, /from\("business_profiles"\)\s*\.select\("\*"\)/);
});
