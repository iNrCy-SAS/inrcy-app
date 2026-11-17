import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import ts from "typescript";
import * as pending from "../../lib/aiMediaPendingVideo.ts";
import * as catalog from "../../lib/aiMediaModelCatalog.ts";
import * as types from "../../lib/aiVideoProviderTypes.ts";
import { getAiMediaGenerationPublicError, isAiMediaProviderBillingFailure } from "../../lib/aiMediaGenerationPublicErrors.ts";
import type * as Api from "../../lib/aiVideoHeygenApi.ts";
import type * as Provider from "../../lib/aiVideoProviderHeygen.ts";

function load<T>(file: string, dependencies: Record<string,unknown>): T {
  const compiled = ts.transpileModule(readFileSync(new URL(`../../lib/${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const record = { exports: {} };
  new Function("module", "exports", "require", compiled)(record, record.exports, (id: string) => {
    if (id === "server-only") return {};
    assert.ok(id in dependencies, `unexpected dependency: ${id}`);
    return dependencies[id];
  });
  return record.exports as T;
}
const api = load<typeof Api>("aiVideoHeygenApi.ts", { "node:timers/promises": { setTimeout: delay } });
const mp4 = Buffer.from("0000ftypisomTEST");

test("HeyGen V3 uses one idempotent Studio submission and only sends its key to the API origin", async () => {
  const calls: string[] = [];
  const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async (url, options) => {
    calls.push(String(url));
    if (String(url).startsWith("https://api.heygen.com")) {
      assert.equal((options!.headers as Record<string,string>)["X-Api-Key"], "test-key");
      if (options?.method === "POST") {
        assert.equal((options.headers as Record<string,string>)["Idempotency-Key"], "stable-job-key");
        assert.equal(JSON.parse(String(options.body)).type, "studio");
        return Response.json({ data: { video_id: "video-1" } });
      }
      return Response.json({ data: { id: "video-1", status: "completed", duration: 8, video_url: "https://resource2.heygen.ai/video.mp4" } });
    }
    assert.equal(options?.headers, undefined);
    assert.equal(options?.redirect, "error");
    return new Response(mp4);
  } });
  const id = await client.submitVideo({ title: "Test", resolution: "1080p", aspect_ratio: "9:16", scenes: [] }, "stable-job-key");
  const video = await client.getVideo(id);
  assert.deepEqual(await client.downloadVideo(video.videoUrl!), mp4);
  assert.equal(calls.length, 3);
});

test("a failed or malformed video acknowledgement never retries a potentially billable POST", async () => {
  for (const reply of [() => { throw new Error("private transport secret"); }, () => Response.json({ data: {} }), () => Response.json({ error: { code: "internal_error" } }, { status: 503 })]) {
    let calls = 0;
    const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async () => { calls++; return reply(); } });
    await assert.rejects(client.submitVideo({ title: "Test", resolution: "720p", aspect_ratio: "9:16", scenes: [] }, "same-job"), error => {
      assert.ok(error instanceof api.HeygenApiError && error.uncertain);
      assert.doesNotMatch(error.message, /private|secret/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("billing and access failures are actionable without exposing HeyGen's raw response", async () => {
  for (const [status, expected] of [[402,"AI_MEDIA_PROVIDER_BALANCE_INSUFFICIENT"], [401,"AI_MEDIA_GATEWAY_NOT_CONFIGURED"], [403,"AI_MEDIA_GATEWAY_NOT_CONFIGURED"], [429,"AI_MEDIA_VIDEO_CAPACITY_REACHED"]] as const) {
    const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async () => Response.json({ error: { code: "request_failed", message: "private input URL token=secret" } }, { status }) });
    await assert.rejects(client.publicVoices("fr"), error => {
      assert.equal(getAiMediaGenerationPublicError(error).code, expected);
      assert.equal(isAiMediaProviderBillingFailure(error), status === 402);
      assert.doesNotMatch(getAiMediaGenerationPublicError(error).message, /private|token|secret/);
      return true;
    });
  }
});

test("private addresses, lookalike domains, redirects and mismatched video IDs cannot supply video bytes", async () => {
  let calls = 0;
  const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async () => { calls++; return Response.json({ data: { id: "other-job", status: "processing" } }); } });
  for (const url of ["http://resource2.heygen.ai/a.mp4", "https://127.0.0.1/a", "https://heygen.ai.evil.invalid/a", "https://user:pass@heygen.ai/a", "https://heygen.ai:8080/a", "file:///a.mp4"]) {
    await assert.rejects(client.downloadVideo(url), /video_url_invalid/);
  }
  assert.equal(calls, 0);
  await assert.rejects(client.getVideo("job-1"), /video_response_invalid/);
  assert.equal(calls, 1);
});

test("an accepted voice is tracked before its activation check and a failed clone cannot become a generic voice", async () => {
  const methods: string[] = [], tracked: string[] = [];
  const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async (_url, options) => {
    methods.push(options?.method || "GET");
    if (options?.method === "POST") return Response.json({ data: { voice_id: "my-voice" } }, { status: 202 });
    assert.deepEqual(tracked, ["my-voice"]);
    return Response.json({ data: { status: "FAILED", failure_reason: "private transcription" } });
  } });
  await assert.rejects(client.createVoice("https://owned.invalid/voice.wav", "Voice", "fr", "voice-job", undefined, id => tracked.push(id)), /voice_clone_failed/);
  assert.deepEqual(methods, ["POST", "GET"]);
});

function args(): types.AiVideoProviderGenerationArgs {
  return { accountId: "account-1", jobId: "job-1", canonicalPromptSha256: "a".repeat(64), contentLanguage: "fr", brandColors: ["#123456"],
    request: { videoEngine: "heygen-avatar", format: "story", durationSeconds: 16, videoResolution: "720p", teamVideoSpeechMode: "characters", withNarration: false,
      inspirationImages: [{ role: "character", characterIndex: 2, voiceMode: "provided" }, { role: "environment" }, { role: "character", characterIndex: 1, voiceMode: "provided" }],
      exactDialogue: [{ speaker: "character", characterIndex: 1, text: "Bonjour, je suis David." }, { speaker: "character", characterIndex: 2, text: "Bonjour, je suis Kathia." }] },
    plan: { scenes: [{ visualBrief: "Jardin", spokenTurns: [{ reference: 3, text: "David" }, { reference: 1, text: "Kathia" }] }] },
  } as unknown as types.AiVideoProviderGenerationArgs;
}
function providerHarness(options: { submission?: "rejected" | "uncertain" } = {}) {
  const events: string[] = [], submitted: Array<{ scenes: Api.HeygenStudioScene[] }> = [];
  const client = {
    uploadImage: async (buffer: Buffer) => ({ type: "asset_id", asset_id: buffer.toString() }),
    createPhotoAvatar: async (asset: Api.HeygenAsset) => ({ id: `avatar-${asset.asset_id}`, groupId: `group-${asset.asset_id}` }),
    createVoice: async (url: string, _name: string, _language: string, _key: string, _signal: unknown, track: (id: string) => void) => { const id = `cloned-${url}`; track(id); return id; },
    publicVoices: async () => { events.push("public-voices"); return ["ai-voice"]; },
    publicAvatar: async () => "public-avatar",
    submitVideo: async (input: { scenes: Api.HeygenStudioScene[] }) => { submitted.push(input); if (options.submission) throw new api.HeygenApiError(options.submission === "rejected" ? 402 : 503, "request_failed", options.submission === "uncertain"); return "video-1"; },
    deleteVoice: async (id: string) => { events.push(`delete:${id}`); }, deleteAvatarGroup: async (id: string) => { events.push(`delete:${id}`); }, deleteAsset: async (id: string) => { events.push(`delete:${id}`); },
  };
  const provider = load<typeof Provider>("aiVideoProviderHeygen.ts", {
    "node:crypto": crypto, "@/lib/aiGatewayAccountGuard": {
      reserveAiGatewayAccountAttempt: async () => { events.push("reserve"); return {}; },
      commitAiGatewayAccountAttempt: async () => { events.push("commit"); }, rollbackAiGatewayAccountAttempt: async () => { events.push("rollback"); }, recordAiGatewayAccountFailure: async () => {},
    }, "./aiVideoHeygenApi.ts": { ...api, createHeygenApiClient: () => client }, "./aiMediaPendingVideo.ts": pending,
    "./aiMediaIdentityReferences.ts": { prepareAiMediaIdentityReferences: async () => ({ buffers: [Buffer.from("person2"),Buffer.from("garden"),Buffer.from("person1")] }) },
    "./aiMediaCharacterVoiceStorage.ts": { getAiMediaCharacterVoiceSignedUrls: async () => ["voice2",null,"voice1"] },
    "./aiMediaModelCatalog.ts": catalog, "./aiVideoProviderTypes.ts": { ...types, assertAiVideoReferenceTeamProviderEgress: () => {} },
  });
  return { provider, submitted, events };
}

test("dialogue slots keep their own original photo and voice even when references are reordered around a decor", async () => {
  const h = providerHarness();
  await assert.rejects(h.provider.heygenAiVideoProvider.generate(args()), error => {
    assert.ok(pending.isAiVideoProviderPending(error));
    assert.equal(error.task.videoId, "video-1");
    assert.deepEqual(error.task.temporaryVoiceIds, ["cloned-voice1","cloned-voice2"]);
    return true;
  });
  assert.equal(h.submitted.length, 1);
  const scenes = h.submitted[0].scenes as Array<Extract<Api.HeygenStudioScene,{type:"avatar_video"}>>;
  assert.deepEqual(scenes.map(scene => [scene.input.avatar_id, scene.input.voice_id, scene.input.script]), [
    ["avatar-person1","cloned-voice1","Bonjour, je suis David."], ["avatar-person2","cloned-voice2","Bonjour, je suis Kathia."],
  ]);
  assert.ok(!h.events.includes("public-voices"));
  assert.deepEqual(h.events, ["reserve","commit"]);
});

test("automatic two-person turns preserve attribution; an unbound speaker never spends", () => {
  const h = providerHarness(), request = args(); delete request.request.exactDialogue;
  assert.deepEqual(h.provider.buildHeygenDialogueTurns(request).map(turn => [turn.reference,turn.text]), [[3,"David"],[1,"Kathia"]]);
  request.plan.scenes[0].spokenTurns = [{ reference: 2, speaker: "Decor", text: "Wrong decor" }];
  assert.throws(() => h.provider.buildHeygenDialogueTurns(request), /speaker_missing/);
  assert.deepEqual(h.events, []);
});

test("a definite submission rejection releases the supplier reservation and temporary voices; uncertain acceptance preserves them", async () => {
  for (const submission of ["rejected","uncertain"] as const) {
    const h = providerHarness({ submission });
    await assert.rejects(h.provider.heygenAiVideoProvider.generate(args()));
    assert.equal(h.submitted.length, 1);
    assert.equal(h.events.includes("rollback"), submission === "rejected");
    assert.equal(h.events.includes("commit"), submission === "uncertain");
    assert.equal(h.events.some(event => event.startsWith("delete:")), submission === "rejected");
  }
});

test("pending provider tasks contain only bounded private identifiers, never URLs, keys or incomplete accounting", () => {
  const valid = { provider: "heygen-direct", model: "heygen-avatar-iv", videoId: "job-1", temporaryVoiceIds: ["voice-1"], temporaryAvatarGroupIds: [], temporaryAssetIds: [], estimatedCostMicroUsd: 1_000_000 };
  assert.ok(pending.isAiMediaPendingVideo(valid));
  assert.ok(!pending.isAiMediaPendingVideo({ ...valid, videoId: "https://private.invalid?token=secret" }));
  assert.ok(!pending.isAiMediaPendingVideo({ ...valid, temporaryVoiceIds: Array(5).fill("voice") }));
  assert.ok(!pending.isAiMediaPendingVideo({ ...valid, estimatedCostMicroUsd: -1 }));
});

test("HeyGen rejected parameters retain the exact operation and field without storing request values", async () => {
  const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async () => Response.json({ error: {
    code: "invalid_parameter", param: "scenes[0].input.motion_prompt", message: "Private user speech at https://signed.invalid?token=secret"
  } }, { status: 400 }) });
  await assert.rejects(client.submitVideo({ title: "Test", resolution: "1080p", aspect_ratio: "9:16", scenes: [] }, "job"), error => {
    assert.ok(error instanceof api.HeygenApiError);
    assert.equal((error.cause as Error).message, "ai_video_heygen_request_post_videos:scenes[0].input.motion_prompt");
    assert.doesNotMatch(JSON.stringify(error) + String(error.cause), /Private user|signed.invalid|token=secret/);
    return true;
  });
});
test("HeyGen support metrics read only a bounded window and exclude unexpected payloads", async () => {
  const calls: string[] = [];
  const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async (url, options) => {
    calls.push(String(url)); assert.equal(options!.method, "GET");
    return Response.json({ data: [
      { endpoint: "/v3/videos", total: 2, failed: 2, failed_4xx: 2, failed_5xx: 0, prompt: "private" },
      { endpoint: "https://private.invalid?secret=value", total: 2, failed: 2, failed_4xx: 2, failed_5xx: 0 },
      { endpoint: "/v3/avatars", total: -1, failed: 0, failed_4xx: 0, failed_5xx: 0 }
    ] });
  } });
  assert.deepEqual(await client.errorMetrics(100, 200), [{ endpoint: "/v3/videos", total: 2, failed: 2, failed4xx: 2, failed5xx: 0 }]);
  assert.equal(calls.length, 1);
  await assert.rejects(client.errorMetrics(100, 5000), /diagnostic_window_invalid/);
  assert.equal(calls.length, 1);
});
