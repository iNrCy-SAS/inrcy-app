import * as characterVoices from "../../lib/aiMediaCharacterVoices.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as catalog from "../../lib/aiMediaModelCatalog.ts";
import * as pricing from "../../lib/aiMediaCreditsPricing.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as boundary from "../../lib/aiMediaVideoProviderContract.ts";
import * as providerTypes from "../../lib/aiVideoProviderTypes.ts";
import { AiMediaRequestValidationError, normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { bufferFromUint8ArrayView } from "../../lib/aiMediaBuffer.ts";
import * as freePrompt from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as sensitiveText from "../../lib/aiMediaSensitiveText.ts";
import { getAiMediaGenerationPublicError } from "../../lib/aiMediaGenerationPublicErrors.ts";

type Runtime = {
  buildGatewayAiVideoRequest: (args: providerTypes.AiVideoProviderGenerationArgs, index?: number, continuityFrame?: { data: string; mimeType: "image/jpeg" }) => Record<string, unknown>;
  createGatewayAiVideoProvider: (engine: catalog.AiMediaVideoEngine) => providerTypes.AiVideoProvider;
};

function argsFor(engine: catalog.AiMediaVideoEngine, references = 0, duration = 5, sceneMode: catalog.AiMediaVideoSceneMode = "single"): providerTypes.AiVideoProviderGenerationArgs {
  const base = {
    version: boundary.AI_MEDIA_VIDEO_PROVIDER_CONTRACT_VERSION,
    subject: "Un artisan présente son travail.", instruction: "La caméra avance doucement.",
    parameters: "duration=5;native_audio=true", references: references ? "required characters" : "none",
  };
  return {
    accountId: "account-test", canonicalPrompt: "Film demandé, sans perte du brief.",
    canonicalPromptSha256: boundary.hashAiMediaCanonicalPrompt("Film demandé, sans perte du brief."),
    providerContract: { ...base, sha256: boundary.hashAiMediaVideoProviderContract(base) },
    request: {
      requestId: "generation-test", kind: "video", videoEngine: engine, durationSeconds: duration, sceneMode,
      videoResolution: catalog.getAiMediaVideoModel(engine).defaultResolution, format: "landscape", identityMode: "auto",
      inspirationImages: Array.from({ length: references }, () => ({ data: Buffer.from("image").toString("base64"), mimeType: "image/png" })),
    },
    plan: { scenes: timeline.getAiMediaVideoSegmentDurations(duration, engine, undefined, sceneMode).map(() => ({ visualBrief: "Avancée lente." })) },
  } as unknown as providerTypes.AiVideoProviderGenerationArgs;
}

function loadRuntime(mode: "success" | "rejected" | "http-rejected" | "balance-insufficient" | "bad-asset" | "download-failed" | "second-rejected" | "frame-failed" | "storage-failed" | "warnings-with-url" | "await-abort" = "success") {
  const counters = { requests: 0, reservations: 0, commits: 0, rollbacks: 0 };
  let observed: Record<string, unknown> | undefined;
  const submissions: Record<string, unknown>[] = [];
  const costs: number[] = [];
  let frames = 0;
  let storageCleanups = 0;
  let privateChecks = 0;
  const hostedImages: { data: string; mimeType: string }[][] = [];
  let expireTimeout: (() => void) | undefined;
  let timeoutDelay: number | undefined;
  const source = readFileSync(path.join(process.cwd(), "lib/aiVideoProviderGateway.ts"), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const noOp = () => undefined;
  const stubs = new Map<string, unknown>([
    ["server-only", {}], ["./aiMediaCharacterVoices.ts", characterVoices], ["@/lib/aiMediaCharacterVoices", characterVoices],
    ["ai", {
      createDownload: () => async () => { throw new Error("download unavailable"); },
      experimental_generateVideo: async (input: Record<string, unknown>) => {
        counters.requests += 1; observed = input; submissions.push(input);
        if (mode === "await-abort") {
          const signal = input.abortSignal as AbortSignal;
          await new Promise<never>((_resolve, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
        if (mode === "rejected") throw new Error("provider rejected before output");
        if (mode === "balance-insufficient") throw Object.assign(new Error("Video generation requires a minimum balance of $10. Your current balance is insufficient. Visit https://provider.invalid/billing?token=private to top up your credits."), {
          requestBodyValues: { prompt: "private-brief-sentinel" },
        });
        if (mode === "http-rejected") throw Object.assign(new Error("Provider unavailable"),{statusCode:503,requestBodyValues:{prompt:"private-brief-sentinel"}});
        if (mode === "second-rejected" && counters.requests === 2) throw new Error("second provider rejected before output");
        if (mode === "download-failed") {
          const download = input.download as (options: { url: URL }) => Promise<unknown>;
          await download({ url: new URL("https://example.com/asset.mp4") });
        }
        const buffer = Buffer.alloc(24);
        if (mode !== "bad-asset") buffer.write("ftyp", 4, "ascii");
        return { videos: [{ uint8Array: buffer }], warnings: mode === "warnings-with-url" ? [{ type: "other", message: "Source https://storage.example.com/private.jpg?token=secret" }] : [] };
      },
    }],
    ["@/lib/aiGatewayAccountGuard", {
      reserveAiGatewayAccountAttempt: async () => { counters.reservations += 1; return {}; },
      commitAiGatewayAccountAttempt: async (input: { actualCostMicroUsd: number }) => { counters.commits += 1; costs.push(input.actualCostMicroUsd); },
      rollbackAiGatewayAccountAttempt: async () => { counters.rollbacks += 1; },
      recordAiGatewayAccountFailure: async () => noOp(),
    }],
    ["./aiMediaBuffer.ts", { bufferFromUint8ArrayView }],
    ["./aiMediaFreeGenerationPrompt.ts", freePrompt],
    ["@/lib/aiMediaGenerationContracts", { AiMediaRequestValidationError }],
    ["./aiMediaModelCatalog.ts", catalog],
    ["./aiMediaCreditsPricing.ts", pricing],
    ["./aiMediaVideoTimeline.ts", timeline],
    ["./aiMediaVideoContinuity.ts", { extractAiMediaVideoContinuityFrame: async () => {
      frames += 1;
      if (mode === "frame-failed") throw new Error("frame unavailable");
      return { data: Buffer.from("generated-last-frame").toString("base64"), mimeType: "image/jpeg" };
    } }],
    ["./aiMediaVideoTemporaryImages.ts", { createAiMediaVideoTemporaryImageStore: () => ({
      assertPrivateBucket: async () => { privateChecks += 1; if (mode === "storage-failed") throw new Error("private_bucket_required"); },
      uploadImages: async (images: { data: string; mimeType: string }[]) => {
        if (mode === "storage-failed") throw new Error("storage unavailable");
        hostedImages.push(images);
        return images.map((_, index) => `https://storage.example.com/signed/${hostedImages.length}-${index}?token=secret`);
      },
      cleanup: async () => { storageCleanups += 1; },
    }) }],
    ["@/lib/aiMediaSensitiveText", sensitiveText],
    ["./aiMediaVideoProviderContract.ts", boundary],
    ["@/lib/aiVideoProviderGoogleVeo", {
      buildGoogleVideoScenePrompt: (args: providerTypes.AiVideoProviderGenerationArgs) => args.canonicalPrompt,
      buildGoogleVideoTeamSpeechDirection: () => "No native speech.",
    }],
    ["@/lib/aiVideoProviderTypes", providerTypes],
  ]);
  const nativeRequire = createRequire(import.meta.url);
  const localRequire = (specifier: string) => {
    if (stubs.has(specifier)) return stubs.get(specifier);
    if (specifier.startsWith("node:")) return nativeRequire(specifier);
    throw new Error(`unexpected_dependency:${specifier}`);
  };
  const commonJsModule = { exports: {} };
  const factory = vm.runInThisContext(`(function(exports,require,module,setTimeout){${javascript}\n})`) as (
    exports: object, require: typeof localRequire, module: typeof commonJsModule, schedule: typeof setTimeout,
  ) => void;
  const schedule = mode === "await-abort" ? ((callback: () => void, delay: number) => {
    expireTimeout = callback; timeoutDelay = delay; return 0;
  }) as unknown as typeof setTimeout : setTimeout;
  factory(commonJsModule.exports, localRequire, commonJsModule, schedule);
  return { runtime: commonJsModule.exports as Runtime, counters, submissions, costs, hostedImages,
    frames: () => frames, storageCleanups: () => storageCleanups, privateChecks: () => privateChecks, observed: () => observed,
    timeoutDelay: () => timeoutDelay, expireTimeout: () => { assert.ok(expireTimeout); expireTimeout(); } };
}

test("a definite Gateway rejection keeps safe fallback evidence without retaining the private SDK request",async()=>{
  await withMockCredentials(async()=>{
    const context=loadRuntime("http-rejected");
    await assert.rejects(context.runtime.createGatewayAiVideoProvider("veo-lite").generate(argsFor("veo-lite",0,8)),(error)=>{
      assert.equal(providerTypes.getAiVideoProviderRecoverableStatus(error),503);
      assert.equal((error as Error).cause,undefined);
      assert.doesNotMatch(JSON.stringify(error),/private-brief-sentinel|requestBodyValues/);
      return true;
    });
    assert.deepEqual(context.counters,{requests:1,reservations:1,commits:0,rollbacks:1});
  });
});

test("Gateway balance rejection retains a redacted diagnosis, releases its reservation and never retries", async () => {
  await withMockCredentials(async () => {
    for (const engine of ["heygen", "grok-lite"] as const) {
      const context = loadRuntime("balance-insufficient");
      await assert.rejects(context.runtime.createGatewayAiVideoProvider(engine).generate(argsFor(engine, 0, 8)), error => {
        assert.equal(getAiMediaGenerationPublicError(error).code, "AI_MEDIA_PROVIDER_BALANCE_INSUFFICIENT");
        assert.equal(providerTypes.getAiVideoProviderRecoverableStatus(error), 0);
        assert.match((error as Error).message, /current balance is insufficient/);
        assert.match((error as Error).message, /provider-url-redacted/);
        assert.doesNotMatch((error as Error).message + JSON.stringify(error), /provider\.invalid|token=private|private-brief-sentinel|requestBodyValues/);
        return true;
      });
      assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 0, rollbacks: 1 });
    }
  });
});

test("Veo Lite sends canonical resolution tiers independently of portrait orientation before any paid request", () => {
  for (const format of ["story", "portrait", "landscape"] as const) for (const resolution of ["720p", "1080p"] as const) {
    const context = loadRuntime(); const args = argsFor("veo-lite", 0, 8);
    args.request.format = format; args.request.videoResolution = resolution;
    const input = context.runtime.buildGatewayAiVideoRequest(args);
    assert.equal(input.resolution, resolution === "1080p" ? "1920x1080" : "1280x720");
    assert.equal(input.aspectRatio, format === "landscape" ? "16:9" : "9:16");
    assert.equal(input.duration, 8); assert.equal(input.maxRetries, 0); assert.equal(input.n, 1);
    assert.equal(context.counters.reservations, 0); assert.equal(context.counters.requests, 0);
  }
});

for (const resolution of ["768p", "1080p"] as const) {
  for (const format of ["square", "portrait", "story", "landscape"] as const) {
    test(`HeyGen ${resolution}/${format}: explicit T2V tier, safe framing and untouched native audio`, async () => {
      await withMockCredentials(async () => {
        const context = loadRuntime(); const args = argsFor("heygen", 0, 5);
        args.request.videoResolution = resolution; args.request.format = format;
        const result = await context.runtime.createGatewayAiVideoProvider("heygen").generate(args);
        const input = context.observed()!;
        const expectedRatio = format === "story" ? "9:16" : format === "landscape" ? "16:9"
          : format === "portrait" ? resolution === "1080p" ? "9:16" : "3:4"
            : resolution === "1080p" ? "16:9" : "1:1";
        assert.equal(input.model, "heygen/heygen-video-1");
        assert.deepEqual(input.providerOptions, { heygen: { resolution, mode: "text_to_video", promptEnhancement: "disabled" } });
        assert.equal(input.resolution, undefined); assert.equal(input.aspectRatio, expectedRatio);
        assert.equal(input.generateAudio, true); assert.equal(input.seed, undefined);
        assert.equal(input.maxRetries, 0); assert.equal(input.n, 1); assert.equal(input.duration, 5);
        assert.ok(String(input.prompt).startsWith(args.canonicalPrompt));
        const adapted = resolution === "1080p" && (format === "square" || format === "portrait");
        assert.equal(String(input.prompt).includes("SAFE FRAME"), adapted);
        assert.equal(result.warnings.some((warning) => warning.startsWith("video_provider_aspect_ratio_adapted:")), adapted);
        assert.deepEqual(context.costs, [resolution === "768p" ? 180_000 : 500_000]);
        assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 1, rollbacks: 0 });
      });
    });
    test(`HeyGen ${resolution}/${format}: one inline first frame never selects the more expensive reference mode`, async () => {
      await withMockCredentials(async () => {
        const context = loadRuntime(); const args = argsFor("heygen", 1, 5);
        args.request.videoResolution = resolution; args.request.format = format;
        await context.runtime.createGatewayAiVideoProvider("heygen").generate(args);
        const input = context.observed()!;
        assert.deepEqual(input.providerOptions, { heygen: { resolution, mode: "image_to_video", promptEnhancement: "disabled" } });
        assert.equal(input.resolution, undefined); assert.equal(input.aspectRatio, undefined);
        assert.equal(input.inputReferences, undefined);
        assert.deepEqual((input.prompt as { image: Buffer }).image, Buffer.from("image"));
        assert.equal((input.prompt as { text: string }).text, args.canonicalPrompt);
        assert.equal(input.generateAudio, true); assert.equal(input.maxRetries, 0);
        assert.equal(context.hostedImages.length, 0);
        assert.deepEqual(context.costs, [resolution === "768p" ? 220_000 : 540_000]);
      });
    });
  }
}

test("HeyGen rejects four seconds, extra references and oversized inline/continuity images before reservation", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime(); const provider = context.runtime.createGatewayAiVideoProvider("heygen");
    const short = argsFor("heygen"); short.request.durationSeconds = 4;
    await assert.rejects(provider.generate(short), /duration_unsupported/);
    await assert.rejects(provider.generate(argsFor("heygen", 2)), /references_unsupported/);
    const large = argsFor("heygen", 1);
    large.request.inspirationImages[0].data = Buffer.alloc(5_000_001).toString("base64");
    await assert.rejects(provider.generate(large), /dépasse 5 Mo/);
    assert.throws(() => context.runtime.buildGatewayAiVideoRequest(argsFor("heygen"), 0,
      { data: large.request.inspirationImages[0].data, mimeType: "image/jpeg" }), /dépasse 5 Mo/);
    assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
  });
});

