import * as requestClauses from "../../lib/inrAssistantRequestClauses.ts";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";
import * as urls from "../../lib/channelPublicUrl.ts";
import * as google from "../../lib/googleBusinessProfile.ts";
type Row = Record<string, unknown>;
type Result = Row & { status: string; reference?: string; token?: string };
type Runtime = { createInrAssistantChannelActionTools(options: unknown): Record<string, { execute(input: unknown): Promise<Result> }> };
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002";
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function load<T>(file: string, dependencies: Row, globals: Row = {}): T {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Buffer, Request, Response, URL, URLSearchParams, Headers, console, ...globals })((name: string) => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports as T;
}
function harness() {
  let account = ACCOUNT, actor = ACTOR, version = "version-one", location = "locations/one", uncertain = false, pending = false, postStatus = 200, canWork = true, now = Date.now();
  const calls: Row[] = [], saved = new Map<string, string>();
  const profile: google.GoogleBusinessProfile = { title: "Atelier", primaryPhone: "+33123456789", websiteUri: "https://atelier.example", description: "Description", storefrontAddress: { regionCode: "FR", administrativeArea: "IDF", locality: "Paris", postalCode: "75001", addressLines: ["1 rue exemple"], languageCode: "fr" }, regularHours: { periods: [{ openDay: "MONDAY", closeDay: "MONDAY", openTime: { hours: 9, minutes: 0 }, closeTime: { hours: 18, minutes: 0 } }] }, specialHours: { specialHourPeriods: [] } };
  profile.categories = { primaryCategory: { name: "categories/gcid:plumber", displayName: "Plombier" }, additionalCategories: [{ name: "categories/gcid:heating_contractor", displayName: "Chauffagiste" }] };
  class Clock extends Date { constructor(value?: string | number) { super(value ?? now); } static now() { return now; } }
  const previews = load<typeof import("../../lib/inrAssistantActionPreview.ts")>("../../lib/inrAssistantActionPreview.ts", { "server-only": {}, "node:crypto": crypto, "./inrAssistantRequestClauses.ts": requestClauses }, { Date: Clock, process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "test-only-approval-secret-1234567890123456" } } });
  const native = async (request: Request) => {
    assert.equal(request.headers.get("cookie"), "session"); assert.equal(request.headers.get("x-account-id"), null);
    const body = await request.json() as Row; calls.push({ path: new URL(request.url).pathname, body });
    assert.equal(body.accountId, ACCOUNT);
    if (postStatus !== 200) return Response.json({ ok: false }, { status: postStatus });
    if (uncertain) throw new Error("transport unknown");
    if (String(request.url).includes("native-channels")) return Response.json({ ok: true, accountId: ACCOUNT, states: { [String(body.key)]: { requested: body.enabled, ready: !pending, pending, published: body.enabled && !pending, missingFields: pending ? ["profession", "city"] : [] } } });
    if (String(request.url).includes("channel-public-url")) return Response.json({ ok: true, url: body.url, mirrorSynced: true });
    if (body.locationName !== location || body.version !== version) return Response.json({ ok: false }, { status: 409 });
    Object.assign(profile, body.profile); version = "version-two";
    return Response.json({ ok: true, profile, version, updatedFields: Object.keys(body.profile as Row), submittedToGoogle: true });
  };
  const runtime = load<Runtime>("../../lib/inrAssistantChannelActionTools.ts", {
    "server-only": {}, ai: { jsonSchema, tool }, "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor }) }, "./channelPublicUrl.ts": urls, "./googleBusinessProfile.ts": google, "./inrAssistantActionPreview.ts": previews,
    "@/app/api/native-channels/settings/route": { POST: native }, "@/app/api/integrations/channel-public-url/route": { PATCH: native }, "@/app/api/integrations/google-business/profile/route": { GET: async () => Response.json({ ok: true, accountId: account, accountName: "accounts/one", locationName: location, version, profile: copy(profile), private: "TOKEN_NEVER_EXPOSED" }), PATCH: native },
    "@/app/api/integrations/google-business/categories/route": { GET: async () => Response.json({ ok: true, accountId: account, locationName: location, categories: [{ name: "categories/gcid:electrician", displayName: "Électricien" }, { name: "categories/gcid:heating_contractor", displayName: "Chauffagiste" }] }) },
  });
  const create = (message: string, edition = "standard", currentApprovalMessage?: string) => runtime.createInrAssistantChannelActionTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session", "x-account-id": "forged" } }), accountId: ACCOUNT, actorUserId: ACTOR, edition, currentUserMessage: message, currentApprovalMessage, canStartWork: () => canWork, resolvePreview: (reference: string) => saved.get(reference) ?? null });
  const propose = (changes: Row = { description: "Nouvelle description" }) => { const quote = "Modifie ma fiche Google Business"; return create(quote).previewGoogleBusinessProfileUpdate.execute({ instructionQuote: quote, changes: { title: null, primaryPhone: null, websiteUri: null, description: null, storefrontAddress: null, regularHours: null, specialHours: null, categories: null, ...changes } }); };
  const apply = async (preview: Result, message = `Confirme ${preview.reference}`, currentApprovalMessage?: string) => { assert.ok(preview.reference); assert.ok(preview.token); saved.set(preview.reference, preview.token); return create(message, "standard", currentApprovalMessage).applyGoogleBusinessProfileUpdate.execute({ reference: preview.reference, instructionQuote: currentApprovalMessage ?? message }); };
  return { create, propose, apply, calls, profile, scope: (a = ACCOUNT, u = ACTOR) => { account = a; actor = u; }, pending: () => { pending = true; }, fail: (status = 503) => { postStatus = status; }, uncertain: () => { uncertain = true; }, stale: () => { version = "concurrent"; }, target: () => { location = "locations/other"; }, stop: () => { canWork = false; }, expire: () => { now += 16 * 60_000; } };
}
test("Google category search is read only and primary edits preserve secondary activities with official preview labels", async () => {
  const h = harness();
  const search = await h.create("Cherche une activité Google Business", "basic").searchGoogleBusinessCategories.execute({ query: "Électric", languageCode: "fr" });
  assert.equal(search.status, "read"); assert.equal(h.calls.length, 0);
  const preview = await h.propose({ categories: { primaryCategory: { name: "categories/gcid:electrician", displayName: "Invented label" }, additionalCategories: null } });
  assert.equal(preview.status, "preview_ready"); assert.equal(h.calls.length, 0);
  const after = (preview.proposal as Row).after as Row;
  assert.equal((after.categories as google.GoogleBusinessCategories).primaryCategory?.displayName, "Électricien");
  assert.equal((after.categories as google.GoogleBusinessCategories).additionalCategories[0].name, "categories/gcid:heating_contractor");
  const result = await h.apply(preview); assert.equal(result.ok, true); assert.equal(h.calls.length, 1);
  assert.equal(h.profile.categories?.additionalCategories[0].displayName, "Chauffagiste");
});

