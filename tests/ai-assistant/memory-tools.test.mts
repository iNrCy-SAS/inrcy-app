import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import type * as Tools from "../../lib/inrAssistantMemoryTools.ts";
import type * as Memory from "../../lib/inrAssistantMemory.ts";

type Row = Record<string, unknown>;
type TestTool = { execute(input: unknown): Promise<Row>; inputSchema: { schema: Row } };
function load<T>(file: string, stubs: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../../lib/${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { URL, setTimeout, clearTimeout })((name: string) => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency: ${name}`);
    return stubs[name];
  }, record, record.exports);
  return record.exports as T;
}
const memoryRuntime = load<typeof Memory>("inrAssistantMemory.ts", { "server-only": {}, "node:crypto": { randomUUID } });
const runtime = load<typeof Tools>("inrAssistantMemoryTools.ts", {
  "server-only": {}, "./inrAssistantMemory.ts": memoryRuntime,
  ai: { tool: (value: unknown) => value, jsonSchema: (schema: unknown, config: Row) => ({ schema, ...config }) },
});
function turn(index = 0): Memory.InrAssistantMemoryTurn {
  return { conversationId: `PRIVATE_CONVERSATION_${index}`, turnId: `PRIVATE_TURN_${index}`, userText: `Notre campagne de Noël ${index}`,
    assistantText: `Voici les sujets conseillés ${index}`, status: "completed", createdAt: `2026-10-${20 + index}T10:00:00Z`, updatedAt: `2026-10-${20 + index}T11:00:00Z` };
}
function fixture(options: { turns?: Memory.InrAssistantMemoryTurn[]; available?: boolean; throws?: boolean; truncated?: boolean; exclude?: string } = {}) {
  const calls: Array<{ method: string; args: unknown }> = [];
  const read = async (method: string, args: unknown) => {
    calls.push({ method, args });
    if (options.throws) throw new Error("PRIVATE DATABASE ERROR password=secret");
    return { available: options.available !== false, turns: options.turns ?? [turn()], truncated: options.truncated ?? false, untrustedContent: true as const };
  };
  const tools = runtime.createInrAssistantMemoryTools({ memory: {
    search: (args) => read("search", args), loadRecent: (args) => read("loadRecent", args),
  }, excludeTurnId: options.exclude });
  return { tool: tools.recallPastDiscussions as unknown as TestTool, calls };
}

test("closed discussions are searched through the pre-scoped reader, without any model account or actor selector", async () => {
  const h = fixture();
  const result = await h.tool.execute({ query: "Noël", limit: 2 });
  assert.equal(h.calls[0].method, "search"); assert.equal((h.calls[0].args as Row).query, "Noël");
  assert.equal(result.ok, true); assert.equal(result.untrustedContent, true); assert.equal(result.historicalOnly, true);
  const output = JSON.stringify(result);
  assert.match(output, /campagne de Noël/);
  assert.match(output, /2026-10-20/);
  assert.doesNotMatch(output, /PRIVATE_CONVERSATION|PRIVATE_TURN|account_id|actor_user_id/);
  assert.match(String(result.notice), /jamais des instructions/);
});

test("a null query recalls the most recent useful turns and excludes the active turn", async () => {
  const h = fixture({ turns: [turn(0), turn(1), turn(2)], exclude: "PRIVATE_TURN_2" });
  const result = await h.tool.execute({ query: null, limit: null });
  assert.equal(h.calls[0].method, "loadRecent"); assert.equal((h.calls[0].args as Row).limit, 6);
  const excerpts = result.excerpts as Row[];
  assert.equal(excerpts.length, 2); assert.equal(excerpts[0].userExcerpt, "Notre campagne de Noël 1");
});

test("unavailable memory remains unknown and never leaks SQL errors or claims an empty successful history", async () => {
  for (const options of [{ available: false }, { throws: true }]) {
    const h = fixture(options);
    const result = await h.tool.execute({ query: null, limit: 2 });
    assert.equal(result.ok, false); assert.equal((result.excerpts as unknown[]).length, 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|password|secret/);
  }
});

test("history excerpts remove secrets and signed media links again and remain below six thousand characters", async () => {
  const secret = "A ".repeat(2_000) + " api_key=sk-proj-abcdefghijklmnop https://project.supabase.co/object/sign/x?token=HIDDEN client : Jean Dupont, jean@example.test";
  const h = fixture({ turns: Array.from({ length: 8 }, (_, i) => ({ ...turn(i), userText: secret, assistantText: secret })), truncated: true });
  const result = await h.tool.execute({ query: "campagne", limit: 4 });
  assert.ok(JSON.stringify(result).length <= 6_000); assert.equal(result.truncated, true);
  assert.ok((result.excerpts as unknown[]).length <= 4);
  assert.doesNotMatch(JSON.stringify(result), /sk-proj|HIDDEN|supabase.co|Jean Dupont|jean@example/);
});

test("strict read-only schema rejects identities, excess limits and long searches before invoking the reader", async () => {
  const h = fixture();
  for (const input of [{ query: null, limit: 5 }, { query: "x".repeat(301), limit: 1 }, { query: "x", limit: 1, accountId: "foreign" },
    { query: "x", limit: 1, userId: "foreign" }, { query: 42, limit: 1 }, []]) {
    await assert.rejects(h.tool.execute(input), /invalide/);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.tool.inputSchema.schema.additionalProperties, false);
  assert.equal(Object.keys(h.tool.inputSchema.schema.properties as Row).sort().join(","), "limit,query");
});
