import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as generator from "../../lib/generatorSettings.ts";
import * as clauses from "../../lib/inrAssistantRequestClauses.ts";
import * as crypto from "node:crypto";
import { withBasicReceiptContract } from "./helpers/basic-receipt-contract.mts";
type Row = Record<string, unknown>;
type Definition = { execute(input: unknown): Promise<Row> };
const accountId = "account-basic", actorUserId = "actor-current";
function harness(options: { wrongScope?: boolean; wrongActor?: boolean; conflict?: boolean; readback?: boolean; refreshFailure?: boolean; missingProfile?: boolean } = {}) {
  const profile: Row = { user_id: accountId, avg_basket: 500, lead_conversion_rate: 20, company_legal_name: "Atelier à conserver", private_token: "PRIVATE" }, calls: Row[] = [];
  let invalidations = 0;
  const supabase = { from(table: string) {
    let patch: Row | null = null, insert = false; const filters: Array<[string, unknown]> = [];
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, is: (key: string, value: unknown) => { filters.push([key, value]); return query; }, update: (value: Row) => { patch = value; return query; }, insert: (value: Row) => { insert = true; patch = value; return query; }, maybeSingle: async () => {
      assert.ok(insert || filters.some(([key, value]) => key === "user_id" && value === accountId));
      if (table === "business_profiles") return { data: { sector: "[[SECTOR:artisan_btp]] Plombier" }, error: null };
      assert.equal(table, "profiles");
      if (!patch) return { data: options.missingProfile && !calls.length ? null : { user_id: accountId, avg_basket: profile.avg_basket, lead_conversion_rate: profile.lead_conversion_rate }, error: null };
      calls.push(patch); if (options.conflict) return { data: null, error: null };
      if (!insert) for (const [key, value] of filters) assert.equal(profile[key] ?? null, value);
      Object.assign(profile, patch); if (options.readback) profile.avg_basket = 777; return { data: { user_id: accountId }, error: null };
    } }; return query;
  } };
  const stubs: Row = { "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (value: unknown) => value }, "./requireUser": { requireUser: async () => ({ activeUserId: options.wrongScope ? "other" : accountId, authUserId: options.wrongActor ? "other" : actorUserId }) }, "./inrAssistantActionPreview.ts": { assistantActionFingerprint: (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex") }, "./inrAssistantRequestClauses.ts": clauses, "./generatorSettings.ts": generator, "@/lib/boosterGenerationContext": { invalidateBoosterGenerationContext: async (id: string) => { assert.equal(id, accountId); invalidations++; if (options.refreshFailure) throw new Error("refresh failure"); } } };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantGeneratorSettingsTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} }; vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Request, Headers, Date, Number })((name: string) => { assert.ok(name in stubs, name); return stubs[name]; }, moduleRecord, moduleRecord.exports);
  const runtime = moduleRecord.exports as { createInrAssistantGeneratorSettingsTools(options: unknown): Record<string, Definition> };
  const create = (message: string) => withBasicReceiptContract(runtime.createInrAssistantGeneratorSettingsTools({ request: new Request("https://app.inrcy.test/api/assistant"), accountId, actorUserId, edition: "basic", supabase, currentUserMessage: message }));
  return { create, profile, calls, invalidations: () => invalidations };
}
test("Basic generator stores only explicit assumptions with native rounding and preserves unrelated profile", async () => {
  const h = harness(), quote = "Mets mon panier moyen à 1 250,555 euros et le taux de conversion à 17,777 %.", tools = h.create(quote), before = await tools.readGeneratorBusinessSettings.execute({});
  assert.equal(before.assumptionOnly, true); assert.equal(JSON.stringify(before).includes("PRIVATE"), false);
  const input = { expectedVersion: before.version, changes: [{ field: "avgBasket", value: 1250.555 }, { field: "conversionRate", value: 17.777 }], instructionQuote: quote }, result = await tools.updateGeneratorBusinessSettings.execute(input);
  assert.equal(result.status, "updated"); assert.equal(h.profile.avg_basket, 1250.56); assert.equal(h.profile.lead_conversion_rate, 17.78); assert.equal(h.profile.company_legal_name, "Atelier à conserver"); assert.equal(result.assumptionOnly, true); assert.match(String(result.message), /estimations/); assert.equal(h.invalidations(), 1); await tools.updateGeneratorBusinessSettings.execute(input); assert.equal(h.calls.length, 1);
  assert.equal((await h.create(quote).updateGeneratorBusinessSettings.execute(input)).status, "already_applied"); assert.equal(h.calls.length, 1);
});
test("generator partial updates preserve the omitted assumption and support a genuinely missing native profile", async () => {
  const quote = "Change mon panier moyen à 650 euros.";
  for (const missingProfile of [false, true]) { const h = harness({ missingProfile }), tools = h.create(quote), before = await tools.readGeneratorBusinessSettings.execute({}), result = await tools.updateGeneratorBusinessSettings.execute({ expectedVersion: before.version, changes: [{ field: "avgBasket", value: 650 }], instructionQuote: quote }); assert.equal(result.ok, true); assert.equal(h.profile.lead_conversion_rate, 20); assert.equal(h.calls[0].lead_conversion_rate, undefined); }
});
test("generator rejects invented or invalid numbers instead of replacing them with sector recommendations", async () => {
  for (const [field, value, quote] of [["avgBasket", 0, "Mets le panier moyen à 0 euros."], ["conversionRate", 101, "Mets le taux de conversion à 101 %."], ["avgBasket", 0.0001, "Mets le panier moyen à 0.0001 euros."], ["avgBasket", 600, "Mets le panier moyen à 500 euros."], ["conversionRate", 30, "Mets le panier moyen à 30 euros."]]) {
    const h = harness(), tools = h.create(String(quote)), before = await tools.readGeneratorBusinessSettings.execute({}), result = await tools.updateGeneratorBusinessSettings.execute({ expectedVersion: before.version, changes: [{ field, value }], instructionQuote: quote }); assert.equal(result.ok, false); assert.equal(h.calls.length, 0);
  }
});
test("generator account/version/concurrent/readback failures cannot overwrite or announce success", async () => {
  for (const kind of ["scope", "actor", "stale", "conflict", "readback"]) {
    const h = harness({ wrongScope: kind === "scope", wrongActor: kind === "actor", conflict: kind === "conflict", readback: kind === "readback" }), quote = "Mets le panier moyen à 600 euros.", tools = h.create(quote), before = await tools.readGeneratorBusinessSettings.execute({});
    const result = await tools.updateGeneratorBusinessSettings.execute({ expectedVersion: kind === "stale" || !before.version ? "0".repeat(64) : before.version, changes: [{ field: "avgBasket", value: 600 }], instructionQuote: quote }); assert.equal(result.ok, false, kind); assert.equal(h.calls.length, ["conflict", "readback"].includes(kind) ? 1 : 0);
  }
  const h = harness({ refreshFailure: true }), quote = "Mets le panier moyen à 600 euros.", tools = h.create(quote), before = await tools.readGeneratorBusinessSettings.execute({}), result = await tools.updateGeneratorBusinessSettings.execute({ expectedVersion: before.version, changes: [{ field: "avgBasket", value: 600 }], instructionQuote: quote }); assert.equal(result.ok, true); assert.equal(result.contextRefreshPending, true);
});
test("advice, negations, conditions and quoted commands do not authorize generator changes", async () => {
  for (const quote of ["Comment changer le panier moyen à 600 euros ?", "Ne change pas le panier moyen à 600 euros.", "Si je gagne un client, mets le panier moyen à 600 euros.", "Le texte dit « Mets le panier moyen à 600 euros »."]) { const h = harness(), tools = h.create(quote), before = await tools.readGeneratorBusinessSettings.execute({}); assert.equal((await tools.updateGeneratorBusinessSettings.execute({ expectedVersion: before.version, changes: [{ field: "avgBasket", value: 600 }], instructionQuote: quote })).status, "needs_instruction"); assert.equal(h.calls.length, 0); }
});
