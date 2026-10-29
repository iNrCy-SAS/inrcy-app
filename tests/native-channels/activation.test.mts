import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as catalog from "../../lib/activityCatalog.ts";
import * as sectors from "../../lib/activitySectors.ts";
import * as identity from "../../lib/professionalBusinessIdentity.ts";
import * as directory from "../../lib/inrDirectorySettings.ts";
import { withNewAccountNativeChannelDefaults } from "../../lib/newAccountNativeChannelDefaults.ts";

type RecordValue = Record<string, unknown>;
const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
function load<T>(path: string, dependencies: RecordValue): T {
  const compiled = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => {
    if (name === "server-only") return {};
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  });
  return loaded.exports as T;
}
const directoryCatalog = load<typeof import("../../lib/inrDirectoryCatalog.ts")>("lib/inrDirectoryCatalog.ts", {
  "./activityCatalog": catalog, "./activitySectors": sectors,
});
const policy = load<typeof import("../../lib/nativeChannelActivation.ts")>("lib/nativeChannelActivation.ts", {
  "./inrDirectoryCatalog.ts": directoryCatalog,
  "./professionalBusinessIdentity.ts": identity,
  "./inrDirectorySettings.ts": directory,
});
const fullProfile: RecordValue = {
  company_legal_name: "Jardins du Nord", first_name: "Paul", last_name: "Martin",
  phone: "0612345678", contact_email: "bonjour@example.fr", hq_city: "Arras", hq_zip: "62000",
};
const business = { sector: "[[SECTOR:exterieur_jardin]] Jardinier paysagiste" };

test("new-account defaults require consent even after the full profile arrives, while recovery preserves older public pages", () => {
  const newSettings = withNewAccountNativeChannelDefaults({});
  const newStates = policy.resolveNativeChannelStates({ profile: fullProfile, business, settings: newSettings });
  for (const state of Object.values(newStates)) {
    assert.equal(state.ready, true);
    assert.equal(state.requested, false);
    assert.equal(state.published, false);
  }
  const legacySettings = { inrSearch: { enabled: true, slug: "ancienne-page" } };
  const recovered = withNewAccountNativeChannelDefaults(legacySettings);
  const oldStates = policy.resolveNativeChannelStates({ profile: { ...fullProfile, hq_zip: "" }, business, settings: recovered });
  assert.equal(oldStates.inr_search.published, true);
  assert.equal(oldStates.inr_directory.published, true);
});
function allRequested() {
  let settings: RecordValue = { inrSearch: { slug: "jardins-du-nord", enabled: false } };
  for (const key of policy.NATIVE_CHANNEL_KEYS) settings = policy.updateNativeChannelActivation(settings, key, true);
  return settings;
}

test("Badge requires a company plus any usable contact, without location or profession", () => {
  const empty = policy.getNativeChannelMissingFields({}, {}, {});
  assert.deepEqual(empty.inrbadge, ["company", "contact"]);
  for (const contact of [{ phone: "+33 6 12 34 56 78" }, { contact_email: "bonjour@example.fr" }]) {
    assert.deepEqual(policy.getNativeChannelMissingFields({ company_legal_name: "Entreprise exemple", ...contact }, {}, {}).inrbadge, []);
  }
  assert.deepEqual(policy.getNativeChannelMissingFields({ company_legal_name: "Entreprise exemple" }, {}, { instagram: { profileUrl: "https://instagram.com/example" } }).inrbadge, []);
  assert.deepEqual(policy.getNativeChannelMissingFields({ company_legal_name: "Entreprise exemple", phone: "12345", contact_email: "pas-un-mail" }, {}, { site_web: { url: "javascript:alert(1)" } }).inrbadge, ["contact"]);
});

