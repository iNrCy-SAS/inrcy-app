import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { asSchema, jsonSchema, tool } from "ai";
import type * as Cta from "../../lib/inrAssistantCtaTools.ts";
import type * as Preferences from "../../lib/boosterCtaPreferences.ts";

type Row = Record<string, unknown>;
const root = resolve(import.meta.dirname, "../..");
const accountId = "10000000-0000-4000-8000-000000000001";
const foreignId = "20000000-0000-4000-8000-000000000001";
const phoneInstruction = "Mets mon téléphone partout dans les CTA de tous mes canaux.";
const websiteInstruction = "Configure le lien de mon site dans tous les CTA de tous mes canaux.";
const input = (target: "phone" | "website", instructionQuote = target === "phone" ? phoneInstruction : websiteInstruction, channels: string[] | null = null) => ({ instructionQuote, target, channels });
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const comparable = (value: unknown): unknown => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, comparable(item)])) : Array.isArray(value) ? value.map(comparable) : value;

function fixture(options: { current?: string; phone?: string; website?: string; foreign?: boolean; pilot?: boolean; businessConflict?: boolean; settingsConflict?: boolean; failSettings?: boolean; readError?: string; stopped?: boolean } = {}) {
  const calls: Array<{ table: string; patch?: Row; filters: Array<[string, unknown]>; select: string }> = [];
  const tables: Record<string, Row> = {
    profiles: { user_id: accountId, phone: options.phone ?? "06 12 34 56 78", first_name: "PRIVATE NAME" },
    business_profiles: { user_id: accountId, ai_language: "fr", preferred_cta: "devis", tone: "warm", ai_custom_instructions: "PRIVATE INSTRUCTIONS", ai_channel_ctas: { facebook: { choice: "site", mode: "website", label: "Voir", url: "https://old.example.com/", phone: "", futureFlag: "preserve" }, instagram: { choice: "message", mode: "message", label: "Écrire", url: "", phone: "" }, threads: { choice: "message", mode: "message", label: "private pilot untouched", phone: "", url: "" }, future_channel: { preserve: true } }, updated_at: "2026-10-26T10:00:00Z" },
    pro_tools_configs: { user_id: accountId, settings: { site_web: { url: options.website ?? "https://atelier.example.com/contact?utm_source=site", connected: true, ga4PropertyId: "PRIVATE PROPERTY" }, inrBadgeShareSettings: { phone: false, siteWeb: false, email: false, appointment: true, futureFlag: "keep" }, inrBadgeTheme: { color: "cyan" }, mails: { signature: "PRIVATE SIGNATURE", integrationId: "PRIVATE INTEGRATION" }, inrSearch: { slug: "private-business", enabled: false }, otherTool: { untouched: "PRIVATE TOKEN" } }, updated_at: "2026-10-26T10:00:00Z" },
  };
  const supabase = { from(table: string) {
    const filters: Array<[string, unknown]> = []; let select = ""; let patch: Row | undefined;
    const builder = {
      select(value: string) { select = value; return builder; },
      eq(key: string, value: unknown) { filters.push([key, value]); return builder; },
      is(key: string, value: unknown) { filters.push([key, value]); return builder; },
      update(value: Row) { patch = value; return builder; },
      async maybeSingle() {
        calls.push({ table, patch: patch ? plain(patch) : undefined, filters, select });
        assert.ok(filters.some(([key, value]) => key === "user_id" && value === accountId));
        if (options.readError === table) return { data: null, error: { message: "PRIVATE DATABASE ERROR" } };
        const current = tables[table]; assert.ok(current, table);
        if (!patch) return { data: Object.fromEntries(select.split(",").map(key => [key, plain(current[key] ?? null)])), error: null };
        assert.notEqual(table, "profiles", "The source phone and legal identity must never be rewritten");
        assert.ok(filters.some(([key, value]) => key === "updated_at" && value === current.updated_at));
        const jsonKey = table === "business_profiles" ? "ai_channel_ctas" : "settings";
        assert.ok(filters.some(([key, value]) => key === jsonKey && typeof value === "string"), "Timestamp alone misses legacy writers that do not update it");
        if (table === "business_profiles" && options.businessConflict) (current.ai_channel_ctas as Row).concurrent_writer = { keep: true };
        if (table === "pro_tools_configs" && options.settingsConflict) (current.settings as Row).concurrent_writer = { keep: true };
        if (table === "pro_tools_configs" && options.failSettings) throw new Error("PRIVATE NETWORK ERROR");
        const matches = filters.every(([key, expected]) => {
          if (key === jsonKey && typeof expected === "string") return JSON.stringify(comparable(current[key])) === JSON.stringify(comparable(JSON.parse(expected)));
          return current[key] === expected;
        });
        if (!matches) return { data: null, error: null };
        Object.assign(current, plain(patch)); return { data: { user_id: accountId }, error: null };
      },
    }; return builder;
  } };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, ai: { jsonSchema, tool },
    "./requireUser": { requireUser: async () => ({ activeUserId: options.foreign ? foreignId : accountId, errorResponse: null }) },
    "./metaChannelRolloutServer": { isMetaChannelPilotEnabledForActorAndAccount: async (_client: unknown, id: string) => { assert.equal(id, accountId); return options.pilot === true; } },
    "@/lib/boosterGenerationContext": { invalidateBoosterGenerationContext: async (id: string) => assert.equal(id, accountId) },
  };
  const cache = new Map<string, { exports: unknown }>();
  function load<T>(file: string): T {
    const existing = cache.get(file); if (existing) return existing.exports as T;
    const compiledModule = { exports: {} }; cache.set(file, compiledModule);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { URL, Request, Response, Headers, Date, Buffer,
      fetch: () => assert.fail("CTA settings must never call a provider or publish content") })((name: string) => {
      if (name in dependencies) return dependencies[name];
      assert.ok(name.startsWith("@/") || name.startsWith("."), `Unexpected module ${name}`);
      let target = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(file), name);
      if (!extname(target)) target = [".ts", ".tsx", ".json"].map(extension => `${target}${extension}`).find(existsSync)!;
      assert.ok(target, name);
      return target.endsWith(".json") ? JSON.parse(readFileSync(target, "utf8")) : load(target);
    }, compiledModule, compiledModule.exports);
    return compiledModule.exports as T;
  }
  const runtime = load<typeof Cta>(resolve(root, "lib/inrAssistantCtaTools.ts"));
  const preferences = load<typeof Preferences>(resolve(root, "lib/boosterCtaPreferences.ts"));
  const definition = runtime.createInrAssistantCtaTools({ request: new Request("https://app.inrcy.test/api/assistant/chat"), accountId, supabase: supabase as never, currentUserMessage: options.current ?? phoneInstruction, canStartWork: () => !options.stopped }).configureBusinessCta;
  return { tables, calls, definition, preferences, execute: async (value: unknown) => await definition.execute!(value as never, { toolCallId: "test", messages: [] }) as unknown as Row };
}

