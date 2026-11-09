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
import * as voices from "../../lib/aiMediaCharacterVoices.ts";
import * as prompts from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as providerTypes from "../../lib/aiVideoProviderTypes.ts";
import { prepareAiMediaIdentityReferences } from "../../lib/aiMediaIdentityReferences.ts";
import type { KlingVideoRequest, KlingVideoTask } from "../../lib/aiVideoKlingApi.ts";
import type * as KlingApi from "../../lib/aiVideoKlingApi.ts";
import type * as KlingProvider from "../../lib/aiVideoProviderKling.ts";

function runtime<T>(file: string, imports: Record<string, unknown>): T {
  const source = readFileSync(path.join(process.cwd(), "lib", file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const commonJsModule = { exports: {} };
  vm.runInThisContext(`(function(exports,require,module){${compiled}\n})`)(commonJsModule.exports, (name: string) => {
    if (name === "server-only") return {};
    if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
    return imports[name];
  }, commonJsModule);
  return commonJsModule.exports as T;
}
const api = runtime<typeof KlingApi>("aiVideoKlingApi.ts", { "node:timers/promises": { setTimeout: async () => undefined } });
const mp4 = Buffer.alloc(24); mp4.write("ftyp", 4);
const photo = await sharp({ create: { width: 320, height: 400, channels: 3, background: "#445566" } }).webp().toBuffer();

function argsFor(duration = 8, sceneMode: catalog.AiMediaVideoSceneMode = "single"): providerTypes.AiVideoProviderGenerationArgs {
  const contract = { version: boundary.AI_MEDIA_VIDEO_PROVIDER_CONTRACT_VERSION, subject: "Deux artisans présentent leur atelier.",
    instruction: "Le premier présente une réalisation, la seconde lui répond. Gestes naturels.",
    parameters: "native-dialogue;two-adults", references: "two approved adults and one environment, separate references" };
  const canonicalPrompt = "Film demandé avec deux personnages et leurs voix.";
  return {
    accountId: "account-test", canonicalPrompt, canonicalPromptSha256: boundary.hashAiMediaCanonicalPrompt(canonicalPrompt),
    providerContract: { ...contract, sha256: boundary.hashAiMediaVideoProviderContract(contract) },
    identityTeamProviderEgressConsent: "kling", contentLanguage: "fr",
    request: { requestId: "kling-two-voices-test", kind: "video", creationMode: "free", freePrompt: contract.instruction,
      videoEngine: "kling", durationSeconds: duration, sceneMode, videoResolution: "720p", format: "story",
      identityMode: "reference_team", teamVideoMode: "cinematic", teamVideoSpeechMode: "characters", withNarration: false, withSubtitles: false,
      inspirationImages: [0, 1, 2].map(index => ({ mimeType: "image/webp", data: photo.toString("base64"),
        role: index === 1 ? "environment" : "character", usage: "required", characterIndex: index === 0 ? 1 : index === 2 ? 2 : undefined,
        voiceMode: index === 1 ? "ai" : "provided", ...(index !== 1 ? { voiceSample: { path: `test-${index}.wav`, name: `voice-${index}.wav`,
          mimeType: "audio/wav", durationSeconds: 8, sizeBytes: 256_044 } } : {}) })),
    },
    nativeNarrationLines: timeline.getAiMediaVideoSegmentDurations(duration, "kling", "720p", sceneMode).map((_, index) => index ? "Bienvenue dans notre atelier !" : "Bonjour, découvrez notre travail !"),
    plan: { companyName: "Atelier", scenes: timeline.getAiMediaVideoSegmentDurations(duration, "kling", "720p", sceneMode)
      .map((_, index) => ({ visualBrief: index ? "La seconde personne répond." : "Les deux adultes discutent dans leur atelier.", spokenLine: index ? "Bienvenue dans notre atelier !" : "Bonjour, découvrez notre travail !" })) },
  } as unknown as providerTypes.AiVideoProviderGenerationArgs;
}

type Mode = "success" | "voice-failed" | "lost-ack" | "lost-ack-unconfirmed" | "download-failed" | "rejected" | "polling-failed" | "polling-unauthorized" | "existing" | "pending-cancel";
function context(mode: Mode = "success", cancel?: AbortController) {
  const requests: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  const videoBodies: KlingVideoRequest[] = [];
  const profiles: { url: string; externalId: string; id: string; name: string }[] = [];
  const deleted: string[] = [];
  const tasks = new Map<string, KlingVideoTask>();
  const counts = { reserved: 0, committed: 0, rolledBack: 0, uploads: 0, cleanups: 0, downloads: 0 };
  const costs: number[] = [];
  const ok = (data: unknown) => Response.json({ code: 0, data });
  const completed = (id = "video-1", duration = 8): KlingVideoTask => ({ id, status: "succeeded", outputs: [{ type: "video", url: "https://test.klingai.com/video.mp4", duration }] });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api-singapore.klingai.com");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-only-kling-key");
    assert.equal(init?.redirect, "error");
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ url: url.pathname + url.search, method, body });
    if (method === "GET" && url.pathname === "/tasks" && url.searchParams.has("external_task_ids")) {
      const external = url.searchParams.get("external_task_ids")!;
      if (mode === "lost-ack-unconfirmed" && videoBodies.length) return Response.json({ code: 1000 }, { status: 403 });
      const value = tasks.get(external);
      if (mode === "existing") return ok([{ ...completed(), external_id: external }]);
      return ok(value ? [{ ...value, external_id: external }] : []);
    }
    if (method === "POST" && url.pathname === "/v1/general/custom-voices") {
      assert.ok(counts.reserved > counts.committed + counts.rolledBack, "voice creation requires an active cost reservation");
      const number = profiles.length + 1;
      profiles.push({ url: String(body!.voice_url), externalId: String(body!.external_task_id), id: `speaker-${number}`, name: String(body!.voice_name) });
      return ok({ task_id: `voice-task-${number}`, task_status: "submitted" });
    }
    if (method === "GET" && url.pathname.startsWith("/v1/general/custom-voices/")) {
      const number = Number(url.pathname.split("-").at(-1));
      if (mode === "voice-failed" && number === 2) return ok({ task_status: "failed" });
      return ok({ task_status: "succeed", task_info: { external_task_id: profiles[number - 1].externalId },
        task_result: { voices: [{ voice_id: profiles[number - 1].id }] } });
    }
    if (method === "POST" && url.pathname === "/omni-video/kling-4.0") {
      assert.ok(counts.reserved > counts.committed + counts.rolledBack, "video submission requires an active cost reservation");
      videoBodies.push(body as unknown as KlingVideoRequest);
      if (mode === "rejected") return Response.json({ code: 1000, message: "private https://secret.invalid/?token=PRIVATE" }, { status: 403 });
      const request = body as unknown as KlingVideoRequest;
      const task = { id: `video-${videoBodies.length}`, status: "submitted", outputs: [] } as KlingVideoTask;
      tasks.set(request.options.external_task_id, task);
      if (mode === "lost-ack" || mode === "lost-ack-unconfirmed") throw new Error("private request was accepted, ACK lost");
      return ok(task);
    }
    if (method === "GET" && url.pathname === "/tasks" && url.searchParams.has("task_ids")) {
      const taskId = url.searchParams.get("task_ids")!;
      if (mode === "polling-unauthorized") return Response.json({ code: 1000 }, { status: 403 });
      if (mode === "pending-cancel") { cancel!.abort(new Error("user disconnected")); return ok([{ id: taskId, status: "processing" }]); }
      if (mode === "polling-failed") return ok([{ id: taskId, status: "failed" }]);
      const index = Number(taskId.split("-").at(-1)) - 1;
      return ok([completed(taskId, videoBodies[index]?.settings.duration || 8)]);
    }
    if (method === "POST" && url.pathname === "/v1/general/delete-voices") { deleted.push(String(body!.voice_id)); return ok({ task_status: "succeed" }); }
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  };
  const provider = runtime<typeof KlingProvider>("aiVideoProviderKling.ts", {
    "node:crypto": crypto, sharp, ai: { createDownload: () => async () => {
      counts.downloads++; if (mode === "download-failed") throw new Error("download private https://secret.invalid/?token=PRIVATE");
      return { data: mp4, mediaType: "video/mp4" };
    } },
    "@/lib/aiGatewayAccountGuard": {
      reserveAiGatewayAccountAttempt: async (_id: string, input: { estimatedCostMicroUsd: number }) => { counts.reserved++; costs.push(input.estimatedCostMicroUsd); return {}; },
      commitAiGatewayAccountAttempt: async () => { counts.committed++; }, rollbackAiGatewayAccountAttempt: async () => { counts.rolledBack++; }, recordAiGatewayAccountFailure: async () => {},
    },
    "./aiMediaIdentityReferences.ts": { prepareAiMediaIdentityReferences },
    "./aiMediaCharacterVoiceStorage.ts": { getAiMediaCharacterVoiceSignedUrls: async ({ images }: { images: voices.AiMediaCharacterVoiceReference[] }) => images.map((image, i) => image.voiceMode === "provided" ? `https://private.example/voice-${i + 1}.wav` : null) },
    "./aiMediaVideoTemporaryImages.ts": { createAiMediaVideoTemporaryImageStore: () => ({ uploadImages: async (images: { mimeType: string; data: string }[]) => {
      counts.uploads++; assert.ok(images.every(image => image.mimeType === "image/png"));
      for (const image of images) assert.equal((await sharp(Buffer.from(image.data, "base64")).metadata()).exif, undefined);
      return images.map((_, i) => `https://private.example/image-${i + 1}.png`);
    }, cleanup: async () => { counts.cleanups++; } }) },
    "./aiMediaModelCatalog.ts": catalog, "./aiMediaCharacterVoices.ts": voices, "./aiMediaVideoTimeline.ts": timeline,
    "./aiMediaVideoProviderContract.ts": boundary, "./aiMediaFreeGenerationPrompt.ts": prompts,
    "./aiVideoProviderGoogleVeo.ts": { buildGoogleVideoScenePrompt: prompts.buildAiMediaFreeVideoScenePrompt },
    "./aiVideoProviderTypes.ts": providerTypes,
    "./aiVideoKlingApi.ts": { ...api, createKlingApiClient: ({ apiKey }: { apiKey: string }) => api.createKlingApiClient({ apiKey, fetch: fetcher, sleep: async () => undefined }) },
  });
  return { provider, requests, videoBodies, profiles, deleted, counts, costs };
}
async function withKey(run: () => Promise<void>) {
  const previous = process.env.KLING_API_KEY; process.env.KLING_API_KEY = "test-only-kling-key";
  try { await run(); } finally { if (previous === undefined) delete process.env.KLING_API_KEY; else process.env.KLING_API_KEY = previous; }
}

