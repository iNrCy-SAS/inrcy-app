import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const generation = read("app/dashboard/booster/publier/useBoosterGeneration.ts");
const workspace = read(
  "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
);
const publishRoute = read("app/api/booster/publish-now/route.ts");
const generationRoute = read("app/api/booster/generate/route.ts");
const aiPolicy = read("lib/aiGatewayPolicy.ts");
const asyncPublication = read("lib/boosterAsyncPublication.ts");
const migration = read(
  "ops/sql/2026-08-05_publication_realtime_load_hardening.sql",
);
const migrationVerification = read(
  "ops/sql/2026-08-05_publication_realtime_load_hardening_verify.sql",
);
const boosterMetrics = read("app/api/booster/metrics/route.ts");
const propulserMetrics = read("app/api/propulser/metrics/route.ts");

test("generation applies its safety deadline and starts local captures for every accepted video", () => {
  assert.match(generation, /Date\.now\(\) \+ BOOSTER_GENERATION_SAFETY_BUDGET_MS/);
  assert.match(
    generation,
    /BOOSTER_GENERATION_SAFETY_BUDGET_MS\s*=\s*105_000/,
  );
  assert.match(generation, /generationDeadlineAt/);
  assert.match(generation, /controller\.abort\(\)/);
  assert.match(
    modal,
    /Les captures locales commencent dès l'insertion de toute vidéo acceptée\.[\s\S]*getOrPrepareVideoFramesForAI\(videoFile\)/,
  );
  assert.match(
    generation,
    /settleOptionalMediaEnrichment\([\s\S]{0,120}getOrPrepareVideoFramesForAI\(videoFile\)[\s\S]{0,100}BOOSTER_LOCAL_MEDIA_ENRICHMENT_BUDGET_MS/,
  );
  assert.doesNotMatch([modal, submission].join("\n"), /INR_MEDIA_VIDEO_COMPRESSION_TRIGGER_BYTES/);
  assert.match(
    generation,
    /useWorkspaceMediaForAI:[\s\S]*?unifiedMediaConsumptionClientAvailable[\s\S]*?Boolean\(readyMediaWorkspaceId\)/,
  );
  assert.match(generation, /imagesForAI:\s*mediaPipelineCutoverEnabled \? \[\] : imagesForAI/);
  assert.match(
    generationRoute,
    /routeStartedAt \+ BOOSTER_GENERATION_SAFETY_BUDGET_MS/,
  );
  assert.match(
    generationRoute,
    /retries:\s*0,[\s\S]*timeoutMs:\s*transcriptionTimeoutMs/,
  );
  assert.match(
    aiPolicy,
    /"booster\.publish"[\s\S]*maxTimeoutMs:\s*70_000[\s\S]*defaultOperationMaxDurationMs:\s*100_000/,
  );
});

test("the click path waits for upload then performs one source-readiness snapshot", () => {
  assert.match(workspace, /persistProgress:\s*false/);
  assert.match(workspace, /synchronizing/);
  assert.match(modal, /await waitForPersistentWorkspaceIdle/);
  assert.match(modal, /await verifyPersistentWorkspaceSources/);
  assert.match(modal, /return activeWorkspaceId/);
  assert.doesNotMatch([modal, submission].join("\n"), /preparePersistentAiMedia/);
  assert.doesNotMatch([modal, submission].join("\n"), /preparePersistentPublicationMedia/);
});

test("publication isolates red channels and dispatches the ready subset for one or ten channels", () => {
  assert.match(submission, /const preflightFailedChannels = reviewItems/);
  assert.match(
    submission,
    /const publishableChannels = reviewItems[\s\S]*item\.blockers\.length === 0/,
  );
  assert.match(submission, /Préparation des médias/);
  assert.doesNotMatch([modal, submission].join("\n"), /Préparation de la vidéo/);
  assert.match(submission, /mediaPreparationProgress/);
  assert.match(submission, /mapProgressRange\(progress, 0, 100, 23, 39\)/);
  assert.match(submission, /preflightFailedChannels,/);
  assert.match(
    publishRoute,
    /after\(async \(\) => \{[\s\S]*Promise\.allSettled\([\s\S]*queuedChannelRows\.map/,
  );
  assert.match(
    publishRoute,
    /usesOriginalSource && sourceDirectlyPublishable[\s\S]*return \[\]/,
  );
  assert.match(publishRoute, /enqueueBoosterPublication\(/);
  assert.match(
    publishRoute,
    /return NextResponse\.json\(ingress\.response, \{ status: 202 \}\)/,
  );
});

test("workers claim before uploads and patch status atomically", () => {
  const claim = publishRoute.indexOf("const channelExecution = await acquireExecutionIdempotencyLock");
  const upload = publishRoute.indexOf("const { imageSet: baseImageSet, uploadErrors } = await uploadImageSet");
  assert.ok(claim >= 0 && upload >= 0 && claim < upload);
  assert.match(asyncPublication, /inrcy_patch_app_event_payload/);
  assert.match(migration, /create or replace function public\.inrcy_patch_app_event_payload/);
});

test("dashboard metrics exclude asynchronous publication payloads from their queries", () => {
  assert.match(
    boosterMetrics,
    /\.eq\("module", "booster"\)[\s\S]*?\.in\("type", \["publish", "review_mail", "promo_mail"\]\)[\s\S]*?\.gte\("created_at", sinceMonth\)/,
  );
  assert.match(
    propulserMetrics,
    /\.in\("type", \["valorize", "review_mail", "promo_mail"\]\)/,
  );
  assert.match(migration, /app_events_propulser_metrics_user_created_idx/);
  assert.match(
    migration,
    /create index concurrently if not exists app_events_booster_metrics_user_created_idx\s+on public\.app_events \(user_id, created_at desc\)\s+where module = 'booster'\s+and type in \('publish', 'review_mail', 'promo_mail'\)/,
  );
});

test("publication hardening has a read-only index validity audit", () => {
  assert.match(
    migration,
    /commit;[\s\S]*create index concurrently if not exists app_events_booster_metrics_user_created_idx/,
  );
  assert.match(
    migrationVerification,
    /'app_events_booster_metrics_user_created_idx'/,
  );
  for (const status of ["MISSING", "VALID", "INVALID"]) {
    assert.match(migrationVerification, new RegExp(`'${status}'`));
  }
  assert.match(migrationVerification, /pg_index\.indisvalid/);
  assert.match(migrationVerification, /pg_index\.indisready/);
  const verificationStatements = migrationVerification.replace(/^--.*$/gm, "");
  assert.doesNotMatch(
    verificationStatements,
    /\b(?:insert|update|delete|create|alter|drop|truncate)\b/i,
  );
});
