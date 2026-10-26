import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { mergeAiBusinessKnowledgeUpdate, mergeAiMemoryUpdate, normalizeAiMemory, normalizeAiBusinessKnowledge } from "../../lib/aiMemory.ts";
import { enforceAiContentLengthForEdition } from "../../lib/aiContentLength.ts";
import { decodeAiInstructionSections, encodeAiInstructionSections } from "../../lib/aiInstructionSections.ts";
import type * as BusinessTools from "../../lib/inrAssistantBusinessTools.ts";
import { DASHBOARD_CHANNEL_CREATE_HREF_BY_KEY } from "../../app/dashboard/dashboard.channel-setup.ts";

type Row = Record<string, unknown>;
type Tool = { execute: (input: unknown) => Promise<Row>; inputSchema: { validate?: (input: unknown) => { success: boolean } } };
const accountId = "active-account";
const instruction = "Ajoute mes prestations et remplis mon ADN avec ma mission et mes horaires.";
const configInstruction = "Modifie ma configuration IA : mets un ton chaleureux et ajoute mes consignes.";
const change = (field: string, text: string | null, items: string[] | null = null, mode = "replace") => ({ field, mode, text, items });

function harness(options: { instruction?: string; edition?: "standard" | "premium" | "founder"; foreignAccount?: boolean; writeError?: boolean; conflict?: boolean; missingBusiness?: boolean } = {}) {
  const calls: { stage: string; body?: Row; request?: Request; filters?: Array<[string, unknown]> }[] = [];
  let memory = normalizeAiMemory({ mission: "Mission conservée", values: ["Respect"], referenceDocuments: [{ id: "doc-a", name: "Privé", path: "private/path", bucket: "private" }] });
  let business = normalizeAiBusinessKnowledge({ description: "Ancienne description", services: ["Entretien"], strengths: ["Savoir-faire"], weeklySchedule: { days: { tuesday: { open: true, allDay: false, slots: [{ start: "09:00", end: "17:00" }] } } } });
  const profile: Row = { user_id: accountId, tone: "serious", ai_language: "fr", services: ["Entretien"], ai_custom_instructions: encodeAiInstructionSections({ instructions: "Instructions conservées", forbiddenInstructions: "Interdiction conservée" }), ai_channel_ctas: { facebook: { action: "site", target: "https://example.invalid" } }, updated_at: "2026-10-26T10:00:00Z", provider_token: "PRIVATE_TOKEN" };
  const supabase = { from(table: string) {
    assert.equal(table, "business_profiles");
    const filters: Array<[string, unknown]> = [];
    let patch: Row | undefined;
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      update: (value: Row) => { patch = value; return builder; },
      maybeSingle: async () => {
        calls.push({ stage: patch ? "config-write" : "config-read", body: patch, filters });
        assert.ok(filters.some(([key, value]) => key === "user_id" && value === accountId));
        if (!patch) return { data: options.missingBusiness ? null : { ...profile }, error: null };
        if (options.writeError) return { data: null, error: new Error("PRIVATE DATABASE ERROR") };
        if (options.conflict) return { data: null, error: null };
        assert.ok(filters.some(([key, value]) => key === "updated_at" && value === profile.updated_at), "The read-modify-write shared instructions column must reject a concurrent profile change");
        Object.assign(profile, patch);
        return { data: { user_id: accountId }, error: null };
      },
    };
    return builder;
  } };
  const stubs: Record<string, unknown> = {
    "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (schema: unknown, config: object) => ({ schema, ...config }) },
    "./aiContentLength.ts": { enforceAiContentLengthForEdition },
    "./aiInstructionSections.ts": { decodeAiInstructionSections, encodeAiInstructionSections },
    "./inrAssistantGuidesAccount.ts": { INR_ASSISTANT_ACCOUNT_GUIDES: [{ id: "channel-facebook", content: "Ouvrez Mes canaux puis Facebook et Connecter. Autorisez le parcours officiel." }, { id: "channel-google-business", content: "Choisissez votre fiche Google Business." }] },
    "../app/dashboard/dashboard.channel-setup.ts": { DASHBOARD_CHANNEL_CREATE_HREF_BY_KEY },
    "@/app/api/ai-memory/route": {
      GET: async () => { calls.push({ stage: "dna-read" }); return Response.json({ ok: true, accountId: options.foreignAccount ? "another-account" : accountId, memory, businessKnowledge: business }); },
      PUT: async (request: Request) => {
        const body = await request.json(); calls.push({ stage: "dna-write", body, request });
        if (options.writeError) return Response.json({ error: "PRIVATE DATABASE ERROR" }, { status: 500 });
        memory = mergeAiMemoryUpdate(memory, body.memory);
        if (body.businessKnowledge) business = mergeAiBusinessKnowledgeUpdate(business, body.businessKnowledge);
        return Response.json({ ok: true, memory, businessKnowledge: business });
      },
    },
    "@/lib/boosterGenerationContext": { invalidateBoosterGenerationContext: async (scope: string) => { assert.equal(scope, accountId); calls.push({ stage: "invalidate" }); } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantBusinessTools.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Request, Response, Headers, Date, console })((name: string) => { assert.ok(name in stubs, name); return stubs[name]; }, record, record.exports);
  const runtime = record.exports as typeof BusinessTools;
  const tools = runtime.createInrAssistantBusinessTools({ request: new Request("https://app.inrcy.test/api/assistant/chat", { headers: { cookie: "session=synthetic", authorization: "Bearer synthetic" } }), accountId, supabase: supabase as never, edition: options.edition || "standard", currentUserMessage: options.instruction ?? instruction });
  return { tools: tools as unknown as Record<keyof typeof tools, Tool>, calls, profile, memory: () => memory, business: () => business };
}