test("HeyGen validates the complete prompt including framing instructions before reservation", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime(); const args = argsFor("heygen", 0, 5);
    args.canonicalPrompt = "x".repeat(32_000);
    args.canonicalPromptSha256 = boundary.hashAiMediaCanonicalPrompt(args.canonicalPrompt);
    assert.equal(String(context.runtime.buildGatewayAiVideoRequest(args).prompt).length, 32_000);
    args.request.videoResolution = "1080p"; args.request.format = "square";
    await assert.rejects(context.runtime.createGatewayAiVideoProvider("heygen").generate(args), /32 000 caractères/);
    args.request.format = "landscape"; args.canonicalPrompt += "x";
    args.canonicalPromptSha256 = boundary.hashAiMediaCanonicalPrompt(args.canonicalPrompt);
    await assert.rejects(context.runtime.createGatewayAiVideoProvider("heygen").generate(args), /32 000 caractères/);
    assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
  });
});

for (const sceneMode of ["single", "multi"] as const) {
  test(`HeyGen 30s ${sceneMode} bills each transmitted frame once and keeps the same model`, async () => {
    await withMockCredentials(async () => {
      const context = loadRuntime();
      const result = await context.runtime.createGatewayAiVideoProvider("heygen").generate(argsFor("heygen", 1, 30, sceneMode));
      assert.deepEqual(result.clips.map((clip) => clip.durationSeconds), [15, 15]);
      assert.deepEqual(context.costs, [580_000, 580_000]);
      assert.equal(result.estimatedCostMicroUsd, 1_160_000);
      assert.equal(context.frames(), sceneMode === "single" ? 1 : 0);
      assert.ok(context.submissions.every((input) => input.maxRetries === 0 && input.model === "heygen/heygen-video-1"));
      assert.deepEqual((context.submissions[1].prompt as { image: Buffer }).image,
        Buffer.from(sceneMode === "single" ? "generated-last-frame" : "image"));
      assert.deepEqual(context.counters, { requests: 2, reservations: 2, commits: 2, rollbacks: 0 });
    });
  });
}

