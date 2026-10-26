import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import * as catalogue from "../../lib/aiMediaModelCatalog.ts";
import type * as MediaTools from "../../lib/inrAssistantMediaTools.ts";

const mediaId = "20000000-0000-4000-8000-000000000001";
const item = { id: mediaId, media_type: "image", title: "Atelier", signed_url: "https://private.invalid/preview?token=secret-synthetic", mime_type: "image/png", width: 1080, height: 1080, duration_seconds: null };
const imageInput = { mediaType: "image", prompt: "Une photo réaliste de mon atelier", format: "square", durationSeconds: null };
const sourceMediaId = "30000000-0000-4000-8000-000000000001";
const sourceReference = { reference: { mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlpQAAAAASUVORK5CYII=", role: "inspiration", usage: "required" }, width: 1080, height: 1350, format: "portrait" };

type HarnessOptions = { currentUserMessage?: string; sourceUnavailable?: boolean; subscriptionActive?: boolean; canStartWork?: boolean; creditsReady?: boolean; remaining?: number; maxDuration?: number; generateError?: boolean; generateBroken?: boolean; acceptError?: boolean; status?: string; statusResponse?: number; statusCode?: string; statusBroken?: boolean };
function harness(options: HarnessOptions = {}) {
  const calls: { stage: string; body?: Record<string, unknown>; request?: Request; id?: string }[] = [];
  const callbacks: string[] = [];
  const results: MediaTools.InrAssistantMediaResult[] = [];
  let generatedKind = "image";
  let storedStatus = options.status ?? "missing";
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const stubs: Record<string, unknown> = {
    "server-only": {},
    ai: { tool: (value: unknown) => value, jsonSchema: (schema: unknown, config: unknown) => ({ schema, ...config as object }) },
    "./aiMediaGenerationContracts.ts": { normalizeAiMediaGenerationRequest },
    "./aiMediaModelCatalog.ts": catalogue,
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
      return options.acceptError ? json({ ok: false, error: "Enregistrement indisponible." }, 500) : json({ ok: true, item: { ...item, media_type: generatedKind } });
    } },
    "@/app/api/media-generation/status/route": { GET: async (request: Request) => {
      calls.push({ stage: "status", request });
      if (options.statusBroken) throw new Error("Synthetic status service outage");
      if (options.statusResponse) return json({ ok: false, code: options.statusCode, error: "Vérification indisponible." }, options.statusResponse);
      if (storedStatus === "missing") return json({ ok: false, status: "missing", code: "AI_MEDIA_GENERATION_NOT_FOUND" }, 404);
      return json({ ok: true, status: storedStatus, draft: true, item: { ...item, media_type: generatedKind }, creditsUsed: 5, error: "La génération a échoué." }, storedStatus === "processing" ? 202 : 200);
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
    canStartWork: () => options.canStartWork !== false,
    onWorkStarted: (id) => callbacks.push(id), onResult: (result) => results.push(result),
  });
  type TestTool = { execute: (input: unknown) => Promise<MediaTools.InrAssistantMediaResult>; inputSchema: { validate?: (input: unknown) => { success: boolean } }; toModelOutput: (args: { output: MediaTools.InrAssistantMediaResult }) => unknown };
  type TestTools = { generateMedia: TestTool; modifyMedia: TestTool; getMediaGeneration: TestTool };
  return { runtime, tools: createTools() as unknown as TestTools, retryTools: () => createTools() as unknown as TestTools, calls, callbacks, results };
}

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
    assert.deepEqual(h.calls.slice(beforeRetry).map(call => call.stage), ["status", "accept"]);
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
  assert.equal(h.runtime.chooseInrAssistantMediaEngine({ mediaType: "video", prompt: "Un artisan parle en français" }).videoEngine, "minimax-h3");
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

test("status recovery accepts the owned generated draft without quoting or generating again", async () => {
  const h = harness({ subscriptionActive: false, status: "completed" });
  const result = await h.tools.getMediaGeneration.execute({ requestId: "assistant_previous_media" });
  assert.equal(result.status, "completed");
  assert.deepEqual(h.calls.map((call) => call.stage), ["status", "accept"]);
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
  for (const currentUserMessage of ["Crée une image de mon atelier", "Peux-tu créer une photo de mon atelier ?", "J’aimerais un visuel pour mon atelier", "Create an image of my workshop"]) {
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
  assert.equal((await h.tools.getMediaGeneration.execute({ requestId: "assistant_previous_media" })).status, "completed");
  assert.equal(h.calls.some(call => call.stage === "generate" || call.stage === "quota"), false);
});
