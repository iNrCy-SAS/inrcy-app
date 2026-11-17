import * as directVideo from "../../lib/aiMediaDirectVideoPipeline.ts";
import * as pendingVideo from "../../lib/aiMediaPendingVideo.ts";
import * as nativeQa from "../../lib/aiMediaNativeDialogueQa.ts";
import * as speechBudget from "../../lib/aiMediaVideoSpeechBudget.ts";
import { AiVideoProviderBillableFailure } from "../../lib/aiVideoProviderTypes.ts";
import * as characterVoices from "../../lib/aiMediaCharacterVoices.ts";
import { loadNarrationPreparationRuntime } from "./narration-preparation-runtime.mjs";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import { AI_MEDIA_AVAILABLE_VIDEO_MODELS, getAiMediaVideoModel } from "../../lib/aiMediaModelCatalog.ts";
import { needsControlledAiMediaFreeFirstFrame, usesSeparateAiMediaFreeVoiceover } from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import * as sensitive from "../../lib/aiMediaSensitiveText.ts";
import * as agentVideoFallback from "../../lib/inrAgentVideoFallback.ts";
import * as publicErrors from "../../lib/aiMediaGenerationPublicErrors.ts";
import * as spokenScript from "../../lib/aiMediaSpokenScript.ts";
import * as pronunciation from "../../lib/aiMediaPronunciation.ts";
import { classifyVeoFailure } from "../../lib/aiVideoReliability.ts";
import { getAiVideoProviderRecoverableStatus } from "../../lib/aiVideoProviderTypes.ts";
import { buildAiMediaFreeVideoBusinessDnaDirection, getAiMediaFreeBrandPolicy, getAiMediaFreeLogoPlacement, resolveAiMediaFreeSpeechLanguage, usesAiMediaAutomaticImageLogo } from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as localLogoComposition from "../../lib/aiMediaLocalLogoCompositionPrompt.ts";
import * as globalConstraints from "../../lib/aiMediaGlobalConstraints.ts";
import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";

type Row = Record<string, unknown>;
// Direct-server fixtures retain pre-existing HeyGen behavior. Its selection
// availability is unchanged; new Wan3 requests alone are retired in this release.
const EXECUTION_MODELS = [...AI_MEDIA_AVAILABLE_VIDEO_MODELS, getAiMediaVideoModel("heygen")];

const comparisonFlag = "AI_MEDIA_NATIVE_FINAL_FRAME_COMPARISON_ENABLED";
function enabledComparisonTest(name: string, action: () => Promise<void> | void) {
  test(name, async () => {
    const previous = process.env[comparisonFlag]; process.env[comparisonFlag] = "1";
    try { await action(); } finally { if (previous === undefined) delete process.env[comparisonFlag]; else process.env[comparisonFlag] = previous; }
  });
}

const script = "Dans cet atelier, chaque vase prend doucement forme entre les mains de la céramiste.";
const canonicalPrompt = "Canonical professional request with its original narration choice.";
const narration = { script, language: "fr", wordCount: script.split(/\s+/u).length, source: "ai",
  sha256: createHash("sha256").update(script).digest("hex") };
const audio = { buffer: Buffer.from("synthetic-tts"), mimeType: "audio/wav", extension: "wav", model: "test-tts", voice: "Puck" };
const soundtrack = { id: "test-instrumental", name: "Instrumental test", absolutePath: "unused-test-soundtrack.wav",
  fileName: "instrumental.wav", durationSeconds: 8, license: "test", sha256: "test-soundtrack-sha256", sizeBytes: 32 };

function request(engine: contracts.AiMediaVideoEngine, overrides: Row = {}) {
  return contracts.normalizeAiMediaGenerationRequest({ requestId: "separate-free-voiceover-test", source: "studio", operation: "generate",
    creationMode: "free", kind: "video", format: "story", videoEngine: engine, videoResolution: "720p", durationSeconds: 15,
    sceneMode: "single", teamVideoSpeechMode: "voiceover", withNarration: true, narrationVoice: "male", narrationVoiceVariant: "Puck",
    inspirationImages: engine === "wan27"
      ? [{ mimeType: "image/png", data: "A".repeat(88), role: "product", usage: "inspiration" }] : [],
    withMusic: false, freePrompt: `Une céramiste façonne un vase. Voix off exacte : « ${script} »`, ...overrides });
}

