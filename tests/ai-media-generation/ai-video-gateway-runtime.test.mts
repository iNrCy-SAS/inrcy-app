import * as characterVoices from "../../lib/aiMediaCharacterVoices.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import * as identityReferences from "../../lib/aiMediaIdentityReferences.ts";
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

function virtualClock(latencies: number[]) {
  let now = 1_800_000_000_000, nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    latencies, now: () => now, pending: () => timers.size,
    schedule(callback: () => void, delay: number) { const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id; },
    clear(id: number) { timers.delete(id); },
    advance(delay: number) {
      const until = now + delay;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      now = until;
    },
  };
}

function loadRuntime(mode: "success" | "rejected" | "http-rejected" | "balance-insufficient" | "bad-asset" | "download-failed" | "second-rejected" | "frame-failed" | "storage-failed" | "warnings-with-url" | "await-abort" = "success", failure?: { error: unknown; call: number }, clock?: ReturnType<typeof virtualClock>) {
  const counters = { requests: 0, reservations: 0, commits: 0, rollbacks: 0 };
  let observed: Record<string, unknown> | undefined;
  const submissions: Record<string, unknown>[] = [];
  const costs: number[] = [];
  const reservedCosts: number[] = [];
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
        if (failure && counters.requests === failure.call) throw failure.error;
        if (clock) await new Promise<void>((resolve, reject) => {
          const signal = input.abortSignal as AbortSignal;
          const abort = () => { clock.clear(timer); reject(signal.reason); };
          const timer = clock.schedule(() => { signal.removeEventListener("abort", abort); resolve(); }, clock.latencies[counters.requests - 1]);
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
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
      reserveAiGatewayAccountAttempt: async (_account: string, input: { estimatedCostMicroUsd: number }) => { counters.reservations += 1; reservedCosts.push(input.estimatedCostMicroUsd); return {}; },
      commitAiGatewayAccountAttempt: async (input: { actualCostMicroUsd: number }) => { counters.commits += 1; costs.push(input.actualCostMicroUsd); },
      rollbackAiGatewayAccountAttempt: async () => { counters.rollbacks += 1; },
      recordAiGatewayAccountFailure: async () => noOp(),
    }],
    ["./aiMediaBuffer.ts", { bufferFromUint8ArrayView }],
    ["./aiMediaIdentityReferences.ts", identityReferences],
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
  const factory = vm.runInThisContext(`(function(exports,require,module,setTimeout,clearTimeout,Date,process){${javascript}\n})`) as (
    exports: object, require: typeof localRequire, module: typeof commonJsModule, schedule: typeof setTimeout, clear: typeof clearTimeout, date: Pick<DateConstructor, "now">, isolatedProcess: { env: Record<string, string> },
  ) => void;
  const schedule = mode === "await-abort" ? ((callback: () => void, delay: number) => {
    expireTimeout = callback; timeoutDelay = delay; return 0;
  }) as unknown as typeof setTimeout : setTimeout;
  const clockDate = clock ? class extends Date { static now() { return clock.now(); } } : Date;
  factory(commonJsModule.exports, localRequire, commonJsModule,
    clock ? clock.schedule.bind(clock) as unknown as typeof setTimeout : schedule,
    clock ? clock.clear.bind(clock) as unknown as typeof clearTimeout : clearTimeout, clockDate,
    { env: { AI_GATEWAY_API_KEY: "fixture-no-real-credentials" } });
  return { runtime: commonJsModule.exports as Runtime, counters, submissions, costs, reservedCosts, hostedImages,
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

test("Veo Fast and Lite send a real PNG first frame and the pinned Google route through the installed SDK after WebP precomposition", async () => {
  const source = readFileSync(path.join(process.cwd(), "lib/aiMediaReferenceTeam.ts"), "utf8");
  const ast = ts.createSourceFile("aiMediaReferenceTeam.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "prepareReferenceTeamCompositionForAnimation");
  assert.ok(declaration);
  const javascript = ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {} as { prepareReferenceTeamCompositionForAnimation: (buffer: Buffer) => Promise<{ data: string; mimeType: "image/webp" }> };
  new Function("exports", "sharp", javascript)(exports, sharp);
  const original = await sharp({ create: { width: 96, height: 64, channels: 3, background: "#357a6b" } }).png().toBuffer();
  const composed = await exports.prepareReferenceTeamCompositionForAnimation(original);
  assert.equal((await sharp(Buffer.from(composed.data, "base64")).metadata()).format, "webp");
  await withMockCredentials(async () => {
    for (const engine of ["veo", "veo-lite"] as const) {
    const context = loadRuntime(), args = argsFor(engine, 1, 8);
    args.request.videoResolution = "1080p"; args.request.withNarration = false; args.request.withMusic = false;
    args.request.inspirationImages = [{ ...composed, role: "environment", usage: "required" }];
    await context.runtime.createGatewayAiVideoProvider(engine).generate(args);
    const input = context.observed()!;
    const { createGateway, experimental_generateVideo } = await import("ai");
    let calls = 0;
    const captured: { wire?: { image: { mediaType: string; data: string }; resolution: string; duration: number; generateAudio: boolean; providerOptions: unknown } } = {};
    const gateway = createGateway({ apiKey: "unit-test-no-network", fetch: async (_url, init) => {
      calls++;
      captured.wire = JSON.parse(String(init?.body));
      const result = { type: "result", videos: [{ type: "base64", mediaType: "video/mp4", data: Buffer.from("local-video").toString("base64") }], warnings: [] };
      return new Response(`data: ${JSON.stringify(result)}\n\n`, { headers: { "content-type": "text/event-stream" } });
    } });
    await experimental_generateVideo({ ...input, model: gateway.video(catalog.getAiMediaVideoModel(engine).modelId) } as Parameters<typeof experimental_generateVideo>[0]);
    const wire = captured.wire;
    assert.ok(wire);
    assert.equal(wire.image.mediaType, "image/png");
    const bytes = Buffer.from(wire.image.data, "base64");
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal((await sharp(bytes).metadata()).format, "png");
    assert.equal(wire.resolution, "1920x1080"); assert.equal(wire.duration, 8);
    assert.equal(wire.generateAudio, false);
    assert.deepEqual(wire.providerOptions, { gateway: { only: ["vertex"] } });
    assert.equal(calls, 1); assert.equal(context.counters.requests, 1);
    assert.equal(context.hostedImages.length, 0); assert.equal(context.privateChecks(), 0);
    assert.equal(args.request.inspirationImages[0].mimeType, "image/webp", "The original reference remains untouched");
    }
  });
});

test("Google video preparation keeps reference roles and orientation while stripping metadata from real JPEG, PNG and WebP", async () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    const image = await sharp({ create: { width: 96, height: 64, channels: 3, background: "#48638f" } })
      .withMetadata({ orientation: 6, exif: { IFD0: { Artist: "PRIVATE-ARTIST" } } }).toFormat(format).toBuffer();
    const input = { mimeType: `image/${format}` as "image/jpeg" | "image/png" | "image/webp", data: image.toString("base64"), role: "environment" as const, usage: "required" as const };
    const [prepared] = await identityReferences.prepareGoogleAiVideoReferenceImages([input]);
    assert.equal(prepared.mimeType, "image/png"); assert.equal(prepared.role, "environment"); assert.equal(prepared.usage, "required");
    const bytes = Buffer.from(prepared.data, "base64"), metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, "png"); assert.equal(metadata.width, 64); assert.equal(metadata.height, 96);
    assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined); assert.equal(metadata.orientation, undefined);
    assert.equal(input.data, image.toString("base64")); assert.equal(input.mimeType, `image/${format}`);
  }
});