test("Search and directory require company, profession, city and postcode, independently of content targeting", () => {
  assert.deepEqual(policy.getNativeChannelMissingFields({}, {}, {}).inr_search, ["company", "profession", "city", "postalCode"]);
  const ready = policy.getNativeChannelMissingFields(fullProfile, business, {});
  assert.deepEqual(ready.inr_search, []);
  assert.deepEqual(ready.inr_directory, []);
  for (const field of ["company_legal_name", "hq_city", "hq_zip"]) {
    const result = policy.getNativeChannelMissingFields({ ...fullProfile, [field]: "" }, business, { contentLocation: { useHeadquarters: false, primaryArea: "Lille" } });
    assert.ok(result.inr_search.length > 0, field);
    assert.deepEqual(result.inr_search, result.inr_directory);
  }
  assert.deepEqual(policy.getNativeChannelMissingFields(fullProfile, { sector: "" }, {}).inr_search, ["profession"]);
});

test("an activation request remains pending until the actual required fields arrive", () => {
  const settings = allRequested();
  const pending = policy.resolveNativeChannelStates({ profile: {}, business: {}, settings });
  for (const state of Object.values(pending)) {
    assert.equal(state.requested, true);
    assert.equal(state.pending, true);
    assert.equal(state.published, false);
    assert.ok(state.missingFields.length);
  }
  const complete = policy.resolveNativeChannelStates({ profile: fullProfile, business, settings });
  for (const state of Object.values(complete)) {
    assert.equal(state.requested, true);
    assert.equal(state.pending, false);
    assert.equal(state.published, true);
    assert.deepEqual(state.missingFields, []);
  }
});

test("disabled channels remain disabled after data is completed, and eligibility stays a separate gate", () => {
  let settings = allRequested();
  for (const key of policy.NATIVE_CHANNEL_KEYS) settings = policy.updateNativeChannelActivation(settings, key, false);
  const states = policy.resolveNativeChannelStates({ profile: fullProfile, business, settings });
  for (const state of Object.values(states)) {
    assert.equal(state.ready, true);
    assert.equal(state.requested, false);
    assert.equal(state.published, false);
    assert.equal(state.pending, false);
  }
  const denied = policy.resolveNativeChannelStates({ profile: fullProfile, business, settings: allRequested(), allowed: { inrbadge: false, inr_search: false, inr_directory: false } });
  for (const state of Object.values(denied)) {
    assert.equal(state.allowed, false);
    assert.equal(state.requested, true);
    assert.equal(state.published, false);
    assert.equal(state.pending, false);
  }
});

test("version one never inherits legacy consent when explicit activation flags are missing", () => {
  const states = policy.resolveNativeChannelStates({ profile: fullProfile, business, settings: {
    inrBadge: { activationVersion: 1 }, inrDirectory: { activationVersion: 1 },
    inrSearch: { activationVersion: 1, enabled: true, slug: "stale-effective-flag" },
  } });
  for (const state of Object.values(states)) {
    assert.equal(state.requested, false);
    assert.equal(state.published, false);
  }
});

test("already-public legacy pages remain public, including the older directory without a postcode", () => {
  const settings = { inrSearch: { enabled: true, slug: "legacy-public" } };
  const legacy = policy.resolveNativeChannelStates({ profile: fullProfile, business, settings });
  assert.equal(legacy.inrbadge.published, true);
  assert.equal(legacy.inr_search.published, true);
  assert.equal(legacy.inr_directory.published, true);
  const withoutPostcode = policy.resolveNativeChannelStates({ profile: { ...fullProfile, hq_zip: "" }, business, settings });
  assert.equal(withoutPostcode.inr_directory.published, true);
  assert.equal(withoutPostcode.inr_search.published, true);
  const upgraded = policy.updateNativeChannelActivation(settings, "inr_directory", true);
  const pending = policy.resolveNativeChannelStates({ profile: { ...fullProfile, hq_zip: "" }, business, settings: upgraded });
  assert.equal(pending.inr_directory.pending, true);
  assert.deepEqual(pending.inr_directory.missingFields, ["postalCode"]);
});