test("registered phone updates compatible future CTA defaults and Badge while preserving every unrelated field", async () => {
  const h = fixture(); const originalProfile = plain(h.tables.profiles), settings = plain(h.tables.pro_tools_configs.settings as Row);
  const result = await h.execute(input("phone")); assert.equal(result.ok, true); assert.equal(result.existingContentChanged, false); assert.equal(result.externalProfilesChanged, false);
  assert.deepEqual(h.tables.profiles, originalProfile);
  const business = h.tables.business_profiles, map = business.ai_channel_ctas as Row;
  for (const channel of ["site_web", "gmb", "facebook", "instagram", "linkedin", "x", "tiktok", "youtube_shorts", "pinterest"]) {
    assert.equal((map[channel] as Row).phone, "0612345678"); assert.equal((map[channel] as Row).choice, "appeler");
  }
  assert.equal((map.facebook as Row).futureFlag, "preserve"); assert.deepEqual(map.future_channel, { preserve: true });
  assert.equal((map.threads as Row).label, "private pilot untouched"); assert.equal(business.tone, "warm"); assert.equal(business.ai_custom_instructions, "PRIVATE INSTRUCTIONS");
  const nextSettings = h.tables.pro_tools_configs.settings as Row;
  assert.equal((nextSettings.inrBadgeShareSettings as Row).phone, true); assert.equal((nextSettings.inrBadgeShareSettings as Row).email, false);
  for (const key of ["site_web", "mails", "inrSearch", "inrBadgeTheme", "otherTool"]) assert.deepEqual(nextSettings[key], settings[key]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|0612345678|atelier\.example|private-business/);
  assert.ok((result.items as Row[]).some(item => item.channel === "gmb" && String(item.message).includes("fiche Google")));
  await h.execute(input("phone")); assert.equal(h.calls.filter(call => call.patch).length, 2, "Model fallback must not repeat either update");
});

