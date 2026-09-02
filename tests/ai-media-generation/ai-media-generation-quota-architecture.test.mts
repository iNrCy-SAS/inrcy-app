import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../..");
const migrationPath = path.join(repositoryRoot, "ops/sql/2026-08-31_ai_media_generation_quota.sql");
const preflightPath = path.join(
  repositoryRoot,
  "ops/sql/2026-08-31_ai_media_generation_preflight_read_only.sql",
);
const postflightPath = path.join(
  repositoryRoot,
  "ops/sql/2026-08-31_ai_media_generation_postflight_read_only.sql",
);
const studioAllPlansPath = path.join(
  repositoryRoot,
  "ops/sql/2026-08-31_ai_media_generation_studio_all_plans.sql",
);
const studioAllPlansPostflightPath = path.join(
  repositoryRoot,
  "ops/sql/2026-08-31_ai_media_generation_studio_all_plans_postflight_read_only.sql",
);
const quotaLimitsPatchPath = path.join(
  repositoryRoot,
  "ops/sql/2026-08-31_ai_media_generation_quota_limits_20_5_30_10.sql",
);
const quotaLimitsPostflightPath = path.join(
  repositoryRoot,
  "ops/sql/2026-08-31_ai_media_generation_quota_limits_20_5_30_10_postflight_read_only.sql",
);
const founderLimitsPatchPath = path.join(
  repositoryRoot,
  "ops/sql/2026-09-01_ai_media_generation_founder_30_10.sql",
);
const founderLimitsPostflightPath = path.join(
  repositoryRoot,
  "ops/sql/2026-09-01_ai_media_generation_founder_30_10_postflight_read_only.sql",
);
const helperPath = path.join(repositoryRoot, "lib/aiMediaGenerationQuota.ts");

const [migration, preflight, postflight, studioAllPlans, studioAllPlansPostflight, quotaLimitsPatch, quotaLimitsPostflight, founderLimitsPatch, founderLimitsPostflight, helper] = await Promise.all([
  readFile(migrationPath, "utf8"),
  readFile(preflightPath, "utf8"),
  readFile(postflightPath, "utf8"),
  readFile(studioAllPlansPath, "utf8"),
  readFile(studioAllPlansPostflightPath, "utf8"),
  readFile(quotaLimitsPatchPath, "utf8"),
  readFile(quotaLimitsPostflightPath, "utf8"),
  readFile(founderLimitsPatchPath, "utf8"),
  readFile(founderLimitsPostflightPath, "utf8"),
  readFile(helperPath, "utf8"),
]);

function sqlFunction(name: string): string {
  const start = migration.indexOf(`create function public.${name}`);
  assert.notEqual(start, -1, `RPC SQL absente: ${name}`);
  const next = migration.indexOf("create function public.", start + 20);
  return migration.slice(start, next === -1 ? migration.length : next);
}

