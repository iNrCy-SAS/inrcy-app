import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as profile from "../../lib/googleBusinessProfile.ts";
import { googleBusinessCategoryRegion, searchGoogleBusinessCategories } from "../../lib/googleBusinessCategoryCatalog.ts";

const plumber = { name: "categories/gcid:plumber", displayName: "Plombier" };
const heating = { name: "categories/gcid:heating_contractor", displayName: "Chauffagiste" };
const electrician = { name: "categories/gcid:electrician", displayName: "Électricien" };
const original = profile.editableGoogleBusinessProfile({ title: "Atelier", categories: { primaryCategory: plumber, additionalCategories: [heating] }, phoneNumbers: { primaryPhone: "+33123456789" } });

test("reading categories keeps Google's labels and ignores provider-only category metadata", () => {
  const result = profile.editableGoogleBusinessCategories({ primaryCategory: { ...plumber, serviceTypes: [{ serviceTypeId: "read-only" }] }, additionalCategories: [heating] });
  assert.deepEqual(result, { primaryCategory: plumber, additionalCategories: [heating] });
  assert.deepEqual(profile.editableGoogleBusinessCategories(undefined), { primaryCategory: null, additionalCategories: [] });
});

test("changing the primary category sends the entire categories collection and preserves secondary activities", () => {
  const patch = profile.buildGoogleBusinessProfilePatch(original, { categories: { primaryCategory: electrician, additionalCategories: [heating] } });
  assert.deepEqual(patch, { location: { categories: { primaryCategory: { name: electrician.name }, additionalCategories: [{ name: heating.name }] } }, updateMask: ["categories"] });
  assert.equal("phoneNumbers" in patch.location, false);
});

test("removing secondary activities is explicit, preserves the primary and writes no client-supplied labels", () => {
  assert.deepEqual(profile.buildGoogleBusinessProfilePatch(original, { categories: { primaryCategory: { ...plumber, displayName: "Fake label" }, additionalCategories: [] } }).location,
    { categories: { primaryCategory: { name: plumber.name }, additionalCategories: [] } });
  assert.deepEqual(profile.buildGoogleBusinessProfilePatch(original, { categories: { primaryCategory: { ...plumber, displayName: "Localised label" }, additionalCategories: [heating] } }).updateMask, []);
});

test("categories reject missing primary, partial lists, duplicates, arbitrary text and excess secondary activities", () => {
  for (const categories of [
    { primaryCategory: null, additionalCategories: [] },
    { primaryCategory: electrician },
    { primaryCategory: plumber, additionalCategories: [plumber] },
    { primaryCategory: plumber, additionalCategories: [heating, heating] },
    { primaryCategory: { name: "Free text", displayName: "Anything" }, additionalCategories: [] },
    { primaryCategory: plumber, additionalCategories: Array.from({ length: 10 }, (_, i) => ({ name: `categories/gcid:activity_${i}`, displayName: "Activity" })) },
  ]) assert.throws(() => profile.buildGoogleBusinessProfilePatch(original, { categories }));
  assert.deepEqual(profile.buildGoogleBusinessProfilePatch(original, { description: "New description" }).updateMask, ["profile.description"]);
});

test("the category country comes from Google, including hidden-address service businesses", () => {
  assert.equal(googleBusinessCategoryRegion({ storefrontAddress: { regionCode: "FR" } }), "FR");
  assert.equal(googleBusinessCategoryRegion({ serviceArea: { regionCode: "BE" } }), "BE");
  assert.equal(googleBusinessCategoryRegion({ languageCode: "fr" }), null);
});

test("catalog searches use Google's official country, language, prefix filter and pagination", async () => {
  const calls: URL[] = [];
  const result = await searchGoogleBusinessCategories({ accessToken: "test-only", regionCode: "BE", languageCode: "fr-BE", query: "Plomb", pageToken: "next", fetchImpl: async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-only");
    assert.equal(init?.method, undefined);
    return Response.json({ categories: [plumber], nextPageToken: "another-page" });
  } });
  assert.equal(calls[0].hostname, "mybusinessbusinessinformation.googleapis.com");
  assert.equal(calls[0].searchParams.get("regionCode"), "BE");
  assert.equal(calls[0].searchParams.get("languageCode"), "fr-BE");
  assert.equal(calls[0].searchParams.get("filter"), "displayName=Plomb");
  assert.equal(calls[0].searchParams.get("pageToken"), "next");
  assert.deepEqual(result, { categories: [plumber], nextPageToken: "another-page" });
});

