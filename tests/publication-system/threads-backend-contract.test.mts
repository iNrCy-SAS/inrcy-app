import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type RecordLike = Record<string, unknown>;
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const asRecord = (value: unknown): RecordLike => value && typeof value === "object" ? value as RecordLike : {};
function extractFunctions(path: string, names: string[], dependencies: RecordLike) {
  const source = read(path);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const selected = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ""));
  assert.equal(selected.length, names.length);
  const code = selected.map((node) => node.getText(tree)).join("\n") + `\nmodule.exports={${names.join(",")}};`;
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} as RecordLike };
  new Function("module", ...Object.keys(dependencies), compiled)(moduleRecord, ...Object.values(dependencies));
  return moduleRecord.exports;
}

test("Threads iNrSend deletion checks ADMIN and loads the active account canonical credential only", async () => {
  const reads: unknown[][] = [], deleted: RecordLike[] = [];
  const row = { user_id: "active-admin", resource_id: "123", provider: "threads", source: "threads", product: "threads" };
  let enabled = true;
  const functions = extractFunctions("lib/inrsend/publicationChannelActions.ts", ["removeChannelDelivery"], {
    asRecord, supabaseAdmin: {},
    isMetaChannelPilotEnabledForAccount: async (_admin: unknown, userId: string) => enabled && userId === "active-admin",
    getLatestIntegrationRow: async (...args: unknown[]) => { reads.push(args); return row; },
    ensureMetaDirectAccessToken: async (_admin: unknown, integration: unknown) => { assert.equal(integration, row); return "own-token"; },
    threadsDeletePost: async (params: RecordLike) => { deleted.push(params); },
  });
  const remove = functions.removeChannelDelivery as (params: RecordLike) => Promise<unknown>;
  await remove({ userId: "active-admin", publicationId: "parent", channel: "threads", previousExternalId: "200", eventPayload: {} });
  assert.deepEqual(reads[0].slice(0, 4), ["active-admin", "threads", "threads", "threads"]);
  assert.match(String(reads[0][4]), /id,user_id,provider,source,product/);
  assert.match(String(reads[0][4]), /resource_id/);
  assert.deepEqual(deleted, [{ postId: "200", accessToken: "own-token" }]);
  enabled = false;
  await assert.rejects(remove({ userId: "active-admin", channel: "threads", previousExternalId: "201" }), /ADMIN/);
  assert.equal(reads.length, 1); assert.equal(deleted.length, 1);
  enabled = true;
  await assert.rejects(remove({ userId: "active-admin", channel: "threads", eventPayload: { results: { threads: { threads_checkpoint: { state: "publish_unknown" } } } } }), /Vérifiez/);
  assert.equal(reads.length, 1); assert.equal(deleted.length, 1);
});

test("Threads cron respects persisted poll time and carries checkpoint/attempts into the next worker", () => {
  const functions = extractFunctions("app/api/cron/booster-publications/route.ts", ["timestampMs", "asRecord", "isChannelCandidateDue", "readDispatchJob"], {
    PINTEREST_VIDEO_TERMINAL_PHASES: new Set(),
  });
  const parse = functions.readDispatchJob as (row: RecordLike) => RecordLike;
  const due = functions.isChannelCandidateDue as (row: RecordLike, now: number) => boolean;
  const checkpoint = { containerId: "100", state: "processing" };
  const job = parse({ id: "event", user_id: "admin", payload: { channel: "threads", publication_id: "parent", status: "queued", threadsCheckpoint: checkpoint, threadsContinuationAttempt: 7, threadsNextRunAt: "2026-10-12T08:01:00Z", dispatchRequest: { channels: ["threads"] } } });
  assert.equal(job.threadsContinuation, true); assert.equal(job.threadsContinuationAttempt, 7);
  assert.deepEqual(asRecord(job.dispatchRequest)._threadsCheckpoint, checkpoint);
  assert.equal(due({ candidate_channel: "threads", candidate_threads_next_run_at: "2026-10-12T08:01:00Z" }, Date.parse("2026-10-12T08:00:00Z")), false);
  assert.equal(due({ candidate_channel: "threads", candidate_threads_next_run_at: "2026-10-12T08:01:00Z" }, Date.parse("2026-10-12T08:02:00Z")), true);
});

test("Threads route keeps owned historical IDs, rejects published edits before asset preparation and locks failed retries", () => {
  const source = read("lib/inrsend/publicationChannelActions.ts");
  const patch = source.slice(source.indexOf("  async function PATCH("), source.indexOf("  async function DELETE("));
  assert.ok(patch.indexOf("threads_edit_unsupported") < patch.indexOf("const incomingVideo"));
  assert.match(patch, /scope: "inrsend_threads_retry", idempotencyKey: publicationId/);
  assert.match(patch, /isMetaChannelPilotEnabledForActorAndAccount/);
  assert.match(source, /\(channel === "site_web" \|\| channel === "threads"\) \? channelResult.external_id/);
  assert.match(read("app/api/booster/publish-now/route.ts"), /cronUserId\s*\? isMetaChannelPilotEnabledForAccount/);
  assert.match(read("app/api/booster/publish-now/route.ts"), /threads_async_worker_required/);
});
