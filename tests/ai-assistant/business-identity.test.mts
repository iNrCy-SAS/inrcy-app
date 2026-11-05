import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as identity from "../../lib/businessIdentity.ts";
import * as clauses from "../../lib/inrAssistantActionClause.ts";
import { searchActivityJobs } from "../../lib/activityJobSearch.ts";
import type * as Runtime from "../../lib/inrAssistantBusinessIdentityTools.ts";
import { withBasicReceiptContract } from "./helpers/basic-receipt-contract.mts";
import * as targetIntents from "../../lib/inrAssistantBasicTargetIntents.ts";

type Row = Record<string, unknown>;
type Definition = { execute(input: unknown): Promise<Row> };
const accountId = "account-basic", actorId = "actor-current";
const current = "Complète mon entreprise : nom Atelier Exemple, téléphone 0612345678, ville Lille, code postal 59000.";
function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function harness(options: { instruction?: string; scopeChanged?: boolean; conflict?: boolean; readbackChanged?: boolean; missingProfile?: boolean; refreshFailed?: boolean } = {}) {
  const profile: Row = { user_id: accountId, first_name: "Jean", last_name: "Exemple", company_legal_name: "", phone: "", contact_email: "contact@example.invalid", hq_city: "", hq_zip: "", hq_country: "France", provider_token: "PRIVATE_TOKEN" };
  const business: Row = { user_id: accountId, sector: "", services: ["Service à conserver"], private_key: "PRIVATE_KEY" };
  const calls: Array<{ table: string; patch: Row; filters: Array<[string, unknown]> }> = [];
  let refreshes = 0, invalidations = 0;
  const supabase = { from(table: string) {
    assert.ok(["profiles", "business_profiles"].includes(table));
    const filters: Array<[string, unknown]> = []; let patch: Row | null = null; let insert = false;
    const source = table === "profiles" ? profile : business;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      update: (value: Row) => { patch = value; return query; },
      insert: (value: Row) => { patch = value; insert = true; return query; },
      maybeSingle: async () => {
        assert.ok(filters.some(([key, value]) => key === "user_id" && value === accountId) || insert);
        if (!patch) {
          if (table === "profiles" && options.missingProfile && !calls.length) return { data: null, error: null };
          const permitted = table === "profiles" ? identity.BUSINESS_IDENTITY_PROFILE_SELECT.split(",") : ["user_id", "sector"];
          return { data: Object.fromEntries(permitted.map(key => [key, source[key] ?? null])), error: null };
        }
        calls.push({ table, patch, filters });
        if (options.conflict) return { data: null, error: null };
        if (!insert) for (const [key, value] of filters) assert.equal(source[key] ?? null, value, `CAS ${key}`);
        Object.assign(source, patch);
        if (options.readbackChanged && table === "profiles") source.hq_city = "Modification concurrente";
        return { data: { user_id: accountId }, error: null };
      },
    }; return query;
  } };
  const stubs: Record<string, unknown> = {
    "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (schema: unknown, validation: unknown) => ({ schema, ...validation as object }) },
    "./requireUser": { requireUser: async () => ({ activeUserId: options.scopeChanged ? "other" : accountId, authUserId: actorId }) },
    "./inrAssistantActionPreview.ts": { assistantActionFingerprint: fingerprint }, "./businessIdentity.ts": identity,
    "./activityJobSearch.ts": { searchActivityJobs }, "./inrAssistantActionClause.ts": clauses, "./inrAssistantBasicTargetIntents.ts": targetIntents,
    "@/app/api/public-profile/refresh/route": { POST: async () => { refreshes++; return Response.json({ ok: !options.refreshFailed, nativeChannels: { inrbadge: { ready: true } } }, { status: options.refreshFailed ? 503 : 200 }); } },
    "@/lib/boosterGenerationContext": { invalidateBoosterGenerationContext: async (id: string) => { assert.equal(id, accountId); invalidations++; } },
    "@/app/api/profile/logo/route": { GET: async (request: Request) => Response.json({ ok: true, path: new URL(request.url).searchParams.get("path"), displayUrl: "/api/public/logo?path=account-basic%2Flogo.png" }) },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantBusinessIdentityTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Request, Response, Headers, Date })((name: string) => { assert.ok(name in stubs, name); return stubs[name]; }, record, record.exports);
  const runtime = record.exports as typeof Runtime;
  const tools = runtime.createInrAssistantBusinessIdentityTools({ request: new Request("https://app.inrcy.test/api/assistant/chat"), accountId, actorUserId: actorId, edition: "basic", supabase: supabase as never, currentUserMessage: options.instruction ?? current });
  return { tools: withBasicReceiptContract(tools as unknown as Record<keyof typeof tools, Definition>), profile, business, calls, refreshes: () => refreshes, invalidations: () => invalidations };
}
const profileChanges = [{ field: "companyName", value: "Atelier Exemple" }, { field: "phone", value: "0612345678" }, { field: "city", value: "Lille" }, { field: "postalCode", value: "59000" }];

