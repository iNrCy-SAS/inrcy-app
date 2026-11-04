import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { DEFAULT_INR_SEARCH_DISPLAY_SETTINGS, DEFAULT_INR_SEARCH_SECTIONS } from "../../lib/inrSearchDisplaySettings.ts";

type Row = Record<string, unknown>;
type Server = typeof import("../../lib/inrSearchPresentationServer.ts");
type Database = Parameters<Server["saveInrSearchPresentationSettings"]>[0];
const ACCOUNT = "00000000-0000-4000-8000-000000000011";
const OTHER = "00000000-0000-4000-8000-000000000012";
const server = runtimeModules()<Server>("lib/inrSearchPresentationServer.ts");
const initialSettings = () => ({
  inrSearch: { slug: "atelier-cosmos", publishedSlug: "atelier-cosmos", enabled: true, activationRequested: true, activationVersion: 1,
    display: { phone: true, email: false }, sections: { news: false }, pageTitleOverride: "Ancien titre", pageDescriptionOverride: "Ancienne description", futureOption: { keep: true } },
  inrBadge: { theme: "custom", phone: false }, inrDirectory: { enabled: false }, facebook: { pageId: "original-page" }, futureTool: { keep: true },
});

function database(initial: { settings: unknown } | null = { settings: initialSettings() }) {
  const rows = new Map<string, { settings: unknown }>([[OTHER, { settings: { inrSearch: { slug: "neighbor" }, inrBadge: { keep: true } } }]]);
  if (initial) rows.set(ACCOUNT, structuredClone(initial));
  const trace: string[] = [];
  let beforeWrite: (() => void) | undefined;
  let conflicts = false;
  let duplicateInsert = false;
  let readError: unknown = null;
  let writeError: unknown = null;
  let attempts = 0;
  let commits = 0;
  const queries: Array<{ action: string; filters: Array<[string, unknown]>; payload: Row }> = [];
  const db = { from(table: string) {
    assert.equal(table, "pro_tools_configs");
    const queryState = { action: "read", filters: [] as Array<[string, unknown]>, payload: {} as Row };
    queries.push(queryState);
    const selectedAccount = () => queryState.filters.find(([key]) => key === "user_id")?.[1];
    const execute = async () => {
      const account = String(selectedAccount() ?? queryState.payload.user_id);
      assert.equal(account, ACCOUNT, "Every read/write must be scoped to the active establishment");
      trace.push(`${queryState.action}:${account}`);
      if (queryState.action === "read") return { data: rows.has(account) ? structuredClone(rows.get(account)) : null, error: readError };
      attempts++;
      beforeWrite?.(); beforeWrite = undefined;
      if (writeError) return { data: null, error: writeError };
      if (queryState.action === "insert") {
        if (duplicateInsert || rows.has(account)) { duplicateInsert = false; return { data: null, error: { code: "23505" } }; }
      } else {
        const expected = queryState.filters.find(([key]) => key === "settings")?.[1];
        const actual = rows.get(account)?.settings;
        const actualComparable = actual == null ? null : JSON.stringify(actual);
        if (conflicts || expected !== actualComparable) return { data: [], error: null };
      }
      rows.set(account, { settings: structuredClone(queryState.payload.settings) });
      commits++;
      trace.push(`commit:${account}`);
      return { data: [{ user_id: account }], error: null };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { queryState.filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { queryState.filters.push([key, value]); return query; },
      update: (patch: Row) => { queryState.action = "update"; queryState.payload = patch; return query; },
      insert: (patch: Row) => { queryState.action = "insert"; queryState.payload = patch; return query; },
      maybeSingle: execute,
      then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => execute().then(resolve, reject),
    };
    return query;
  } };
  return { db: db as unknown as Database, trace, queries,
    get settings() { return rows.get(ACCOUNT)?.settings as Row | undefined; },
    get neighbor() { return rows.get(OTHER); }, get attempts() { return attempts; }, get commits() { return commits; },
    race(next: () => Row) { beforeWrite = () => rows.set(ACCOUNT, { settings: next() }); },
    insertRace() { duplicateInsert = true; beforeWrite = () => rows.set(ACCOUNT, { settings: { inrBadge: { theme: "concurrent" }, unknown: { preserved: true } } }); },
    conflictForever() { conflicts = true; },
    failRead(error: unknown) { readError = error; }, failWrite(error: unknown) { writeError = error; },
  };
}

test("presentation validation only accepts known boolean keys and bounded plain-text overrides", () => {
  const valid = server.validateInrSearchPresentationPatch;
  assert.equal(valid({}), true);
  assert.equal(valid({ display: {}, sections: {}, pageTitleOverride: "", pageDescriptionOverride: "" }), true);
  assert.equal(valid({ display: DEFAULT_INR_SEARCH_DISPLAY_SETTINGS, sections: DEFAULT_INR_SEARCH_SECTIONS, pageTitleOverride: "x".repeat(160), pageDescriptionOverride: "x".repeat(500) }), true);
  for (const field of ["display", "sections"]) {
    for (const value of [null, false, 1, "false", []]) assert.equal(valid({ [field]: value }), false);
    for (const value of [null, 0, 1, "true", [], {}]) assert.equal(valid({ [field]: { [field === "display" ? "phone" : "news"]: value } }), false);
    for (const unknown of ["unknown", "constructor", "__proto__"]) assert.equal(valid({ [field]: JSON.parse(`{"${unknown}":true}`) }), false);
  }
  for (const [field, limit] of [["pageTitleOverride", 160], ["pageDescriptionOverride", 500]] as const) {
    assert.equal(valid({ [field]: "x".repeat(limit + 1) }), false);
    for (const value of [null, false, 10, [], {}]) assert.equal(valid({ [field]: value }), false);
  }
});

test("saving presentation preserves badge, unknown siblings, slug, activation and previous opt-outs", async () => {
  const h = database();
  const before = structuredClone(initialSettings());
  const neighbor = structuredClone(h.neighbor);
  const saved = await server.saveInrSearchPresentationSettings(h.db, ACCOUNT, { display: { phone: false }, sections: { media: false }, pageTitleOverride: "  Nouveau titre  ", slug: "untrusted-new-slug", inrBadge: {} });
  assert.equal(h.attempts, 1); assert.equal(h.commits, 1);
  for (const key of ["inrBadge", "inrDirectory", "facebook", "futureTool"]) assert.deepEqual(h.settings![key], before[key as keyof typeof before]);
  assert.equal(saved.slug, before.inrSearch.slug);
  assert.equal(saved.publishedSlug, before.inrSearch.publishedSlug);
  assert.equal(saved.enabled, true); assert.equal(saved.activationRequested, true); assert.equal(saved.activationVersion, 1);
  assert.deepEqual(saved.futureOption, { keep: true });
  assert.deepEqual(saved.display, { ...DEFAULT_INR_SEARCH_DISPLAY_SETTINGS, phone: false, email: false });
  assert.deepEqual(saved.sections, { ...DEFAULT_INR_SEARCH_SECTIONS, news: false, media: false });
  assert.equal(saved.pageTitleOverride, "Nouveau titre");
  assert.equal(saved.pageDescriptionOverride, "Ancienne description");
  assert.deepEqual(h.neighbor, neighbor);
  const reset = await server.saveInrSearchPresentationSettings(h.db, ACCOUNT, { pageTitleOverride: "", pageDescriptionOverride: "  " });
  assert.equal(reset.pageTitleOverride, ""); assert.equal(reset.pageDescriptionOverride, "");
});

test("CAS retries merge concurrent sibling and presentation changes without restoring old activation", async () => {
  const h = database();
  h.race(() => ({ ...initialSettings(), instagram: { account: "concurrent" },
    inrBadge: { theme: "concurrent" }, inrSearch: { ...initialSettings().inrSearch, enabled: false, activationRequested: false, display: { email: true, website: false }, sections: { news: false, faq: false } } }));
  const saved = await server.saveInrSearchPresentationSettings(h.db, ACCOUNT, { display: { phone: false }, sections: { media: false } });
  assert.equal(h.attempts, 2); assert.equal(h.commits, 1);
  assert.deepEqual(h.settings!.instagram, { account: "concurrent" });
  assert.deepEqual(h.settings!.inrBadge, { theme: "concurrent" });
  assert.equal(saved.enabled, false); assert.equal(saved.activationRequested, false);
  assert.deepEqual(saved.display, { ...DEFAULT_INR_SEARCH_DISPLAY_SETTINGS, email: true, website: false, phone: false });
  assert.deepEqual(saved.sections, { ...DEFAULT_INR_SEARCH_SECTIONS, news: false, faq: false, media: false });
});

test("a nullable settings column uses IS NULL while a missing row inserts without an upsert", async () => {
  for (const initial of [{ settings: null }, null]) {
    const h = database(initial);
    const saved = await server.saveInrSearchPresentationSettings(h.db, ACCOUNT, { display: { address: false } });
    assert.equal(h.commits, 1); assert.equal((saved.display as Row).address, false);
    const write = h.queries.find(query => query.action !== "read")!;
    assert.equal(write.action, initial ? "update" : "insert");
    if (initial) assert.deepEqual(write.filters, [["user_id", ACCOUNT], ["settings", null]]);
    else assert.equal(write.payload.user_id, ACCOUNT);
  }
});

test("a row created concurrently retries duplicate insert and preserves the winning row", async () => {
  const h = database(null); h.insertRace();
  const saved = await server.saveInrSearchPresentationSettings(h.db, ACCOUNT, { display: { phone: false } });
  assert.equal(h.attempts, 2); assert.equal(h.commits, 1);
  assert.deepEqual(h.settings!.inrBadge, { theme: "concurrent" });
  assert.deepEqual(h.settings!.unknown, { preserved: true });
  assert.equal((saved.display as Row).phone, false);
});

test("persistent conflicts stop after four attempts and database errors never report a successful write", async () => {
  const conflicting = database(); conflicting.conflictForever();
  await assert.rejects(server.saveInrSearchPresentationSettings(conflicting.db, ACCOUNT, { display: { phone: false } }), /modifié/);
  assert.equal(conflicting.attempts, 4); assert.equal(conflicting.commits, 0);
  for (const stage of ["read", "write"] as const) {
    const h = database(); const error = new Error(`${stage} unavailable`);
    if (stage === "read") h.failRead(error); else h.failWrite(error);
    await assert.rejects(server.saveInrSearchPresentationSettings(h.db, ACCOUNT, {}), caught => caught === error);
    assert.equal(h.commits, 0);
  }
});

function routeFixture() {
  const h = database();
  let authenticated = true;
  const invalidations: Array<[string, boolean]> = [];
  const cacheClears: string[] = [];
  const provisionedAccounts: string[] = [];
  const route = runtimeModules({
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/requireUser": { requireUser: async () => {
      h.trace.push("auth");
      return authenticated ? { supabase: h.db, activeUserId: ACCOUNT, errorResponse: null }
        : { errorResponse: Response.json({ ok: false }, { status: 401 }) };
    } },
    "@/lib/inrDirectorySettings": { isInrDirectoryEnabled: () => false },
    "@/app/api/inr-directory/settings/route": { POST: () => { throw Error("Presentation must never mutate directory consent"); } },
    "@/lib/nativeChannelActivationServer": { syncNativeChannelsForAccount: () => { throw Error("Presentation must never activate or deactivate a native channel"); } },
    "@/lib/inrSearchMinimalStatus": { getInrSearchMinimalPublicStatus: async ({ accountId }: { accountId: string }) => { assert.equal(accountId, ACCOUNT); return { published: true, reason: "published" }; } },
    "@/lib/inrSearchProvisioning": {
      ensureSystemManagedInrSearch: async (db: unknown, accountId: string) => {
        assert.equal(db, h.db); assert.equal(accountId, ACCOUNT); provisionedAccounts.push(accountId); h.trace.push("provision");
        return { changed: false, root: h.settings, inrSearch: h.settings!.inrSearch };
      },
      revalidateInrSearchPublicRoutes: (slug: string, directory: boolean) => { h.trace.push("revalidate"); invalidations.push([slug, directory]); },
    },
    "@/lib/statsCache": { clearAllToolCaches: async (db: unknown, account: string) => { assert.equal(db, h.db); cacheClears.push(account); h.trace.push("cache"); } },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback },
  })<{ GET: () => Promise<Response>; POST: (request: Request) => Promise<Response> }>("app/api/inr-search/settings/route.ts");
  return Object.assign(h, { route, invalidations, cacheClears, provisionedAccounts, unauthenticate() { authenticated = false; } });
}
const request = (body: unknown) => new Request("https://app.inrcy.test/api/inr-search/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("presentation endpoints require a session and reject stale or missing account IDs before reads and mutations", async () => {
  for (const accountId of [OTHER, undefined, null]) {
    const h = routeFixture();
    const result = await h.route.POST(request({ action: "presentation", accountId, display: { phone: false } }));
    assert.equal(result.status, 409); assert.equal(h.attempts, 0); assert.equal(h.queries.length, 0);
    assert.deepEqual(h.invalidations, []); assert.deepEqual(h.cacheClears, []); assert.deepEqual(h.provisionedAccounts, []);
  }
  const h = routeFixture(); h.unauthenticate();
  assert.equal((await h.route.GET()).status, 401);
  assert.equal((await h.route.POST(request({ action: "presentation", accountId: ACCOUNT, display: { phone: false } }))).status, 401);
  assert.deepEqual(h.queries, []); assert.deepEqual(h.invalidations, []); assert.deepEqual(h.cacheClears, []);
});