test("Veo Lite rejects mismatched MIME, corrupt image bytes and oversized inputs before any supplier reservation or request", async () => {
  const webp = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#735148" } }).webp().toBuffer();
  const oversized = Buffer.alloc(20 * 1024 * 1024 + 1); oversized.write("RIFF", 0); oversized.write("WEBP", 8);
  await withMockCredentials(async () => {
    for (const image of [
      { mimeType: "image/png" as const, data: webp.toString("base64") },
      { mimeType: "image/webp" as const, data: Buffer.from("corrupt image bytes repeated to exceed minimum bytes ".repeat(3)).toString("base64") },
      { mimeType: "image/webp" as const, data: oversized.toString("base64") },
    ]) {
      const context = loadRuntime(), args = argsFor("veo-lite", 1, 8); args.request.inspirationImages = [image];
      await assert.rejects(context.runtime.createGatewayAiVideoProvider("veo-lite").generate(args), identityReferences.AiMediaIdentityReferenceValidationError);
      assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 }); assert.equal(context.hostedImages.length, 0);
    }
  });
});

test("Google video image preparation keeps pixel and dimension limits and respects abort before provider work", async () => {
  const large = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#45728a" } }).webp().toBuffer();
  const [prepared] = await identityReferences.prepareGoogleAiVideoReferenceImages([{ mimeType: "image/webp", data: large.toString("base64") }]);
  const metadata = await sharp(Buffer.from(prepared.data, "base64")).metadata();
  assert.equal(metadata.width, 1280); assert.equal(metadata.height, 640);
  const tooManyPixels = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#735148" } }).png().toBuffer();
  await assert.rejects(identityReferences.prepareGoogleAiVideoReferenceImages([{ mimeType: "image/png", data: tooManyPixels.toString("base64") }]), identityReferences.AiMediaIdentityReferenceValidationError);
  const controller = new AbortController(), reason = new Error("test-local-abort"); controller.abort(reason);
  await assert.rejects(identityReferences.prepareGoogleAiVideoReferenceImages([{ mimeType: "image/webp", data: large.toString("base64") }], controller.signal), error => error === reason);
});

