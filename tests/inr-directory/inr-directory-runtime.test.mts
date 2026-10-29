import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(join(process.cwd(), "package.json"));
const ts = require("typescript") as typeof import("typescript");
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

type SettingsModule = typeof import("../../lib/inrDirectorySettings");
type CatalogModule = typeof import("../../lib/inrDirectoryCatalog");
type SettingsRoute = typeof import("../../app/api/inr-directory/settings/route");
type QueryModule = typeof import("../../lib/inrDirectoryQuery");
type PublicModule = typeof import("../../lib/inrDirectoryPublic");
type EligibilityModule = typeof import("../../lib/inrSearchEligibility");
type QrRoute = typeof import("../../app/api/public/directory/qr/[slug]/route");
type LoadedModule = { exports: Record<string, unknown> };

/** Execute actual source with in-memory service boundaries; never use live credentials. */
function load<T = Record<string, unknown>>(relative: string, overrides: Record<string, unknown> = {}, modules = new Map<string, LoadedModule>()): T {
  const candidate = resolve(sourceRoot, relative);
  const filename = existsSync(candidate) ? candidate : resolve(process.cwd(), relative);
  if (modules.has(filename)) return modules.get(filename)!.exports as T;
  const loaded: LoadedModule = { exports: {} }; modules.set(filename, loaded);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const localRequire = (name: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name];
    if (name === "server-only") return {};
    if (name === "react") return { cache: (fn: unknown) => fn };
    if (name.startsWith("@/")) return load(`${name.slice(2).replace(/\.ts$/, "")}.ts`, overrides, modules);
    if (name.startsWith(".")) return load(`${resolve(dirname(relative), name).replace(/\.ts$/, "")}.ts`, overrides, modules);
    return require(name);
  };
  new Function("require", "module", "exports", code)(localRequire, loaded, loaded.exports);
  return loaded.exports as T;
}

const { isInrDirectoryEnabled } = load<SettingsModule>("lib/inrDirectorySettings.ts");
const catalog = load<CatalogModule>("lib/inrDirectoryCatalog.ts");

test("directory consent preserves legacy inclusion and explicit exclusion, independently of Search", () => {
  assert.equal(isInrDirectoryEnabled({}), false);
  assert.equal(isInrDirectoryEnabled({ inrSearch: { enabled: true, slug: "a" } }), true);
  assert.equal(isInrDirectoryEnabled({ inrSearch: { enabled: true, slug: "a", directoryEnabled: false } }), false);
  assert.equal(isInrDirectoryEnabled({ inrDirectory: { enabled: true }, inrSearch: { enabled: false } }), true);
  assert.equal(isInrDirectoryEnabled({ inrDirectory: { enabled: false }, inrSearch: { enabled: true, slug: "a", directoryEnabled: true } }), false);
  assert.equal(isInrDirectoryEnabled({ inrDirectory: { enabled: "true" }, inrSearch: { enabled: false } }), false);
});

test("profession labels use the app catalog and approved aliases while retaining custom specialties", () => {
  assert.equal(catalog.resolveDirectoryProfession("[[SECTOR:artisan_btp]] Maçon").profession, "Maçon");
  assert.equal(catalog.resolveDirectoryProfession("[[SECTOR:immobilier]] Conseiller immobilier").profession, "Mandataire immobilier");
  assert.equal(catalog.resolveDirectoryProfession("Médium").sectorCategory, "voyance_arts_divinatoires");
  const custom = catalog.resolveDirectoryProfession("Créatrice sur bois");
  assert.equal(custom.profession, "Créatrice sur bois");
  assert.equal(custom.professionSlug, "autre-metier");
  assert.equal(custom.catalogMatch, false);
  assert.equal(catalog.resolveDirectoryProfession("constructor").catalogMatch, false);
  const facets = catalog.getDirectoryProfessionFacets([{ professionSlug: "macon" }, { professionSlug: "macon" }, { professionSlug: "autre-metier" }]);
  assert.equal(facets.find(entry => entry.slug === "macon")?.count, 2);
  assert.equal(facets.find(entry => entry.slug === "autre-metier")?.count, 1);
  assert.ok(facets.some(entry => entry.slug === "plombier" && entry.count === 0));
  assert.equal(new Set(facets.map(entry => entry.slug)).size, facets.length);
});

const accountId = "11111111-1111-4111-8111-111111111111";

