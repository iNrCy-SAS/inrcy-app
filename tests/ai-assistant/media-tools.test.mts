import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import * as catalogue from "../../lib/aiMediaModelCatalog.ts";
import * as mediaIntent from "../../lib/inrAssistantMediaIntent.ts";
import * as requestClauses from "../../lib/inrAssistantRequestClauses.ts";
import * as mediaPreview from "../../lib/inrAssistantMediaPreview.ts";
import * as speechBudget from "../../lib/aiMediaVideoSpeechBudget.ts";
import * as videoClientOptions from "../../lib/aiMediaVideoClientOptions.ts";
import type * as MediaTools from "../../lib/inrAssistantMediaTools.ts";

const mediaId = "20000000-0000-4000-8000-000000000001";
const item = { id: mediaId, media_type: "image", title: "Atelier", signed_url: "https://private.invalid/preview?token=secret-synthetic", mime_type: "image/png", width: 1080, height: 1080, duration_seconds: null };
const imageInput = { mediaType: "image", prompt: "Une photo réaliste de mon atelier", format: "square", durationSeconds: null };
const sourceMediaId = "30000000-0000-4000-8000-000000000001";
const sourceReference = { reference: { mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlpQAAAAASUVORK5CYII=", role: "inspiration", usage: "required" }, width: 1080, height: 1350, format: "portrait" };

type HarnessOptions = { currentUserMessage?: string; statusReadOnly?: boolean; saveAuthorizedRequestIds?: string[]; previewTarget?: { requestId: string; mediaId: string }; accepted?: boolean; sourceUnavailable?: boolean; subscriptionActive?: boolean; canStartWork?: boolean; creditsReady?: boolean; remaining?: number; maxDuration?: number; generateError?: boolean; generateBroken?: boolean; acceptError?: boolean; acceptBroken?: boolean; discardBroken?: boolean; discardWrongReadback?: boolean; status?: string; statusResponse?: number; statusCode?: string; statusBroken?: boolean };
function harness(options: HarnessOptions = {}) {
  const calls: { stage: string; body?: Record<string, unknown>; request?: Request; id?: string }[] = [];
  const callbacks: string[] = [];
  const results: MediaTools.InrAssistantMediaResult[] = [];
  let generatedKind = "image";
  let storedStatus = options.status ?? "missing";
  let accepted = options.accepted === true, discarded = false;
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const stubs: Record<string, unknown> = {
    "server-only": {},
    ai: { tool: (value: unknown) => value, jsonSchema: (schema: unknown, config: unknown) => ({ schema, ...config as object }) },
    "./aiMediaGenerationContracts.ts": { normalizeAiMediaGenerationRequest },
    "./aiMediaVideoSpeechBudget.ts": speechBudget,
    "./aiMediaModelCatalog.ts": catalogue,
    "./aiMediaVideoClientOptions.ts": videoClientOptions,
    "./inrAssistantMediaIntent.ts": mediaIntent,
    "./inrAssistantRequestClauses.ts": requestClauses,
    "./inrAssistantMediaPreview.ts": mediaPreview,
    "./inrAssistantMediaSource.ts": { loadInrAssistantImageReference: async (id: string) => {
      calls.push({ stage: "source", id });
      if (options.sourceUnavailable) throw new Error("Private Storage path users/other-account/secret.png unavailable");
      return sourceReference;
    } },
    "./inrAssistantMediaAccess.ts": { checkInrAssistantMediaGenerationAccess: async () => {
      calls.push({ stage: "access" });
      return options.subscriptionActive === false
        ? { allowed: false, code: "subscription_inactive", message: "La création de médias nécessite un abonnement actif. Je peux vous aider à le réactiver." }
        : { allowed: true, accountId: "active-account", authUserId: "authenticated-member" };
    } },
    "@/app/api/media-generation/quota/route": { GET: async () => {
      calls.push({ stage: "quota" });
      return json({ ok: true, quota: { creditsReady: options.creditsReady !== false, videoMaxDurationSeconds: options.maxDuration ?? 30 } });
    } },
    "@/app/api/media-generation/cancel/route": { POST: async (request: Request) => { const body = await request.json(); calls.push({ stage: "cancel", body, request }); assert.equal(storedStatus, "missing"); storedStatus = "failed"; return json({ ok: true, status: "failed", cancellationPreventedReservation: true }); } },
    "@/app/api/media-generation/quote/route": { POST: async (request: Request) => {
      const body = await request.json(); calls.push({ stage: "quote", body, request });
      return json({ ok: true, quote: { totalCredits: 5, quoteId: "account-scoped-synthetic-quote", tariffVersion: "studio-test" }, credits: { remaining: options.remaining ?? 50 } });
    } },
    "@/app/api/media-generation/generate/route": { POST: async (request: Request) => {
      const body = await request.json(); calls.push({ stage: "generate", body, request });
      generatedKind = String(body.kind);
      if (options.generateBroken) { storedStatus = "processing"; throw new Error("Synthetic disconnect, raw provider diagnostics"); }
      if (options.generateError) { storedStatus = "failed"; return json({ ok: false, error: "Crédits média insuffisants." }, 429); }
      storedStatus = "completed";
      return json({ ok: true, draft: true, item: { ...item, media_type: body.kind } });
    } },
    "@/app/api/media-generation/drafts/[id]/accept/route": { POST: async (request: Request, context: { params: Promise<{ id: string }> }) => {
      const { id } = await context.params; calls.push({ stage: "accept", request, id });
      if (options.acceptError) return json({ ok: false, error: "Enregistrement indisponible." }, 500);
      accepted = true; if (options.acceptBroken) throw new Error("lost native acceptance response"); return json({ ok: true, item: { ...item, media_type: generatedKind } });
    } },
    "@/app/api/media-generation/drafts/[id]/route": { DELETE: async (request: Request, context: { params: Promise<{ id: string }> }) => {
      const { id } = await context.params; assert.equal(id, mediaId); assert.equal(request.method, "DELETE"); calls.push({ stage: "discard", request, id });
      discarded = !options.discardWrongReadback; if (options.discardBroken) throw new Error("lost native discard response"); return json({ ok: true, discarded: true, accepted: false });
    } },
    "@/app/api/media-generation/status/route": { GET: async (request: Request) => {
      calls.push({ stage: "status", request });
      if (discarded) return json({ ok: false, status: "completed", code: "AI_MEDIA_RESULT_UNAVAILABLE" }, 410);
      if (options.statusBroken) throw new Error("Synthetic status service outage");
      if (options.statusResponse) return json({ ok: false, code: options.statusCode, error: "Vérification indisponible." }, options.statusResponse);
      if (storedStatus === "missing") return json({ ok: false, status: "missing", code: "AI_MEDIA_GENERATION_NOT_FOUND" }, 404);
      return json({ ok: true, status: storedStatus, draft: !accepted, item: { ...item, media_type: generatedKind }, creditsUsed: 5, error: "La génération a échoué." }, storedStatus === "processing" ? 202 : 200);
    } },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantMediaTools.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { Request, Response, Headers, URL, console })((id: string) => {
    if (!(id in stubs)) throw new Error(`Unexpected dependency: ${id}`);
    return stubs[id];
  }, moduleRecord, moduleRecord.exports);
  const runtime = moduleRecord.exports as typeof MediaTools;
  const createTools = () => runtime.createInrAssistantMediaTools({
    request: new Request("https://app.inrcy.invalid/api/assistant/chat", { headers: { cookie: "session=synthetic", authorization: "Bearer synthetic" } }),
    requestId: "10000000-0000-4000-8000-000000000001",
    currentUserMessage: options.currentUserMessage,
    statusReadOnly: options.statusReadOnly,
    saveAuthorizedRequestIds: options.saveAuthorizedRequestIds,
    previewTarget: options.previewTarget,
    canStartWork: () => options.canStartWork !== false,
    onWorkStarted: (id) => callbacks.push(id), onResult: (result) => results.push(result),
  });
  type TestTool = { execute: (input: unknown) => Promise<MediaTools.InrAssistantMediaResult>; inputSchema: { validate?: (input: unknown) => { success: boolean } }; toModelOutput: (args: { output: MediaTools.InrAssistantMediaResult }) => unknown };
  type TestTools = { generateMedia: TestTool; quoteMediaGeneration: TestTool; modifyMedia: TestTool; getMediaGeneration: TestTool; cancelMediaGeneration: TestTool; acceptMediaGeneration: TestTool; discardMediaGeneration: TestTool };
  return { runtime, tools: createTools() as unknown as TestTools, retryTools: () => createTools() as unknown as TestTools, calls, callbacks, results };
}

test("all media provider schemas require every declared property while legacy runtime calls retain defaults", () => {
  const h = harness();
  const inspect = (value: unknown, location: string) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const schema = value as Record<string, unknown>;
    if (schema.properties && typeof schema.properties === "object") assert.deepEqual([...(schema.required as string[] ?? [])].sort(), Object.keys(schema.properties).sort(), location);
    for (const [key, child] of Object.entries(schema)) if (key !== "enum") { if (Array.isArray(child)) child.forEach((entry, index) => inspect(entry, `${location}.${key}[${index}]`)); else inspect(child, `${location}.${key}`); }
  };
  for (const [name, tool] of Object.entries(h.tools)) inspect((tool.inputSchema as unknown as { schema: unknown }).schema, name);
  assert.equal(h.tools.generateMedia.inputSchema.validate?.(imageInput).success, true);
  assert.equal(h.tools.modifyMedia.inputSchema.validate?.({ sourceMediaId, instruction: "Éclaircis le fond" }).success, true);
});

test("assistant video briefs use 500 characters and exact dialogue is refused before quote or paid generation", async () => {
  const video = { mediaType: "video", prompt: "v".repeat(500), format: "story", durationSeconds: 8, resultMode: "preview", settings: [] };
  const h = harness();
  assert.equal(h.tools.generateMedia.inputSchema.validate?.(video).success, true);
  assert.equal(h.tools.generateMedia.inputSchema.validate?.({ ...video, prompt: "v".repeat(501) }).success, false);
  assert.equal(h.tools.quoteMediaGeneration.inputSchema.validate?.({ ...video, prompt: "v".repeat(501) }).success, false);
  assert.equal(h.tools.generateMedia.inputSchema.validate?.({ ...imageInput, prompt: "i".repeat(3900) }).success, true);
  assert.equal(h.calls.length, 0);
  const result = await h.tools.generateMedia.execute({ ...video, prompt: "Un atelier filmé en lumière naturelle.", settings: [
    { field: "videoEngine", valueJson: '"veo"' }, { field: "teamVideoSpeechMode", valueJson: '"characters"' },
    { field: "spokenScript", valueJson: JSON.stringify("Bonjour ".repeat(40)) },
  ] });
  assert.equal(result.status, "failed");
  assert.match(result.message, /paroles|plan|réplique/i);
  assert.doesNotMatch(result.message, /AI_MEDIA_|ai_media_/);
  assert.ok(!h.calls.some(call => ["quote", "generate", "accept"].includes(call.stage)));
});

test("a read-only follow-up distinguishes ready draft from saved media without accepting or generating", async()=>{
  for(const accepted of [false,true]) {
    const h=harness({status:"completed",statusReadOnly:true,accepted});
    const result=await h.tools.getMediaGeneration.execute({requestId:"assistant_existing_generation"});
    assert.equal(result.status,accepted?"completed":"ready_to_save");
    assert.deepEqual(h.calls.map(call=>call.stage),["status"]);
  }
});

test("media cancellation only claims a pre-reservation stop and never pretends a running provider job can be cancelled", async () => {
  const requestId = "assistant_10000000-0000-4000-8000-000000000001_media", instructionQuote = "Annule cette génération";
  const input = { requestId, mediaType: "image", instructionQuote };
  const before = harness({ currentUserMessage: instructionQuote });
  assert.equal((await before.tools.cancelMediaGeneration.execute(input)).status, "cancelled"); assert.deepEqual(before.calls.map(call => call.stage), ["status", "cancel"]);
  for (const [status, expected] of [["processing", "cannot_cancel"], ["completed", "already_completed"], ["failed", "already_stopped"]]) {
    const h = harness({ status, currentUserMessage: instructionQuote }); assert.equal((await h.tools.cancelMediaGeneration.execute(input)).status, expected); assert.deepEqual(h.calls.map(call => call.stage), ["status"]);
  }
  const absent = harness({ currentUserMessage: instructionQuote }); assert.equal((await absent.tools.cancelMediaGeneration.execute({ ...input, requestId: "assistant_foreign_request" })).status, "not_found"); assert.deepEqual(absent.calls.map(call => call.stage), ["status"]);
  const question = harness({ currentUserMessage: "Explique comment annuler cette génération" }); assert.equal((await question.tools.cancelMediaGeneration.execute({ ...input, instructionQuote: "Explique comment annuler cette génération" })).status, "needs_instruction"); assert.equal(question.calls.length, 0);
  const readOnly = harness({ currentUserMessage: instructionQuote, statusReadOnly: true }); assert.equal((await readOnly.tools.cancelMediaGeneration.execute(input)).status, "blocked"); assert.equal(readOnly.calls.length, 0);
});

test("creation reuses quota, signed quote, real generation and draft acceptance in that order", async () => {
  const h = harness();
  const result = await h.tools.generateMedia.execute(imageInput);
  assert.equal(result.status, "completed");
  assert.equal(result.media?.id, mediaId);
  assert.deepEqual(h.calls.map((call) => call.stage), ["status", "access", "quota", "quote", "generate", "accept"]);
  const body = h.calls.find((call) => call.stage === "generate")!.body!;
  assert.equal(body.contractVersion, 4);
  assert.equal(body.creationMode, "free");
  assert.equal(body.freePrompt, imageInput.prompt);
  assert.equal(body.useBusinessDna, true);
  assert.equal(body.imageEngine, "flux");
  assert.equal(body.expectedCredits, 5);
  assert.equal(body.creditQuoteId, "account-scoped-synthetic-quote");
  assert.equal(body.creditTariffVersion, "studio-test");
  assert.equal(body.requestId, result.requestId);
  assert.equal(h.callbacks[0], result.requestId);
  for (const key of ["accountId", "authUserId", "quota", "adminUnlimited", "limitOverride"]) assert.equal(key in body, false);
  assert.equal(h.calls.find((call) => call.stage === "generate")?.request?.headers.get("cookie"), "session=synthetic");
  assert.equal(h.calls.find((call) => call.stage === "accept")?.id, mediaId);
});

test("a Studio cost question calls the native quote only and never accepts an existing draft", async () => {
  const h = harness({ status: "completed", currentUserMessage: "Combien coûte cette image ?" });
  const result = await h.tools.quoteMediaGeneration.execute({ ...imageInput, settings: [{ field: "imageEngine", valueJson: '"openai"' }, { field: "useBusinessDna", valueJson: "false" }] });
  assert.equal(result.status, "quoted"); assert.equal(result.creditsUsed, 5); assert.deepEqual(h.calls.map(call => call.stage), ["access", "quota", "quote"]); assert.equal(h.results.length, 0); assert.equal(h.callbacks.length, 0);
  assert.equal(h.calls.find(call => call.stage === "quote")!.body!.imageEngine, "openai");
});

test("Studio image references are resolved by owned IDs and included in native quote and generation", async () => {
  const h = harness();
  const result = await h.tools.generateMedia.execute({ ...imageInput, settings: [{ field: "referenceMediaIds", valueJson: JSON.stringify([sourceMediaId]) }, { field: "useBusinessDna", valueJson: "false" }] });
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(h.calls.find(call => call.stage === "source")!.id, sourceMediaId);
  const quote = h.calls.find(call => call.stage === "quote")!.body!, body = h.calls.find(call => call.stage === "generate")!.body!;
  assert.equal(quote.inspirationImagesCount, 1); assert.equal(body.useBusinessDna, false); assert.equal(body.identityConsent, false); assert.equal((body.inspirationImages as unknown[]).length, 1);
  const serialized = JSON.stringify(h.tools.generateMedia.toModelOutput({ output: result })); assert.equal(serialized.includes(sourceReference.reference.data), false);
});

test("Studio narration and exact script reach the native generation instead of remaining in prompt prose", async () => {
  const h = harness();
  const result = await h.tools.generateMedia.execute({ mediaType: "video", prompt: "Une présentation filmée de mon atelier", format: "story", durationSeconds: 8, settings: [{ field: "videoEngine", valueJson: '"grok-lite"' }, { field: "withMusic", valueJson: "true" }, { field: "withNarration", valueJson: "true" }, { field: "narrationVoice", valueJson: '"male"' }, { field: "spokenScript", valueJson: '"Bienvenue dans notre atelier."' }] });
  assert.equal(result.status, "completed"); const body = h.calls.find(call => call.stage === "generate")!.body!; assert.equal(body.videoEngine, "grok-lite"); assert.equal(body.spokenScript, "Bienvenue dans notre atelier."); assert.equal(body.withMusic, true); assert.equal(body.withNarration, true); assert.equal(body.narrationVoice, "male");
});

test("fabricated engines, duplicate settings, external reference URLs and implicit identity consent fail before native work", async () => {
  for (const settings of [[{ field: "imageEngine", valueJson: '"invented"' }], [{ field: "useBusinessDna", valueJson: "false" }, { field: "useBusinessDna", valueJson: "true" }], [{ field: "referenceMediaIds", valueJson: '["https://attacker.invalid/photo.jpg"]' }], [{ field: "identityConsent", valueJson: "true" }]]) {
    const h = harness(); await assert.rejects(h.tools.generateMedia.execute({ ...imageInput, settings })); assert.equal(h.calls.length, 0);
  }
});

test("preview generation remains a native temporary draft across fresh status-only follow-ups", async () => {
  const options: HarnessOptions = { currentUserMessage: "Crée une image en aperçu" }, h = harness(options);
  const preview = await h.tools.generateMedia.execute({ ...imageInput, resultMode: "preview" });
  assert.equal(preview.status, "ready_to_save"); assert.equal(preview.ok, true); assert.equal(preview.draft, true); assert.equal(preview.resultMode, "preview"); assert.equal(preview.media?.id, mediaId);
  assert.equal(h.calls.some(call => call.stage === "accept"), false);
  options.currentUserMessage = "Vérifie ma création"; const read = await h.retryTools().getMediaGeneration.execute({ requestId: preview.requestId }); assert.equal(read.status, "ready_to_save"); assert.equal(read.draft, true); assert.equal(read.resultMode, undefined, "a read never invents the original save decision");
  options.currentUserMessage = "Enregistre cet aperçu"; const stillRead = await h.retryTools().getMediaGeneration.execute({ requestId: preview.requestId }); assert.equal(stillRead.status, "ready_to_save"); assert.equal(h.calls.some(call => call.stage === "accept"), false, "GET cannot accept even when saving is mentioned");
  const text = JSON.stringify(h.tools.generateMedia.toModelOutput({ output: preview })); assert.equal(text.includes("private.invalid"), false); assert.equal(text.includes('"draft":true'), true);
});

test("automatic duration and native speech preserve required product/environment references in quote and generation", async () => {
  const h = harness();
  const input = { mediaType: "video", prompt: "Un film en deux scènes de notre produit dans notre atelier", format: "story", durationSeconds: 16, resultMode: "preview", settings: [
    { field: "videoEngine", valueJson: '"grok-lite"' }, { field: "teamVideoSpeechMode", valueJson: '"characters"' }, { field: "spokenScript", valueJson: '"Découvrez notre savoir-faire."' },
    { field: "references", valueJson: JSON.stringify([{ mediaId: sourceMediaId, role: "product", usage: "required", characterIndex: null }, { mediaId, role: "environment", usage: "inspiration", characterIndex: null }]) },
  ] };
  const result = await h.tools.generateMedia.execute(input); assert.equal(result.status, "ready_to_save", JSON.stringify(result));
  const body = h.calls.find(call => call.stage === "generate")!.body!, quote = h.calls.find(call => call.stage === "quote")!.body!;
  assert.equal(body.sceneMode, "multi"); assert.equal(body.connectScenes, false); assert.equal(quote.sceneMode, body.sceneMode); assert.equal(quote.connectScenes, false); assert.equal(body.freePrompt, input.prompt); assert.equal(body.teamVideoSpeechMode, "characters"); assert.equal(body.identityConsent, false); assert.equal(quote.inspirationImagesCount, 2);
  const references = body.inspirationImages as Array<Record<string, unknown>>; assert.equal(references[0].role, "product"); assert.equal(references[0].usage, "required"); assert.equal(references[1].role, "environment"); assert.equal(references[1].usage, "inspiration"); assert.equal(h.calls.some(call => call.stage === "accept"), false);
});

test("automatic Grok duration picks native fifteen or independent thirty seconds identically in quote and generation", async () => {
  for (const videoResolution of ["720p", "1080p"]) for (const [durationSeconds, sceneMode] of [[15, "single"], [30, "multi"]] as const) {
    const input = { mediaType: "video", prompt: "Un film en deux scènes de notre jardin et de notre terrasse", format: "story", durationSeconds, resultMode: "preview", settings: [
      { field: "videoEngine", valueJson: '"grok-lite"' }, { field: "videoResolution", valueJson: JSON.stringify(videoResolution) },
    ] };
    const h = harness(), result = await h.tools.generateMedia.execute(input);
    assert.equal(result.status, "ready_to_save", JSON.stringify(result));
    const quote = h.calls.find(call => call.stage === "quote")!.body!, generated = h.calls.find(call => call.stage === "generate")!.body!;
    const canonical = { videoEngine: "grok-lite", videoResolution, durationSeconds, sceneMode, connectScenes: false };
    for (const [field, value] of Object.entries(canonical)) { assert.equal(quote[field], value, field); assert.equal(generated[field], value, field); }
    assert.equal(generated.freePrompt, input.prompt, "two scenes remains visual content and cannot impose a manual pair");
    const readOnly = harness(), estimate = await readOnly.tools.quoteMediaGeneration.execute(input);
    assert.equal(estimate.status, "quoted");
    const estimateBody = readOnly.calls.find(call => call.stage === "quote")!.body!;
    for (const [field, value] of Object.entries(canonical)) assert.equal(estimateBody[field], value, field);
    assert.equal(readOnly.calls.some(call => call.stage === "generate" || call.stage === "accept"), false);
  }
});

test("duration and resolution incompatibility fail without quote generation source load or callbacks", async () => {
  for (const [videoEngine, videoResolution, durationSeconds] of [["veo", "1080p", 6], ["veo", "720p", 5], ["omni", "1080p", 10]] as const) for (const action of ["generateMedia", "quoteMediaGeneration"] as const) {
    const h = harness(), result = await h.tools[action].execute({ mediaType: "video", prompt: "Un jardin paisible", durationSeconds, settings: [
      { field: "videoEngine", valueJson: JSON.stringify(videoEngine) }, { field: "videoResolution", valueJson: JSON.stringify(videoResolution) },
    ] });
    assert.equal(result.status, "failed"); assert.match(result.message, /durée.*disponible|Résolution indisponible/);
    assert.equal(h.calls.some(call => ["quote", "generate", "source", "accept"].includes(call.stage)), false); assert.deepEqual(h.callbacks, []);
  }
});

test("manual montage settings are absent from both schemas and rejected before any native action", async () => {
  for (const action of ["generateMedia", "quoteMediaGeneration"] as const) {
    const schema = (harness().tools[action].inputSchema as unknown as { schema: { properties: { settings: { items: { properties: { field: { enum: string[] } } } } } } }).schema;
    for (const field of ["sceneMode", "connectScenes"]) assert.equal(schema.properties.settings.items.properties.field.enum.includes(field), false);
    for (const setting of [{ field: "sceneMode", valueJson: '"single"' }, { field: "sceneMode", valueJson: '"multi"' }, { field: "connectScenes", valueJson: "true" }, { field: "connectScenes", valueJson: "false" }]) {
      const h = harness(), input = { mediaType: "video", prompt: "Un film en deux scènes", durationSeconds: 30, settings: [{ field: "videoEngine", valueJson: '"grok-lite"' }, setting] };
      assert.equal(h.tools[action].inputSchema.validate?.(input).success, false);
      await assert.rejects(h.tools[action].execute(input), /Réglages Studio invalides/); assert.deepEqual(h.calls, []); assert.deepEqual(h.callbacks, []);
    }
  }
});

test("automatic duration cannot revive globally retired engines through either native action", async () => {
  for (const [engine, durationSeconds, resolution, message] of [["wan3", 30, "1080p", /Wan 3\.0.*autre moteur/], ["minimax-h3", 15, "768p", /MiniMax H3.*autre moteur/]] as const) for (const action of ["generateMedia", "quoteMediaGeneration"] as const) {
    const h = harness(), input = { mediaType: "video", prompt: "Un jardin paisible", durationSeconds, settings: [{ field: "videoEngine", valueJson: JSON.stringify(engine) }, { field: "videoResolution", valueJson: JSON.stringify(resolution) }] };
    assert.equal(h.tools[action].inputSchema.validate?.(input).success, false);
    await assert.rejects(h.tools[action].execute(input), message); assert.deepEqual(h.calls, []); assert.deepEqual(h.callbacks, []);
  }
});

test("non-identical character inspiration works but faithful identity, provided voice and malformed reference roles cannot acquire implicit consent", async () => {
  const character = [{ mediaId: sourceMediaId, role: "character", usage: "inspiration", characterIndex: 1 }], h = harness();
  assert.equal((await h.tools.generateMedia.execute({ ...imageInput, resultMode: "preview", settings: [{ field: "references", valueJson: JSON.stringify(character) }] })).status, "ready_to_save");
  const personal = harness(); const blocked = await personal.tools.generateMedia.execute({ ...imageInput, settings: [{ field: "references", valueJson: JSON.stringify([{ ...character[0], usage: "required" }]) }] }); assert.equal(blocked.ok, false); assert.match(blocked.message, /confirmation personnelle/); assert.deepEqual(personal.calls.map(call => call.stage), ["status"]);
  for (const references of [[{ ...character[0], voiceMode: "provided", voiceSample: { path: "private/voice.wav" } }], [{ ...character[0], role: "logo" }], [{ ...character[0], usage: "required", characterIndex: null }], [character[0], { ...character[0], mediaId }]]) {
    const bad = harness(); await assert.rejects(bad.tools.generateMedia.execute({ ...imageInput, settings: [{ field: "references", valueJson: JSON.stringify(references) }] })); assert.equal(bad.calls.length, 0);
  }
  await assert.rejects(harness().tools.generateMedia.execute({ ...imageInput, settings: [{ field: "referenceMediaIds", valueJson: JSON.stringify([mediaId]) }, { field: "references", valueJson: "[]" }] }));
});

test("explicit draft acceptance binds exact job/media, verifies native readback and remains idempotent", async () => {
  const message = "Enregistre cet aperçu image dans Mes médias", h = harness({ status: "completed", currentUserMessage: message }), input = { requestId: "assistant_previous_generation", mediaId, instructionQuote: message };
  const [one, two] = await Promise.all([h.tools.acceptMediaGeneration.execute(input), h.tools.acceptMediaGeneration.execute(input)]); assert.equal(one.status, "completed"); assert.equal(one, two); assert.equal(h.calls.filter(call => call.stage === "accept").length, 1); assert.deepEqual(h.calls.map(call => call.stage), ["status", "accept", "status"]);
  const replay = await h.retryTools().acceptMediaGeneration.execute(input); assert.equal(replay.status, "completed"); assert.equal(h.calls.filter(call => call.stage === "accept").length, 1);
  const other = harness({ status: "completed", currentUserMessage: message }); assert.equal((await other.tools.acceptMediaGeneration.execute({ ...input, mediaId: sourceMediaId })).ok, false); assert.equal(other.calls.some(call => call.stage === "accept"), false);
  const namedMessage = "Enregistre cet aperçu « Atelier »", named = harness({ status: "completed", currentUserMessage: namedMessage }); assert.equal((await named.tools.acceptMediaGeneration.execute({ ...input, instructionQuote: namedMessage })).status, "completed");
});

test("paid modification supports a preview without accepting its new draft or touching the source", async () => {
  const h = harness({ currentUserMessage: "Retouche cette image en aperçu" }); const result = await h.tools.modifyMedia.execute({ sourceMediaId, instruction: "Éclaircir légèrement le fond", resultMode: "preview" });
  assert.equal(result.status, "ready_to_save"); assert.equal(result.resultMode, "preview"); assert.equal(h.calls.some(call => call.stage === "accept"), false); assert.equal(h.calls.find(call => call.stage === "source")?.id, sourceMediaId);
});

test("explicit draft discard uses DELETE then owned job absence and never deletes an accepted media", async () => {
  const message = "Refuse ce brouillon image", h = harness({ status: "completed", currentUserMessage: message }), input = { requestId: "assistant_previous_generation", mediaId, instructionQuote: message };
  assert.equal((await h.tools.discardMediaGeneration.execute(input)).status, "discarded"); assert.equal((await h.tools.discardMediaGeneration.execute(input)).status, "discarded"); assert.deepEqual(h.calls.map(call => call.stage), ["status", "discard", "status"]);
  assert.equal((await h.retryTools().discardMediaGeneration.execute(input)).ok, false); assert.equal(h.calls.filter(call => call.stage === "discard").length, 1, "missing prior ownership cannot authorize another deletion");
  const saved = harness({ status: "completed", accepted: true, currentUserMessage: message }); assert.equal((await saved.tools.discardMediaGeneration.execute(input)).ok, false); assert.deepEqual(saved.calls.map(call => call.stage), ["status"]);
});

test("a clicked preview target restricts both draft decisions without granting permission or trusting provider IDs", async () => {
  const requestId = "assistant_previous_generation", previewTarget = { requestId, mediaId };
  for (const action of ["acceptMediaGeneration", "discardMediaGeneration"] as const) {
    const message = action === "acceptMediaGeneration" ? "Enregistre cet aperçu" : "Refuse ce brouillon";
    for (const changed of [{ requestId: "assistant_other_generation", mediaId }, { requestId, mediaId: sourceMediaId }]) {
      const h = harness({ status: "completed", currentUserMessage: message, previewTarget }); assert.equal((await h.tools[action].execute({ ...changed, instructionQuote: message })).ok, false); assert.equal(h.calls.length, 0);
    }
    const question = "Comment enregistrer cet aperçu ?", no = harness({ status: "completed", currentUserMessage: question, previewTarget }); assert.equal((await no.tools[action].execute({ ...previewTarget, instructionQuote: question })).ok, false); assert.equal(no.calls.length, 0);
  }
});

test("all nine localized preview buttons authorize only their exact operation and still reject a substituted target or quoted request", async () => {
  const requestId = "assistant_localized_preview", previewTarget = { requestId, mediaId };
  for (const locale of ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"]) {
    const copy = mediaPreview.inrAssistantMediaPreviewCopy(locale);
    for (const action of ["accept", "discard"] as const) {
      const message = action === "accept" ? copy.keepRequest : copy.discardRequest, tool = action === "accept" ? "acceptMediaGeneration" : "discardMediaGeneration", h = harness({ status: "completed", currentUserMessage: message, previewTarget });
      assert.equal((await h.tools[tool].execute({ requestId, mediaId, instructionQuote: message })).status, action === "accept" ? "completed" : "discarded", `${locale}:${action}`);
      const wrong = harness({ status: "completed", currentUserMessage: message, previewTarget }); assert.equal((await wrong.tools[tool].execute({ requestId, mediaId: sourceMediaId, instructionQuote: message })).ok, false); assert.equal(wrong.calls.length, 0);
      const quoted = `« ${message} »`, data = harness({ status: "completed", currentUserMessage: quoted, previewTarget }); assert.equal((await data.tools[tool].execute({ requestId, mediaId, instructionQuote: quoted })).ok, false); assert.equal(data.calls.length, 0);
    }
  }
});

test("ambiguous draft decisions remain unknown once and refuse counterfeit successful readbacks", async () => {
  for (const [action, options] of [["acceptMediaGeneration", { acceptBroken: true }], ["discardMediaGeneration", { discardBroken: true }], ["discardMediaGeneration", { discardWrongReadback: true }]] as const) {
    const message = action === "acceptMediaGeneration" ? "Enregistre cet aperçu" : "Refuse ce brouillon", h = harness({ status: "completed", currentUserMessage: message, ...options }), input = { requestId: "assistant_previous_generation", mediaId, instructionQuote: message };
    assert.equal((await h.tools[action].execute(input)).status, "unknown"); assert.equal((await h.tools[action].execute(input)).status, "unknown"); assert.equal(h.calls.filter(call => ["accept", "discard"].includes(call.stage)).length, 1);
  }
});

test("only a server-owned default-save receipt can resume native acceptance under an original creation order", async () => {
  const requestId = "assistant_previous_generation", message = "Crée une photo de mon atelier", input = { requestId, mediaId, instructionQuote: message };
  const h = harness({ status: "completed", currentUserMessage: message, statusReadOnly: true, saveAuthorizedRequestIds: [requestId] }); assert.equal((await h.tools.acceptMediaGeneration.execute(input)).status, "completed");
  for (const changed of [{ saveAuthorizedRequestIds: [] }, { saveAuthorizedRequestIds: ["different_generation"] }, { saveAuthorizedRequestIds: [requestId], currentUserMessage: "Crée un aperçu image" }]) {
    const no = harness({ status: "completed", currentUserMessage: message, statusReadOnly: true, ...changed }); const quote = changed.currentUserMessage ?? message; assert.equal((await no.tools.acceptMediaGeneration.execute({ ...input, instructionQuote: quote })).ok, false); assert.equal(no.calls.length, 0);
  }
  for (const message of ["Comment enregistrer cet aperçu ?", "Enregistre cet aperçu demain", "Lis : 'Enregistre cet aperçu'", "Refuse ce brouillon si je confirme", "Ne refuse pas ce brouillon"]) {
    const no = harness({ status: "completed", currentUserMessage: message }); for (const action of ["acceptMediaGeneration", "discardMediaGeneration"] as const) assert.equal((await no.tools[action].execute({ requestId, mediaId, instructionQuote: message })).ok, false); assert.equal(no.calls.length, 0);
  }
});

test("concurrent repeated tool calls and provider fallbacks share one generation promise", async () => {
  const h = harness();
  const [one, two] = await Promise.all([h.tools.generateMedia.execute(imageInput), h.tools.generateMedia.execute(imageInput)]);
  const three = await h.tools.generateMedia.execute(imageInput);
  assert.equal(one, two); assert.equal(two, three);
  assert.equal(h.calls.filter((call) => call.stage === "generate").length, 1);
  assert.equal(h.results.length, 1);
});

test("a fresh HTTP retry recovers the same paid media after its subscription or wallet changes", async () => {
  for (const changed of [{ subscriptionActive: false }, { remaining: 0 }, { creditsReady: false }, { subscriptionActive: false, remaining: 0, creditsReady: false }]) {
    const options: HarnessOptions = {};
    const h = harness(options);
    const first = await h.tools.generateMedia.execute(imageInput);
    const beforeRetry = h.calls.length;
    Object.assign(options, changed);
    const recovered = await h.retryTools().generateMedia.execute({ ...imageInput, prompt: "Le même atelier, brief reformulé par le modèle" });
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.requestId, first.requestId);
    assert.equal(recovered.media?.id, first.media?.id);
    assert.deepEqual(h.calls.slice(beforeRetry).map(call => call.stage), ["status"]);
    assert.equal(h.calls.filter(call => call.stage === "generate").length, 1);
    assert.equal(h.calls.filter(call => call.stage === "quote").length, 1);
    assert.equal(h.callbacks.length, 1);
  }
});