test("HeyGen timeout aborts the single in-flight SDK request without resubmitting", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime("await-abort");
    const pending = context.runtime.createGatewayAiVideoProvider("heygen").generate(argsFor("heygen"));
    for (let turn = 0; turn < 10 && !context.counters.requests; turn++) await Promise.resolve();
    assert.equal(context.counters.requests, 1); assert.equal(context.timeoutDelay(), 600_000);
    context.expireTimeout();
    await assert.rejects(pending, /ai_video_gateway_timeout/);
    assert.equal((context.observed()?.abortSignal as AbortSignal).aborted, true);
    assert.equal(context.counters.requests, 1); assert.equal(context.counters.reservations, 1);
  });
});

test("HeyGen failure after a first paid clip never retries the failed scene or forgets the paid asset", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime("second-rejected");
    await assert.rejects(context.runtime.createGatewayAiVideoProvider("heygen").generate(argsFor("heygen", 0, 30)),
      (error: unknown) => providerTypes.isAiVideoProviderBillableFailure(error));
    assert.deepEqual(context.counters, { requests: 2, reservations: 2, commits: 1, rollbacks: 1 });
    assert.deepEqual(context.costs, [540_000]);
  });
});

test("the installed AI SDK serializes HeyGen native options and an inline first frame through Gateway without a network call", async () => {
  const { createGateway, experimental_generateVideo } = await import("ai");
  const context = loadRuntime(); const args = argsFor("heygen", 1, 5);
  args.request.videoResolution = "1080p"; args.request.format = "story";
  const input = context.runtime.buildGatewayAiVideoRequest(args);
  let calls = 0;
  const gateway = createGateway({ apiKey: "unit-test-mock-credential", fetch: async (url, init) => {
    calls++;
    assert.ok(String(url).endsWith("/video-model"));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("ai-model-id"), "heygen/heygen-video-1");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.providerOptions, { heygen: { resolution: "1080p", mode: "image_to_video", promptEnhancement: "disabled" } });
    assert.equal(body.resolution, undefined); assert.equal(body.aspectRatio, undefined);
    assert.equal(body.inputReferences, undefined); assert.equal(body.generateAudio, true);
    assert.equal(body.image.data, Buffer.from("image").toString("base64"));
    const output = { type: "result", videos: [{ type: "base64", mediaType: "video/mp4", data: Buffer.from("local-test-video").toString("base64") }], warnings: [] };
    return new Response(`data: ${JSON.stringify(output)}\n\n`, { headers: { "content-type": "text/event-stream" } });
  } });
  const result = await experimental_generateVideo({ ...input, model: gateway.video("heygen/heygen-video-1") } as Parameters<typeof experimental_generateVideo>[0]);
  assert.equal(calls, 1); assert.equal(result.videos.length, 1);
});