test("activation mutations preserve unrelated settings and freeze the previous directory opt-in", () => {
  const settings = { inrSearch: { enabled: true, slug: "legacy", directoryEnabled: true }, instagram: { connected: true, username: "keep" }, inrBadgeTheme: { accent: "blue" } };
  const snapshot = structuredClone(settings);
  const next: RecordValue = policy.updateNativeChannelActivation(settings, "inr_search", false);
  assert.deepEqual(settings, snapshot);
  assert.deepEqual(next.instagram, settings.instagram);
  assert.deepEqual(next.inrBadgeTheme, settings.inrBadgeTheme);
  assert.equal((next.inrDirectory as RecordValue).enabled, true);
  assert.equal((next as RecordValue).inrSearch && ((next as RecordValue).inrSearch as RecordValue).activationRequested, false);
});

type HarnessOptions = { profile?: RecordValue; settings?: RecordValue | null; allowed?: boolean; firstEligibilityGate?: Promise<void> };
function serverHarness(options: HarnessOptions = {}) {
  let profile = structuredClone(options.profile ?? fullProfile);
  let settings: RecordValue | null = structuredClone(options.settings === undefined ? allRequested() : options.settings);
  let beforeUpdate: (() => void) | undefined;
  let permanentConflict = false;
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const invalidations: string[] = [];
  let writes = 0;
  let provisions = 0;
  let eligibilityReads = 0;
  const database = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      queries.push({ table, filters });
      let action = "read";
      let patch: RecordValue = {};
      const execute = async () => {
        assert.equal(filters.find(([key]) => key === "user_id")?.[1] ?? patch.user_id, ACCOUNT);
        assert.equal(table, "pro_tools_configs");
        writes++;
        beforeUpdate?.(); beforeUpdate = undefined;
        const expected = filters.find(([key]) => key === "settings")?.[1];
        if (permanentConflict || (action === "update" && expected !== undefined && expected !== (settings === null ? null : JSON.stringify(settings)))) return { data: [], error: null };
        settings = structuredClone(patch.settings as RecordValue);
        return { data: [{ user_id: ACCOUNT }], error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        order: () => query, limit: () => query,
        update: (value: RecordValue) => { action = "update"; patch = value; return query; },
        insert: (value: RecordValue) => { action = "insert"; patch = value; return query; },
        maybeSingle: async () => {
          assert.equal(filters.find(([key]) => key === "user_id")?.[1], ACCOUNT);
          return { data: table === "profiles" ? structuredClone(profile) : table === "business_profiles" ? business : settings === null ? null : { settings: structuredClone(settings) }, error: null };
        },
        then: (resolve: (result: unknown) => void, reject: (error: unknown) => void) => execute().then(resolve, reject),
      };
      return query;
    },
  };
  const service = load<typeof import("../../lib/nativeChannelActivationServer.ts")>("lib/nativeChannelActivationServer.ts", {
    "next/cache": { revalidatePath: (path: string) => invalidations.push(path) },
    "./supabaseAdmin": { supabaseAdmin: database },
    "./inrSearchEligibility": { getNativeChannelPublicationEligibility: async (account: string) => { assert.equal(account, ACCOUNT); eligibilityReads++; if (eligibilityReads === 1) await options.firstEligibilityGate; return {
      inrbadge: { allowed: options.allowed !== false }, inr_search: { allowed: options.allowed !== false }, inr_directory: { allowed: options.allowed !== false },
    }; } },
    "./inrSearchProvisioning": { ensureSystemManagedInrSearch: async (_db: unknown, account: string) => { assert.equal(account, ACCOUNT); provisions++; return { inrSearch: { slug: String((settings?.inrSearch as RecordValue | undefined)?.slug || "") } }; }, revalidateInrSearchPublicRoutes: (slug: string) => invalidations.push(slug) },
    "./nativeChannelActivation": policy,
    "./inrBadge": { createInrBadgePublicUrl: (input: { userId: string }) => `https://app.example/badge/${input.userId}` },
    "./inrSearchDirectoryCache": { purgeInrSearchDirectoryCache: async () => { throw new Error("No remote purge in local fixtures"); } },
  });
  return {
    service, queries, invalidations,
    get settings() { return settings; }, get writes() { return writes; }, get provisions() { return provisions; },
    setProfile(value: RecordValue) { profile = value; },
    concurrentEdit() { beforeUpdate = () => { settings = { ...settings, instagram: { connected: true, username: "concurrent-user" } }; }; },
    concurrentCompletion() { beforeUpdate = () => { profile = structuredClone(fullProfile); settings = { ...settings, instagram: { connected: true, username: "concurrent-user" } }; }; },
    conflictForever() { permanentConflict = true; },
  };
}