function harness(failure?: "tts" | "audio-preflight" | "voice-preflight" | "seed" | "video" | "composition", withOfficialIdentity = false, options: { overlayPreparation?: Promise<void>; overlayFailure?: boolean; qaAdvisories?: string[]; narrationLanguage?: string; videoError?: Error; fallbackVideoError?: Error; primaryVideoFailureOnly?: boolean; nativeQaStatus?: "passed" | "rejected" | "unavailable" | "inconclusive"; nativeQaStatuses?: Array<"passed" | "rejected" | "unavailable">; nativeQaAudit?: (args: Row) => Promise<nativeQa.AiMediaNativeDialogueQaResult>; nativeQaError?: Error; nativeVoiceover?: boolean; nativeVideoProvider?: string; finalFrameLayout?: "passed" | "rejected" | "unavailable" } = {}) {
  const events: string[] = [], videoCalls: Row[] = [], ttsCalls: Row[] = [], narrationCalls: Row[] = [], soundtrackCalls: Row[] = [], composeCalls: Row[] = [], saved: Row[] = [], contractCalls: Row[] = [], seedCalls: Row[] = [], googleFallbackCalls: Row[] = [];
  const voicePreflightCalls: Row[] = [], localFallbackCalls: Row[] = [], nativeQaCalls: Row[] = [];
  const warnings: unknown[][] = [], overlayCalls: Row[] = [], transparentCalls: Row[] = [];
  const forbiddenLocalFallback = async (args: Row) => { localFallbackCalls.push(args); throw new Error("unexpected_local_fallback"); };
  const profile = { business: { companyName: "Atelier", professionLabel: "Céramiste", sectorLabel: "Artisanat", phone: "" }, preferences: { language: "fr" } };
  const plan = { companyName: "Atelier", headline: "", cta: "", subline: "Une céramiste façonne un vase.",
    scenes: [{ eyebrow: "", title: "", body: "", visualBrief: "Une céramiste façonne un vase.", spokenLine: "Bonjour, je façonne un vase.", layout: "editorial" }] };
  const normalized = { kind: "video", buffer: Buffer.from("synthetic-composed-video"), mimeType: "video/mp4", extension: "mp4", width: 720, height: 1280, durationSeconds: 15 };
  const freeNarration = async (args: { request: contracts.AiMediaGenerationRequest }) => {
    narrationCalls.push(args);
    if (!args.request.withNarration || args.request.teamVideoSpeechMode === "characters") return null;
    events.push("copy"); return options.narrationLanguage ? { ...narration, language: options.narrationLanguage } : narration;
  };
  const modules = new Map<string, unknown>();
  for (const name of ["aiMediaImageContactComposer", "aiMediaCopywriter", "aiMediaGateway", "aiMediaImageProviderRequest", "aiMediaReferenceTeam",
    "aiMediaGenerationSoundtracks", "aiMediaNormalizer", "aiVideoReliability"]) modules.set(`@/lib/${name}`, {});
  const entries: Array<[string, unknown]> = [
    ["./aiMediaPendingVideo.ts", pendingVideo],
    ["./aiMediaDirectVideoPipeline.ts", directVideo],
    ["./aiMediaDirectAvatarDialogue.ts", { prepareAiMediaDirectAvatarDialogue: async (args: { request: contracts.AiMediaGenerationRequest }) => directVideo.buildAiMediaDirectVideoPlan(args.request) }],
    ["@/lib/aiMediaNativeDialogueQa", nativeQa],
    ["./aiMediaVideoSpeechBudget.ts", speechBudget],
    ["./aiMediaGlobalConstraints.ts", globalConstraints],
    ["./aiMediaSpokenScript.ts", spokenScript],
    ["./aiMediaPronunciation.ts", pronunciation],
    ["./aiMediaLocalLogoCompositionPrompt.ts", localLogoComposition],
    ["./inrAgentVideoFallback.ts", agentVideoFallback],
    ["./aiMediaGenerationPublicErrors.ts", publicErrors],
    ["server-only", {}], ["./aiMediaCharacterVoices.ts", characterVoices], ["@/lib/aiMediaCharacterVoices", characterVoices], ["sharp", (input:Row) => { transparentCalls.push(input); return { png() { return this; }, toBuffer: async () => Buffer.from("transparent-overlay") }; } ],
    ["@/lib/aiGenerationProfile", { buildNormalizedAiGenerationProfile: () => profile }],
    ["@/lib/aiMediaBusinessDna", { buildAiMediaVideoDnaBrief: () => "" }],
    ["@/lib/aiMediaBrandKit", { loadAiMediaBrandKit: async () => ({ logo: withOfficialIdentity ? Buffer.from("official-test-logo") : null, colors: ["#123456", "#654321", "#abcdef"], hasOfficialPalette: withOfficialIdentity }) }],
    ["@/lib/aiMediaFreeDnaContextServer", { loadAiMediaFreeDnaContext: async () => ({ coordonnees: {}, liens: {}, informations_demandees: [] }) }],
    ["@/lib/aiMediaBrandRenderer", { renderAiMediaVideoOverlay: async (input:Row) => { overlayCalls.push(input); await options.overlayPreparation; if(options.overlayFailure)throw new Error("synthetic private logo renderer failure"); return Buffer.from("overlay"); } }],
    ["@/lib/aiMediaCreativePlan", { buildAiMediaCreativePlan: () => plan }],
    ["@/lib/aiMediaCopywriter", { writeAiMediaHeadline: async () => plan }],
    ["@/lib/aiMediaCastingVariation", { chooseAiMediaCastingVariation: () => null }],
    ["@/lib/aiMediaFreeGenerationPlan", { buildAiMediaFreeBasePlan: () => plan, prepareAiMediaFreeCreativePlan: async () => plan, writeAiMediaFreeNarration: freeNarration }],
    ["@/lib/aiMediaFreeGenerationPrompt", { AI_MEDIA_FREE_PROMPT_VERSION: "test-free-version", getAiMediaFreeImageSize: () => "1024x1536",
      buildAiMediaFreeVideoBusinessDnaDirection, getAiMediaFreeBrandPolicy, getAiMediaFreeLogoPlacement, resolveAiMediaFreeSpeechLanguage, usesAiMediaAutomaticImageLogo, splitAiMediaFreeNarrationByScene: () => [script],
      buildAiMediaFreeSceneFramePrompt: () => "One controlled full-frame initial instant, no storyboard.",
      resolveAiMediaFreeDialogueSequence: () => ["Bonjour, je façonne un vase."] }],
    ["@/lib/aiMediaFreeVoiceoverPolicy", { needsControlledAiMediaFreeFirstFrame, usesSeparateAiMediaFreeVoiceover: options.nativeVoiceover ? () => false : usesSeparateAiMediaFreeVoiceover }],
    ["@/lib/aiMediaGenerationSoundtracks", { loadAiMediaSoundtrack: async (prompt: string, args: Row) => {
      soundtrackCalls.push({ prompt, ...args }); return soundtrack;
    } }],
    ["@/lib/aiGatewayAccountGuard", { AiGatewayAccountLimitError: class extends Error {}, AiGatewayGuardUnavailableError: class extends Error {} }],
    ["@/lib/aiGeneratedMediaRegistry", { getExistingGeneratedAiMedia: async () => null, saveGeneratedAiMedia: async (args: Row) => {
      events.push("save"); saved.push(args); return { id: "test-media", media_type: "video" };
    } }],
    ["@/lib/boosterGenerationContext", { getBoosterGenerationContext: async () => ({ profile: {}, business: {}, recentPublications: [], cacheSource: "test" }) }],
    ["@/lib/aiMediaGenerationContracts", contracts], ["./aiMediaImageProviderGateway.ts", {}],
    ["@/lib/aiMediaGateway", { generateAiMediaImage: async (args: Row) => {
      events.push("seed"); seedCalls.push(args); if (failure === "seed") throw new Error("synthetic-seed-unavailable");
      return { buffer: Buffer.from("synthetic-seed-image"), model: "test-image", provider: "test", warnings: [], referenceImagesCount: 0 };
    }, generateAiMediaImageWithGoogle: async (args: Row) => { googleFallbackCalls.push(args); throw new Error("synthetic-seed-fallback-unavailable"); } }],
    ["@/lib/aiMediaReferenceTeam", { createAiMediaFallbackVideo: forbiddenLocalFallback, createBrandMotionFrame: forbiddenLocalFallback,
      createReferenceIdentityMontage: forbiddenLocalFallback, createReferenceTeamFallbackVideo: forbiddenLocalFallback,
      createReferenceTeamMontage: forbiddenLocalFallback, prepareReferenceTeamCompositionForAnimation: async () => {
      events.push("seed-normalize"); return { data: "synthetic-normalized-seed", mimeType: "image/png" };
    } }],
    ["@/lib/aiMediaCharacterVoiceStorage", { preflightAiMediaCharacterVoices: async (args: Row) => {
      voicePreflightCalls.push(args); if (failure === "voice-preflight") throw new Error("voice_reference_unavailable");
    } }],
    ["@/lib/aiMediaGeneratedVideo", { AiMediaNarrationTooLongError: class extends Error {}, prepareAiMediaNarrationAudioForVideo: async (args: { audio: Row }) => {
      events.push("audio-preflight"); if (failure === "audio-preflight") throw new Error("synthetic-audio-unusable");
      return { audio: args.audio, silenceCompacted: false };
    }, composeOriginalAiVideo: async (args: Row) => { events.push("compose"); composeCalls.push(args); if (failure === "composition") throw new Error("ai_narration_too_long_for_natural_pace"); return normalized; } }],
    ["@/lib/aiMediaVideoLayout", { AI_MEDIA_VIDEO_TEXT_LAYOUT: "test-full-frame" }],
    ["@/lib/aiMediaVideoLocalQa", { inspectAiMediaVideoBufferLocally: async () => ({ version: 1, status: options.qaAdvisories?.length ? "advisory" : "ok", blocking: false, advisories: options.qaAdvisories || [] }) }],
    ["@/lib/aiMediaVideoProviderContract", { buildAiMediaVideoProviderContract: (args: Row) => { contractCalls.push(args); return { version: "test" }; } }],
    ["@/lib/aiMediaIdentityReferences", { AiMediaIdentityReferenceValidationError: class extends Error {}, prepareAiMediaIdentityReferences: async (images: contracts.AiMediaInspirationImage[]) => ({ providerImages: images, buffers: images.map(() => Buffer.from("sanitized-reference")) }) }],
    ["@/lib/aiMediaNarration", { writeAiMediaNarration: freeNarration }],
    ["@/lib/aiMediaNarrationAudio", { generateAiMediaNarrationAudio: async (args: Row) => {
      events.push("tts"); ttsCalls.push(args); if (failure === "tts") throw new Error("synthetic-tts-unavailable"); return audio;
    } }],
    ["./aiMediaNarrationVoiceClone.ts", { AI_MEDIA_CLONED_NARRATION_TIMEOUT_MS: 240_000, generateAiMediaClonedNarrationAudio: async (args: Row) => {
      events.push("clone"); ttsCalls.push(args); if (failure === "tts") throw new Error("synthetic-clone-unavailable"); return { ...audio, voice: "provided" };
    } }],
    ["@/lib/aiMediaNativeDialogueQaGoogle", { auditAiMediaNativeDialogueWithGoogle: async (args: Row) => {
      nativeQaCalls.push(args);
      events.push("native-qa");
      if (options.nativeQaError) throw options.nativeQaError;
      if (options.nativeQaAudit) return options.nativeQaAudit(args);
      const status = options.nativeQaStatuses?.[Math.min(nativeQaCalls.length - 1, options.nativeQaStatuses.length - 1)] || options.nativeQaStatus || "passed";
      const qaStatus = status === "inconclusive" ? "unavailable" : status;
      return { version: 1, status: qaStatus, clips: options.finalFrameLayout ? [{ sceneIndex: 0, status: "passed", finalFrameLayout: options.finalFrameLayout, issues: [] }] : status === "passed" ? [] : [{ sceneIndex: 0, status: qaStatus,
        issues: status === "rejected" ? ["spoken_critical_value_mismatch"] : [status === "inconclusive" ? "transcription_inconclusive" : "transcription_unavailable"] }] };
    } }],
    ["@/lib/aiMediaDialogue", { resolveAiMediaDialogueSequence: () => ["Bonjour, je façonne un vase."] }],
    ["@/lib/aiMediaGenerationPrompt", { AI_MEDIA_PROMPT_VERSION: "test-guided-version", buildAiMediaPrompt: (args: { request: contracts.AiMediaGenerationRequest }) => {
      if (args.request.teamVideoSpeechMode === "characters") assert.equal(args.request.withNarration, false);
      return canonicalPrompt;
    }, getAiMediaRenderDirection: () => "photoreal scene", getAiMediaPromptOutputSpec: () => ({ kind: "video" }) }],
    ["@/lib/aiMediaSensitiveText", sensitive], ["@/lib/aiMediaVisibleContact", { isAiMediaProfilePhoneDisplayRequested: () => false, cleanAiMediaProfilePhone: () => "" }],
    ["@/lib/aiVideoProvider", { preflightKlingAiVideoAccess: async () => { events.push("kling-preflight"); }, generateOriginalAiVideoClips: async (args: Row) => {
      events.push("video"); videoCalls.push(args);
      if (failure === "video" && (!options.primaryVideoFailureOnly || videoCalls.length === 1)) throw (videoCalls.length === 1 ? options.videoError : options.fallbackVideoError) || new Error(videoCalls.length === 1 ? "selected_video_unavailable" : "fallback_video_unavailable");
      return { provider: options.nativeVideoProvider || "vercel-ai-gateway", model: "test-grok", warnings: [], estimatedCostMicroUsd: 0,
        clips: [{ buffer: Buffer.from("synthetic-native-video"), mediaType: "video/mp4", requestId: "test-provider-request", durationSeconds: 15, sourceStartSeconds: 0 }] };
    } }],
    ["@/lib/aiVideoProviderTypes", { AiVideoProviderBillableFailure, isAiVideoProviderBillableFailure: () => false, getAiVideoProviderRecoverableStatus }],
    ["@/lib/aiVideoReliability", { classifyVeoFailure }],
    ["@/lib/aiMediaGenerationQuotaPolicy", { getAiMediaVideoMaxDuration: () => 30 }],
    ["@/lib/aiMediaCreditQuoteServer", { quoteAiMediaRequest: (_id: string, original: contracts.AiMediaGenerationRequest) => ({ withNarration: original.withNarration }) }],
    ["@/lib/aiMediaVideoTimeline", { getAiMediaVideoSegmentDurations }],
    ["@/lib/aiMediaVideoTemporaryImages", { preflightAiMediaVideoTemporaryImages: async () => {} }],
  ];
  for (const [name, value] of entries) modules.set(name, value);
  modules.set("@/lib/aiMediaNarrationPreparation", loadNarrationPreparationRuntime(modules));
  const filename = path.resolve("lib/aiMediaGenerationServer.ts");
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const moduleRecord = { exports: {} as { generateAndSaveAiMedia: (args: Row) => Promise<Row> } };
  const nativeRequire = createRequire(import.meta.url);
  new Function("module", "exports", "require", "console", source)(moduleRecord, moduleRecord.exports, (name: string) => {
    if (modules.has(name)) return modules.get(name);
    if (name.startsWith("node:")) return nativeRequire(name);
    throw new Error(`unexpected_test_dependency:${name}`);
  }, { info() {}, warn(...values: unknown[]) { warnings.push(values); }, error() {} });
  return { warnings, overlayCalls, transparentCalls, nativeQaCalls, events, videoCalls, ttsCalls, narrationCalls, soundtrackCalls, composeCalls, saved, contractCalls, seedCalls, googleFallbackCalls, voicePreflightCalls, localFallbackCalls,
    generate: (original: contracts.AiMediaGenerationRequest, execution: Row = {}) => moduleRecord.exports.generateAndSaveAiMedia({ request: original, accountId: "test-account", authUserId: "test-actor", jobId: "test-job", supabase: {}, ...execution }) };
}