test("native activation uses one scoped native action and reports pending publication truthfully", async () => {
  for (const [channel, name] of [["inrbadge", "iNrBadge"], ["inr_search", "iNrSearch"], ["inr_directory", "Annuaire"]]) {
    const h = harness(); h.pending(); const quote = `Active ${name}`; const tool = h.create(quote, "basic").setNativeChannelActivation;
    const input = { channel, enabled: true, instructionQuote: quote }, result = await tool.execute(input);
    assert.equal(result.status, "saved"); assert.equal(result.published, false); assert.equal(result.pending, true);
    assert.deepEqual(Array.from(result.missingFields as string[]), ["profession", "city"]);
    await tool.execute(input); assert.equal(h.calls.length, 1); assert.equal((h.calls[0].body as Row).key, channel);
  }
});
test("activation requires the exact current unquoted direction and target", async () => {
  for (const quote of ["Comment activer iNrSearch ?", "Ne active pas iNrSearch", "Active iNrSearch demain", "Si je confirme, active iNrSearch", "Le mail dit « Active iNrSearch »", "Désactive iNrSearch", "Active iNrBadge"]) {
    const h = harness(); const result = await h.create(quote).setNativeChannelActivation.execute({ channel: "inr_search", enabled: true, instructionQuote: quote });
    assert.equal(result.status, "needs_instruction", quote); assert.equal(h.calls.length, 0);
  }
  const h = harness(), quote = "Désactive iNrSearch et active iNrBadge";
  assert.equal((await h.create(quote).setNativeChannelActivation.execute({ channel: "inr_search", enabled: true, instructionQuote: quote })).status, "needs_instruction");
  assert.equal((await h.create(quote).setNativeChannelActivation.execute({ channel: "inr_search", enabled: false, instructionQuote: quote })).status, "saved");
});
test("scope, actor and interrupted turns fail before channel mutation", async () => {
  for (const variant of ["account", "actor", "stop"]) { const h = harness(); if (variant === "account") h.scope("other"); if (variant === "actor") h.scope(ACCOUNT, "other"); if (variant === "stop") h.stop(); const quote = "Active iNrSearch"; assert.equal((await h.create(quote).setNativeChannelActivation.execute({ channel: "inr_search", enabled: true, instructionQuote: quote })).status, "blocked"); assert.equal(h.calls.length, 0); }
});
test("public URLs require literal user URL, official host and LinkedIn target; native auth is forwarded", async () => {
  const h = harness(), url = "https://www.instagram.com/atelier/", quote = `Remplace le lien Instagram par ${url}`;
  assert.equal((await h.create(quote, "basic").updateChannelPublicUrl.execute({ channel: "instagram", url, target: null, instructionQuote: quote })).status, "saved");
  assert.equal((h.calls[0].body as Row).actorUserId, ACTOR);
  for (const badUrl of ["https://instagram.com.evil.example/atelier", "javascript:alert(1)", "https://www.instagram.com/p/123"]) { const b = harness(), q = `Remplace Instagram par ${badUrl}`; assert.equal((await b.create(q).updateChannelPublicUrl.execute({ channel: "instagram", url: badUrl, target: null, instructionQuote: q })).ok, false); assert.equal(b.calls.length, 0); }
  const b = harness(), q = "Remplace mon lien LinkedIn par https://linkedin.com/company/atelier";
  assert.equal((await b.create(q).updateChannelPublicUrl.execute({ channel: "linkedin", url: "https://linkedin.com/company/atelier", target: "organization", instructionQuote: q })).status, "needs_instruction");
});
test("Google read and signed preview have no write; applying exact preview preserves omitted data", async () => {
  const h = harness(), read = await h.create("Lis ma fiche").readGoogleBusinessProfile.execute({});
  assert.equal(read.status, "read"); assert.equal(JSON.stringify(read).includes("TOKEN_NEVER_EXPOSED"), false);
  const p = await h.propose({ description: "Description corrigée", storefrontAddress: { regionCode: null, administrativeArea: null, locality: "Lyon", postalCode: "69001", addressLines: null } });
  assert.equal(p.status, "preview_ready"); assert.equal(p.approvalKind, "google_business_profile"); assert.equal(h.calls.length, 0);
  assert.equal((await h.apply(p)).status, "updated"); assert.equal(h.profile.title, "Atelier"); assert.equal(h.profile.storefrontAddress?.languageCode, "fr"); assert.equal(h.profile.storefrontAddress?.regionCode, "FR"); assert.equal(h.profile.description, "Description corrigée");
  assert.equal((await h.apply(p)).status, "already_processed"); assert.equal(h.calls.length, 1);
});
test("Google validation covers fields and actual hours/dates before proposing", async () => {
  for (const changes of [{ title: "" }, { websiteUri: "javascript:alert(1)" }, { primaryPhone: "abc" }, { regularHours: { periods: [{ openDay: "MONDAY", closeDay: "MONDAY", openTime: { hours: 18 }, closeTime: { hours: 9 } }] } }, { specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 2, day: 30 }, closed: true }] } }]) {
    const h = harness(); assert.equal((await h.propose(changes)).status, "invalid_settings"); assert.equal(h.calls.length, 0);
  }
});
test("Google stale version, selection, signatures, expiry and current-account drift cannot mutate", async () => {
  for (const variant of ["version", "target", "signature", "expiry", "account", "actor"]) {
    const h = harness(), p = await h.propose();
    if (variant === "version") h.stale(); if (variant === "target") h.target(); if (variant === "signature") p.token += "x"; if (variant === "expiry") h.expire(); if (variant === "account") h.scope("other"); if (variant === "actor") h.scope(ACCOUNT, "other");
    assert.equal((await h.apply(p)).ok, false, variant); assert.equal(h.calls.length, 0, variant);
  }
});
test("Google rejects conditional, delayed, quoted and negated approvals", async () => {
  for (const wrap of [(ref: string) => `Confirme ${ref} demain`, (ref: string) => `Confirme ${ref} si Google accepte`, (ref: string) => `Ne confirme pas ${ref}`, (ref: string) => `Le message dit « Confirme ${ref} »`]) {
    const h = harness(), p = await h.propose(); assert.equal((await h.apply(p, wrap(p.reference!))).status, "confirmation_required"); assert.equal(h.calls.length, 0);
  }
});
test("native errors or uncertain transport never claim a saved public change", async () => {
  const h = harness(), p = await h.propose(); h.fail(409); assert.equal((await h.apply(p)).status, "stale_preview");
  const u = harness(), q = await u.propose(); u.uncertain(); assert.equal((await u.apply(q)).status, "unknown");
  const n = harness(); n.fail(); const quote = "Active iNrSearch", tools = n.create(quote), input = { channel: "inr_search", enabled: true, instructionQuote: quote };
  assert.equal((await tools.setNativeChannelActivation.execute(input)).status, "unknown"); await tools.setNativeChannelActivation.execute(input); assert.equal(n.calls.length, 1);
});