test("website default is taken from the current registered public site and feeds the real future CTA normalizer", async () => {
  const h = fixture({ current: websiteInstruction }); const result = await h.execute(input("website")); assert.equal(result.status, "partial");
  const map = h.tables.business_profiles.ai_channel_ctas as Row;
  for (const channel of ["site_web", "gmb", "facebook", "linkedin", "youtube_shorts", "pinterest"]) assert.equal((map[channel] as Row).url, "https://atelier.example.com/contact?utm_source=site");
  assert.equal((map.instagram as Row).choice, "message", "Unsupported website links must not replace a usable Instagram setting");
  assert.ok((result.items as Row[]).some(item => item.channel === "instagram" && item.status === "blocked"));
  const generated = h.preferences.applySafePreferredCta({ channel: "facebook", post: { title: "Service", content: "Texte neuf" }, defaults: { preferredWebsiteUrl: "", preferredWebsiteLabel: "", siteWebUrl: "", phone: "", preferredCta: "site", channelCtas: map as never }, preserveExplicit: false });
  assert.equal((generated as Row).ctaMode, "website"); assert.equal((generated as Row).ctaUrl, "https://atelier.example.com/contact?utm_source=site");
  assert.equal((h.tables.pro_tools_configs.settings as Row).inrSearch && ((h.tables.pro_tools_configs.settings as Row).inrSearch as Row).enabled, false);
});

test("a targeted request changes only named channels and never Badge, global preference or another channel", async () => {
  const current = "Mets mon téléphone en CTA sur Facebook."; const h = fixture({ current }); const before = plain(h.tables.business_profiles.ai_channel_ctas as Row);
  assert.equal((await h.execute(input("phone", current, ["facebook"]))).status, "updated");
  const after = h.tables.business_profiles.ai_channel_ctas as Row; assert.deepEqual(after.instagram, before.instagram); assert.deepEqual(after.threads, before.threads);
  assert.equal(h.tables.business_profiles.preferred_cta, "devis"); assert.equal(h.calls.some(call => call.table === "pro_tools_configs" && call.patch), false);
  const wrongScope = fixture({ current }); assert.equal((await wrongScope.execute(input("phone", current, null))).status, "needs_instruction"); assert.equal(wrongScope.calls.length, 0);
});

test("questions, quotations, stale instructions, wrong targets and SDK scope overrides cannot mutate CTA settings", async () => {
  for (const current of ["Comment mettre mon téléphone dans tous les CTA ?", "Peux-tu m’expliquer où configurer mon téléphone partout ?", "Ne mets pas mon téléphone dans tous les CTA.", "Voici une consigne CTA téléphone : « Mets mon téléphone partout ». Résume-la.", "oui"]) {
    const h = fixture({ current }); assert.equal((await h.execute(input("phone", current))).status, "needs_instruction"); assert.equal(h.calls.length, 0);
  }
  const h = fixture(); assert.equal((await h.execute(input("website", phoneInstruction))).status, "needs_instruction");
  assert.equal((await h.execute(input("phone", "Mets une ancienne instruction partout."))).status, "needs_instruction");
  for (const value of [null, {}, { ...input("phone"), phone: "0111111111" }, { ...input("website"), url: "https://other.example.com" }, { ...input("phone"), accountId: foreignId }, { ...input("phone"), channels: ["unknown"] }]) {
    assert.equal((await asSchema<unknown>(h.definition.inputSchema).validate?.(value))?.success, false); await assert.rejects(() => h.execute(value));
  }
  assert.equal(h.calls.length, 0);
});