for (const engine of ["grok-lite","wan27","kling"] as const) for (const nativeMode of ["characters","voiceover"] as const) {
  test(engine+" delivers native "+nativeMode+" without buying a speech audit, replacing audio or resubmitting", async () => {
    const env=harness(undefined,false,{nativeVoiceover:nativeMode==="voiceover",nativeQaError:new Error("QA must never run")});
    const original=request(engine,{teamVideoSpeechMode:nativeMode,withNarration:nativeMode==="voiceover",
      freePrompt:"Deux personnes présentent leur entreprise dans un jardin."});
    let billingStarts=0; const checkpoints:Row[]=[];
    await env.generate(original,{onBillableWorkStarted:async()=>{billingStarts++;},onCompositionReady:async(value:Row)=>{checkpoints.push(value);}});
    assert.equal(env.videoCalls.length,1);assert.equal(billingStarts,1);assert.equal(env.nativeQaCalls.length,0);
    assert.equal(env.ttsCalls.length,0);assert.equal(env.localFallbackCalls.length,0);
    assert.equal(env.saved.length,1);assert.equal(env.composeCalls.length,1);assert.equal(checkpoints.length,1);
    assert.equal(env.composeCalls[0].nativeAudioMode,"dialogue");assert.equal(env.composeCalls[0].narration,null);
    assert.deepEqual((env.composeCalls[0].clips as Row[])[0].buffer,Buffer.from("synthetic-native-video"));
    const gateway=(env.saved[0].metadata as Row).gateway as Row;
    assert.equal((gateway.quality_assurance as Row).policy,"provider_output");
    assert.ok(!(gateway.warnings as string[]).includes("native_speech_review_recommended"));
  });
}
for (const engine of ["wan27", "heygen"] as const) {
  for (const characterCount of [1, 2]) test(`${engine}: real Free server preserves ${characterCount} original character references and their own supplied voices without precomposition or fallback`, async () => {
    const now = Date.now();
    const voiceSample = { path: `_studio-voice-references/${new Date(now).toISOString().slice(0, 10)}/test-account__${now}__${randomUUID()}.wav`,
      name: "voice-of-first-character.wav", mimeType: "audio/wav", durationSeconds: 5, sizeBytes: 160_044 };
    const secondVoiceSample = { ...voiceSample, path: voiceSample.path.replace(/[0-9a-f-]{36}\.wav$/, `${randomUUID()}.wav`),
      name: "voice-of-second-character.wav" };
    const original = request(engine, { durationSeconds: 8, videoResolution: engine === "heygen" ? "768p" : "720p",
      inputMode: "essential", teamVideoSpeechMode: "characters", withNarration: false,
      spokenScript: characterCount === 2 ? "Bonjour, je façonne un vase. Et moi, je le décore." : "Bonjour, je façonne un vase.",
      identityConsent: true, identityReferenceSetId: randomUUID(), teamVideoProviderConsent: engine,
      freePrompt: characterCount === 2
        ? "Le premier personnage dit : « Bonjour, je façonne un vase. » La seconde répond : « Et moi, je le décore. » Chacun parle avec sa propre voix."
        : "Le premier personnage dit : « Bonjour, je façonne un vase. »",
      inspirationImages: Array.from({ length: characterCount }, (_, index) => ({ mimeType: "image/png", data: (index ? "B" : "A").repeat(88),
        role: "character", usage: "required", characterIndex: index + 1, voiceMode: "provided",
        voiceSample: index ? secondVoiceSample : voiceSample,
      })),
    });
    const before = structuredClone(original);
    for (const failure of [undefined, "video"] as const) {
      const env = harness(failure);
      if (failure) await assert.rejects(env.generate(original), /selected_video_unavailable/);
      else await env.generate(original);
      assert.deepEqual(original, before, "the server never rewrites the professional's original image/voice input");
      assert.equal(env.voicePreflightCalls.length, 1);
      assert.equal(env.voicePreflightCalls[0].videoEngine, engine);
      assert.equal(env.voicePreflightCalls[0].accountId, "test-account");
      assert.deepEqual(env.voicePreflightCalls[0].images, original.inspirationImages);
      assert.equal(env.videoCalls.length, 1, "a provider failure never tries another engine or regenerates the clip");
      const sent = env.videoCalls[0].request as contracts.AiMediaGenerationRequest;
      assert.equal(sent.videoEngine, engine); assert.equal(sent.teamVideoSpeechMode, "characters"); assert.equal(sent.withNarration, false);
      assert.deepEqual(sent.inspirationImages, original.inspirationImages, "each original photo keeps its own unchanged voice sample");
      assert.equal(env.videoCalls[0].identityTeamPrecomposed, undefined);
      if (characterCount === 2) {
        assert.equal(env.videoCalls[0].identityTeamMemberCount, 2);
        assert.equal(env.videoCalls[0].identityTeamProviderEgressConsent, engine);
        assert.deepEqual(sent.inspirationImages.map((image) => image.voiceMode), ["provided", "provided"]);
        assert.deepEqual(sent.inspirationImages.map((image) => image.voiceSample?.durationSeconds), [5, 5]);
        assert.notEqual(sent.inspirationImages[0].voiceSample?.path, sent.inspirationImages[1].voiceSample?.path);
      }
      assert.equal(env.seedCalls.length, 0); assert.equal(env.googleFallbackCalls.length, 0);
      assert.equal(env.events.includes("seed-normalize"), false);
      assert.equal(env.ttsCalls.length, 0); assert.equal(env.narrationCalls.length, 0); assert.equal(env.localFallbackCalls.length, 0);
      assert.equal(env.saved.length, failure ? 0 : 1); assert.equal(env.composeCalls.length, failure ? 0 : 1);
      if (!failure) {
        assert.equal(env.composeCalls[0].nativeAudioMode, "dialogue"); assert.equal(env.composeCalls[0].narration, null);
      }
    }
    const unavailable = harness("voice-preflight");
    await assert.rejects(unavailable.generate(original), /voice_reference_unavailable/);
    assert.equal(unavailable.voicePreflightCalls[0].videoEngine, engine);
    assert.equal(unavailable.videoCalls.length, 0); assert.equal(unavailable.seedCalls.length, 0); assert.equal(unavailable.ttsCalls.length, 0);
    assert.equal(unavailable.saved.length, 0); assert.equal(unavailable.localFallbackCalls.length, 0);
  });
}

