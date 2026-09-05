import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

test("le replay IA est idempotent et strictement limité aux sources du compte", () => {
  const sql = read(
    "ops/sql/2026-09-05_ai_generated_media_normalization_scope_replay.sql",
  );

  assert.match(sql, /^begin;/m);
  assert.match(sql, /m\.user_id = j\.account_id/);
  assert.match(sql, /j\.account_id = media_variants\.account_id/);
  assert.match(sql, /j\.account_id = pro_media_library\.user_id/);
  assert.match(sql, /m\.bucket_name = 'inrcy-pro-media'/);
  assert.match(sql, /m\.source = 'ai_media_generation'/);
  assert.match(
    sql,
    /'users\/' \|\| j\.account_id::text \|\| '\/ai-generated\/image\/%'/,
  );
  assert.match(
    sql,
    /'users\/' \|\| j\.account_id::text \|\| '\/ai-generated\/video\/%'/,
  );
  assert.match(sql, /j\.status = 'failed'/);
  assert.match(sql, /set status = 'retry_wait'/);
  assert.doesNotMatch(sql, /\bdelete\b|\btruncate\b|\bdrop\s+(?:table|column)\b/i);
});

test("le postflight du replay reste strictement en lecture seule", () => {
  const sql = read(
    "ops/sql/2026-09-05_ai_generated_media_normalization_scope_replay_verify.sql",
  );
  assert.match(sql, /remaining_failed_jobs/);
  assert.doesNotMatch(
    sql,
    /^\s*(?:insert|update|delete|truncate|drop|alter|create|grant|revoke)\b/im,
  );
});