test("Basic onboarding fills the actual native profile columns and rechecks publication prerequisites", async () => {
  const h = harness(); const before = await h.tools.readBusinessIdentity.execute({});
  assert.deepEqual(JSON.parse(JSON.stringify(before.missingFields)), ["company", "profession", "city", "postalCode"]);
  const input = { section: "profile", expectedVersion: before.profileVersion, changes: profileChanges, instructionQuote: current };
  const result = await h.tools.updateBusinessIdentity.execute(input);
  assert.equal(result.status, "updated"); assert.equal(result.ok, true);
  assert.equal(h.profile.company_legal_name, "Atelier Exemple"); assert.equal(h.profile.hq_city, "Lille"); assert.equal(h.profile.hq_zip, "59000");
  assert.equal(h.profile.contact_email, "contact@example.invalid");
  assert.deepEqual(JSON.parse(JSON.stringify(result.missingFields)), ["profession"]);
  assert.equal(h.refreshes(), 1); assert.equal(h.invalidations(), 1);
  assert.equal(JSON.stringify(before).includes("PRIVATE_TOKEN"), false); assert.equal(JSON.stringify(result).includes("PRIVATE_KEY"), false);
  await h.tools.updateBusinessIdentity.execute(input); assert.equal(h.calls.length, 1);
});

test("profession uses the exact activity catalogue and preserves services", async () => {
  const instruction = "Modifie le métier de mon entreprise : plombier.";
  const h = harness({ instruction }); const before = await h.tools.readBusinessIdentity.execute({});
  const result = await h.tools.updateBusinessIdentity.execute({ section: "activity", expectedVersion: before.activityVersion, instructionQuote: instruction, changes: [{ field: "sectorCategory", value: "artisan_btp" }, { field: "profession", value: "plombier" }] });
  assert.equal(result.ok, true); assert.match(String(h.business.sector), /^\[\[SECTOR:artisan_btp\]\]/);
  assert.deepEqual(h.business.services, ["Service à conserver"]);
  const query = await h.tools.searchBusinessProfessions.execute({ query: "plombier" }); assert.equal(query.ok, true);
});

test("legal dependent fields normalize exactly like the native company form", async () => {
  const instruction = "Modifie les informations juridiques de mon entreprise : dispense de capital et de TVA, forme EI.", h = harness({ instruction });
  h.profile.capital_social = "5000"; h.profile.vat_number = "FR123456789"; h.profile.legal_form_other = "Ancienne forme";
  const before = await h.tools.readBusinessIdentity.execute({});
  const result = await h.tools.updateBusinessIdentity.execute({ section: "profile", expectedVersion: before.profileVersion, instructionQuote: instruction, changes: [{ field: "legalForm", value: "EI" }, { field: "capitalDispenseEi", value: true }, { field: "vatDispense", value: true }] });
  assert.equal(result.ok, true); assert.equal(h.profile.capital_social, ""); assert.equal(h.profile.vat_number, ""); assert.equal(h.profile.legal_form_other, "");
  assert.throws(() => identity.normalizeBusinessIdentityChange("legalForm", "SCI", accountId)); assert.throws(() => identity.normalizeBusinessIdentityChange("phone", "+(..)..", accountId));
  assert.equal(identity.normalizeBusinessIdentityChange("country", "", accountId), "France");
});