test("existing processing or reserved media returns its identity and requested type without paid work", async () => {
  for (const status of ["processing", "reserved"]) {
    const h = harness({ status, subscriptionActive: false, remaining: 0, canStartWork: false });
    const result = await h.tools.generateMedia.execute({ mediaType: "video", prompt: "Un clip de mon atelier", format: "story", durationSeconds: 8 });
    assert.equal(result.status, "processing");
    assert.equal(result.mediaType, "video");
    assert.match(result.requestId, /^assistant_/);
    assert.deepEqual(h.calls.map(call => call.stage), ["status"]);
    assert.equal(h.callbacks.length, 0);
  }
});

test("failed or expired identities never start a replacement generation on retry", async () => {
  for (const status of ["failed", "expired"]) {
    const h = harness({ status });
    const result = await h.tools.generateMedia.execute(imageInput);
    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.match(result.message, /échoué/);
    assert.deepEqual(h.calls.map(call => call.stage), ["status"]);
  }
});

test("uncertain, unauthorized or malformed status lookups fail closed before admission and quote", async () => {
  for (const options of [
    { statusBroken: true }, { statusResponse: 503 }, { statusResponse: 401 },
    { statusResponse: 404, statusCode: "OTHER_NOT_FOUND" }, { statusResponse: 404 }, { status: "unexpected" },
  ]) {
    const h = harness(options);
    const result = await h.tools.generateMedia.execute(imageInput);
    assert.equal(result.status, "failed");
    assert.deepEqual(h.calls.map(call => call.stage), ["status"]);
    assert.equal(h.callbacks.length, 0);
    assert.doesNotMatch(result.message, /Synthetic/);
  }
});

