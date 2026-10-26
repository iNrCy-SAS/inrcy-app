import assert from "node:assert/strict";
import test from "node:test";
import { parseInrAssistantActivity, withInrAssistantToolActivities, type InrAssistantActivity } from "../../lib/inrAssistantActivity.ts";

const publicActivity: InrAssistantActivity = { id: "trace-1_activity_1", agent: "publications", label: "Publication mise en file", status: "completed" };
const wrap = (name: string, execute: (input?: unknown, context?: unknown) => unknown, rows: InrAssistantActivity[]) => withInrAssistantToolActivities(
  { [name]: { strict: true, description: "Existing description", inputSchema: { type: "object" }, execute } },
  { requestId: "server-trace", onActivity: value => { rows.push(value); } },
)[name].execute;

test("the shared activity parser bounds public fields and never copies private extras", () => {
  assert.deepEqual(parseInrAssistantActivity({ ...publicActivity, accountId: "PRIVATE", args: { prompt: "PRIVATE" }, error: "PRIVATE" }), publicActivity);
  for (const invalid of [null, [], {}, { ...publicActivity, id: "" }, { ...publicActivity, id: "x".repeat(101) },
    { ...publicActivity, id: "https://private.test/account" }, { ...publicActivity, agent: "admin" }, { ...publicActivity, status: "queued" },
    { ...publicActivity, label: " " }, { ...publicActivity, label: "x".repeat(161) }, { ...publicActivity, label: "Line\nOther" }]) {
    assert.equal(parseInrAssistantActivity(invalid), null);
  }
  assert.equal(parseInrAssistantActivity({ ...publicActivity, id: "x".repeat(100), label: "x".repeat(160) })?.id.length, 100);
});

test("real execution emits running before completion while preserving schema, arguments and original result", async () => {
  const rows: InrAssistantActivity[] = [];
  let resolve!: (value: unknown) => void;
  const result = { ok: true, status: "queued", accountId: "PRIVATE_ACCOUNT", message: "PRIVATE_MESSAGE", url: "https://private.test", args: "PRIVATE_ARGUMENTS" };
  const input = { mode: "publish", private: "PRIVATE_ARGUMENTS" };
  const context = { toolCallId: "PRIVATE_TOOL_CALL_ID" };
  const schema = { type: "object", additionalProperties: false };
  const original = { executePublication: { description: "Keep exact schema", strict: true, inputSchema: schema,
    execute: async (received: unknown, options: unknown) => {
      assert.equal(received, input); assert.equal(options, context);
      return new Promise<unknown>(done => { resolve = done; });
    } } };
  const tools = withInrAssistantToolActivities(original, { requestId: "server-trace", onActivity: value => { rows.push(value); } });
  assert.equal(tools.executePublication.inputSchema, schema);
  assert.equal(tools.executePublication.description, original.executePublication.description);
  assert.equal(tools.executePublication.strict, true);
  const pending = tools.executePublication.execute(input, context);
  assert.deepEqual(rows, [{ id: "server-trace_activity_1", agent: "publications", label: "Transmission de la publication", status: "running" }]);
  resolve(result);
  assert.equal(await pending, result);
  assert.deepEqual(rows[1], { id: rows[0].id, agent: "publications", label: "Publication mise en file", status: "completed" });
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|https:|toolCallId|accountId/);
});

test("publication progress distinguishes persisted drafts, queues, schedules and actual published status", async () => {
  for (const [status, label] of Object.entries({ draft: "Brouillon de publication enregistré", queued: "Publication mise en file", scheduled: "Publication programmée", published: "Publication confirmée", processing: "État vérifié : publication en cours", updated: "Correction de la publication enregistrée", unchanged: "Publication déjà à jour" })) {
    const rows: InrAssistantActivity[] = [];
    const execute = wrap("executePublication", async () => ({ ok: true, status }), rows);
    await execute({ mode: "schedule" });
    assert.equal(rows[0].label, "Programmation de la publication");
    assert.equal(rows[1].label, label); assert.equal(rows[1].status, "completed");
  }
});

test("blocked, partial, missing or uncertain results never announce successful collaboration", async () => {
  for (const result of [
    { ok: false, status: "needs_instruction" }, { ok: false, status: "blocked" }, { ok: true, status: "unknown" },
    { ok: true, status: "partial" }, { ok: false, status: "save_unconfirmed" }, { ok: false, status: "not_included" },
    { ok: false, status: "confirmation_required" }, { ok: true, status: "invented_state" }, {}, undefined,
  ]) {
    const rows: InrAssistantActivity[] = [];
    await wrap("editPublication", async () => result, rows)();
    assert.equal(rows.length, 2); assert.equal(rows[1].status, "blocked");
  }
  const rows: InrAssistantActivity[] = [];
  await wrap("readWorkspaceSection", async () => ({ known: false, access: "allowed" }), rows)({ section: "stats" });
  assert.equal(rows[1].status, "blocked");
  for (const name of ["configureAgentAutomation", "prepareCampaignEmail"]) {
    const events: InrAssistantActivity[] = [];
    await wrap(name, async () => ({ ok: true, status: "unexpected_new_state" }), events)({ agent: "publish" });
    assert.equal(events[1].status, "blocked");
  }
});