test("Veo rejection keeps the requested resolution and original error without a hidden alternate engine", async () => {
  for (const videoResolution of ["1080p", "720p"] as const) {
    const primary = Object.assign(new Error("selected_video_unavailable"), { statusCode: 503 });
    const fallback = new Error("fallback_video_unavailable");
    const env = harness("video", false, { videoError: primary, fallbackVideoError: fallback });
    await assert.rejects(env.generate(request("veo", { durationSeconds: 8, withNarration: false, videoResolution })), error => error === primary);
    assert.equal(env.videoCalls.length, 1);
    assert.ok(env.videoCalls.every((call) => (call.request as Row).videoResolution === videoResolution));
  }
});

test("uncertain Veo submissions retain the exact error and never start an alternate paid film", async () => {
  for (const error of [
    Object.assign(new Error("ai_video_gateway_timeout"), { statusCode: 0 }),
    Object.assign(new Error("fetch failed after submission"), { statusCode: 503 }),
    Object.assign(new Error("AbortError"), { statusCode: 503 }),
    new Error("selected_video_unavailable"),
  ]) {
    const env = harness("video", false, { videoError: error });
    await assert.rejects(env.generate(request("veo", { durationSeconds: 8, withNarration: false })), caught => caught === error);
    assert.equal(env.videoCalls.length, 1);
    assert.equal(env.composeCalls.length, 0); assert.equal(env.saved.length, 0);
  }
});

