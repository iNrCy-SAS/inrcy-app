import * as characterVoices from "../../lib/aiMediaCharacterVoices.ts";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import { needsControlledAiMediaFreeFirstFrame, usesSeparateAiMediaFreeVoiceover } from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import * as sensitive from "../../lib/aiMediaSensitiveText.ts";
import * as agentVideoFallback from "../../lib/inrAgentVideoFallback.ts";
import * as publicErrors from "../../lib/aiMediaGenerationPublicErrors.ts";
import { getAiMediaFreeBrandPolicy, getAiMediaFreeLogoPlacement, resolveAiMediaFreeSpeechLanguage } from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";

type Row = Record<string, unknown>;
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
    withMusic: false, freePrompt: `Une céramiste façonne un vase. Voix off exacte : « ${script} »`, ...overrides });
}

function harness(failure?: "tts" | "audio-preflight" | "voice-preflight" | "seed" | "video" | "composition", withOfficialIdentity = false, options: { qaAdvisories?: string[]; narrationLanguage?: string } = {}) {
  const events: string[] = [], videoCalls: Row[] = [], ttsCalls: Row[] = [], narrationCalls: Row[] = [], soundtrackCalls: Row[] = [], composeCalls: Row[] = [], saved: Row[] = [], contractCalls: Row[] = [], seedCalls: Row[] = [], googleFallbackCalls: Row[] = [];
  const voicePreflightCalls: Row[] = [], localFallbackCalls: Row[] = [];
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
    ["./inrAgentVideoFallback.ts", agentVideoFallback],
    ["./aiMediaGenerationPublicErrors.ts", publicErrors],
    ["server-only", {}], ["./aiMediaCharacterVoices.ts", characterVoices], ["@/lib/aiMediaCharacterVoices", characterVoices], ["sharp", () => ({ png() { return this; }, toBuffer: async () => Buffer.from("transparent-overlay") })],
    ["@/lib/aiGenerationProfile", { buildNormalizedAiGenerationProfile: () => profile }],
    ["@/lib/aiMediaBusinessDna", { buildAiMediaVideoDnaBrief: () => "" }],
    ["@/lib/aiMediaBrandKit", { loadAiMediaBrandKit: async () => ({ logo: withOfficialIdentity ? Buffer.from("official-test-logo") : null, colors: ["#123456", "#654321", "#abcdef"], hasOfficialPalette: withOfficialIdentity }) }],
    ["@/lib/aiMediaFreeDnaContextServer", { loadAiMediaFreeDnaContext: async () => ({ coordonnees: {}, liens: {}, informations_demandees: [] }) }],
    ["@/lib/aiMediaBrandRenderer", { renderAiMediaVideoOverlay: async () => Buffer.from("overlay") }],
    ["@/lib/aiMediaCreativePlan", { buildAiMediaCreativePlan: () => plan }],
    ["@/lib/aiMediaCopywriter", { writeAiMediaHeadline: async () => plan }],
    ["@/lib/aiMediaCastingVariation", { chooseAiMediaCastingVariation: () => null }],
    ["@/lib/aiMediaFreeGenerationPlan", { buildAiMediaFreeBasePlan: () => plan, prepareAiMediaFreeCreativePlan: async () => plan, writeAiMediaFreeNarration: freeNarration }],
    ["@/lib/aiMediaFreeGenerationPrompt", { AI_MEDIA_FREE_PROMPT_VERSION: "test-free-version", getAiMediaFreeImageSize: () => "1024x1536",
      getAiMediaFreeBrandPolicy, getAiMediaFreeLogoPlacement, resolveAiMediaFreeSpeechLanguage, splitAiMediaFreeNarrationByScene: () => [script],
      buildAiMediaFreeSceneFramePrompt: () => "One controlled full-frame initial instant, no storyboard.",
      resolveAiMediaFreeDialogueSequence: () => ["Bonjour, je façonne un vase."] }],
    ["@/lib/aiMediaFreeVoiceoverPolicy", { needsControlledAiMediaFreeFirstFrame, usesSeparateAiMediaFreeVoiceover }],
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
    ["@/lib/aiMediaNativeDialogueQaGoogle", { auditAiMediaNativeDialogueWithGoogle: async () => { events.push("native-qa"); return { version: 1, status: "passed", clips: [] }; } }],
    ["@/lib/aiMediaDialogue", { resolveAiMediaDialogueSequence: () => ["Bonjour, je façonne un vase."] }],
    ["@/lib/aiMediaGenerationPrompt", { AI_MEDIA_PROMPT_VERSION: "test-guided-version", buildAiMediaPrompt: (args: { request: contracts.AiMediaGenerationRequest }) => {
      if (args.request.teamVideoSpeechMode === "characters") assert.equal(args.request.withNarration, false);
      return canonicalPrompt;
    }, getAiMediaPromptOutputSpec: () => ({ kind: "video" }) }],
    ["@/lib/aiMediaSensitiveText", sensitive], ["@/lib/aiMediaVisibleContact", { isAiMediaProfilePhoneDisplayRequested: () => false, cleanAiMediaProfilePhone: () => "" }],
    ["@/lib/aiVideoProvider", { generateOriginalAiVideoClips: async (args: Row) => {
      events.push("video"); videoCalls.push(args);
      if (failure === "video") throw new Error(videoCalls.length === 1 ? "selected_video_unavailable" : "fallback_video_unavailable");
      return { provider: "vercel-ai-gateway", model: "test-grok", warnings: [], estimatedCostMicroUsd: 0,
        clips: [{ buffer: Buffer.from("synthetic-native-video"), mediaType: "video/mp4", requestId: "test-provider-request", durationSeconds: 15, sourceStartSeconds: 0 }] };
    } }],
    ["@/lib/aiVideoProviderTypes", { isAiVideoProviderBillableFailure: () => false }],
    ["@/lib/aiVideoReliability", { classifyVeoFailure: () => ({ kind: "transient" }) }],
    ["@/lib/aiMediaGenerationQuotaPolicy", { getAiMediaVideoMaxDuration: () => 30 }],
    ["@/lib/aiMediaCreditQuoteServer", { quoteAiMediaRequest: (_id: string, original: contracts.AiMediaGenerationRequest) => ({ withNarration: original.withNarration }) }],
    ["@/lib/aiMediaVideoTimeline", { getAiMediaVideoSegmentDurations }],
    ["@/lib/aiMediaVideoTemporaryImages", { preflightAiMediaVideoTemporaryImages: async () => {} }],
  ];
  for (const [name, value] of entries) modules.set(name, value);
  const filename = path.resolve("lib/aiMediaGenerationServer.ts");
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const moduleRecord = { exports: {} as { generateAndSaveAiMedia: (args: Row) => Promise<Row> } };
  const nativeRequire = createRequire(import.meta.url);
  new Function("module", "exports", "require", "console", source)(moduleRecord, moduleRecord.exports, (name: string) => {
    if (modules.has(name)) return modules.get(name);
    if (name.startsWith("node:")) return nativeRequire(name);
    throw new Error(`unexpected_test_dependency:${name}`);
  }, { info() {}, warn() {}, error() {} });
  return { events, videoCalls, ttsCalls, narrationCalls, soundtrackCalls, composeCalls, saved, contractCalls, seedCalls, googleFallbackCalls, voicePreflightCalls, localFallbackCalls,
    generate: (original: contracts.AiMediaGenerationRequest, execution: Row = {}) => moduleRecord.exports.generateAndSaveAiMedia({ request: original, accountId: "test-account", authUserId: "test-actor", jobId: "test-job", supabase: {}, ...execution }) };
}