test("le preflight embarque refuse tout prerequis incomplet avant le premier CREATE", () => {
  const firstCreate = migration.indexOf("create table public.ai_media_plan_limits");
  const embeddedPreflight = migration.slice(0, firstCreate);
  assert.ok(firstCreate > 0);

  for (const required of [
    "auth.users",
    "public.inrcy_accounts",
    "public.inrcy_account_members",
    "public.pro_media_library",
    "public.inrcy_can_access_account(uuid)",
    "public.inrcy_touch_updated_at()",
    "gen_random_uuid()",
    "pgcrypto",
    "auth_user_id",
    "account_id",
    "client_media_key",
    "media_type",
    "source",
    "upload_protocol",
    "upload_status",
    "is_active",
    "service_role",
  ]) {
    assert.match(embeddedPreflight, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(embeddedPreflight, /AI_MEDIA_PREFLIGHT_FAILED/);
  assert.match(embeddedPreflight, /AI_MEDIA_INSTALL_COLLISION/);
  assert.match(embeddedPreflight, /from pg_class/);
  assert.match(embeddedPreflight, /from pg_proc/);
  assert.match(embeddedPreflight, /from pg_trigger/);
  assert.match(embeddedPreflight, /from pg_policy/);
  assert.match(embeddedPreflight, /from pg_constraint/);
});

test("la migration first-run est strictement additive et refuse tout rerun", () => {
  assert.doesNotMatch(migration, /^\s*(?:drop|delete|truncate)\b/im);
  assert.doesNotMatch(migration, /\bcreate\s+or\s+replace\b/i);
  assert.doesNotMatch(migration, /^\s*alter\s+table\b[^;\n]*\bdrop\b/im);
  assert.doesNotMatch(migration, /\bon\s+conflict[\s\S]{0,160}\bdo\s+update\b/i);
  assert.doesNotMatch(migration, /\bcreate\s+table\s+if\s+not\s+exists\b/i);
  assert.doesNotMatch(migration, /\bcreate\s+index\s+if\s+not\s+exists\b/i);
  assert.match(migration, /create table public\.ai_media_plan_limits/);
  assert.match(migration, /create index ai_media_generation_jobs_account_created_idx/);
  assert.match(migration, /insert into public\.ai_media_plan_limits[\s\S]*?\('founder', 150, 12, true\);/);
});

test("le preflight distinct est garanti read-only et retourne READY ou NO-GO", () => {
  assert.match(preflight, /begin transaction read only;/i);
  assert.match(preflight, /end as verdict/);
  assert.match(preflight, /then 'READY'/);
  assert.match(preflight, /else 'NO-GO'/);
  assert.match(preflight, /failed_prerequisites/);
  assert.match(preflight, /collisions/);
  assert.match(preflight, /left\(c\.relname, 9\) = 'ai_media_'/);
  assert.match(preflight, /left\(p\.proname, 9\) = 'ai_media_'/);
  assert.match(preflight, /from pg_trigger/);
  assert.match(preflight, /from pg_policy/);
  assert.match(preflight, /from pg_constraint/);
  for (const requiredColumn of [
    "auth_user_id",
    "account_id",
    "client_media_key",
    "media_type",
    "source",
    "upload_protocol",
    "upload_status",
    "is_active",
  ]) {
    assert.match(preflight, new RegExp(requiredColumn));
  }
  for (const rpc of [
    "get_ai_media_generation_quota",
    "reserve_ai_media_generation",
    "complete_ai_media_generation",
    "fail_ai_media_generation",
    "expire_ai_media_generation_reservations",
  ]) {
    assert.match(preflight, new RegExp(rpc));
  }
  assert.doesNotMatch(
    preflight,
    /^\s*(?:insert|update|delete|truncate|drop|alter|create|revoke|grant)\b/im,
  );
});

test("le postflight read-only audite integralement le schema installe", () => {
  assert.match(postflight, /begin transaction read only;/i);
  assert.match(postflight, /then 'PASS' else 'FAIL' end as verdict/);
  assert.match(postflight, /checked_objects=37/);
  assert.match(postflight, /failed_count/);
  assert.match(postflight, /failed_checks/);
  assert.match(postflight, /commit;/i);
  assert.doesNotMatch(
    postflight,
    /^\s*(?:insert|update|delete|truncate|drop|alter|create|revoke|grant)\b/im,
  );

  for (const table of [
    "public.ai_media_plan_limits",
    "public.ai_media_monthly_usage",
    "public.ai_media_generation_jobs",
  ]) {
    assert.ok(postflight.includes(table));
  }
  assert.match(postflight, /c\.relrowsecurity/);
  assert.match(postflight, /exactement 3 tables ai_media_/);

  for (const exactPlan of [
    /edition = 'standard'[\s\S]*?image_monthly_limit = 40[\s\S]*?video_monthly_limit = 3[\s\S]*?studio_enabled = false/,
    /edition = 'premium'[\s\S]*?image_monthly_limit = 100[\s\S]*?video_monthly_limit = 9[\s\S]*?studio_enabled = true/,
    /edition = 'founder'[\s\S]*?image_monthly_limit = 150[\s\S]*?video_monthly_limit = 12[\s\S]*?studio_enabled = true/,
  ]) {
    assert.match(postflight, exactPlan);
  }

  for (const signature of [
    "public.ai_media_assert_account_actor(uuid,uuid)",
    "public.ai_media_expire_account_reservations(uuid,integer)",
    "public.get_ai_media_generation_quota(uuid,uuid,text)",
    "public.reserve_ai_media_generation(uuid,uuid,text,text,text,text,text,integer,integer,jsonb)",
    "public.complete_ai_media_generation(uuid,uuid,uuid,jsonb)",
    "public.fail_ai_media_generation(uuid,uuid,text,text,jsonb)",
    "public.expire_ai_media_generation_reservations(integer)",
  ]) {
    assert.ok(postflight.includes(signature), `Signature postflight absente: ${signature}`);
  }
  assert.match(postflight, /exactement 7 fonctions media IA attendues/);

  for (const trigger of [
    "ai_media_plan_limits_touch_updated_at",
    "ai_media_monthly_usage_touch_updated_at",
    "ai_media_generation_jobs_touch_updated_at",
  ]) {
    assert.ok(postflight.includes(trigger));
  }
  assert.match(postflight, /exactement 3 triggers ai_media_/);

  for (const policy of [
    "ai_media_plan_limits_authenticated_read",
    "ai_media_monthly_usage_account_read",
    "ai_media_generation_jobs_account_read",
  ]) {
    assert.ok(postflight.includes(policy));
  }
  assert.match(postflight, /exactement 3 policies ai_media_/);
  assert.match(postflight, /p\.polroles = array\[roles\.authenticated_oid\]::oid\[\]/);
  assert.match(postflight, /inrcy_can_access_account/);

  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert.match(
      postflight,
      new RegExp(`has_table_privilege\\([^)]*'${privilege}'\\)`),
    );
  }
  assert.match(postflight, /roles\.service_role_oid/);
  assert.match(postflight, /has_function_privilege/);
  assert.match(postflight, /aclexplode/);
  assert.match(postflight, /acl\.grantee = 0/);
});

test("le ledger et les compteurs sont strictement indexes par account_id", () => {
  const usageTable = migration.match(
    /create table public\.ai_media_monthly_usage \(([\s\S]*?)\n\);/,
  )?.[1];
  const jobsTable = migration.match(
    /create table public\.ai_media_generation_jobs \(([\s\S]*?)\n\);/,
  )?.[1];

  assert.ok(usageTable);
  assert.ok(jobsTable);
  assert.match(usageTable, /account_id uuid not null references public\.inrcy_accounts\(id\)/);
  assert.match(usageTable, /primary key \(account_id, period_start, media_kind\)/);
  assert.doesNotMatch(usageTable, /auth_user_id/);
  assert.match(jobsTable, /unique \(account_id, request_key\)/);
  assert.match(jobsTable, /quota_period_start date not null/);
  assert.doesNotMatch(migration, /unique \(actor_auth_user_id, request_key\)/);
});

test("les limites SQL correspondent au contrat Standard Premium Founder", () => {
  assert.match(migration, /\('standard', 40, 3, false\)/);
  assert.match(migration, /\('premium', 100, 9, true\)/);
  assert.match(migration, /\('founder', 150, 12, true\)/);

  const reserve = sqlFunction("reserve_ai_media_generation");
  assert.match(reserve, /v_surface = 'studio' and not v_plan\.studio_enabled/);
  assert.match(reserve, /outcome := 'premium_required'/);
});

test("le patch ouvre le studio aux installations existantes sans operation destructive", () => {
  assert.match(studioAllPlans, /begin;/i);
  assert.match(studioAllPlans, /update public\.ai_media_plan_limits/i);
  assert.match(studioAllPlans, /studio_enabled = true/i);
  assert.match(studioAllPlans, /where edition in \('standard', 'premium', 'founder'\)/i);
  assert.match(studioAllPlans, /commit;/i);
  assert.doesNotMatch(
    studioAllPlans,
    /^\s*(?:drop|delete|truncate|create|alter|grant|revoke)\b/im,
  );

  assert.match(studioAllPlansPostflight, /begin transaction read only;/i);
  assert.match(studioAllPlansPostflight, /then 'PASS' else 'FAIL' end as verdict/i);
  assert.match(studioAllPlansPostflight, /standard_40_3_studio/);
  assert.match(studioAllPlansPostflight, /premium_100_9_studio/);
  assert.match(studioAllPlansPostflight, /founder_150_12_studio/);
  assert.match(studioAllPlansPostflight, /commit;/i);
  assert.doesNotMatch(
    studioAllPlansPostflight,
    /^\s*(?:insert|update|delete|truncate|drop|alter|create|grant|revoke)\b/im,
  );
});

test("le patch de plafonds est additif, idempotent et conserve Founder", () => {
  assert.match(quotaLimitsPatch, /begin;/i);
  assert.match(quotaLimitsPatch, /update public\.ai_media_plan_limits/i);
  assert.match(quotaLimitsPatch, /edition = 'standard'[\s\S]*?image_monthly_limit = 20[\s\S]*?video_monthly_limit = 5/i);
  assert.match(quotaLimitsPatch, /edition = 'premium'[\s\S]*?image_monthly_limit = 30[\s\S]*?video_monthly_limit = 10/i);
  assert.match(quotaLimitsPatch, /edition = 'founder'[\s\S]*?image_monthly_limit = 150[\s\S]*?video_monthly_limit = 12/i);
  assert.match(quotaLimitsPatch, /is distinct from \(20, 5\)/i);
  assert.match(quotaLimitsPatch, /is distinct from \(30, 10\)/i);
  assert.match(quotaLimitsPatch, /commit;/i);
  assert.doesNotMatch(
    quotaLimitsPatch,
    /^\s*(?:drop|delete|truncate|create|alter|grant|revoke)\b/im,
  );

  assert.match(quotaLimitsPostflight, /begin transaction read only;/i);
  assert.match(quotaLimitsPostflight, /standard_20_images_5_videos/);
  assert.match(quotaLimitsPostflight, /premium_30_images_10_videos/);
  assert.match(quotaLimitsPostflight, /founder_150_images_12_videos_inchange/);
  assert.match(quotaLimitsPostflight, /then 'PASS' else 'FAIL' end as verdict/i);
  assert.match(quotaLimitsPostflight, /commit;/i);
  assert.doesNotMatch(
    quotaLimitsPostflight,
    /^\s*(?:insert|update|delete|truncate|drop|alter|create|grant|revoke)\b/im,
  );
});

test("le patch final aligne les trois forfaits avec le code sans suppression", () => {
  assert.match(founderLimitsPatch, /begin;/i);
  assert.match(founderLimitsPatch, /update public\.ai_media_plan_limits/i);
  assert.match(founderLimitsPatch, /where edition in \('standard', 'premium', 'founder'\)/i);
  assert.match(founderLimitsPatch, /when 'standard' then 20/i);
  assert.match(founderLimitsPatch, /when 'premium' then 30/i);
  assert.match(founderLimitsPatch, /when 'founder' then 30/i);
  assert.match(founderLimitsPatch, /when 'standard' then 5/i);
  assert.match(founderLimitsPatch, /when 'premium' then 10/i);
  assert.match(founderLimitsPatch, /when 'founder' then 10/i);
  assert.match(founderLimitsPatch, /AI_MEDIA_FINAL_QUOTAS_VERIFICATION_FAILED/);
  assert.match(founderLimitsPatch, /commit;/i);
  assert.doesNotMatch(
    founderLimitsPatch,
    /^\s*(?:drop|delete|truncate|create|alter|grant|revoke)\b/im,
  );

  assert.match(founderLimitsPostflight, /begin transaction read only;/i);
  assert.match(founderLimitsPostflight, /standard_20_images_5_videos/);
  assert.match(founderLimitsPostflight, /premium_30_images_10_videos/);
  assert.match(founderLimitsPostflight, /founder_30_images_10_videos/);
  assert.match(founderLimitsPostflight, /then 'PASS' else 'FAIL' end as verdict/i);
  assert.match(founderLimitsPostflight, /commit;/i);
  assert.doesNotMatch(
    founderLimitsPostflight,
    /^\s*(?:insert|update|delete|truncate|drop|alter|create|grant|revoke)\b/im,
  );
});

test("la reservation est atomique et idempotente sous concurrence", () => {
  const reserve = sqlFunction("reserve_ai_media_generation");
  assert.match(reserve, /pg_advisory_xact_lock\(hashtext\(p_account_id::text\), hashtext\(v_request_key\)\)/);
  assert.match(reserve, /where j\.account_id = p_account_id\s+and j\.request_key = v_request_key\s+for update/);
  assert.match(reserve, /AI_MEDIA_IDEMPOTENCY_CONFLICT/);
  assert.match(reserve, /v_used \+ v_reserved >= v_limit/);
  assert.match(reserve, /set reserved_count = u\.reserved_count \+ 1/);
  assert.match(reserve, /outcome := 'replayed'/);
  assert.match(reserve, /perform public\.ai_media_assert_account_actor\(p_account_id, p_actor_auth_user_id\)/);
});

test("la consommation n'arrive qu'apres sauvegarde dans la mediatheque du meme compte", () => {
  const complete = sqlFunction("complete_ai_media_generation");
  assert.match(complete, /from public\.pro_media_library m/);
  assert.match(complete, /m\.user_id = p_account_id/);
  assert.match(complete, /m\.media_type = v_job\.media_kind/);
  assert.match(complete, /m\.upload_status = 'uploaded'/);
  assert.match(complete, /set used_count = u\.used_count \+ 1,\s+reserved_count = u\.reserved_count - 1/);
  assert.match(complete, /if v_job\.status = 'completed'/);
  assert.match(complete, /AI_MEDIA_COMPLETION_CONFLICT/);
  assert.match(complete, /p_media_id is null/);
  assert.match(complete, /AI_MEDIA_INVALID_COMPLETION/);
  assert.match(complete, /output_media_id = p_media_id/);
  assert.match(complete, /v_job\.output_media_id is distinct from p_media_id/);
});

test("la suppression physique d'un media conserve un job completed auditable", () => {
  const jobsTable = migration.match(
    /create table public\.ai_media_generation_jobs \(([\s\S]*?)\n\);/,
  )?.[1];
  assert.ok(jobsTable);
  assert.match(
    jobsTable,
    /output_media_id uuid references public\.pro_media_library\(id\) on delete set null/,
  );
  assert.match(jobsTable, /status = 'completed' and completed_at is not null/);
  assert.doesNotMatch(
    jobsTable,
    /status = 'completed' and output_media_id is not null/,
  );
});

test("un echec et une expiration sans media liberent une seule reservation", () => {
  const fail = sqlFunction("fail_ai_media_generation");
  const expireAccount = sqlFunction("ai_media_expire_account_reservations");
  const expireGlobal = sqlFunction("expire_ai_media_generation_reservations");

  assert.match(fail, /if v_job\.status in \('reserved', 'processing'\)/);
  assert.match(fail, /set reserved_count = u\.reserved_count - 1/);
  assert.doesNotMatch(fail, /used_count = u\.used_count \+ 1/);
  assert.match(expireAccount, /for update skip locked/);
  assert.match(expireAccount, /set reserved_count = u\.reserved_count - 1/);
  assert.match(expireAccount, /set status = 'expired'/);
  assert.match(expireGlobal, /for update skip locked/);

  const getQuota = sqlFunction("get_ai_media_generation_quota");
  const reserve = sqlFunction("reserve_ai_media_generation");
  assert.match(getQuota, /perform public\.ai_media_expire_account_reservations\(p_account_id, 1000\)/);
  assert.match(reserve, /perform public\.ai_media_expire_account_reservations\(p_account_id, 1000\)/);
});

test("une expiration recupere le media deja persiste au lieu de rendre son credit", () => {
  for (const rpc of [
    "ai_media_expire_account_reservations",
    "expire_ai_media_generation_reservations",
  ]) {
    const expire = sqlFunction(rpc);
    assert.match(expire, /from public\.pro_media_library m/);
    assert.match(expire, /m\.user_id = v_job\.account_id/);
    assert.match(expire, /m\.client_media_key = 'ai-media:' \|\| v_job\.id::text/);
    assert.match(expire, /m\.media_type = v_job\.media_kind/);
    assert.match(expire, /m\.source = 'ai_media_generation'/);
    assert.match(expire, /m\.upload_protocol = 'server_legacy'/);
    assert.match(expire, /m\.upload_status = 'uploaded'/);
    assert.match(expire, /m\.is_active is true/);
    assert.match(expire, /set used_count = u\.used_count \+ 1,\s+reserved_count = u\.reserved_count - 1/);
    assert.match(expire, /set status = 'completed',\s+output_media_id = v_media_id/);
    assert.match(expire, /quota_recovered_from_library/);
  }
});

test("RLS autorise la lecture du compte mais toutes les mutations passent par service_role", () => {
  assert.match(migration, /alter table public\.ai_media_monthly_usage enable row level security/);
  assert.match(migration, /alter table public\.ai_media_generation_jobs enable row level security/);
  assert.match(migration, /using \(public\.inrcy_can_access_account\(account_id\)\)/);
  assert.match(migration, /revoke all on public\.ai_media_monthly_usage from anon, authenticated/);
  assert.match(migration, /revoke all on public\.ai_media_generation_jobs from anon, authenticated/);

  for (const rpc of [
    "get_ai_media_generation_quota",
    "reserve_ai_media_generation",
    "complete_ai_media_generation",
    "fail_ai_media_generation",
    "expire_ai_media_generation_reservations",
  ]) {
    const body = sqlFunction(rpc);
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = public, pg_temp/);
  }

  assert.doesNotMatch(migration, /grant execute on function public\.reserve_ai_media_generation[\s\S]*?to authenticated/);
  assert.match(migration, /grant execute on function public\.reserve_ai_media_generation[\s\S]*?to service_role/);
});

test("le helper serveur transmet toujours accountId et actorAuthUserId aux RPC de lecture/reservation", () => {
  assert.match(helper, /import "server-only"/);
  assert.match(helper, /"get_ai_media_generation_quota", \{\s+p_account_id: accountId,\s+p_actor_auth_user_id: actorAuthUserId/);
  assert.match(helper, /"reserve_ai_media_generation", \{\s+p_account_id: accountId,\s+p_actor_auth_user_id: actorAuthUserId/);
  assert.match(helper, /"complete_ai_media_generation", \{\s+p_account_id: assertUuid\(params\.accountId/);
  assert.match(helper, /"fail_ai_media_generation", \{\s+p_account_id: assertUuid\(params\.accountId/);
  assert.match(helper, /export const commitAiMediaGeneration = completeAiMediaGeneration/);
  assert.match(helper, /export const releaseAiMediaGeneration = failAiMediaGeneration/);
});

test("les plafonds sont calendaires UTC et non une fenetre glissante globale", () => {
  assert.match(migration, /date_trunc\('month', timezone\('UTC', now\(\)\)\)::date/);
  assert.match(migration, /primary key \(account_id, period_start, media_kind\)/);
  assert.doesNotMatch(migration, /interval '30 days'/i);
});
