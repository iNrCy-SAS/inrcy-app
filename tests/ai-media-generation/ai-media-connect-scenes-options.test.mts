import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";
import * as mediaModels from "../../lib/aiMediaModelCatalog.ts";
import * as mediaTransport from "../../lib/aiMediaGenerationTransport.ts";
import * as mediaRecovery from "../../lib/aiMediaGenerationRecovery.ts";
import * as characterVoices from "../../lib/aiMediaCharacterVoiceClient.ts";

import type { MediaGenerationRequest } from "../../app/dashboard/_hooks/useMediaGeneration.ts";
import {
  AiMediaRequestValidationError,
  normalizeAiMediaGenerationRequest,
  shouldConnectAiMediaVideoScenes,
} from "../../lib/aiMediaGenerationContracts.ts";

function clientRequest(overrides: Partial<MediaGenerationRequest> = {}): MediaGenerationRequest {
  return {
    kind: "video",
    subjectSource: "custom",
    idea: "Présenter notre nouvelle collection",
    textKeywords: [],
    format: "square",
    typology: "showcase",
    visualStyle: "brand",
    imageStyle: "photo",
    shotType: "auto",
    peopleMode: "auto",
    creativity: "faithful",
    useBrandColors: true,
    logoMode: "discreet",
    durationSeconds: 16,
    source: "studio",
    ...overrides,
  };
}

function normalize(overrides: Record<string, unknown> = {}) {
  return normalizeAiMediaGenerationRequest({
    ...clientRequest(),
    requestId: "connect-scenes-test-request",
    ...overrides,
  });
}

type HookRuntime = {
  default: () => { generate: (request: MediaGenerationRequest) => Promise<unknown> };
  fingerprintForTest: (request: MediaGenerationRequest, idea: string) => string;
};

