import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Memory from "../../lib/inrAssistantMemory.ts";
import type * as Route from "../../app/api/assistant/history/route.ts";

const { NextResponse } = createRequire(import.meta.url)("next/server") as typeof import("next/server");
const ACCOUNT = "10000000-0000-4000-8000-000000000001", OTHER_ACCOUNT = "10000000-0000-4000-8000-000000000002";
const ACTOR = "20000000-0000-4000-8000-000000000001", OTHER_ACTOR = "20000000-0000-4000-8000-000000000002";
const CONVERSATION = "30000000-0000-4000-8000-000000000001", OLDER = "30000000-0000-4000-8000-000000000002";
const TURN = "40000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;
type Query = { table: string; select: string; filters: Array<[string, unknown]>; minimums: Array<[string, string]>; limit?: number };

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, {
    Date, URL, setTimeout, clearTimeout, fetch() { assert.fail("History cannot call a provider or external URL"); },
  })((id: string) => { assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`); return dependencies[id]; }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports as T;
}

function stored(extra: Row = {}): Row {
  return { account_id: ACCOUNT, actor_user_id: ACTOR, conversation_id: CONVERSATION, turn_id: TURN,
    user_text: "Préparer les publications", assistant_text: "Voici trois idées.", status: "completed",
    created_at: "2026-10-26T11:00:00Z", updated_at: "2026-10-26T11:01:00Z",
    lease_id: "PRIVATE LEASE", token: "PRIVATE TOKEN", ...extra };
}

function harness(options: { rows?: Row[]; unavailable?: "list" | "turns"; authStatus?: 401 | 503; invalidServerActor?: boolean } = {}) {
  const rows = options.rows ?? [stored()];
  const queries: Query[] = [], rpcs: { name: string; args: Row }[] = [];
  const factoryScopes: Array<{ accountId: string; actorUserId: string; supabase: unknown }> = [];
  const diagnosticScopes: Array<{ route: string; requestId: string }> = [];
  const diagnosticErrors: Array<{ status: number; code: string }> = [];
  const supabase = {
    from(table: string) {
      const query: Query = { table, select: "", filters: [], minimums: [] }; queries.push(query);
      const builder = {
        select(fields: string) { query.select = fields; return builder; },
        eq(key: string, value: unknown) { query.filters.push([key, value]); return builder; },
        gte(key: string, value: string) { query.minimums.push([key, value]); return builder; },
        order() { return builder; }, limit(value: number) { query.limit = value; return builder; },
        insert() { assert.fail("History attempted an insert"); }, update() { assert.fail("History attempted an update"); }, delete() { assert.fail("History attempted a delete"); },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const matches = rows.filter(row => query.filters.every(([key, value]) => row[key] === value)
            && query.minimums.every(([key, minimum]) => Date.parse(String(row[key])) >= Date.parse(minimum)))
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.turn_id).localeCompare(String(a.turn_id)));
          const response = options.unavailable === "turns" ? { data: null, error: { code: "PRIVATE SQL", message: "PRIVATE DATABASE STACK" } }
            : { data: matches.slice(0, query.limit), error: null };
          return Promise.resolve(response).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name: string, args: Row) {
      rpcs.push({ name, args });
      if (options.unavailable === "list") return { data: null, error: { code: "PGRST202", message: "PRIVATE DATABASE STACK" } };
      const groups = new Map<string, Row[]>();
      for (const row of rows.filter(row => row.account_id === args.p_account_id && row.actor_user_id === ACTOR)) {
        const id = String(row.conversation_id); groups.set(id, [...(groups.get(id) ?? []), row]);
      }
      const data = [...groups.values()].map(group => {
        group.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        return { conversation_id: group[0].conversation_id, title: group[0].user_text, updated_at: group.map(row => String(row.updated_at)).sort().at(-1) };
      }).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, Number(args.p_limit));
      return { data, error: null };
    },
  };
  const memory = load<typeof Memory>("../../lib/inrAssistantMemory.ts", { "server-only": {}, "node:crypto": { randomUUID } });
  const authResponse = options.authStatus ? NextResponse.json({ error: "Session indisponible.", code: "auth_required" }, { status: options.authStatus, headers: { "Cache-Control": "public" } }) : null;
  const route = load<typeof Route>("../../app/api/assistant/history/route.ts", {
    "node:crypto": { randomUUID }, "next/server": { NextResponse },
    "@/lib/requireUser": { requireUser: async () => ({ authUserId: options.invalidServerActor ? "" : ACTOR,
      user: { id: ACTOR }, activeUserId: ACCOUNT, supabase, errorResponse: authResponse }) },
    "@/lib/inrAssistantMemory": { ...memory, createInrAssistantMemory(args: Parameters<typeof memory.createInrAssistantMemory>[0]) {
      factoryScopes.push(args); return memory.createInrAssistantMemory(args);
    } },
    "@/lib/observability/accountDiagnostics": {
      runWithAccountDiagnosticContext: (scope: { route: string; requestId: string }, action: () => Promise<Response>) => { diagnosticScopes.push(scope); return action(); },
      recordCurrentAccountDiagnosticError: async (status: number, code: string) => { diagnosticErrors.push({ status, code }); },
    },
  });
  return { get: (query = "") => route.GET(new Request(`https://app.inrcy.com/api/assistant/history${query ? `?${query}` : ""}`, { headers: { "X-Request-Id": "untrusted-browser-trace" } })),
    queries, rpcs, factoryScopes, diagnosticScopes, diagnosticErrors, supabase };
}