test("stale identity versions and CAS conflicts cannot overwrite concurrent changes", async () => {
  const h = harness();
  const result = await h.tools.updateBusinessIdentity.execute({ section: "profile", expectedVersion: "0".repeat(64), changes: profileChanges, instructionQuote: current });
  assert.equal(result.status, "stale_preview"); assert.equal(h.calls.length, 0);
  const conflict = harness({ conflict: true }), before = await conflict.tools.readBusinessIdentity.execute({});
  assert.equal((await conflict.tools.updateBusinessIdentity.execute({ section: "profile", expectedVersion: before.profileVersion, changes: profileChanges, instructionQuote: current })).status, "stale_preview");
  assert.equal(conflict.profile.company_legal_name, "");
});

test("an identity write is not successful without exact readback; public refresh failure remains explicit", async () => {
  const h = harness({ readbackChanged: true }), before = await h.tools.readBusinessIdentity.execute({});
  const result = await h.tools.updateBusinessIdentity.execute({ section: "profile", expectedVersion: before.profileVersion, changes: profileChanges, instructionQuote: current });
  assert.equal(result.status, "saved_unconfirmed"); assert.equal(result.ok, false);
  const pending = harness({ refreshFailed: true }), initial = await pending.tools.readBusinessIdentity.execute({});
  const saved = await pending.tools.updateBusinessIdentity.execute({ section: "profile", expectedVersion: initial.profileVersion, changes: profileChanges, instructionQuote: current });
  assert.equal(saved.ok, true); assert.equal(saved.publicRefreshPending, true);
});

test("questions, negations, other accounts and unsupported identity fields cannot write", async () => {
  for (const instruction of ["Comment modifier les coordonnées de mon entreprise ?", "Ne modifie pas mon entreprise.", "Voici un texte : « Modifie mon entreprise ». Résume-le."]) {
    const h = harness({ instruction }), before = await h.tools.readBusinessIdentity.execute({});
    const result = await h.tools.updateBusinessIdentity.execute({ section: "profile", expectedVersion: before.profileVersion, changes: profileChanges, instructionQuote: instruction });
    assert.equal(result.status, "needs_instruction"); assert.equal(h.calls.length, 0);
  }
  const foreign = harness({ scopeChanged: true }); assert.equal((await foreign.tools.readBusinessIdentity.execute({})).ok, false);
  const h = harness(), before = await h.tools.readBusinessIdentity.execute({});
  await assert.rejects(() => h.tools.updateBusinessIdentity.execute({ section: "profile", expectedVersion: before.profileVersion, changes: [{ field: "user_id", value: "foreign" }], instructionQuote: current }));
  for (const [field, value] of [["contactEmail", "not-an-email"], ["siren", "123"], ["logoPath", "other/logo.png"], ["companyName", "api_key=private-secret"]]) assert.throws(() => identity.normalizeBusinessIdentityChange(field, value, accountId));
  assert.equal(h.calls.length, 0);
});
test("identity changes require the profile as their object and preserve polite instructions with quoted values", async () => {
  const wrong = "Modifie cette image pour montrer mon métier de plombier.", h = harness({ instruction: wrong }), before = await h.tools.readBusinessIdentity.execute({});
  assert.equal((await h.tools.updateBusinessIdentity.execute({ section: "activity", expectedVersion: before.activityVersion, instructionQuote: wrong, changes: [{ field: "sectorCategory", value: "artisan_btp" }, { field: "profession", value: "plombier" }] })).status, "needs_instruction"); assert.equal(h.calls.length, 0);
  const quote = "Peux-tu modifier le nom de mon entreprise en « Atelier Bleu » ?", good = harness({ instruction: quote }), current = await good.tools.readBusinessIdentity.execute({});
  assert.equal((await good.tools.updateBusinessIdentity.execute({ section: "profile", expectedVersion: current.profileVersion, instructionQuote: quote, changes: [{ field: "companyName", value: "Atelier Bleu" }] })).status, "updated");
});