test("server turns a pending Search green automatically after location is saved, without a second activation", async () => {
  const h = serverHarness({ profile: { ...fullProfile, hq_city: "", hq_zip: "" } });
  const pending = await h.service.syncNativeChannelsForAccount(ACCOUNT);
  assert.equal(pending.states.inr_search.pending, true);
  assert.equal((h.settings!.inrSearch as RecordValue).enabled, false);
  h.setProfile(fullProfile);
  const complete = await h.service.syncNativeChannelsForAccount(ACCOUNT, undefined, { profileSaved: true });
  assert.equal(complete.states.inr_search.published, true);
  assert.equal((h.settings!.inrSearch as RecordValue).enabled, true);
  assert.equal((h.settings!.inrSearch as RecordValue).activationRequested, true);
  assert.equal(h.provisions, 0, "existing page does not need provisioning for a data refresh");
  assert.ok(h.invalidations.includes("/annuaire"));
});

test("server saves an early request, keeps explicit disabled channels off and returns only published Badge URLs", async () => {
  const h = serverHarness({ profile: {} });
  const pending = await h.service.syncNativeChannelsForAccount(ACCOUNT, { key: "inrbadge", enabled: true });
  assert.equal(pending.states.inrbadge.pending, true);
  assert.equal(pending.badgeUrl, "");
  await h.service.syncNativeChannelsForAccount(ACCOUNT, { key: "inrbadge", enabled: false });
  h.setProfile(fullProfile);
  const complete = await h.service.syncNativeChannelsForAccount(ACCOUNT);
  assert.equal(complete.states.inrbadge.ready, true);
  assert.equal(complete.states.inrbadge.published, false);
  assert.equal(complete.badgeUrl, "");
});

test("connecting Search provisions its URL first but keeps an incomplete page pending", async () => {
  const h = serverHarness({ profile: {}, settings: { inrSearch: { slug: "prepared-url", enabled: false } } });
  const result = await h.service.syncNativeChannelsForAccount(ACCOUNT, { key: "inr_search", enabled: true });
  assert.equal(h.provisions, 1);
  assert.equal(result.states.inr_search.requested, true);
  assert.equal(result.states.inr_search.pending, true);
  assert.equal((h.settings!.inrSearch as RecordValue).enabled, false);
  const denied = serverHarness({ allowed: false });
  await assert.rejects(denied.service.syncNativeChannelsForAccount(ACCOUNT, { key: "inr_search", enabled: true }), /disponible/);
  assert.equal(denied.provisions, 0, "eligibility is checked before provisioning writes");
});

test("server CAS retries preserve a concurrent unrelated channel setting", async () => {
  const h = serverHarness(); h.concurrentEdit();
  const result = await h.service.syncNativeChannelsForAccount(ACCOUNT, { key: "inr_directory", enabled: false });
  assert.equal(result.states.inr_directory.requested, false);
  assert.deepEqual(h.settings!.instagram, { connected: true, username: "concurrent-user" });
  assert.equal(h.writes, 2);
  assert.ok(h.queries.every((query) => query.filters.some(([key, id]) => key === "user_id" && id === ACCOUNT)));
});