test("supplier billing failures stop the real Free server before fallback, audio QA, composition or persistence", async () => {
  for (const engine of ["heygen", "grok-lite", "veo"] as const) {
    const billing = new Error("Video generation requires a minimum balance of $10. Your current balance is insufficient.");
    const env = harness("video", false, { videoError: billing });
    await assert.rejects(env.generate(request(engine, { durationSeconds: 8, videoResolution: engine === "heygen" ? "768p" : "720p", withNarration: false })), error => error === billing);
    assert.equal(env.videoCalls.length, 1, `${engine}: no alternate engine after supplier billing failure`);
    assert.equal((env.videoCalls[0].request as Row).videoEngine, engine);
    assert.equal(env.events.includes("native-qa"), false);
    assert.equal(env.composeCalls.length, 0);
    assert.equal(env.saved.length, 0);
    assert.equal(env.localFallbackCalls.length, 0);
    assert.equal(publicErrors.getAiMediaGenerationPublicError(billing).code, "AI_MEDIA_PROVIDER_BALANCE_INSUFFICIENT");
  }
});

test("Veo definite rejection returns the original error without another paid film or any still-image substitute", async () => {
  const error = Object.assign(new Error("definite upstream rejection"), { statusCode: 503 });
  const env = harness("video", false, { primaryVideoFailureOnly: true, videoError: error });
  await assert.rejects(env.generate(request("veo", { durationSeconds: 8, withSubtitles: true, spokenScript: script })), caught => caught === error);
  assert.deepEqual(env.videoCalls.map(call => (call.request as Row).videoEngine), ["veo"]);
  assert.equal(env.localFallbackCalls.length, 0);
  assert.equal(env.seedCalls.length, 0);
  assert.equal(env.saved.length, 0);
});

test("direct Grok Lite forwards the absolute deadline and original two-clip request without preparing a still frame", async () => {
  const env = harness(), deadline = Date.now() + 760_000;
  const input = request("grok-lite", { durationSeconds: 30, videoResolution: "1080p", sceneMode: "multi", withNarration: false });
  await env.generate(input, { deadlineAt: deadline });
  assert.equal(env.videoCalls.length, 1);
  assert.equal(env.videoCalls[0].deadlineAt, deadline - 45_000);
  assert.equal(env.videoCalls[0].directVideo, true);
  assert.equal((env.videoCalls[0].plan as {scenes: unknown[]}).scenes.length, 2);
  assert.equal((env.videoCalls[0].request as Row).durationSeconds, 30);
  assert.equal(env.seedCalls.length, 0);
  assert.equal(env.composeCalls.length, 1);
});

