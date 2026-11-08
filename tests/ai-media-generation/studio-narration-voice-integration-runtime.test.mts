import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { getAiMediaGenerationPublicError } from "../../lib/aiMediaGenerationPublicErrors.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import { buildGenerationAttemptKey } from "../../lib/mediaGenerationClientRequest.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { quoteAiMediaCredits } from "../../lib/aiMediaCreditsPricing.ts";

const nativeFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error("No live provider call is allowed in narration integration tests"); }; });
test.after(() => { globalThis.fetch = nativeFetch; });

const accountId = "account-narrator-a";
const now = Date.now();
const path = (account = accountId, time = now) => `_studio-voice-references/${new Date(time).toISOString().slice(0, 10)}/${account}__${time}__11111111-1111-4111-8111-111111111111.wav`;
function wav(seconds = 6) {
  const buffer = Buffer.alloc(44 + seconds * 32_000);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVE", 8); buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(32_000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}
const sample = (overrides: Record<string, unknown> = {}) => ({ path: path(), name: "ma-voix.wav", mimeType: "audio/wav", durationSeconds: 6, sizeBytes: wav().length, ...overrides });
const input = { requestId: "narrator-without-photo-0001", source: "studio", creationMode: "free", kind: "video", format: "landscape", videoEngine: "omni", durationSeconds: 8,
  freePrompt: "Une promenade dans un jardin lumineux.", spokenScript: "Bonjour, voici un jardin agréable au quotidien.", withNarration: true, teamVideoSpeechMode: "voiceover",
  narrationVoiceMode: "provided", narrationVoiceSample: sample(), narrationVoiceConsent: true, narrationVoiceGender: "auto" };
const normalize = (patch: Record<string, unknown> = {}) => contracts.normalizeAiMediaGenerationRequest({ ...input, ...patch });
const providerPolicy = runtimeModules({ "@/lib/aiGatewayAccountGuard": {} })<typeof import("../../lib/aiMediaNarrationVoiceClone.ts")>("lib/aiMediaNarrationVoiceClone.ts");

function referenceFixture(options: { configured?: boolean; publicBucket?: boolean; actualSeconds?: number; corrupt?: boolean } = {}) {
  let bucketReads = 0, downloads = 0;
  const buffer = options.corrupt ? Buffer.from("not a WAV") : wav(options.actualSeconds ?? 6);
  const load = runtimeModules({
    "./aiMediaGenerationContracts.ts": contracts,
    "@/lib/supabaseAdmin": { supabaseAdmin: { storage: {
      getBucket: async () => { bucketReads++; return { data: { public: options.publicBucket === true }, error: null }; },
      from: () => ({ download: async () => { downloads++; return { data: new Blob([Uint8Array.from(buffer)]), error: null }; } }),
    } } },
    "./aiMediaNarrationVoiceClone.ts": { isAiMediaVoiceCloneConfigured: () => options.configured !== false, supportsAiMediaClonedNarrationLanguage: providerPolicy.supportsAiMediaClonedNarrationLanguage },
  });
  const api = load<typeof import("../../lib/aiMediaNarrationVoicePreflight.ts")>("lib/aiMediaNarrationVoicePreflight.ts");
  return { api, buffer, get bucketReads() { return bucketReads; }, get downloads() { return downloads; } };
}

test("a supplied narrator speaks new Exact words without a photo or a character-only engine", () => {
  for (const narrationVoiceGender of ["auto", "female", "male"]) {
    const request = normalize({ narrationVoiceGender });
    assert.equal(request.narrationVoiceMode, "provided"); assert.equal(request.narrationVoiceSample?.path, path());
    assert.equal(request.videoEngine, "omni"); assert.equal(request.identityMode, "auto"); assert.deepEqual(request.inspirationImages, []);
    assert.equal(request.spokenScript, input.spokenScript); assert.equal(request.narrationVoiceGender, narrationVoiceGender);
    assert.equal(request.narrationVoiceConsent, true);
  }
  const shortFilm = normalize({ videoEngine: "grok", durationSeconds: 4, spokenScript: "Bonjour à tous." });
  assert.equal(shortFilm.durationSeconds, 4); assert.equal(shortFilm.narrationVoiceSample?.durationSeconds, 6, "a reference is cloned, never replayed or constrained to the film duration");
});

test("invalid narrator choices and missing human consent fail before storage, credits or synthesis", () => {
  for (const patch of [{ narrationVoiceMode: "replay" }, { narrationVoiceGender: "invented" }, { narrationVoiceConsent: false }, { narrationVoiceConsent: undefined },
    { narrationVoiceSample: null }, { narrationVoiceSample: sample({ durationSeconds: 2 }) }, { narrationVoiceSample: { path: "https://foreign.invalid/audio.wav" } }, { spokenScript: "" }]) {
    assert.throws(() => normalize(patch), contracts.AiMediaRequestValidationError);
  }
});

test("Auto text and legacy AI voice requests remain valid while inactive narrator references are not submitted as speech", () => {
  const automatic = normalize({ spokenScript: undefined }); assert.equal(automatic.spokenScript, undefined); assert.equal(automatic.narrationVoiceMode, "provided");
  const legacy = normalize({ narrationVoiceMode: undefined, narrationVoiceSample: undefined, narrationVoiceConsent: undefined });
  assert.equal(legacy.narrationVoiceMode, "ai"); assert.equal(legacy.narrationVoiceSample, null);
  for (const patch of [{ withNarration: false, spokenScript: undefined }, { teamVideoSpeechMode: "characters", spokenScript: "Bonjour." }, { kind: "image", spokenScript: undefined }]) {
    const request = normalize(patch); assert.equal(request.narrationVoiceMode, "ai"); assert.equal(request.narrationVoiceSample, null); assert.equal(request.narrationVoiceConsent, false);
  }
});

test("the server limits active supplied character voices to three including optional inspiration photos and legacy input", () => {
  const references = Array.from({ length: 5 }, (_, index) => ({ mimeType: "image/png", data: "a".repeat(96), role: "character", usage: "inspiration",
    characterIndex: index % 3 + 1, voiceMode: "provided", voiceSample: sample({ path: path(`account-source-${index}`), durationSeconds: 4, sizeBytes: 128_044 }) }));
  for (const creationMode of ["free", "guided"]) {
    const patch = { creationMode, videoEngine: "wan27", teamVideoMode: "cinematic", teamVideoSpeechMode: "characters", withNarration: false, identityConsent: true, teamVideoProviderConsent: true,
      peopleMode: "team", idea: "Une équipe dans un jardin.", inspirationImages: references.slice(0, 3) };
    assert.equal(normalize(patch).inspirationImages.filter(reference => reference.voiceMode === "provided").length, 3);
    for (const count of [4, 5]) assert.throws(() => normalize({ ...patch, inspirationImages: references.slice(0, count) }), /maximum trois vocaux/);
  }
});

test("the real private narrator preflight checks ownership expiry canonical WAV and measured duration without a signed URL", async () => {
  const good = referenceFixture();
  const prepared = await good.api.preflightAiMediaNarrationVoice({ accountId, sample: normalize().narrationVoiceSample, consent: true, language: "fr" });
  assert.equal(prepared.accountId, accountId); assert.equal(prepared.path, path()); assert.equal(prepared.language, "fr"); assert.deepEqual(prepared.buffer, good.buffer);
  assert.equal(good.downloads, 1); assert.equal(prepared.durationSeconds, 6);
  for (const invalidPath of [path("another-account"), path(accountId, now - 25 * 3600_000)]) {
    const fixture = referenceFixture();
    await assert.rejects(fixture.api.preflightAiMediaNarrationVoice({ accountId, sample: sample({ path: invalidPath }) as contracts.AiMediaGenerationRequest["narrationVoiceSample"], consent: true, language: "fr" }), contracts.AiMediaRequestValidationError);
    assert.equal(fixture.bucketReads, 0); assert.equal(fixture.downloads, 0);
  }
  for (const options of [{ actualSeconds: 2 }, { corrupt: true }, { publicBucket: true }]) {
    const fixture = referenceFixture(options);
    await assert.rejects(fixture.api.preflightAiMediaNarrationVoice({ accountId, sample: normalize().narrationVoiceSample, consent: true, language: "fr" }), contracts.AiMediaRequestValidationError);
  }
});

test("unconfigured cloning and an unsupported language stop before reading or charging for the reference", async () => {
  for (const [configured, language] of [[false, "fr"], [true, "th"]] as const) {
    const fixture = referenceFixture({ configured });
    await assert.rejects(fixture.api.preflightAiMediaNarrationVoice({ accountId, sample: normalize().narrationVoiceSample, consent: true, language }), contracts.AiMediaRequestValidationError);
    assert.equal(fixture.bucketReads, 0); assert.equal(fixture.downloads, 0);
  }
  const f = referenceFixture();
  assert.equal(f.api.resolveAiMediaNarrationVoiceLanguage({ profile: { ai_language: "fr" }, business: { ai_language: "de" }, request: normalize({ spokenScript: undefined }) }), "de");
  assert.equal(f.api.resolveAiMediaNarrationVoiceLanguage({ profile: { ai_language: "fr" }, business: { ai_language: "th" }, request: normalize({ freePrompt: "Une scène calme, narration en anglais.", spokenScript: "Welcome to our garden." }) }), "en");
});

function preparationFixture(options: { exact?: boolean; cloneFails?: boolean; cloneError?: Error; cloneErrorOnCall?: number; preflightError?: Error; abortOnFirstCheck?: boolean; onFirstCheck?: () => void; tooLongOnce?: boolean; tooLongAlways?: boolean; prepared?: boolean; script?: string; durationSeconds?: number; voiceMode?: "provided" | "ai"; free?: boolean; source?: "studio" | "booster" } = {}) {
  const cloneCalls: Array<Record<string, unknown>> = [], copyCalls: Array<Record<string, unknown>> = [], checkCalls: Array<Record<string, unknown>> = [];
  const stages: string[] = [], receivedAudio: unknown[] = [];
  const controller = new AbortController(), cancellation = new Error("cancelled-after-received-clone");
  let aiCalls = 0, checks = 0;
  class TooLong extends Error { requiredTempo = 1.8; }
  const request = normalize({ spokenScript: options.exact === false ? undefined : options.script ?? input.spokenScript, durationSeconds: options.durationSeconds ?? 8, narrationVoiceMode: options.voiceMode ?? "provided" });
  if (options.source) request.source = options.source;
  const reference = { accountId, path: path(), buffer: wav(), durationSeconds: 6, language: "fr" };
  const load = runtimeModules({
    "@/lib/aiMediaFreeGenerationPlan": { writeAiMediaFreeNarration: async (args: Record<string, unknown>) => {
      copyCalls.push(args);
      const script = copyCalls.length === 1 ? options.script ?? input.spokenScript : "Bonjour, notre jardin.";
      return { script, language: "fr", wordCount: script.split(/\s+/).length, source: "ai", sha256: createHash("sha256").update(script).digest("hex") };
    } },
    "@/lib/aiMediaNarration": { writeAiMediaNarration: async () => assert.fail("Free narration must use its existing copywriter") },
    "@/lib/aiMediaNarrationAudio": { generateAiMediaNarrationAudio: async () => { aiCalls++; assert.equal(options.voiceMode, "ai", "A provided voice must never fall back to a predefined Gemini voice"); return { buffer: wav(), voice: "female" }; } },
    "./aiMediaNarrationVoiceClone.ts": { generateAiMediaClonedNarrationAudio: async (args: Record<string, unknown>) => {
      cloneCalls.push(args); if (options.cloneFails) throw new Error("synthetic_clone_failure");
      if (options.cloneError && cloneCalls.length === (options.cloneErrorOnCall ?? 1)) throw options.cloneError;
      const audio = { buffer: wav(), mimeType: "audio/wav", extension: "wav", model: "fal-ai/chatterbox/text-to-speech/multilingual", voice: "provided" };
      receivedAudio.push(audio); return audio;
    }, AI_MEDIA_CLONED_NARRATION_TIMEOUT_MS: 240_000 },
    "@/lib/aiMediaGeneratedVideo": { AiMediaNarrationTooLongError: TooLong, prepareAiMediaNarrationAudioForVideo: async (args: { audio: unknown }) => {
      checkCalls.push(args);
      if (checks === 0) options.onFirstCheck?.();
      if (options.abortOnFirstCheck && checks === 0) controller.abort(cancellation);
      if (options.preflightError) throw options.preflightError;
      checks++; if (options.tooLongAlways || options.tooLongOnce && checks === 1) throw new TooLong("too long");
      return { audio: args.audio, silenceCompacted: false };
    } },
  });
  const api = load<typeof import("../../lib/aiMediaNarrationPreparation.ts")>("lib/aiMediaNarrationPreparation.ts");
  const prepared = options.prepared ? { script: options.script ?? input.spokenScript, language: "fr", wordCount: 8, source: "ai" as const, sha256: "exact-cached-sha" } : null;
  return { request, reference, cloneCalls, copyCalls, checkCalls, stages, receivedAudio, prepared, cancellation, get aiCalls() { return aiCalls; },
    run: () => api.prepareAiMediaNarration({ context: { accountId, signal: controller.signal }, narrationRequest: request, preparedNativeNarration: prepared, isFreeCreation: options.free !== false,
      profile: {} as Parameters<typeof api.prepareAiMediaNarration>[0]["profile"], creativePlan: {} as Parameters<typeof api.prepareAiMediaNarration>[0]["creativePlan"],
      businessDnaContext: undefined, recentPublications: [], durationSeconds: options.durationSeconds ?? 8, narrationSignal: controller.signal, providedVoice: reference,
      measure: async (stage, action) => { stages.push(stage); return action(); },
    }) };
}

test("the real narration preparation sends new words and the owned reference to the clone provider and retains measured audio", async () => {
  const f = preparationFixture(); const result = await f.run();
  assert.equal(f.cloneCalls.length, 1); assert.equal(f.cloneCalls[0].reference, f.reference);
  assert.equal((f.cloneCalls[0].narration as { script: string }).script, input.spokenScript); assert.equal(f.cloneCalls[0].narrationVoiceConsent, true);
  assert.equal(result.audio?.voice, "provided"); assert.equal(result.narration?.script, input.spokenScript); assert.equal(f.aiCalls, 0);
});

test("a failed clone never becomes an unrelated voice or another paid synthesis", async () => {
    const f = preparationFixture({ cloneFails: true }); await assert.rejects(f.run(), /ai_media_narration_unavailable/);
    assert.equal(f.cloneCalls.length, 1); assert.equal(f.copyCalls.length, 1); assert.equal(f.aiCalls, 0);
    assert.equal((f.cloneCalls[0].narration as { script: string }).script, input.spokenScript);
});

test("Auto can make one genuinely shorter rewrite after a completed too-long clone while keeping the same owned voice", async () => {
  const f = preparationFixture({ exact: false, tooLongOnce: true }); const result = await f.run();
  assert.equal(f.cloneCalls.length, 2); assert.ok(Number(f.copyCalls[1].maximumSpeechUnits) > 0);
  assert.notEqual((f.cloneCalls[0].narration as { script: string }).script, (f.cloneCalls[1].narration as { script: string }).script);
  assert.equal(f.cloneCalls[0].reference, f.cloneCalls[1].reference); assert.equal(result.audio?.voice, "provided"); assert.equal(f.aiCalls, 0);
});

test("the narrator reference participates in client idempotency without changing legacy AI keys", () => {
  const base = { source: "studio", kind: "video", format: "landscape", subjectSource: "custom", idea: "Un jardin.", withNarration: true, teamVideoSpeechMode: "voiceover", imageStyle: "photo", peopleMode: "none", useBrandColors: false, logoMode: "none", textKeywords: [] } as const;
  const key = (patch: Record<string, unknown>) => buildGenerationAttemptKey({ ...base, textKeywords: [], ...patch }, base.idea);
  assert.equal(key({}), key({ narrationVoiceMode: "ai", narrationVoiceSample: sample() }));
  assert.notEqual(key({ narrationVoiceMode: "provided", narrationVoiceSample: sample() }), key({ narrationVoiceMode: "provided", narrationVoiceSample: sample({ path: path("another-account") }) }));
});

test("the actual route validates the private narrator before credit reservation and the server waits for narration before video", () => {
  const route = readFileSync(new URL("../../app/api/media-generation/generate/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("preparedNarrationVoice = await preflightAiMediaNarrationVoice") < route.indexOf("const reservation = await reserveAiMediaGeneration"));
  const server = ts.createSourceFile("server.ts", readFileSync(new URL("../../lib/aiMediaGenerationServer.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  let narrationWait = -1, videoStart = -1;
  const walk = (node: ts.Node) => {
    if (ts.isAwaitExpression(node) && node.expression.getText(server) === "narrationTask") narrationWait = node.getStart(server);
    if (ts.isVariableDeclaration(node) && node.name.getText(server) === "videoGatewayTask") videoStart = node.getStart(server);
    ts.forEachChild(node, walk);
  }; walk(server); assert.ok(narrationWait >= 0 && videoStart > narrationWait);
});


test("two fitting Exact clones rejected by duration stop after two syntheses with the dedicated output error", async () => {
  const script = "Bonjour, nous vous aidons à créer un jardin agréable, adapté à vos envies.";
  assert.equal(script.length, 74); assert.equal(script.split(/\s+/u).length, 13);
  const f = preparationFixture({ script, durationSeconds: 10, tooLongAlways: true });
  await assert.rejects(f.run(), (error: unknown) => {
    const failure = getAiMediaGenerationPublicError(error);
    assert.equal(failure.code, "AI_MEDIA_VOICE_CLONE_DURATION_INVALID"); assert.equal(failure.status, 502);
    assert.doesNotMatch(failure.message, /raccourci|plus longue|réessay|relanc/i);
    const wrapped = error as Error & { cause?: Error & { cause?: Error } };
    assert.equal(wrapped.cause?.message, "ai_media_voice_clone_duration_invalid");
    assert.match(wrapped.cause?.cause?.message || "", /too long/);
    return true;
  });
  assert.equal(f.cloneCalls.length, 2); assert.equal(f.copyCalls.length, 1); assert.equal(f.aiCalls, 0);
  assert.equal((f.cloneCalls[0].narration as { script: string }).script, script);
  assert.equal(f.cloneCalls[0].narration, f.cloneCalls[1].narration);
  assert.equal(f.cloneCalls[0].reference, f.cloneCalls[1].reference);
});

test("one completed duration-rejected Exact clone retries identical copy and vocal once, without editor, video or quote change", async () => {
  const f = preparationFixture({ tooLongOnce: true });
  const quote = quoteAiMediaCredits({ ...f.request, inspirationImagesCount: 0 });
  const result = await f.run();
  assert.equal(f.cloneCalls.length, 2); assert.equal(f.copyCalls.length, 1); assert.equal(f.aiCalls, 0);
  assert.equal(f.cloneCalls[0].narration, f.cloneCalls[1].narration);
  assert.equal((f.cloneCalls[1].narration as { script: string }).script, input.spokenScript);
  assert.equal(f.cloneCalls[0].reference, f.cloneCalls[1].reference);
  assert.equal(f.cloneCalls[0].signal, f.cloneCalls[1].signal);
  assert.equal(f.checkCalls[0].signal, f.cloneCalls[0].signal); assert.equal(f.checkCalls[1].signal, f.cloneCalls[1].signal);
  assert.equal(result.audio, f.receivedAudio[1]);
  assert.deepEqual(f.stages, ["narration_copy", "narration_audio", "narration_audio_preflight", "narration_audio_quality_retry_1", "narration_audio_preflight_quality_retry_1"]);
  assert.deepEqual(quoteAiMediaCredits({ ...f.request, inspirationImagesCount: 0 }), quote);
});

test("already prepared Exact copy is reused by both synthesis attempts without another editorial call", async () => {
  const f = preparationFixture({ tooLongOnce: true, prepared: true }); const result = await f.run();
  assert.equal(f.copyCalls.length, 0); assert.equal(f.cloneCalls.length, 2);
  assert.equal(f.cloneCalls[0].narration, f.prepared); assert.equal(f.cloneCalls[1].narration, f.prepared);
  assert.equal(result.narration, f.prepared); assert.ok(f.stages.every(stage => !stage.includes("copy") && !stage.includes("rewrite")));
});

test("timeout, transport uncertainty and synthesis failure never enter the duration-only retry", async () => {
  for (const cloneError of [new DOMException("request timed out", "TimeoutError"), new TypeError("network failure"), new Error("ai_media_voice_clone_provider_http_503")]) {
    const f = preparationFixture({ cloneError }); await assert.rejects(f.run());
    assert.equal(f.cloneCalls.length, 1); assert.equal(f.checkCalls.length, 0); assert.equal(f.copyCalls.length, 1); assert.equal(f.aiCalls, 0);
  }
  const f = preparationFixture({ preflightError: new Error("local decoder failed") }); await assert.rejects(f.run());
  assert.equal(f.cloneCalls.length, 1); assert.equal(f.checkCalls.length, 1);
});

test("an uncertain second synthesis fails without a third attempt or rewriting Exact speech", async () => {
  const f = preparationFixture({ tooLongOnce: true, cloneError: new TypeError("network uncertainty"), cloneErrorOnCall: 2 });
  await assert.rejects(f.run()); assert.equal(f.cloneCalls.length, 2); assert.equal(f.copyCalls.length, 1); assert.equal(f.checkCalls.length, 1);
});

test("caller cancellation after the received first clone forbids the quality retry", async () => {
  const f = preparationFixture({ tooLongOnce: true, abortOnFirstCheck: true });
  await assert.rejects(f.run(), error => error === f.cancellation);
  assert.equal(f.cloneCalls.length, 1); assert.equal(f.copyCalls.length, 1); assert.equal(f.aiCalls, 0);
});

test("both Exact clone attempts share one original240s budget and exhaustion prevents another synthesis", async () => {
  const originalTimeout = AbortSignal.timeout, durations: number[] = [];
  try {
    AbortSignal.timeout = milliseconds => { durations.push(milliseconds); return new AbortController().signal; };
    const success = preparationFixture({ tooLongOnce: true }); await success.run();
    assert.deepEqual(durations, [240_000]);
    assert.equal(success.cloneCalls[0].signal, success.cloneCalls[1].signal);
    AbortSignal.timeout = () => AbortSignal.abort(new DOMException("quality budget exhausted", "TimeoutError"));
    const expired = preparationFixture(); await assert.rejects(expired.run());
    assert.equal(expired.copyCalls.length, 1);
    assert.equal(expired.cloneCalls.length, 0, "an exhausted shared budget must not submit even its first synthesis");
    const elapsed = new AbortController();
    AbortSignal.timeout = () => elapsed.signal;
    const exhaustedAfterReception = preparationFixture({ tooLongOnce: true, onFirstCheck: () => elapsed.abort(new DOMException("quality budget exhausted", "TimeoutError")) });
    await assert.rejects(exhaustedAfterReception.run());
    assert.equal(exhaustedAfterReception.cloneCalls.length, 1); assert.equal(exhaustedAfterReception.copyCalls.length, 1);
  } finally { AbortSignal.timeout = originalTimeout; }
});

test("a genuinely over-budget Exact script keeps its existing length classification", async () => {
  const script = Array.from({ length: 20 }, () => "bonjour").join(" ");
  assert.throws(() => normalize({ spokenScript: script, durationSeconds: 10 }), (error: unknown) => {
    assert.equal(getAiMediaGenerationPublicError(error).code, "AI_MEDIA_EXACT_NARRATION_TOO_LONG");
    assert.doesNotMatch(String(error), /voice_clone_duration_invalid/); return true;
  });
});

test("an AI voice never inherits the provided-voice duration classification", async () => {
  const f = preparationFixture({ voiceMode: "ai", tooLongAlways: true });
  await assert.rejects(f.run(), (error: unknown) => {
    assert.notEqual(getAiMediaGenerationPublicError(error).code, "AI_MEDIA_VOICE_CLONE_DURATION_INVALID"); return true;
  });
  assert.equal(f.cloneCalls.length, 0); assert.equal(f.aiCalls, 3); assert.equal(f.copyCalls.length, 3);
});

test("provided narration outside Studio free keeps the existing error path", async () => {
  const f = preparationFixture({ source: "booster", tooLongAlways: true });
  await assert.rejects(f.run(), (error: unknown) => {
    assert.notEqual(getAiMediaGenerationPublicError(error).code, "AI_MEDIA_VOICE_CLONE_DURATION_INVALID"); return true;
  });
  assert.equal(f.cloneCalls.length, 1); assert.equal(f.copyCalls.length, 1); assert.equal(f.aiCalls, 0);
});

test("a guided provided Exact narration keeps one synthesis and no quality retry", async () => {
  const f = preparationFixture({ free: false, prepared: true, tooLongAlways: true });
  await assert.rejects(f.run(), (error: unknown) => {
    assert.notEqual(getAiMediaGenerationPublicError(error).code, "AI_MEDIA_VOICE_CLONE_DURATION_INVALID"); return true;
  });
  assert.equal(f.cloneCalls.length, 1); assert.equal(f.copyCalls.length, 0); assert.equal(f.aiCalls, 0);
  assert.ok(f.stages.every(stage => !stage.includes("quality_retry")));
});
