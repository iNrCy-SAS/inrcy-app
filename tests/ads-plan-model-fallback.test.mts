import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADS_CAMPAIGN_MODEL_CHAIN,
  AdsCampaignModelChainError,
  DEFAULT_ADS_CAMPAIGN_STRATEGIST_MODEL,
  generateAdsCampaignWithFallback,
} from "../lib/adsCampaignIntelligence.ts";
import { AI_FEATURE_POLICIES, getDefaultAllowedAiGatewayModels } from "../lib/aiGatewayPolicy.ts";

const routeSource = readFileSync(new URL("../app/api/ads/plan/route.ts", import.meta.url), "utf8");

test("Ads Premium uses Terra first with the three established fallbacks", () => {
  assert.equal(DEFAULT_ADS_CAMPAIGN_STRATEGIST_MODEL, "openai/gpt-5.6-terra");
  assert.deepEqual([...ADS_CAMPAIGN_MODEL_CHAIN], [
    "openai/gpt-5.6-terra",
    "anthropic/claude-sonnet-4.6",
    "mistral/mistral-medium-3.5",
    "google/gemini-3-flash",
  ]);
  assert.equal(new Set(ADS_CAMPAIGN_MODEL_CHAIN).size, 4);
  const allowed = getDefaultAllowedAiGatewayModels();
  for (const model of ADS_CAMPAIGN_MODEL_CHAIN) assert.ok(allowed.has(model), `${model} must be allowlisted`);
});

test("a complete Terra result stops the chain immediately", async () => {
  const called: string[] = [];
  const result = await generateAdsCampaignWithFallback({
    generate: async (model: string) => {
      called.push(model);
      return { name: "Campagne complète" };
    },
    validate: (raw: unknown): { name: string } | null =>
      raw && typeof raw === "object" && "name" in raw
        ? { name: String(raw.name) }
        : null,
  });

  assert.deepEqual(called, ["openai/gpt-5.6-terra"]);
  assert.equal(result.model, "openai/gpt-5.6-terra");
  assert.deepEqual(result.attemptedModels, called);
  assert.deepEqual(result.plan, { name: "Campagne complète" });
});

test("an editorial rejection gets one validated primary repair before changing models", async () => {
  const called: Array<{ model: string; repair: boolean }> = [];
  const result = await generateAdsCampaignWithFallback({
    generate: async (model, _index, repair = false) => {
      called.push({ model, repair });
      return { text: repair ? "Réparation de vélos à Lille." : "x".repeat(100) };
    },
    validate: (raw) => raw.text.length <= 90 ? raw : null,
    canRepairPrimary: () => true,
  });
  assert.deepEqual(called, [{ model: ADS_CAMPAIGN_MODEL_CHAIN[0], repair: false }, { model: ADS_CAMPAIGN_MODEL_CHAIN[0], repair: true }]);
  assert.equal(result.model, ADS_CAMPAIGN_MODEL_CHAIN[0]);
  assert.equal(result.plan.text, "Réparation de vélos à Lille.");
});

test("a rejected repair falls back once and never repairs secondary models", async () => {
  const called: string[] = [];
  const result = await generateAdsCampaignWithFallback({
    generate: async (model) => { called.push(model); return { ready: model === ADS_CAMPAIGN_MODEL_CHAIN[2] }; },
    validate: (raw) => raw.ready ? raw : null,
    canRepairPrimary: () => true,
  });
  assert.deepEqual(called, [ADS_CAMPAIGN_MODEL_CHAIN[0], ...ADS_CAMPAIGN_MODEL_CHAIN.slice(0, 3)]);
  assert.deepEqual(result.attemptedModels, called);
});

test("a primary transport error skips editorial repair; a repair guard failure stops all calls", async () => {
  let repairs = 0;
  const result = await generateAdsCampaignWithFallback({
    generate: async (_model, index) => { if (!index) throw new Error("offline"); return { ready: true }; },
    validate: (raw) => raw,
    canRepairPrimary: () => { repairs++; return true; },
  });
  assert.equal(repairs, 0);
  assert.equal(result.model, ADS_CAMPAIGN_MODEL_CHAIN[1]);
  const calls: string[] = [];
  const guard = Object.assign(new Error("quota"), { code: "ai_gateway_account_limit_reached" });
  await assert.rejects(() => generateAdsCampaignWithFallback({
    generate: async (model, _index, repair) => { calls.push(model); if (repair) throw guard; return {}; },
    validate: () => null,
    canRepairPrimary: () => true,
    shouldRetry: (error) => error !== guard,
  }), (error: unknown) => error instanceof AdsCampaignModelChainError && error.lastError === guard);
  assert.deepEqual(calls, [ADS_CAMPAIGN_MODEL_CHAIN[0], ADS_CAMPAIGN_MODEL_CHAIN[0]]);
});