test("Kling sends two distinct original faces and their own voice IDs through the direct API", async () => withKey(async () => {
  const c = context(); const result = await c.provider.klingAiVideoProvider.generate(argsFor());
  assert.equal(result.provider, "kling-direct"); assert.equal(result.clips.length, 1); assert.equal(result.model, "kling-4.0-omni");
  assert.deepEqual(c.profiles.map(profile => profile.url), ["https://private.example/voice-1.wav", "https://private.example/voice-3.wav"]);
  assert.equal(new Set(c.profiles.map(profile => profile.name)).size, 2);
  assert.ok(c.profiles.every(profile => profile.name.length <= 20));
  assert.ok(c.profiles.every(profile => profile.externalId.length <= 64));
  assert.deepEqual(c.videoBodies[0].contents.filter(item => item.type === "voice"), [
    { type: "voice", voice_id: "speaker-1", id: "voice_1" }, { type: "voice", voice_id: "speaker-2", id: "voice_3" },
  ]);
  const prompt = c.videoBodies[0].contents.find(item => item.type === "prompt")!;
  assert.match(prompt.text, /@image_1.*@voice_1/); assert.match(prompt.text, /@image_3.*@voice_3/);
  assert.match(prompt.text, /Bonjour, découvrez notre travail !/);
  assert.equal(c.videoBodies[0].settings.audio, "native"); assert.equal(c.videoBodies[0].settings.duration, 8);
  assert.equal(c.counts.reserved, 3); assert.equal(c.counts.committed, 3); assert.equal(c.counts.rolledBack, 0);
  assert.equal(result.estimatedCostMicroUsd, 1_300_000);
  assert.deepEqual(c.deleted, ["speaker-1", "speaker-2"]); assert.equal(c.counts.cleanups, 1);
}));

