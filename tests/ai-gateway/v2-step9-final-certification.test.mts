import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildFinalCertification } from "../../scripts/lib/ai-live-certification.mjs";
import { evaluateGeneration } from "../../scripts/lib/ai-live-qa-evaluator.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const ENGINE_IDS = [
  "openai",
  "anthropic",
  "google",
  "mistral",
  "xai",
  "perplexity",
  "deepseek",
  "meta",
];

const SCENARIOS = [
  { id: "one-fr", language: "fr", media: "text", creativity: "classic", profile: "minimal", channels: ["facebook"] },
  { id: "all-en", language: "en", media: "text", creativity: "balanced", profile: "full", channels: Array.from({ length: 9 }, (_, i) => `c${i}`) },
  { id: "all-es", language: "es", media: "image", creativity: "creative", profile: "full", channels: Array.from({ length: 9 }, (_, i) => `c${i}`) },
  { id: "five-fr-video", language: "fr", media: "video", creativity: "balanced", profile: "minimal", channels: Array.from({ length: 5 }, (_, i) => `c${i}`) },
  { id: "it", language: "it", media: "text", creativity: "balanced", profile: "full", channels: Array.from({ length: 9 }, (_, i) => `c${i}`) },
  { id: "de", language: "de", media: "text", creativity: "classic", profile: "full", channels: Array.from({ length: 5 }, (_, i) => `c${i}`) },
  { id: "nl", language: "nl", media: "text", creativity: "creative", profile: "minimal", channels: Array.from({ length: 5 }, (_, i) => `c${i}`) },
  { id: "pt", language: "pt", media: "text", creativity: "balanced", profile: "full", channels: Array.from({ length: 9 }, (_, i) => `c${i}`) },
  { id: "th", language: "th", media: "text", creativity: "balanced", profile: "full", channels: Array.from({ length: 9 }, (_, i) => `c${i}`) },
  { id: "zh", language: "zh", media: "text", creativity: "balanced", profile: "full", channels: Array.from({ length: 9 }, (_, i) => `c${i}`) },
];

function syntheticReport() {
  const results = ENGINE_IDS.flatMap((engine) =>
    SCENARIOS.map((scenario) => ({
      success: true,
      engine,
      model: `${engine}/model`,
      scenarioId: scenario.id,
      scenario,
      durationMs: 12_000,
      repairUsed: false,
      quality: {
        totalScore: 0.9,
        completeness: 1,
        preferenceAdherence: 0.86,
        languageScore: 0.94,
      },
      telemetry: {
        callCount: scenario.media === "image" && engine === "deepseek" ? 2 : 1,
        successCount: scenario.media === "image" && engine === "deepseek" ? 2 : 1,
        failureCount: 0,
        inputTokens: 1800,
        outputTokens: 450,
        totalTokens: 2250,
        reservedOutputTokens: 1400,
        costMicroUsd: 900,
        durationMsTotal: 10_000,
        usageEstimatedCalls: 0,
        configuredPricingCalls: scenario.media === "image" && engine === "deepseek" ? 2 : 1,
        fallbackPricingCalls: 0,
        maxHttpAttempts: 1,
        calls: [],
      },
      output: { versions: {} },
    })),
  );

  return {
    reportId: "synthetic",
    engines: ENGINE_IDS.map((engine) => ({ engine })),
    scenarioCount: SCENARIOS.length,
    crossEngineDiversity: Object.fromEntries(ENGINE_IDS.map((engine) => [engine, 0.68])),
    results,
  };
}

test("Step 9 certifies a complete, reliable and economically measurable matrix", () => {
  const certification = buildFinalCertification(syntheticReport());
  assert.equal(certification.certified, true);
  assert.equal(certification.coverage.engineCount, 8);
  assert.equal(certification.coverage.coversSevenLanguages, true);
  assert.equal(certification.coverage.coversAllLanguages, true);
  assert.equal(certification.coverage.coversAllMedia, true);
  assert.equal(certification.coverage.coversAllCreativity, true);
  assert.equal(certification.coverage.coversBothProfiles, true);
  assert.equal(certification.metrics.configuredPricingCoverage, 1);
  assert.ok(certification.metrics.totalTokens > 0);
  assert.ok(certification.metrics.totalCostUsd > 0);
});