test("an ambiguous dispatched generation remains recoverable across a fresh factory", async () => {
  const h = harness({ generateBroken: true });
  const first = await h.tools.generateMedia.execute(imageInput);
  const beforeRetry = h.calls.length;
  const retried = await h.retryTools().generateMedia.execute({ ...imageInput, prompt: "Brief reformulé après la déconnexion" });
  assert.equal(first.status, "processing");
  assert.equal(retried.status, "processing");
  assert.equal(retried.requestId, first.requestId);
  assert.deepEqual(h.calls.slice(beforeRetry).map(call => call.stage), ["status"]);
  assert.equal(h.calls.filter(call => call.stage === "generate").length, 1);
});

test("recovery preserves a completed draft awaiting acceptance instead of generating again", async () => {
  const h = harness({ status: "completed", acceptError: true, subscriptionActive: false, remaining: 0 });
  const result = await h.tools.generateMedia.execute(imageInput);
  assert.equal(result.status, "ready_to_save");
  assert.equal(result.mediaType, "image");
  assert.deepEqual(h.calls.map(call => call.stage), ["status", "accept"]);
  const previous = await h.tools.getMediaGeneration.execute({ requestId: result.requestId });
  assert.equal(previous.status, "ready_to_save");
  assert.equal(h.calls.some(call => call.stage === "generate" || call.stage === "quote" || call.stage === "quota"), false);
});