test("Wan Libre conserve la séparation audio/texte et le plein cadre dans son transport compact", () => {
  const context = loadRuntime();
  const args = argsFor("wan-flash", 1, 4);
  args.request.creationMode = "free";
  args.request.freePrompt = args.providerContract.instruction;
  const input = context.runtime.buildGatewayAiVideoRequest(args);
  const prompt = (input.prompt as { text: string }).text;
  assert.ok(prompt.includes(freePrompt.buildAiMediaFreeVideoPresentationContract(args.request)));
  assert.ok(prompt.includes(`USER: ${args.request.freePrompt}`));
  assert.ok(prompt.length <= 1500);
  assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
});

function wanFreeArgs(speech: "voiceover" | "characters", instruction: string, subject = "") {
  const args = argsFor("wan-flash", 1, 8);
  args.request.creationMode = "free";
  args.request.withNarration = false; // The orchestrator owns the separate narration track.
  args.request.teamVideoSpeechMode = speech;
  args.request.freePrompt = instruction;
  args.plan.subline = "Un artisan accueille une cliente dans son atelier.";
  args.plan.scenes[0].visualBrief = "Il présente ses outils avec des gestes et un sourire.";
  args.plan.scenes[0].spokenLine = speech === "characters" ? "Bienvenue dans notre atelier." : "";
  const contract = { ...args.providerContract, instruction, subject,
    parameters: `mode=free;characters=${speech === "characters" ? "native-dialogue" : "silent"};voiceover=none`,
  };
  args.providerContract = { ...contract, sha256: boundary.hashAiMediaVideoProviderContract(contract) };
  // Keep the actual free scene compiler in this test; only the Google module
  // loading boundary is mocked by the generic Gateway harness.
  args.canonicalPrompt = freePrompt.buildAiMediaFreeVideoScenePrompt(args, 0, 8);
  args.canonicalPromptSha256 = boundary.hashAiMediaCanonicalPrompt(args.canonicalPrompt);
  return args;
}

