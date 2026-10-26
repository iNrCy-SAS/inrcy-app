import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Memory from "../../lib/inrAssistantMemory.ts";

const ACCOUNT = "10000000-0000-4000-8000-000000000001";
const OTHER_ACCOUNT = "10000000-0000-4000-8000-000000000002";
const ACTOR = "20000000-0000-4000-8000-000000000001";
const OTHER_ACTOR = "20000000-0000-4000-8000-000000000002";
const CONVERSATION = "30000000-0000-4000-8000-000000000001";
const OTHER_CONVERSATION = "30000000-0000-4000-8000-000000000002";
const TURN = "40000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;
type Query = { table: string; operation: string; filters: Array<[string, unknown]>; minimums: Array<[string, string]>; payload?: Row; select?: string; maximum?: number; search?: string };
const NOW = Date.parse("2026-10-26T12:00:00Z");
class FixedDate extends Date { constructor(value?: string | number) { super(value ?? NOW); } static now() { return NOW; } }

function fixture(options: { rows?: Row[]; unavailable?: boolean; insertRace?: boolean; updateRace?: boolean } = {}) {
  const rows = (options.rows ?? []).map((row) => ({ ...row }));
  const queries: Query[] = [];
  const rpc: Array<{ name: string; args: Row }> = [];
  let insertRaced = false;
  const supabase = {
    from(table: string) {
      const query: Query = { table, operation: "select", filters: [], minimums: [] }; queries.push(query);
      const result = () => {
        if (options.unavailable) return { data: null, error: { code: "private", message: "PRIVATE SQL password=secret" } };
        if (query.operation === "insert") {
          const value = { ...query.payload };
          const duplicate = rows.some((row) => ["account_id", "actor_user_id", "turn_id"].every((key) => row[key] === value[key]));
          if (options.insertRace && !insertRaced) {
            insertRaced = true; rows.push({ ...value, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() });
            return { data: null, error: { code: "23505", message: "PRIVATE CONFLICT" } };
          }
          if (duplicate) return { data: null, error: { code: "23505" } };
          const saved = { ...value, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() };
          rows.push(saved); return { data: saved, error: null };
        }
        let selected = rows.filter((row) => query.filters.every(([key, value]) => row[key] === value)
          && query.minimums.every(([key, minimum]) => Date.parse(String(row[key])) >= Date.parse(minimum)));
        if (query.search) {
          const terms = query.search.split(" OR ");
          selected = selected.filter((row) => terms.some((term) => `${row.user_text} ${row.assistant_text}`.toLowerCase().includes(term)));
        }
        if (query.operation === "update") {
          if (options.updateRace) return { data: null, error: null };
          for (const row of selected) Object.assign(row, query.payload);
          return { data: selected[0] ?? null, error: null };
        }
        selected.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.turn_id).localeCompare(String(a.turn_id)));
        if (query.maximum !== undefined) selected = selected.slice(0, query.maximum);
        return { data: selected, error: null };
      };
      const builder = {
        select(fields: string) { query.select = fields; return builder; },
        eq(key: string, value: unknown) { query.filters.push([key, value]); return builder; },
        gte(key: string, value: string) { query.minimums.push([key, value]); return builder; },
        order() { return builder; },
        limit(maximum: number) { query.maximum = maximum; return builder; },
        textSearch(_key: string, value: string) { query.search = value; return builder; },
        insert(value: Row) { query.operation = "insert"; query.payload = value; return builder; },
        update(value: Row) { query.operation = "update"; query.payload = value; return builder; },
        async maybeSingle() { const response = result(); return { ...response, data: Array.isArray(response.data) ? response.data[0] ?? null : response.data }; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return builder;
    },
    async rpc(name: string, args: Row) {
      rpc.push({ name, args });
      if (options.unavailable) return { data: null, error: { message: "PRIVATE ERROR" } };
      const groups = new Map<string, Row[]>();
      for (const row of rows.filter((row) => row.account_id === args.p_account_id && row.actor_user_id === ACTOR)) {
        const key = String(row.conversation_id); groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      const data = [...groups.values()].map((group) => {
        group.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        return { conversation_id: group[0].conversation_id, title: group[0].user_text, updated_at: group.map((row) => String(row.updated_at)).sort().at(-1) };
      }).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, Number(args.p_limit));
      return { data, error: null };
    },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantMemory.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { Date: FixedDate, URL, setTimeout, clearTimeout })((name: string) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return { randomUUID };
    throw new Error(`Unexpected dependency: ${name}`);
  }, record, record.exports);
  const runtime = record.exports as typeof Memory;
  const create = () => runtime.createInrAssistantMemory({ supabase: supabase as never, accountId: ACCOUNT, actorUserId: ACTOR });
  return { rows, queries, rpc, runtime, memory: create(), create };
}
function stored(extra: Row = {}): Row {
  return { account_id: ACCOUNT, actor_user_id: ACTOR, conversation_id: CONVERSATION, turn_id: TURN,
    lease_id: randomUUID(), user_text: "Préparer nos publications de Noël", assistant_text: "Préparons trois sujets.", status: "completed",
    created_at: "2026-10-20T11:00:00Z", updated_at: "2026-10-20T11:01:00Z", ...extra };
}

