import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { ADS_PUBLIC_CHANNELS } from "../../lib/adsAccessPolicy.ts";

type QueryCall = { operation: string; args: unknown[] };
type DatabaseResult = { data: Record<string, unknown>[] | null; count: number | null; error: { message: string } | null };
type RouteOptions = {
  count?: number | null;
  error?: boolean;
  admin?: boolean;
  denied?: 401 | 403 | 503;
  activeUserId?: string;
  campaigns?: Record<string, unknown>[];
};

const output = ts.transpileModule(readFileSync(
  new URL("../../app/api/ads/campaigns/route.ts", import.meta.url), "utf8",
), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function runtime(options: RouteOptions = {}) {
  const calls: QueryCall[] = [];
  const formatted: unknown[] = [];
  const checkedAccounts: unknown[][] = [];
  const activeUserId = options.activeUserId || "establishment-owner";
  const authUserId = "authenticated-member";
  const result: DatabaseResult = {
    data: options.campaigns ?? null,
    count: options.count === undefined ? 12 : options.count,
    error: options.error ? { message: "database unavailable" } : null,
  };
  const query: Record<string, unknown> = {};
  for (const operation of ["select", "eq", "in", "order", "range"]) {
    query[operation] = (...args: unknown[]) => { calls.push({ operation, args }); return query; };
  }
  query.then = (resolve: (value: DatabaseResult) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/adsServer": {
      requirePremiumAdsUser: async () => options.denied
        ? { user: null, errorResponse: Response.json({ error: "Access denied" }, { status: options.denied }) }
        : { user: { authUserId, activeUserId }, errorResponse: null },
      isAdsPilotAdmin: async (...ids: unknown[]) => { checkedAccounts.push(ids); return options.admin === true; },
      adsRequestOriginAllowed: () => assert.fail("Count GET must not mutate campaigns"),
      adsBadOriginResponse: () => assert.fail("Count GET must not mutate campaigns"),
      isAdsChannelUserAllowed: () => assert.fail("Count GET must not mutate campaigns"),
      adsPilotOnlyResponse: () => assert.fail("Count GET must not mutate campaigns"),
    },
    "@/lib/supabaseAdmin": { supabaseAdmin: {
      from: (table: string) => { calls.push({ operation: "from", args: [table] }); return query; },
      rpc: () => assert.fail("Count GET must not mutate campaigns"),
    } },
    "@/lib/adsAccessPolicy": { ADS_PUBLIC_CHANNELS },
    "@/lib/adsValidation": {
      normalizeStoredAdsCampaignDraft: (draft: unknown) => { formatted.push(draft); return draft; },
    },
    "@/lib/adsProviderResources": { publicAdsProviderResources: (resources: unknown) => { formatted.push(resources); return resources; } },
    "@/lib/rateLimit": {},
    "./[id]/trackingPolicy": {},
  };
  const record: { exports: { GET?: (request: Request) => Promise<Response> } } = { exports: {} };
  new Function("module", "exports", "require", output)(record, record.exports, (specifier: string) => {
    assert.ok(Object.hasOwn(modules, specifier), `Unexpected route dependency: ${specifier}`);
    return modules[specifier];
  });
  assert.equal(typeof record.exports.GET, "function");
  return {
    calls, formatted, checkedAccounts, activeUserId, authUserId,
    get: (queryString = "countsOnly=1") => record.exports.GET!(new Request(`https://app.test/api/ads/campaigns?${queryString}`)),
  };
}

function assertCountQuery(route: ReturnType<typeof runtime>) {
  assert.deepEqual(route.calls.find((call) => call.operation === "from")?.args, ["ads_campaigns"]);
  const selected = route.calls.find((call) => call.operation === "select");
  assert.equal(typeof selected?.args[0], "string");
  assert.deepEqual(selected?.args[1], { count: "exact", head: true });
  assert.deepEqual(route.calls.filter((call) => call.operation === "eq"), [
    { operation: "eq", args: ["user_id", route.activeUserId] },
  ]);
  assert.deepEqual(route.calls.filter((call) => ["order", "range"].includes(call.operation)), []);
  assert.deepEqual(route.formatted, [], "Count-only responses must not load or format campaign details");
}

for (const total of [0, 137]) {
  test(`le compteur ADS renvoie le total exact ${total} sans charger les campagnes`, async () => {
    const route = runtime({ count: total });
    const response = await route.get();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { total });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assertCountQuery(route);
    assert.deepEqual(route.calls.filter((call) => call.operation === "in"), [
      { operation: "in", args: ["provider", [...ADS_PUBLIC_CHANNELS]] },
    ]);
  });
}

test("le compteur ADS reste borné à l’établissement actif, même pour un membre ou un identifiant forgé", async () => {
  for (const activeUserId of ["establishment-A", "establishment-B"]) {
    const route = runtime({ activeUserId, count: 7 });
    const response = await route.get(`countsOnly=1&userId=${route.authUserId}&accountId=another-account`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { total: 7 });
    assertCountQuery(route);
    assert.deepEqual(route.checkedAccounts, [[route.authUserId, activeUserId]]);
  }
});

test("un compte pilote compte ses canaux autorisés sans perdre le filtre d’établissement", async () => {
  const route = runtime({ admin: true, count: 21 });
  const response = await route.get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { total: 21 });
  assertCountQuery(route);
  assert.deepEqual(route.calls.filter((call) => call.operation === "in"), []);
});

test("le compteur ADS conserve les refus de session, d’offre et de scope avant toute lecture", async () => {
  for (const denied of [401, 403, 503] as const) {
    const route = runtime({ denied });
    const response = await route.get();
    assert.equal(response.status, denied);
    assert.deepEqual(await response.json(), { error: "Access denied" });
    assert.deepEqual(route.calls, []);
    assert.deepEqual(route.checkedAccounts, []);
  }
});

test("une panne du stockage ADS retourne une erreur plutôt qu’un compteur zéro", async () => {
  const route = runtime({ count: 0, error: true });
  const response = await route.get();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(typeof body.error, "string");
  assert.ok(body.error.length > 0);
  assert.equal(Object.hasOwn(body, "total"), false);
  assertCountQuery(route);
});

test("un total absent ou invalide ne devient jamais un faux zéro", async () => {
  for (const count of [null, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const route = runtime({ count });
    const response = await route.get();
    assert.equal(response.status, 503, `invalid count: ${String(count)}`);
    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.equal(Object.hasOwn(body, "total"), false);
    assertCountQuery(route);
  }
});

test("seul countsOnly=1 remplace la liste, les autres valeurs gardent sa pagination", async () => {
  const campaign = { id: "campaign-1", draft: { name: "Example" }, provider_resources: {} };
  for (const queryString of ["", "countsOnly=0", "countsOnly=true"]) {
    const route = runtime({ campaigns: [campaign], count: 51 });
    const response = await route.get(queryString);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { campaigns: [campaign], total: 51, nextOffset: 1 });
    assert.deepEqual(route.calls.find((call) => call.operation === "range")?.args, [0, 49]);
    assert.equal(route.formatted.length, 2);
  }
});