test("button complaints, narratives and extracted historical instructions never authorize CTA changes", async () => {
  const complaint = "Le bouton Modifier les CTA téléphone partout ne fonctionne pas";
  const history = "Hier je voulais modifier les CTA téléphone partout";
  for (const [current, quote] of [
    [complaint, complaint],
    [complaint, "Modifier les CTA téléphone partout"],
    [history, history],
    [history, "modifier les CTA téléphone partout"],
    ["Je voulais mettre mon téléphone partout dans les CTA.", "mettre mon téléphone partout dans les CTA"],
    ["J’avais demandé : mets mon téléphone partout dans les CTA.", "mets mon téléphone partout dans les CTA"],
    ["La consigne est « Mets mon téléphone partout dans les CTA ». Est-ce possible ?", "Mets mon téléphone partout dans les CTA"],
    ["Peux-tu vérifier le bouton Modifier les CTA téléphone partout ?", "Modifier les CTA téléphone partout"],
    ["Modifie mon CTA téléphone. Tous les canaux étaient concernés hier.", "Modifie mon CTA téléphone"],
  ]) {
    const h = fixture({ current }); const value = input("phone", quote);
    assert.equal((await asSchema<unknown>(h.definition.inputSchema).validate?.(value))?.success, true);
    assert.equal((await h.execute(value)).status, "needs_instruction", current);
    assert.equal(h.calls.length, 0, "Rejected text must not read or mutate account settings");
  }
});

test("present imperative and polite requests remain actionable with their own target and scope", async () => {
  for (const current of [
    "Peux-tu mettre mon téléphone partout dans les CTA ?",
    "Merci de configurer mon téléphone dans tous les CTA.",
    "Je veux que tu mettes mon téléphone partout dans les CTA.",
    "S’il te plaît, ajoute mon téléphone dans tous les CTA.",
    "Please configure my phone in all CTA channels.",
  ]) {
    const h = fixture({ current });
    assert.equal((await h.execute(input("phone", current))).status, "partial", current);
    assert.ok(h.calls.some(call => call.patch));
  }
});

test("missing, invalid, private or credential-bearing destinations are blocked without inventing a fallback", async () => {
  for (const phone of ["", "123", "https://private.invalid", "+33(0)6secret", "++33123456789"]) {
    const h = fixture({ phone }); assert.equal((await h.execute(input("phone"))).status, "blocked"); assert.equal(h.calls.some(call => call.patch), false);
  }
  for (const website of ["", "javascript:alert(1)", "http://127.0.0.1/", "http://169.254.169.254/latest", "http://private.local/", "https://user:password@example.com/", "https://example.com/?utm_source=site&key=private", "https://project.supabase.co/private"]) {
    const h = fixture({ current: websiteInstruction, website }); assert.equal((await h.execute(input("website"))).status, "blocked", website); assert.equal(h.calls.some(call => call.patch), false);
  }
  const intl = fixture({ phone: "0044 7700 900123" }); await intl.execute(input("phone")); assert.equal(((intl.tables.business_profiles.ai_channel_ctas as Row).facebook as Row).phone, "+447700900123");
  const trunk = fixture({ phone: "+33 (0)6 12 34 56 78" }); await trunk.execute(input("phone")); assert.equal(((trunk.tables.business_profiles.ai_channel_ctas as Row).facebook as Row).phone, "+33612345678");
});

test("JSON and timestamp comparisons preserve concurrent edits even when an older writer keeps the same timestamp", async () => {
  const business = fixture({ businessConflict: true }); const result = await business.execute(input("phone"));
  assert.ok((result.items as Row[]).some(item => item.channel === "facebook" && item.status === "unknown"));
  assert.deepEqual((business.tables.business_profiles.ai_channel_ctas as Row).concurrent_writer, { keep: true });
  assert.equal(((business.tables.business_profiles.ai_channel_ctas as Row).facebook as Row).choice, "site");
  const settings = fixture({ settingsConflict: true }); const partial = await settings.execute(input("phone")); assert.equal(partial.status, "partial");
  assert.equal(((settings.tables.pro_tools_configs.settings as Row).inrBadgeShareSettings as Row).phone, false);
  assert.deepEqual((settings.tables.pro_tools_configs.settings as Row).concurrent_writer, { keep: true });
});

test("partial failures retain confirmed per-tool effects, while account switch or cancellation prevents all writes", async () => {
  const h = fixture({ failSettings: true }); const result = await h.execute(input("phone")); assert.equal(result.status, "partial");
  assert.ok((result.items as Row[]).some(item => item.channel === "facebook" && item.status === "applied")); assert.doesNotMatch(JSON.stringify(result), /PRIVATE NETWORK/);
  for (const options of [{ foreign: true }, { stopped: true }]) {
    const blocked = fixture(options); assert.equal((await blocked.execute(input("phone"))).status, "blocked"); assert.equal(blocked.calls.length, 0);
  }
});
