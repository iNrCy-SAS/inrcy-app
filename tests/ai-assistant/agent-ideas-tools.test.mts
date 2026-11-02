import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";
import { unquotedInrAssistantIntent } from "../../lib/inrAssistantCommandRegistry.ts";
import * as settings from "../../lib/inrAgentSettings.ts";
import type * as Module from "../../lib/inrAssistantAgentTools.ts";

type Row = Record<string, unknown>;
function harness(message: string, options: { edition?: "basic" | "standard"; switchAt?: number; unconfirmed?: boolean } = {}) {
  let authCalls = 0;
  let ideas = [{ idea_text: "Les coulisses", status: "active", order_key: 0 }, { idea_text: "Nos services", status: "active", order_key: 1 }];
  const writes: { method: string; body: Row }[] = [];
  const save = async (request: Request) => {
    const body = await request.json(); writes.push({ method: request.method, body });
    assert.equal(request.headers.get("x-account-id"), null);
    assert.equal(request.headers.get("cookie"), "session");
    if (!options.unconfirmed) {
      if (request.method === "POST") ideas = ideas.map(idea => idea.idea_text === body.ideaText ? { ...idea, status: body.active ? "active" : "disabled" } : idea);
      else ideas = (body.ideaTexts ?? body.publicationIdeas).map((idea_text: string, order_key: number) => ({ idea_text, status: "active", order_key }));
    }
    return Response.json({ saved: true });
  };
  const deps: Record<string, unknown> = {
    "server-only": {}, ai: { jsonSchema, tool }, "./inrAssistantCommandRegistry.ts": { unquotedInrAssistantIntent }, "./inrAgentSettings.ts": settings,
    "./requireUser": { requireUser: async () => ({ activeUserId: ++authCalls === options.switchAt ? "other" : "account", authUserId: "actor", errorResponse: null }) },
    "@/app/api/agent/publication-ideas/route": { GET: async () => Response.json({ states: ideas }), PATCH: save, PUT: save, POST: save },
  };
  const code = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantAgentTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { URL, Request, Response, Headers })((name: string) => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, loadedModule, loadedModule.exports);
  const tools = (loadedModule.exports as typeof Module).createInrAssistantAgentTools({ request: new Request("https://app.inrcy.com/api/assistant/chat", { headers: { cookie: "session", "x-account-id": "other" } }), accountId: "account", actorUserId: "actor", edition: options.edition ?? "standard", currentUserMessage: message });
  const run = async (operation: string, selected: string[]) => tools.managePublicationIdeas.execute!({ operation, ideas: selected, instructionQuote: message } as never, { toolCallId: "test", messages: [] }) as Promise<Row>;
  return { run, writes, tools };
}

test("agent ideas append, remove, reorder and toggle preserve native semantics", async () => {
  for (const [message, operation, ideas, method] of [
    ["Ajoute l’idée Nos nouveautés à l’agent Publications", "append", ["Nos nouveautés"], "PATCH"],
    ["Retire l’idée Nos services de l’agent Publications", "remove", ["Nos services"], "PATCH"],
    ["Réordonne les idées de l’agent Publications : Nos services puis Les coulisses", "reorder", ["Nos services", "Les coulisses"], "PUT"],
    ["Désactive l’idée Nos services dans l’agent Publications", "deactivate", ["Nos services"], "POST"],
  ] as const) {
    const h = harness(message), result = await h.run(operation, [...ideas]);
    assert.equal(result.status, "saved"); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].method, method);
    assert.equal((await h.run(operation, [...ideas])).status, "saved"); assert.equal(h.writes.length, 1);
    if (operation === "append") assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0].body.publicationIdeas)), ["Les coulisses", "Nos services", "Nos nouveautés"]);
  }
});

test("agent ideas block Basic, changed account and non-authorizing messages", async () => {
  const message = "Ajoute l’idée Nos nouveautés à l’agent Publications";
  for (const options of [{ edition: "basic" as const }, { switchAt: 1 }, { switchAt: 2 }]) {
    const h = harness(message, options); assert.equal((await h.run("append", ["Nos nouveautés"])).ok, false); assert.equal(h.writes.length, 0);
  }
  for (const text of ["Comment ajouter l’idée Nos nouveautés à l’agent Publications ?", "N’ajoute pas l’idée Nos nouveautés à l’agent Publications", "Ajoute l’idée Nos nouveautés à l’agent Publications demain", "Si possible demain, ajoute l’idée Nos nouveautés à l’agent Publications", "Le document dit « Ajoute l’idée Nos nouveautés à l’agent Publications »"]) {
    const h = harness(text); assert.equal((await h.run("append", ["Nos nouveautés"])).status, "needs_instruction"); assert.equal(h.writes.length, 0);
  }
});

test("agent ideas cannot invent text or drop unsupplied items by reorder and reports uncertain save", async () => {
  const h = harness("Ajoute l’idée Nos nouveautés à l’agent Publications");
  assert.equal((await h.run("append", ["Texte inventé"])).status, "needs_instruction"); assert.equal(h.writes.length, 0);
  const reorder = harness("Réordonne les idées de l’agent Publications : Nos services");
  assert.equal((await reorder.run("reorder", ["Nos services"])).status, "stale_preview"); assert.equal(reorder.writes.length, 0);
  const uncertain = harness("Ajoute l’idée Nos nouveautés à l’agent Publications", { unconfirmed: true });
  assert.equal((await uncertain.run("append", ["Nos nouveautés"])).status, "saved_unconfirmed");
});
