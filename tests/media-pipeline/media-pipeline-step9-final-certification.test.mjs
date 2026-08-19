import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

test("le rapport SQL final est global et strictement en lecture seule", () => {
  const sql = read(
    "ops/sql/2026-07-29_media_pipeline_step9_final_certification.sql",
  );
  assert.match(sql, /public\.pro_media_library/);
  assert.match(sql, /public\.publication_workspaces/);
  assert.match(sql, /public\.publication_workspace_media/);
  assert.match(sql, /public\.media_variants/);
  assert.match(sql, /public\.media_processing_jobs/);
  assert.match(sql, /inrcy_enqueue_image_normalization/);
  assert.match(sql, /inrcy_enqueue_video_normalization/);
  assert.match(sql, /media_variants_channel_publish_lookup_idx/);
  assert.match(sql, /inrcy-pro-media/);
  assert.match(sql, /jobs_processing_lease_expired/);
  assert.match(sql, /workspaces_publishing_stale/);
  assert.doesNotMatch(
    sql,
    /\b(insert|update|delete|drop|truncate|alter|create)\b/i,
  );
});

test("le healthcheck interne certifie flags, tables, buckets et files", () => {
  const health = read("lib/health/checks.ts");
  const cron = read("app/api/cron/health/route.ts");
  assert.match(health, /buildMediaPipelineCertificationSnapshot/);
  assert.match(health, /checkMediaPipeline/);
  assert.match(health, /publication_workspace_media/);
  assert.match(health, /storage\.getBucket\("booster"\)/);
  assert.match(health, /storage\.getBucket\("inrcy-pro-media"\)/);
  assert.match(health, /bucket_inrcy_pro_media_must_be_private/);
  assert.match(health, /expired_processing_jobs/);
  assert.match(health, /stale_publishing_workspaces/);
  assert.match(cron, /report\.checks\.media_pipeline/);
});

test("le cron image reste espacé et le worker vidéo tourne chaque minute", () => {
  const vercel = JSON.parse(read("vercel.json"));
  const byPath = new Map(vercel.crons.map((item) => [item.path, item.schedule]));
  assert.equal(byPath.get("/api/cron/media-image-normalization"), "2-59/5 * * * *");
  assert.equal(byPath.get("/api/cron/media-video-normalization"), "*/1 * * * *");
  assert.match(
    vercel.functions["app/api/cron/media-video-normalization/route.ts"].includeFiles,
    /ffmpeg-static/,
  );
});

test("la QA finale rejoue le pipeline et les modules voisins", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts["qa:media-pipeline:step9"], /qa:media-pipeline:step8/);
  assert.match(pkg.scripts["qa:media-pipeline:step9"], /audit:media-pipeline:step9/);
  assert.match(pkg.scripts["qa:media-pipeline:step9"], /test:media-pipeline:step9/);
  assert.match(pkg.scripts["certify:media-pipeline"], /qa:booster-images/);
  assert.match(pkg.scripts["certify:media-pipeline"], /test:pinterest/);
  assert.match(pkg.scripts["certify:media-pipeline"], /test:multicompte/);
  assert.match(pkg.scripts["certify:media-pipeline"], /test:inrsend/);
  assert.match(pkg.scripts["certify:media-pipeline:full"], /typecheck/);
});

test("la procédure couvre les six phases et les trois niveaux de rollback", () => {
  const guide = read("ops/MEDIA_PIPELINE_PRODUCTION_CUTOVER_2026-07-29.md");
  for (let phase = 1; phase <= 6; phase += 1) {
    assert.match(guide, new RegExp(`Phase ${phase}`));
  }
  assert.match(guide, /Rollback niveau 1/);
  assert.match(guide, /Rollback niveau 2/);
  assert.match(guide, /Rollback niveau 3/);
  assert.match(guide, /full_cutover/);
  assert.match(guide, /aucune|Ne pas annuler les migrations Supabase/i);
});

test("les scripts de contrôle vérifient le palier local et le palier déployé", () => {
  const rollout = read("scripts/verify-media-pipeline-rollout.mjs");
  const smoke = read("scripts/smoke-media-pipeline.mjs");
  assert.match(rollout, /buildMediaPipelineCertificationSnapshot/);
  assert.match(rollout, /REQUIRE_MEDIA_PIPELINE_CUTOVER/);
  assert.match(smoke, /\/api\/health\/internal/);
  assert.match(smoke, /checks\?\.media_pipeline/);
  assert.match(smoke, /full_cutover/);
});

test("le clic immédiat absorbe l'upload dans Générer, Publier et Programmer", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const workspaceHook = read(
    "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
  );
  const scheduleModal = read(
    "app/dashboard/_components/PublishScheduleModal.tsx",
  );

  assert.match(workspaceHook, /const waitForIdle = useCallback/);
  assert.match(workspaceHook, /Envoi du média/);
  assert.match(
    modal,
    /readyMediaWorkspaceId\s*=\s*shouldUsePersistentMediaWorkspaceForAi[\s\S]*readyMediaWorkspaceId\s*=\s*await waitForPersistentWorkspaceReadiness\([\s\S]*"generate"/,
  );
  assert.match(
    modal,
    /readyMediaWorkspaceId\s*=\s*await waitForPersistentWorkspaceReadiness\(\s*"publish"/,
  );
  assert.match(
    modal,
    /readyMediaWorkspaceId\s*=\s*await waitForPersistentWorkspaceReadiness\(\s*"schedule"/,
  );
  assert.match(
    modal,
    /unifiedMediaConsumptionClientAvailable && readyMediaWorkspaceId/,
  );
  assert.match(scheduleModal, /PublishExecutionProgress/);
  assert.match(scheduleModal, /publishProgress=\{progress\}/);
  assert.match(scheduleModal, /publishProgressLabel=\{resolvedProgressLabel\}/);
});
