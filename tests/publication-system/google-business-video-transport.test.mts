import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GoogleBusinessPostTransportError,
  postGoogleBusinessLocalPost,
} from "../../lib/googleBusinessPostTransport.ts";
import {
  GOOGLE_BUSINESS_VIDEO_MAX_BYTES,
  getGoogleBusinessVideoPreparationDecision,
} from "../../lib/googleBusinessMediaPolicy.ts";
import { probeGoogleBusinessMediaUrl } from "../../lib/googleBusinessMediaProbe.ts";

const MIB = 1024 * 1024;
const GMB_ENDPOINT =
  "https://mybusiness.googleapis.com/v4/accounts/123/locations/456/localPosts";

function videoHeaders(contentLength?: number) {
  return {
    "Content-Type": "video/mp4",
    ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
  };
}

test("une source conforme de 75 Mo est envoyée directement à GMB", () => {
  assert.deepEqual(
    getGoogleBusinessVideoPreparationDecision({
      name: "master.mp4",
      type: "video/mp4",
      storagePath: "users/u/master.mp4",
      sizeBytes: 75_000_000,
      durationSeconds: 20,
      width: 1920,
      height: 1080,
      videoCodec: "h264",
      audioCodec: "aac",
      frameRate: 30,
      hasAudio: true,
      containerFormats: ["mov", "mp4"],
      pixelFormat: "yuv420p",
    }),
    { action: "direct", reason: "already_compatible" },
  );
  assert.equal(GOOGLE_BUSINESS_VIDEO_MAX_BYTES, 75_000_000);
});

test("le probe rejette 300 Mio sur HEAD sans retélécharger un seul octet", async () => {
  let calls = 0;
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    assert.equal(init?.method, "HEAD");
    return new Response(null, {
      status: 200,
      headers: videoHeaders(300 * MIB),
    });
  }) as typeof fetch;

  const result = await probeGoogleBusinessMediaUrl({
    url: "https://cdn.example.test/master.mp4",
    kind: "video",
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "file_too_large");
  assert.equal(calls, 1);
});

test("75 000 000 octets passent, 75 000 001 sont refusés", async () => {
  const probe = (contentLength: number) =>
    probeGoogleBusinessMediaUrl({
      url: "https://cdn.example.test/gmb.mp4",
      kind: "video",
      fetchImpl: (async () =>
        new Response(null, {
          status: 200,
          headers: videoHeaders(contentLength),
        })) as typeof fetch,
    });
  const accepted = await probe(75_000_000);
  const rejected = await probe(75_000_001);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.contentLength, 75_000_000);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "file_too_large");
});

test("un HEAD sans taille utilise uniquement GET bytes=0-0 et valide la Range", async () => {
  const methods: string[] = [];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    methods.push(String(init?.method || "GET"));
    if (init?.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: videoHeaders(),
      });
    }
    assert.equal(new Headers(init?.headers).get("range"), "bytes=0-0");
    return new Response(new Uint8Array([1]), {
      status: 206,
      headers: {
        ...videoHeaders(),
        "Content-Length": "1",
        "Content-Range": "bytes 0-0/75000000",
      },
    });
  }) as typeof fetch;
  const result = await probeGoogleBusinessMediaUrl({
    url: "https://cdn.example.test/gmb.mp4",
    kind: "video",
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.contentLength, 75_000_000);
  assert.deepEqual(methods, ["HEAD", "GET"]);
});

test("une URL Storage signée évite HEAD et utilise directement un GET borné", async () => {
  const methods: string[] = [];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    methods.push(String(init?.method || "GET"));
    assert.equal(new Headers(init?.headers).get("range"), "bytes=0-0");
    return new Response(new Uint8Array([1]), {
      status: 206,
      headers: {
        ...videoHeaders(),
        "Content-Length": "1",
        "Content-Range": "bytes 0-0/75000000",
      },
    });
  }) as typeof fetch;

  const result = await probeGoogleBusinessMediaUrl({
    url: "https://project.supabase.co/storage/v1/object/sign/booster/video.mp4?token=test",
    kind: "video",
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(methods, ["GET"]);
});

test("un serveur qui ignore Range n'est jamais autorisé à renvoyer la vidéo entière", async () => {
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: videoHeaders(),
      });
    }
    return new Response(new Uint8Array([1]), {
      status: 200,
      headers: videoHeaders(75_000_000),
    });
  }) as typeof fetch;
  const result = await probeGoogleBusinessMediaUrl({
    url: "https://cdn.example.test/gmb.mp4",
    kind: "video",
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "range_not_supported");
});