test("native Auto IA reaches each compatible engine without a scene planner, narration copywriter, TTS or synthetic image", async () => {
  for (const { id: engine, resolutions, supportsTextToVideo } of EXECUTION_MODELS) {
    const env = harness();
    const input = request(engine, { durationSeconds: 8, videoResolution: resolutions[0], ...(supportsTextToVideo ? {} : { inspirationImages: [{ mimeType: "image/png", data: "A".repeat(88), role: "product", usage: "required" }] }) });
    const before = structuredClone(input);
    await env.generate(input);
    assert.deepEqual(input, before, engine);
    assert.equal(env.videoCalls.length, 1, engine);
    assert.equal(env.ttsCalls.length, 0, engine);
    assert.equal(env.narrationCalls.length, 0, engine);
    assert.equal(env.seedCalls.length, 0, engine);
    assert.equal(env.localFallbackCalls.length, 0, engine);
    assert.equal(env.videoCalls[0].directVideo, true, engine);
    assert.equal(env.videoCalls[0].canonicalPrompt, input.freePrompt, engine);
    assert.equal(env.videoCalls[0].canonicalPromptSha256, createHash("sha256").update(input.freePrompt!).digest("hex"), engine);
    assert.equal((env.videoCalls[0].request as Row).withNarration, true, engine);
    assert.equal(env.composeCalls[0].nativeAudioMode, "dialogue", engine);
    assert.equal(env.composeCalls[0].narration, null, engine);
    const metadata = env.saved[0].metadata as Row;
    assert.equal(((metadata.gateway as Row).narration as Row).script_source, "provider_auto", engine);
  }
});

test("native exact narration keeps its words and selected speaker settings without synthesizing another voice", async () => {
  for (const engine of ["grok-lite", "wan27", "kling", "veo"] as const) {
    const env = harness();
    const input = request(engine, { durationSeconds: 8, spokenScript: script, narrationVoice: "female", narrationVoiceVariant: "Kore", withSubtitles: true });
    await env.generate(input);
    assert.equal(env.ttsCalls.length, 0, engine);
    assert.deepEqual(env.videoCalls[0].nativeNarrationLines, [script], engine);
    assert.equal((env.videoCalls[0].request as Row).narrationVoice, "female", engine);
    assert.equal((env.videoCalls[0].request as Row).withSubtitles, true, engine);
    assert.equal(env.composeCalls[0].nativeAudioMode, "dialogue", engine);
  }
});

function narratorReference() {
  const now = Date.now();
  const sample = { path: `_studio-voice-references/${new Date(now).toISOString().slice(0, 10)}/test-account__${now}__11111111-1111-4111-8111-111111111111.wav`,
    durationSeconds: 6, sizeBytes: 192_044, name: "voice.wav", mimeType: "audio/wav" };
  return { sample, prepared: { accountId: "test-account", path: sample.path, buffer: Buffer.from("owned-reference"), durationSeconds: 6 } };
}

test("provided offscreen narration is prepared before video; its exact local captions never duplicate native captions", async () => {
  for (const withSubtitles of [false, true]) {
    const env = harness(), voice = narratorReference();
    const input = request("grok-lite", { durationSeconds: 10, withSubtitles, spokenScript: script,
      narrationVoiceMode: "provided", narrationVoiceSample: voice.sample, narrationVoiceConsent: true });
    const before = structuredClone(input);
    await env.generate(input, { preparedNarrationVoice: voice.prepared });
    assert.deepEqual(input, before);
    assert.equal((env.videoCalls[0].request as Row).withSubtitles, false);
    assert.equal((env.videoCalls[0].request as Row).withNarration, false);
    assert.deepEqual(env.composeCalls[0].subtitles, withSubtitles ? { script } : undefined);
    assert.equal((env.composeCalls[0].narration as Row).voice, "provided");
    assert.equal(env.composeCalls[0].nativeAudioMode, "mute");
    assert.ok(env.events.indexOf("audio-preflight") < env.events.indexOf("video"));
    assert.equal(env.seedCalls.length, 0);
  }
});

for (const failure of ["tts", "audio-preflight"] as const) test("required provided narration " + failure + " failure stops before buying video", async () => {
  const env = harness(failure), voice = narratorReference();
  const input = request("grok-lite", { durationSeconds: 8, narrationVoiceMode: "provided", narrationVoiceSample: voice.sample, narrationVoiceConsent: true });
  await assert.rejects(env.generate(input, { preparedNarrationVoice: voice.prepared }), /ai_media_narration_unavailable/);
  assert.equal(env.videoCalls.length, 0);
  assert.equal(env.seedCalls.length, 0);
  assert.equal(env.saved.length, 0);
});

test("composition checkpoints contain reusable native clips and audio policy without exposing the raw brief", async () => {
  const env = harness(), checkpoints: Row[] = [], input = request("grok-lite");
  await env.generate(input, { onCompositionReady: async (checkpoint: Row) => {
    checkpoints.push(checkpoint);
    assert.ok(!env.events.includes("compose"));
  } });
  assert.equal(checkpoints.length, 1);
  assert.equal((checkpoints[0].input as Row).narration, null);
  assert.equal((checkpoints[0].input as Row).nativeAudioMode, "dialogue");
  assert.ok(!("signal" in (checkpoints[0].input as Row)));
  assert.ok(!JSON.stringify(checkpoints[0].metadata).includes(input.freePrompt!));
});

