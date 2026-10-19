import * as characterVoices from "../../lib/aiMediaCharacterVoices.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import * as catalog from "../../lib/aiMediaModelCatalog.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as boundary from "../../lib/aiMediaVideoProviderContract.ts";
import * as providerTypes from "../../lib/aiVideoProviderTypes.ts";
import * as freePrompt from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as sensitiveText from "../../lib/aiMediaSensitiveText.ts";
import { bufferFromUint8ArrayView } from "../../lib/aiMediaBuffer.ts";
import { AiMediaRequestValidationError, normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { prepareAiMediaIdentityReferences } from "../../lib/aiMediaIdentityReferences.ts";

type Runtime = {
  buildGatewayAiVideoRequest: (...args: unknown[]) => Record<string, unknown>;
  createGatewayAiVideoProvider: (engine: catalog.AiMediaVideoEngine) => providerTypes.AiVideoProvider;
};
type Media = { type: string; url: string; referenceVoice?: string };
const imageUrls = (count: number) => Array.from({ length: count }, (_, index) => `https://private.example.com/image-${index + 1}.webp`);
const voiceUrls = (count: number) => Array.from({ length: count }, (_, index) => index < 2 ? `https://private.example.com/voice-${index + 1}.wav` : null);

function argsFor(count = 2, duration = 8): providerTypes.AiVideoProviderGenerationArgs {
  const contract = { version: boundary.AI_MEDIA_VIDEO_PROVIDER_CONTRACT_VERSION,
    subject: "Deux artisans échangent.", instruction: duration > 10 ? 'Le premier dit « Bonjour ! » ; le second répond « Bienvenue ! ».' : 'Le premier dit « Bonjour ! ».',
    parameters: "native-dialogue", references: "separate approved character images" };
  const prompt = "Film demandé avec les paroles exactes.";
  return {
    accountId: "account-test", canonicalPrompt: prompt, canonicalPromptSha256: boundary.hashAiMediaCanonicalPrompt(prompt),
    providerContract: { ...contract, sha256: boundary.hashAiMediaVideoProviderContract(contract) },
    identityTeamProviderEgressConsent: "wan27",
    request: { requestId: "wan27-voice-test", kind: "video", creationMode: "free", freePrompt: contract.instruction,
      videoEngine: "wan27", durationSeconds: duration, sceneMode: "single", videoResolution: "720p", format: "story",
      identityMode: count >= 2 ? "reference_team" : "professional", teamVideoMode: "cinematic", teamVideoSpeechMode: "characters",
      inspirationImages: Array.from({ length: count }, (_, index) => ({
        mimeType: "image/webp", data: Buffer.from(`sanitized-character-${index + 1}`).toString("base64"),
        role: index < 3 ? "character" : "environment", usage: "required", characterIndex: index < 3 ? index + 1 : undefined,
        voiceMode: index < 2 ? "provided" : "ai",
        ...(index < 2 ? { voiceSample: { path: `account-test/_character-voices/${index + 1}.wav`, name: `voice-${index + 1}.wav`, mimeType: "audio/wav", durationSeconds: 5, sizeBytes: 160_044 } } : {}),
      })),
    },
    plan: { scenes: timeline.getAiMediaVideoSegmentDurations(duration, "wan27").map((_, index) => ({ visualBrief: `character${index + 1} parle.`, spokenLine: index ? "Bienvenue !" : "Bonjour !" })) },
  } as unknown as providerTypes.AiVideoProviderGenerationArgs;
}

function loadRuntime(failVoices = false) {
  const submissions: Record<string, unknown>[] = [];
  let reservations = 0;
  let frames = 0;
  let cleanups = 0;
  let uploads = 0;
  const source = readFileSync(path.join(process.cwd(), "lib/aiVideoProviderGateway.ts"), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const stubs = new Map<string, unknown>([
    ["server-only", {}], ["./aiMediaCharacterVoices.ts", characterVoices], ["@/lib/aiMediaCharacterVoices", characterVoices],
    ["ai", { createDownload: () => async () => { throw new Error("no real downloads"); }, experimental_generateVideo: async (input: Record<string, unknown>) => {
      submissions.push(input);
      const buffer = Buffer.alloc(24); buffer.write("ftyp", 4, "ascii");
      return { videos: [{ uint8Array: buffer }], warnings: [] };
    } }],
    ["@/lib/aiGatewayAccountGuard", {
      reserveAiGatewayAccountAttempt: async () => { reservations++; return {}; }, commitAiGatewayAccountAttempt: async () => {},
      rollbackAiGatewayAccountAttempt: async () => {}, recordAiGatewayAccountFailure: async () => {},
    }],
    ["./aiMediaBuffer.ts", { bufferFromUint8ArrayView }], ["./aiMediaFreeGenerationPrompt.ts", freePrompt],
    ["@/lib/aiMediaGenerationContracts", { AiMediaRequestValidationError }], ["./aiMediaModelCatalog.ts", catalog],
    ["./aiMediaVideoTimeline.ts", timeline], ["./aiMediaVideoProviderContract.ts", boundary], ["@/lib/aiMediaSensitiveText", sensitiveText],
    ["@/lib/aiVideoProviderTypes", providerTypes],
    ["@/lib/aiVideoProviderGoogleVeo", {
      buildGoogleVideoScenePrompt: (args: providerTypes.AiVideoProviderGenerationArgs, index: number, duration: number, options: object) => freePrompt.buildAiMediaFreeVideoScenePrompt(args, index, duration, options),
      buildGoogleVideoTeamSpeechDirection: () => "",
    }],
    ["./aiMediaVideoContinuity.ts", { extractAiMediaVideoContinuityFrame: async () => { frames++; return { data: "Z2VuZXJhdGVk", mimeType: "image/jpeg" }; } }],
    ["./aiMediaVideoTemporaryImages.ts", { createAiMediaVideoTemporaryImageStore: () => ({
      assertPrivateBucket: async () => {}, uploadImages: async (images: unknown[]) => { uploads++; return uploads === 1 ? imageUrls(images.length) : ["https://private.example.com/previous-final-frame.jpg"]; },
      cleanup: async () => { cleanups++; },
    }) }],
    ["@/lib/aiMediaCharacterVoiceStorage", { getAiMediaCharacterVoiceSignedUrls: async ({ images }: { images: unknown[] }) => {
      if (failVoices) throw new Error("ai_media_character_voice_unavailable"); return voiceUrls(images.length);
    } }],
  ]);
  const localRequire = (name: string) => { if (!stubs.has(name)) throw new Error(`unexpected_dependency:${name}`); return stubs.get(name); };
  const commonJsModule = { exports: {} };
  vm.runInThisContext(`(function(exports,require,module){${javascript}\n})`)(commonJsModule.exports, localRequire, commonJsModule);
  return { runtime: commonJsModule.exports as Runtime, submissions, reservations: () => reservations, frames: () => frames, cleanups: () => cleanups };
}

const mediaFor = (input: Record<string, unknown>) => (input.providerOptions as { alibaba: { media: Media[] } }).alibaba.media;

test("Wan 2.7 binds each original character image to its own supplied voice without a master composition", () => {
  const { runtime } = loadRuntime();
  const input = runtime.buildGatewayAiVideoRequest(argsFor(), 0, undefined, imageUrls(2), voiceUrls(2));
  assert.equal(input.model, "alibaba/wan-v2.7-r2v"); assert.equal(input.resolution, "1280x720"); assert.equal(input.generateAudio, true);
  assert.equal(typeof input.prompt, "string"); assert.equal(input.inputReferences, undefined);
  assert.deepEqual(mediaFor(input), imageUrls(2).map((url, index) => ({ type: "reference_image", url, referenceVoice: voiceUrls(2)[index] })));
  assert.match(String(input.prompt), /Bonjour !/);
  assert.match(String(input.prompt), /Image 1 = character1 = Studio character 1/);
  assert.match(String(input.prompt), /Image 2 = character2 = Studio character 2/);
  assert.doesNotMatch(String(input.prompt), /Never clone|distinct synthetic voices|stable adult synthetic voice/);
});

test("Wan 2.7 continuation keeps all character/voice pairs and adds a distinct first frame", () => {
  const { runtime } = loadRuntime(); const args = argsFor(2, 16);
  const input = runtime.buildGatewayAiVideoRequest(args, 1, { data: "ZnJhbWU=", mimeType: "image/jpeg" }, imageUrls(2), voiceUrls(2), "https://private.example.com/prior.jpg");
  assert.deepEqual(mediaFor(input).slice(0, 2), imageUrls(2).map((url, index) => ({ type: "reference_image", url, referenceVoice: voiceUrls(2)[index] })));
  assert.deepEqual(mediaFor(input)[2], { type: "first_frame", url: "https://private.example.com/prior.jpg" });
  assert.match(String(input.prompt), /prior final frame/); assert.match(String(input.prompt), /Bienvenue !/);
});

test("Wan 2.7 rejects missing voice URLs and missing team provider consent before submission", () => {
  const { runtime, reservations, submissions } = loadRuntime(); const args = argsFor();
  assert.throws(() => runtime.buildGatewayAiVideoRequest(args, 0, undefined, imageUrls(2)), /reference_voice_url_missing/);
  args.identityTeamProviderEgressConsent = undefined;
  assert.throws(() => runtime.buildGatewayAiVideoRequest(args, 0, undefined, imageUrls(2), voiceUrls(2)), /provider_consent_required/);
  assert.equal(reservations(), 0); assert.equal(submissions.length, 0);
});

test("Wan 2.7 preserves original voice pairs in every paid-API mock and cleans hosted images", async () => {
  const originalKey = process.env.AI_GATEWAY_API_KEY; process.env.AI_GATEWAY_API_KEY = "local-test-only";
  try {
    for (const count of [2, 5]) {
      const context = loadRuntime(); const args = argsFor(count, 16);
      const result = await context.runtime.createGatewayAiVideoProvider("wan27").generate(args);
      assert.equal(context.submissions.length, 2); assert.equal(context.reservations(), 2);
      for (const input of context.submissions) assert.deepEqual(mediaFor(input).slice(0, count), imageUrls(count).map((url, index) => ({ type: "reference_image", url, ...(voiceUrls(count)[index] ? { referenceVoice: voiceUrls(count)[index] } : {}) })));
      assert.equal(context.frames(), count === 5 ? 0 : 1);
      assert.equal(mediaFor(context.submissions[1]).length, count === 5 ? 5 : 3);
      if (count === 5) assert.ok(result.warnings.includes("video_continuity_original_subject_references_preserved_at_capacity"));
      assert.equal(context.cleanups(), 1);
    }
    const failing = loadRuntime(true);
    await assert.rejects(failing.runtime.createGatewayAiVideoProvider("wan27").generate(argsFor()), /character_voice_unavailable/);
    assert.equal(failing.reservations(), 0); assert.equal(failing.submissions.length, 0); assert.equal(failing.cleanups(), 1);
  } finally {
    if (originalKey === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = originalKey;
  }
});

test("image sanitation preserves each character voice assignment and strips image metadata", async () => {
  const args = argsFor();
  const source = await sharp({ create: { width: 320, height: 320, channels: 3, background: "#abcdef" } }).webp().toBuffer();
  const images = args.request.inspirationImages.map((image) => ({ ...image, data: source.toString("base64") }));
  const sanitized = await prepareAiMediaIdentityReferences(images);
  for (const [index, image] of sanitized.providerImages.entries()) {
    assert.equal(image.characterIndex, images[index].characterIndex);
    assert.equal(image.voiceMode, "provided");
    assert.deepEqual(image.voiceSample, images[index].voiceSample);
    assert.notEqual(image.voiceSample, images[index].voiceSample);
    assert.equal((await sharp(sanitized.buffers[index]).metadata()).exif, undefined);
  }
});

test("the installed AI SDK serializes Wan media voice bindings and first frame without losing a reference", async () => {
  const { createGateway, experimental_generateVideo } = await import("ai");
  const { runtime } = loadRuntime();
  const input = runtime.buildGatewayAiVideoRequest(argsFor(2, 16), 1, { data: "ZnJhbWU=", mimeType: "image/jpeg" }, imageUrls(2), voiceUrls(2), "https://private.example.com/previous-final-frame.jpg");
  let calls = 0;
  const gateway = createGateway({ apiKey: "local-test-only", fetch: async (_url, init) => {
    calls++;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("ai-model-id"), "alibaba/wan-v2.7-r2v");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.resolution, "1280x720"); assert.equal(body.generateAudio, true);
    assert.equal(body.image, undefined); assert.equal(body.inputReferences, undefined); assert.equal(body.frameImages, undefined);
    assert.deepEqual(body.providerOptions, input.providerOptions);
    assert.equal(body.providerOptions.alibaba.ratio, "9:16"); assert.equal(body.providerOptions.alibaba.promptExtend, false);
    const output = { type: "result", videos: [{ type: "base64", mediaType: "video/mp4", data: Buffer.from("local-test-video").toString("base64") }], warnings: [] };
    return new Response(`data: ${JSON.stringify(output)}\n\n`, { headers: { "content-type": "text/event-stream" } });
  } });
  const result = await experimental_generateVideo({ ...input, model: gateway.video("alibaba/wan-v2.7-r2v") } as Parameters<typeof experimental_generateVideo>[0]);
  assert.equal(calls, 1); assert.equal(result.videos.length, 1);
});

test("the creative planner and canonical prompt retain voice choices without file paths or names", async () => {
  const args = argsFor();
  args.request.inspirationImages[0].voiceSample!.name = "private-sample-name-sentinel.wav";
  const profile = { business: { companyName: "" }, preferences: { language: "fr" } };
  const canonical = freePrompt.buildAiMediaFreeVideoPrompt({ request: args.request, profile } as never);
  assert.match(canonical, /Voix du personnage 1 : utiliser uniquement son propre échantillon vocal fourni/);
  assert.doesNotMatch(canonical, /sans narrateur ajouté ni clonage|private-sample-name-sentinel|_character-voices/);
  let observed: { system: string; input: string } | undefined;
  const source = readFileSync(path.join(process.cwd(), "lib/aiMediaFreeGenerationPlan.ts"), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const stubs = new Map<string, unknown>([
    ["server-only", {}], ["./aiMediaCharacterVoices.ts", characterVoices], ["@/lib/aiMediaCharacterVoices", characterVoices], ["node:crypto", crypto], ["@/lib/aiGatewayClient", { aiGenerateJSON: async (input: { system: string; input: string }) => {
      observed = { system: input.system, input: input.input };
      return { direction: "Les deux artisans échangent naturellement.", scenes: [{ visualBrief: "character1 salue character2.", spokenLine: "Bonjour !" }] };
    } }], ["@/lib/aiEnginePreference", { getAiEngineOption: () => ({ model: "local-test" }) }],
    ["@/lib/aiMediaGenerationContracts", { AiMediaRequestValidationError }], ["@/lib/aiMediaVideoTimeline", timeline],
    ["@/lib/aiMediaFreeGenerationPrompt", freePrompt],
  ]);
  const commonJsModule = { exports: {} };
  vm.runInThisContext(`(function(exports,require,module){${javascript}\n})`)(commonJsModule.exports, (name: string) => {
    if (!stubs.has(name)) throw new Error(`unexpected_dependency:${name}`); return stubs.get(name);
  }, commonJsModule);
  const planner = commonJsModule.exports as { prepareAiMediaFreeCreativePlan: (args: object) => Promise<unknown> };
  await planner.prepareAiMediaFreeCreativePlan({ accountId: args.accountId, request: args.request, profile });
  assert.ok(observed);
  assert.match(observed.system, /propre échantillon vocal/);
  assert.doesNotMatch(observed.system, /Voix synthétiques, pas de clonage/);
  assert.deepEqual(JSON.parse(observed.input).character_voices, [
    { reference: 1, character: "character1", studio_character: 1, voice: "provided" }, { reference: 2, character: "character2", studio_character: 2, voice: "provided" },
  ]);
  assert.doesNotMatch(observed.input, /private-sample-name-sentinel|_character-voices|voiceSample|\.wav/);
  args.request.inspirationImages[0] = { ...args.request.inspirationImages[0], usage: "inspiration", characterIndex: undefined, voiceMode: "ai", voiceSample: undefined };
  args.request.inspirationImages[1] = { ...args.request.inspirationImages[1], characterIndex: 1 };
  await planner.prepareAiMediaFreeCreativePlan({ accountId: args.accountId, request: args.request, profile });
  assert.deepEqual(JSON.parse(observed.input).character_voices, [
    { reference: 1, character: "character1", voice: "ai" },
    { reference: 2, character: "character2", studio_character: 1, voice: "provided" },
  ], "unindexed inspiration characters must never take a provided voice's Studio character number");
  assert.match(observed.system, /characterN lié à Image N/);
  args.request.inspirationImages[0] = { ...args.request.inspirationImages[0], role: "product", usage: "required", voiceMode: undefined };
  await planner.prepareAiMediaFreeCreativePlan({ accountId: args.accountId, request: args.request, profile });
  assert.deepEqual(JSON.parse(observed.input).character_voices, [
    { reference: 2, character: "character2", studio_character: 1, voice: "provided" },
  ], "a preceding product occupies Image 1 and must not renumber the supplied character voice");
});

test("real Studio normalization preserves two distinct voice samples into the Wan request", () => {
  const args = argsFor(); const now = Date.now(); const date = new Date(now).toISOString().slice(0, 10);
  const images = args.request.inspirationImages.map((image) => ({ ...image, data: "A".repeat(64), voiceSample: {
    ...image.voiceSample!, path: `_studio-voice-references/${date}/account-test__${now}__${crypto.randomUUID()}.wav`,
  } }));
  const normalized = normalizeAiMediaGenerationRequest({ ...args.request, source: "studio", operation: "generate",
    identityConsent: true, teamVideoProviderConsent: "wan27", inspirationImages: images });
  assert.equal(normalized.videoEngine, "wan27"); assert.equal(normalized.identityMode, "reference_team");
  assert.equal(normalized.teamVideoProviderConsent, "wan27"); assert.equal(normalized.withNarration, false);
  assert.deepEqual(normalized.inspirationImages.map((image) => image.voiceSample?.path), images.map((image) => image.voiceSample.path));
  const { runtime } = loadRuntime();
  const input = runtime.buildGatewayAiVideoRequest({ ...args, request: normalized }, 0, undefined, imageUrls(2), voiceUrls(2));
  assert.deepEqual(mediaFor(input).map((image) => image.referenceVoice), voiceUrls(2));
});

test("the actual Free payload preserves a provided voice on an inspiration character through its whitelist and native Wan prompt", () => {
  const now = Date.now(); const date = new Date(now).toISOString().slice(0, 10);
  const samplePath = `_studio-voice-references/${date}/account-test__${now}__${crypto.randomUUID()}.wav`;
  // These are the fields MediaFreeGenerator sends to useMediaGeneration;
  // the hook serializes the image metadata unchanged into generation JSON.
  const normalized = normalizeAiMediaGenerationRequest({
    requestId: "actual-free-inspiration-voice", contractVersion: 4,
    creationMode: "free", operation: "generate", inputMode: "essential", source: "studio", kind: "video",
    freePrompt: 'Le second personnage dit « Bonjour, bienvenue ! » pendant que le premier sourit.',
    subjectSource: "custom", format: "story", durationSeconds: 8, sceneMode: "single",
    videoEngine: "wan27", videoResolution: "720p", teamVideoMode: "cinematic", teamVideoSpeechMode: "characters",
    withNarration: true, withMusic: false, identityMode: "professional", identityConsent: true,
    identityReferenceSetId: crypto.randomUUID(),
    inspirationImages: [
      { mimeType: "image/webp", data: "A".repeat(64), role: "character", usage: "required", characterIndex: 1, voiceMode: "ai" },
      { mimeType: "image/webp", data: "B".repeat(64), role: "character", usage: "inspiration", characterIndex: 2, voiceMode: "provided",
        voiceSample: { path: samplePath, name: "second-character.wav", mimeType: "audio/wav", durationSeconds: 2, sizeBytes: 64_044 } },
    ],
  });
  assert.equal(normalized.creationMode, "free"); assert.equal(normalized.teamVideoSpeechMode, "characters");
  assert.equal(normalized.withNarration, false); assert.equal(normalized.narrationVoice, null);
  assert.equal(normalized.identityConsent, true); assert.equal(normalized.identityMode, "professional");
  assert.deepEqual(normalized.inspirationImages.map(({ usage, characterIndex, voiceMode }) => ({ usage, characterIndex, voiceMode })), [
    { usage: "required", characterIndex: 1, voiceMode: "ai" }, { usage: "inspiration", characterIndex: 2, voiceMode: "provided" },
  ]);
  assert.equal(normalized.inspirationImages[1].voiceSample?.path, samplePath);
  const profile = { business: { companyName: "" }, preferences: { language: "fr" } };
  const canonicalPrompt = freePrompt.buildAiMediaFreeVideoPrompt({ request: normalized, profile } as never);
  const providerContract = boundary.buildAiMediaVideoProviderContract({ request: normalized, durationSeconds: 8, brandColors: [] });
  const args = { ...argsFor(), request: normalized, canonicalPrompt, canonicalPromptSha256: boundary.hashAiMediaCanonicalPrompt(canonicalPrompt), providerContract,
    plan: { ...argsFor().plan, scenes: [{ visualBrief: "character2 salue pendant que character1 sourit.", spokenLine: "Bonjour, bienvenue !" }] },
  } as providerTypes.AiVideoProviderGenerationArgs;
  const { runtime } = loadRuntime();
  const input = runtime.buildGatewayAiVideoRequest(args, 0, undefined, imageUrls(2), [null, "https://private.example.com/second-character.wav"]);
  assert.deepEqual(mediaFor(input), [
    { type: "reference_image", url: imageUrls(2)[0] },
    { type: "reference_image", url: imageUrls(2)[1], referenceVoice: "https://private.example.com/second-character.wav" },
  ]);
  assert.match(String(input.prompt), /NATIVE DIALOGUE:.*Bonjour, bienvenue !/);
  assert.match(String(input.prompt), /Image 2 = character2 = Studio character 2; use only its attached referenceVoice/);
  assert.equal(input.generateAudio, true);
  assert.doesNotMatch(String(input.prompt), /Never clone|synthetic voices|NATIVE VOICEOVER|No native voices/);
  assert.doesNotMatch(canonicalPrompt, /ni clonage|second-character\.wav|_studio-voice-references/);
});
