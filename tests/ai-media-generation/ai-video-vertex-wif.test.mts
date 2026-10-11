import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { GoogleGenAI } from "@google/genai";
import { gaxios } from "google-auth-library";
import { createVeoVertexClientOptions, VEO_VERTEX_WIF_PHASE_TIMEOUT_MS } from "../../lib/aiVideoReliability.ts";

const env = {
  AI_MEDIA_VEO_VERTEX_PROJECT: "fixture-project",
  AI_MEDIA_VEO_VERTEX_WIF_AUDIENCE: "//iam.googleapis.com/projects/123456/locations/global/workloadIdentityPools/fixture/providers/vercel",
  AI_MEDIA_VEO_VERTEX_SERVICE_ACCOUNT: "veo@fixture-project.iam.gserviceaccount.com",
};
const stsUrl = "https://sts.googleapis.com/v1/token";
const iamUrl = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/veo@fixture-project.iam.gserviceaccount.com:generateAccessToken";
const resource = "projects/fixture-project/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001";
const operationName = `${resource}/operations/fixture-video`;

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function authResponse(url: string) {
  if (url === stsUrl) {
    return jsonResponse({ access_token: "fixture-sts", token_type: "Bearer", expires_in: 3600 });
  }
  assert.equal(url, iamUrl, "Every auth request must remain inside the fixture");
  return jsonResponse({ accessToken: "fixture-iam", expireTime: new Date(Date.now() + 3600_000).toISOString() });
}

function mockAuthFetch(context: TestContext, fetchImplementation: typeof fetch) {
  const request = gaxios.Gaxios.prototype.request;
  // Keep the real Gaxios serialization, interceptors, abort and retry handling.
  // STS's separately-created transport is intercepted through this public API too.
  context.mock.method(gaxios.Gaxios.prototype, "request", function (this: gaxios.Gaxios, options: gaxios.GaxiosOptions = {}) {
    return request.call(this, { ...options, fetchImplementation });
  });
}

test("la vraie chaîne WIF du SDK échange STS/IAM et retourne les octets vidéo sans clé ni réseau", async (context) => {
  const calls: string[] = [];
  let tokens = 0;
  mockAuthFetch(context, async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url === stsUrl) {
      calls.push("sts");
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("audience"), env.AI_MEDIA_VEO_VERTEX_WIF_AUDIENCE);
      assert.equal(body.get("subject_token"), "fixture-subject");
      assert.equal(body.get("subject_token_type"), "urn:ietf:params:oauth:token-type:jwt");
      assert.equal(body.get("scope"), "https://www.googleapis.com/auth/cloud-platform");
    } else {
      assert.equal(url, iamUrl);
      calls.push("iam");
      assert.equal(headers.get("authorization"), "Bearer fixture-sts");
      assert.deepEqual(JSON.parse(String(init?.body)).scope, ["https://www.googleapis.com/auth/cloud-platform"]);
    }
    return authResponse(url);
  });
  const videoBytes = Buffer.from("fixture-mp4").toString("base64");
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer fixture-iam");
    assert.equal(headers.get("x-goog-api-key"), null);
    if (url.endsWith(`/${resource}:predictLongRunning`)) {
      calls.push("submit");
      return jsonResponse({ name: operationName, done: false });
    }
    assert.ok(url.endsWith(`/${resource}:fetchPredictOperation`));
    calls.push("poll");
    return jsonResponse({ name: operationName, done: true, response: { videos: [{ bytesBase64Encoded: videoBytes, mimeType: "video/mp4" }] } });
  });
  const options = await createVeoVertexClientOptions(env, async () => { tokens++; return "fixture-subject"; });
  const ai = new GoogleGenAI(options);
  const operation = await ai.models.generateVideos({ model: "veo-3.1-fast-generate-001", source: { prompt: "Fixture" } });
  const result = await ai.operations.getVideosOperation({ operation });
  assert.equal(result.response?.generatedVideos?.[0]?.video?.videoBytes, videoBytes);
  assert.equal(result.response?.generatedVideos?.[0]?.video?.mimeType, "video/mp4");
  assert.equal(tokens, 1, "The service-account token remains cached between submit and poll");
  assert.deepEqual(calls, ["sts", "iam", "submit", "poll"]);
});

test("un échec IAM ne déclenche pas de reprises HTTP qui prolongent son délai", async (context) => {
  const calls: string[] = [];
  mockAuthFetch(context, async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === stsUrl) return authResponse(url);
    assert.equal(url, iamUrl);
    return new Response(JSON.stringify({ error: { message: "fixture_unavailable" } }), {
      status: 503, headers: { "content-type": "application/json" },
    });
  });
  const options = await createVeoVertexClientOptions(env, async () => "fixture-subject");
  const client = options.googleAuthOptions?.authClient;
  assert.ok(client);
  await assert.rejects(client.getRequestHeaders(), /fixture_unavailable/);
  assert.deepEqual(calls, [stsUrl, iamUrl]);
});

for (const blockedPhase of ["sts", "iam"] as const) {
  test(`un transport ${blockedPhase.toUpperCase()} bloqué échoue dans le délai WIF après une annulation SDK`, async (context) => {
    const options = await createVeoVertexClientOptions(env, async () => "fixture-subject");
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const calls: string[] = [];
    let reachedBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => { reachedBlocked = resolve; });
    let releaseBlocked = () => {};
    let transportAborted = false;
    mockAuthFetch(context, async (input, init) => {
      const url = String(input);
      assert.ok(url === stsUrl || url === iamUrl);
      const phase = url === stsUrl ? "sts" : "iam";
      calls.push(phase);
      if (phase !== blockedPhase) return authResponse(url);
      return new Promise<Response>((resolve, reject) => {
        releaseBlocked = () => resolve(authResponse(url));
        init?.signal?.addEventListener("abort", () => {
          transportAborted = true;
          reject(init.signal?.reason);
        }, { once: true });
        reachedBlocked();
      });
    });
    context.mock.method(globalThis, "fetch", async () => {
      assert.fail("A timed-out auth phase must not submit a video");
    });
    const controller = new AbortController();
    const ai = new GoogleGenAI(options);
    const pending = ai.models.generateVideos({ model: "veo-3.1-fast-generate-001", source: { prompt: "Fixture" }, config: { abortSignal: controller.signal, httpOptions: { timeout: 5 } } });
    const rejected = assert.rejects(pending, { message: "ai_video_veo_vertex_federation_timeout" });
    try {
      await blocked;
      controller.abort();
      context.mock.timers.tick(VEO_VERTEX_WIF_PHASE_TIMEOUT_MS);
      await rejected;
      // IAM's public transport is physically aborted. STS's private transport
      // may finish later, but its deadline already stopped the auth chain.
      assert.equal(transportAborted, blockedPhase === "iam");
      releaseBlocked();
      await nextTurn();
      assert.deepEqual(calls, blockedPhase === "sts" ? ["sts"] : ["sts", "iam"]);
    } finally {
      releaseBlocked();
    }
  });
}

test("un fournisseur de jeton bloqué expire avant tout échange Google", async (context) => {
  const options = await createVeoVertexClientOptions(env, () => new Promise<string>(() => {}));
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mockAuthFetch(context, async () => { assert.fail("No auth request may follow a blocked token supplier"); });
  const client = options.googleAuthOptions?.authClient;
  assert.ok(client);
  const rejected = assert.rejects(client.getRequestHeaders(), { message: "ai_video_veo_vertex_federation_timeout" });
  context.mock.timers.tick(VEO_VERTEX_WIF_PHASE_TIMEOUT_MS);
  await rejected;
});