test("Wan compact keeps the visual silence contract before USER and removes only audio quotations from instruction and subject", () => {
  const context = loadRuntime();
  const args = wanFreeArgs("voiceover",
    "Un artisan montre ses outils. Voix off exacte : « Votre projet prend forme. » Affiche le titre « Bienvenue à l’atelier ».",
    "Un atelier lumineux. Narration : « Chaque geste compte. »");
  const input = context.runtime.buildGatewayAiVideoRequest(args);
  const prompt = (input.prompt as { text: string }).text;
  assert.ok(prompt.indexOf("VISUAL SPEECH:") >= 0);
  assert.ok(prompt.indexOf("VISUAL SPEECH:") < prompt.indexOf("USER:"));
  assert.ok(prompt.indexOf("VISUAL SPEECH:") < prompt.indexOf("SUBJECT:"));
  assert.match(prompt, /No speaking\/articulation\/mimed speech\/lip-sync/);
  assert.ok(prompt.includes("Un artisan montre ses outils."));
  assert.ok(prompt.includes("Un atelier lumineux."));
  assert.ok(prompt.includes("« Bienvenue à l’atelier »"));
  assert.doesNotMatch(prompt, /Votre projet prend forme|Chaque geste compte|NATIVE VOICEOVER:/);
  assert.match(prompt, /No native voices or dialogue/);
  assert.ok(prompt.length <= 1_500);
  assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
});

test("Wan compact preserves explicitly displayed speech wording while native character dialogue stays intentional", () => {
  const context = loadRuntime();
  const line = "Bienvenue dans notre atelier.";
  const voiceover = wanFreeArgs("voiceover", `Un artisan sourit. Voix off exacte : « ${line} » Affiche le sous-titre « ${line} ».`);
  const visual = (context.runtime.buildGatewayAiVideoRequest(voiceover).prompt as { text: string }).text;
  assert.equal(visual.split(line).length, 2, "The explicitly displayed occurrence remains exactly once.");
  assert.match(visual, /Affiche le sous-titre/);
  assert.match(visual, /No native voices or dialogue/);
  assert.match(visual, /VISUAL SPEECH: No speaking\/articulation\/mimed speech\/lip-sync/);
  assert.ok(visual.length <= 1_500);

  const dialogue = wanFreeArgs("characters", `Un artisan parle face caméra. Il dit : « ${line} »`);
  const native = (context.runtime.buildGatewayAiVideoRequest(dialogue).prompt as { text: string }).text;
  assert.ok(native.includes(`USER: ${dialogue.providerContract.instruction}`));
  assert.ok(native.includes(`says exactly once: “${line}”`));
  assert.match(native, /Synchronize the mouth and audible speech/);
  assert.doesNotMatch(native, /VISUAL SPEECH:|No native voices|NATIVE VOICEOVER:/);
  assert.ok(native.length <= 1_500);
  assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
});

