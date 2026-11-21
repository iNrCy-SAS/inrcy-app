import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { withInrAgentEditorialGenerationLease } from "../../lib/inrAgentEditorialGenerationLease.ts";
import {
  inrAgentEditorialGenerationRotationOffset,
  orderInrAgentEditorialGenerationAccounts,
} from "../../lib/inrAgentEditorialGenerationOrder.ts";

type Account = { userId: string; automation: { lastPreparedAt: string | null }; lastAttemptAt?: string };
const accounts = (count: number): Account[] => Array.from({ length: count }, (_, index) => ({
  userId: `account-${index}`,
  automation: { lastPreparedAt: null },
}));
function generationWindow(rows: Account[], tick: number, pageCount: number, budget = 3) {
  const offset = inrAgentEditorialGenerationRotationOffset({ tick, pageCount, accountCount: rows.length, maxGenerations: budget });
  return orderInrAgentEditorialGenerationAccounts(rows, offset).slice(0, budget);
}

test("older or never-prepared accounts precede recently prepared accounts without changing input", () => {
  const rows: Account[] = [
    { userId: "recent", automation: { lastPreparedAt: "2026-11-21T17:50:00Z" } },
    { userId: "never", automation: { lastPreparedAt: null } },
    { userId: "invalid", automation: { lastPreparedAt: "not-a-date" } },
    { userId: "old", automation: { lastPreparedAt: "2026-11-21T17:20:00Z" } },
  ];
  const before = structuredClone(rows);
  assert.deepEqual(orderInrAgentEditorialGenerationAccounts(rows, 2).map(row => row.userId), ["invalid", "never", "old", "recent"]);
  assert.deepEqual(rows, before);
});

test("each of four forty-account pages serves every tied account within fourteen page visits", () => {
  const rows = accounts(40);
  for (let page = 0; page < 4; page++) {
    const served = new Set<string>();
    for (let visit = 0; visit < 14; visit++) {
      const window = generationWindow(rows, page + visit * 4, 4);
      assert.equal(window.length, 3, "the existing per-run generation budget remains three");
      window.forEach(account => served.add(account.userId));
    }
    assert.equal(served.size, 40, `page ${page} must not alias its rotation to the page count`);
  }
});

test("a tied account is never skipped for an entire fourteen-visit window on a forty-account page", () => {
  const rows = accounts(40);
  for (let start = 0; start < 40; start++) {
    const served = new Set<string>();
    for (let visit = start; visit < start + 14; visit++) {
      generationWindow(rows, visit, 1).forEach(account => served.add(account.userId));
    }
    assert.equal(served.size, 40, `window starting at ${start}`);
  }
});

test("successful preparations yield their turn to accounts with older persisted preparation times", () => {
  const rows = accounts(40);
  rows.forEach((account, index) => { account.automation.lastPreparedAt = new Date(Date.UTC(2026, 10, 20, 0, index)).toISOString(); });
  const served = new Set<string>();
  for (let visit = 0; visit < 14; visit++) {
    const window = generationWindow(rows, visit, 1);
    for (const account of window) {
      served.add(account.userId);
      account.automation.lastPreparedAt = new Date(Date.UTC(2026, 10, 21, 18, visit)).toISOString();
    }
  }
  assert.equal(served.size, 40, "recently prepared accounts cannot consume every later cron budget");
  const newcomer = { userId: "newcomer", automation: { lastPreparedAt: null } };
  assert.equal(generationWindow([...rows, newcomer], 15, 1)[0].userId, "newcomer");
});

test("empty and single-account pages remain valid generation windows", () => {
  assert.deepEqual(generationWindow([], 10, 1), []);
  assert.deepEqual(generationWindow(accounts(1), 10, 1).map(account => account.userId), ["account-0"]);
});