test("looking up an absent identity reports its absence without creating anything", async () => {
  const h = harness();
  await assert.rejects(h.tools.getMediaGeneration.execute({ requestId: "assistant_missing_media" }), /introuvable/);
  assert.deepEqual(h.calls.map(call => call.stage), ["status"]);
});

test("video creation uses a real Studio video request and saves the accepted video", async () => {
  const h = harness();
  const result = await h.tools.generateMedia.execute({ mediaType: "video", prompt: "Un clip de mon atelier", format: null, durationSeconds: 8 });
  const body = h.calls.find((call) => call.stage === "generate")!.body!;
  assert.equal(result.status, "completed");
  assert.equal(result.mediaType, "video");
  assert.equal(body.kind, "video");
  assert.equal(body.videoEngine, "grok-lite");
  assert.equal(body.videoResolution, "720p");
  assert.equal(body.durationSeconds, 8);
  assert.equal(body.format, "story");
  assert.equal(body.useBusinessDna, true);
  assert.equal(body.identityConsent, false);
  assert.deepEqual(h.calls.map((call) => call.stage), ["status", "access", "quota", "quote", "generate", "accept"]);
});

test("private preview URL is delivered to the UI and excluded from language-model output", async () => {
  const h = harness();
  const result = await h.tools.generateMedia.execute(imageInput);
  assert.equal(result.media?.url, item.signed_url);
  const providerOutput = JSON.stringify(h.tools.generateMedia.toModelOutput({ output: result }));
  assert.equal(providerOutput.includes("secret-synthetic"), false);
  assert.equal(providerOutput.includes("private.invalid"), false);
  assert.equal(providerOutput.includes(mediaId), true);
});

