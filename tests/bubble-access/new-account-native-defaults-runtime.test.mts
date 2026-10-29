import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as bubbleAccess from "../../lib/bubbleAccess.ts";
import * as nativeDefaults from "../../lib/newAccountNativeChannelDefaults.ts";

const ACCOUNT = "new-account";
const OTHER = "existing-other-account";
const expected = {
  inrBadge: { enabled: false, activationVersion: 1 },
  inrDirectory: { enabled: false, activationVersion: 1 },
  inrSearch: { enabled: false, activationRequested: false, activationVersion: 1 },
};
type Row = Record<string, unknown>;

test("un nouveau compte reçoit trois choix explicites désactivés sans modifier les autres canaux", () => {
  const previous = { site_web: { url: "https://pro.example/" }, inrBadge: { color: "pink" } };
  const next = nativeDefaults.withNewAccountNativeChannelDefaults(previous);
  assert.deepEqual(next, { ...previous, ...expected, inrBadge: { ...expected.inrBadge, color: "pink" } });
  assert.deepEqual(previous.inrBadge, { color: "pink" });
  assert.equal(nativeDefaults.withNewAccountNativeChannelDefaults(next), next, "recovery is idempotent");
});

test("les choix explicites et les réglages futurs présents ne sont pas réinitialisés", () => {
  const previous = {
    ...expected,
    inrBadge: { enabled: true, activationVersion: 1, title: "Mon badge" },
    inrSearch: { enabled: false, activationRequested: true, activationVersion: 1, slug: "mon-pro" },
    custom: { keep: true },
  };
  assert.equal(nativeDefaults.withNewAccountNativeChannelDefaults(previous), previous);
});

test("une récupération ne versionne pas une ancienne Search publiée ni son annuaire hérité", () => {
  const previous = { inrSearch: { enabled: true, slug: "ancienne-page", title: "Ancien titre" }, unrelated: { keep: true } };
  const next = nativeDefaults.withNewAccountNativeChannelDefaults(previous);
  assert.equal(next, previous);
  assert.equal(Object.hasOwn(next, "inrBadge"), false);
  assert.equal(Object.hasOwn(next, "inrDirectory"), false);
  assert.deepEqual(next.inrSearch, previous.inrSearch);
  const disabledDirectory = { ...previous, inrDirectory: { enabled: false } };
  assert.deepEqual(nativeDefaults.withNewAccountNativeChannelDefaults(disabledDirectory).inrDirectory, { enabled: false, activationVersion: 1 });
});

test("enabled sans URL publiée n’est pas une preuve de consentement hérité", () => {
  const next = nativeDefaults.withNewAccountNativeChannelDefaults({ inrSearch: { enabled: true } });
  assert.deepEqual(next.inrSearch, { enabled: true, activationRequested: false, activationVersion: 1 });
  assert.deepEqual(next.inrBadge, expected.inrBadge);
  assert.deepEqual(next.inrDirectory, expected.inrDirectory);
});

function harness(settings?: unknown, options: { absent?: boolean; bubbleError?: boolean; alwaysConflict?: boolean; readError?: boolean } = {}) {
  const configs: Row[] = [
    ...(!options.absent ? [{ user_id: ACCOUNT, settings: structuredClone(settings ?? null), unrelated_column: "keep" }] : []),
    { user_id: OTHER, settings: { inrSearch: { enabled: true, slug: "other" } } },
  ];
  const operations: Array<{ table: string; action: string; filters: Array<[string, unknown]>; patch: unknown }> = [];
  let beforeWrite: (() => void) | null = null;
  let nonce = 0;
  const client = { from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let action = "select";
    let patch: Row = {};
    const run = async (single = false) => {
      operations.push({ table, action, filters: [...filters], patch: structuredClone(patch) });
      if (options.readError && action === "select") return { data: null, error: { message: "read unavailable" } };
      if (action !== "select" && beforeWrite) { const trigger = beforeWrite; beforeWrite = null; trigger(); }
      if (options.alwaysConflict && action === "update") {
        const row = configs.find((row) => row.user_id === ACCOUNT)!;
        row.settings = { ...(row.settings as Row), concurrent: ++nonce };
      }
      const selected = configs.find((row) => filters.every(([key, value]) => key === "settings" && value !== null
        ? JSON.stringify(row.settings) === value : (row[key] ?? null) === value));
      if (action === "insert") {
        if (configs.some((row) => row.user_id === patch.user_id)) return { data: null, error: { code: "23505", message: "duplicate" } };
        configs.push(structuredClone(patch));
        return { data: null, error: null };
      }
      if (selected && action === "update") Object.assign(selected, structuredClone(patch));
      return { data: single ? (selected ? structuredClone(selected) : null) : selected ? [{ user_id: selected.user_id }] : [], error: null };
    };
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      is(key: string, value: unknown) { filters.push([key, value]); return query; },
      update(value: Row) { action = "update"; patch = value; return query; },
      insert(value: Row) { action = "insert"; patch = value; return query; },
      upsert(value: unknown) {
        operations.push({ table, action: "upsert", filters: [], patch: value });
        return Promise.resolve({ data: null, error: options.bubbleError ? { message: "bubble unavailable" } : null });
      },
      maybeSingle: () => run(true),
      then(resolveResult: (value: unknown) => unknown) { return run().then(resolveResult); },
    };
    return query;
  } };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/appBubbleAccessProvisioning.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => {
    if (name === "server-only") return {};
    if (name === "@/lib/supabaseAdmin") return { supabaseAdmin: client };
    if (name === "@/lib/bubbleAccess") return bubbleAccess;
    if (name === "@/lib/newAccountNativeChannelDefaults") return nativeDefaults;
    throw new Error(`Unexpected dependency ${name}`);
  });
  return { api: loaded.exports as typeof import("../../lib/appBubbleAccessProvisioning.ts"), configs, operations,
    setBeforeWrite: (callback: () => void) => { beforeWrite = callback; } };
}