type ToolSettings = Record<string, Record<string, unknown>>;
type ConfigRow = { settings: ToolSettings };
type ProfileRow = { company_legal_name: string; hq_city: string; hq_zip?: string; first_name?: string; last_name?: string };
type WritePayload = ConfigRow & { user_id?: string };
type FixtureOptions = { missingConfig?: boolean; settings?: ToolSettings; profile?: ProfileRow; allowed?: boolean; unauthorized?: boolean; concurrent?: boolean };
type SettingsResult = { data: ConfigRow | ProfileRow | { sector: string } | { user_id: string }[] | null; error: { code: string } | null };
type SettingsQuery = PromiseLike<SettingsResult> & {
  select(columns?: string): SettingsQuery;
  eq(key: string, value: unknown): SettingsQuery;
  is(key: string, value: unknown): SettingsQuery;
  order(): SettingsQuery;
  limit(): SettingsQuery;
  maybeSingle(): Promise<SettingsResult>;
  update(value: ConfigRow): SettingsQuery;
  insert(value: WritePayload & { user_id: string }): SettingsQuery;
};

function queryThen<T>(read: () => T): PromiseLike<T>["then"] {
  return (yes, no) => Promise.resolve(read()).then(yes, no);
}

function settingsFixture(options: FixtureOptions = {}) {
  const state: {
    config: ConfigRow | null; profile: ProfileRow; business: { sector: string }; allowed: boolean;
    writes: WritePayload[]; queries: { table: string; target: string; mode: string }[]; purges: unknown[]; concurrent: boolean;
  } = {
    config: options.missingConfig ? null : { settings: options.settings || { site_web: { url: "https://example.test" }, inrSearch: { enabled: false }, inrDirectory: { enabled: false, preference: "keep" } } },
    profile: options.profile || { company_legal_name: "Atelier Bleu", first_name: "Jean", last_name: "Test", hq_city: "Arras", hq_zip: "62000" },
    business: { sector: "[[SECTOR:artisan_btp]] Maçon" }, allowed: options.allowed ?? true,
    writes: [], queries: [], purges: [], concurrent: options.concurrent ?? false,
  };
  const supabase = { from(table: string) {
    let mode = "read", payload: WritePayload = { settings: {} }, compared: unknown, target = "", checkNull = false;
    const run = (): SettingsResult => {
      state.queries.push({ table, target, mode });
      assert.equal(target || accountId, accountId, "every query and mutation stays in the authenticated active account");
      if (mode === "update") {
        if (state.concurrent) {
          state.concurrent = false;
          state.config!.settings = { ...state.config!.settings, site_web: { url: "https://new.example.test" }, otherChannel: { connected: true } };
        }
        if (!state.config || (checkNull ? state.config.settings !== null : JSON.stringify(state.config.settings) !== compared)) return { data: [], error: null };
        state.config = structuredClone(payload); state.writes.push({ user_id: target, ...structuredClone(payload) });
        return { data: [{ user_id: target }], error: null };
      }
      if (mode === "insert") {
        if (state.config) return { data: null, error: { code: "23505" } };
        state.config = { settings: structuredClone(payload.settings) }; state.writes.push(structuredClone(payload));
        return { data: null, error: null };
      }
      const data = table === "pro_tools_configs" ? state.config : table === "profiles" ? state.profile : table === "business_profiles" ? state.business : null;
      return { data: structuredClone(data), error: null };
    };
    const query: SettingsQuery = {
      select() { return query; }, eq(key: string, value: unknown) { if (key === "user_id") target = String(value); if (key === "settings") compared = value; return query; },
      is(key: string, value: unknown) { if (key === "settings" && value === null) checkNull = true; return query; },
      order() { return query; }, limit() { return query; }, maybeSingle() { return Promise.resolve(run()); },
      update(value: ConfigRow) { mode = "update"; payload = value; return query; },
      insert(value: WritePayload & { user_id: string }) { mode = "insert"; payload = value; target = value.user_id; return query; },
      then: queryThen(run),
    }; return query;
  } };
  const api = load<SettingsRoute>("app/api/inr-directory/settings/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "next/cache": { revalidatePath() {} },
    "@/lib/requireUser": { requireUser: async () => ({ supabase, activeUserId: accountId, errorResponse: options.unauthorized ? Response.json({ ok: false }, { status: 401 }) : null }) },
    "@/lib/inrSearchEligibility": { getInrDirectoryPublicationEligibility: async () => ({ allowed: state.allowed }) },
    "@/lib/inrSearchDirectoryCache": { purgeInrSearchDirectoryCache: async (value: unknown) => { state.purges.push(value); } },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback },
  });
  const post = (enabled: unknown, extra = {}) => api.POST(new Request("http://localhost/api/inr-directory/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, accountId, ...extra }) }));
  return { state, api, post };
}

test("settings GET is read-only and enabling does not publish Search or overwrite other tool settings", async () => {
  const fixture = settingsFixture();
  const get = await fixture.api.GET();
  assert.equal(get.status, 200); assert.equal(fixture.state.writes.length, 0);
  const response = await fixture.post(true); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.visible, true); assert.equal(body.accountId, accountId);
  assert.equal(fixture.state.config!.settings.inrSearch.enabled, false);
  assert.deepEqual(fixture.state.config!.settings.site_web, { url: "https://example.test" });
  assert.equal(fixture.state.config!.settings.inrDirectory.preference, "keep");
  assert.equal(fixture.state.purges.length, 0, "development does not invalidate the production website");
  assert.match(body.badgeUrl, /\/badge\/atelier-bleu-jean-test-11111111111141118111111111111111$/);
});