test("le Local Post envoie uniquement le JSON sourceUrl, jamais les octets vidéo", async () => {
  let observedBody = "";
  const result = await postGoogleBusinessLocalPost({
    endpoint: GMB_ENDPOINT,
    accessToken: "token",
    payload: {
      summary: "Actualité",
      topicType: "STANDARD",
      media: [
        {
          mediaFormat: "VIDEO",
          sourceUrl: "https://cdn.example.test/gmb.mp4",
        },
      ],
    },
    fetchImpl: (async (_input: string | URL | Request, init?: RequestInit) => {
      observedBody = String(init?.body || "");
      return Response.json({
        name: "accounts/123/locations/456/localPosts/789",
      });
    }) as typeof fetch,
  });
  assert.match(observedBody, /"mediaFormat":"VIDEO"/);
  assert.match(observedBody, /"sourceUrl":"https:\/\/cdn\.example\.test\/gmb\.mp4"/);
  assert.deepEqual(result, {
    name: "accounts/123/locations/456/localPosts/789",
  });
});

test("un timeout de création reste ambigu et n'est pas retenté aveuglément", async () => {
  let calls = 0;
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason || new Error("aborted")),
        { once: true },
      );
    });
  }) as typeof fetch;
  await assert.rejects(
    postGoogleBusinessLocalPost({
      endpoint: GMB_ENDPOINT,
      accessToken: "token",
      payload: { summary: "Actualité", topicType: "STANDARD" },
      fetchImpl,
      timeoutMs: 100,
    }),
    (error: unknown) =>
      error instanceof GoogleBusinessPostTransportError &&
      error.code === "gmb_local_post_timeout" &&
      error.outcomeUnknown &&
      !error.retryable,
  );
  assert.equal(calls, 1);
});

test("un HTTP 503 est classé relançable mais le transport ne crée pas de doublon seul", async () => {
  let calls = 0;
  await assert.rejects(
    postGoogleBusinessLocalPost({
      endpoint: GMB_ENDPOINT,
      accessToken: "token",
      payload: { summary: "Actualité", topicType: "STANDARD" },
      fetchImpl: (async () => {
        calls += 1;
        return Response.json(
          { error: { message: "backend unavailable" } },
          { status: 503 },
        );
      }) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof GoogleBusinessPostTransportError &&
      error.code === "gmb_local_post_http_error" &&
      error.status === 503 &&
      error.retryable &&
      !error.outcomeUnknown,
  );
  assert.equal(calls, 1);
});

test("sites et iNrSearch ne copient pas le master : ils conservent ses références", async () => {
  const publishNow = await readFile(
    new URL("../../app/api/booster/publish-now/route.ts", import.meta.url),
    "utf8",
  );
  const inrSearch = await readFile(
    new URL("../../lib/inrSearchPublic.ts", import.meta.url),
    "utf8",
  );
  const siteAt = publishNow.indexOf(
    'if (ch === "inrcy_site" || ch === "site_web")',
  );
  const siteBranch = publishNow.slice(
    siteAt,
    publishNow.indexOf('if (ch === "facebook")', siteAt),
  );
  assert.match(siteBranch, /video_url:\s*channelVideo\.publicUrl/);
  assert.match(siteBranch, /video_path:\s*channelVideo\.storagePath/);
  assert.doesNotMatch(siteBranch, /arrayBuffer\(|\.download\(|\bBuffer\b|new Blob/);

  const inrVideoAt = inrSearch.indexOf("function publicationVideoUrl");
  const inrVideoReader = inrSearch.slice(
    inrVideoAt,
    inrSearch.indexOf("function publicationVideoMime", inrVideoAt),
  );
  assert.match(inrVideoReader, /video\.publicUrl/);
  assert.doesNotMatch(inrVideoReader, /fetch\(|arrayBuffer\(|\.download\(|\bBuffer\b/);
});

test("iNrSend ne lance aucun fallback GMB après un résultat de création ambigu", async () => {
  const actions = await readFile(
    new URL("../../lib/inrsend/publicationChannelActions.ts", import.meta.url),
    "utf8",
  );
  const gmbAt = actions.indexOf("const publishGmb");
  const gmbFlow = actions.slice(
    gmbAt,
    actions.indexOf('if (channel === "tiktok")', gmbAt),
  );
  assert.match(gmbFlow, /isGoogleBusinessPostOutcomeUnknown\(gmbFirstError\)/);
  assert.match(gmbFlow, /isGoogleBusinessPostOutcomeUnknown\(repairPublishError\)/);
  assert.match(gmbFlow, /isGoogleBusinessPostOutcomeUnknown\(ctaError\)/);
});