test("Kling keeps the same two voice assignments in both clips of a multi-scene film", async () => withKey(async () => {
  const c = context(); const result = await c.provider.klingAiVideoProvider.generate(argsFor(16, "multi"));
  assert.equal(result.clips.length, 2); assert.equal(c.profiles.length, 2); assert.equal(c.videoBodies.length, 2);
  assert.deepEqual(c.videoBodies.map(body => body.contents.filter(item => item.type === "voice")), [
    c.videoBodies[0].contents.filter(item => item.type === "voice"), c.videoBodies[0].contents.filter(item => item.type === "voice"),
  ]);
  assert.notEqual(c.videoBodies[0].options.external_task_id, c.videoBodies[1].options.external_task_id);
  assert.match((c.videoBodies[1].contents[0] as { text: string }).text, /Bienvenue dans notre atelier !/);
}));

test("a lost video submission ACK is recovered by external ID without a second paid POST", async () => withKey(async () => {
  const c = context("lost-ack"); const result = await c.provider.klingAiVideoProvider.generate(argsFor());
  assert.equal(result.clips.length, 1); assert.equal(c.videoBodies.length, 1);
  assert.ok(c.requests.filter(request => request.url.startsWith("/tasks?external_task_ids=")).length >= 2);
}));

test("a previously submitted task is recovered without recreating voices or submitting a video", async () => withKey(async () => {
  const c = context("existing"); const result = await c.provider.klingAiVideoProvider.generate(argsFor());
  assert.equal(result.clips.length, 1); assert.equal(c.profiles.length, 0); assert.equal(c.videoBodies.length, 0);
  assert.equal(c.counts.reserved, 0); assert.equal(c.counts.uploads, 0);
}));