type Attempt = { user_id: string; editorialLastAttemptAt: string };
function actualCronGenerationLoop(options: {
  rows: Account[];
  now: Date;
  history: Attempt[];
  historyError?: { message: string };
  prepare: (args: { now: Date; userId: string }) => Promise<{ status: string; actionId: string | null; generationStarted?: boolean; error?: string }>;
  ClockDate?: DateConstructor;
}) {
  const source = readFileSync(new URL("../../app/api/cron/inr-agent-editorial-plan/route.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("editorial-cron.ts", source, ts.ScriptTarget.Latest, true);
  let generationBlock: ts.IfStatement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.expression.getText(ast).includes("maxGenerations > 0") && node.expression.getText(ast).includes("enabledRows.length > 0")) generationBlock = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(generationBlock, "exercise the real bounded cron loop");
  const compiled = ts.transpileModule(`async function dispatch(){const generated=[];${generationBlock.getText(ast)};return generated;}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const queryCalls: Array<{ method: string; args: unknown[] }> = [];
  const query = {
    select(...args: unknown[]) { queryCalls.push({ method: "select", args }); return this; },
    in(...args: unknown[]) { queryCalls.push({ method: "in", args }); return this; },
    eq(...args: unknown[]) { queryCalls.push({ method: "eq", args }); return this; },
    not(...args: unknown[]) { queryCalls.push({ method: "not", args }); return this; },
    order(...args: unknown[]) { queryCalls.push({ method: "order", args }); return this; },
    async limit(...args: unknown[]) { queryCalls.push({ method: "limit", args }); return { data: options.history, error: options.historyError || null }; },
  };
  const database = { from(...args: unknown[]) { queryCalls.push({ method: "from", args }); return query; } };
  const dispatch = new Function("dryRun", "maxGenerations", "enabledRows", "now", "pageCount", "origin", "supabaseAdmin", "inrAgentEditorialGenerationRotationOffset", "orderInrAgentEditorialGenerationAccounts", "prepareNextInrAgentEditorialSlot", "Date", "NextResponse", `${compiled};return dispatch;`)(
    false, 3, options.rows, options.now, 1, "https://isolated.test", database,
    inrAgentEditorialGenerationRotationOffset, orderInrAgentEditorialGenerationAccounts, options.prepare, options.ClockDate || Date,
    { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
  );
  return { dispatch, queryCalls };
}

test("the actual cron generation loop takes a fresh claim time after a slow prior generation", async () => {
  const start = Date.parse("2026-11-21T18:00:00Z");
  let clock = start;
  const claimTimes: number[] = [];
  const ClockDate = new Proxy(Date, {
    construct(target, args) { return Reflect.construct(target, args.length ? args : [clock]); },
  });
  const fixture = actualCronGenerationLoop({ rows: accounts(2), now: new Date(start), history: [], ClockDate,
    prepare: async (args) => { claimTimes.push(args.now.getTime()); clock += 5 * 60_000; return { status: "prepared", actionId: args.userId }; },
  });
  const generated = await fixture.dispatch();
  assert.equal(generated.length, 2);
  assert.deepEqual(claimTimes, [start, start + 5 * 60_000], "a later worker must not inherit the stale batch-start time");
});

test("three old accounts that keep failing cannot starve any of forty accounts across fourteen actual cron windows", async () => {
  const rows = accounts(40);
  const oldPrepared = "2026-01-01T00:00:00Z";
  rows.forEach((row, index) => { row.automation.lastPreparedAt = index < 3 ? oldPrepared : "2026-11-20T00:00:00Z"; });
  const latestAttempts = new Map<string, string>();
  const served = new Set<string>();
  let clock = Date.parse("2026-11-21T18:00:00Z");
  for (let visit = 0; visit < 14; visit++) {
    const at = new Date(clock);
    const fixture = actualCronGenerationLoop({ rows, now: at,
      history: [...latestAttempts].map(([user_id, editorialLastAttemptAt]) => ({ user_id, editorialLastAttemptAt })),
      ClockDate: new Proxy(Date, { construct(target, args) { return Reflect.construct(target, args.length ? args : [clock]); } }),
      prepare: async ({ userId }) => {
        served.add(userId);
        latestAttempts.set(userId, new Date(clock).toISOString());
        const failed = ["account-0", "account-1", "account-2"].includes(userId);
        if (!failed) rows.find(row => row.userId === userId)!.automation.lastPreparedAt = new Date(clock).toISOString();
        return { status: failed ? "retry" : "prepared", actionId: userId };
      },
    });
    assert.equal((await fixture.dispatch()).length, 3);
    clock += 60_000;
  }
  assert.equal(served.size, 40, "failed attempts must yield their turn even when lastPreparedAt never advances");
  assert.ok(rows.slice(0, 3).every(row => row.automation.lastPreparedAt === oldPrepared));
});

test("three permanent pre-generation lease failures retain diagnostics without starving three real preparations per cron window", async () => {
  const rows = accounts(40);
  rows.forEach((row, index) => { row.automation.lastPreparedAt = index < 3 ? "2026-01-01T00:00:00Z" : "2026-11-20T00:00:00Z"; });
  const denied = new Set(["account-0", "account-1", "account-2"]);
  const served = new Set<string>();
  const refusedLeases: string[] = [];
  let forbiddenCallbacks = 0;
  let clock = Date.parse("2026-11-21T18:00:00Z");
  const leaseDatabase = {
    from(table: string) {
      assert.equal(table, "execution_idempotency_locks");
      return {
        upsert(value: { user_id: string }) { refusedLeases.push(value.user_id); return this; },
        async select() { return { data: null, error: { code: "23503", message: "Account lease rejected" } }; },
      };
    },
  };
  for (let visit = 0; visit < 14; visit++) {
    let realPreparations = 0;
    const fixture = actualCronGenerationLoop({ rows, now: new Date(clock), history: [],
      prepare: async ({ userId }) => {
        if (denied.has(userId)) {
          return withInrAgentEditorialGenerationLease({ supabase: leaseDatabase, userId }, async () => {
            forbiddenCallbacks++;
            return { status: "prepared", actionId: userId, generationStarted: true };
          });
        }
        realPreparations++;
        served.add(userId);
        rows.find(row => row.userId === userId)!.automation.lastPreparedAt = new Date(clock).toISOString();
        return { status: "prepared", actionId: userId, generationStarted: true };
      },
    });
    const results = await fixture.dispatch();
    assert.equal(realPreparations, 3, "the provider budget remains three actual preparations");
    assert.equal(results.length, 6, "all three failed accounts remain in the cron diagnostics");
    assert.deepEqual(new Set(results.filter((row: { status: string }) => row.status === "failed").map((row: { userId: string }) => row.userId)), denied);
    for (const failure of results.filter((row: { status: string }) => row.status === "failed")) {
      assert.equal(failure.generationStarted, false);
      assert.equal(failure.error, "editorial_generation_lease_unavailable");
      assert.equal(failure.actionId, null);
    }
    clock += 60_000;
  }
  assert.equal(forbiddenCallbacks, 0, "a failed lease never invokes the generation callback");
  assert.equal(refusedLeases.length, 42, "each refused account is inspected only once per bounded page visit");
  assert.equal(served.size, 37, "all healthy accounts advance despite persistent older pre-generation failures");
});

test("pre-generation failures cannot turn a forty-account page into an unbounded retry loop", async () => {
  const visited: string[] = [];
  const fixture = actualCronGenerationLoop({ rows: accounts(40), now: new Date(), history: [],
    prepare: async ({ userId }) => {
      visited.push(userId);
      return { status: "failed", actionId: null, generationStarted: false, error: "claim refused" };
    },
  });
  const results = await fixture.dispatch();
  assert.equal(results.length, 40);
  assert.equal(visited.length, 40);
  assert.equal(new Set(visited).size, 40);
});

test("started failures, unknown results and thrown preparation errors still consume the conservative budget", async () => {
  let calls = 0;
  const fixture = actualCronGenerationLoop({ rows: accounts(40), now: new Date(), history: [],
    prepare: async ({ userId }) => {
      calls++;
      if (calls === 1) return { status: "failed", actionId: null, generationStarted: false, error: "pre-generation refusal" };
      if (calls === 2) return { status: "retry", actionId: userId, generationStarted: true, error: "provider failure" };
      if (calls === 3) throw new Error("ambiguous failure after starting");
      return { status: "failed", actionId: userId, error: "unknown preparation failure" };
    },
  });
  const results = await fixture.dispatch();
  assert.equal(calls, 4, "only the explicit pre-generation refusal can leave a budget place unused");
  assert.equal(results.length, 4);
  assert.equal(results[2].status, "failed");
  assert.equal(results[2].error, "ambiguous failure after starting");
});

test("the actual cron reads only bounded editorial attempt history for enabled publication accounts", async () => {
  const rows = accounts(2);
  const recent = "2026-11-21T18:00:00Z";
  const fixture = actualCronGenerationLoop({ rows, now: new Date(recent), history: [
    { user_id: "account-0", editorialLastAttemptAt: recent },
    { user_id: "account-0", editorialLastAttemptAt: "2026-01-01T00:00:00Z" },
  ], prepare: async ({ userId }) => ({ status: "prepared", actionId: userId }) });
  const generated = await fixture.dispatch();
  assert.equal(generated[0].userId, "account-1");
  assert.equal(rows[0].lastAttemptAt, recent, "the maximum timestamp wins, even when returned rows are not unique");
  const call = (method: string) => fixture.queryCalls.filter(entry => entry.method === method).map(entry => entry.args);
  assert.deepEqual(call("from"), [["inr_agent_actions"]]);
  assert.deepEqual(call("select"), [["user_id,editorialLastAttemptAt:metadata->>editorialLastAttemptAt"]]);
  assert.deepEqual(call("in"), [["user_id", ["account-0", "account-1"]]]);
  assert.deepEqual(call("eq"), [["automation_key", "publish"], ["metadata->>editorialPlan", "true"]]);
  assert.deepEqual(call("not"), [["metadata->>editorialLastAttemptAt", "is", null]]);
  assert.deepEqual(call("order"), [["metadata->>editorialLastAttemptAt", { ascending: false, nullsFirst: false }]]);
  assert.deepEqual(call("limit"), [[4000]]);
});

test("the actual cron never generates on an unreadable attempt history instead of silently reusing success-only order", async () => {
  let generations = 0;
  const fixture = actualCronGenerationLoop({ rows: accounts(2), now: new Date(), history: [], historyError: { message: "database unavailable" },
    prepare: async ({ userId }) => { generations++; return { status: "prepared", actionId: userId }; },
  });
  const response = await fixture.dispatch();
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, "editorial_generation_attempt_history_unavailable");
  assert.equal(generations, 0);
});

test("ordering uses the later of successful preparation and actual attempt time", () => {
  const rows: Account[] = [
    { userId: "latest-preparation", automation: { lastPreparedAt: "2026-11-21T18:03:00Z" }, lastAttemptAt: "2026-11-21T18:01:00Z" },
    { userId: "latest-attempt", automation: { lastPreparedAt: "2026-01-01T00:00:00Z" }, lastAttemptAt: "2026-11-21T18:02:00Z" },
  ];
  assert.deepEqual(orderInrAgentEditorialGenerationAccounts(rows, 0).map(row => row.userId), ["latest-attempt", "latest-preparation"]);
});