test("le provisionnement crée une configuration absente sur le seul compte nouveau", async () => {
  const h = harness(undefined, { absent: true });
  await h.api.provisionNewAccountBubbleAccess(ACCOUNT);
  assert.deepEqual(h.configs.find((row) => row.user_id === ACCOUNT), { user_id: ACCOUNT, settings: expected });
  assert.deepEqual(h.configs.find((row) => row.user_id === OTHER)?.settings, { inrSearch: { enabled: true, slug: "other" } });
  assert.equal(h.operations[0].table, "app_bubble_access");
  const seeded = h.operations[0].patch as Array<{ user_id: string }>;
  assert.ok(seeded.length > 3 && seeded.every((row) => row.user_id === ACCOUNT));
});

test("le CAS complète les champs manquants en préservant une sauvegarde concurrente et les autres colonnes", async () => {
  const h = harness({ site_web: { url: "https://pro.example/" } });
  h.setBeforeWrite(() => {
    h.configs[0].settings = { ...(h.configs[0].settings as Row), facebook: { url: "https://facebook.com/pro" } };
  });
  await h.api.provisionNewAccountBubbleAccess(ACCOUNT);
  assert.deepEqual(h.configs[0].settings, { site_web: { url: "https://pro.example/" }, facebook: { url: "https://facebook.com/pro" }, ...expected });
  assert.equal(h.configs[0].unrelated_column, "keep");
  assert.equal(h.operations.filter((operation) => operation.action === "update").length, 2);
  assert.ok(h.operations.filter((operation) => operation.action !== "upsert").every((operation) => operation.filters.some(([key, value]) => key === "user_id" && value === ACCOUNT)));
});

test("une collision d’insertion relit le compte et garde une activation explicite arrivée entre-temps", async () => {
  const h = harness(undefined, { absent: true });
  h.setBeforeWrite(() => h.configs.push({ user_id: ACCOUNT, settings: { inrBadge: { enabled: true, activationVersion: 1, title: "Choisi" } } }));
  await h.api.provisionNewAccountBubbleAccess(ACCOUNT);
  assert.deepEqual(h.configs.find((row) => row.user_id === ACCOUNT)?.settings, {
    ...expected, inrBadge: { enabled: true, activationVersion: 1, title: "Choisi" },
  });
});

test("une récupération répétée ne réécrit ni les choix natifs ni la configuration", async () => {
  const h = harness({ ...expected, inrBadge: { enabled: true, activationVersion: 1 }, custom: "keep" });
  await h.api.provisionNewAccountBubbleAccess(ACCOUNT);
  assert.equal(h.operations.filter((operation) => ["insert", "update"].includes(operation.action)).length, 0);
});

test("les conflits restent bornés à quatre tentatives et une erreur n’est pas déclarée réussie", async () => {
  const h = harness({ site_web: { url: "https://pro.example/" } }, { alwaysConflict: true });
  await assert.rejects(h.api.provisionNewAccountBubbleAccess(ACCOUNT), /CONCURRENT_SAVE/u);
  assert.equal(h.operations.filter((operation) => operation.action === "update").length, 4);
  const unavailable = harness({}, { readError: true });
  await assert.rejects(unavailable.api.provisionNewAccountBubbleAccess(ACCOUNT), /DEFAULTS_FAILED/u);
  const denied = harness({}, { bubbleError: true });
  await assert.rejects(denied.api.provisionNewAccountBubbleAccess(ACCOUNT), /BUBBLE_ACCESS_PROVISIONING_FAILED/u);
  assert.equal(denied.operations.length, 1);
});

test("une configuration malformée est refusée au lieu d’être effacée", async () => {
  const h = harness("existing non-object settings");
  await assert.rejects(h.api.provisionNewAccountBubbleAccess(ACCOUNT), /INVALID_SETTINGS/u);
  assert.equal(h.configs[0].settings, "existing non-object settings");
  assert.equal(h.operations.filter((operation) => ["insert", "update"].includes(operation.action)).length, 0);
});