test("actual failures and thrown exceptions stay failures without leaking error text", async () => {
  for (const result of [{ ok: false, status: "failed" }, { ok: false, status: "unavailable" }, { available: false }]) {
    const rows: InrAssistantActivity[] = [];
    await wrap("getPublicationStatus", async () => result, rows)();
    assert.equal(rows[1].status, "failed");
  }
  const rows: InrAssistantActivity[] = [];
  const originalError = new Error("PRIVATE_URL_AND_TOKEN");
  await assert.rejects(Promise.resolve(wrap("preparePublication", async () => { throw originalError; }, rows)()), (error: unknown) => error === originalError);
  assert.equal(rows[1].status, "failed");
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_URL_AND_TOKEN/);
});

test("Stats activity requires a real statistics tool invocation and respects its data availability", async () => {
  const rows: InrAssistantActivity[] = [];
  await wrap("readStatsSnapshots", async () => ({ ok: true, snapshots: [], liveVerified: false }), rows)();
  await wrap("readWorkspaceSection", async () => ({ known: true, access: "allowed" }), rows)({ section: "stats" });
  assert.deepEqual(rows.map(row => [row.agent, row.status]), [["stats", "running"], ["stats", "completed"], ["stats", "running"], ["stats", "completed"]]);
  assert.ok(rows.every(row => !/direct|nouveaux|zero|zéro/.test(row.label)));
  rows.length = 0;
  await wrap("readWorkspaceSection", async () => ({ known: true }), rows)({ section: "subscription", prompt: "statistiques" });
  await wrap("otherTool", async () => ({ ok: true }), rows)({ agent: "stats" });
  assert.deepEqual(rows, []);
});

test("email progress describes a draft and never claims delivery or scheduling", async () => {
  const rows: InrAssistantActivity[] = [];
  await wrap("prepareCampaignEmail", async () => ({ ok: true, status: "draft", bodyText: "PRIVATE_BODY" }), rows)();
  assert.equal(rows[0].agent, "emailing"); assert.equal(rows[1].label, "Brouillon de campagne mail enregistré");
  assert.doesNotMatch(JSON.stringify(rows), /envoy|programmé|PRIVATE_BODY/);
});

test("agent settings select the expert using only the closed, actual agent input", async () => {
  for (const [agent, expected] of [["publish", "publications"], ["stats", "stats"], ["grow", "emailing"], ["loyalty", "emailing"]]) {
    const rows: InrAssistantActivity[] = [];
    await wrap("configureAgentAutomation", async () => ({ ok: true, status: "saved" }), rows)({ agent });
    assert.deepEqual(rows.map(row => row.agent), [expected, expected]);
  }
  const rows: InrAssistantActivity[] = [];
  await wrap("configureAgentAutomation", async () => ({ ok: true, status: "saved" }), rows)({ agent: "admin", prompt: "stats" });
  assert.deepEqual(rows, []);
});

test("a guide credits only a real, found and allowlisted topic rather than the supplied prompt", async () => {
  for (const [id, agent] of [["booster", "publications"], ["stats", "stats"], ["emailing", "emailing"]]) {
    const rows: InrAssistantActivity[] = [];
    await wrap("readAppGuide", async () => ({ found: true, guides: [{ id, content: "PRIVATE_GUIDE_CONTENT" }] }), rows)({ topic: "arbitrary" });
    assert.deepEqual(rows.map(row => [row.agent, row.status]), [[agent, "completed"]]);
    assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_GUIDE_CONTENT/);
  }
  const rows: InrAssistantActivity[] = [];
  await wrap("readAppGuide", async () => ({ found: false, guides: [{ id: "stats" }] }), rows)({ topic: "stats" });
  await wrap("readAppGuide", async () => ({ found: true, guides: [{ id: "crm" }] }), rows)({ topic: "stats" });
  assert.deepEqual(rows, []);
});

test("stream callback failures or an absent stream never affect a successful business write", async () => {
  const result = { ok: true, status: "draft" };
  let calls = 0;
  const original = { preparePublication: { execute: async () => { calls++; return result; } } };
  assert.equal(withInrAssistantToolActivities(original, { requestId: "trace" }), original);
  for (const callback of [() => { throw new Error("Closed stream"); }, async () => { throw new Error("Disconnected client"); }]) {
    const tools = withInrAssistantToolActivities(original, { requestId: "trace", onActivity: callback });
    assert.equal(await tools.preparePublication.execute(), result);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
});

test("concurrent tools and repeated fallback calls have distinct bounded IDs with paired terminal events", async () => {
  const rows: InrAssistantActivity[] = [];
  let calls = 0;
  const tools = withInrAssistantToolActivities({
    preparePublication: { execute: async () => { calls++; return { ok: true, status: "draft" }; } },
    readStatsSnapshots: { execute: async () => { calls++; return { ok: true, snapshots: [] }; } },
  }, { requestId: "s".repeat(120), onActivity: row => { rows.push(row); } });
  await Promise.all([tools.preparePublication.execute(), tools.readStatsSnapshots.execute()]);
  await tools.preparePublication.execute();
  assert.equal(calls, 3);
  const ids = [...new Set(rows.map(row => row.id))];
  assert.equal(ids.length, 3);
  assert.ok(rows.every(row => parseInrAssistantActivity(row) !== null));
  for (const id of ids) assert.deepEqual(rows.filter(row => row.id === id).map(row => row.status), ["running", "completed"]);
});
