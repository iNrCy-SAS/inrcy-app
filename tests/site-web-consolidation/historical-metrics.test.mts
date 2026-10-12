import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as channelPolicy from "../../lib/boosterPublicationPolicy.ts";

test("historical Booster website events count toward Site Web without doubling events that targeted both old sites", async () => {
  const events = [
    { type: "publish", created_at: new Date().toISOString(), payload: { channels: ["inrcy_site"] } },
    { type: "publish", created_at: new Date().toISOString(), payload: { channels: ["inrcy_site", "site_web", "facebook"] } },
  ];
  const supabase = {
    from(table: string) {
      const builder = {
        select: () => builder, eq: () => builder, in: () => builder,
        gte: () => builder, gt: () => builder, order: () => builder,
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: table === "app_events" ? events : [], error: null }).then(resolve); },
      };
      return builder;
    },
  };
  const code = ts.transpileModule(readFileSync(new URL("../../app/api/booster/metrics/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedRoute = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (value: unknown) => Response.json(value) } },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => { throw new Error("Unexpected query error"); } },
    "@/lib/requireUser": { requireUser: async () => ({ supabase, user: { id: "fixture-account" }, activeUserId: "fixture-account", errorResponse: null }) },
    "@/lib/weeklyGoals": { getIsoWeekStart: () => new Date("2020-01-01"), getIsoWeekId: () => "fixture-week" },
    "@/lib/boosterPublicationPolicy": channelPolicy,
  };
  new Function("module", "exports", "require", code)(loadedRoute, loadedRoute.exports, (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  });
  const result = await (await loadedRoute.exports.GET(new Request("https://app.example/api/booster/metrics"))).json();
  assert.equal(result.publish.month, 2);
  assert.equal(result.publish.channels.site_web, 2);
  assert.equal(result.publish.channels.facebook, 1);
  assert.equal(Object.hasOwn(result.publish.channels, "inrcy_site"), false);
});