test("a failed voice profile prevents video spending and cleans the successful temporary profile", async () => withKey(async () => {
  const c = context("voice-failed"); await assert.rejects(c.provider.klingAiVideoProvider.generate(argsFor()), /voice_failed/);
  assert.equal(c.videoBodies.length, 0); assert.equal(c.counts.committed, 1); assert.equal(c.counts.rolledBack, 1);
  assert.deepEqual(c.deleted, ["speaker-1"]); assert.equal(c.counts.cleanups, 1);
}));

test("a definite Kling rejection releases the video reservation and exposes no supplier payload", async () => withKey(async () => {
  const c = context("rejected"); await assert.rejects(c.provider.klingAiVideoProvider.generate(argsFor()), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /credentials_rejected/); assert.doesNotMatch(error.message, /PRIVATE|secret.invalid/);
    assert.equal(providerTypes.isAiVideoProviderBillableFailure(error), false); return true;
  });
  assert.equal(c.counts.rolledBack, 1); assert.equal(c.counts.committed, 2); assert.equal(c.deleted.length, 2);
}));

test("a failed Kling task releases its video reservation without a second submission", async () => withKey(async () => {
  const c = context("polling-failed"); await assert.rejects(c.provider.klingAiVideoProvider.generate(argsFor()), /task_failed/);
  assert.equal(c.videoBodies.length, 1); assert.equal(c.counts.rolledBack, 1); assert.equal(c.deleted.length, 2);
}));