test("questions persist before execution, completions persist on the same actor and account without tool payloads", async () => {
  const h = fixture();
  const begin = await h.memory.beginTurn({ conversationId: CONVERSATION, turnId: TURN, userText: "Crée un visuel pour Noël" });
  assert.equal(begin.claimed, true); assert.equal(begin.turn?.status, "pending");
  assert.equal(h.rows.length, 1); assert.equal(h.rows[0].assistant_text, undefined);
  const complete = await h.memory.completeTurn({ conversationId: CONVERSATION, turnId: TURN, assistantText: "Votre visuel est dans [Mes médias](/dashboard/mediatheque)." });
  assert.equal(complete.ok, true); assert.equal(complete.turn?.status, "completed");
  assert.equal(complete.turn?.assistantText, "Votre visuel est dans [Mes médias](/dashboard/mediatheque).");
  assert.ok(!JSON.stringify(complete).includes(ACCOUNT)); assert.ok(!JSON.stringify(complete).includes(ACTOR));
  for (const query of h.queries) if (query.operation !== "insert") {
    assert.ok(query.filters.some(([key, value]) => key === "account_id" && value === ACCOUNT));
    assert.ok(query.filters.some(([key, value]) => key === "actor_user_id" && value === ACTOR));
  }
});

test("completed retries return the original answer, pending retries do not claim a second paid call", async () => {
  const h = fixture();
  const first = await h.memory.beginTurn({ conversationId: CONVERSATION, turnId: TURN, userText: "Mon message" });
  const pending = await h.create().beginTurn({ conversationId: CONVERSATION, turnId: TURN, userText: "Mon message" });
  assert.equal(first.claimed, true); assert.equal(pending.claimed, false); assert.equal(pending.retryAfterSeconds, 900);
  await h.memory.completeTurn({ conversationId: CONVERSATION, turnId: TURN, assistantText: "Réponse conservée" });
  const completed = await h.create().beginTurn({ conversationId: CONVERSATION, turnId: TURN, userText: "Mon message" });
  assert.equal(completed.claimed, false); assert.equal(completed.turn?.assistantText, "Réponse conservée");
  await h.create().completeTurn({ conversationId: CONVERSATION, turnId: TURN, assistantText: "Réponse à ne pas écraser" });
  assert.equal(h.rows[0].assistant_text, "Réponse conservée");
  assert.equal(h.rows.length, 1);
});