test("a concurrent channel save survives the directory toggle", async () => {
  const fixture = settingsFixture({ concurrent: true });
  assert.equal((await fixture.post(true)).status, 200);
  assert.deepEqual(fixture.state.config!.settings.site_web, { url: "https://new.example.test" });
  assert.deepEqual(fixture.state.config!.settings.otherChannel, { connected: true });
  assert.equal(fixture.state.config!.settings.inrDirectory.enabled, true);
  assert.equal(fixture.state.writes.length, 1);
});

test("missing config is inserted within the same active account", async () => {
  const fixture = settingsFixture({ missingConfig: true });
  assert.equal((await fixture.post(true)).status, 200);
  assert.equal(fixture.state.writes[0].user_id, accountId);
  assert.equal(fixture.state.config!.settings.inrDirectory.enabled, true);
});

test("invalid payloads and stale active-account hints never mutate a different account", async () => {
  const fixture = settingsFixture();
  assert.equal((await fixture.post("true")).status, 400);
  assert.equal((await fixture.post(true, { accountId: "another-account" })).status, 409);
  assert.equal(fixture.state.writes.length, 0);
});

test("incomplete ADN records activation pending publication; unavailable access prevents activation but permits withdrawal", async () => {
  const unavailable = settingsFixture({ allowed: false, settings: { inrDirectory: { enabled: true } } });
  assert.equal((await unavailable.post(true)).status, 400);
  assert.equal((await unavailable.post(false)).status, 200);
  assert.equal(unavailable.state.config!.settings.inrDirectory.enabled, false);
  const incomplete = settingsFixture({ profile: { company_legal_name: "Atelier Bleu", hq_city: "" } });
  const pending = await incomplete.post(true);
  assert.equal(pending.status, 200);
  const pendingBody = await pending.json();
  assert.equal(pendingBody.enabled, true);
  assert.equal(pendingBody.visible, false);
  assert.equal(pendingBody.pending, true);
  assert.equal(pendingBody.badgeUrl, "");
  assert.deepEqual(pendingBody.missingFields, ["city", "postalCode"]);
  incomplete.state.profile.hq_city = "Arras";
  incomplete.state.profile.hq_zip = "62000";
  const completed = await (await incomplete.api.GET()).json();
  assert.equal(completed.visible, true, "ADN completion publishes without a second activation");
});

test("unauthenticated settings calls never read or write account data", async () => {
  const fixture = settingsFixture({ unauthorized: true });
  assert.equal((await fixture.post(true)).status, 401);
  assert.equal(fixture.state.queries.length, 0);
  assert.equal(fixture.state.writes.length, 0);
});