test("empty catalog responses, Google refusal and invalid searches are handled without a write", async () => {
  const common = { accessToken: "fixture", regionCode: "FR", languageCode: "fr", query: "ZZZ" };
  assert.deepEqual(await searchGoogleBusinessCategories({ ...common, fetchImpl: async () => Response.json({}) }), { categories: [], nextPageToken: null });
  await assert.rejects(searchGoogleBusinessCategories({ ...common, fetchImpl: async () => Response.json({}, { status: 403 }) }), /autorise/);
  let calls = 0;
  for (const query of ["a", "x\n=other", "title=foo", "x".repeat(81)]) await assert.rejects(searchGoogleBusinessCategories({ ...common, query, fetchImpl: async () => { calls++; return Response.json({}); } }));
  assert.equal(calls, 0);
});

test("category identifiers are resolved by the official batchGet endpoint before assistant approval", async () => {
  const common = { accessToken: "fixture", regionCode: "FR", languageCode: "fr", names: [plumber.name, heating.name] };
  const result = await searchGoogleBusinessCategories({ ...common, fetchImpl: async input => {
    const url = new URL(String(input)); assert.equal(url.pathname, "/v1/categories:batchGet"); assert.deepEqual(url.searchParams.getAll("names"), common.names);
    return Response.json({ categories: [plumber, heating] });
  } });
  assert.equal(result.categories[0].displayName, "Plombier");
  await assert.rejects(searchGoogleBusinessCategories({ ...common, fetchImpl: async () => Response.json({ categories: [plumber] }) }), /plus proposée/);
});

function routeFixture(options: { authenticated?: boolean; country?: string | null; denied?: boolean } = {}) {
  const calls: URL[] = [];
  const nativeFetch: typeof fetch = async input => {
    const url = new URL(String(input)); calls.push(url);
    if (url.pathname.startsWith("/v1/locations/")) return Response.json({ name: "locations/chosen", serviceArea: { regionCode: options.country === undefined ? "BE" : options.country } });
    return options.denied ? Response.json({}, { status: 403 }) : Response.json({ categories: [plumber] });
  };
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/multicompte/server": { getCurrentInrcyAccountScope: async () => options.authenticated === false ? null : { supabase: {}, scope: { activeUserId: "account" }, user: { id: "actor" } } },
    "@/lib/googleBusiness": { getGmbToken: async () => ({ accessToken: "fixture", row: {} }) },
    "@/lib/googleBusinessReviews": { getGmbReviewTargetFromRow: () => ({ accountName: "accounts/parent", locationName: "locations/chosen" }) },
    "@/lib/googleBusinessProfile": profile,
    "@/lib/googleBusinessCategoryCatalog": { googleBusinessCategoryRegion, searchGoogleBusinessCategories: (input: Parameters<typeof searchGoogleBusinessCategories>[0]) => searchGoogleBusinessCategories({ ...input, fetchImpl: nativeFetch }) },
    "@/lib/rateLimit": { enforceRateLimit: async () => null },
  };
  const code = ts.transpileModule(readFileSync("app/api/integrations/google-business/categories/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  new Function("require", "exports", "fetch", code)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports, nativeFetch);
  return { calls, run: (params: Record<string, string> = {}) => exports.GET!(new Request(`https://app.inrcy.com/api/integrations/google-business/categories?${new URLSearchParams({ accountId: "account", locationName: "locations/chosen", q: "Plomb", languageCode: "fr", ...params })}`)) };
}

test("native search refuses unauthenticated access, other accounts, stale establishments and malformed input", async () => {
  const unauthenticated = routeFixture({ authenticated: false }); assert.equal((await unauthenticated.run()).status, 401); assert.equal(unauthenticated.calls.length, 0);
  const invalid: Record<string, string>[] = [{ accountId: "other" }, { locationName: "locations/old" }, { q: "x" }, { languageCode: "../wrong" }];
  for (const params of invalid) {
    const h = routeFixture(); assert.ok([400, 409].includes((await h.run(params)).status)); assert.equal(h.calls.length, 0);
  }
});

test("native search binds the selected establishment, refuses unknown countries and reports Google errors", async () => {
  const h = routeFixture(); const response = await h.run(); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.accountId, "account"); assert.equal(result.locationName, "locations/chosen");
  assert.equal(h.calls[1].searchParams.get("regionCode"), "BE");
  const missing = routeFixture({ country: null }); assert.equal((await missing.run()).status, 409); assert.equal(missing.calls.length, 1);
  const denied = routeFixture({ denied: true }); assert.equal((await denied.run()).status, 502);
});