test("complex replies longer than twelve thousand characters remain fully durable", async () => {
  const h = fixture();
  await h.memory.beginTurn({ conversationId: CONVERSATION, turnId: TURN, userText: "Prépare un plan détaillé" });
  const text = "Voici notre plan de communication. ".repeat(700);
  const result = await h.memory.completeTurn({ conversationId: CONVERSATION, turnId: TURN, assistantText: text });
  assert.equal(result.ok, true); assert.equal(result.turn?.assistantText, text.trim());
  assert.equal((await h.create().loadRecent()).turns[0].assistantText, text.trim());
});

test("a crashed worker is reclaimed after the fifteen minute lease, with compare-and-set and an isolated new lease", async () => {
  const h = fixture({ rows: [stored({ status: "pending", assistant_text: null, updated_at: "2026-10-26T11:44:00Z" })] });
  const previousLease = h.rows[0].lease_id;
  const result = await h.memory.beginTurn({ conversationId: CONVERSATION, turnId: TURN, userText: "Préparer nos publications de Noël" });
  assert.equal(result.claimed, true); assert.equal(result.existing, true);
  assert.notEqual(h.rows[0].lease_id, previousLease);
  const update = h.queries.find((query) => query.operation === "update")!;
  assert.ok(update.filters.some(([key, value]) => key === "updated_at" && value === "2026-10-26T11:44:00Z"));
  const outsider = await h.create().completeTurn({ conversationId: CONVERSATION, turnId: TURN, assistantText: "Ancien worker" });
  assert.equal(outsider.ok, false); assert.equal(h.rows[0].status, "pending");
  assert.equal((await h.memory.completeTurn({ conversationId: CONVERSATION, turnId: TURN, assistantText: "Worker actuel" })).ok, true);
});

test("failed turns can be resumed, while a lost compare-and-set never claims ownership", async () => {
  const h = fixture();
  const input = { conversationId: CONVERSATION, turnId: TURN, userText: "Ma demande" };
  await h.memory.beginTurn(input);
  assert.equal((await h.memory.failTurn(input)).turn?.status, "failed");
  assert.equal((await h.create().beginTurn(input)).claimed, true);
  const raced = fixture({ rows: [stored({ status: "failed" })], updateRace: true });
  assert.equal((await raced.memory.beginTurn({ ...input, userText: "Préparer nos publications de Noël" })).claimed, false);
});

test("a unique insert race is recovered without overwriting a prior question or conversation", async () => {
  const h = fixture({ insertRace: true });
  const result = await h.memory.beginTurn({ conversationId: CONVERSATION, turnId: TURN, userText: "Ma demande" });
  assert.equal(result.existing, true); assert.equal(result.claimed, false); assert.equal(h.rows.length, 1);
  await assert.rejects(h.memory.beginTurn({ conversationId: OTHER_CONVERSATION, turnId: TURN, userText: "Ma demande" }), /déjà liée/);
  await assert.rejects(h.memory.beginTurn({ conversationId: CONVERSATION, turnId: TURN, userText: "Autre demande" }), /déjà liée/);
});

test("every read stays private to one professional and account, including shared-account colleagues and coinciding UUIDs", async () => {
  const h = fixture({ rows: [stored(), stored({ account_id: OTHER_ACCOUNT, user_text: "OTHER ACCOUNT" }),
    stored({ actor_user_id: OTHER_ACTOR, user_text: "COLLEAGUE PRIVATE" })] });
  const read = await h.memory.loadRecent({ conversationId: CONVERSATION });
  assert.equal(read.turns.length, 1); assert.equal(read.untrustedContent, true);
  const search = await h.memory.search({ query: "Noël" });
  assert.equal(search.turns.length, 1);
  const conversations = await h.memory.listConversations();
  assert.equal(conversations.conversations.length, 1);
  assert.equal(JSON.stringify([read, search, conversations]).includes("OTHER ACCOUNT"), false);
  assert.equal(JSON.stringify([read, search, conversations]).includes("COLLEAGUE"), false);
  assert.equal(h.rpc[0].name, "inrcy_list_assistant_conversations");
  assert.equal(h.rpc[0].args.p_account_id, ACCOUNT);
});