test("download failure after successful generation remains billable and cannot cause fallback", async () => withKey(async () => {
  const c = context("download-failed"); await assert.rejects(c.provider.klingAiVideoProvider.generate(argsFor()), error => {
    assert.equal(providerTypes.isAiVideoProviderBillableFailure(error), true);
    assert.doesNotMatch(String(error), /PRIVATE|secret.invalid/); return true;
  });
  assert.equal(c.videoBodies.length, 1); assert.equal(c.counts.committed, 3); assert.equal(c.counts.rolledBack, 0);
}));

test("missing API credentials, missing consent and short voice samples fail before network or spending", async () => {
  const previous = process.env.KLING_API_KEY; delete process.env.KLING_API_KEY;
  try {
    const c = context(); await assert.rejects(c.provider.klingAiVideoProvider.generate(argsFor()), /credentials_missing/);
    assert.equal(c.requests.length, 0); assert.equal(c.counts.reserved, 0);
    const noConsent = argsFor(); noConsent.identityTeamProviderEgressConsent = undefined;
    await assert.rejects(c.provider.klingAiVideoProvider.generate(noConsent), /consent_required/);
    const short = argsFor(); short.request.inspirationImages[0].voiceSample!.durationSeconds = 3;
    await assert.rejects(c.provider.klingAiVideoProvider.generate(short), /kling_duration_invalid/);
    assert.equal(c.requests.length, 0); assert.equal(c.counts.reserved, 0);
  } finally { if (previous !== undefined) process.env.KLING_API_KEY = previous; }
});

test("portraits below Kling's minimum dimensions are rejected before profile creation", async () => withKey(async () => {
  const c = context(); const args = argsFor();
  const small = await sharp({ create: { width: 200, height: 300, channels: 3, background: "white" } }).webp().toBuffer();
  args.request.inspirationImages[0].data = small.toString("base64");
  await assert.rejects(c.provider.klingAiVideoProvider.generate(args), /reference_dimensions_invalid/);
  assert.equal(c.requests.length, 0); assert.equal(c.counts.reserved, 0);
}));

test("Kling external IDs isolate accounts and preserve the original request identity", () => {
  const c = context(); const args = argsFor(); const original = c.provider.klingVideoExternalId(args);
  assert.equal(c.provider.klingVideoExternalId(args), original);
  assert.notEqual(c.provider.klingVideoExternalId({ ...args, accountId: "other-account" }), original);
  assert.match(original, /^inrcy-k4-[0-9a-f]{32}$/); assert.doesNotMatch(original, /account-test|kling-two-voices-test/);
});

test("daily voice cleanup selects only expired profiles created by this integration", () => {
  const now = Date.now();
  const owned = `inrcy-k4-${"a".repeat(40)}-voice-1-123456abcdef`;
  const task = (external: string, age: number, voiceId: string) => ({ task_info: { external_task_id: external }, created_at: now - age,
    task_status: "succeed", task_result: { voices: [{ voice_id: voiceId }] } });
  assert.deepEqual(api.getExpiredKlingTemporaryVoiceIds([
    task(owned, 25 * 3600_000, "expired-owned"), task(owned, 10 * 3600_000, "recent-owned"),
    task("manual-customer-voice", 50 * 3600_000, "never-delete"), task("inrcy-other-feature", 50 * 3600_000, "never-delete-2"),
  ], now), ["expired-owned"]);
});

test("cancellation during an accepted task defers input/voice cleanup and blocks another paid submission", async () => withKey(async () => {
  const cancel = new AbortController(); const c = context("pending-cancel", cancel);
  const args = argsFor(); args.signal = cancel.signal;
  await assert.rejects(c.provider.klingAiVideoProvider.generate(args), error => {
    assert.equal(providerTypes.isAiVideoProviderBillableFailure(error), true); return true;
  });
  assert.equal(c.videoBodies.length, 1); assert.equal(c.counts.committed, 3);
  assert.equal(c.counts.rolledBack, 0); assert.equal(c.deleted.length, 0); assert.equal(c.counts.cleanups, 0);
}));

test("Kling credential preflight only queries task status and creates no billable resources", async () => withKey(async () => {
  const c = context(); await c.provider.preflightKlingAiVideoAccess(argsFor());
  assert.equal(c.requests.length, 1); assert.equal(c.requests[0].method, "GET");
  assert.equal(c.counts.reserved, 0); assert.equal(c.profiles.length, 0); assert.equal(c.videoBodies.length, 0);
}));