test("DNA writes reuse the real partial-save contract and preserve omitted values and weekdays", async () => {
  const h = harness();
  const input = { instructionQuote: instruction, changes: [change("services", null, ["Réparation"], "append"), change("mission", "Aider les habitants"), change("hours.monday", "09:00-12:00,14:00-18:00")] };
  const result = await h.tools.updateBusinessDna.execute(input);
  assert.equal(result.ok, true);
  assert.equal(result.status, "updated");
  assert.equal(h.business().services.join("|"), "Entretien|Réparation");
  assert.equal(h.memory().mission, "Aider les habitants");
  assert.equal(h.memory().values[0], "Respect");
  assert.equal(h.business().weeklySchedule.days.tuesday.slots[0].end, "17:00");
  assert.equal(h.business().weeklySchedule.days.monday.slots[1].start, "14:00");
  const write = h.calls.find(call => call.stage === "dna-write")!;
  assert.equal(write.request?.method, "PUT");
  assert.equal(write.request?.headers.get("cookie"), "session=synthetic");
  assert.equal(write.request?.headers.get("authorization"), "Bearer synthetic");
  assert.equal(new URL(write.request!.url).pathname, "/api/ai-memory");
  for (const key of ["accountId", "user_id", "referenceDocuments", "sector"]) assert.equal(JSON.stringify(write.body).includes(`"${key}"`), false);
  assert.equal(JSON.stringify(result).includes("private/path"), false);
  await h.tools.updateBusinessDna.execute(input);
  assert.equal(h.calls.filter(call => call.stage === "dna-write").length, 1, "Model fallback must not perform a second write");
});

test("a historical quote, procedural question, negative request or another-account route result cannot authorize a write", async () => {
  for (const current of ["Comment remplir mon ADN ?", "Peux-tu m’expliquer comment remplir mon ADN ?", "Peux-tu m’expliquer où modifier mon ADN ?", "Voici un texte ADN : « Modifie mon ADN ». Résume-le.", "Ne modifie pas mon ADN.", "Dis-moi mon ADN.", "Bonjour", "oui"]) {
    const h = harness({ instruction: current });
    const result = await h.tools.updateBusinessDna.execute({ instructionQuote: current, changes: [change("mission", "Wrong change")] });
    assert.equal(result.status, "needs_instruction");
    assert.equal(h.calls.length, 0);
  }
  const stale = harness({ instruction: "Quelle est ma mission ?" });
  assert.equal((await stale.tools.updateBusinessDna.execute({ instructionQuote: instruction, changes: [change("mission", "Wrong change")] })).ok, false);
  const foreign = harness({ foreignAccount: true });
  assert.equal((await foreign.tools.updateBusinessDna.execute({ instructionQuote: instruction, changes: [change("mission", "Wrong change")] })).ok, false);
  assert.equal(foreign.calls.some(call => call.stage === "dna-write"), false);
});

