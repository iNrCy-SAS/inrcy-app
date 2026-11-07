import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as catalog from "../../lib/aiMediaModelCatalog.ts";
import * as pricing from "../../lib/aiMediaCreditsPricing.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as boundary from "../../lib/aiMediaVideoProviderContract.ts";
import * as prompts from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as voices from "../../lib/aiMediaCharacterVoices.ts";
import * as providerTypes from "../../lib/aiVideoProviderTypes.ts";
import * as sensitive from "../../lib/aiMediaSensitiveText.ts";
import { bufferFromUint8ArrayView } from "../../lib/aiMediaBuffer.ts";

function compile<T>(file: string, modules: Map<string, unknown>, env: Record<string, string>) {
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const record = { exports: {} }, native = createRequire(import.meta.url);
  new Function("module", "exports", "require", "process", js)(record, record.exports, (name: string) => {
    if (name.startsWith("node:")) return native(name);
    assert.ok(modules.has(name), `Unexpected closed routing fixture dependency: ${name}`);
    return modules.get(name);
  }, { env });
  return record.exports as T;
}

function harness(configuredProvider = "auto", rejectSdk = false) {
  const sdk: Array<Record<string, unknown>> = [], reservations: number[] = [], commits: number[] = [];
  const counts = { legacyGemini: 0, omni: 0, rollbacks: 0 };
  const noIo = () => assert.fail("No network, storage, media download or provider operation is allowed");
  const legacy = { id: "legacy-gemini-veo", model: "preview-not-allowed", generate: () => { counts.legacyGemini++; return noIo(); } };
  const env = { AI_GATEWAY_API_KEY: "offline-synthetic-only", AI_MEDIA_VIDEO_PROVIDER: configuredProvider };
  const gateway = compile<typeof import("../../lib/aiVideoProviderGateway.ts")>("lib/aiVideoProviderGateway.ts", new Map<string, unknown>([
    ["server-only", {}],
    ["ai", { createDownload: () => noIo, experimental_generateVideo: async (input: Record<string, unknown>) => {
      sdk.push(input);
      if (rejectSdk) throw Object.assign(new Error("synthetic definite rejection"), { statusCode: 503 });
      const buffer = Buffer.alloc(24); buffer.write("ftyp", 4, "ascii");
      return { videos: [{ uint8Array: buffer }], warnings: [] };
    } }],
    ["@/lib/aiGatewayAccountGuard", {
      reserveAiGatewayAccountAttempt: async (_account: string, args: { estimatedCostMicroUsd: number }) => { reservations.push(args.estimatedCostMicroUsd); return {}; },
      commitAiGatewayAccountAttempt: async (args: { actualCostMicroUsd: number }) => { commits.push(args.actualCostMicroUsd); },
      rollbackAiGatewayAccountAttempt: async () => { counts.rollbacks++; }, recordAiGatewayAccountFailure: async () => undefined,
    }],
    ["./aiMediaBuffer.ts", { bufferFromUint8ArrayView }],
    ["./aiMediaFreeGenerationPrompt.ts", prompts],
    ["@/lib/aiMediaGenerationContracts", contracts],
    ["./aiMediaModelCatalog.ts", catalog], ["./aiMediaCreditsPricing.ts", pricing],
    ["./aiMediaCharacterVoices.ts", voices], ["./aiMediaVideoTimeline.ts", timeline],
    ["./aiMediaVideoContinuity.ts", { extractAiMediaVideoContinuityFrame: noIo }],
    ["./aiMediaVideoTemporaryImages.ts", { createAiMediaVideoTemporaryImageStore: noIo }],
    ["@/lib/aiMediaSensitiveText", sensitive],
    ["./aiMediaVideoProviderContract.ts", boundary],
    ["@/lib/aiVideoProviderGoogleVeo", { buildGoogleVideoScenePrompt: noIo, buildGoogleVideoTeamSpeechDirection: noIo }],
    ["@/lib/aiVideoProviderTypes", providerTypes],
  ]), env);
  const omni = { id: "google-gemini-omni", model: "gemini-omni-1.1-flash", generate: async () => {
    counts.omni++; return { provider: "google-gemini-omni", model: "gemini-omni-1.1-flash", clips: [], estimatedCostMicroUsd: 0, warnings: [] };
  } };
  const registry = compile<typeof import("../../lib/aiVideoProvider.ts")>("lib/aiVideoProvider.ts", new Map<string, unknown>([
    ["server-only", {}], ["@/lib/aiVideoProviderGoogleOmni", { googleOmniVideoProvider: omni }],
    ["@/lib/aiVideoProviderGoogleVeo", { googleVeoVideoProvider: legacy }],
    ["./aiVideoProviderGateway.ts", gateway], ["./aiMediaModelCatalog.ts", catalog],
  ]), env);
  return { registry, sdk, counts, reservations, commits };
}

