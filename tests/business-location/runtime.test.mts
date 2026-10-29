import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import * as extraction from "../../lib/businessLocationAutofill.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const ACCOUNT = "active-account";
const OTHER = "another-account";
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(resolve(ROOT, path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", code)(loaded, loaded.exports, (name: string) => {
    if (name === "server-only") return {};
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  });
  return loaded.exports as T;
}

function harness() {
  type Row = Record<string, unknown>;
  const rows: Record<string, Row[]> = {
    profiles: [
      { user_id: ACCOUNT, hq_zip: null, hq_city: null, company_legal_name: null, phone: null, contact_email: null, logo_url: "keep.png" },
      { user_id: OTHER, hq_zip: "75002", hq_city: "Paris", company_legal_name: "Autre pro" },
    ],
    pro_tools_configs: [{ user_id: ACCOUNT, settings: { inrSearch: { slug: "pro-harnes" } } }],
    business_profiles: [{ user_id: ACCOUNT, company_name: "Entreprise réelle" }],
  };
  let beforeUpdate: (() => void) | null = null;
  let sources: extraction.BusinessLocationSource[] = [{ key: "google_business", status: "analyzed", content: JSON.stringify({
    details: { title: "Entreprise réelle", address: { postalCode: "62440", locality: "Harnes" }, phoneNumbers: { primaryPhone: "06 31 26 08 12" } },
  }) }];
  const invalidations: string[] = [];
  const queries: Array<{ table: string; action: string; filters: Array<[string, unknown]>; patch: Row }> = [];
  const database = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let action = "select";
      let patch: Row = {};
      const query = {
        select() { return query; },
        eq(field: string, value: unknown) { filters.push([field, value]); return query; },
        is(field: string, value: unknown) { filters.push([field, value]); return query; },
        update(value: Row) { action = "update"; patch = value; return query; },
        insert(value: Row) { action = "insert"; patch = value; return query; },
        order() { return query; }, limit() { return query; },
        async maybeSingle() {
          queries.push({ table, action, filters: [...filters], patch: structuredClone(patch) });
          if (action === "update" && beforeUpdate) { const trigger = beforeUpdate; beforeUpdate = null; trigger(); }
          if (action === "insert") { rows[table].push(structuredClone(patch)); return { data: structuredClone(patch), error: null }; }
          const selected = (rows[table] || []).find((row) => filters.every(([key, value]) => (row[key] ?? null) === value));
          if (selected && action === "update") Object.assign(selected, patch);
          return { data: selected ? structuredClone(selected) : null, error: null };
        },
      };
      return query;
    },
  };
  const service = load<typeof import("../../lib/businessLocationServer.ts")>("lib/businessLocationServer.ts", {
    "next/cache": { revalidatePath: (path: string) => invalidations.push(path) },
    "@/lib/businessLocationAutofill": extraction,
    "@/lib/boosterGenerationContext": { invalidateBoosterGenerationContext: async (id: string, scope: string) => invalidations.push(`${id}:${scope}`) },
    "@/lib/businessDnaChannelAnalysis": { collectBusinessDnaChannelSources: async (args: { userId: string }) => { assert.equal(args.userId, ACCOUNT); return sources; } },
    "@/lib/inrSearchProvisioning": { revalidateInrSearchPublicRoutes: (slug: string) => invalidations.push(slug) },
    "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForActorAndAccount: async () => true },
    "@/lib/professionalBusinessIdentity": { resolveProfessionalCompanyNameFromProfile: (...values: unknown[]) => values.find((value) => typeof value === "string" && value) || "" },
    "@/lib/tsSafe": { asRecord: (value: unknown) => value && typeof value === "object" ? value : {}, asString: (value: unknown) => typeof value === "string" ? value : "" },
  });
  const route = load<typeof import("../../app/api/business-location/route.ts")>("app/api/business-location/route.ts", {
    "next/server": { NextResponse: { json: (payload: unknown, options: { status?: number; headers?: unknown } = {}) => ({ payload, status: options.status || 200, headers: options.headers }) } },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => ({ status: 500 }) },
    "@/lib/businessLocationAutofill": extraction,
    "@/lib/businessLocationServer": service,
    "@/lib/rateLimit": { enforceRateLimit: async () => null },
    "@/lib/requireUser": { requireUser: async () => ({ supabase: database, activeUserId: ACCOUNT, errorResponse: null }) },
    "@/lib/tsSafe": { asRecord: (value: unknown) => value && typeof value === "object" ? value : {} },
  });
  return { rows, queries, invalidations, service, route, database: database as unknown as Parameters<typeof service.readBusinessLocation>[0],
    setBeforeUpdate: (callback: () => void) => { beforeUpdate = callback; },
    setSources: (value: extraction.BusinessLocationSource[]) => { sources = value; }, sources };
}