async function bodyOf(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  const reference = response.headers.get("x-request-id");
  assert.match(reference ?? "", /^[0-9a-f-]{36}$/);
  assert.notEqual(reference, "untrusted-browser-trace");
  const body = await response.json();
  assert.equal(body.requestId, reference);
  return body;
}

test("history reads real helpers under the server actor and account despite query privilege fields", async () => {
  const h = harness({ rows: [stored(), stored({ account_id: OTHER_ACCOUNT, user_text: "FOREIGN ACCOUNT" }), stored({ actor_user_id: OTHER_ACTOR, user_text: "FOREIGN ACTOR" })] });
  const response = await h.get(`accountId=${OTHER_ACCOUNT}&actorUserId=${OTHER_ACTOR}&uid=${OTHER_ACTOR}&model=expensive&plan=premium`);
  assert.equal(response.status, 200);
  const body = await bodyOf(response);
  assert.equal(body.available, true);
  assert.equal(body.accountId, ACCOUNT);
  assert.equal(body.conversation.id, CONVERSATION);
  assert.deepEqual(body.conversation.messages, [{ role: "user", content: "Préparer les publications", turnId: TURN }, { role: "assistant", content: "Voici trois idées." }]);
  assert.equal(body.conversation.pendingTurn, undefined);
  assert.doesNotMatch(JSON.stringify(body), /FOREIGN|PRIVATE|lease_id|actor_user_id|token/);
  assert.equal(h.factoryScopes[0].accountId, ACCOUNT);
  assert.equal(h.factoryScopes[0].actorUserId, ACTOR);
  assert.equal(h.factoryScopes[0].supabase, h.supabase);
  assert.equal(h.rpcs[0].name, "inrcy_list_assistant_conversations");
  assert.equal(h.rpcs[0].args.p_account_id, ACCOUNT);
  for (const query of h.queries) {
    assert.equal(query.table, "inr_assistant_turns");
    for (const [key, value] of [["account_id", ACCOUNT], ["actor_user_id", ACTOR], ["conversation_id", CONVERSATION]]) {
      assert.ok(query.filters.some(([filter, expected]) => filter === key && expected === value));
    }
  }
  assert.equal(h.diagnosticScopes[0].route, "/api/assistant/history");
  assert.equal(h.diagnosticScopes[0].requestId, body.requestId);
});

test("latest is the default and explicit UUID navigation retains the private conversation scope", async () => {
  const h = harness({ rows: [stored(), stored({ conversation_id: OLDER, turn_id: randomUUID(), user_text: "Ancienne discussion", updated_at: "2026-10-25T11:01:00Z", created_at: "2026-10-25T11:00:00Z" })] });
  assert.equal((await bodyOf(await h.get())).conversation.id, CONVERSATION);
  const chosen = await bodyOf(await h.get(`conversationId=${OLDER.toUpperCase()}`));
  assert.equal(chosen.conversation.id, OLDER);
  assert.equal(chosen.conversation.messages[0].content, "Ancienne discussion");
  const absent = await bodyOf(await h.get(`conversationId=${OTHER_ACCOUNT}`));
  assert.equal(absent.available, true);
  assert.equal(absent.conversation, null, "Foreign and nonexistent IDs reveal no conversation existence");
});

test("pending and failed final turns expose their real question and a manual-retry identity only", async () => {
  for (const status of ["pending", "failed"]) {
    const h = harness({ rows: [stored({ status, assistant_text: "PRIVATE PARTIAL REPLY" })] });
    const body = await bodyOf(await h.get());
    assert.deepEqual(body.conversation.messages, [{ role: "user", content: "Préparer les publications", turnId: TURN }]);
    assert.deepEqual(body.conversation.pendingTurn, { turnId: TURN });
    assert.doesNotMatch(JSON.stringify(body), /PARTIAL/);
    assert.equal(h.queries.length, 1);
    assert.equal(h.rpcs.length, 1);
  }
});

