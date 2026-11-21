import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  inrAgentEditorialGenerationRotationOffset,
  orderInrAgentEditorialGenerationAccounts,
} from "../../lib/inrAgentEditorialGenerationOrder.ts";

type Account = { userId: string; automation: { lastPreparedAt: string | null } };
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

test("the actual cron generation loop takes a fresh claim time after a slow prior generation", async () => {
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
  const start = Date.parse("2026-11-21T18:00:00Z");
  let clock = start;
  const claimTimes: number[] = [];
  const ClockDate = new Proxy(Date, {
    construct(target, args) { return Reflect.construct(target, args.length ? args : [clock]); },
  });
  const prepare = async (args: { now: Date; userId: string }) => {
    claimTimes.push(args.now.getTime());
    clock += 5 * 60_000;
    return { status: "prepared", actionId: args.userId };
  };
  const dispatch = new Function("dryRun", "maxGenerations", "enabledRows", "now", "pageCount", "origin", "supabaseAdmin", "inrAgentEditorialGenerationRotationOffset", "orderInrAgentEditorialGenerationAccounts", "prepareNextInrAgentEditorialSlot", "Date", `${compiled};return dispatch;`)(
    false, 3, accounts(2), new Date(start), 1, "https://isolated.test", {},
    inrAgentEditorialGenerationRotationOffset, orderInrAgentEditorialGenerationAccounts, prepare, ClockDate,
  );
  const generated = await dispatch();
  assert.equal(generated.length, 2);
  assert.deepEqual(claimTimes, [start, start + 5 * 60_000], "a later worker must not inherit the stale batch-start time");
});
