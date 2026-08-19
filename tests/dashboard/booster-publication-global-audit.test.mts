import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const generationRoute = read("app/api/booster/generate/route.ts");
const generationPolicy = read("lib/boosterGenerationErrorPolicy.ts");
const intentPanel = read("app/dashboard/booster/publier/components/PublishIntentPanel.tsx");
const videoPolicy = read("lib/videoPublicationPolicy.ts");
const publishRoute = read("app/api/booster/publish-now/route.ts");
const tiktokPublish = read("lib/tiktokPublish.ts");
const resultModal = read("app/dashboard/_components/PublishExecutionResultModal.tsx");
const bottomNav = read("app/dashboard/_components/ResponsiveBottomNav.tsx");
const cron = read("app/api/cron/booster-publications/route.ts");

test("stage 1 generation protections remain active", () => {
  assert.match(generationRoute, /BOOSTER_GENERATION_BURST_LIMIT = 20/);
  assert.match(generationPolicy, /generic 429[\s\S]*must never trigger an immediate second user request/i);
  assert.match(generationPolicy, /return \[502, 503, 504\]\.includes\(status\)/);
  assert.match(intentPanel, /new Set\(\[imgError\.trim\(\), genError\.trim\(\)\]/);
});

test("stage 2 validates videos with channel-specific policies", () => {
  assert.match(videoPolicy, /getVideoPublicationPolicy/);
  assert.match(videoPolicy, /validateVideoPublicationForChannel/);
  assert.match(publishRoute, /validateVideoPublicationForChannel/);
  assert.doesNotMatch(videoPolicy, /40 \* 1024 \* 1024/);
});

test("stage 3 keeps TikTok video transfer on file upload and exposes real status", () => {
  assert.match(tiktokPublish, /FILE_UPLOAD_ONLY/);
  assert.match(tiktokPublish, /source: "FILE_UPLOAD"/);
  assert.match(tiktokPublish, /fail_reason|failReason/);
});

test("stage 4 keeps partial results, retry scope and mobile modal state", () => {
  assert.match(resultModal, /failureCount/);
  assert.match(resultModal, /Publication envoyée partiellement/);
  assert.match(resultModal, /i18nT\("retenter_value_value_en_echec_b7d1f934"/);
  assert.match(bottomNav, /publishModalOpen/);
  assert.match(publishRoute, /idempotencyKey/);
});

test("stage 5 remains asynchronous and only recovers stale processing jobs", () => {
  assert.match(publishRoute, /BOOSTER_ASYNC_CHANNEL_EVENT_TYPE/);
  assert.match(publishRoute, /\{ status: 202 \}/);
  assert.match(cron, /BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS/);
  assert.match(cron, /PROCESSING_RECOVERY_GRACE_MS/);
});