test("voice creation recovers a lost ACK using its original external ID, without another profile POST", async () => {
  const external = `inrcy-k4-${"b".repeat(40)}-voice-1-123456abcdef`;
  const calls: string[] = [];
  const client = api.createKlingApiClient({ apiKey: "test-only-kling-key", sleep: async () => undefined,
    fetch: async (input, init) => {
      const url = new URL(String(input)); calls.push(`${init?.method} ${url.pathname}`);
      if (init?.method === "POST") throw new Error("ACK lost");
      assert.equal(url.pathname, `/v1/general/custom-voices/${external}`);
      return Response.json({ code: 0, data: { task_status: "succeed", task_info: { external_task_id: external }, task_result: { voices: [{ voice_id: "original-speaker" }] } } });
    } });
  assert.equal(await client.createVoice({ url: "https://private.example/voice.wav", externalTaskId: external }), "original-speaker");
  assert.equal(calls.filter(call => call.startsWith("POST")).length, 1);
});

test("Kling response schemas and task identity are checked before accepting an asset", async () => {
  const task = { id: "own-task", status: "processing", outputs: [] } as KlingVideoTask;
  for (const data of [
    [{ id: "another-task", status: "succeeded", outputs: [{ type: "video", url: "https://test.klingai.com/video.mp4", duration: 8 }] }],
    [{ task_id: "own-task", task_status: "succeed" }],
    [{ id: "own-task", status: "succeeded", outputs: [{ type: "video", url: "https://user:private@test.klingai.com/video.mp4", duration: 8 }] }],
  ]) {
    const client = api.createKlingApiClient({ apiKey: "test-only-kling-key", sleep: async () => undefined,
      fetch: async () => Response.json({ code: 0, data }) });
    await assert.rejects(client.waitVideo(task), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /task_scope_invalid|response_invalid|output_invalid/);
      assert.doesNotMatch(error.message, /private|another-task/); return true;
    });
  }
});

test("failed lookups after an uncertain or accepted video POST cannot release its cost or trigger a second submission", async () => withKey(async () => {
  for (const mode of ["lost-ack-unconfirmed", "polling-unauthorized"] as const) {
    const c = context(mode);
    await assert.rejects(c.provider.klingAiVideoProvider.generate(argsFor()), error => {
      assert.equal(providerTypes.isAiVideoProviderBillableFailure(error), true); return true;
    });
    assert.equal(c.videoBodies.length, 1); assert.equal(c.counts.committed, 3); assert.equal(c.counts.rolledBack, 0);
    assert.equal(c.deleted.length, 0); assert.equal(c.counts.cleanups, 0);
  }
}));

test("the real dispatcher keeps an explicit Kling choice on the direct provider without invoking Gateway or Google", async () => withKey(async () => {
  const c = context();
  const fail = () => { throw new Error("Unexpected alternate provider"); };
  const dispatcher = runtime<typeof import("../../lib/aiVideoProvider.ts")>("aiVideoProvider.ts", {
    "@/lib/aiVideoProviderGoogleOmni": { googleOmniVideoProvider: { id: "google-gemini-omni", model: "google-test", generate: fail } },
    "@/lib/aiVideoProviderGoogleVeo": { googleVeoVideoProvider: { id: "google-veo-fast", model: "google-test", generate: fail } },
    "./aiVideoProviderGateway.ts": { createGatewayAiVideoProvider: fail },
    "./aiMediaModelCatalog.ts": catalog, "./aiVideoProviderKling.ts": c.provider,
  });
  assert.deepEqual(dispatcher.getAiVideoProviderIdentity("kling"), { provider: "kling-direct", model: "kling-4.0-omni" });
  const result = await dispatcher.generateOriginalAiVideoClips(argsFor());
  assert.equal(result.provider, "kling-direct"); assert.equal(c.videoBodies.length, 1);
}));
