import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as catalog from "../../lib/aiMediaModelCatalog.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as boundary from "../../lib/aiMediaVideoProviderContract.ts";
import * as providerTypes from "../../lib/aiVideoProviderTypes.ts";
import * as freePrompt from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as sensitiveText from "../../lib/aiMediaSensitiveText.ts";
import * as voices from "../../lib/aiMediaCharacterVoices.ts";
import { bufferFromUint8ArrayView } from "../../lib/aiMediaBuffer.ts";
import { AiMediaRequestValidationError, normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";

type Input = Record<string, unknown>;
type Runtime = {
  buildGatewayAiVideoRequest: (...args: unknown[]) => Input;
  createGatewayAiVideoProvider: (engine: catalog.AiMediaVideoEngine) => providerTypes.AiVideoProvider;
};
const ENGINES = ["wan3", "heygen"] as const;
const IMAGE_URLS = [1, 2, 3].map((index) => `https://private.example.com/original-${index}.webp`);
const VOICE_URL = "https://private.example.com/third-reference-own-voice.wav";
const VOICE_URLS = [null, null, VOICE_URL];

function argsFor(engine: catalog.AiMediaVideoEngine, twoScenes = false): providerTypes.AiVideoProviderGenerationArgs {
  const now = Date.now();
  const sample = { path: `_studio-voice-references/${new Date(now).toISOString().slice(0, 10)}/account-test__${now}__${randomUUID()}.wav`,
    name: "private-third-character.wav", mimeType: "audio/wav", durationSeconds: 5, sizeBytes: 160_044 };
  const instruction = twoScenes
    ? 'Le personnage avec la voix fournie dit « Voici notre nouvelle collection ! » puis « Avec un service pensé pour vous ! ».'
    : 'Le personnage avec la voix fournie dit « Voici notre nouvelle collection ! ».';
  const contract = { version: boundary.AI_MEDIA_VIDEO_PROVIDER_CONTRACT_VERSION, subject: "Deux artisans présentent un produit.",
    instruction, parameters: "native-dialogue", references: "three original references in their original order" };
  const canonicalPrompt = "Deux artisans présentent un produit avec les paroles exactes du brief.";
  const durationSeconds = twoScenes ? 20 : 8;
  const videoResolution = engine === "heygen" ? "768p" : "720p";
  return {
    accountId: "account-test", canonicalPrompt, canonicalPromptSha256: boundary.hashAiMediaCanonicalPrompt(canonicalPrompt),
    providerContract: { ...contract, sha256: boundary.hashAiMediaVideoProviderContract(contract) }, identityTeamProviderEgressConsent: engine,
    request: { requestId: `voices-${engine}`, kind: "video", source: "studio", creationMode: "free", inputMode: "essential", operation: "generate",
      freePrompt: instruction, videoEngine: engine, durationSeconds, sceneMode: twoScenes ? "multi" : "single", videoResolution,
      format: "story", identityMode: "reference_team", identityConsent: true, teamVideoProviderConsent: engine,
      teamVideoMode: "cinematic", teamVideoSpeechMode: "characters", withNarration: false, withMusic: false,
      inspirationImages: [
        { mimeType: "image/webp", data: "A".repeat(64), role: "product", usage: "required" },
        { mimeType: "image/webp", data: "B".repeat(64), role: "character", usage: "required", characterIndex: 1, voiceMode: "ai" },
        { mimeType: "image/webp", data: "C".repeat(64), role: "character", usage: "required", characterIndex: 2, voiceMode: "provided", voiceSample: sample },
      ],
    },
    plan: { scenes: timeline.getAiMediaVideoSegmentDurations(durationSeconds, engine, videoResolution, twoScenes ? "multi" : "single")
      .map((_, index) => ({ visualBrief: "character3 présente le produit d’Image 1 pendant que character2 sourit.",
        spokenLine: index ? "Avec un service pensé pour vous !" : "Voici notre nouvelle collection !" })) },
  } as unknown as providerTypes.AiVideoProviderGenerationArgs;
}

function loadRuntime(options: { missingSignedVoice?: boolean; failSigning?: boolean } = {}) {
  const submissions: Input[] = [];
  const signing: { videoEngine?: string; images: unknown[] }[] = [];
  let reservations = 0;
  let frames = 0;
  let cleanups = 0;
  const source = readFileSync(path.join(process.cwd(), "lib/aiVideoProviderGateway.ts"), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const stubs = new Map<string, unknown>([
    ["server-only", {}],
    ["ai", { createDownload: () => async () => { throw new Error("real_download_forbidden"); }, experimental_generateVideo: async (input: Input) => {
      submissions.push(input); const buffer = Buffer.alloc(24); buffer.write("ftyp", 4, "ascii");
      return { videos: [{ uint8Array: buffer }], warnings: [] };
    } }],
    ["@/lib/aiGatewayAccountGuard", {
      reserveAiGatewayAccountAttempt: async () => { reservations++; return {}; }, commitAiGatewayAccountAttempt: async () => {},
      rollbackAiGatewayAccountAttempt: async () => {}, recordAiGatewayAccountFailure: async () => {},
    }],
    ["./aiMediaBuffer.ts", { bufferFromUint8ArrayView }], ["./aiMediaFreeGenerationPrompt.ts", freePrompt],
    ["@/lib/aiMediaGenerationContracts", { AiMediaRequestValidationError }], ["./aiMediaModelCatalog.ts", catalog],
    ["./aiMediaVideoTimeline.ts", timeline], ["./aiMediaVideoProviderContract.ts", boundary], ["@/lib/aiMediaSensitiveText", sensitiveText],
    ["./aiMediaCharacterVoices.ts", voices], ["@/lib/aiMediaCharacterVoices", voices], ["@/lib/aiVideoProviderTypes", providerTypes],
    ["@/lib/aiVideoProviderGoogleVeo", {
      buildGoogleVideoScenePrompt: (args: providerTypes.AiVideoProviderGenerationArgs, index: number, duration: number, options: object) =>
        freePrompt.buildAiMediaFreeVideoScenePrompt(args, index, duration, options),
      buildGoogleVideoTeamSpeechDirection: () => "",
    }],
    ["./aiMediaVideoContinuity.ts", { extractAiMediaVideoContinuityFrame: async () => {
      frames++; return { data: "ZnJhbWU=", mimeType: "image/jpeg" };
    } }],
    ["./aiMediaVideoTemporaryImages.ts", { createAiMediaVideoTemporaryImageStore: () => ({
      assertPrivateBucket: async () => {}, uploadImages: async (images: unknown[]) => {
        assert.equal(images.length, 3, "voiced requests retain every original instead of uploading a flattened/continuity-only frame"); return IMAGE_URLS;
      }, cleanup: async () => { cleanups++; },
    }) }],
    ["@/lib/aiMediaCharacterVoiceStorage", { getAiMediaCharacterVoiceSignedUrls: async (args: { videoEngine?: string; images: unknown[] }) => {
      signing.push(args); if (options.failSigning) throw new Error("voice_reference_unavailable");
      return options.missingSignedVoice ? [null, null, null] : VOICE_URLS;
    } }],
  ]);
  const record = { exports: {} };
  vm.runInThisContext(`(function(exports,require,module){${javascript}\n})`)(record.exports, (name: string) => {
    if (!stubs.has(name)) throw new Error(`unexpected_test_dependency:${name}`); return stubs.get(name);
  }, record);
  return { runtime: record.exports as Runtime, submissions, signing,
    reservations: () => reservations, frames: () => frames, cleanups: () => cleanups };
}

function assertReferences(input: Input, engine: typeof ENGINES[number]) {
  assert.equal(typeof input.prompt, "string");
  assert.equal(input.image, undefined); assert.equal(input.frameImages, undefined);
  const providerOptions = input.providerOptions as Record<string, Record<string, unknown>>;
  if (engine === "wan3") {
    assert.equal(input.model, "alibaba/wan-v3.0-video");
    assert.deepEqual(input.inputReferences, [
      ...IMAGE_URLS.map((data) => ({ data, mediaType: "image/webp" })), { data: VOICE_URL, mediaType: "audio/wav" },
    ]);
    assert.equal(providerOptions.alibaba.media, undefined);
    assert.equal(providerOptions.alibaba.promptExtend, false);
    assert.match(String(input.prompt), /Image 3.*character3.*Studio character 2/);
    assert.match(String(input.prompt), /Audio 1/);
    assert.doesNotMatch(String(input.prompt), /Audio 3/);
  } else {
    assert.equal(input.inputReferences, undefined);
    assert.equal(input.model, "heygen/heygen-video-1");
    assert.equal(providerOptions.heygen.mode, "reference_to_video");
    assert.equal(providerOptions.heygen.promptEnhancement, "disabled");
    assert.deepEqual(providerOptions.heygen.referenceImages, IMAGE_URLS.map((url) => ({ type: "url", url })));
    assert.deepEqual(providerOptions.heygen.referenceAudio, [{ type: "url", url: VOICE_URL }]);
    assert.match(String(input.prompt), /<Picture 3>.*character3.*Studio character 2/);
    assert.match(String(input.prompt), /<Audio 1>/);
    assert.doesNotMatch(String(input.prompt), /<Audio 3>/);
    assert.equal(input.aspectRatio, "9:16");
  }
  assert.equal(input.generateAudio, true);
  assert.doesNotMatch(String(input.prompt), /Never clone|distinct synthetic voices|stable adult synthetic voice|No native voices|NATIVE VOICEOVER|private-third-character|_studio-voice-references/);
}

for (const engine of ENGINES) {
  test(`${engine} maps one supplied voice to Image 3 while product and AI-only character occupy earlier slots`, () => {
    const { runtime } = loadRuntime();
    const input = runtime.buildGatewayAiVideoRequest(argsFor(engine), 0, undefined, IMAGE_URLS, VOICE_URLS);
    assertReferences(input, engine);
    assert.match(String(input.prompt), /Voici notre nouvelle collection !/);
  });

  test(`${engine} binds two distinct character samples to Audio 1 and Audio 2 without reusing either voice`, () => {
    const args = argsFor(engine);
    args.request.inspirationImages[1].voiceMode = "provided";
    args.request.inspirationImages[1].voiceSample = { ...args.request.inspirationImages[2].voiceSample!,
      path: args.request.inspirationImages[2].voiceSample!.path.replace(/[0-9a-f-]{36}\.wav$/, `${randomUUID()}.wav`), name: "second-character.wav" };
    const firstVoice = "https://private.example.com/second-reference-own-voice.wav";
    const { runtime } = loadRuntime();
    const input = runtime.buildGatewayAiVideoRequest(args, 0, undefined, IMAGE_URLS, [null, firstVoice, VOICE_URL]);
    const options = input.providerOptions as Record<string, Record<string, unknown>>;
    if (engine === "wan3") {
      assert.deepEqual((input.inputReferences as unknown[]).slice(3), [
        { data: firstVoice, mediaType: "audio/wav" }, { data: VOICE_URL, mediaType: "audio/wav" },
      ]);
      assert.match(String(input.prompt), /Image 2 = character2[^\n]*?Audio 1.*Image 3 = character3[^\n]*?Audio 2/);
    } else {
      assert.deepEqual(options.heygen.referenceAudio, [{ type: "url", url: firstVoice }, { type: "url", url: VOICE_URL }]);
      assert.match(String(input.prompt), /<Picture 2> = character2[^\n]*?<Audio 1>.*<Picture 3> = character3[^\n]*?<Audio 2>/);
    }
  });

  test(`${engine} rejects incompatible first-frame input and missing team consent before a paid request`, () => {
    const { runtime, reservations, submissions } = loadRuntime(); const args = argsFor(engine, true);
    assert.throws(() => runtime.buildGatewayAiVideoRequest(args, 1, { data: "ZnJhbWU=", mimeType: "image/jpeg" },
      IMAGE_URLS, VOICE_URLS, "https://private.example.com/previous-final-frame.jpg"), /first_frame_unsupported/);
    args.identityTeamProviderEgressConsent = undefined;
    assert.throws(() => runtime.buildGatewayAiVideoRequest(args, 0, undefined, IMAGE_URLS, VOICE_URLS), /provider_consent_required/);
    assert.equal(reservations(), 0); assert.equal(submissions.length, 0);
  });

  test(`${engine} preserves supplied-voice references on both native scene requests`, async () => {
    const previous = process.env.AI_GATEWAY_API_KEY; process.env.AI_GATEWAY_API_KEY = "local-test-only";
    try {
      const context = loadRuntime(); const args = argsFor(engine, true);
      await context.runtime.createGatewayAiVideoProvider(engine).generate(args);
      assert.equal(context.submissions.length, 2); assert.equal(context.reservations(), 2);
      for (const input of context.submissions) assertReferences(input, engine);
      assert.match(String(context.submissions[1].prompt), /Avec un service pensé pour vous !/);
      assert.equal(context.frames(), 0); assert.equal(context.cleanups(), 1);
      assert.equal(context.signing.length, 1); assert.equal(context.signing[0].videoEngine, engine);
      assert.deepEqual(context.signing[0].images, args.request.inspirationImages);
    } finally {
      if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previous;
    }
  });

  test(`${engine} cannot reserve generation credit when its real signed voice URL is absent`, async () => {
    const previous = process.env.AI_GATEWAY_API_KEY; process.env.AI_GATEWAY_API_KEY = "local-test-only";
    try {
      for (const options of [{ missingSignedVoice: true }, { failSigning: true }]) {
        const context = loadRuntime(options);
        await assert.rejects(context.runtime.createGatewayAiVideoProvider(engine).generate(argsFor(engine)), /voice.*(?:missing|unavailable)/);
        assert.equal(context.reservations(), 0); assert.equal(context.submissions.length, 0); assert.equal(context.cleanups(), 1);
      }
    } finally {
      if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previous;
    }
  });

  test(`the actual Free normalizer retains ${engine} and an inspiration character's supplied voice`, () => {
    const args = argsFor(engine); args.request.inspirationImages[2].usage = "inspiration";
    args.request.identityMode = "professional";
    const normalized = normalizeAiMediaGenerationRequest({ ...args.request, contractVersion: 4,
      withNarration: true, identityReferenceSetId: randomUUID(), subjectSource: "custom" });
    assert.equal(normalized.videoEngine, engine); assert.equal(normalized.withNarration, false);
    assert.equal(normalized.teamVideoSpeechMode, "characters"); assert.equal(normalized.inspirationImages[2].usage, "inspiration");
    assert.equal(normalized.inspirationImages[2].voiceSample?.path, args.request.inspirationImages[2].voiceSample?.path);
    const canonicalPrompt = freePrompt.buildAiMediaFreeVideoPrompt({ request: normalized,
      profile: { business: { companyName: "" }, preferences: { language: "fr" } } } as never);
    const { runtime } = loadRuntime();
    assertReferences(runtime.buildGatewayAiVideoRequest({ ...args, request: normalized, canonicalPrompt,
      canonicalPromptSha256: boundary.hashAiMediaCanonicalPrompt(canonicalPrompt),
      providerContract: boundary.buildAiMediaVideoProviderContract({ request: normalized, durationSeconds: 8, brandColors: [] }),
    }, 0, undefined, IMAGE_URLS, VOICE_URLS), engine);
  });
}

test("connected HeyGen voiced clips retain originals without adding an incompatible first-frame input", async () => {
  const args = argsFor("heygen", true); args.request.sceneMode = "single";
  const previous = process.env.AI_GATEWAY_API_KEY; process.env.AI_GATEWAY_API_KEY = "local-test-only";
  try {
    const context = loadRuntime();
    const result = await context.runtime.createGatewayAiVideoProvider("heygen").generate(args);
    assert.equal(context.submissions.length, 2); assert.equal(context.frames(), 0);
    for (const input of context.submissions) assertReferences(input, "heygen");
    assert.ok(result.warnings.includes("video_continuity_original_subject_references_preserved"));
  } finally {
    if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previous;
  }
});

test("unsupported engines reject a supplied voice before reservation instead of silently generating an AI voice", async () => {
  const context = loadRuntime(); const args = argsFor("grok"); args.request.identityMode = "professional";
  await assert.rejects(context.runtime.createGatewayAiVideoProvider("grok").generate(args), /voice.*(?:unsupported|engine)|voix.*(?:Wan|HeyGen)/i);
  assert.equal(context.reservations(), 0); assert.equal(context.submissions.length, 0);
});

test("the installed Gateway SDK serializes both engines' native reference-audio fields without a schema upgrade", async () => {
  const { createGateway, experimental_generateVideo } = await import("ai");
  for (const engine of ENGINES) {
    const { runtime } = loadRuntime();
    const input = runtime.buildGatewayAiVideoRequest(argsFor(engine), 0, undefined, IMAGE_URLS, VOICE_URLS);
    let calls = 0;
    const gateway = createGateway({ apiKey: "local-test-only", fetch: async (_url, init) => {
      calls++; assert.equal(new Headers(init?.headers).get("ai-model-id"), input.model);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.image, undefined); assert.equal(body.frameImages, undefined);
      if (engine === "wan3") {
        assert.deepEqual(body.inputReferences, [
          ...IMAGE_URLS.map((url) => ({ type: "url", url, mediaType: "image/webp" })),
          { type: "url", url: VOICE_URL, mediaType: "audio/wav" },
        ]);
      } else assert.equal(body.inputReferences, undefined);
      assert.deepEqual(body.providerOptions, input.providerOptions);
      assert.equal(body.generateAudio, true);
      const output = { type: "result", videos: [{ type: "base64", mediaType: "video/mp4", data: Buffer.from("mock-only-video").toString("base64") }], warnings: [] };
      return new Response(`data: ${JSON.stringify(output)}\n\n`, { headers: { "content-type": "text/event-stream" } });
    } });
    const result = await experimental_generateVideo({ ...input, model: gateway.video(String(input.model)) } as Parameters<typeof experimental_generateVideo>[0]);
    assert.equal(calls, 1); assert.equal(result.videos.length, 1);
  }
});
