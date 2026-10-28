import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { ADMIN_TRIAL_FOLLOWUP_OFFSETS, calendarDaysUntil } from "../../lib/trialFollowup.ts";

const routeSource = readFileSync(new URL("../../app/api/admin/trials/route.ts", import.meta.url), "utf8");

function trialRoute(admin: boolean) {
  const selects = new Map<string, string>();
  const tables: string[] = [];
  const subscriptions = ["pro-a", "pro-b", "pro-without-profile"].map((user_id) => ({
    user_id,
    plan: "Trial",
    status: "trialing",
    trial_start_at: "2099-10-07T10:00:00.000Z",
    trial_end_at: "2099-10-28T10:00:00.000Z",
  }));
  const profiles = [
    { user_id: "pro-b", first_name: "Pro B", last_active_at: null, updated_at: "2026-10-28T12:00:00.000Z" },
    { user_id: "pro-a", first_name: "Pro A", last_active_at: "2026-10-27T14:32:00.000Z", updated_at: "2026-10-28T12:00:00.000Z" },
  ];
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/adminSecurity": { requireAdminApi: async () => admin
      ? { ok: true }
      : { ok: false, response: Response.json({ error: "Accès admin requis." }, { status: 403 }) } },
    "@/lib/trialSubscription": { getTrialDays: () => 21 },
    "@/lib/trialFollowup": { ADMIN_TRIAL_FOLLOWUP_OFFSETS, calendarDaysUntil },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from(table: string) {
      tables.push(table);
      assert.ok(["subscriptions", "profiles"].includes(table));
      return {
        select(columns: string) { selects.set(table, columns); return this; },
        eq() { return this; },
        order() { return this; },
        async limit() { return { data: subscriptions, error: null }; },
        async in(column: string, ids: string[]) {
          assert.equal(column, "user_id");
          assert.deepEqual(ids, subscriptions.map((row) => row.user_id));
          return { data: profiles, error: null };
        },
      };
    } } },
  };
  const routeModule = { exports: {} as { GET: () => Promise<Response> } };
  const compiled = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, routeModule, routeModule.exports);
  return { GET: routeModule.exports.GET, selects, tables };
}

test("trial follow-up returns each pro's real Last Active, including missing activity and profiles", async () => {
  const route = trialRoute(true);
  const response = await route.GET();
  assert.equal(response.status, 200);
  const payload = await response.json() as { trials: Array<{ user_id: string; last_active_at: string | null }> };
  assert.ok(route.selects.get("profiles")?.split(",").includes("last_active_at"));
  const activity = Object.fromEntries(payload.trials.map((row) => [row.user_id, row.last_active_at]));
  assert.deepEqual(activity, {
    "pro-a": "2026-10-27T14:32:00.000Z",
    "pro-b": null,
    "pro-without-profile": null,
  });
  assert.deepEqual(route.tables, ["subscriptions", "profiles"], "one profile batch fetch covers the whole table");
});

test("trial Last Active remains admin-only and never queries Supabase for a non-admin", async () => {
  const route = trialRoute(false);
  const response = await route.GET();
  assert.equal(response.status, 403);
  assert.deepEqual(route.tables, []);
  assert.deepEqual(await response.json(), { error: "Accès admin requis." });
});