test("API : active scope obligatoire pour GET, PUT et POST, sans accès au compte étranger", async () => {
  const h = harness();
  const get = await h.route.GET(new Request(`https://app.example/api/business-location?accountId=${OTHER}`));
  const put = await h.route.PUT(new Request("https://app.example/api/business-location", { method: "PUT", body: JSON.stringify({ accountId: OTHER, postalCode: "62440", city: "Harnes" }) }));
  const post = await h.route.POST(new Request("https://app.example/api/business-location", { method: "POST", body: JSON.stringify({ accountId: OTHER, action: "autofill" }) }));
  assert.equal(get.status, 403); assert.equal(put.status, 403); assert.equal(post.status, 403);
  assert.equal(h.queries.length, 0);
});

test("API : PUT ne modifie que le lieu, invalide ses dépendants et garde le compte voisin", async () => {
  const h = harness();
  const response = await h.route.PUT(new Request("https://app.example/api/business-location", { method: "PUT", body: JSON.stringify({
    accountId: ACCOUNT, postalCode: "62440", city: "Harnes", logo_url: "evil.png", company_legal_name: "overwrite",
  }) }));
  assert.equal(response.status, 200);
  assert.deepEqual((response as unknown as { payload: unknown }).payload, { ok: true, accountId: ACCOUNT, location: { postalCode: "62440", city: "Harnes" } });
  assert.equal(h.rows.profiles[0].logo_url, "keep.png");
  assert.equal(h.rows.profiles[0].company_legal_name, null);
  assert.equal(h.rows.profiles[1].hq_city, "Paris");
  assert.deepEqual(h.invalidations, [`${ACCOUNT}:professional`, "pro-harnes", "/annuaire"]);
});

test("API : POST retourne le lieu récupéré sans exposer les contenus sources", async () => {
  const h = harness();
  const response = await h.route.POST(new Request("https://app.example/api/business-location", { method: "POST", body: JSON.stringify({ action: "autofill" }) }));
  assert.equal(response.status, 200);
  assert.deepEqual((response as unknown as { payload: unknown }).payload, { ok: true, accountId: ACCOUNT, location: { postalCode: "62440", city: "Harnes" }, source: "google_business" });
  assert.equal(h.rows.profiles[0].phone, null);
});

test("autofill : compare-and-set laisse gagner une modification manuelle concurrente", async () => {
  const h = harness();
  h.setBeforeUpdate(() => { h.rows.profiles[0].hq_zip = "59000"; h.rows.profiles[0].hq_city = "Lille"; });
  const result = await h.service.autofillBusinessLocationFromSources({ supabase: h.database, accountId: ACCOUNT, sources: h.sources });
  assert.equal(result.changed, false);
  assert.deepEqual(result.location, { postalCode: "59000", city: "Lille" });
  assert.equal(h.invalidations.length, 0);
  assert.equal(h.rows.profiles[1].hq_city, "Paris");
});

test("autofill : une modification pendant la lecture des canaux n’est pas écrasée", async () => {
  const h = harness();
  h.rows.profiles[0].hq_city = "Lille";
  const result = await h.service.autofillBusinessLocationFromSources({ supabase: h.database, accountId: ACCOUNT, sources: h.sources,
    expectedLocation: { postalCode: null, city: null } });
  assert.equal(result.changed, false);
  assert.equal(h.rows.profiles[0].hq_city, "Lille");
  assert.ok(h.queries.every((query) => query.action === "select"));
});

test("analyse : identité et contacts manquants se complètent sans toucher une saisie existante", async () => {
  const h = harness();
  h.rows.profiles[0].phone = "01 22 33 44 55";
  h.setSources([...h.sources, { key: "facebook", status: "analyzed", content: JSON.stringify({ profile: { name: "Autre nom", emails: ["contact@pro.example"] } }) }]);
  const result = await h.service.autofillBusinessIdentityFromSources({ supabase: h.database, accountId: ACCOUNT,
    sources: [...h.sources, { key: "facebook", status: "analyzed", content: JSON.stringify({ profile: { emails: ["contact@pro.example"] } }) }] });
  assert.equal(result.changed, true);
  assert.equal(h.rows.profiles[0].company_legal_name, "Entreprise réelle");
  assert.equal(h.rows.profiles[0].phone, "01 22 33 44 55");
  assert.equal(h.rows.profiles[0].contact_email, "contact@pro.example");
  assert.equal(h.rows.profiles[1].company_legal_name, "Autre pro");
});

test("analyse : la saisie manuelle des contacts gagne aussi la course avec l’autofill", async () => {
  const h = harness();
  h.setBeforeUpdate(() => { h.rows.profiles[0].company_legal_name = "Mon nom choisi"; h.rows.profiles[0].phone = "01 22 33 44 55"; });
  const result = await h.service.autofillBusinessIdentityFromSources({ supabase: h.database, accountId: ACCOUNT, sources: h.sources });
  assert.equal(result.changed, false);
  assert.equal(h.rows.profiles[0].company_legal_name, "Mon nom choisi");
  assert.equal(h.rows.profiles[0].phone, "01 22 33 44 55");
});
