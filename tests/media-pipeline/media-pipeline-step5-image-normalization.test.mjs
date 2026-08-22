import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

test("la migration étape 5 est additive, idempotente et réservée au worker", () => {
  const sql = read(
    "ops/sql/2026-07-29_media_pipeline_step5_image_normalization.sql",
  );
  assert.match(sql, /^begin;/m);
  assert.match(sql, /create or replace function public\.inrcy_enqueue_image_normalization/);
  assert.match(sql, /create or replace function public\.inrcy_claim_image_normalization_jobs/);
  assert.match(sql, /for update skip locked/i);
  assert.match(
    sql,
    /v_job_status in \('queued', 'processing', 'retry_wait'\)[\s\S]*then attempt_count/,
  );
  assert.doesNotMatch(
    sql,
    /attempt_count = case when v_job_status = 'processing' then attempt_count else 0 end/,
  );
  assert.match(sql, /grant execute on function[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /\bdrop\s+(table|column)\b|\btruncate\b/i);
});

test("le normaliseur produit trois variantes sans recadrer la composition", () => {
  const source = read("lib/mediaImageNormalizer.ts");
  assert.match(source, /purpose:\s*"canonical"/);
  assert.match(source, /purpose === "ai_preview"/);
  assert.match(source, /purposes:\s*\["canonical", "ai_preview", "thumbnail"\]/);
  assert.match(source, /purposes:\s*\["thumbnail"\]/);
  assert.match(source, /\.rotate\(\)/);
  assert.match(source, /fit:\s*"inside"/);
  assert.match(source, /withoutEnlargement:\s*true/);
  assert.match(source, /crop:\s*false/);
  assert.match(source, /preserve_alpha:\s*true/);
  assert.match(source, /metadata_stripped:\s*true/);
  assert.match(source, /heicConvert/);
});

test("l'upload image déclenche une préparation serveur transparente et idempotente", () => {
  const event = read("app/api/media-pipeline/upload-event/route.ts");
  const intent = read("app/api/media-pipeline/upload-intent/route.ts");
  const prepare = read("app/api/media-pipeline/workspace/prepare/route.ts");
  assert.match(event, /sourceMetadataOnly/);
  assert.match(
    event,
    /event === "uploaded" &&[\s\S]{0,80}current\.data\.media_type === "image"/,
  );
  assert.match(
    event,
    /mission:\s*sourceMetadataOnly[\s\S]{0,60}\? "publication_preparation"/,
  );
  assert.match(event, /after\(async \(\) =>[\s\S]*processImageNormalizationJobsForMedia\(/);
  assert.match(intent, /pipeline_mission:\s*"source_metadata"/);
  assert.match(intent, /preparation_scope:\s*"source_only"/);
  assert.doesNotMatch(intent, /enqueueImageNormalization\(/);
  assert.match(prepare, /enqueueImageNormalization\(\{/);
  assert.match(prepare, /mission,/);
});

test("le worker ne reçoit aucun binaire navigateur et utilise la source privée", () => {
  const worker = read("lib/mediaImageNormalizationWorker.ts");
  const cron = read("app/api/cron/media-image-normalization/route.ts");
  assert.match(
    worker,
    /createSafeStorageSignedUrl\(\s*media\.bucket_name,\s*media\.storage_path,\s*300/,
  );
  assert.match(worker, /Readable\.fromWeb/);
  assert.match(worker, /content_hash_sha256/);
  assert.match(worker, /canonical_bucket_name/);
  assert.match(worker, /failed_retryable/);
  assert.match(worker, /retry_wait/);
  assert.doesNotMatch(cron, /\.formData\s*\(/);
  assert.doesNotMatch(cron, /\.arrayBuffer\s*\(/);
});

test("le workspace exige le traitement image seulement quand son flag est actif", () => {
  const source = read("lib/mediaWorkspaceServer.ts");
  assert.match(source, /isImageNormalizationEnabled\(\)/);
  assert.match(
    source,
    /status\.mediaType === "image" && imageNormalizationEnabled/,
  );
  assert.match(source, /if \(!required\) return true/);
  assert.match(
    source,
    /\["ready", "legacy_ready"\]\.includes\(status\.publicationStatus\)/,
  );
  assert.match(source, /failed_terminal/);
});

test("le cron image est protégé et planifié sans retirer les anciens parcours", () => {
  const cron = read("app/api/cron/media-image-normalization/route.ts");
  const vercel = read("vercel.json");
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  assert.match(cron, /VERCEL_CRON_SECRET/);
  assert.match(cron, /repairPendingImageNormalizationQueue/);
  assert.match(cron, /processImageNormalizationJobs/);
  assert.match(vercel, /\/api\/cron\/media-image-normalization/);
  assert.match(modal, /uploadOriginalImagesForPublication\(/);
});