test("an earlier failed question never marks a later completed response as interrupted", async () => {
  const h = harness({ rows: [stored({ turn_id: randomUUID(), status: "failed", assistant_text: "PRIVATE FAILED REPLY", created_at: "2026-10-25T11:00:00Z" }), stored()] });
  const body = await bodyOf(await h.get());
  assert.equal(body.conversation.messages.length, 3);
  assert.equal(body.conversation.messages.at(-1).role, "assistant");
  assert.equal(body.conversation.pendingTurn, undefined);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE FAILED REPLY/);
});

test("history is capped to six chronological turns and twenty conversations with explicit truncation", async () => {
  const turns = Array.from({ length: 10 }, (_, index) => stored({ turn_id: randomUUID(), user_text: `Question ${index}`, assistant_text: `Réponse ${index}`,
    created_at: `2026-10-26T11:${String(index).padStart(2, "0")}:00Z`, updated_at: `2026-10-26T11:${String(index).padStart(2, "0")}:30Z` }));
  const h = harness({ rows: [...turns, ...Array.from({ length: 24 }, () => stored({ conversation_id: randomUUID(), turn_id: randomUUID() }))] });
  const body = await bodyOf(await h.get(`conversationId=${CONVERSATION}`));
  assert.equal(body.conversations.length, 20);
  assert.equal(body.truncated, true);
  assert.equal(body.conversation.messages.length, 12);
  assert.equal(body.conversation.messages[0].content, "Question 4");
  assert.equal(body.conversation.messages.at(-1).content, "Réponse 9");
  assert.equal(h.queries[0].limit, 7);
  assert.equal(h.rpcs[0].args.p_limit, 21);
});

test("real memory redaction excludes secrets while long assistant prose remains retrievable", async () => {
  const h = harness({ rows: [stored({ user_text: "Écrivez à client@example.test avec api_key=sk-proj-123456789abcdef",
    assistant_text: "Réponse utile. ".repeat(2000) + "https://private.supabase.co/storage/v1/object/sign/file.png?token=secretvalue" })] });
  const body = await bodyOf(await h.get());
  assert.ok(body.conversation.messages[1].content.length > 12_000);
  assert.ok(body.conversation.messages[1].content.length <= 60_000);
  assert.doesNotMatch(JSON.stringify(body), /client@example|sk-proj-|secretvalue|storage\/v1|PRIVATE TOKEN|PRIVATE LEASE/);
});

test("empty memory differs from unavailable sources without invented conversations or leaked SQL errors", async () => {
  const empty = harness({ rows: [] });
  const body = await bodyOf(await empty.get());
  assert.equal(body.available, true); assert.deepEqual(body.conversations, []); assert.equal(body.conversation, null);
  assert.equal(empty.queries.length, 0);
  for (const unavailable of ["list", "turns"] as const) {
    const response = await harness({ unavailable }).get();
    assert.equal(response.status, 200);
    const missing = await bodyOf(response);
    assert.equal(missing.available, false); assert.equal(missing.conversation, null);
    assert.doesNotMatch(JSON.stringify(missing), /PRIVATE|PGRST|SQL|STACK/);
  }
});

test("authentication and malformed identifiers stop memory operations and retain private headers", async () => {
  for (const authStatus of [401, 503] as const) {
    const h = harness({ authStatus });
    const response = await h.get("conversationId=invalid");
    assert.equal(response.status, authStatus);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(h.factoryScopes.length, 0); assert.equal(h.rpcs.length, 0); assert.equal(h.queries.length, 0);
  }
  for (const query of ["conversationId=", "conversationId=../../other", `conversationId=${CONVERSATION}&conversationId=${OLDER}`, `conversationId=${CONVERSATION.replace("-4000-", "-5000-")}`]) {
    const h = harness();
    const response = await h.get(query);
    assert.equal(response.status, 400);
    assert.equal((await bodyOf(response)).code, "assistant_memory_invalid_request");
    assert.equal(h.factoryScopes.length, 0); assert.equal(h.rpcs.length, 0); assert.equal(h.queries.length, 0);
  }
});

test("missing authenticated actor fails closed instead of using the account owner identity", async () => {
  const h = harness({ invalidServerActor: true });
  const response = await h.get();
  assert.equal(response.status, 503);
  assert.equal((await bodyOf(response)).code, "assistant_history_unavailable");
  assert.equal(h.rpcs.length, 0); assert.equal(h.queries.length, 0);
  assert.deepEqual(h.diagnosticErrors, [{ status: 503, code: "assistant_history_unavailable" }]);
});