test("Wan Libre conserve la séparation audio/texte et le plein cadre dans son transport compact", () => {
  const context = loadRuntime();
  const args = argsFor("wan-flash", 1, 4);
  args.request.creationMode = "free";
  args.request.freePrompt = args.providerContract.instruction;
  const input = context.runtime.buildGatewayAiVideoRequest(args);
  const prompt = (input.prompt as { text: string }).text;
  assert.match(prompt, /Full frame; no bars/);
  assert.match(prompt, /No split\/panels\/collage unless asked/);
  assert.match(prompt, /Subtitles OFF: no speech captions/);
  assert.match(prompt, /Other requested visual text allowed/);
  assert.ok(prompt.includes(freePrompt.AI_MEDIA_FREE_VIDEO_RENDER_CONTRACT));
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
  assert.ok(native.includes(`say exactly once: “${line}”`));
  assert.match(native, /Mouth-synchronized, audible, finished before shot ends then silent/);
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
  assert.match(prompt, /says? exactly once: “Bonjour, voici iNrCy\.”/);
  assert.ok(prompt.length <= 1_500);
  assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
});

test("Wan visual silence fits current 500-character briefs and preserves legacy full transport contracts", () => {
  const context = loadRuntime();
  for (const length of [400, 500, 560, 720, 1_600]) {
    const brief = "Une personne se promène dans un atelier lumineux. ".repeat(40).slice(0, length).trim();
    const args = argsFor("wan-flash", 1, 8);
    const source = {
      requestId: "wan-silent-budget-0001", source: "studio", operation: "generate",
      creationMode: "free", kind: "video", freePrompt: brief, withNarration: false,
      teamVideoSpeechMode: "voiceover", durationSeconds: 8, videoEngine: "wan-flash",
      format: "landscape", sceneMode: "single",
      inspirationImages: [{ data: "A".repeat(64), mimeType: "image/png", role: "environment", usage: "required" }],
    };
    if (length > 500) assert.throws(() => normalizeAiMediaGenerationRequest(source), /500 caractères maximum/);
    args.request = normalizeAiMediaGenerationRequest({ ...source, freePrompt: brief.slice(0, 500) });
    // Historical server contracts still exercise full preservation below. This
    // is not a way to submit a new over-limit Studio request.
    args.request.freePrompt = brief;
    args.plan.subline = "Promenade silencieuse dans un atelier.";
    args.plan.scenes[0].visualBrief = "Une personne observe les outils avec un sourire.";
    args.providerContract = boundary.buildAiMediaVideoProviderContract({ request: args.request, durationSeconds: 8, brandColors: [] });
    args.canonicalPrompt = freePrompt.buildAiMediaFreeVideoScenePrompt(args, 0, 8);
    args.canonicalPromptSha256 = boundary.hashAiMediaCanonicalPrompt(args.canonicalPrompt);
    if (length === 1_600) {
      assert.throws(() => context.runtime.buildGatewayAiVideoRequest(args), /ai_video_instruction_contract_too_long/,
        "A truly oversized brief must still be refused, never silently truncated.");
      continue;
    }
    const prompt = (context.runtime.buildGatewayAiVideoRequest(args).prompt as { text: string }).text;
    assert.ok(prompt.includes(freePrompt.AI_MEDIA_FREE_VIDEO_RENDER_CONTRACT));
    assert.ok(prompt.includes(`USER: ${brief}`), "Keep the entire user brief.");
    assert.ok(prompt.includes(`ACTION: ${args.plan.scenes[0].visualBrief}`));
    assert.doesNotMatch(prompt, /PARAMS:/, "Code-checked options do not consume the short wire budget as technical lettering.");
    assert.match(prompt, /SHOT 1\/1;8s;16:9/);
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
  await run();
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


test("Veo quotes and the actual Gateway reserve charge the same audio variant while preserving the exact chosen model", async () => {
  for (const engine of ["veo", "veo-lite"] as const) for (const resolution of ["720p", "1080p"] as const) for (const mode of ["characters", "voiceover", "silent"] as const) {
    const context = loadRuntime(); const args = argsFor(engine, 0, 8);
    Object.assign(args.request, { creationMode: "free", videoResolution: resolution, withNarration: mode === "voiceover", teamVideoSpeechMode: mode === "characters" ? "characters" : "voiceover", spokenScript: mode === "silent" ? "" : "Bienvenue dans notre atelier." });
    const original = JSON.stringify(args.request);
    const quoteInput = { ...args.request, inspirationImagesCount: 0 };
    const quote = pricing.quoteAiMediaCredits(quoteInput);
    const expectedRate = engine === "veo" ? mode === "characters" ? 0.15 : 0.10 : mode === "characters" ? resolution === "720p" ? 0.05 : 0.08 : resolution === "720p" ? 0.03 : 0.05;
    const expectedCost = Math.round(expectedRate * 8 * 1_000_000);
    const result = await context.runtime.createGatewayAiVideoProvider(engine).generate(args);
    assert.equal(quote.totalCredits, Math.round(expectedRate * 8 * 100) + 7);
    assert.equal(pricing.estimateAiMediaVideoSupplierCostMicroUsd(quoteInput), expectedCost);
    assert.deepEqual(context.reservedCosts, [expectedCost]); assert.deepEqual(context.costs, [expectedCost]); assert.equal(result.estimatedCostMicroUsd, expectedCost);
    const input = context.observed()!; assert.equal(input.model, engine === "veo" ? "google/veo-3.1-fast-generate-001" : "google/veo-3.1-lite-generate-001");
    assert.equal(input.generateAudio, mode === "characters"); assert.equal(input.duration, 8); assert.equal(input.resolution, resolution === "720p" ? "1280x720" : "1920x1080");
    assert.deepEqual(input.providerOptions, { gateway: { only: ["vertex"] } }); assert.equal(input.maxRetries, 0);
    assert.match(String(input.prompt), /THIS SHOT: Avancée lente\./);
    if (mode === "characters") assert.ok(String(input.prompt).includes("says exactly once: “Bienvenue dans notre atelier.”"));
    else assert.match(String(input.prompt), /No native voices or dialogue/);
    assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 1, rollbacks: 0 }); assert.equal(JSON.stringify(args.request), original, "transport and quotes never rewrite the original narration/script choice");
  }
});

test("Veo native character speech and explicit silence keep distinct server quote identities and reject the old tariff", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/aiMediaCreditQuoteServer.ts"), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  const nativeRequire = createRequire(import.meta.url);
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "./aiMediaCreditsPricing.ts": pricing,
    "./aiMediaModelCatalog.ts": catalog, "./aiMediaCharacterVoices.ts": characterVoices,
  };
  new Function("exports", "require", "module", javascript)(record.exports, (specifier: string) => {
    if (specifier in dependencies) return dependencies[specifier];
    if (specifier.startsWith("node:")) return nativeRequire(specifier);
    throw new Error(`unexpected_quote_dependency:${specifier}`);
  }, record);
  const server = record.exports as typeof import("../../lib/aiMediaCreditQuoteServer.ts");
  const request = argsFor("veo", 0, 8).request;
  Object.assign(request, { creationMode: "free", withNarration: false, teamVideoSpeechMode: "characters", spokenScript: "Bienvenue." });
  const speech = server.quoteAiMediaRequest("account-test", request);
  const silence = server.quoteAiMediaRequest("account-test", { ...request, spokenScript: "" });
  assert.equal(speech.totalCredits, 127); assert.equal(silence.totalCredits, 87);
  assert.notEqual(speech.quoteId, silence.quoteId);
  const reviewed = { ...request, expectedCredits: speech.totalCredits, creditTariffVersion: speech.tariffVersion, creditQuoteId: speech.quoteId };
  assert.equal(server.assertAiMediaCreditQuote(reviewed, speech), true);
  assert.equal(server.assertAiMediaCreditQuote({ ...reviewed, creditTariffVersion: "inrstudio-media-credits-2026-10-v4" }, speech), false);
  assert.equal(server.assertAiMediaCreditQuote({ ...reviewed, expectedCredits: silence.totalCredits, creditQuoteId: silence.quoteId }, speech), false);
  assert.notEqual(server.quoteAiMediaRequest("another-account", request).quoteId, speech.quoteId);
});