test("Wan compact retains pronunciation instructions for native character speech", () => {
  const context = loadRuntime();
  const args = wanFreeArgs("characters", 'Une femme dit : « Bonjour, voici iNrCy. » iNrCy se prononce « inertie ».');
  const input = context.runtime.buildGatewayAiVideoRequest(args);
  const prompt = (input.prompt as { text: string }).text;
  assert.match(prompt, /AUDIO PRONUNCIATION:/);
  assert.match(prompt, /"spelling":"iNrCy","pronunciation":"inertie"/);
  assert.match(prompt, /says exactly once: “Bonjour, voici iNrCy\.”/);
  assert.ok(prompt.length <= 1_500);
  assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
});

test("Wan visual silence fits previously valid full briefs with the real normalized provider contract", () => {
  const context = loadRuntime();
  for (const length of [560, 720, 900]) {
    const brief = "Une personne se promène dans un atelier lumineux. ".repeat(40).slice(0, length).trim();
    const args = argsFor("wan-flash", 1, 8);
    args.request = normalizeAiMediaGenerationRequest({
      requestId: "wan-silent-budget-0001", source: "studio", operation: "generate",
      creationMode: "free", kind: "video", freePrompt: brief, withNarration: false,
      teamVideoSpeechMode: "voiceover", durationSeconds: 8, videoEngine: "wan-flash",
      format: "landscape", sceneMode: "single",
      inspirationImages: [{ data: "A".repeat(64), mimeType: "image/png", role: "environment", usage: "required" }],
    });
    args.plan.subline = "Promenade silencieuse dans un atelier.";
    args.plan.scenes[0].visualBrief = "Une personne observe les outils avec un sourire.";
    args.providerContract = boundary.buildAiMediaVideoProviderContract({ request: args.request, durationSeconds: 8, brandColors: [] });
    args.canonicalPrompt = freePrompt.buildAiMediaFreeVideoScenePrompt(args, 0, 8);
    args.canonicalPromptSha256 = boundary.hashAiMediaCanonicalPrompt(args.canonicalPrompt);
    if (length === 900) {
      assert.throws(() => context.runtime.buildGatewayAiVideoRequest(args), /ai_video_instruction_contract_too_long/,
        "A truly oversized brief must still be refused, never silently truncated.");
      continue;
    }
    const prompt = (context.runtime.buildGatewayAiVideoRequest(args).prompt as { text: string }).text;
    assert.ok(prompt.includes(`USER: ${brief}`), "Keep the entire user brief.");
    assert.ok(prompt.includes(`ACTION: ${args.plan.scenes[0].visualBrief}`));
    assert.ok(prompt.includes(`PARAMS: ${args.providerContract.parameters}`));
    assert.ok(prompt.includes(`REFERENCES: ${args.providerContract.references}`));
    assert.match(prompt, /VISUAL SPEECH: No speaking\/articulation\/mimed speech\/lip-sync/);
    assert.ok(prompt.indexOf("VISUAL SPEECH:") < prompt.indexOf("USER:"));
    assert.match(prompt, /No native voices or dialogue/);
    assert.ok(prompt.length <= 1_500, `Full ${length}-character brief must fit: ${prompt.length}`);
  }
  assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
});

test("Gateway persists a useful warning without a private signed image URL", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime("warnings-with-url");
    const result = await context.runtime.createGatewayAiVideoProvider("minimax-h3").generate(argsFor("minimax-h3", 1));
    assert.ok(result.warnings[0].includes("[provider-url-redacted]"));
    assert.doesNotMatch(result.warnings.join(" "), /https:|storage\.example|token=|secret/);
    assert.equal(context.storageCleanups(), 1);
  });
});

for (const engine of ["minimax-h3", "wan-flash"] as const) {
  test(`${engine}: URL-only image inputs are privately hosted before any paid call and the generated continuity frame is hosted too`, async () => {
    await withMockCredentials(async () => {
      const context = loadRuntime();
      await context.runtime.createGatewayAiVideoProvider(engine).generate(argsFor(engine, 1, 30));
      assert.equal(context.counters.requests, 2);
      assert.equal(context.privateChecks(), 1);
      assert.equal(context.hostedImages.length, 2);
      assert.equal(context.hostedImages[0][0].data, Buffer.from("image").toString("base64"));
      assert.equal(context.hostedImages[1][0].data, Buffer.from("generated-last-frame").toString("base64"));
      assert.equal(context.storageCleanups(), 1);
      for (const input of context.submissions) assert.match((input.prompt as { image: string }).image, /^https:\/\/storage\.example\.com\/signed\//);
    });
  });
  test(`${engine}: unavailable private input storage fails before economic reservation, including a long text-only H3 film`, async () => {
    await withMockCredentials(async () => {
      const context = loadRuntime("storage-failed");
      await assert.rejects(context.runtime.createGatewayAiVideoProvider(engine).generate(argsFor(engine, engine === "wan-flash" ? 1 : 0, 30)), /private_bucket_required/);
      assert.equal(context.counters.requests, 0);
      assert.equal(context.counters.reservations, 0);
      assert.equal(context.storageCleanups(), 1);
    });
  });
}

async function withMockCredentials(run: () => Promise<void>) {
  const original = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "unit-test-mock-credential";
  try { await run(); }
  finally {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
  }
}

test("Gateway submits one exact reviewed model with native short duration and no automatic retries", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime();
    const args = argsFor("grok-lite", 1, 4);
    const result = await context.runtime.createGatewayAiVideoProvider("grok-lite").generate(args);
    assert.equal(result.clips[0].durationSeconds, 4);
    assert.equal(context.observed()?.model, "spacexai/grok-imagine-video-1.5-lite");
    assert.equal(context.observed()?.generateAudio, true);
    assert.equal(context.observed()?.maxRetries, 0);
    assert.equal(context.observed()?.n, 1);
    assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 1, rollbacks: 0 });
  });
});