function args(engine: "veo" | "veo-lite", resolution: "720p" | "1080p", mode: "silent" | "voiceover" | "characters" = "silent") {
  const spokenScript = mode === "silent" ? "" : "Ce jardin devient un lieu calme pour profiter ensemble.";
  const request = contracts.normalizeAiMediaGenerationRequest({
    requestId: "offline-veo-route-test", source: "studio", operation: "generate", creationMode: "free",
    kind: "video", videoEngine: engine, videoResolution: resolution, durationSeconds: 8, sceneMode: "single",
    format: "landscape", freePrompt: "Un jardin calme au soleil, léger mouvement de caméra, sans texte.",
    withNarration: mode === "voiceover", teamVideoSpeechMode: mode === "characters" ? "characters" : "voiceover",
    withMusic: false, spokenScript, inspirationImages: [],
  });
  const canonicalPrompt = "offline canonical contract";
  return { accountId: "offline-account", request, canonicalPrompt,
    canonicalPromptSha256: boundary.hashAiMediaCanonicalPrompt(canonicalPrompt),
    providerContract: boundary.buildAiMediaVideoProviderContract({ request, durationSeconds: 8, brandColors: [] }),
    contentLanguage: "fr", plan: { headline: "", subline: "Un jardin au soleil.", companyName: "", cta: "",
      scenes: [{ visualBrief: "La caméra avance vers les fleurs.", eyebrow: "", title: "", body: "", spokenLine: mode === "characters" ? spokenScript : "", spokenReply: "", layout: "hero" }] },
  } as providerTypes.AiVideoProviderGenerationArgs;
}

test("the real registry and Gateway preserve Fast and Lite model resolution duration audio and zero retries without a Gemini preview call", async () => {
  const runtime = harness();
  for (const engine of ["veo", "veo-lite"] as const) for (const resolution of ["720p", "1080p"] as const) for (const mode of ["silent", "voiceover", "characters"] as const) {
    const input = args(engine, resolution, mode), original = JSON.stringify(input);
    const result = await runtime.registry.generateOriginalAiVideoClips(input);
    const wire = runtime.sdk.at(-1)!;
    assert.equal(wire.model, engine === "veo" ? "google/veo-3.1-fast-generate-001" : "google/veo-3.1-lite-generate-001");
    assert.equal(wire.resolution, resolution === "1080p" ? "1920x1080" : "1280x720");
    assert.equal(wire.duration, 8); assert.equal(wire.aspectRatio, "16:9");
    assert.equal(wire.generateAudio, mode === "characters", "Only native talking characters request chargeable Veo audio; Studio owns voiceover.");
    assert.equal(wire.maxRetries, 0); assert.equal(wire.n, 1);
    assert.match(String(wire.prompt), /THIS SHOT|CREATIVE DIRECTION/);
    assert.doesNotMatch(String(wire.model), /preview/);
    assert.equal(result.provider, "vercel-ai-gateway:google"); assert.equal(result.model, wire.model);
    assert.equal(result.clips.length, 1); assert.equal(result.clips[0].durationSeconds, 8);
    assert.equal(JSON.stringify(input), original, "The selected engine and full caller request remain unchanged.");
  }
  assert.equal(runtime.counts.legacyGemini, 0); assert.equal(runtime.counts.omni, 0);
  assert.equal(runtime.sdk.length, 12); assert.equal(runtime.reservations.length, 12);
  assert.deepEqual(runtime.commits, runtime.reservations);
});

test("legacy Veo aliases share the active Fast Gateway while an explicit Omni request keeps its provider", async () => {
  for (const alias of ["google-veo-fast", "google-veo", "veo", "veo-fast", "gemini"]) {
    const runtime = harness(alias);
    assert.deepEqual(runtime.registry.getAiVideoProviderIdentity(), { provider: "vercel-ai-gateway:google", model: "google/veo-3.1-fast-generate-001" });
    await runtime.registry.generateOriginalAiVideoClips(args("veo", "720p"));
    const explicitOmni = { ...args("veo", "720p"), request: { ...args("veo", "720p").request, videoEngine: "omni" } } as providerTypes.AiVideoProviderGenerationArgs;
    const result = await runtime.registry.generateOriginalAiVideoClips(explicitOmni);
    assert.equal(result.provider, "google-gemini-omni");
    assert.equal(runtime.sdk.length, 1); assert.equal(runtime.counts.omni, 1); assert.equal(runtime.counts.legacyGemini, 0);
  }
});

test("a definite Fast Gateway rejection releases its reservation without retrying a legacy preview or Omni route", async () => {
  const runtime = harness("gemini", true);
  await assert.rejects(runtime.registry.generateOriginalAiVideoClips(args("veo", "720p")), /synthetic definite rejection/);
  assert.equal(runtime.sdk.length, 1); assert.equal(runtime.reservations.length, 1);
  assert.equal(runtime.counts.rollbacks, 1); assert.equal(runtime.commits.length, 0);
  assert.equal(runtime.counts.legacyGemini, 0); assert.equal(runtime.counts.omni, 0);
});