test("recent results are six chronological turns and report truncation; search and listing have independent bounds", async () => {
  const h = fixture({ rows: Array.from({ length: 30 }, (_, i) => stored({ turn_id: randomUUID(), conversation_id: i < 10 ? CONVERSATION : randomUUID(),
    user_text: `Noël sujet ${i}`, created_at: new Date(NOW - (30 - i) * 60_000).toISOString() })) });
  const recent = await h.memory.loadRecent();
  assert.equal(recent.turns.length, 6); assert.equal(recent.truncated, true);
  assert.ok(recent.turns[0].createdAt < recent.turns[5].createdAt);
  const search = await h.memory.search({ query: "Noël" });
  assert.equal(search.turns.length, 8); assert.equal(search.truncated, true);
  const listed = await h.memory.listConversations();
  assert.equal(listed.conversations.length, 20); assert.equal(listed.truncated, true);
  assert.equal(h.rpc[0].args.p_limit, 21);
  assert.ok(h.queries.every((query) => query.maximum === undefined || query.maximum <= 9));
});

test("search operators are built from bounded local terms, never interpolated scope or REST filters", async () => {
  const h = fixture({ rows: [stored()] });
  await h.memory.search({ query: 'Noël ") or account_id=foreign OR zzz:* | !supabase' });
  const query = h.queries.at(-1)!;
  assert.match(query.search!, /^noël OR account/u);
  assert.doesNotMatch(query.search!, /[()=*|!]/);
  assert.ok(query.search!.split(" OR ").length <= 8);
  assert.deepEqual(await h.memory.search({ query: "!!" }).then((r) => r.turns.length), 0);
});

test("storage and reads redact private links, media, credentials, direct client contacts and technical traces while retaining public business links", async () => {
  const h = fixture();
  const secret = `Notre site https://atelier.example/services et [Aide](/dashboard?help=1).
client : Jean Dupont, contact jean.dupont@example.test +33 6 12 34 56 78
api_key=sk-proj-abcdefghijklmnopqrstuvwxyz Bearer VERYSECRET
https://project.supabase.co/storage/v1/object/sign/private/image?token=HIDDENTOKEN
https://cdn.example/photo.jpg https://cdn.example/get?X-Amz-Signature=SECRET
https://site.example/#access_token=SECRET https://name:password@private.example
\`\`\`env
SUPABASE_SERVICE_ROLE_KEY=HIDDEN
\`\`\`
TypeError: Cannot read password at C:\\private\\route.ts:22:2`;
  const text = h.runtime.sanitizeInrAssistantMemoryText(secret);
  assert.match(text, /https:\/\/atelier.example\/services/);
  assert.match(text, /\/dashboard\?help=1/);
  for (const forbidden of ["Jean Dupont", "jean.dupont", "12 34 56", "abcdefghijklmnopqrstuvwxyz", "VERYSECRET", "supabase.co", "photo.jpg", "HIDDENTOKEN", "HIDDEN", "TypeError", "C:\\private", "password@", "access_token=SECRET"]) assert.equal(text.includes(forbidden), false, forbidden);
  const row = stored({ user_text: secret, assistant_text: secret });
  const reread = fixture({ rows: [row] });
  const result = await reread.memory.loadRecent();
  assert.equal(result.turns[0].userText.includes("Jean Dupont"), false);
  assert.equal(result.turns[0].assistantText!.includes("HIDDENTOKEN"), false);
});

