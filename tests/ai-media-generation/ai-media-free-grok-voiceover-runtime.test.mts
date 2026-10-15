import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import { needsControlledAiMediaFreeFirstFrame, usesSeparateAiMediaFreeVoiceover } from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import * as sensitive from "../../lib/aiMediaSensitiveText.ts";
import { getAiMediaFreeBrandPolicy } from "../../lib/aiMediaFreeGenerationPrompt.ts";

type Row = Record<string, unknown>;
const script = "Dans cet atelier, chaque vase prend doucement forme entre les mains de la céramiste.";
const canonicalPrompt = "Canonical professional request with its original narration choice.";
const narration = { script, language: "fr", wordCount: script.split(/\s+/u).length, source: "ai",
  sha256: createHash("sha256").update(script).digest("hex") };
const audio = { buffer: Buffer.from("synthetic-tts"), mimeType: "audio/wav", extension: "wav", model: "test-tts", voice: "Puck" };

function request(engine: contracts.AiMediaVideoEngine, overrides: Row = {}) {
  return contracts.normalizeAiMediaGenerationRequest({ requestId: "separate-free-voiceover-test", source: "studio", operation: "generate",
    creationMode: "free", kind: "video", format: "story", videoEngine: engine, videoResolution: "720p", durationSeconds: 15,
    sceneMode: "single", teamVideoSpeechMode: "voiceover", withNarration: true, narrationVoice: "male", narrationVoiceVariant: "Puck",
    withMusic: false, freePrompt: `Une céramiste façonne un vase. Voix off exacte : « ${script} »`, ...overrides });
}

function harness(failure?: "tts" | "audio-preflight" | "seed", withOfficialIdentity = false) {
  const events: string[] = [], videoCalls: Row[] = [], ttsCalls: Row[] = [], composeCalls: Row[] = [], saved: Row[] = [], contractCalls: Row[] = [], seedCalls: Row[] = [], googleFallbackCalls: Row[] = [];
  const profile = { business: { companyName: "Atelier", professionLabel: "Céramiste", sectorLabel: "Artisanat", phone: "" }, preferences: { language: "fr" } };
  const plan = { companyName: "Atelier", headline: "", cta: "", subline: "Une céramiste façonne un vase.",
    scenes: [{ eyebrow: "", title: "", body: "", visualBrief: "Une céramiste façonne un vase.", spokenLine: "Bonjour, je façonne un vase.", layout: "editorial" }] };
  const normalized = { kind: "video", buffer: Buffer.from("synthetic-composed-video"), mimeType: "video/mp4", extension: "mp4", width: 720, height: 1280, durationSeconds: 15 };
  const freeNarration = async (args: { request: contracts.AiMediaGenerationRequest }) => {
    if (!args.request.withNarration || args.request.teamVideoSpeechMode === "characters") return null;
    events.push("copy"); return narration;
  };
  const modules = new Map<string, unknown>();
  for (const name of ["aiMediaImageContactComposer", "aiMediaCopywriter", "aiMediaGateway", "aiMediaImageProviderRequest", "aiMediaReferenceTeam",
    "aiMediaGenerationSoundtracks", "aiMediaNormalizer", "aiVideoReliability"]) modules.set(`@/lib/${name}`, {});
  const entries: Array<[string, unknown]> = [
    ["server-only", {}], ["sharp", () => ({ png() { return this; }, toBuffer: async () => Buffer.from("transparent-overlay") })],
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
      getAiMediaFreeBrandPolicy, splitAiMediaFreeNarrationByScene: () => [script],
      buildAiMediaFreeSceneFramePrompt: () => "One controlled full-frame initial instant, no storyboard.",
      resolveAiMediaFreeDialogueSequence: () => ["Bonjour, je façonne un vase."] }],
    ["@/lib/aiMediaFreeVoiceoverPolicy", { needsControlledAiMediaFreeFirstFrame, usesSeparateAiMediaFreeVoiceover }],
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
    ["@/lib/aiMediaReferenceTeam", { prepareReferenceTeamCompositionForAnimation: async () => {
      events.push("seed-normalize"); return { data: "synthetic-normalized-seed", mimeType: "image/png" };
    } }],
    ["@/lib/aiMediaGeneratedVideo", { AiMediaNarrationTooLongError: class extends Error {}, prepareAiMediaNarrationAudioForVideo: async (args: { audio: Row }) => {
      events.push("audio-preflight"); if (failure === "audio-preflight") throw new Error("synthetic-audio-unusable");
      return { audio: args.audio, silenceCompacted: false };
    }, composeOriginalAiVideo: async (args: Row) => { events.push("compose"); composeCalls.push(args); return normalized; } }],
    ["@/lib/aiMediaVideoLayout", { AI_MEDIA_VIDEO_TEXT_LAYOUT: "test-full-frame" }],
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
      return { provider: "vercel-ai-gateway", model: "test-grok", warnings: [], estimatedCostMicroUsd: 0,
        clips: [{ buffer: Buffer.from("synthetic-native-video"), mediaType: "video/mp4", requestId: "test-provider-request", durationSeconds: 15, sourceStartSeconds: 0 }] };
    } }],
    ["@/lib/aiVideoProviderTypes", { isAiVideoProviderBillableFailure: () => false }],
    ["@/lib/aiMediaGenerationQuotaPolicy", { getAiMediaVideoMaxDuration: () => 30 }],
    ["@/lib/aiMediaCreditQuoteServer", { quoteAiMediaRequest: (_id: string, original: contracts.AiMediaGenerationRequest) => ({ withNarration: original.withNarration }) }],
    ["@/lib/aiMediaVideoTimeline", { getAiMediaVideoSegmentDurations: () => [15] }],
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
  return { events, videoCalls, ttsCalls, composeCalls, saved, contractCalls, seedCalls, googleFallbackCalls,
    generate: (original: contracts.AiMediaGenerationRequest) => moduleRecord.exports.generateAndSaveAiMedia({ request: original, accountId: "test-account", authUserId: "test-actor", jobId: "test-job", supabase: {} }) };
}

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

test("separate narration policy is limited to free Grok video, never characters or transforms", () => {
  for (const videoEngine of ["grok", "grok-lite", "omni", "veo", "veo-lite", "minimax-h3", "wan3", "wan-flash"] as const) {
    const base = { ...request("grok"), videoEngine };
    assert.equal(usesSeparateAiMediaFreeVoiceover(base), videoEngine === "grok" || videoEngine === "grok-lite", videoEngine);
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
    assert.equal(env.videoCalls[0].nativeNarrationLines, undefined); assert.equal(env.composeCalls[0].nativeAudioMode, "ambience");
  });
}

test("other free engines preserve their native narration and guided Grok keeps its existing TTS", async () => {
  for (const engine of ["omni", "veo", "veo-lite", "minimax-h3", "wan3", "wan-flash"] as const) {
    const env = harness(), original = request(engine, { durationSeconds: 8, videoResolution: engine === "minimax-h3" ? "768p" : "720p" });
    await env.generate(original);
    assert.equal(env.ttsCalls.length, 0, engine); assert.equal((env.videoCalls[0].request as contracts.AiMediaGenerationRequest).withNarration, true, engine);
    assert.equal(env.seedCalls.length, 0, engine);
    assert.deepEqual(env.videoCalls[0].nativeNarrationLines, [script]); assert.equal(env.composeCalls[0].nativeAudioMode, "dialogue");
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
