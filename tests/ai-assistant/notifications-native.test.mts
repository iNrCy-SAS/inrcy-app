import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as commands from "../../lib/inrAssistantCommandRegistry.ts";

type Row = Record<string, unknown>;
type SettingsRuntime = { createInrAssistantSettingsTools(options: unknown): {
  readToolSettings: { execute(input: unknown): Promise<Row & { settings: Row }> };
  updateToolSettings: { execute(input: unknown): Promise<Row> };
} };
function harness(options: { existing?: Row | null; readError?: boolean; forbidden?: boolean } = {}) {
  let saved: Row | null = options.existing === undefined ? { user_id: "active", in_app_enabled: false, email_enabled: false, performance_enabled: false, action_enabled: true, information_enabled: false, digest_every_hours: 168, updated_at: "2026-01-01" } : options.existing;
  const calls: { operation: string; payload?: Row; options?: Row; account?: unknown }[] = [];
  const admin = { from(table: string) {
    assert.equal(table, "notification_preferences");
    let payload: Row | undefined, settings: Row = {}, account: unknown;
    const finish = () => {
      if (payload) {
        calls.push({ operation: "upsert", payload, options: settings });
        if (!saved || settings.ignoreDuplicates !== true) saved = { ...(saved ?? {}), ...payload };
      } else calls.push({ operation: "select", account });
      return { data: saved ? { ...saved } : null, error: options.readError && !payload ? { message: "synthetic outage" } : null };
    };
    const query = {
      upsert(value: Row, config: Row) { payload = value; settings = config; return query; },
      select() { return query; }, eq(_key: string, value: unknown) { account = value; assert.equal(value, "active"); return query; },
      single: async () => finish(), maybeSingle: async () => finish(),
      then(resolve: (value: Row) => unknown) { return Promise.resolve(finish()).then(resolve); },
    };
    return query;
  } };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin: admin },
    "@/lib/notificationWriter": { insertNotificationOnce() { assert.fail("No notification created"); } },
    "next/server": { NextResponse: Response },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ error: "Unavailable" }, { status: 500 }) },
    "@/lib/requireUser": { requireUser: async () => ({ user: { id: "actor" }, activeUserId: "active", errorResponse: options.forbidden ? Response.json({}, { status: 401 }) : null }) },
    ai: { tool: (value: unknown) => value, jsonSchema: (value: unknown) => value },
    "./inrAssistantCommandRegistry.ts": commands,
  };
  function load<T>(path: string): T {
    const compiled = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const moduleRecord = { exports: {} as T };
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Request, Response, Headers, URL, Map })(
      (name: string) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; }, moduleRecord, moduleRecord.exports,
    );
    return moduleRecord.exports;
  }
  const notifications = load<typeof import("../../lib/notifications.ts")>("lib/notifications.ts"); dependencies["@/lib/notifications"] = notifications;
  const route = load<typeof import("../../app/api/notifications/preferences/route.ts")>("app/api/notifications/preferences/route.ts");
  dependencies["@/app/api/notifications/preferences/route"] = route;
  dependencies["./requireUser"] = dependencies["@/lib/requireUser"];
  const settings = load<SettingsRuntime>("lib/inrAssistantSettingsTools.ts");
  const tools = settings.createInrAssistantSettingsTools({ request: new Request("https://app.inrcy.test/api/assistant/chat"), accountId: "active", edition: "premium", currentUserMessage: "Désactive les notifications par email." });
  return { route, notifications, tools, calls, saved: () => saved };
}

test("real notification GET preserves every saved preference and timestamp with zero writes", async () => {
  const h = harness(), before = { ...h.saved() };
  const response = await h.route.GET(); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.source, "saved"); assert.deepEqual(body.preferences, before);
  assert.deepEqual(h.saved(), before); assert.equal(h.calls.filter(c => c.operation !== "select").length, 0);
});

test("reading a new account returns explicitly unsaved defaults without initializing it", async () => {
  const h = harness({ existing: null });
  const result = await h.tools.readToolSettings.execute({ tool: "notifications" });
  assert.equal(result.ok, true); assert.equal(result.source, "defaults_not_saved");
  assert.equal(result.settings.email_enabled, true); assert.equal(h.saved(), null);
  assert.equal(h.calls.filter(c => c.operation !== "select").length, 0);
});

test("real assistant read-update-read uses native routes and retains disabled unrelated preferences", async () => {
  const h = harness();
  await h.tools.readToolSettings.execute({ tool: "notifications" });
  const result = await h.tools.updateToolSettings.execute({ tool: "notifications", instructionQuote: "Désactive les notifications par email.", changes: [{ field: "email_enabled", value: false }] });
  assert.equal(result.status, "saved"); assert.equal(result.ok, true);
  const after = await (await h.route.GET()).json();
  assert.equal(after.preferences.email_enabled, false); assert.equal(after.preferences.in_app_enabled, false);
  assert.equal(after.preferences.performance_enabled, false); assert.equal(after.preferences.information_enabled, false);
  assert.equal(after.preferences.digest_every_hours, 168);
  assert.equal(h.calls.filter(c => c.operation === "upsert").length, 1);
});

test("initialization is insert-only on conflict and keeps existing choices on repeated login", async () => {
  const h = harness(), before = { ...h.saved() };
  await h.notifications.ensureNotificationPreferences("active");
  await h.notifications.ensureNotificationPreferences("active");
  assert.deepEqual(h.saved(), before);
  assert.ok(h.calls.filter(c => c.operation === "upsert").every(c => c.options?.ignoreDuplicates === true));
  const fresh = harness({ existing: null }); await fresh.notifications.ensureNotificationPreferences("active");
  assert.equal(fresh.saved()?.email_enabled, true);
});

test("unavailable reads and unauthenticated requests never invent saved defaults or write", async () => {
  const h = harness({ readError: true }); assert.equal((await h.route.GET()).status, 500);
  assert.equal((await h.tools.readToolSettings.execute({ tool: "notifications" })).ok, false);
  assert.equal(h.calls.filter(c => c.operation === "upsert").length, 0);
  const forbidden = harness({ forbidden: true }); assert.equal((await forbidden.route.GET()).status, 401);
  assert.equal(forbidden.calls.length, 0);
});