test("unavailable storage never pretends to have persisted or retrieved an empty successful history", async () => {
  const h = fixture({ unavailable: true });
  const begin = await h.memory.beginTurn({ conversationId: CONVERSATION, turnId: TURN, userText: "Ma demande" });
  assert.equal(begin.available, false); assert.equal(begin.claimed, false);
  assert.equal((await h.memory.loadRecent()).available, false);
  assert.equal((await h.memory.search({ query: "Noël" })).available, false);
  assert.equal((await h.memory.listConversations()).available, false);
  assert.equal(JSON.stringify(begin).includes("secret"), false);
});

test("invalid scope, conversation IDs, text sizes and read limits are rejected before any query", async () => {
  const h = fixture();
  assert.throws(() => h.runtime.createInrAssistantMemory({ supabase: {} as never, accountId: "foreign", actorUserId: ACTOR }), /invalide/);
  await assert.rejects(h.memory.beginTurn({ conversationId: "bad", turnId: TURN, userText: "x" }), /invalide/);
  await assert.rejects(h.memory.beginTurn({ conversationId: CONVERSATION, turnId: TURN, userText: "x".repeat(4_001) }), /invalide/);
  await assert.rejects(h.memory.loadRecent({ limit: 7 }), /invalide/);
  await assert.rejects(h.memory.search({ query: "x", limit: 9 }), /invalide/);
  await assert.rejects(h.memory.listConversations({ limit: 21 }), /invalide/);
  assert.equal(h.queries.length, 0); assert.equal(h.rpc.length, 0);
});

test("retention uses two rolling UTC calendar months, clamps month ends and preserves the exact time", () => {
  const { runtime } = fixture();
  for (const [now, expected] of [
    ["2026-10-26T12:00:00.000Z", "2026-08-26T12:00:00.000Z"],
    ["2026-08-31T23:59:59.999Z", "2026-06-30T23:59:59.999Z"],
    ["2026-04-30T08:12:34.567Z", "2026-02-28T08:12:34.567Z"],
    ["2024-04-30T08:12:34.567Z", "2024-02-29T08:12:34.567Z"],
    ["2026-01-31T00:00:00.000Z", "2025-11-30T00:00:00.000Z"],
  ]) assert.equal(runtime.inrAssistantMemoryCutoff(new Date(now)), expected);
  assert.throws(() => runtime.inrAssistantMemoryCutoff(new Date(NaN)), /Invalid/);
});

test("expired prose cannot be recalled, searched or replayed even when it was updated today; the exact boundary is retained", async () => {
  const oldest = stored({ created_at: "2026-08-26T11:59:59.999Z", updated_at: new Date(NOW).toISOString(), assistant_text: "EXPIRED PRIVATE ANSWER" });
  const boundary = stored({ turn_id: randomUUID(), created_at: "2026-08-26T12:00:00.000Z", user_text: "Noël au seuil" });
  const h = fixture({ rows: [oldest, boundary] });
  const recent = await h.memory.loadRecent({ conversationId: CONVERSATION });
  assert.equal(recent.available, true); assert.equal(recent.turns.length, 1); assert.equal(recent.turns[0].userText, "Noël au seuil");
  const found = await h.memory.search({ query: "Noël" });
  assert.equal(found.turns.length, 1); assert.equal(found.turns[0].turnId, boundary.turn_id);
  const retry = await h.memory.beginTurn({ conversationId: CONVERSATION, turnId: TURN, userText: "Préparer nos publications de Noël" });
  assert.equal(retry.claimed, false); assert.equal(retry.ok, false); assert.equal(retry.turn, null);
  assert.equal(JSON.stringify([recent, found, retry]).includes("EXPIRED"), false);
  const finish = await h.memory.completeTurn({ conversationId: CONVERSATION, turnId: TURN, assistantText: "Do not revive expired memory" });
  assert.equal(finish.ok, false); assert.equal(h.rows[0].assistant_text, "EXPIRED PRIVATE ANSWER");
  for (const query of h.queries.filter(query => query.operation !== "insert")) {
    assert.ok(query.minimums.some(([key, value]) => key === "created_at" && value === "2026-08-26T12:00:00.000Z"));
  }
});