test("Veo rejects a malformed multi-reference short clip before reservation and keeps an incomplete paid film on its exact Fast model", async () => {
  const rejected = loadRuntime(); const args = argsFor("veo", 2, 4);
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#357a6b" } }).png().toBuffer();
  args.request.inspirationImages = args.request.inspirationImages.map(reference => ({ ...reference, data: image.toString("base64") }));
  await assert.rejects(rejected.runtime.createGatewayAiVideoProvider("veo").generate(args), /references_require_eight_seconds/);
  assert.deepEqual(rejected.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
  const partial = loadRuntime("second-rejected"); const twoClips = argsFor("veo", 0, 16, "multi");
  Object.assign(twoClips.request, { withNarration: false, teamVideoSpeechMode: "characters", spokenScript: "Bienvenue." });
  await assert.rejects(partial.runtime.createGatewayAiVideoProvider("veo").generate(twoClips), providerTypes.isAiVideoProviderBillableFailure);
  assert.deepEqual(partial.counters, { requests: 2, reservations: 2, commits: 1, rollbacks: 1 });
  assert.deepEqual(partial.reservedCosts, [1_200_000, 1_200_000]); assert.deepEqual(partial.costs, [1_200_000]);
  assert.ok(partial.submissions.every(input => input.model === "google/veo-3.1-fast-generate-001" && input.maxRetries === 0));
});

async function malformedSdkError(status: number): Promise<unknown> {
  const { createGateway, experimental_generateVideo } = await import("ai");
  let intercepted = 0;
  const gateway = createGateway({ apiKey: "local-no-real-credentials", fetch: async () => {
    intercepted += 1;
    return new Response("private-response-sentinel", { status, headers: { "content-type": "text/plain" } });
  } });
  try {
    await experimental_generateVideo({ model: gateway.video("alibaba/wan-v3.0-video"), prompt: "private-brief-sentinel", duration: 15, maxRetries: 0 });
    assert.fail("the local synthetic response must fail");
  } catch (error) {
    assert.equal(intercepted, 1, "the SDK never retries or contacts an external supplier");
    assert.equal((error as Error).message, "Invalid error response format: Gateway request failed");
    return error;
  }
}

for (const status of [400, 500, 504]) test(
  "identical malformed SDK errors retain safe HTTP " + status + " without the private SDK payload",
  async () => {
    const error = await malformedSdkError(status);
    const context = loadRuntime("success", { error, call: 1 });
    await assert.rejects(context.runtime.createGatewayAiVideoProvider("wan3").generate(argsFor("wan3", 0, 15)), failure => {
      const details = sensitiveText.safeAiMediaErrorDetails(failure);
      assert.equal(details[0].diagnostics?.providerHttpStatus, status);
      assert.equal(details[0].diagnostics?.providerErrorName, "GatewayResponseError");
      assert.equal(details[0].diagnostics?.phase, "provider_submission");
      assert.equal(details[0].diagnostics?.clipIndex, 1);
      assert.equal(details[0].diagnostics?.completedClips, 0);
      assert.equal(details[0].diagnostics?.deadlineExceeded, false);
      assert.equal((failure as Error).cause, undefined);
      assert.doesNotMatch(JSON.stringify(failure) + JSON.stringify(details), /private-brief-sentinel|private-response-sentinel|requestBodyValues|responseBody|https?:/);
      return true;
    });
    assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 0, rollbacks: 1 });
    assert.ok(context.submissions.every(input => input.maxRetries === 0));
  },
);