test("unknown fields, credentials, account overrides and invalid hours are rejected without mutation", async () => {
  const h = harness();
  for (const input of [
    { instructionQuote: instruction, accountId: "foreign", changes: [change("mission", "X")] },
    { instructionQuote: instruction, changes: [change("referenceDocuments", null, [])] },
    { instructionQuote: instruction, changes: [change("mission", "api_key=private-secret")] },
    { instructionQuote: instruction, changes: [change("sector", "hacked")] },
  ]) await assert.rejects(() => h.tools.updateBusinessDna.execute(input));
  const hours = await h.tools.updateBusinessDna.execute({ instructionQuote: instruction, changes: [change("hours.monday", "18:00-09:00")] });
  assert.equal(hours.ok, false);
  assert.equal(h.calls.some(call => call.stage === "dna-write"), false);
});

test("AI configuration updates only requested columns, keeps the other instruction section, and respects the edition", async () => {
  const h = harness({ instruction: configInstruction });
  const result = await h.tools.updateAiConfiguration.execute({ instructionQuote: configInstruction, changes: [change("tone", "warm"), change("instructions", "Écris de façon précise"), change("webLength", "deep")] });
  assert.equal(result.ok, true);
  assert.equal(h.profile.tone, "warm");
  assert.equal(h.profile.ai_language, "fr");
  assert.equal(h.profile.ai_web_length, "long");
  assert.equal((result.applied as Row).webLength, "long");
  assert.equal(decodeAiInstructionSections(h.profile.ai_custom_instructions).forbiddenInstructions, "Interdiction conservée");
  assert.equal(decodeAiInstructionSections(h.profile.ai_custom_instructions).instructions, "Écris de façon précise");
  const patch = h.calls.find(call => call.stage === "config-write")!.body!;
  assert.equal("ai_language" in patch, false);
  assert.equal("ai_channel_ctas" in patch, false);
  assert.equal("provider_token" in patch, false);
  assert.equal(JSON.stringify(result).includes("PRIVATE_TOKEN"), false);
  assert.ok(h.calls.some(call => call.stage === "invalidate"));
});

test("configuration errors and concurrent changes do not become false successes or leak raw errors", async () => {
  for (const options of [{ writeError: true }, { conflict: true }, { missingBusiness: true }]) {
    const h = harness({ ...options, instruction: configInstruction });
    const result = await h.tools.updateAiConfiguration.execute({ instructionQuote: configInstruction, changes: [change("tone", "warm")] });
    assert.equal(result.ok, false);
    assert.equal(h.profile.tone, "serious");
    assert.equal(JSON.stringify(result).includes("PRIVATE DATABASE ERROR"), false);
  }
});

test("adding an AI instruction appends to existing text without replacing the other section", async () => {
  const h = harness({ instruction: configInstruction });
  const result = await h.tools.updateAiConfiguration.execute({ instructionQuote: configInstruction, changes: [change("instructions", "Ajout précis", null, "append")] });
  assert.equal(result.ok, true);
  const decoded = decodeAiInstructionSections(h.profile.ai_custom_instructions);
  assert.equal(decoded.instructions, "Instructions conservées\nAjout précis");
  assert.equal(decoded.forbiddenInstructions, "Interdiction conservée");
});

test("channel guidance returns a named official in-app link and never changes OAuth or connection state", async () => {
  const h = harness({ instruction: "Comment connecter Facebook ?" });
  const result = await h.tools.guideChannelConnection.execute({ channel: "facebook" });
  assert.equal(result.ok, true);
  assert.equal(result.connectionPerformed, false);
  assert.equal(result.connected, undefined, "Reading a guide must not invent a disconnected state");
  assert.equal((result.nextAction as Row).href, "/dashboard?action=channels");
  assert.equal((result.createAction as Row).href, "https://www.facebook.com/pages/create");
  assert.match(String(result.instructions), /Connecter/);
  assert.equal(h.calls.length, 0);
  await assert.rejects(() => h.tools.guideChannelConnection.execute({ channel: "facebook", url: "https://evil.invalid", accountId: "foreign" }));
  await assert.rejects(() => h.tools.guideChannelConnection.execute({ channel: "__proto__" }));
});