test("a delayed older sync cannot unpublish the result of a more recent Profile save", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const h = serverHarness({ profile: {}, firstEligibilityGate: gate });
  const olderSync = h.service.syncNativeChannelsForAccount(ACCOUNT);
  h.setProfile(fullProfile);
  const newerSave = await h.service.syncNativeChannelsForAccount(ACCOUNT, undefined, { profileSaved: true });
  assert.equal(newerSave.states.inr_search.published, true);
  release();
  const olderResult = await olderSync;
  assert.equal(olderResult.states.inr_search.published, true);
  assert.equal((h.settings!.inrSearch as RecordValue).enabled, true);
  assert.equal((h.settings!.inrSearch as RecordValue).publicationReady, true);
});

test("a CAS retry rechecks the current Profile rather than reusing a pre-save readiness snapshot", async () => {
  const h = serverHarness({ profile: {} }); h.concurrentCompletion();
  const result = await h.service.syncNativeChannelsForAccount(ACCOUNT);
  assert.equal(h.writes, 2);
  assert.equal(result.states.inr_search.published, true);
  assert.equal((h.settings!.inrSearch as RecordValue).enabled, true);
  assert.deepEqual(h.settings!.instagram, { connected: true, username: "concurrent-user" });
});

test("server bounds conflicting retries and refuses an activation outside eligibility", async () => {
  const conflicts = serverHarness(); conflicts.conflictForever();
  await assert.rejects(conflicts.service.syncNativeChannelsForAccount(ACCOUNT, { key: "inr_directory", enabled: false }), /actualisé/);
  assert.equal(conflicts.writes, 4);
  const denied = serverHarness({ allowed: false });
  await assert.rejects(denied.service.syncNativeChannelsForAccount(ACCOUNT, { key: "inrbadge", enabled: true }), /disponible/);
  assert.equal(denied.writes, 0);
});

test("API rejects foreign accounts, invalid payloads and unauthenticated reads before calling the service", async () => {
  const calls: unknown[][] = [];
  let authError: Response | null = null;
  const route = load<typeof import("../../app/api/native-channels/settings/route.ts")>("app/api/native-channels/settings/route.ts", {
    "next/server": { NextResponse: { json: (payload: unknown, init: ResponseInit = {}) => Response.json(payload, init) } },
    "@/lib/requireUser": { requireUser: async () => ({ activeUserId: ACCOUNT, errorResponse: authError }) },
    "@/lib/nativeChannelActivation": policy,
    "@/lib/nativeChannelActivationServer": { syncNativeChannelsForAccount: async (...args: unknown[]) => { calls.push(args); return { ok: true, accountId: args[0] }; } },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback },
  });
  const post = (payload: unknown) => route.POST(new Request("https://app.example/api/native-channels/settings", { method: "POST", body: JSON.stringify(payload) }));
  assert.equal((await post({ accountId: OTHER, key: "inrbadge", enabled: true })).status, 409);
  assert.equal((await post({ key: "inrbadge", enabled: true })).status, 409);
  assert.equal((await post({ accountId: ACCOUNT, key: "instagram", enabled: true })).status, 400);
  assert.equal((await post({ accountId: ACCOUNT, key: "inr_search", enabled: "true" })).status, 400);
  assert.equal(calls.length, 0);
  authError = new Response("Unauthorized", { status: 401 });
  assert.equal((await route.GET()).status, 401);
  assert.equal(calls.length, 0);
  authError = null;
  const success = await post({ accountId: ACCOUNT, key: "inr_search", enabled: true });
  assert.equal(success.status, 200);
  assert.deepEqual(calls, [[ACCOUNT, { key: "inr_search", enabled: true }]]);
  assert.equal(success.headers.get("Cache-Control"), "no-store");
});
