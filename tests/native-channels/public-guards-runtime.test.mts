import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { resolveInrSearchMinimalStatus } from "../../lib/inrSearchMinimalStatusPolicy.ts";

type Row = Record<string, unknown>;
const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-000000000099";
const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
function load<T>(path: string, dependencies: Row, fallback?: (name: string) => unknown): T {
  const compiled = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (fallback) return fallback(name);
    assert.fail(`Unexpected dependency ${name}`);
  });
  return loaded.exports as T;
}

test("public Search rejects stale enabled=true after explicit or missing version-one consent", () => {
  for (const activationRequested of [false, undefined]) {
    const result = resolveInrSearchMinimalStatus({ accountId: ACCOUNT,
      inrSearch: { slug: "test-company", enabled: true, activationVersion: 1, activationRequested, publicationReady: true },
      eligibility: { allowed: true, reason: "published" },
    });
    assert.equal(result.published, false);
    assert.equal(result.reason, "page_disabled");
  }
  const legacy = resolveInrSearchMinimalStatus({ accountId: ACCOUNT, inrSearch: { slug: "legacy", enabled: true }, eligibility: { allowed: true, reason: "published" } });
  assert.equal(legacy.published, true);
});

function badgeGuard(options: { badgePublished?: boolean; directoryPublished?: boolean; legacy?: boolean; toolsError?: boolean }) {
  let channelReads = 0;
  const stopped = new Error("REACHED_PUBLIC_CONTENT_AFTER_GUARD");
  const notFound = new Error("NOT_FOUND");
  const profile = { user_id: ACCOUNT, company_legal_name: "Entreprise test", first_name: "Paul", last_name: "Martin", phone: "0612345678", contact_email: "contact@example.fr", hq_city: "Arras", hq_zip: "62000" };
  const db = {
    from(table: string) {
      let account = "";
      const query = {
        select: () => query,
        eq: (_key: string, value: string) => { account = value; return query; },
        order: () => query, limit: () => query,
        maybeSingle: async () => {
          assert.equal(account, ACCOUNT);
          return table === "profiles" ? { data: profile, error: null }
            : table === "pro_tools_configs" ? { data: { settings: options.legacy ? {} : { inrBadge: { activationVersion: 1, enabled: true } } }, error: options.toolsError ? new Error("config unavailable") : null }
              : { data: { sector: "[[SECTOR:artisan_btp]] Menuisier" }, error: null };
        },
        then: (resolve: (value: unknown) => void) => { assert.equal(account, ACCOUNT); return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
      return query;
    },
  };
  const page = load<{ default: (props: { params: Promise<{ slug: string }> }) => Promise<unknown> }>("app/badge/[slug]/page.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next-intl/server": { getTranslations: async () => (key: string) => key },
    "next/navigation": { notFound: () => { throw notFound; } },
    "@/lib/supabaseAdmin": { supabaseAdmin: db },
    "@/lib/inrBadge": { extractInrBadgeUserIdFromSlug: () => ACCOUNT },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async (account: string) => { assert.equal(account, ACCOUNT); return "basic"; } },
    "@/lib/inrBadgeSettings": { normalizeInrBadgeShareSettings: () => ({}) },
    "@/lib/inrBadgeEditionPolicy": { effectiveInrBadgeShareSettings: (value: unknown) => value },
    "@/lib/inrBadgeTheme": { normalizeInrBadgeThemeSettings: () => ({}), getInrBadgeThemeCssVariables: () => ({}) },
    "@/lib/inrBadgeLanguage": { normalizeInrBadgeLanguage: () => "fr", getInrBadgeTexts: () => ({}) },
    "@/lib/channelConnectionState": { getChannelConnectionStates: async (_db: unknown, account: string) => { assert.equal(account, ACCOUNT); channelReads++; return { native_channels: { inrbadge: { published: options.badgePublished === true }, inr_directory: { published: options.directoryPublished === true } } }; } },
    "@/lib/professionalBusinessIdentity": { resolveProfessionalCompanyNameFromProfile: () => { throw stopped; } },
  }, (name) => {
    // Other imports serve rendering after the tested gate, which is interrupted
    // by the explicit sentinel above. No provider or child component is invoked.
    if (name.endsWith(".png") || name.endsWith(".jpg")) return { __esModule: true, default: { src: "fixture.png" } };
    return {};
  });
  return { run: () => page.default({ params: Promise.resolve({ slug: "fixture-company" }) }), stopped, notFound, get channelReads() { return channelReads; } };
}

test("public Badge uses authoritative publication eligibility rather than the requested setting alone", async () => {
  const denied = badgeGuard({ badgePublished: false, directoryPublished: false });
  await assert.rejects(denied.run(), (error) => error === denied.notFound);
  assert.equal(denied.channelReads, 1);
  const badge = badgeGuard({ badgePublished: true });
  await assert.rejects(badge.run(), (error) => error === badge.stopped);
  const directory = badgeGuard({ badgePublished: false, directoryPublished: true });
  await assert.rejects(directory.run(), (error) => error === directory.stopped);
});

test("public Badge fails closed on config errors while preserving legacy public pages", async () => {
  const failed = badgeGuard({ toolsError: true, badgePublished: true });
  await assert.rejects(failed.run(), (error) => error === failed.notFound);
  assert.equal(failed.channelReads, 0);
  const legacy = badgeGuard({ legacy: true, badgePublished: false });
  await assert.rejects(legacy.run(), (error) => error === legacy.stopped);
});

test("public profile refresh synchronizes only the authorized active establishment and refuses a missing session", async () => {
  let authenticated = true;
  const synchronized: string[] = [];
  const scopedReads: string[] = [];
  const actorDb = { auth: { getUser: async () => ({ data: { user: authenticated ? { id: ACTOR } : null }, error: null }) } };
  const route = load<{ POST: () => Promise<Response> }>("app/api/public-profile/refresh/route.ts", {
    "next/server": { NextResponse: { json: (value: unknown, options: ResponseInit = {}) => Response.json(value, options) } },
    "@/lib/inrSearchProvisioning": { revalidateInrSearchPublicRoutes: () => undefined },
    "@/lib/multicompte/server": { resolveActiveInrcyAccountId: async (db: unknown, actor: string) => { assert.equal(db, actorDb); assert.equal(actor, ACTOR); return ACCOUNT; } },
    "@/lib/supabaseServer": { createSupabaseServer: async () => actorDb },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => { const query = { select: () => query, eq: (_key: string, account: string) => { scopedReads.push(account); return query; }, maybeSingle: async () => ({ data: { settings: { inrSearch: { slug: "active-company" } } }, error: null }) }; return query; } } },
    "@/lib/tsSafe": { asRecord: (value: unknown) => value && typeof value === "object" ? value : {} },
    "@/lib/nativeChannelActivationServer": { syncNativeChannelsForAccount: async (account: string, mutation: unknown, options: { profileSaved: boolean }) => { assert.equal(mutation, undefined); assert.equal(options.profileSaved, true); synchronized.push(account); return { states: {} }; } },
  });
  const result = await route.POST();
  assert.equal(result.status, 200);
  assert.deepEqual(synchronized, [ACCOUNT]);
  assert.deepEqual(scopedReads, [ACCOUNT]);
  authenticated = false;
  assert.equal((await route.POST()).status, 401);
  assert.deepEqual(synchronized, [ACCOUNT]);
});
