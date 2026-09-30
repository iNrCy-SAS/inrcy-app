import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AI_MEDIA_MONTHLY_LIMITS, AI_MEDIA_ROLLOVER_CAPS } from "../../lib/aiMediaGenerationQuotaPolicy.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20260930151303_ai_media_image_limits_25_50.sql", import.meta.url), "utf8");
const sql = migration.replace(/--[^\n]*/g, "");

test("image recharge migration changes only plan image limits, never an account ledger or video entitlement", () => {
  const mutations = [...sql.matchAll(/\b(update|insert\s+into|delete\s+from|truncate|alter\s+table|drop\s+table)\s+([\w.]+)/gi)];
  assert.deepEqual(mutations.map((match) => [match[1].toLowerCase(), match[2]]), [["update", "public.ai_media_plan_limits"]]);
  const assignment = sql.match(/update public\.ai_media_plan_limits\s+set ([\s\S]+?)\s+where edition/i)?.[1];
  assert.ok(assignment);
  assert.match(assignment, /^image_monthly_limit = case edition/);
  assert.doesNotMatch(assignment, /,/);
  assert.doesNotMatch(sql, /ai_media_(?:monthly_usage|generation_jobs|account_limits)|video_monthly_limit\s*=|rollover_cap\s*=/);
  for (const edition of ["standard", "premium", "founder"] as const) {
    assert.match(assignment, new RegExp(`when '${edition}' then ${AI_MEDIA_MONTHLY_LIMITS[edition].image}\\b`));
    assert.equal(AI_MEDIA_ROLLOVER_CAPS[edition].image, 70);
  }
});

test("image recharge migration fails closed on incomplete or unexpected plans and can be replayed", () => {
  assert.match(sql, /^\s*begin;/i);
  assert.match(sql, /AI_MEDIA_IMAGE_LIMITS_MISSING_TABLE/);
  assert.match(sql, /AI_MEDIA_IMAGE_LIMITS_MISSING_PLANS/);
  assert.match(sql, /edition = 'standard' and image_monthly_limit not in \(20, 25\)/);
  assert.match(sql, /edition in \('premium', 'founder'\) and image_monthly_limit not in \(30, 50\)/);
  assert.match(sql, /image_monthly_limit is distinct from case edition/);
  assert.match(sql, /AI_MEDIA_IMAGE_LIMITS_POSTFLIGHT_FAILED/);
  assert.match(sql, /commit;\s*$/i);
});