for (const engine of ["grok-lite", "grok"] as const) {
  for (const resolution of ["720p", "1080p"] as const) {
    for (const [format, aspectRatio] of [["landscape", "16:9"], ["portrait", "3:4"], ["story", "9:16"]] as const) {
      test(`${engine}: ${resolution} ${format} reaches xAI as a native tier without a dimensions warning`, async () => {
        await withMockCredentials(async () => {
          const context = loadRuntime();
          const args = argsFor(engine, 1, 4);
          args.request.videoResolution = resolution;
          args.request.format = format;
          const result = await context.runtime.createGatewayAiVideoProvider(engine).generate(args);
          const input = context.observed();
          assert.deepEqual(input?.providerOptions, { xai: { resolution } });
          assert.equal(input?.resolution, undefined);
          assert.equal(input?.aspectRatio, aspectRatio);
          assert.equal((input?.prompt as { text: string }).text, args.canonicalPrompt);
          assert.equal(input?.generateAudio, true);
          assert.equal(result.clips[0].durationSeconds, 4);
          assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 1, rollbacks: 0 });
        });
      });
    }
  }
}

for (const [resolution, format, dimensions] of [
  ["720p", "landscape", "1280x720"], ["720p", "story", "720x1280"],
  ["1080p", "landscape", "1920x1080"], ["1080p", "story", "1080x1920"],
] as const) {
  test(`Wan Flash: ${resolution} ${format} keeps explicit dimensions and native audio without unsupported aspectRatio`, () => {
    const { runtime } = loadRuntime();
    const args = argsFor("wan-flash", 1, 4);
    args.request.videoResolution = resolution;
    args.request.format = format;
    const input = runtime.buildGatewayAiVideoRequest(args);
    assert.equal(input.resolution, dimensions);
    assert.equal(input.aspectRatio, undefined);
    assert.equal(input.providerOptions, undefined);
    assert.equal(input.generateAudio, true);
  });
}

test("Grok 1.5 accepts two references in 720p without losing either reference", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime();
    const args = argsFor("grok", 2, 4);
    await context.runtime.createGatewayAiVideoProvider("grok").generate(args);
    const input = context.observed();
    assert.deepEqual(input?.providerOptions, { xai: { resolution: "720p" } });
    assert.equal((input?.inputReferences as unknown[]).length, 2);
    assert.equal(input?.prompt, args.canonicalPrompt);
    assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 1, rollbacks: 0 });
  });
});

test("Grok 1.5 refuses two references in 1080p before any supplier reservation or submission", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime();
    const args = argsFor("grok", 2, 4);
    args.request.videoResolution = "1080p";
    await assert.rejects(context.runtime.createGatewayAiVideoProvider("grok").generate(args), (error: unknown) => {
      assert.ok(error instanceof AiMediaRequestValidationError);
      assert.equal(error.code, "invalid_ai_media_request");
      assert.match(error.message, /720p uniquement/);
      return true;
    });
    assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
  });
});

test("H3 keeps its reviewed request and speech prompt without an unsupported audio switch", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime();
    const args = argsFor("minimax-h3", 0, 4);
    args.canonicalPrompt = "La femme dit exactement : Bonjour, bienvenue dans notre atelier.";
    args.canonicalPromptSha256 = boundary.hashAiMediaCanonicalPrompt(args.canonicalPrompt);
    await context.runtime.createGatewayAiVideoProvider("minimax-h3").generate(args);
    const input = context.observed();
    assert.equal(input?.model, "minimax/minimax-h3");
    assert.equal(input?.prompt, args.canonicalPrompt);
    assert.equal(input?.resolution, "1366x768");
    assert.equal(input?.aspectRatio, "16:9");
    assert.equal(input?.generateAudio, undefined);
    assert.equal(input?.providerOptions, undefined);
    assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 1, rollbacks: 0 });
  });
});

test("multiple H3 references reach inputReferences rather than silently dropping photos", () => {
  const { runtime } = loadRuntime();
  const input = runtime.buildGatewayAiVideoRequest(argsFor("minimax-h3", 3));
  assert.equal((input.inputReferences as unknown[]).length, 3);
  assert.equal(typeof input.prompt, "string");
  assert.equal(input.resolution, "1366x768");
});

