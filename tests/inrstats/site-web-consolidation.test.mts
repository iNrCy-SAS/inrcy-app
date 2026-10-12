import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as preservation from "../../lib/stats/overviewPreservation.ts";
import { createOperationScopedLoader } from "../../lib/stats/operationScopedLoader.ts";

function loadModule<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", code)(exports, (id: string) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  });
  return exports as T;
}

const shared = loadModule<typeof import("../../lib/stats/buildOverview.shared.ts")>("lib/stats/buildOverview.shared.ts", {
  "server-only": {},
  "@/lib/stats/overviewPreservation": preservation,
});

test("an old cache cannot restore the removed site channel or change aggregate history", () => {
  const payload = shared.withoutRetiredSiteChannels({
    inrcySiteOwnership: "owned",
    sources: { site_inrcy: { connected: { ga4: true } }, site_inrcy_ga4: { metrics: { sessions: 42 } }, site_web: { connected: { gsc: true } } },
    identities: { site_inrcy: { url: "https://old.example" }, site_web: { url: "https://current.example" } },
    inrcyActivity: { site_inrcy: { publications: { total: 7 } }, site_web: { publications: { total: 9 } } },
    selected: ["site_inrcy_ga4", "site_web_gsc"],
    totals: { sessions: 42, clicks: 13 },
  });
  const sources = payload.sources as Record<string, unknown>;
  const identities = payload.identities as Record<string, unknown>;
  const activity = payload.inrcyActivity as Record<string, { publications: { total: number } }>;
  assert.equal(sources.site_inrcy, undefined);
  assert.equal(sources.site_inrcy_ga4, undefined);
  assert.equal(identities.site_inrcy, undefined);
  assert.equal(activity.site_inrcy, undefined);
  assert.equal(payload.inrcySiteOwnership, undefined);
  assert.deepEqual(payload.selected, ["site_web_gsc"]);
  assert.deepEqual(payload.totals, { sessions: 42, clicks: 13 });
  assert.equal(activity.site_web.publications.total, 9);
});

test("old site activity is counted once alongside new Site Web activity", async () => {
  const createdAt = new Date().toISOString();
  const payloads = [
    { results: { inrcy_site: { ok: true, mediaType: "photos" } } },
    { results: { site_web: { ok: true, mediaType: "text" } } },
    { results: { site_web: { ok: false }, site_inrcy: { ok: true, mediaType: "video" } } },
    { summary: { successChannels: ["site_web", "inrcy_site"] }, results: { site_web: { ok: true } } },
    { results: { site_web: { ok: false }, inrcy_site: { ok: false } } },
  ];
  const query = {
    select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; },
    async limit() { return { data: payloads.map(payload => ({ payload, created_at: createdAt })), error: null }; },
  };
  const activity = loadModule<{
    loadInrcyPublishedActivityStats(args: { supabase: unknown; userId: string }): Promise<{
      site_web: { publications: { total: number; week: number }; videos: { total: number } }; site_inrcy?: unknown;
    }>;
  }>("lib/stats/buildOverview.activity.ts", {
    "server-only": {}, "@/lib/stats/buildOverview.shared": shared,
    "@/lib/stats/operationScopedLoader": { createOperationScopedLoader },
  });
  const snapshot = await activity.loadInrcyPublishedActivityStats({ supabase: { from: () => query }, userId: "client" });
  assert.equal(snapshot.site_web.publications.total, 4);
  assert.equal(snapshot.site_web.publications.week, 4);
  assert.equal(snapshot.site_web.videos.total, 1);
  assert.equal(snapshot.site_inrcy, undefined);
});

test("Google OAuth takes its site from saved Site Web settings and rejects the removed source", async () => {
  const priorClientId = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = "test-client";
  const calls: string[] = [];
  let oauthSite: Record<string, unknown> = {};
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) },
    from(table: string) {
      calls.push(table);
      return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() {
          return { data: table === "pro_tools_configs" ? { settings: { site_web: { url: "https://couvreur-hazebrouck.fr" } } } : null, error: null };
        },
      };
    },
  };
  const route = loadModule<{ GET(request: Request): Promise<{ status: number }> }>("app/api/integrations/google-stats/start/route.ts", {
    "next/server": { NextResponse: {
      json: (value: unknown, init: ResponseInit) => Response.json(value, init),
      redirect: (url: string) => ({ url, cookies: { set() {} } }),
    } },
    "@/lib/security": {
      safeInternalPath: (value: string) => value,
      makeOAuthState: (_provider: string, _returnTo: string, extra: Record<string, unknown>) => {
        oauthSite = extra; return { stateB64: "state", cookieValue: "cookie", cookieName: "name" };
      },
    },
    "@/lib/tsSafe": { asRecord: (value: unknown) => value && typeof value === "object" ? value : {} },
    "@/lib/multicompte/server": { resolveActiveInrcyAccountId: async () => "active-account" },
    "@/lib/supabaseServer": { createSupabaseServer: async () => supabase },
  });
  try {
    const oldResponse = await route.GET(new Request("https://app.example/api/integrations/google-stats/start?source=site_inrcy&product=ga4"));
    assert.equal(oldResponse.status, 400);
    assert.equal(calls.length, 0);
    await route.GET(new Request("https://app.example/api/integrations/google-stats/start?source=site_web&product=ga4&siteUrl=https://fv-couverture.fr"));
    assert.equal(oauthSite.source, "site_web");
    assert.equal(oauthSite.domain, "couvreur-hazebrouck.fr");
    assert.equal(oauthSite.siteUrl, "https://couvreur-hazebrouck.fr/");
    assert.ok(!calls.includes("inrcy_site_configs"));
  } finally {
    if (priorClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = priorClientId;
  }
});
