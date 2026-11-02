import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as sectors from "../../lib/activitySectors.ts";
import * as catalog from "../../lib/activityCatalog.ts";
import * as settings from "../../lib/inrAgentSettings.ts";
import * as planning from "../../lib/inrAgentEditorialPlanning.ts";
import * as variation from "../../lib/inrAgentEditorialVariation.ts";
import * as focusMode from "../../lib/inrAgentInstantFocusMode.ts";
import * as ideaSelection from "../../lib/inrAgentPublicationIdeaSelection.ts";
import * as ideaReuse from "../../lib/inrAgentPublicationIdeaReuse.ts";

// Execute the complete production services and policies. Only repository,
// provider and random inputs are replaced; no remote operation is performed.
function loadServices(overrides: Record<string, unknown> = {}) {
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:crypto": { ...crypto, randomInt: () => 0, randomUUID: () => "11111111-1111-4111-8111-111111111111" },
    "@/lib/activitySectors": sectors, "@/lib/activityCatalog": catalog,
    "@/lib/inrAgentSettings": settings, "@/lib/inrAgentEditorialPlanning": planning,
    "@/lib/inrAgentEditorialVariation": variation, "@/lib/inrAgentInstantFocusMode": focusMode,
    "@/lib/inrAgentPublicationIdeaSelection": ideaSelection, "@/lib/inrAgentPublicationIdeaReuse": ideaReuse,
    "@/lib/storageContentUrl": { buildStorageContentUrl: (bucket: string, path: string) => `/storage/${bucket}/${path}` },
    "@/lib/boosterPublishGeneration": {}, ...overrides,
  };
  const cache = new Map<string, Record<string, unknown>>();
  const load = (name: string): Record<string, unknown> => {
    if (cache.has(name)) return cache.get(name)!;
    const source = readFileSync(new URL(`../../lib/${name}.ts`, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loaded = { exports: {} as Record<string, unknown> }; cache.set(name, loaded.exports);
    new Function("module", "exports", "require", code)(loaded, loaded.exports, (id: string) => {
      if (id in dependencies) return dependencies[id];
      if (/^@\/lib\/inrAgentPublication(?:Preparation|MediaSelection|MediaAnalysis|EditorialService)/.test(id)) return load(id.slice("@/lib/".length));
      throw new Error(`Unexpected production dependency: ${id}`);
    });
    return loaded.exports;
  };
  return load;
}

const context = Object.freeze({ accountId: "tenant-a", actorAuthUserId: "actor-b", isCron: false });
function editorialHarness(options: { replay?: boolean; refuse?: boolean; existing?: boolean } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const row = { idea_text: "Décrire notre offre", status: options.replay ? "used" : "active", reserved_action_id: null, used_action_id: options.replay ? "other-action" : null };
  const load = loadServices({
    "@/lib/supabaseAdmin": { supabaseAdmin: { marker: "admin-port" } },
    "@/lib/inrAgentPublicationIdeaLifecycle": Object.fromEntries([
      ["releaseAbandonedInrAgentPublicationIdeas", undefined], ["loadInrAgentPublicationIdeas", [row]], ["claimInrAgentPublicationIdea", !options.refuse],
    ].map(([name, result]) => [String(name), async (args: Record<string, unknown>) => { assert.equal(args.userId, context.accountId); calls.push({ name: String(name), args }); return result; }])),
  });
  const service = load("inrAgentPublicationEditorialService") as typeof import("../../lib/inrAgentPublicationEditorialService.ts");
  const policy = load("inrAgentPublicationPreparationPolicy") as typeof import("../../lib/inrAgentPublicationPreparationPolicy.ts");
  const automation = settings.sanitizeInrAgentAutomationSettings("publish", { enabled: true, preferredMediaSource: options.existing ? "media_library" : "ai_generation", useImageBank: true, allowedThemes: ["services"], metadata: { publicationIdeas: [row.idea_text] } });
  const base = { context, automation, storedAgentTone: "professional" as const, business: { company_name: "Atelier", services: "Réparation" }, profile: {}, recentPublications: [], earlierEditorialAngles: [], editorialTarget: null };
  const target = () => ({ id: "slot-a", payload: {}, metadata: options.replay ? { editorialPreviouslyGeneratedIdea: row.idea_text } : {}, plan: policy.normalizeEditorialPlan({ slotKey: "slot-a", scheduledFor: "2026-12-02T12:00:00Z", sequence: 1, totalSlots: 2, theme: "services", tone: "professional", mediaKind: "image", channels: ["facebook"], focus: { source: "professional_idea", subject: row.idea_text } })! });
  return { calls, run: (planned = false) => service.prepareInrAgentEditorialIdea({ ...base, editorialTarget: planned ? target() : null }) };
}

test("editorial preparation claims a manual idea only in the resolved account, distinct from its actor", async () => {
  const h = editorialHarness(); const result = await h.run();
  assert.equal(result.ok, true); assert.equal(result.instantActionId, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.reservedInstantIdea, true); assert.ok(result.runtimeFocus); assert.equal(result.runtimeFocus.subject, "Décrire notre offre");
  assert.deepEqual(h.calls.map(call => call.name), ["releaseAbandonedInrAgentPublicationIdeas", "loadInrAgentPublicationIdeas", "claimInrAgentPublicationIdea"]);
  assert.equal(h.calls[2].args.actionId, "11111111-1111-4111-8111-111111111111");
});

test("editorial replay preserves its already generated idea without another claim", async () => {
  const h = editorialHarness({ replay: true }); const result = await h.run(true);
  assert.equal(result.ok, true); assert.ok(result.runtimeFocus); assert.equal(result.runtimeFocus.subject, "Décrire notre offre");
  assert.equal(result.instantActionId, null);
  assert.equal(h.calls.filter(call => call.name === "claimInrAgentPublicationIdea").length, 0);
});

test("a contended editorial idea returns the same explicit refusal before generation", async () => {
  const h = editorialHarness({ refuse: true });
  assert.deepEqual(await h.run(true), { ok: false, code: "INR_AGENT_IDEA_UNAVAILABLE" });
  assert.equal(h.calls.filter(call => call.name === "claimInrAgentPublicationIdea").length, 1);
});

test("existing-media preparation never reserves an unrelated planned idea", async () => {
  const h = editorialHarness({ existing: true }); const result = await h.run(true);
  assert.equal(result.ok, true); assert.equal(result.runtimeFocus, null);
  assert.equal(h.calls.filter(call => call.name === "claimInrAgentPublicationIdea").length, 0);
});

function mediaHarness(options: { source?: "media_library" | "image_bank" | "ai_generation"; unknownSector?: boolean; ghost?: boolean } = {}) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const pro = [1, 2, 3, 4].map(index => ({ id: `pro-${index}`, storage_path: `tenant-a/${index}.jpg`, media_type: "image", bucket_name: "private-pro", title: `Photo ${index}` }));
  const admin = { from(table: string) {
    const filters: Record<string, unknown> = {};
    return {
      select() { return this; }, eq(key: string, value: unknown) { filters[key] = value; return this; }, gte() { return this; }, order() { return this; }, or() { return this; },
      async limit() {
        calls.push({ table, filters });
        if (["pro_media_library", "inr_agent_actions"].includes(table)) assert.equal(filters.user_id, context.accountId);
        if (table === "inr_agent_actions") return { data: [{ image_assets: [{ id: "pro-1", librarySource: "pro_media_library", storagePath: "tenant-a/1.jpg" }] }] };
        if (table === "pro_media_library") return { data: pro };
        assert.equal(table, "inrcy_image_bank"); assert.ok(filters.sector && filters.sector !== "autre", "no global image bank fallback");
        return { data: [{ id: "bank-1", storage_path: "bank/generic.jpg", sector: filters.sector, job: "generic", tags: ["generic"] }] };
      },
    };
  } };
  const service = loadServices({ "@/lib/supabaseAdmin": { supabaseAdmin: admin } })("inrAgentPublicationMediaSelection") as typeof import("../../lib/inrAgentPublicationMediaSelection.ts");
  const automation = settings.sanitizeInrAgentAutomationSettings("publish", { enabled: true, preferredMediaSource: options.source || "media_library", useImageBank: true });
  return { calls, run: () => service.selectInrAgentPublicationMedia({ context, business: { sector: sectors.encodeBusinessSector(options.unknownSector ? "autre" : "artisan_btp", "") }, automation, agentTheme: "services", ghostOnlyPublication: !!options.ghost, automaticMediaKind: "image", requestedImageCount: 3 }) };
}

