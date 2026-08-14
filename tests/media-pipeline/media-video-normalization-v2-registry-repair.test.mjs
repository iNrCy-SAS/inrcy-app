import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const MIGRATION_PATH =
  "ops/sql/2026-08-06_video_normalization_v2_registry_repair.sql";
const VERIFY_PATH =
  "ops/sql/2026-08-06_video_normalization_v2_registry_repair_verify.sql";
const read = (file) =>
  readFileSync(resolve(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const migration = read(MIGRATION_PATH);
const verify = read(VERIFY_PATH);
const rpc = migration.match(
  /create or replace function public\.inrcy_enqueue_video_normalization[\s\S]*?\n\$\$;/,
)?.[0];
const repair = migration.split(
  "-- Reparation one-shot, elle-meme idempotente.",
)[1];
const activeLeaseGuard = migration.match(
  /do \$video_v2_active_lease_guard\$[\s\S]*?\$video_v2_active_lease_guard\$;/,
)?.[0];

test("the migration fences legacy writers before replacing the RPC", () => {
  const tableFence = migration.match(
    /lock table[\s\S]*?in exclusive mode nowait;/i,
  )?.[0];
  assert.ok(
    tableFence,
    "transactional EXCLUSIVE NOWAIT table fence not found",
  );
  for (const table of [
    "public.media_processing_jobs",
    "public.pro_media_library",
    "public.media_variants",
    "public.publication_workspace_media",
    "public.publication_workspaces",
  ]) {
    assert.ok(tableFence.includes(table), `missing fenced table: ${table}`);
  }
  assert.ok(
    migration.indexOf(tableFence) < migration.indexOf(activeLeaseGuard),
    "the table fence must precede the active-lease audit",
  );
  assert.ok(
    migration.indexOf(tableFence) <
      migration.indexOf("create or replace function"),
    "legacy writers must be fenced before the replacement RPC is installed",
  );
});

test("the replacement RPC derives every video signature from p_pipeline_version", () => {
  assert.ok(rpc, "replacement RPC not found");
  for (const signature of [
    "inrcy:video:canonical:v%s",
    "inrcy:video:ai_preview:v%s",
    "inrcy:video:thumbnail:v%s",
    "inrcy:video:frame:01:v%s",
    "inrcy:video:frame:02:v%s",
    "inrcy:video:frame:03:v%s",
    "inrcy:video:audio_track:v%s",
  ]) {
    assert.ok(
      rpc.includes("format(\n    '" + signature + "', p_pipeline_version\n  )"),
      "dynamic signature missing: " + signature,
    );
  }
  assert.doesNotMatch(
    rpc,
    /inrcy:video:(?:canonical|ai_preview|thumbnail|frame:0[1-3]|audio_track):v1/,
  );
});

test("job identity remains stable while technical payload fields are merged", () => {
  assert.ok(rpc);
  assert.match(
    rpc,
    /v_idempotency_key := 'video-normalize:v1:' \|\| p_media_id::text/,
  );
  assert.match(rpc, /'video_normalize_v1'/);
  assert.match(
    rpc,
    /payload = coalesce\(payload, '\{\}'::jsonb\)[\s\S]*?\|\| jsonb_build_object\([\s\S]*?'pipelineVersion', p_pipeline_version/,
  );
  assert.match(rpc, /\? 'pipelineMission'/);
  assert.match(rpc, /\? 'requiredOutputs'/);
  assert.doesNotMatch(
    rpc,
    /payload = jsonb_build_object\(\s*'pipelineVersion'/,
  );
});

test("enqueue locks job before media and leaves an active lease untouched", () => {
  assert.ok(rpc);
  const advisoryLock = rpc.indexOf("pg_catalog.pg_advisory_xact_lock");
  const jobLock = rpc.search(
    /select \*\s+into v_existing_job\s+from public\.media_processing_jobs[\s\S]*?for update;/,
  );
  const mediaLock = rpc.search(
    /select \*\s+into v_media\s+from public\.pro_media_library[\s\S]*?for update;/,
  );
  assert.notEqual(advisoryLock, -1, "per-media enqueue lock not found");
  assert.notEqual(jobLock, -1, "RPC job lock not found");
  assert.notEqual(mediaLock, -1, "RPC media lock not found");
  assert.ok(advisoryLock < jobLock, "enqueue serialization must happen first");
  assert.ok(jobLock < mediaLock, "RPC must lock job before media");
  assert.equal(
    (rpc.match(/from public\.media_processing_jobs/g) || []).length,
    1,
    "RPC must not reacquire the job after locking media",
  );

  const activeLeaseAck = rpc.match(
    /-- Un worker avec une lease encore valide[\s\S]*?\n  end if;/,
  )?.[0];
  assert.ok(activeLeaseAck, "active lease ACK branch not found");
  assert.match(activeLeaseAck, /v_job_status = 'processing'/);
  assert.match(
    activeLeaseAck,
    /v_existing_job\.lock_expires_at > v_now/,
  );
  assert.match(activeLeaseAck, /v_now - interval '15 minutes'/);
  assert.match(activeLeaseAck, /'retryable', true/);
  assert.match(
    activeLeaseAck,
    /'reason', 'active_job_unchanged_retry_later'/,
  );
  assert.match(activeLeaseAck, /'registryUpgradeDeferred', true/);
  assert.match(
    activeLeaseAck,
    /v_existing_job\.payload -> 'canonicalVariantId'/,
  );
  assert.doesNotMatch(
    activeLeaseAck,
    /\b(?:insert|update|delete|merge)\b\s+(?:into\s+)?public\.|variant_id\s*=/,
  );
  for (const mutation of [
    "insert into public.media_variants",
    "update public.media_variants",
    "insert into public.media_processing_jobs",
    "update public.media_processing_jobs",
    "update public.pro_media_library",
  ]) {
    assert.ok(
      rpc.indexOf(activeLeaseAck) < rpc.indexOf(mutation),
      `active lease ACK must precede mutation: ${mutation}`,
    );
  }
});

test("an expired processing lease upgrades the same job as retryable", () => {
  assert.ok(rpc);
  assert.match(
    rpc,
    /when v_job_status = 'processing' then 'retry_wait'/,
  );
  assert.match(
    rpc,
    /attempt_count = case[\s\S]*?when v_job_status = 'processing' then 0/,
  );
  assert.match(rpc, /locked_at = null/);
  assert.match(rpc, /lock_expires_at = null/);
  assert.match(rpc, /locked_by = null/);
  assert.match(rpc, /processing_lease_expired_registry_upgrade/);
  assert.match(
    rpc,
    /set processing_status = case[\s\S]*?when v_job_status = 'processing' then 'queued'/,
  );
  assert.match(
    rpc,
    /processing_progress = case[\s\S]*?when v_job_status = 'processing' then 0/,
  );
  assert.match(
    rpc,
    /where id = v_job_id;/,
  );
  assert.equal(
    (rpc.match(/insert into public\.media_processing_jobs/g) || []).length,
    1,
    "the RPC must keep a single idempotent job creation path",
  );
});

test("the data repair upgrades and requeues the existing v2 job in place", () => {
  assert.ok(repair, "repair block not found");
  assert.match(repair, /payload ->> 'pipelineVersion' = '2'/);
  assert.match(repair, /'inrcy:video:canonical:v1'/);
  assert.match(repair, /'inrcy:video:canonical:v2'/);
  assert.match(repair, /update public\.media_processing_jobs/);
  assert.match(
    repair,
    /set variant_id = v_canonical_id,[\s\S]*?status = 'queued'/,
  );
  assert.match(repair, /attempt_count = 0/);
  assert.match(repair, /locked_at = null/);
  assert.match(
    repair,
    /payload = coalesce\(v_job\.payload, '\{\}'::jsonb\)/,
  );
  assert.match(repair, /'registryRepair', 'video_v2_signatures'/);
  assert.match(repair, /set status = 'waiting_media'/);
  assert.doesNotMatch(repair, /insert into public\.media_processing_jobs/);
});

test("the repair refuses active workers and locks job before media", () => {
  assert.ok(activeLeaseGuard, "active lease guard not found");
  assert.match(activeLeaseGuard, /j\.status = 'processing'/);
  assert.match(activeLeaseGuard, /j\.lock_expires_at > now\(\)/);
  assert.match(
    activeLeaseGuard,
    /coalesce\(j\.locked_at, j\.updated_at, j\.created_at\)[\s\S]*?> now\(\) - interval '15 minutes'/,
  );
  assert.match(
    activeLeaseGuard,
    /VIDEO_V2_REGISTRY_REPAIR_ACTIVE_LEASE/,
  );
  assert.match(activeLeaseGuard, /errcode = '55006'/);
  assert.ok(
    migration.indexOf(activeLeaseGuard) <
      migration.indexOf("create or replace function"),
    "active lease guard must run before any migration mutation",
  );

  assert.ok(repair, "repair block not found");
  const jobLock = repair.search(
    /select \*\s+into v_job\s+from public\.media_processing_jobs[\s\S]*?for update;/,
  );
  const mediaLock = repair.search(
    /select \*\s+into v_media\s+from public\.pro_media_library[\s\S]*?for update;/,
  );
  assert.notEqual(jobLock, -1, "repair job lock not found");
  assert.notEqual(mediaLock, -1, "repair media lock not found");
  assert.ok(jobLock < mediaLock, "repair must lock job before media");
  assert.match(repair, /v_job\.status = 'processing'/);
  assert.match(repair, /VIDEO_V2_REGISTRY_REPAIR_ACTIVE_LEASE/);
});

test("v2 ready variants get the right pipeline label without being reset", () => {
  assert.ok(rpc);
  const rpcVersionFix = rpc.match(
    /update public\.media_variants\s+set pipeline_version = p_pipeline_version,[\s\S]*?and pipeline_version is distinct from p_pipeline_version;/,
  )?.[0];
  assert.ok(rpcVersionFix, "RPC all-status pipeline version fix not found");
  assert.doesNotMatch(rpcVersionFix, /set status = 'pending'/);

  assert.ok(repair);
  const repairVersionFix = repair.match(
    /update public\.media_variants\s+set pipeline_version = 2,[\s\S]*?and pipeline_version is distinct from 2;/,
  )?.[0];
  assert.ok(
    repairVersionFix,
    "repair all-status pipeline version fix not found",
  );
  assert.doesNotMatch(repairVersionFix, /set status = 'pending'/);
});

test("the SQL remains additive and the verify script checks registry invariants", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /on conflict do nothing/);
  assert.match(
    migration,
    /grant execute on function[\s\S]*?to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /\bdrop\s+(?:table|column|function)\b|\btruncate\b|\bdelete\s+from\b/i,
  );
  assert.equal((migration.match(/\$\$/g) || []).length % 2, 0);
  assert.equal(
    (migration.match(/\$video_v2_active_lease_guard\$/g) || []).length,
    2,
  );
  assert.equal((migration.match(/\$video_v2_repair\$/g) || []).length, 2);

  assert.match(verify, /security_definer/);
  assert.match(verify, /fixed_search_path/);
  assert.match(verify, /service_role_auth_gate/);
  assert.match(verify, /p\.prosecdef/);
  assert.match(verify, /p\.proconfig/);
  assert.match(verify, /auth\\\.role\\\(\\\)/);
  assert.match(verify, /concurrent_enqueues_are_serialized/);
  assert.match(verify, /job_lock_precedes_media_lock/);
  assert.match(verify, /active_lease_ack_precedes_all_mutations/);
  assert.match(verify, /all_video_signatures_are_dynamic/);
  assert.match(verify, /v2_jobs_still_pointing_to_v1/);
  assert.match(verify, /v2_active_lease_repair_candidates/);
  assert.match(verify, /having count\(distinct v\.signature\) <> 7/);
  assert.match(verify, /v2_variants_with_wrong_pipeline_version/);
  assert.match(verify, /v2_payload_reference_inconsistencies/);
  assert.match(verify, /payload\.canonicalVariantId/);
  assert.match(verify, /payload\.aiPreviewVariantId/);
  assert.match(verify, /payload\.thumbnailVariantId/);
  assert.match(verify, /payload\.frameVariantIds\[0\]/);
  assert.match(verify, /payload\.frameVariantIds\[1\]/);
  assert.match(verify, /payload\.frameVariantIds\[2\]/);
  assert.match(verify, /payload\.audioTrackVariantId/);
  assert.match(verify, /v\.media_id is distinct from refs\.media_id/);
  assert.match(verify, /v\.purpose is distinct from refs\.expected_purpose/);
  assert.match(
    verify,
    /v\.signature is distinct from refs\.expected_signature/,
  );
  assert.match(verify, /v\.pipeline_version is distinct from 2/);
  assert.match(verify, /having count\(\*\) > 1/);
  assert.match(verify, /payload ->> 'pipelineMission'/);
  assert.match(verify, /payload -> 'requiredOutputs'/);
});
