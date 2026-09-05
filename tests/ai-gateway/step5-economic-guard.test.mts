import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { AI_ENGINE_OPTIONS } from "../../lib/aiEnginePreference.ts";
import {
  AI_FEATURE_POLICIES,
  AiOperationBudgetExceededError,
  assertAllowedAiGatewayModel,
  createAiOperationBudget,
  getDefaultAllowedAiGatewayModels,
  reserveAiOperationBudget,
} from "../../lib/aiGatewayPolicy.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(relDir: string): string[] {
  const abs = join(ROOT, relDir);
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = join(relDir, entry.name);
    if (["node_modules", ".next"].includes(entry.name)) return [];
    if (entry.isDirectory()) return walk(rel);
    return entry.isFile() && /\.(?:ts|tsx|mts)$/.test(entry.name) ? [rel.replaceAll("\\", "/")] : [];
  });
}

test("all Gateway feature tags have explicit economic policies", () => {
  assert.deepEqual(Object.keys(AI_FEATURE_POLICIES).sort(), [
    "agent.campaign",
    "agent.media-understanding",
    "agent.publish",
    "agent.stats-report",
    "booster.media-understanding",
    "booster.publish",
    "booster.transcribe",
    "booster.transcript-cleanup",
    "business-dna.analyze",
    "mails.attachment-image",
    "mails.attachment-video",
    "mails.generate",
    "media.image",
    "media.video",
    "reviews.google",
    "templates.generate",
  ].sort());

  for (const policy of Object.values(AI_FEATURE_POLICIES)) {
    assert.ok(policy.maxOutputTokens >= 128 && policy.maxOutputTokens <= 12_000);
    assert.ok(policy.maxRetries >= 0 && policy.maxRetries <= 1);
    assert.ok(policy.defaultOperationMaxCalls >= 1);
    assert.ok(policy.defaultOperationMaxReservedOutputTokens >= policy.maxOutputTokens);
  }
});

test("the model allowlist exactly covers the eight selectable engine models", () => {
  const allowed = getDefaultAllowedAiGatewayModels();
  assert.deepEqual(
    [...allowed].sort(),
    AI_ENGINE_OPTIONS.map((option) => option.model).sort(),
  );
  for (const option of AI_ENGINE_OPTIONS) {
    assert.doesNotThrow(() => assertAllowedAiGatewayModel(option.model));
  }
});

test("unknown models are blocked unless explicitly added by environment policy", () => {
  assert.throws(
    () => assertAllowedAiGatewayModel("unknown/provider-model"),
    /Modèle IA non autorisé/,
  );
  assert.doesNotThrow(() =>
    assertAllowedAiGatewayModel("custom/approved-model", "custom/approved-model"),
  );
});

test("operation budgets stop runaway sub-calls", () => {
  const budget = createAiOperationBudget("booster.publish", {
    maxCalls: 2,
    maxReservedOutputTokens: 1000,
    maxDurationMs: 60_000,
  });
  reserveAiOperationBudget(budget, 400);
  reserveAiOperationBudget(budget, 500);
  assert.equal(budget.calls, 2);
  assert.equal(budget.reservedOutputTokens, 900);
  assert.throws(
    () => reserveAiOperationBudget(budget, 100),
    AiOperationBudgetExceededError,
  );
});

test("operation budgets stop excessive reserved output tokens", () => {
  const budget = createAiOperationBudget("templates.generate", {
    maxCalls: 5,
    maxReservedOutputTokens: 1000,
  });
  reserveAiOperationBudget(budget, 700);
  assert.throws(
    () => reserveAiOperationBudget(budget, 400),
    /budget maximal de sortie/,
  );
});

test("every production aiGenerateJSON call is attached to an active account", () => {
  const issues: string[] = [];
  for (const file of [...walk("app"), ...walk("lib")]) {
    if (file === "lib/aiGatewayClient.ts") continue;
    const text = read(file);
    const regex = /aiGenerateJSON(?:<[^;\n]+?>)?\s*\(\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      const block = text.slice(match.index, match.index + 1100);
      if (!/\baccountId\s*(?::|[,}])/.test(block)) issues.push(`${file}:${line}`);
    }
  }
  assert.deepEqual(issues, []);
});

test("Gateway retries count real HTTP attempts and account quotas use active account scope", () => {
  const fetchSource = read("lib/observability/fetch.ts");
  const clientSource = read("lib/aiGatewayClient.ts");
  assert.match(fetchSource, /onAttempt\?:/);
  assert.match(fetchSource, /if \(onAttempt\) await onAttempt\(i\)/);
  assert.match(clientSource, /reserveAiGatewayAccountAttempt\(opts\.accountId,\s*\{/);
  assert.match(clientSource, /commitAiGatewayAccountAttempt/);
  assert.match(clientSource, /rollbackAiGatewayAccountAttempt/);

  assert.match(read("app/api/booster/generate/route.ts"), /reserveAiCredits\(\{[\s\S]{0,180}userId,[\s\S]{0,120}action: "booster"/);
  assert.match(read("app/api/mails/generate-ai/route.ts"), /reserveAiCredits\(\{[\s\S]{0,180}userId,[\s\S]{0,120}action: "mail"/);
  assert.match(read("app/api/templates/generate-ai/route.ts"), /quotaUserId: activeUserId/);
  assert.match(read("app/api/agent/actions/prepare-publish/route.ts"), /const quotaAccountId = userId/);
});
