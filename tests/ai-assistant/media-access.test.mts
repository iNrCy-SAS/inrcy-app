import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { hasActiveAccountSubscription } from "../../lib/accountSubscriptionPolicy.ts";
import type * as Access from "../../lib/inrAssistantMediaAccess.ts";

function harness(options: { authError?: boolean; missingScope?: boolean; active?: boolean; lookupError?: boolean } = {}) {
  const requestedAccounts: string[][] = [];
  const stubs: Record<string, unknown> = {
    "server-only": {},
    "@/lib/requireUser": { requireUser: async () => ({ activeUserId: options.missingScope ? "" : "active-establishment", authUserId: "authenticated-member", errorResponse: options.authError ? {} : null }) },
    "@/lib/accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async (ids: string[]) => {
      requestedAccounts.push([...ids]);
      if (options.lookupError) throw new Error("Raw database details must stay private");
      return new Set(options.active === false ? [] : ids);
    } },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantMediaAccess.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, {})((id: string) => {
    if (!(id in stubs)) throw new Error(`Unexpected dependency: ${id}`);
    return stubs[id];
  }, moduleRecord, moduleRecord.exports);
  return { runtime: moduleRecord.exports as typeof Access, requestedAccounts };
}

test("generation authorization uses the active establishment's owner subscription, not member identity", async () => {
  const h = harness();
  const access = await h.runtime.checkInrAssistantMediaGenerationAccess();
  assert.equal(access.allowed, true);
  assert.deepEqual(h.requestedAccounts, [["active-establishment"]]);
  if (access.allowed) assert.equal(access.authUserId, "authenticated-member");
});

test("inactive account and unverifiable subscription fail closed only for new media", async () => {
  for (const [options, code] of [[{ active: false }, "subscription_inactive"], [{ lookupError: true }, "subscription_check_unavailable"]] as const) {
    const h = harness(options);
    const access = await h.runtime.checkInrAssistantMediaGenerationAccess();
    assert.equal(access.allowed, false);
    if (!access.allowed) {
      assert.equal(access.code, code);
      assert.doesNotMatch(access.message, /Raw database/);
      assert.match(access.message, /aider|guider/);
    }
  }
});

test("missing authentication or unresolved scope cannot query another account's entitlement", async () => {
  for (const options of [{ authError: true }, { missingScope: true }]) {
    const h = harness(options);
    const access = await h.runtime.checkInrAssistantMediaGenerationAccess();
    assert.equal(access.allowed, false);
    assert.equal(h.requestedAccounts.length, 0);
  }
});

test("canonical trial policy rejects expired trialing status before a delayed billing cron", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  assert.equal(hasActiveAccountSubscription({ status: "active" }, now), true);
  assert.equal(hasActiveAccountSubscription({ status: "trialing", trial_end_at: "2026-10-25T12:00:01Z" }, now), true);
  assert.equal(hasActiveAccountSubscription({ status: "trialing", trial_end_at: "2026-10-25T12:00:00Z" }, now), false);
  assert.equal(hasActiveAccountSubscription({ status: "trialing", trial_end_at: "2026-10-24T12:00:00Z" }, now), false);
  assert.equal(hasActiveAccountSubscription({ status: "trialing", start_date: "2026-10-01T12:00:00Z" }, now), false);
  assert.equal(hasActiveAccountSubscription({ status: "trialing", start_date: "2026-10-20T12:00:00Z" }, now), true);
  assert.equal(hasActiveAccountSubscription({ status: "canceled" }, now), false);
  assert.equal(hasActiveAccountSubscription(null, now), false);
});
