import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as identity from "../../lib/professionalBusinessIdentity.ts";
import { isInrDirectoryEnabled } from "../../lib/inrDirectorySettings.ts";

type Row = Record<string, unknown>;
const ACCOUNT = "00000000-0000-4000-8000-000000000011";
const OTHER = "00000000-0000-4000-8000-000000000012";
const initialSettings = () => ({
  inrSearch: { enabled: false, slug: "jardins-du-nord", publishedSlug: "jardins-du-nord", pageTitle: "Ancienne identité" },
  facebook: { pageId: "original-page" },
  inrDirectory: { enabled: true },
});
const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrSearchProvisioning.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function harness(initial: Row | null = initialSettings()) {
  let settings: Row | null = structuredClone(initial);
  let beforeWrite: (() => void) | undefined;
  let duplicateInsert = false;
  let alwaysConflict = false;
  let writes = 0;
  let indexings = 0;
  const neighbor = { user_id: OTHER, settings: { facebook: { pageId: "neighbor-page" } } };
  const invalidations: string[] = [];
  const database = {
    from(table: string) {
      let action = "read";
      let patch: Row = {};
      const filters: Array<[string, unknown]> = [];
      let exclusions: Array<[string, unknown]> = [];
      let profileIds: unknown[] = [];
      let collisionQuery = false;
      const read = () => {
        if (table === "inrcy_account_members") {
          assert.ok(filters.some(([key, id]) => key === "account_id" && id === ACCOUNT));
          return [{ auth_user_id: ACCOUNT, is_default: true }];
        }
        if (table === "profiles") {
          assert.deepEqual(profileIds, [ACCOUNT]);
          return [{ user_id: ACCOUNT, company_legal_name: "Jardins du Nord", hq_city: "Arras" }];
        }
        if (table === "business_profiles") return { sector: "[[SECTOR:exterieur_jardin]] Paysagiste", business_description: "Entretien de jardins." };
        assert.equal(table, "pro_tools_configs");
        if (collisionQuery || exclusions.length) return [];
        assert.ok(filters.some(([key, id]) => key === "user_id" && id === ACCOUNT));
        return settings === null ? null : { user_id: ACCOUNT, settings: structuredClone(settings) };
      };
      const execute = async () => {
        if (action === "read") return { data: read(), error: null };
        assert.equal(table, "pro_tools_configs");
        assert.equal(filters.find(([key]) => key === "user_id")?.[1] ?? patch.user_id, ACCOUNT);
        writes++;
        beforeWrite?.(); beforeWrite = undefined;
        if (action === "insert" && duplicateInsert) {
          duplicateInsert = false;
          return { data: null, error: { code: "23505" } };
        }
        const expected = filters.find(([key]) => key === "settings")?.[1];
        if (alwaysConflict || (action === "update" && expected !== (settings === null ? null : JSON.stringify(settings)))) return { data: [], error: null };
        settings = structuredClone(patch.settings as Row);
        return { data: [{ user_id: ACCOUNT }], error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        in: (_key: string, ids: unknown[]) => { profileIds = ids; return query; },
        contains: () => { collisionQuery = true; return query; },
        neq: (key: string, value: unknown) => { exclusions = [...exclusions, [key, value]]; return query; },
        order: () => query, limit: () => query,
        update: (value: Row) => { action = "update"; patch = value; return query; },
        insert: (value: Row) => { action = "insert"; patch = value; return query; },
        maybeSingle: async () => ({ data: read(), error: null }),
        then: (resolve: (result: unknown) => void, reject: (error: unknown) => void) => execute().then(resolve, reject),
      };
      return query;
    },
  };
  const dependencies: Row = {
    "server-only": {},
    "@/lib/inrDirectorySettings": { isInrDirectoryEnabled },
    "next/cache": { revalidatePath: (path: string) => invalidations.push(path), revalidateTag: (tag: string) => invalidations.push(tag) },
    "@/lib/inrSearchPublic": { getInrSearchPublicPageCacheTag: (slug: string) => `page:${slug}` },
    "@/lib/inrSearchSeo": { buildInrSearchIndexingUrls: async (slug: string) => [slug], submitInrSearchUrlsToIndexNow: async () => { indexings++; return { ok: true }; } },
    "@/lib/supabaseAdmin": { supabaseAdmin: database },
    "@/lib/tsSafe": { asRecord: (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value : {} },
    "@/lib/professionalBusinessIdentity": identity,
  };
  const loaded = { exports: {} as typeof import("../../lib/inrSearchProvisioning.ts") };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), name);
    return dependencies[name];
  });
  return {
    ensure: () => loaded.exports.ensureSystemManagedInrSearch(database, ACCOUNT),
    get settings() { return settings; }, get writes() { return writes; }, get indexings() { return indexings; }, neighbor, invalidations,
    changeBeforeWrite(change: (value: Row) => Row) { beforeWrite = () => { settings = change(settings || {}); }; },
    insertRace() { duplicateInsert = true; beforeWrite = () => { settings = { facebook: { pageId: "created-concurrently" }, inrDirectory: { enabled: false } }; }; },
    conflictForever() { alwaysConflict = true; },
  };
}

test("provisioning CAS preserves a concurrent unrelated connection and the neighbor account", async () => {
  const h = harness();
  const neighbor = structuredClone(h.neighbor);
  h.changeBeforeWrite((settings) => ({ ...settings, instagram: { username: "manual-concurrent" } }));
  const result = await h.ensure();
  assert.equal(h.writes, 2);
  assert.deepEqual(h.settings!.instagram, { username: "manual-concurrent" });
  assert.deepEqual(h.settings!.facebook, { pageId: "original-page" });
  assert.deepEqual(h.neighbor, neighbor);
  assert.equal(result.inrSearch.pageTitle, "Jardins du Nord");
  assert.equal(result.inrSearch.enabled, false);
  assert.equal(h.indexings, 0);
});

test("a concurrent explicit deactivation is never undone by metadata provisioning", async () => {
  const h = harness({ ...initialSettings(), inrSearch: { ...initialSettings().inrSearch, enabled: true } });
  h.changeBeforeWrite((settings) => ({ ...settings, inrSearch: { ...(settings.inrSearch as Row), enabled: false, activationRequested: false, activationVersion: 1 } }));
  const result = await h.ensure();
  assert.equal(h.writes, 2);
  assert.equal(result.inrSearch.enabled, false);
  assert.equal((result.inrSearch as Row).activationRequested, false);
  assert.equal(result.inrSearch.publishedAt, null);
  assert.equal(h.indexings, 0);
  assert.deepEqual(h.settings!.inrDirectory, { enabled: true });
});

test("a concurrent row creation retries an insert conflict and preserves its settings", async () => {
  const h = harness(null); h.insertRace();
  const result = await h.ensure();
  assert.equal(h.writes, 2);
  assert.deepEqual(h.settings!.facebook, { pageId: "created-concurrently" });
  assert.deepEqual(h.settings!.inrDirectory, { enabled: false });
  assert.ok(result.inrSearch.slug);
  assert.equal(result.inrSearch.enabled, false);
});

test("provisioning retries stop after four conflicts and do not invalidate an uncommitted change", async () => {
  const h = harness(); h.conflictForever();
  await assert.rejects(h.ensure(), /actualisation/);
  assert.equal(h.writes, 4);
  assert.deepEqual(h.invalidations, []);
  assert.equal(h.indexings, 0);
});