test("invalid presentation patches are rejected before writing and valid saves revalidate public routes immediately", async () => {
  for (const patch of [{ display: { phone: "false" } }, { sections: { secret: false } }, { pageTitleOverride: "x".repeat(161) }]) {
    const h = routeFixture(); const result = await h.route.POST(request({ action: "presentation", accountId: ACCOUNT, ...patch }));
    assert.equal(result.status, 400); assert.equal(h.queries.length, 0); assert.deepEqual(h.invalidations, []);
  }
  const h = routeFixture();
  const result = await h.route.POST(request({ action: "presentation", accountId: ACCOUNT, display: { phone: false }, sections: { media: false }, pageTitleOverride: "Titre visible" }));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.ok, true); assert.equal(body.accountId, ACCOUNT);
  assert.equal(body.inrSearch.display.phone, false); assert.equal(body.inrSearch.sections.media, false); assert.equal(body.inrSearch.pageTitleOverride, "Titre visible");
  assert.match(result.headers.get("cache-control") || "", /no-store/);
  assert.deepEqual(h.invalidations, [["atelier-cosmos", true]]);
  assert.deepEqual(h.cacheClears, [ACCOUNT]); assert.deepEqual(h.provisionedAccounts, [ACCOUNT]);
  assert.ok(h.trace.indexOf(`commit:${ACCOUNT}`) < h.trace.indexOf("revalidate"));
  assert.ok(h.trace.indexOf("revalidate") < h.trace.indexOf("provision"));
  assert.deepEqual(h.neighbor, { settings: { inrSearch: { slug: "neighbor" }, inrBadge: { keep: true } } });
});

test("null, array and malformed JSON requests return a controlled error without provisioning or writes", async () => {
  for (const body of [null, [], "wrong-shape"]) {
    const h = routeFixture();
    const result = await h.route.POST(request(body));
    assert.equal(result.status, 400);
    assert.deepEqual(h.queries, []); assert.deepEqual(h.provisionedAccounts, []); assert.deepEqual(h.invalidations, []);
  }
  const h = routeFixture();
  const result = await h.route.POST(new Request("https://app.inrcy.test/api/inr-search/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{invalid-json" }));
  assert.equal(result.status, 400);
  assert.deepEqual(h.queries, []); assert.deepEqual(h.provisionedAccounts, []); assert.deepEqual(h.invalidations, []);
});

test("a failed CAS save returns an error without invalidating public caches or changing another account", async () => {
  const h = routeFixture(); h.conflictForever();
  const result = await h.route.POST(request({ action: "presentation", accountId: ACCOUNT, display: { phone: false } }));
  assert.equal(result.status, 400); assert.equal(h.attempts, 4); assert.equal(h.commits, 0);
  assert.deepEqual(h.invalidations, []); assert.deepEqual(h.cacheClears, []); assert.deepEqual(h.provisionedAccounts, []);
});