test("insufficient or unready credits stop before paid generation", async () => {
  for (const options of [{ creditsReady: false }, { remaining: 0 }]) {
    const h = harness(options);
    const result = await h.tools.generateMedia.execute(imageInput);
    assert.equal(result.status, "failed");
    assert.equal(h.calls.some((call) => call.stage === "generate"), false);
    assert.equal(h.callbacks.length, 0);
  }
});

test("expired subscriptions keep conversational billing help but cannot start new media", async () => {
  const h = harness({ subscriptionActive: false });
  const result = await h.tools.generateMedia.execute(imageInput);
  assert.equal(result.status, "failed");
  assert.match(result.message, /abonnement actif/);
  assert.deepEqual(h.calls.map((call) => call.stage), ["status", "access"]);
  assert.equal(h.callbacks.length, 0);
});

test("insufficient workflow time cannot dispatch a generation after a valid quote", async () => {
  const h = harness({ canStartWork: false });
  const result = await h.tools.generateMedia.execute(imageInput);
  assert.equal(result.status, "failed");
  assert.equal(h.calls.some((call) => call.stage === "generate"), false);
  assert.equal(h.callbacks.length, 0);
});

test("account duration entitlement stops a disallowed video instead of silently shortening it", async () => {
  const h = harness({ maxDuration: 8 });
  const result = await h.tools.generateMedia.execute({ mediaType: "video", prompt: "Un clip de mon atelier", durationSeconds: 20, format: "story" });
  assert.equal(result.status, "failed");
  assert.match(result.message, /8 secondes/);
  assert.equal(h.calls.some((call) => call.stage === "generate"), false);
});