test("a paid Wan3 clip and its committed cost survive a malformed second response with precise phase and no retry", async () => {
  const error = await malformedSdkError(504);
  const context = loadRuntime("success", { error, call: 2 });
  const args = argsFor("wan3", 0, 30, "multi"); args.request.videoResolution = "1080p";
  await assert.rejects(context.runtime.createGatewayAiVideoProvider("wan3").generate(args), failure => {
    assert.ok(providerTypes.isAiVideoProviderBillableFailure(failure));
    assert.equal(providerTypes.getAiVideoProviderRecoverableStatus(failure), 0);
    assert.equal(failure.stage, "gateway_provider_submission");
    const diagnostics = sensitiveText.safeAiMediaErrorDetails(failure)[0].diagnostics;
    assert.equal(diagnostics?.providerHttpStatus, 504);
    assert.equal(diagnostics?.phase, "provider_submission");
    assert.equal(diagnostics?.clipIndex, 2); assert.equal(diagnostics?.clipCount, 2);
    assert.equal(diagnostics?.clipDurationSeconds, 15); assert.equal(diagnostics?.completedClips, 1);
    assert.equal(diagnostics?.committedCostMicroUsd, 3_000_000);
    assert.equal(diagnostics?.currentClipAssetObserved, false);
    assert.equal(diagnostics?.callerAborted, false); assert.equal(diagnostics?.providerAborted, false);
    assert.equal(diagnostics?.deadlineExceeded, false, "upstream504 does not prove our own deadline fired");
    assert.ok(Number.isSafeInteger(diagnostics?.elapsedMs)); assert.ok(Number.isSafeInteger(diagnostics?.clipElapsedMs));
    assert.notEqual(failure.cause, error);
    assert.doesNotMatch(JSON.stringify(failure) + JSON.stringify(sensitiveText.safeAiMediaErrorDetails(failure)), /private-brief-sentinel|private-response-sentinel|requestBodyValues|responseBody|https?:/);
    return true;
  });
  assert.deepEqual(context.counters, { requests: 2, reservations: 2, commits: 1, rollbacks: 1 });
  assert.deepEqual(context.reservedCosts, [3_000_000, 3_000_000]);
  assert.deepEqual(context.costs, [3_000_000]);
  assert.ok(context.submissions.every(input => input.model === "alibaba/wan-v3.0-video" && input.duration === 15 && input.maxRetries === 0));
});