test("without enough time a rejected primary goes directly to the existing fallback", async () => {
  const calls: string[] = [];
  const result = await generateAdsCampaignWithFallback({
    generate: async (model, index) => { calls.push(model); return { ready: index === 1 }; },
    validate: (raw) => raw.ready ? raw : null,
    canRepairPrimary: () => false,
  });
  assert.deepEqual(calls, ADS_CAMPAIGN_MODEL_CHAIN.slice(0, 2));
  assert.equal(result.model, ADS_CAMPAIGN_MODEL_CHAIN[1]);
});

test("a Terra transport failure falls back to Claude without retrying Terra", async () => {
  const called: string[] = [];
  const result = await generateAdsCampaignWithFallback({
    generate: async (model: string, index: number) => {
      called.push(model);
      if (index === 0) throw new Error("temporary provider failure");
      return { name: "Plan Claude" };
    },
    validate: (raw: unknown): { name: string } | null =>
      raw && typeof raw === "object" && "name" in raw
        ? { name: String(raw.name) }
        : null,
  });

  assert.deepEqual(called, ADS_CAMPAIGN_MODEL_CHAIN.slice(0, 2));
  assert.equal(result.model, "anthropic/claude-sonnet-4.6");
  assert.deepEqual(result.attemptedModels, called);
});

test("parseable but incomplete plans advance through all three fallbacks", async () => {
  const called: string[] = [];
  const result = await generateAdsCampaignWithFallback({
    generate: async (model: string, index: number) => {
      called.push(model);
      return { name: model, ready: index === 3 };
    },
    validate: (raw: unknown): { name: string } | null => {
      if (!raw || typeof raw !== "object" || !("ready" in raw) || raw.ready !== true) return null;
      return { name: String("name" in raw ? raw.name : "") };
    },
  });

  assert.deepEqual(called, [...ADS_CAMPAIGN_MODEL_CHAIN]);
  assert.deepEqual(result.attemptedModels, called);
  assert.equal(result.model, "google/gemini-3-flash");
  assert.deepEqual(result.plan, { name: "google/gemini-3-flash" });
});

test("four incomplete plans fail closed after exactly four supplier attempts", async () => {
  const called: string[] = [];
  await assert.rejects(() => generateAdsCampaignWithFallback({
    generate: async (model: string) => {
      called.push(model);
      return { name: model, headlines: [] };
    },
    validate: (): { name: string } | null => null,
  }));
  assert.deepEqual(called, [...ADS_CAMPAIGN_MODEL_CHAIN]);
});

test("a failed primary repair consumes one of the four paid attempts", async () => {
  const called: string[] = [];
  await assert.rejects(() => generateAdsCampaignWithFallback({
    generate: async (model) => { called.push(model); return {}; },
    validate: () => null,
    canRepairPrimary: () => true,
  }), (error: unknown) => error instanceof AdsCampaignModelChainError && error.attemptedModels.length === 4);
  assert.deepEqual(called, ["openai/gpt-5.6-terra", "openai/gpt-5.6-terra", "anthropic/claude-sonnet-4.6", "mistral/mistral-medium-3.5"]);
});

test("an account guard error stops the chain rather than trying another supplier", async () => {
  const called: string[] = [];
  const guardError = Object.assign(new Error("account limit reached"), {
    code: "ai_gateway_account_limit_reached",
  });
  await assert.rejects(
    () => generateAdsCampaignWithFallback({
      generate: async (model: string) => {
        called.push(model);
        throw guardError;
      },
      validate: (): { name: string } | null => null,
      shouldRetry: (error: unknown) =>
        !(error && typeof error === "object" && "code" in error && error.code === "ai_gateway_account_limit_reached"),
    }),
    (error: unknown) => {
      assert.ok(error instanceof AdsCampaignModelChainError);
      assert.equal(error.lastError, guardError);
      assert.deepEqual(error.attemptedModels, [ADS_CAMPAIGN_MODEL_CHAIN[0]]);
      return true;
    },
  );
  assert.deepEqual(called, [ADS_CAMPAIGN_MODEL_CHAIN[0]]);
  assert.match(routeSource, /shouldRetry:\s*\(error\)/);
  assert.match(routeSource, /ai_gateway_account_limit_reached/);
});

test("Ads route owns its bounded model chain and product credit remains one logical action", () => {
  assert.match(routeSource, /generateAdsCampaignWithFallback\s*\(/);
  assert.match(routeSource, /allowProviderFallback:\s*false/);
  assert.equal((routeSource.match(/reserveAiCredits\s*\(/g) || []).length, 1);
  assert.equal((routeSource.match(/commitAiCredits\s*\(/g) || []).length, 1);
  assert.match(routeSource, /rollbackAiCredits\s*\(/);
  assert.match(routeSource, /planIsReadyForReview\s*\(/);
  assert.ok(AI_FEATURE_POLICIES["ads.generate"].maxOutputTokens > 3_000);
  assert.ok(
    AI_FEATURE_POLICIES["ads.generate"].defaultOperationMaxReservedOutputTokens >=
      AI_FEATURE_POLICIES["ads.generate"].maxOutputTokens,
  );
});
