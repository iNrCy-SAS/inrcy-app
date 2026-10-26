import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";
import type * as Cta from "../../../lib/inrAssistantCtaTools.ts";
import type * as Preferences from "../../../lib/boosterCtaPreferences.ts";

type Row = Record<string, unknown>;
const root = resolve(import.meta.dirname, "../../..");
export const CTA_TEST_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const accountId = CTA_TEST_ACCOUNT_ID;
const foreignId = "20000000-0000-4000-8000-000000000001";
const phoneInstruction = "Mets mon téléphone partout dans les CTA de tous mes canaux.";
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const comparable = (value: unknown): unknown => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, comparable(item)])) : Array.isArray(value) ? value.map(comparable) : value;

export function createCtaToolFixture(options: { current?: string; phone?: string; website?: string; foreign?: boolean; pilot?: boolean; businessConflict?: boolean; settingsConflict?: boolean; failSettings?: boolean; readError?: string; stopped?: boolean } = {}) {
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