test("an offered asset download failure keeps its own phase even when the billable cost is committed during cleanup", async () => {
  const context = loadRuntime("download-failed");
  await assert.rejects(context.runtime.createGatewayAiVideoProvider("grok-lite").generate(argsFor("grok-lite", 0, 8)), failure => {
    assert.ok(providerTypes.isAiVideoProviderBillableFailure(failure));
    assert.equal(failure.stage, "gateway_asset_download");
    assert.equal(failure.diagnostics?.phase, "asset_download");
    assert.equal(failure.diagnostics?.currentClipAssetObserved, true);
    assert.equal(failure.diagnostics?.committedCostMicroUsd, 240_000);
    assert.equal(failure.diagnostics?.completedClips, 0);
    return true;
  });
  assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 1, rollbacks: 0 });
});

async function waitForSubmission(context: ReturnType<typeof loadRuntime>, count: number) {
  for (let turn = 0; turn < 20 && context.counters.requests < count; turn += 1) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(context.counters.requests, count);
}

test("two paid Wan3 clips taking 615740ms finish inside the remaining absolute budget without retry or a new 600s film cutoff", async () => {
  const clock = virtualClock([318_070, 297_670]); const context = loadRuntime("success", undefined, clock);
  const args = argsFor("wan3", 0, 30, "multi"); args.request.videoResolution = "1080p";
  args.deadlineAt = clock.now() + 635_000;
  const pending = context.runtime.createGatewayAiVideoProvider("wan3").generate(args);
  await waitForSubmission(context, 1); clock.advance(318_070);
  await waitForSubmission(context, 2); clock.advance(297_670);
  const result = await pending;
  assert.equal(result.clips.length, 2); assert.equal(result.estimatedCostMicroUsd, 6_000_000);
  assert.deepEqual(context.counters, { requests: 2, reservations: 2, commits: 2, rollbacks: 0 });
  assert.deepEqual(context.costs, [3_000_000, 3_000_000]);
  assert.ok(context.submissions.every(input => input.model === "alibaba/wan-v3.0-video" && input.duration === 15 && input.maxRetries === 0));
  assert.equal(clock.pending(), 0, "all clip and film timers are released");
});

