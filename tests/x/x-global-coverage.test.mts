import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getBubbleViewHrefFromBlock,
  getChannelsFromSettingsDiff,
  inferChannelsFromRealtimePayload,
  inferChannelsFromSearchParams,
} from "../../app/dashboard/dashboard.shared.ts";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the dashboard invalidates and refreshes X after settings, OAuth and realtime changes", () => {
  assert.deepEqual(
    getChannelsFromSettingsDiff(
      { x: { connected: false } },
      { x: { connected: true } },
    ),
    ["x"],
  );
  assert.deepEqual(
    inferChannelsFromRealtimePayload({
      table: "integrations",
      new: { provider: "x", source: "x" },
    }),
    ["x"],
  );
  assert.deepEqual(
    inferChannelsFromRealtimePayload({
      table: "integrations",
      new: { provider: "twitter", source: "twitter" },
    }),
    ["x"],
  );
  assert.deepEqual(inferChannelsFromSearchParams("x", "x"), ["x"]);
  assert.deepEqual(inferChannelsFromSearchParams("twitter", "twitter"), ["x"]);
  assert.equal(
    getBubbleViewHrefFromBlock("x", {
      connection: { resourceUrl: "x.com/inrcy" },
    } as never),
    "https://x.com/inrcy",
  );
});

test("X uses the shared social image derivative and participates in cache freshness", () => {
  const foundations = read("app/api/booster/publish-now/publishNow.foundations.ts");
  const cacheStatus = read("app/api/dashboard/cache-status/route.ts");

  assert.match(
    foundations,
    /usesSocialDerivative\s*=\s*\[[\s\S]*?"linkedin",[\s\S]*?"x",[\s\S]*?"tiktok"/,
  );
  assert.match(
    foundations,
    /channel === "linkedin" \|\|[\s\S]*?channel === "x" \|\|[\s\S]*?channel === "tiktok"/,
  );
  assert.match(cacheStatus, /x:\s*"x"/);
  assert.match(cacheStatus, /twitter:\s*"x"/);
});

test("Business DNA names X and its OAuth callback never exposes another provider", () => {
  const memoryUi = read("app/dashboard/settings/_components/AiMemoryContent.tsx");
  const callback = read("app/api/integrations/x/callback/route.ts");

  assert.match(memoryUi, /x:\s*"X"/);
  assert.match(callback, /getXConnectionUserMessage/);
  assert.match(callback, /Connexion X annulée/);
  assert.match(callback, /connexion X est temporairement indisponible/);
  assert.doesNotMatch(callback, /Configuration LinkedIn/);
  assert.doesNotMatch(callback, /getSimpleFrenchErrorMessage/);
});

test("deployment checks document every X OAuth variable without exposing a secret", () => {
  const envCheck = read("scripts/verify-env.mjs");
  const checklist = read("docs/ENVIRONMENT_CHECKLIST.md");
  for (const key of ["X_CLIENT_ID", "X_CLIENT_SECRET", "X_REDIRECT_URI"]) {
    assert.match(envCheck, new RegExp(`"${key}"`));
    assert.ok(checklist.includes("`" + key + "`"));
  }
  assert.match(checklist, /X_OAUTH_SCOPES/);
  assert.match(checklist, /api\/integrations\/x\/callback/);
});

test("fallback totals and weekly opportunities do not silently drop X", () => {
  const fallback = read("lib/linkedinStatsFallback.ts");
  const notifications = read("app/api/cron/notifications/route.ts");
  assert.match(fallback, /"linkedin",\s*"x"/);
  assert.match(notifications, /"linkedin",\s*"x"/);
  assert.match(notifications, /channel === 'x' \? 'X'/);
});