/** Execute the real serializer and retry path without React effects or network. */
function hookRuntime() {
  const source = readFileSync(
    new URL("../../app/dashboard/_hooks/useMediaGeneration.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(
    `${source}\nexport { buildGenerationAttemptKey as fingerprintForTest };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const requests: Record<string, unknown>[] = [];
  const moduleRecord = { exports: {} };
  const runtimeRequire = (specifier: string) => {
    if (specifier === "react") {
      return {
        useCallback: (callback: unknown) => callback,
        useEffect: () => undefined,
        useRef: (initial: unknown) => ({ current: initial }),
        useState: (initial: unknown) => [initial, () => undefined],
      };
    }
    if (specifier === "@/lib/multicompte/constants") {
      return { ACTIVE_INRCY_ACCOUNT_EVENT: "fixture-account-change" };
    }
    if (specifier === "@/lib/aiMediaGenerationContracts") {
      return { shouldConnectAiMediaVideoScenes };
    }
    if (specifier === "@/lib/aiMediaModelCatalog") return mediaModels;
    if (specifier === "@/lib/aiMediaGenerationTransport") return mediaTransport;
    if (specifier === "@/lib/aiMediaGenerationRecovery") return mediaRecovery;
    if (specifier === "@/lib/aiMediaCharacterVoiceClient") return characterVoices;
    throw new Error(`Unexpected runtime dependency: ${specifier}`);
  };
  const fixtureFetch = async (url: string, options: RequestInit) => {
    assert.equal(url, "/api/media-generation/generate");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "include");
    assert.equal(typeof options.body, "string");
    requests.push(JSON.parse(options.body as string));
    // This fixture validates serialization and then ends the attempt. Pending
    // paid-job recovery is verified separately through the real GET protocol.
    return new Response(JSON.stringify({
      ok: false,
      code: "AI_MEDIA_REQUEST_INVALID",
      message: "Fixture serialization validated",
    }), { status: 422, headers: { "content-type": "application/json" } });
  };
  new Function("module", "exports", "require", "fetch", output)(
    moduleRecord, moduleRecord.exports, runtimeRequire, fixtureFetch,
  );
  return { runtime: moduleRecord.exports as HookRuntime, requests };
}

test("une scène continue raccorde automatiquement deux clips, deux scènes restent indépendantes", () => {
  for (const durationSeconds of [8, 16, 20]) {
    assert.equal(normalize({ durationSeconds }).connectScenes, durationSeconds > 10);
    assert.equal(normalize({ durationSeconds, connectScenes: false }).connectScenes, durationSeconds > 10);
    assert.equal(normalize({ durationSeconds, sceneMode: "multi" }).connectScenes, false);
  }
  assert.equal(normalize({ kind: "image", connectScenes: true }).connectScenes, false);
  for (const videoEngine of ["veo", "omni"]) {
    assert.equal(normalize({ videoEngine, durationSeconds: 16, connectScenes: true }).connectScenes, true);
  }
  for (const durationSeconds of [0, 1, 3, 4.5, 31]) assert.throws(() => normalize({ durationSeconds }), AiMediaRequestValidationError);
  assert.throws(() => normalize({ durationSeconds: 24 }), AiMediaRequestValidationError, "Omni ne produit pas un troisième clip");
  assert.throws(() => normalize({ durationSeconds: 7, sceneMode: "multi" }), AiMediaRequestValidationError);
  assert.equal(normalize({ videoEngine: "wan3", durationSeconds: 30 }).connectScenes, false, "Wan 3 produit 30 s nativement");
  assert.equal(normalize({ videoEngine: "grok-lite", durationSeconds: 30 }).connectScenes, true);
});

test("le contrat refuse les valeurs non booléennes au lieu de les rendre vraies implicitement", () => {
  for (const connectScenes of ["true", "false", "1", "", 1, 0, null, [], {}]) {
    assert.throws(() => normalize({ connectScenes }), AiMediaRequestValidationError);
  }
});

test("les références obligatoires et les inspirations respectent le contrat de raccord", () => {
  const inspirationImages = [0, 1].map((value) => ({
    mimeType: "image/jpeg",
    data: Buffer.alloc(96, value + 1).toString("base64"),
    role: "character" as const,
    usage: "required" as const,
    characterIndex: (value + 1) as 1 | 2,
  }));
  const identitySource = {
    identityConsent: true,
    inspirationImages,
    connectScenes: true,
    durationSeconds: 20,
  };
  for (const identityMode of ["professional", "brand_avatar", "reference_team"]) {
    assert.equal(normalize({ ...identitySource, identityMode, teamVideoMode: "montage" }).connectScenes, false);
    assert.equal(normalize({ ...identitySource, identityMode }).connectScenes, false, "montage est le défaut");
    assert.equal(normalize({
      ...identitySource,
      identityMode,
      teamVideoMode: "cinematic",
      teamVideoVeoConsent: true,
    }).connectScenes, true);
  }
  const visualInspirations = inspirationImages.map((image) => ({
    ...image,
    role: "inspiration" as const,
    usage: "inspiration" as const,
  }));
  assert.equal(normalize({
    ...identitySource,
    inspirationImages: visualInspirations,
    identityMode: "auto",
    teamVideoMode: "montage",
  }).connectScenes, true);
  assert.equal(normalize({ ...identitySource, identityMode: "professional", peopleMode: "none" }).connectScenes, false);
  assert.equal(normalize({ ...identitySource, identityMode: "reference_team", peopleMode: "none" }).connectScenes, false);
});

test("le raccord fait partie de l'empreinte idempotente du client", () => {
  const { runtime } = hookRuntime();
  const independent = clientRequest({ sceneMode: "multi" });
  const continuous = clientRequest({ sceneMode: "single" });
  const independentKey = runtime.fingerprintForTest(independent, independent.idea);
  const continuousKey = runtime.fingerprintForTest(continuous, continuous.idea);
  assert.notEqual(independentKey, continuousKey);
  assert.equal(JSON.parse(independentKey).connectScenes, false);
  assert.equal(JSON.parse(continuousKey).connectScenes, true);
  assert.equal(
    runtime.fingerprintForTest(clientRequest(), independent.idea),
    continuousKey,
    "une nouvelle demande sans mode explicite garde une scène continue",
  );
});

test("le vrai payload transmet le mode et chaque tentative terminée possède son identifiant", async () => {
  const { runtime, requests } = hookRuntime();
  const hook = runtime.default();
  for (const sceneMode of ["multi", "multi", "single", "single", "multi"] as const) {
    await assert.rejects(
      hook.generate(clientRequest({ sceneMode })),
      { message: "Fixture serialization validated" },
    );
  }
  assert.deepEqual(requests.map((body) => body.connectScenes), [false, false, true, true, false]);
  for (const body of requests) {
    assert.equal(normalizeAiMediaGenerationRequest(body).connectScenes, body.connectScenes);
    assert.equal(body.durationSeconds, 16);
    assert.equal(typeof body.requestId, "string");
  }
  assert.equal(new Set(requests.map((body) => body.requestId)).size, requests.length,
    "une demande terminée ne conserve pas une tentative encore en attente");
});

test("payload et empreinte utilisent la même applicabilité pour les options sans effet", async () => {
  const { runtime, requests } = hookRuntime();
  const hook = runtime.default();
  const inspirationImages = [0, 1].map((value) => ({
    mimeType: "image/jpeg" as const,
    data: Buffer.alloc(96, value + 1).toString("base64"),
    name: `fixture-${value}.jpg`,
  }));
  const cases: Array<Partial<MediaGenerationRequest>> = [
    { kind: "image" },
    { durationSeconds: 8 },
    ...(["professional", "brand_avatar", "reference_team"] as const).map((identityMode) => ({
      identityMode,
      identityConsent: true,
      teamVideoMode: "montage" as const,
      inspirationImages,
    })),
  ];
  for (const options of cases) {
    const request = clientRequest({ ...options, connectScenes: true });
    const key = runtime.fingerprintForTest(request, request.idea);
    assert.equal(JSON.parse(key).connectScenes, false);
    assert.equal(key, runtime.fingerprintForTest({ ...request, connectScenes: false }, request.idea));
    await assert.rejects(hook.generate(request), { message: "Fixture serialization validated" });
    const body = requests.at(-1)!;
    assert.equal(body.connectScenes, false);
    assert.equal(normalizeAiMediaGenerationRequest(body).connectScenes, false);
  }
});

test("character voice serialization preserves only the selected sample and its consent, including inspiration characters", async () => {
  const { runtime, requests } = hookRuntime();
  const hook = runtime.default();
  const timestamp = Date.now();
  const day = new Date(timestamp).toISOString().slice(0, 10);
  const voiceSample = { path: `_studio-voice-references/${day}/account-a__${timestamp}__00000000-0000-4000-8000-000000000001.wav`, name: "voice.wav", mimeType: "audio/wav" as const, durationSeconds: 2, sizeBytes: 64_044 };
  const reference = { mimeType: "image/jpeg" as const, data: Buffer.alloc(96, 1).toString("base64"), name: "portrait.jpg", role: "character" as const, usage: "inspiration" as const, characterIndex: 1 as const, voiceMode: "provided" as const, voiceSample };
  const request = clientRequest({ videoEngine: "wan27", inputMode: "essential", durationSeconds: 8, identityMode: "auto", identityConsent: true, teamVideoSpeechMode: "characters", inspirationImages: [reference] });
  const initialKey = runtime.fingerprintForTest(request, request.idea);
  const replacement = { ...voiceSample, path: voiceSample.path.replace(/1\.wav$/, "2.wav") };
  assert.notEqual(initialKey, runtime.fingerprintForTest({ ...request, inspirationImages: [{ ...reference, voiceSample: replacement }] }, request.idea), "a replacement vocal is a new idempotent request");
  await assert.rejects(hook.generate(request), { message: "Fixture serialization validated" });
  assert.equal(requests[0].videoEngine, "wan27");
  assert.equal(requests[0].identityConsent, true);
  assert.deepEqual((requests[0].inspirationImages as Array<Record<string, unknown>>)[0].voiceSample, voiceSample);
  assert.doesNotMatch(JSON.stringify(requests[0]), /blob:|audio\/webm|data:audio/);
  await assert.rejects(hook.generate({ ...request, inspirationImages: [{ ...reference, voiceMode: "ai" }] }), { message: "Fixture serialization validated" });
  assert.equal((requests[1].inspirationImages as Array<Record<string, unknown>>)[0].voiceSample, undefined);
  await assert.rejects(hook.generate({ ...request, kind: "image" }), { message: "Fixture serialization validated" });
  assert.equal((requests[2].inspirationImages as Array<Record<string, unknown>>)[0].voiceSample, undefined);
});

test("character voice preflight blocks missing samples, other engines and voiceover before sending generation", async () => {
  const { runtime, requests } = hookRuntime();
  const hook = runtime.default();
  const reference = { mimeType: "image/jpeg" as const, data: Buffer.alloc(96, 1).toString("base64"), name: "portrait.jpg", role: "character" as const, usage: "required" as const, voiceMode: "provided" as const };
  const request = clientRequest({ videoEngine: "wan27", teamVideoSpeechMode: "characters", inspirationImages: [reference] });
  await assert.rejects(hook.generate(request), /Insérez un vocal/);
  const voiceSample = { path: "opaque-owned-path.wav", name: "vocal.wav", mimeType: "audio/wav" as const, durationSeconds: 2, sizeBytes: 64_044 };
  const complete = { ...request, inspirationImages: [{ ...reference, voiceSample }] };
  await assert.rejects(hook.generate({ ...complete, teamVideoSpeechMode: "voiceover" }), /mode Personnages/);
  await assert.rejects(hook.generate({ ...complete, videoEngine: "omni" }), /Wan 2\.7, Wan 3 ou HeyGen/);
  assert.equal(requests.length, 0);
});

test("each reviewed voice engine reaches request serialization while Wan 3 rejects aggregate audio overflow before network", async () => {
  const { runtime, requests } = hookRuntime(); const hook = runtime.default();
  const sample = { path: "opaque-owned-path.wav", name: "voice.wav", mimeType: "audio/wav" as const, durationSeconds: 5, sizeBytes: 160_044 };
  const reference = { mimeType: "image/jpeg" as const, data: Buffer.alloc(96, 1).toString("base64"), name: "portrait.jpg", role: "character" as const, usage: "inspiration" as const, characterIndex: 1 as const, voiceMode: "provided" as const, voiceSample: sample };
  for (const videoEngine of ["wan27", "wan3", "heygen"] as const) {
    await assert.rejects(hook.generate(clientRequest({ videoEngine, inputMode: "essential", durationSeconds: 8, identityMode: "auto", identityConsent: true, teamVideoSpeechMode: "characters", inspirationImages: [reference] })), { message: "Fixture serialization validated" });
    assert.equal(requests.at(-1)?.videoEngine, videoEngine);
    assert.deepEqual((requests.at(-1)?.inspirationImages as Array<Record<string, unknown>>)[0].voiceSample, sample);
    assert.equal(requests.at(-1)?.identityConsent, true);
  }
  const references = [1, 2, 3].map((index) => ({ ...reference, characterIndex: index as 1 | 2 | 3 }));
  const allowed = clientRequest({ videoEngine: "wan3", durationSeconds: 8, teamVideoSpeechMode: "characters", inspirationImages: references });
  await assert.rejects(hook.generate(allowed), { message: "Fixture serialization validated" });
  const sent = requests.length;
  const excessive = references.map((image, index) => index === 2 ? { ...image, voiceSample: { ...image.voiceSample, durationSeconds: 5.1 } } : image);
  await assert.rejects(hook.generate({ ...allowed, inspirationImages: excessive }), /Wan 3.*15 secondes.*Raccourcissez/);
  assert.equal(requests.length, sent);
});