test("Step 9 refuses certification when a provider is unreliable or pricing is not configured", () => {
  const report = syntheticReport();
  for (const row of report.results.filter((item) => item.engine === "meta").slice(0, 2)) {
    row.success = false;
  }
  report.results[0].telemetry.configuredPricingCalls = 0;
  report.results[0].telemetry.fallbackPricingCalls = 1;

  const certification = buildFinalCertification(report);
  assert.equal(certification.certified, false);
  const failedIds = certification.failures.map((gate) => gate.id);
  assert.ok(failedIds.includes("reliability.per_engine"));
  assert.ok(failedIds.includes("economics.configured_pricing"));
});

test("Step 9 evaluator measures detailed professional preferences, not only pronouns and emojis", () => {
  const content = [
    "Nous sommes ravis de vous présenter ce projet réalisé avec soin et une vraie attention portée à la qualité des finitions.",
    "Chaque étape a été pensée pour offrir un résultat propre, durable et agréable au quotidien. Notre équipe reste proche de vous et explique clairement les choix réalisés.",
    "Vous avez un projet extérieur ? Parlons-en ensemble pour préparer un devis adapté, sans promesse inventée. ✨🌿",
  ].join("\n\n");
  const quality = evaluateGeneration({
    output: {
      versions: {
        facebook: {
          title: "Un projet extérieur soigné",
          content,
          cta: "Demandez votre devis",
          hashtags: ["Qualite"],
        },
      },
    },
    channels: ["facebook"],
    scenario: {
      language: "fr",
      idea: "Présenter un projet extérieur réalisé avec soin",
      preferences: {
        tone: "warm",
        communicationStyle: "dynamic",
        creativity: "creative",
        length: "detailed",
        emojiLevel: "dynamic",
        voice: "nous",
        addressMode: "vous",
        commercialLevel: "balanced",
        mainGoal: "contacts",
        preferredAngle: "quality",
        preferredCta: "devis",
      },
    },
  });

  assert.ok(quality.preferenceAdherence >= 0.75);
  for (const key of [
    "addressMode",
    "emojiLevel",
    "voice",
    "length",
    "tone",
    "communicationStyle",
    "commercialLevel",
    "mainGoal",
    "preferredAngle",
    "preferredCta",
  ]) {
    assert.equal(typeof quality.preferenceBreakdown[key], "number");
  }
});

test("Step 9 live QA uses real production telemetry for tokens, costs, calls and latency gates", () => {
  const route = read("app/api/internal/ai-live-qa/route.ts");
  const client = read("lib/aiGatewayClient.ts");
  const qa = read("scripts/qa-ai-gateway-live.mjs");
  const pkg = JSON.parse(read("package.json"));

  assert.match(route, /captureAiGatewayOperationTelemetry/);
  assert.match(route, /telemetry:\s*captured\.telemetry/);
  assert.match(client, /recordAiGatewayOperationCall/);
  assert.match(client, /\[ai-generation\] transport failed/);
  assert.match(qa, /buildFinalCertification/);
  assert.match(qa, /payload\?\.telemetry/);
  assert.match(qa, /totalCostUsd/);
  assert.equal(pkg.scripts["qa:ai-gateway:certify"], "node scripts/qa-ai-gateway-live.mjs --mode=certify");
});

test("Step 9 certification remains opt-in and cannot burn a full matrix accidentally", () => {
  const qa = read("scripts/qa-ai-gateway-live.mjs");
  assert.match(qa, /RUN_CERTIFICATION/);
  assert.match(qa, /MODE === "certify"/);
  assert.match(qa, /AI_GATEWAY_LIVE_QA_APP_URL/);
  assert.match(qa, /AI_GATEWAY_LIVE_QA_SECRET/);
});