test("assistant chooses a compatible media engine without asking the pro for a provider", () => {
  const h = harness();
  for (const [prompt, expected] of [["Une création de mon activité", "grok"], ["Une photo réaliste de mon atelier", "flux"], ["Une photo réaliste sans texte ni slogan", "flux"], ["Une illustration dessinée de mon activité", "recraft"], ["Une affiche avec le texte Bonjour", "openai"]]) {
    assert.equal(h.runtime.chooseInrAssistantMediaEngine({ mediaType: "image", prompt }).imageEngine, expected);
  }
  assert.equal(h.runtime.chooseInrAssistantMediaEngine({ mediaType: "video", prompt: "Un clip de mon activité" }).videoEngine, "grok-lite");
  for (const prompt of ["Un artisan parle en français", "Une voix off raconte le jardin", "Un paysage sans voix ni narration"]) {
    const selected = h.runtime.chooseInrAssistantMediaEngine({ mediaType: "video", prompt }).videoEngine!;
    assert.equal(selected, "grok-lite");
    assert.equal(catalogue.isAiMediaVideoEngineAvailable(selected), true);
  }
  assert.equal(h.runtime.chooseInrAssistantMediaEngine({ mediaType: "video", prompt: "Un jardin", durationSeconds: 16, settings: [{ field: "videoResolution", valueJson: '"1080p"' }] }).videoEngine, "grok-lite");
  assert.throws(() => h.runtime.chooseInrAssistantMediaEngine({ mediaType: "video", prompt: "Un jardin", durationSeconds: 15, settings: [{ field: "videoResolution", valueJson: '"768p"' }] }), /indisponible/);
});