test("checked ADN adds only the requested identity without an extra paid frame", async () => {
  for (const { id: engine, resolutions } of AI_MEDIA_AVAILABLE_VIDEO_MODELS) {
    const env = harness(undefined, true);
    const input = request(engine, { useBusinessDna: true, durationSeconds: 8, videoResolution: resolutions[0], withNarration: false });
    const before = structuredClone(input);
    await env.generate(input);
    assert.deepEqual(input, before);
    assert.equal(env.videoCalls.length, 1, engine);
    assert.equal(env.seedCalls.length, 0, engine);
    assert.equal(env.ttsCalls.length, 0, engine);
    assert.match(String(env.videoCalls[0].businessDnaDirection), /#123456|logo is added locally/);
    assert.equal((env.saved[0].metadata as {provenance: Row}).provenance.exact_logo_applied, true);
  }
});

test("native speech errors cannot be replaced with a static clip, another engine, or a dropped voice", async () => {
  const failure = new Error("selected_video_unavailable");
  const env = harness("video", false, { videoError: failure });
  await assert.rejects(env.generate(request("grok-lite")), error => error === failure);
  assert.equal(env.videoCalls.length, 1);
  assert.equal(env.localFallbackCalls.length, 0);
  assert.equal(env.seedCalls.length, 0);
  assert.equal(env.saved.length, 0);
});

test("silent direct video preserves optional music and always mutes unrequested native speech", async () => {
  for (const { id: engine, resolutions } of EXECUTION_MODELS) for (const withMusic of [false, true]) {
    const env = harness();
    const input = request(engine, { durationSeconds: 8, videoResolution: resolutions[0], withNarration: false, withMusic });
    await env.generate(input);
    assert.equal(env.ttsCalls.length, 0, engine);
    assert.equal(env.narrationCalls.length, 0, engine);
    assert.equal(env.seedCalls.length, 0, engine);
    assert.equal(env.composeCalls[0].narration, null, engine);
    assert.equal(env.composeCalls[0].nativeAudioMode, "mute", engine);
    assert.equal(env.composeCalls[0].soundtrack, withMusic ? soundtrack : null, engine);
    assert.equal(env.saved.length, 1, engine);
  }
});

test("original product and character references keep their roles, bytes and account consent in direct Free", async () => {
  for (const role of ["product", "character"] as const) {
    const env = harness();
    const input = request("grok-lite", { identityConsent: true, identityReferenceSetId: "test-identity-reference",
      inspirationImages: [{ mimeType: "image/png", data: "A".repeat(88), role, usage: "required", ...(role === "character" ? { characterIndex: 1 } : {}) }] });
    const before = structuredClone(input);
    await env.generate(input);
    assert.deepEqual(input, before);
    assert.equal(env.seedCalls.length, 0);
    const sent = env.videoCalls[0].request as contracts.AiMediaGenerationRequest;
    assert.deepEqual(sent.inspirationImages, input.inspirationImages);
    assert.equal(sent.identityMode, input.identityMode);
    assert.equal(sent.identityConsent, input.identityConsent);
    assert.equal(env.videoCalls[0].identityTeamPrecomposed, undefined);
  }
});

test("legacy guided narration retains its measured external audio preparation", async () => {
  const env = harness();
  await env.generate(request("grok", { creationMode: "guided", inputMode: "essential", subjectSource: "custom",
    idea: "Une céramiste façonne un vase.", textMode: "none", withText: false, logoMode: "none" }));
  assert.equal(env.ttsCalls.length, 1);
  assert.equal((env.videoCalls[0].request as contracts.AiMediaGenerationRequest).withNarration, true);
  assert.equal(env.seedCalls.length, 0);
});

enabledComparisonTest("enabling legacy comparison cannot add a paid review to a native film",async()=>{
  const env=harness(undefined,false,{nativeVideoProvider:"vercel-ai-gateway:google",nativeQaError:new Error("QA must never run")});
  await env.generate(request("veo",{durationSeconds:8,teamVideoSpeechMode:"characters",withNarration:false,freePrompt:"Une femme présente un jardin."}));
  assert.equal(env.nativeQaCalls.length,0);assert.equal(env.videoCalls.length,1);assert.equal(env.saved.length,1);assert.equal(env.ttsCalls.length,0);
});

test("accepted HeyGen character dialogue checkpoints native captions without generating a second voice", async () => {
  const pending=new pendingVideo.AiVideoProviderPending({provider:"heygen-direct",model:"heygen-avatar-iv",videoId:"accepted-caption-video",temporaryVoiceIds:[],temporaryAvatarGroupIds:[],temporaryAssetIds:[],estimatedCostMicroUsd:640000});
  const env=harness("video",false,{videoError:pending}),checkpoints:Row[]=[];
  const input=request("heygen-avatar",{durationSeconds:8,teamVideoSpeechMode:"characters",withNarration:false,withSubtitles:true,spokenScript:"Bonjour, je façonne un vase.",freePrompt:"Une céramiste présente son atelier."});
  await assert.rejects(env.generate(input,{onCompositionReady:async(value:Row)=>{checkpoints.push(value);}}),error=>error===pending);
  assert.equal(checkpoints.length,2);assert.equal(checkpoints[0].providerReceiptOnly,true);assert.deepEqual((checkpoints.at(-1)!.input as Row).subtitles,{script:"Bonjour, je façonne un vase.",source:"native"});
  assert.equal((checkpoints[0].input as Row).narration,null);assert.equal((checkpoints[0].input as Row).nativeAudioMode,"dialogue");
  assert.equal((checkpoints[0].metadata as Row).video_finishing_requested,true);assert.equal(env.ttsCalls.length,0);assert.equal(env.nativeQaCalls.length,0);assert.equal(env.videoCalls.length,1);
});

test("accepted HeyGen renders keep the actual local ADN logo even when the raw logo mode is none", async () => {
  const pending=new pendingVideo.AiVideoProviderPending({provider:"heygen-direct",model:"heygen-avatar-iv",videoId:"accepted-logo-video",temporaryVoiceIds:[],temporaryAvatarGroupIds:[],temporaryAssetIds:[],estimatedCostMicroUsd:640000});
  for (const useBusinessDna of [true,false]) {
    const env=harness("video",true,{videoError:pending}),checkpoints:Row[]=[];
    const input=request("heygen-avatar",{durationSeconds:8,teamVideoSpeechMode:"characters",withNarration:false,withSubtitles:false,logoMode:"none",useBusinessDna,freePrompt:"Une céramiste présente son atelier."});
    await assert.rejects(env.generate(input,{onCompositionReady:async(value:Row)=>{checkpoints.push(value);}}),error=>error===pending);
    assert.equal(input.logoMode,"none");assert.equal((checkpoints[0].metadata as Row).video_finishing_requested,useBusinessDna);
    assert.equal(env.videoCalls.length,1);assert.equal(env.ttsCalls.length,0);
  }
});

test("HeyGen acceptance becomes durable before a deferred failed overlay and still returns the same supplier ID",async()=>{
  const overlay=Promise.withResolvers<void>();
  const pending=new pendingVideo.AiVideoProviderPending({provider:"heygen-direct",model:"heygen-avatar-iv",videoId:"accepted-before-overlay",temporaryVoiceIds:[],temporaryAvatarGroupIds:[],temporaryAssetIds:[],estimatedCostMicroUsd:640000});
  const env=harness("video",true,{videoError:pending,overlayPreparation:overlay.promise}),checkpoints:Row[]=[];
  const input=request("heygen-avatar",{durationSeconds:8,teamVideoSpeechMode:"characters",withNarration:false,useBusinessDna:true,freePrompt:"Une céramiste présente son atelier."});
  const rejection=assert.rejects(env.generate(input,{onCompositionReady:async(value:Row)=>{checkpoints.push(value);}}),error=>error===pending);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(checkpoints.length,1,"the accepted ID must already be durable while finishing is unresolved");
  assert.equal(checkpoints[0].providerReceiptOnly,true);assert.equal((checkpoints[0].pendingProvider as Row).videoId,"accepted-before-overlay");
  assert.equal((checkpoints[0].input as Row).nativeAudioMode,"dialogue");
  overlay.reject(new Error("synthetic overlay preparation unavailable"));
  await rejection;
  assert.equal(checkpoints.length,2);assert.equal(env.videoCalls.length,1);assert.equal(env.ttsCalls.length,0);assert.equal(env.nativeQaCalls.length,0);
  assert.equal((checkpoints[1].pendingProvider as Row).videoId,"accepted-before-overlay");
  assert.deepEqual((checkpoints[1].metadata as Row).warnings,["branding_overlay_unavailable_video_continued"]);
  assert.equal((checkpoints[1].input as Row).nativeAudioMode,"dialogue");
  assert.equal(env.overlayCalls.length,1,"a failing ADN logo is not retried by minimal overlays");
});

test("even a failing caller checkpoint callback cannot replace the accepted provider task with a generic error",async()=>{
  const pending=new pendingVideo.AiVideoProviderPending({provider:"heygen-direct",model:"heygen-avatar-iv",videoId:"accepted-callback-error",temporaryVoiceIds:[],temporaryAvatarGroupIds:[],temporaryAssetIds:[],estimatedCostMicroUsd:640000});
  const env=harness("video",false,{videoError:pending});
  await assert.rejects(env.generate(request("heygen-avatar",{durationSeconds:8,teamVideoSpeechMode:"characters",withNarration:false,withSubtitles:true}),
    {onCompositionReady:async()=>{throw new Error("synthetic persistence outage");}}),error=>error===pending);
  assert.equal(env.videoCalls.length,1);assert.equal(env.ttsCalls.length,0);
});

test("Wan native dialogue survives a failed optional ADN PNG with one provider and its original audio",async()=>{
 const env=harness(undefined,true,{overlayFailure:true});
 const input=request("wan27",{durationSeconds:8,useBusinessDna:true,teamVideoSpeechMode:"characters",withNarration:false,freePrompt:"Deux personnes présentent leur entreprise dans le jardin."});
 await env.generate(input);
 assert.equal(env.videoCalls.length,1);assert.equal(env.seedCalls.length,0);assert.equal(env.nativeQaCalls.length,0);assert.equal(env.ttsCalls.length,0);
 assert.equal(env.overlayCalls.length,1);assert.equal(env.composeCalls.length,1);assert.equal(env.saved.length,1);
 assert.equal(env.composeCalls[0].nativeAudioMode,"dialogue");
 assert.deepEqual(env.composeCalls[0].overlays,[Buffer.from("transparent-overlay")]);
 assert.equal(((env.transparentCalls[0].create as Row).background as Row).alpha,0);
 assert.ok(JSON.stringify(env.saved[0].metadata).includes("branding_overlay_unavailable_video_continued"));
 assert.doesNotMatch(JSON.stringify(env.saved[0].metadata),/synthetic private logo renderer failure/);
});

test("essential guided video branding also falls back to an empty PNG without dropping native speech",async()=>{
 const env=harness(undefined,true,{overlayFailure:true});
 const input=request("wan27",{creationMode:"guided",inputMode:"essential",subjectSource:"custom",idea:"Une équipe présente un jardin.",
  durationSeconds:8,teamVideoSpeechMode:"characters",withNarration:false,textMode:"ai",withText:true,logoMode:"discreet"});
 await env.generate(input);
 assert.equal(env.videoCalls.length,1);assert.equal(env.overlayCalls.length,1);assert.equal(env.composeCalls.length,1);assert.equal(env.saved.length,1);
 assert.equal(env.composeCalls[0].nativeAudioMode,"dialogue");assert.equal(env.ttsCalls.length,0);assert.equal(env.nativeQaCalls.length,0);
 assert.deepEqual(env.composeCalls[0].overlays,[Buffer.from("transparent-overlay")]);
 assert.ok(JSON.stringify(env.saved[0].metadata).includes("branding_overlay_unavailable_video_continued"));
});

test("supplier accounting is recorded only after the accepted ID checkpoint and cannot delay its durable acknowledgment", async () => {
  const phases: string[] = [];
  const pending = new pendingVideo.AiVideoProviderPending({ provider: "heygen-direct", model: "heygen-video-1", videoId: "accepted-ledger-order",
    temporaryVoiceIds: [], temporaryAvatarGroupIds: [], temporaryAssetIds: [], estimatedCostMicroUsd: 640000 },
    async () => { phases.push("supplier-ledger"); throw new Error("synthetic-ledger-outage"); });
  const env = harness("video", false, { videoError: pending });
  await assert.rejects(env.generate(request("heygen-avatar", { durationSeconds: 8 }),
    { onCompositionReady: async (value: Row) => { assert.equal(value.providerReceiptOnly, true); phases.push("durable-id"); } }), error => error === pending);
  assert.deepEqual(phases, ["durable-id", "supplier-ledger"]);
  assert.equal(env.videoCalls.length, 1);
});