for (const engine of ["wan27", "wan3", "heygen"] as const) {
  for (const characterCount of [1, 2]) test(`${engine}: real Free server preserves ${characterCount} original character references and their own supplied voices without precomposition or fallback`, async () => {
    const now = Date.now();
    const voiceSample = { path: `_studio-voice-references/${new Date(now).toISOString().slice(0, 10)}/test-account__${now}__${randomUUID()}.wav`,
      name: "voice-of-first-character.wav", mimeType: "audio/wav", durationSeconds: 5, sizeBytes: 160_044 };
    const secondVoiceSample = { ...voiceSample, path: voiceSample.path.replace(/[0-9a-f-]{36}\.wav$/, `${randomUUID()}.wav`),
      name: "voice-of-second-character.wav" };
    const original = request(engine, { durationSeconds: 8, videoResolution: engine === "heygen" ? "768p" : "720p",
      inputMode: "essential", teamVideoSpeechMode: "characters", withNarration: false,
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

test("Veo fallback keeps resolution and the original failure instead of calling incompatible Omni", async () => {
  for (const videoResolution of ["1080p", "720p"] as const) {
    const env = harness("video");
    await assert.rejects(env.generate(request("veo", { durationSeconds: 8, withNarration: false, videoResolution })), /selected_video_unavailable/);
    assert.equal(env.videoCalls.length, videoResolution === "1080p" ? 1 : 2);
    assert.ok(env.videoCalls.every((call) => (call.request as Row).videoResolution === videoResolution));
  }
});

test("separate voiceover uses the script language and local QA remains advisory without regeneration", async () => {
  const env = harness(undefined, false, { narrationLanguage: "en", qaAdvisories: ["mostly_frozen"] });
  await env.generate(request("veo", { durationSeconds: 8 }));
  assert.equal((env.ttsCalls[0].narration as typeof narration).language, "en");
  assert.equal(env.videoCalls[0].nativeNarrationLines, undefined);
  assert.equal(env.videoCalls.length, 1);
  const metadata = env.saved[0].metadata as Row;
  const gateway = metadata.gateway as Row;
  assert.ok((gateway.warnings as string[]).includes("video_local_qa_mostly_frozen"));
  assert.equal(((gateway.quality_assurance as Row).final_video as Row).blocking, false);
});

test("composition recovery callback receives reusable assets before composition and no prompt or script", async () => {
  const env = harness();
  const checkpoints: Row[] = [];
  await env.generate(request("grok"), { onCompositionReady: async (checkpoint: Row) => {
    checkpoints.push(checkpoint); assert.ok(!env.events.includes("compose"));
  } });
  assert.equal(checkpoints.length, 1);
  assert.equal((checkpoints[0].input as Row).narration, audio);
  assert.equal((checkpoints[0].input as Row).nativeAudioMode, "mute");
  assert.ok(!("signal" in (checkpoints[0].input as Row)));
  assert.ok(!JSON.stringify(checkpoints[0].metadata).includes(script));
  assert.ok(!JSON.stringify(checkpoints[0].metadata).includes(canonicalPrompt));
});

test("a composition failure cannot silently remove requested narration in free or legacy generation", async () => {
  for (const creationMode of ["free", "guided"]) {
    const env = harness("composition");
    const original = request("grok", { creationMode, inputMode: "legacy", identityMode: "auto", idea: "Un atelier" });
    await assert.rejects(env.generate(original), /video_composition_failed/);
    assert.equal(env.composeCalls.length, 1);
    assert.equal(env.composeCalls[0].narration, audio);
    assert.equal(env.videoCalls.length, 1);
    assert.equal(env.saved.length, 0);
  }
});

test("checked ADN retains the same video path and adds only the official identity, without an extra paid frame", async () => {
  for (const engine of ["omni", "veo", "veo-lite", "minimax-h3", "wan3", "wan-flash", "grok", "grok-lite"] as const) {
    const env = harness(undefined, true);
    const input = request(engine, { useBusinessDna: true, durationSeconds: 8, videoResolution: engine === "minimax-h3" ? "768p" : "720p", withNarration: false, freePrompt: "Une céramiste façonne un vase." });
    const before = structuredClone(input);
    await env.generate(input);
    assert.deepEqual(input, before);
    assert.equal(env.videoCalls.length, 1, engine);
    assert.equal(env.seedCalls.length, engine === "grok" || engine === "grok-lite" ? 1 : 0, engine);
    assert.equal(env.ttsCalls.length, 0);
    assert.equal((env.videoCalls[0].request as contracts.AiMediaGenerationRequest).videoEngine, engine);
    assert.match(String(env.videoCalls[0].businessDnaDirection), /#123456|logo is added locally/);
    assert.equal(env.composeCalls.length, 1);
    const metadata = env.saved[0].metadata as { provenance: Row };
    assert.equal(metadata.provenance.business_dna_used, true);
    assert.equal(metadata.provenance.exact_logo_applied, true);
  }
});

test("all free engines separate narration, never characters or transforms; only Grok needs a seed", () => {
  for (const videoEngine of ["grok", "grok-lite", "omni", "veo", "veo-lite", "minimax-h3", "wan3", "wan-flash", "heygen"] as const) {
    const base = { ...request("grok"), videoEngine };
    assert.equal(usesSeparateAiMediaFreeVoiceover(base), true, videoEngine);
    assert.equal(needsControlledAiMediaFreeFirstFrame(base), videoEngine === "grok" || videoEngine === "grok-lite", videoEngine);
    for (const patch of [{ creationMode: "guided" }, { operation: "modify" }, { kind: "image" }, { withNarration: false }, { teamVideoSpeechMode: "characters" }] as const)
      assert.equal(usesSeparateAiMediaFreeVoiceover({ ...base, ...patch }), false);
  }
});

for (const engine of ["grok", "grok-lite"] as const) {
  test(`${engine}: exact narration and selected voice are ready before video, without changing professional request or hash`, async () => {
    const env = harness(), original = request(engine), before = structuredClone(original);
    await env.generate(original);
    assert.deepEqual(original, before);
    assert.deepEqual(env.events, ["copy", "tts", "audio-preflight", "seed", "seed-normalize", "video", "compose", "save"]);
    assert.equal(env.videoCalls.length, 1); assert.equal(env.ttsCalls.length, 1);
    assert.equal(env.seedCalls.length, 1); assert.deepEqual(env.seedCalls[0].identityReferences, []);
    assert.equal(env.seedCalls[0].prompt, "One controlled full-frame initial instant, no storyboard.");
    assert.deepEqual((env.videoCalls[0].request as contracts.AiMediaGenerationRequest).inspirationImages,
      [{ data: "synthetic-normalized-seed", mimeType: "image/png", role: "inspiration", usage: "required" }]);
    assert.equal((env.videoCalls[0].request as contracts.AiMediaGenerationRequest).withNarration, false);
    assert.equal((env.videoCalls[0].request as contracts.AiMediaGenerationRequest).teamVideoSpeechMode, "voiceover");
    assert.equal(env.videoCalls[0].nativeNarrationLines, undefined);
    assert.equal((env.contractCalls[0].request as contracts.AiMediaGenerationRequest).withNarration, false);
    assert.equal(env.videoCalls[0].canonicalPrompt, canonicalPrompt);
    assert.equal(env.videoCalls[0].canonicalPromptSha256, createHash("sha256").update(canonicalPrompt).digest("hex"));
    assert.equal((env.ttsCalls[0].narration as typeof narration).script, script);
    assert.equal(env.ttsCalls[0].narrationVoice, "male"); assert.equal(env.ttsCalls[0].narrationVoiceVariant, "Puck");
    assert.equal(env.ttsCalls[0].durationSeconds, 15);
    assert.equal(env.composeCalls[0].narration, audio); assert.equal(env.composeCalls[0].nativeAudioMode, "mute");
    const metadata = env.saved[0].metadata as { gateway: { narration: Row; quality_assurance: { native_voiceover: Row } }; provenance: Row };
    assert.equal(metadata.gateway.narration.delivery, "tts"); assert.equal(metadata.gateway.narration.script_sha256, narration.sha256);
    assert.equal(metadata.gateway.quality_assurance.native_voiceover.status, "not_requested");
    assert.equal(metadata.provenance.with_narration, true); assert.deepEqual(metadata.provenance.credit_quote, { withNarration: true });
  });

  for (const failure of ["tts", "audio-preflight"] as const) test(`${engine}: ${failure} failure rejects before any billable video or saved media`, async () => {
    const env = harness(failure);
    await assert.rejects(env.generate(request(engine)), /ai_media_narration_unavailable/u);
    assert.equal(env.seedCalls.length, 0); assert.equal(env.videoCalls.length, 0); assert.equal(env.composeCalls.length, 0); assert.equal(env.saved.length, 0);
  });

  test(`${engine}: unavailable initial frame rejects before video submission`, async () => {
    const env = harness("seed"); await assert.rejects(env.generate(request(engine)), /synthetic-seed-unavailable/u);
    assert.equal(env.seedCalls.length, 1); assert.equal(env.googleFallbackCalls.length, 0);
    assert.equal(env.videoCalls.length, 0); assert.equal(env.saved.length, 0);
  });

  test(`${engine}: talking characters keep native speech and never receive TTS`, async () => {
    const env = harness(); await env.generate(request(engine, { teamVideoSpeechMode: "characters", withNarration: false, freePrompt: "Une céramiste dit : « Bonjour, je façonne un vase. »" }));
    assert.equal(env.ttsCalls.length, 0); assert.ok(env.events.includes("native-qa"));
    assert.equal((env.videoCalls[0].request as contracts.AiMediaGenerationRequest).teamVideoSpeechMode, "characters");
    assert.equal(env.composeCalls[0].nativeAudioMode, "dialogue");
  });

  test(`${engine}: silent free video still gets one initial frame without TTS`, async () => {
    const env = harness(); await env.generate(request(engine, { withNarration: false }));
    assert.equal(env.ttsCalls.length, 0); assert.equal(env.seedCalls.length, 1); assert.equal(env.videoCalls.length, 1);
    assert.equal(env.videoCalls[0].nativeNarrationLines, undefined); assert.equal(env.composeCalls[0].nativeAudioMode, "mute");
  });
}

test("all nine free engines without speech mute native audio and preserve optional instrumental music without any narration call", async () => {
  for (const engine of ["grok", "grok-lite", "omni", "veo", "veo-lite", "minimax-h3", "wan3", "wan-flash", "heygen"] as const) {
    for (const withMusic of [false, true]) {
      const label = `${engine}, music=${withMusic}`;
      const env = harness();
      const original = request(engine, {
        durationSeconds: 8, videoResolution: engine === "minimax-h3" || engine === "heygen" ? "768p" : "720p",
        withNarration: false, teamVideoSpeechMode: "voiceover", withMusic,
        freePrompt: "Une céramiste façonne un vase, sans parole.",
      });
      const before = structuredClone(original);
      await env.generate(original);
      assert.deepEqual(original, before, label);
      assert.equal(env.narrationCalls.length, 0, `${label}: no narration script requested`);
      assert.equal(env.ttsCalls.length, 0, `${label}: no TTS requested`);
      assert.equal(env.events.includes("audio-preflight"), false, label);
      assert.equal(env.events.includes("native-qa"), false, label);
      assert.equal(env.videoCalls.length, 1, label);
      const providerRequest = env.videoCalls[0].request as contracts.AiMediaGenerationRequest;
      assert.equal(providerRequest.videoEngine, engine, label);
      assert.equal(providerRequest.withNarration, false, label);
      assert.equal(providerRequest.withMusic, withMusic, `${label}: provider music choice preserved`);
      assert.equal(providerRequest.teamVideoSpeechMode, "voiceover", label);
      assert.equal(env.videoCalls[0].nativeNarrationLines, undefined, label);
      assert.equal((env.contractCalls[0].request as contracts.AiMediaGenerationRequest).withMusic, withMusic, label);
      assert.equal(env.composeCalls.length, 1, label);
      assert.equal(env.composeCalls[0].narration, null, label);
      assert.equal(env.composeCalls[0].nativeAudioMode, "mute", `${label}: no native speech may leak into the final media`);
      assert.equal(env.soundtrackCalls.length, Number(withMusic), label);
      assert.equal(env.composeCalls[0].soundtrack, withMusic ? soundtrack : null, `${label}: requested music reaches composition`);
      assert.equal(env.seedCalls.length, engine === "grok" || engine === "grok-lite" ? 1 : 0, label);
      assert.equal(env.saved.length, 1, label);
    }
  }
});

test("all other free engines prepare one TTS before video and mute native audio; guided narration is unchanged", async () => {
  for (const engine of ["omni", "veo", "veo-lite", "minimax-h3", "wan3", "wan-flash", "heygen"] as const) {
    const env = harness(), original = request(engine, { durationSeconds: 8, videoResolution: engine === "minimax-h3" || engine === "heygen" ? "768p" : "720p" });
    const before = structuredClone(original);
    await env.generate(original);
    assert.deepEqual(original, before);
    assert.equal(env.ttsCalls.length, 1, engine); assert.equal((env.videoCalls[0].request as contracts.AiMediaGenerationRequest).withNarration, false, engine);
    assert.equal(env.seedCalls.length, 0, engine);
    assert.equal(env.videoCalls[0].nativeNarrationLines, undefined);
    assert.deepEqual(env.events, ["copy", "tts", "audio-preflight", "video", "compose", "save"]);
    assert.equal(env.composeCalls[0].narration, audio);
    assert.equal(env.composeCalls[0].nativeAudioMode, "mute");
    assert.equal((env.contractCalls[0].request as contracts.AiMediaGenerationRequest).withNarration, false);
    assert.equal(env.videoCalls[0].canonicalPromptSha256, createHash("sha256").update(canonicalPrompt).digest("hex"));
    const failed = harness("tts");
    await assert.rejects(failed.generate(original), /ai_media_narration_unavailable/u);
    assert.equal(failed.videoCalls.length, 0);
    assert.equal(failed.saved.length, 0);
    const talking = harness();
    await talking.generate({ ...original, teamVideoSpeechMode: "characters", withNarration: false });
    assert.equal(talking.ttsCalls.length, 0);
    assert.equal(talking.composeCalls[0].narration, null);
    assert.equal(talking.composeCalls[0].nativeAudioMode, "dialogue");
  }
  const env = harness(); await env.generate(request("grok", { creationMode: "guided", inputMode: "essential", subjectSource: "custom", idea: "Une céramiste façonne un vase.", textMode: "none", withText: false, logoMode: "none" }));
  assert.equal(env.ttsCalls.length, 1); assert.equal((env.videoCalls[0].request as contracts.AiMediaGenerationRequest).withNarration, true);
  assert.equal(env.seedCalls.length, 0);
});

test("controlled Grok frame retains reference roles and leaves the professional's inputs intact", async () => {
  const env = harness();
  const original = request("grok-lite", { inspirationImages: [{ mimeType: "image/png", data: "A".repeat(88), role: "product", usage: "required" }] });
  const before = structuredClone(original); await env.generate(original);
  assert.deepEqual(original, before);
  assert.deepEqual(env.seedCalls[0].identityReferences, [Buffer.from("sanitized-reference")]);
  assert.deepEqual(env.seedCalls[0].referenceRoles, [{ role: "product", usage: "required", characterIndex: undefined }]);
  assert.equal((env.videoCalls[0].request as contracts.AiMediaGenerationRequest).inspirationImages.length, 1);
  assert.equal((env.videoCalls[0].request as contracts.AiMediaGenerationRequest).inspirationImages[0].data, "synthetic-normalized-seed");
});

test("a required character reaches the initial-frame composer and stays the authoritative animation reference", async () => {
  const env = harness();
  const original = request("grok-lite", { identityConsent: true, identityReferenceSetId: "test-identity-reference",
    inspirationImages: [{ mimeType: "image/png", data: "A".repeat(88), role: "character", usage: "required", characterIndex: 1 }] });
  const before = structuredClone(original); await env.generate(original);
  assert.deepEqual(original, before);
  assert.equal(original.identityMode, "professional");
  assert.deepEqual(env.seedCalls[0].referenceRoles, [{ role: "character", usage: "required", characterIndex: 1 }]);
  const providerRequest = env.videoCalls[0].request as contracts.AiMediaGenerationRequest;
  assert.equal(providerRequest.identityMode, original.identityMode); assert.equal(providerRequest.identityConsent, true);
  assert.deepEqual(providerRequest.inspirationImages, [{ data: "synthetic-normalized-seed", mimeType: "image/png", role: "character", usage: "required" }]);
});

test("other free engines retain their existing reference-frame Google fallback", async () => {
  const env = harness("seed");
  await assert.rejects(env.generate(request("veo", { durationSeconds: 8,
    inspirationImages: [{ mimeType: "image/png", data: "A".repeat(88), role: "product", usage: "required" }] })), /synthetic-seed-fallback-unavailable/u);
  assert.equal(env.seedCalls.length, 1); assert.equal(env.googleFallbackCalls.length, 1);
  assert.equal(env.videoCalls.length, 0); assert.equal(env.saved.length, 0);
});
