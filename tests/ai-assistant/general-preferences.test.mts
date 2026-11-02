import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as preferences from "../../lib/generalPreferences.ts";
type Row = Record<string, unknown>;
function routeHarness(options: { absent?: boolean; foreign?: boolean; failed?: boolean } = {}) {
  let saved: Row | null = options.absent ? null : { client_language: "fr", timezone: "Europe/Paris", date_format: "dd/MM/yyyy", currency: "EUR", company_name: "Preserved", private: "NEVER_EXPOSE" };
  const writes: Row[] = [], invalidations: unknown[][] = [], filters: Row[] = [];
  const db = { from(table: string) { assert.equal(table, "business_profiles"); const filter: Row = {}; filters.push(filter); const query = { select(columns: string) { assert.equal(columns, "client_language,timezone,date_format,currency"); return query; }, eq(key: string, value: unknown) { filter[key] = value; return query; }, upsert(values: Row, config: Row) { assert.equal(values.user_id, "active"); assert.equal(config.onConflict, "user_id"); writes.push(values); if (!options.failed) saved = { ...saved, ...values }; return query; }, async maybeSingle() { assert.equal(filter.user_id, options.foreign ? "other" : "active"); return { data: saved, error: options.failed ? {} : null }; }, async single() { return { data: saved, error: options.failed ? {} : null }; } }; return query; } };
  const deps: Row = { "next/server": { NextResponse: Response }, "@/lib/requireUser": { requireUser: async () => ({ activeUserId: options.foreign ? "other" : "active", authUserId: "actor", supabase: db }) }, "@/lib/generalPreferences": preferences, "@/lib/boosterGenerationContext": { invalidateBoosterGenerationContext: async (...args: unknown[]) => { invalidations.push(args); } } };
  const source = ts.transpileModule(readFileSync(new URL("../../app/api/preferences/general/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, Response })((name: string) => { assert.ok(name in deps, name); return deps[name]; }, moduleRecord, moduleRecord.exports);
  const route = moduleRecord.exports as { GET(): Promise<Response>; PATCH(request: Request): Promise<Response> };
  const patch = (body: unknown) => route.PATCH(new Request("https://app.test/api/preferences/general", { method: "PATCH", body: JSON.stringify(body) }));
  return { route, patch, writes, invalidations, get: () => saved, filters };
}
test("general read is scoped, contains only supported fields and never creates defaults", async () => {
  for (const absent of [false, true]) { const h = routeHarness({ absent }), response = await h.route.GET(), body = await response.json(); assert.equal(response.status, 200); assert.equal(body.source, absent ? "defaults" : "saved"); assert.equal(body.preferences.currency, "EUR"); assert.equal(JSON.stringify(body).includes("NEVER_EXPOSE"), false); assert.equal(h.writes.length, 0); assert.equal(h.invalidations.length, 0); }
});
test("general patch validates UI options, scopes account and actor, preserves omitted business/preferences fields", async () => {
  const h = routeHarness(), response = await h.patch({ accountId: "active", actorUserId: "actor", preferences: { timezone: "Asia/Bangkok", currency: "CHF" } });
  assert.equal(response.status, 200); assert.equal(h.get()?.timezone, "Asia/Bangkok"); assert.equal(h.get()?.currency, "CHF"); assert.equal(h.get()?.client_language, "fr"); assert.equal(h.get()?.company_name, "Preserved"); assert.equal(h.writes[0].date_format, undefined); assert.deepEqual(h.invalidations, [["active", "professional"]]);
  for (const body of [{ accountId: "other", preferences: { currency: "USD" } }, { accountId: "active", actorUserId: "other", preferences: { currency: "USD" } }, { accountId: "active", preferences: { currency: "BAD" } }, { accountId: "active", preferences: { timezone: "Unknown/Nowhere" } }, { accountId: "active", preferences: { clientLanguage: "unknown" } }, { accountId: "active", preferences: { dateFormat: "arbitrary" } }, { accountId: "active", preferences: { user_id: "other" } }]) { const refused = routeHarness(); assert.ok((await refused.patch(body)).status >= 400); assert.equal(refused.writes.length, 0); }
});
test("general route cannot report successful save after database failure", async () => {
  const h = routeHarness({ failed: true }); assert.equal((await h.patch({ accountId: "active", preferences: { currency: "USD" } })).status, 503); assert.equal(h.invalidations.length, 0);
});
test("shared preference choices match every option in the existing general preferences form", () => {
  const form = readFileSync(new URL("../../app/dashboard/settings/_components/GeneralPreferencesContent.tsx", import.meta.url), "utf8");
  for (const [field, values] of Object.entries(preferences.GENERAL_PREFERENCE_VALUES)) for (const value of values) assert.ok(form.includes(value), `${field} ${value}`);
  assert.match(form, /parseGeneralPreferencesPatch\(form\)/);
  assert.throws(() => preferences.parseGeneralPreferencesPatch(JSON.parse('{"__proto__":{"currency":"USD"}}')));
});