test("public directory filters, canonical profession facets and pagination all use the same companies", async () => {
  const company = (name: string, city: string, professionSlug: string) => ({ companyName: name, profession: professionSlug === "macon" ? "Maçon" : "Plombier", professionSlug, sectorLabel: "BTP", sectorSlug: "btp", city, citySlug: catalog.directorySlug(city), department: "Pas-de-Calais", departmentSlug: "pas-de-calais", region: "Hauts-de-France", regionSlug: "hauts-de-france", slug: `${name.toLowerCase()}-${accountId.replaceAll("-", "")}`, url: "https://app.inrcy.com/badge/source", qrUrl: "https://app.inrcy.com/api/public/directory/qr/source", updatedAt: "2026-10-28T09:00:00Z" });
  const companies = [company("Alpha", "Arras", "macon"), company("Beta", "Lens", "plombier"), company("Gamma", "Arras", "macon")];
  const api = load<QueryModule>("lib/inrDirectoryQuery.ts", { "@/lib/inrDirectoryPublic": { listInrDirectoryCompanies: async () => companies } });
  const result = await api.getInrDirectoryResult(new URLSearchParams("metier=Maçon&ville=Arras&pageSize=1&page=2"), "http://localhost:3000");
  assert.equal(result.total, 2); assert.equal(result.page, 2); assert.equal(result.hasNext, false);
  assert.equal(result.items[0].companyName, "Gamma"); assert.match(result.items[0].url, /^http:\/\/localhost:3000\/badge\//);
  assert.match(result.items[0].qrUrl, /\/api\/public\/directory\/qr\//);
  assert.equal(result.facets.professions.find(entry => entry.slug === "macon")?.count, 2);
  const empty = await api.getInrDirectoryResult(new URLSearchParams("q=introuvable"));
  assert.equal(empty.total, 0); assert.deepEqual(empty.items, []);
});

test("directory QR targets the same badge and preserves the QR analytics marker", () => {
  const publicApi = load<PublicModule>("lib/inrDirectoryPublic.ts", { "@/lib/supabaseAdmin": { supabaseAdmin: {} }, "@/lib/inrSearchEligibility": { filterEligibleInrDirectoryAccountIds: async () => new Set() } });
  const target = publicApi.directoryBadgeQrTarget(`atelier-${accountId.replaceAll("-", "")}`, "http://localhost:3000");
  assert.match(target, /^http:\/\/localhost:3000\/badge\/atelier-/);
  assert.equal(new URL(target).searchParams.get("src"), "qr");
});

type TableRow = Record<string, unknown>;
type TableResult = { data: TableRow[]; error: unknown };
type TableQuery = PromiseLike<TableResult> & {
  select(): TableQuery; order(): TableQuery;
  in(key: string, values: unknown[]): TableQuery;
  eq(key: string, value: unknown): TableQuery;
  range(first: number, last: number): TableQuery;
};

function tableClient(tables: Record<string, TableRow[]>, failures: Record<string, unknown> = {}) {
  return { from(table: string) {
    const filters: Array<(row: TableRow) => boolean> = [];
    let start = 0, end = Number.POSITIVE_INFINITY;
    const query: TableQuery = {
      select() { return query; }, order() { return query; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
      range(first: number, last: number) { start = first; end = last; return query; },
      then: queryThen(() => ({ data: (tables[table] || []).filter(row => filters.every(filter => filter(row))).slice(start, end + 1), error: failures[table] || null })),
    }; return query;
  } };
}

test("directory access checks its own channel, badge access and the subscription of the account owner", async () => {
  const ownerId = "22222222-2222-4222-8222-222222222222";
  const tables = {
    app_bubble_access: [{ user_id: accountId, bubble_key: "inr_search", enabled: false }, { user_id: accountId, bubble_key: "inr_directory", enabled: true }, { user_id: accountId, bubble_key: "inrbadge", enabled: true }],
    inrcy_account_members: [{ account_id: accountId, auth_user_id: ownerId, is_default: true }],
    subscriptions: [{ user_id: ownerId, status: "active" }], profiles: [{ user_id: ownerId, role: "user" }],
  };
  const eligibility = load<EligibilityModule>("lib/inrSearchEligibility.ts", { "@/lib/supabaseAdmin": { supabaseAdmin: tableClient(tables) } });
  assert.equal((await eligibility.getInrDirectoryPublicationEligibility(accountId)).allowed, true);
  assert.equal((await eligibility.getInrSearchPublicationEligibility(accountId)).allowed, false, "Search can be disabled while the directory remains available");
  tables.app_bubble_access.find(row => row.bubble_key === "inrbadge")!.enabled = false;
  assert.equal((await eligibility.getInrDirectoryPublicationEligibility(accountId)).allowed, false);
  tables.app_bubble_access.find(row => row.bubble_key === "inrbadge")!.enabled = true;
  tables.subscriptions[0].status = "canceled";
  assert.equal((await eligibility.getInrDirectoryPublicationEligibility(accountId)).reason, "subscription_inactive");
  tables.profiles[0].role = "admin";
  assert.equal((await eligibility.getInrDirectoryPublicationEligibility(accountId)).allowed, true);
  tables.app_bubble_access.find(row => row.bubble_key === "inr_directory")!.enabled = false;
  assert.equal((await eligibility.getInrDirectoryPublicationEligibility(accountId)).allowed, false, "admin status does not undo an explicit channel exclusion");
});

test("an eligibility lookup failure fails closed", async () => {
  const eligibility = load<EligibilityModule>("lib/inrSearchEligibility.ts", { "@/lib/supabaseAdmin": { supabaseAdmin: tableClient({}, { app_bubble_access: new Error("Unavailable") }) } });
  await assert.rejects(() => eligibility.getInrDirectoryPublicationEligibility(accountId), /Unavailable/);
});

test("the public listing contains only opted-in eligible complete profiles and never exposes private data", async () => {
  const otherId = "22222222-2222-4222-8222-222222222222";
  const excludedId = "33333333-3333-4333-8333-333333333333";
  const incompleteId = "44444444-4444-4444-8444-444444444444";
  const tables = {
    pro_tools_configs: [
      { user_id: accountId, settings: { inrDirectory: { enabled: true }, inrSearch: { enabled: false }, privateToken: "never-public" } },
      { user_id: otherId, settings: { inrDirectory: { enabled: true } } },
      { user_id: excludedId, settings: { inrDirectory: { enabled: false }, inrSearch: { enabled: true, slug: "old" } } },
      { user_id: incompleteId, settings: { inrDirectory: { enabled: true } } },
    ],
    profiles: [accountId, otherId, excludedId, incompleteId].map(id => ({ user_id: id, company_legal_name: "Atelier Bleu", first_name: "Jean", last_name: "Test", hq_city: id === incompleteId ? "" : "Arras", hq_zip: "62000", contact_email: "private@example.test", phone: "private-phone", admin_email: "private-admin@example.test" })),
    business_profiles: [accountId, otherId, excludedId, incompleteId].map(id => ({ user_id: id, sector: "[[SECTOR:artisan_btp]] Maçon" })),
  };
  let checked: string[] = [];
  const listing = load<PublicModule>("lib/inrDirectoryPublic.ts", {
    "@/lib/supabaseAdmin": { supabaseAdmin: tableClient(tables) },
    "@/lib/inrSearchEligibility": { filterEligibleInrDirectoryAccountIds: async (ids: string[]) => { checked = ids; return new Set([accountId, incompleteId]); } },
  });
  const items = await listing.listInrDirectoryCompanies();
  assert.equal(items.length, 1);
  assert.ok(!checked.includes(excludedId));
  assert.match(items[0].url, /\/badge\//); assert.doesNotMatch(items[0].url, /\/entreprises\//);
  assert.equal(items[0].profession, "Maçon");
  assert.doesNotMatch(JSON.stringify(items), /private|never-public|contact_email|admin_email|phone|user_id/);
});

test("the QR endpoint rejects invalid slugs and returns a first-party SVG with a quiet zone", async () => {
  const qr = load<QrRoute>("app/api/public/directory/qr/[slug]/route.ts", {
    "@/lib/inrDirectoryPublic": { directoryBadgeQrTarget: (slug: string, origin: string | undefined) => `${origin || "https://app.inrcy.com"}/badge/${slug}?src=qr` },
  });
  const request = { nextUrl: new URL("http://localhost:3000/api/public/directory/qr/example") } as Parameters<QrRoute["GET"]>[0];
  assert.equal((await qr.GET(request, { params: Promise.resolve({ slug: "<script>alert(1)</script>" }) })).status, 404);
  const response = await qr.GET(request, { params: Promise.resolve({ slug: `atelier-${accountId.replaceAll("-", "")}` }) });
  assert.equal(response.status, 200); assert.match(response.headers.get("Content-Type") || "", /image\/svg\+xml/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), "cross-origin", "the WordPress directory can embed its public QR image from another origin");
  const svg = await response.text();
  assert.match(svg, /fill="#fff"/); assert.match(svg, /M4,/); assert.doesNotMatch(svg, /<script|https?:.*href|foreignObject/);
});