test("media selection excludes recent originals and builds three distinct account-owned images", async () => {
  const h = mediaHarness(); const result = await h.run();
  assert.deepEqual(result.fallbackAssets.map((item) => item.id).sort(), ["pro-2", "pro-3", "pro-4"]);
  assert.equal(result.recentMediaUsage.proMediaIds.size, 1, "carousel exclusions do not mutate history memory");
  assert.equal(result.diversifiedMediaSelection.diversificationTrace.decisionReason, "preferred_media_library_selected");
});

test("image bank preference remains business-scoped and never falls back across sectors", async () => {
  const bank = mediaHarness({ source: "image_bank" }); const picked = await bank.run();
  assert.equal(picked.fallbackAssets[0].id, "bank-1");
  const unknown = mediaHarness({ source: "image_bank", unknownSector: true }); const fallback = await unknown.run();
  assert.equal(fallback.fallbackAssets[0].librarySource, "pro_media_library");
  assert.equal(unknown.calls.filter(call => call.table === "inrcy_image_bank").length, 0);
});

test("AI preference keeps existing sources as fallback; Ghost does not select publication media", async () => {
  const ai = await mediaHarness({ source: "ai_generation" }).run();
  assert.equal(ai.diversifiedMediaSelection.diversificationTrace.decisionReason, "ai_generation_preferred_existing_fallback_prepared");
  const ghost = mediaHarness({ ghost: true }); assert.deepEqual((await ghost.run()).fallbackAssets, []);
  assert.deepEqual(ghost.calls.map(call => call.table), ["inr_agent_actions"]);
});

test("the route retains authorization, credit reservation and snapshot guards around the actual services", () => {
  const route = readFileSync(new URL("../../app/api/agent/actions/prepare-publish/route.ts", import.meta.url), "utf8");
  const auth = route.indexOf("if (context.errorResponse) return context.errorResponse");
  const scope = route.indexOf("Object.freeze({ accountId: userId, actorAuthUserId: actorUserId, isCron })");
  const editorial = route.indexOf("await prepareInrAgentEditorialIdea({");
  const reserve = route.indexOf("await reserveInrAgentEditorialCredits({");
  const selection = route.indexOf("await selectInrAgentPublicationMedia({");
  const analysis = route.indexOf("await prepareInrAgentSelectedMediaAnalysis({");
  assert.ok(auth >= 0 && scope > auth && editorial > scope && reserve > editorial && selection > reserve && analysis > selection);
  assert.match(route, /userId: quotaAccountId/);
  assert.match(route, /accountId: userId,\s*actorAuthUserId: actorUserId/);
  assert.match(route, /\.eq\("user_id", userId\)\s*\.eq\("status", "executing"\)/);
});