test("the absolute film deadline stops clip two and preserves the first paid clip cost without another submission", async () => {
  const clock = virtualClock([318_070, 350_000]); const context = loadRuntime("success", undefined, clock);
  const args = argsFor("wan3", 0, 30, "multi"); args.request.videoResolution = "1080p";
  args.deadlineAt = clock.now() + 635_000;
  const pending = context.runtime.createGatewayAiVideoProvider("wan3").generate(args); void pending.catch(() => undefined);
  await waitForSubmission(context, 1); clock.advance(318_070);
  await waitForSubmission(context, 2); clock.advance(316_930);
  await assert.rejects(pending, error => {
    assert.ok(providerTypes.isAiVideoProviderBillableFailure(error));
    assert.equal(error.diagnostics?.deadlineKind, "film"); assert.equal(error.diagnostics?.deadlineExceeded, true);
    assert.equal(error.diagnostics?.elapsedMs, 635_000); assert.equal(error.diagnostics?.clipElapsedMs, 316_930);
    assert.equal(error.diagnostics?.completedClips, 1); assert.equal(error.diagnostics?.committedCostMicroUsd, 3_000_000);
    assert.equal(error.diagnostics?.callerAborted, false); assert.equal(error.diagnostics?.overallBudgetMs, 635_000);
    return true;
  });
  assert.deepEqual(context.counters, { requests: 2, reservations: 2, commits: 1, rollbacks: 1 });
  assert.deepEqual(context.costs, [3_000_000]); assert.equal(clock.pending(), 0);
});

test("a single stalled Wan3 clip keeps its 600s cap even when the two-clip film has 715s available", async () => {
  const clock = virtualClock([610_000]); const context = loadRuntime("success", undefined, clock);
  const args = argsFor("wan3", 0, 30, "multi"); args.deadlineAt = clock.now() + 715_000;
  const pending = context.runtime.createGatewayAiVideoProvider("wan3").generate(args); void pending.catch(() => undefined);
  await waitForSubmission(context, 1); clock.advance(600_000);
  await assert.rejects(pending, error => {
    const diagnostics = sensitiveText.safeAiMediaErrorDetails(error)[0].diagnostics;
    assert.equal(diagnostics?.deadlineKind, "clip"); assert.equal(diagnostics?.elapsedMs, 600_000);
    assert.equal(diagnostics?.completedClips, 0); assert.equal(diagnostics?.clipIndex, 1);
    assert.equal(diagnostics?.overallBudgetMs, 715_000); assert.equal(diagnostics?.clipBudgetMs, 600_000);
    return true;
  });
  assert.deepEqual(context.counters, { requests: 1, reservations: 1, commits: 0, rollbacks: 1 });
  assert.equal(clock.pending(), 0);
});

test("an expired absolute provider deadline cannot upload references, reserve credits or submit a clip", async () => {
  const clock = virtualClock([]); const context = loadRuntime("success", undefined, clock);
  const args = argsFor("wan3", 1, 15); args.deadlineAt = clock.now();
  await assert.rejects(context.runtime.createGatewayAiVideoProvider("wan3").generate(args), /ai_video_gateway_timeout/);
  assert.deepEqual(context.counters, { requests: 0, reservations: 0, commits: 0, rollbacks: 0 });
  assert.equal(context.hostedImages.length, 0); assert.equal(clock.pending(), 0);
});
