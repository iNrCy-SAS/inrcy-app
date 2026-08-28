import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { repairExpiredNormalizationLeases } from "../../lib/mediaNormalizationRepairQueue.ts";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

test("expired leases are repaired before the regular queue scan", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await repairExpiredNormalizationLeases({
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: { recovered: 2, terminalized: 1, reconciled: 1 },
          error: null,
        };
      },
    },
    jobType: "video_normalize_v1",
    limit: 500,
  });

  assert.deepEqual(result, {
    available: true,
    recovered: 2,
    terminalized: 1,
  });
  assert.deepEqual(calls, [
    {
      name: "inrcy_repair_expired_media_processing_jobs",
      args: { p_job_type: "video_normalize_v1", p_limit: 100 },
    },
  ]);
});

test("deployment remains compatible until the repair RPC migration lands", async () => {
  const result = await repairExpiredNormalizationLeases({
    supabase: {
      rpc: async () => ({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find inrcy_repair_expired_media_processing_jobs",
        },
      }),
    },
    jobType: "video_normalize_v1",
    limit: 10,
  });
  assert.deepEqual(result, {
    available: false,
    recovered: 0,
    terminalized: 0,
  });
});

test("the migration recovers retryable leases and terminalizes exhausted ones", () => {
  const sql = read(
    "ops/sql/2026-08-06_media_processing_lease_recovery.sql",
  );
  assert.match(sql, /attempt_count < j\.max_attempts/);
  assert.match(sql, /status = 'retry_wait'/);
  assert.match(sql, /attempt_count >= j\.max_attempts/);
  assert.match(sql, /status = 'failed'/);
  assert.match(sql, /processing_lease_expired_attempts_exhausted/);
  assert.match(sql, /for update(?: of j)? skip locked/);
  assert.match(sql, /publication_workspaces[\s\S]*status = 'failed'/);
  assert.match(sql, /j\.payload ->> 'pipelineMission'/);
  assert.match(sql, /= 'ai_preparation'/);
  assert.ok(
    (sql.match(/publication_status not in \('ready', 'legacy_ready'\)/g) || [])
      .length >= 2,
  );
});

test("expired leases are swept for both image and video normalization jobs", () => {
  const queue = read("lib/mediaNormalizationRepairQueue.ts");
  assert.match(
    queue,
    /params\.mediaType === "video"[\s\S]*?"video_normalize_v1"[\s\S]*?: "image_normalize_v1"/,
  );
});

test("workspace media processing does not consume parent publication attempts", () => {
  const cron = read("app/api/cron/booster-publications/route.ts");
  assert.match(
    cron,
    /lastPreparationError === "workspace_media_processing"/,
  );
  assert.match(
    cron,
    /waitingForWorkspaceMedia[\s\S]*Math\.max\(2, job\.attempt\)[\s\S]*job\.attempt \+ 1/,
  );
  assert.match(
    cron,
    /buildBoosterPreparationDispatchReference\(\{[\s\S]*?attempt: nextPreparationAttempt/,
  );
});

test("manual and AI workspace videos enqueue preparation as soon as upload finishes", () => {
  const uploadEvent = read("app/api/media-pipeline/upload-event/route.ts");
  assert.match(
    uploadEvent,
    /if \(!workspaceAiSource\)[\s\S]*?enqueueVideoNormalization\(\{[\s\S]*?mission: "publication_preparation"/,
  );
  assert.match(
    uploadEvent,
    /else \{[\s\S]*?mission: "ai_preparation"[\s\S]*?context: "video AI prewarm"/,
  );
  assert.doesNotMatch(uploadEvent, /workspaceAiNeedsSharedCanonical|videoSourceNeedsSharedCanonical/);
  assert.match(
    uploadEvent,
    /function processVideoNormalizationAfterUpload[\s\S]*?after\(async \(\) =>[\s\S]*?processVideoNormalizationJobsForMedia/,
  );
});