test("unsupported duration, reference count, and altered brief stop before any reservation or request", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime();
    const provider = context.runtime.createGatewayAiVideoProvider("wan-flash");
    await assert.rejects(provider.generate(argsFor("wan-flash")), /reference_required/);
    await assert.rejects(provider.generate(argsFor("wan-flash", 2)), /references_unsupported/);
    const altered = argsFor("wan-flash", 1);
    altered.canonicalPrompt = "Tampered";
    await assert.rejects(provider.generate(altered), /integrity_failed/);
    const invalidDuration = argsFor("wan-flash", 1);
    invalidDuration.request.durationSeconds = 31;
    await assert.rejects(provider.generate(invalidDuration), /duration_(invalid|unsupported)/);
    assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
  });
});

test("unbillable rejection releases reservation and performs exactly one submission", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime("rejected");
    await assert.rejects(context.runtime.createGatewayAiVideoProvider("grok-lite").generate(argsFor("grok-lite")), /provider rejected/);
    assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 0, rollbacks: 1 });
  });
});

test("team egress requires consent to this engine even after the portraits have been composed", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime();
    const args = argsFor("grok-lite", 1);
    args.request.identityMode = "reference_team";
    args.identityTeamPrecomposed = true;
    args.identityTeamProviderEgressConsent = "minimax-h3";
    await assert.rejects(context.runtime.createGatewayAiVideoProvider("grok-lite").generate(args), /provider_consent_required/);
    assert.equal(context.counters.requests, 0);
    assert.equal(context.counters.reservations, 0);
    args.identityTeamProviderEgressConsent = "grok-lite";
    await context.runtime.createGatewayAiVideoProvider("grok-lite").generate(args);
    assert.equal(context.counters.requests, 1);
  });
});

for (const mode of ["bad-asset", "download-failed"] as const) {
  test(`${mode}: an existing provider asset stays billable without resubmitting to another engine`, async () => {
    await withMockCredentials(async () => {
      const context = loadRuntime(mode);
      await assert.rejects(
        context.runtime.createGatewayAiVideoProvider("grok-lite").generate(argsFor("grok-lite")),
        (error: unknown) => providerTypes.isAiVideoProviderBillableFailure(error),
      );
      assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 1, rollbacks: 0 });
    });
  });
}

for (const sceneMode of ["single", "multi"] as const) {
  test(`Gateway 30-second ${sceneMode} film submits two native clips with correct frames and per-clip supplier cost`, async () => {
    await withMockCredentials(async () => {
      const context = loadRuntime();
      const args = argsFor("grok-lite", 0, 30, sceneMode);
      const result = await context.runtime.createGatewayAiVideoProvider("grok-lite").generate(args);
      assert.deepEqual(result.clips.map((clip) => clip.durationSeconds), [15, 15]);
      assert.deepEqual(context.counters, { requests: 2, reservations: 2, commits: 2, rollbacks: 0 });
      assert.equal(context.frames(), sceneMode === "single" ? 1 : 0);
      assert.equal(context.submissions[0].duration, 15);
      assert.equal(context.submissions[1].duration, 15);
      assert.equal(context.costs.reduce((sum, value) => sum + value, 0), sceneMode === "single" ? 910_000 : 900_000);
      if (sceneMode === "single") assert.deepEqual((context.submissions[1].prompt as { image: Buffer }).image, Buffer.from("generated-last-frame"));
      else assert.equal(typeof context.submissions[1].prompt, "string");
      assert.ok(context.submissions.every((input) => input.maxRetries === 0 && input.model === "spacexai/grok-imagine-video-1.5-lite"));
    });
  });
}

test("Gateway multi film retains the original photo for each plan and bills each transmission", async () => {
  await withMockCredentials(async () => {
    const context = loadRuntime();
    await context.runtime.createGatewayAiVideoProvider("grok-lite").generate(argsFor("grok-lite", 1, 30, "multi"));
    assert.deepEqual(context.costs, [460_000, 460_000]);
    for (const input of context.submissions) assert.deepEqual((input.prompt as { image: Buffer }).image, Buffer.from("image"));
  });
});

for (const mode of ["second-rejected", "frame-failed"] as const) {
  test(`${mode}: a first paid clip prevents blind regeneration or an unbillable film classification`, async () => {
    await withMockCredentials(async () => {
      const context = loadRuntime(mode);
      await assert.rejects(context.runtime.createGatewayAiVideoProvider("grok-lite").generate(argsFor("grok-lite", 0, 30)),
        (error: unknown) => providerTypes.isAiVideoProviderBillableFailure(error));
      assert.equal(context.counters.requests, mode === "second-rejected" ? 2 : 1);
      assert.equal(context.counters.commits, 1);
      assert.equal(context.counters.rollbacks, mode === "second-rejected" ? 1 : 0);
      assert.deepEqual(context.costs, [450_000]);
    });
  });
}
