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

test("Ads Premium uses the three existing Gateway models in quality-first order", () => {
  assert.equal(DEFAULT_ADS_CAMPAIGN_STRATEGIST_MODEL, "anthropic/claude-sonnet-4.6");
  assert.deepEqual([...ADS_CAMPAIGN_MODEL_CHAIN], [
    "anthropic/claude-sonnet-4.6",
    "mistral/mistral-medium-3.5",
    "google/gemini-3-flash",
  ]);
  assert.equal(new Set(ADS_CAMPAIGN_MODEL_CHAIN).size, 3);
  const allowed = getDefaultAllowedAiGatewayModels();
  for (const model of ADS_CAMPAIGN_MODEL_CHAIN) assert.ok(allowed.has(model), `${model} must be allowlisted`);
});

test("a complete Claude result stops the chain immediately", async () => {
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

  assert.deepEqual(called, ["anthropic/claude-sonnet-4.6"]);
  assert.equal(result.model, "anthropic/claude-sonnet-4.6");
  assert.deepEqual(result.attemptedModels, called);
  assert.deepEqual(result.plan, { name: "Campagne complète" });
});

test("a Claude transport failure falls back to Mistral without retrying Claude", async () => {
  const called: string[] = [];
  const result = await generateAdsCampaignWithFallback({
    generate: async (model: string, index: number) => {
      called.push(model);
      if (index === 0) throw new Error("temporary provider failure");
      return { name: "Plan Mistral" };
    },
    validate: (raw: unknown): { name: string } | null =>
      raw && typeof raw === "object" && "name" in raw
        ? { name: String(raw.name) }
        : null,
  });

  assert.deepEqual(called, ADS_CAMPAIGN_MODEL_CHAIN.slice(0, 2));
  assert.equal(result.model, "mistral/mistral-medium-3.5");
  assert.deepEqual(result.attemptedModels, called);
});

test("parseable but incomplete plans advance through both fallbacks", async () => {
  const called: string[] = [];
  const result = await generateAdsCampaignWithFallback({
    generate: async (model: string, index: number) => {
      called.push(model);
      return { name: model, ready: index === 2 };
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

test("three incomplete plans fail closed after exactly three supplier attempts", async () => {
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

test("Ads route owns the three-model chain and product credit remains one logical action", () => {
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