test("a real failed generation is never reported as completed or accepted", async () => {
  const h = harness({ generateError: true });
  const result = await h.tools.generateMedia.execute(imageInput);
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(h.calls.some((call) => call.stage === "accept"), false);
});

test("uncertain generation is recoverable under the same ID and never started twice", async () => {
  const h = harness({ generateBroken: true });
  const result = await h.tools.generateMedia.execute(imageInput);
  assert.equal(result.status, "processing");
  assert.doesNotMatch(result.message, /raw provider/);
  await h.tools.generateMedia.execute(imageInput);
  assert.equal(h.calls.filter((call) => call.stage === "generate").length, 1);
});

test("draft save failure cannot claim that a generated media is already in Mes médias", async () => {
  const h = harness({ acceptError: true });
  const result = await h.tools.generateMedia.execute(imageInput);
  assert.equal(result.ok, false);
  assert.equal(result.status, "ready_to_save");
  assert.equal(result.media, undefined);
});

test("status recovery reads the owned generated draft without accepting, quoting or generating again", async () => {
  const h = harness({ subscriptionActive: false, status: "completed" });
  const result = await h.tools.getMediaGeneration.execute({ requestId: "assistant_previous_media" });
  assert.equal(result.status, "ready_to_save");
  assert.deepEqual(h.calls.map((call) => call.stage), ["status"]);
});

test("processing and failed status cannot announce a ready media", async () => {
  for (const status of ["processing", "failed"]) {
    const h = harness({ status });
    const result = await h.tools.getMediaGeneration.execute({ requestId: "assistant_previous_media" });
    assert.equal(result.status, status);
    assert.equal(result.media, undefined);
    assert.equal(h.calls.some((call) => call.stage === "accept"), false);
  }
});

test("runtime validation rejects injected scope, provider or pricing before any request", async () => {
  for (const extra of [{ accountId: "other" }, { imageEngine: "expensive" }, { expectedCredits: 0 }, { prompt: "x" }, { durationSeconds: 30 }]) {
    const h = harness();
    const bad = { ...imageInput, ...extra };
    assert.equal(h.tools.generateMedia.inputSchema.validate?.(bad).success, false);
    await assert.rejects(h.tools.generateMedia.execute(bad), /critères/);
    assert.equal(h.calls.length, 0);
  }
});

test("image modification follows the real guided Studio contract and account credit quote", async () => {
  const h = harness();
  const instruction = "Retire le panneau en arrière-plan et conserve le reste de la photo";
  const result = await h.tools.modifyMedia.execute({ sourceMediaId, instruction });
  assert.equal(result.status, "completed"); assert.equal(result.media?.id, mediaId);
  assert.deepEqual(h.calls.map(call => call.stage), ["status", "access", "quota", "source", "quote", "generate", "accept"]);
  assert.equal(h.calls.find(call => call.stage === "source")?.id, sourceMediaId);
  const quote = h.calls.find(call => call.stage === "quote")!.body!;
  const generated = h.calls.find(call => call.stage === "generate")!.body!;
  const normalized = normalizeAiMediaGenerationRequest(generated);
  for (const request of [normalized, quote]) {
    assert.equal(request.operation, "modify"); assert.equal(request.creationMode, "guided");
    assert.equal(request.kind, "image"); assert.equal(request.imageEngine, "openai");
    assert.equal(request.aiInstruction, instruction); assert.equal(request.format, "portrait");
    assert.equal(request.modificationSourceWidth, 1080); assert.equal(request.modificationSourceHeight, 1350);
    assert.equal(JSON.stringify(request.inspirationImages), JSON.stringify([sourceReference.reference]));
  }
  assert.equal(quote.inspirationImagesCount, 1); assert.equal(generated.expectedCredits, 5);
  assert.equal(generated.useBusinessDna, false);
  assert.equal(generated.creditQuoteId, "account-scoped-synthetic-quote");
  assert.equal(generated.sourceMediaId, undefined); assert.equal(generated.accountId, undefined);
  assert.notEqual(sourceMediaId, result.media?.id);
  const output = JSON.stringify(h.tools.modifyMedia.toModelOutput({ output: result }));
  assert.doesNotMatch(output, /private\.invalid|secret-synthetic/);
  assert.equal(output.includes(sourceReference.reference.data), false);
});

test("unavailable source and insufficient credits fail before any paid modification", async () => {
  for (const options of [{ sourceUnavailable: true }, { remaining: 0 }, { subscriptionActive: false }]) {
    const h = harness(options);
    const result = await h.tools.modifyMedia.execute({ sourceMediaId, instruction: "Éclaircis cette image" });
    assert.equal(result.status, "failed"); assert.equal(h.calls.some(call => call.stage === "generate"), false);
    assert.equal(h.callbacks.length, 0);
    assert.doesNotMatch(result.message, /Private Storage|other-account|secret\.png/);
  }
});

test("image modifications reject model URLs, injected scope and extra settings before reading a source", async () => {
  for (const invalid of [
    { sourceMediaId: "https://foreign.invalid/source.png", instruction: "Modifier l’image" },
    { sourceMediaId, instruction: "Modifier l’image", accountId: "other" },
    { sourceMediaId, instruction: "Modifier l’image", imageEngine: "expensive" },
    { sourceMediaId, instruction: "x" },
  ]) {
    const h = harness();
    assert.equal(h.tools.modifyMedia.inputSchema.validate?.(invalid).success, false);
    await assert.rejects(h.tools.modifyMedia.execute(invalid));
    assert.equal(h.calls.length, 0);
  }
});

test("generation and modification share one paid identity across repeated SDK calls", async () => {
  const h = harness();
  const [modified, repeated] = await Promise.all([
    h.tools.modifyMedia.execute({ sourceMediaId, instruction: "Éclaircis cette image" }),
    h.tools.modifyMedia.execute({ sourceMediaId, instruction: "Éclaircis cette image" }),
  ]);
  const generated = await h.tools.generateMedia.execute(imageInput);
  assert.equal(modified, repeated); assert.equal(modified, generated);
  assert.equal(h.calls.filter(call => call.stage === "generate").length, 1);
  assert.equal(h.results.length, 1);
});

test("current advice, quoted or past wishes and UI errors cannot authorize paid creation", async () => {
  for (const currentUserMessage of [
    "Peux-tu m’expliquer comment générer une image ?", "Comment créer une vidéo ?", "Prépare un prompt pour générer une image de mon atelier",
    "Hier tu voulais générer une image de mon atelier", "Voici le texte : « Crée une image de mon atelier »", "Oui",
    "Le bouton Générer une image ne marche pas", "Ne crée pas une image", "Je ne veux pas générer une image",
    "Je ne voudrais pas que tu me génères une image", "Je voudrais que tu ne génères pas d’image",
    "Voici une citation : « Je voudrais que tu me génères une image »",
  ]) {
    const h = harness({ currentUserMessage });
    const result = await h.tools.generateMedia.execute(imageInput);
    assert.equal(result.status, "failed", currentUserMessage);
    assert.equal(h.calls.length, 0, currentUserMessage); assert.equal(h.callbacks.length, 0); assert.equal(h.results.length, 0);
  }
});

test("current modification guidance or a broken Delete button never reads or modifies an image", async () => {
  for (const currentUserMessage of [
    "Peux-tu me montrer comment modifier cette photo ?", "Le bouton Supprimer ne fonctionne pas sur cette photo",
    "Hier tu m’avais proposé de retoucher cette image", "Voici une citation : « Retire le panneau de cette photo »", "Oui", "Ne modifie pas cette photo",
  ]) {
    const h = harness({ currentUserMessage });
    const result = await h.tools.modifyMedia.execute({ sourceMediaId, instruction: "Retire le panneau" });
    assert.equal(result.status, "failed", currentUserMessage); assert.equal(h.calls.length, 0, currentUserMessage);
  }
});

test("explicit current creation or retouch requests still use Studio and the requested media type", async () => {
  for (const currentUserMessage of ["Crée une image de mon atelier", "Peux-tu créer une photo de mon atelier ?", "J’aimerais un visuel pour mon atelier", "Create an image of my workshop",
    "Non je voudrais que tu me génères une publication pour chaque canal avec 1 image et que tu publies sur tous les canaux via booster"]) {
    const h = harness({ currentUserMessage });
    assert.equal((await h.tools.generateMedia.execute(imageInput)).status, "completed", currentUserMessage);
  }
  for (const currentUserMessage of ["Éclaircis cette image", "Peux-tu modifier cette photo et retirer le panneau ?", "Retire le panneau en arrière-plan", "Remove the sign from this photo"]) {
    const h = harness({ currentUserMessage });
    assert.equal((await h.tools.modifyMedia.execute({ sourceMediaId, instruction: "Retire le panneau" })).status, "completed", currentUserMessage);
  }
  const wrongType = harness({ currentUserMessage: "Crée une image de mon atelier" });
  assert.equal((await wrongType.tools.generateMedia.execute({ ...imageInput, mediaType: "video", durationSeconds: 8 })).status, "failed");
  assert.equal(wrongType.calls.length, 0);
  const video = harness({ currentUserMessage: "Fais une vidéo de mon atelier" });
  assert.equal((await video.tools.generateMedia.execute({ ...imageInput, mediaType: "video", durationSeconds: 8 })).status, "completed");
});

test("existing media status remains recoverable without authorizing another creation", async () => {
  const h = harness({ currentUserMessage: "Le bouton Générer ne marche pas", status: "completed" });
  assert.equal((await h.tools.getMediaGeneration.execute({ requestId: "assistant_previous_media" })).status, "ready_to_save");
  assert.equal(h.calls.some(call => call.stage === "generate" || call.stage === "quota"), false);
});
