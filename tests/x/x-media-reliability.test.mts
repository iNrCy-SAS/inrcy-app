import assert from "node:assert/strict";
import test from "node:test";

import {
  XPublishError,
  createXPost,
  uploadXImage,
  uploadXVideoFromUrl,
} from "../../lib/xPublish.ts";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function asFetch(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  return implementation as typeof fetch;
}

test("static X images use the documented one-shot image endpoint with an explicit MIME type", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = asFetch(async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse({
      data: {
        id: "1880028106020515840",
        media_key: "3_1880028106020515840",
      },
    });
  });

  const result = await uploadXImage({
    accessToken: "token",
    bytes: Uint8Array.from([1, 2, 3]),
    mimeType: "image/png",
    fetchImpl,
  });

  assert.equal(result.mediaId, "1880028106020515840");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.x.com/2/media/upload");
  const body = JSON.parse(String(calls[0]?.init?.body || "{}"));
  assert.equal(body.media_category, "tweet_image");
  assert.equal(body.media_type, "image/png");
  assert.equal(body.media, Buffer.from([1, 2, 3]).toString("base64"));
});

test("GIFs always use INIT/APPEND/FINALIZE and retry only an idempotent failed segment", async () => {
  const calls: Array<{ url: string; init?: RequestInit; segmentIndex?: string }> = [];
  let firstSegmentAttempts = 0;
  const fetchImpl = asFetch(async (input, init) => {
    const url = String(input);
    const form = init?.body instanceof FormData ? init.body : null;
    const segmentIndex = form ? String(form.get("segment_index")) : undefined;
    calls.push({ url, init, segmentIndex });

    if (url.endsWith("/initialize")) {
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.media_type, "image/gif");
      assert.equal(body.media_category, "tweet_gif");
      return jsonResponse({ data: { id: "1880028106020515840" } });
    }
    if (url.endsWith("/append")) {
      if (segmentIndex === "0") {
        firstSegmentAttempts += 1;
        if (firstSegmentAttempts === 1) throw new Error("temporary transport error");
      }
      const media = form?.get("media");
      assert.ok(media instanceof Blob);
      assert.equal(media.type, "image/gif");
      return jsonResponse({ data: { expires_at: 1 } });
    }
    if (url.endsWith("/finalize")) {
      return jsonResponse({
        data: {
          id: "1880028106020515840",
          media_key: "3_1880028106020515840",
          processing_info: { state: "succeeded" },
        },
      });
    }
    throw new Error(`unexpected X call: ${url}`);
  });

  const result = await uploadXImage({
    accessToken: "token",
    bytes: new Uint8Array(4 * 1024 * 1024 + 1),
    mimeType: "image/gif",
    animatedGif: true,
    fetchImpl,
  });

  assert.equal(result.mediaId, "1880028106020515840");
  assert.equal(firstSegmentAttempts, 2);
  assert.deepEqual(
    calls.filter((call) => call.url.endsWith("/append")).map((call) => call.segmentIndex),
    ["0", "0", "1"],
  );
  assert.equal(calls.some((call) => call.url.endsWith("/finalize")), true);
  assert.equal(calls.some((call) => call.url.includes("command=STATUS")), false);
});

test("X media identifiers fail closed instead of confusing media_key with media_id", async () => {
  const fetchImpl = asFetch(async () =>
    jsonResponse({ data: { media_key: "3_1880028106020515840" } }),
  );

  await assert.rejects(
    uploadXImage({
      accessToken: "token",
      bytes: Uint8Array.from([1]),
      mimeType: "image/jpeg",
      fetchImpl,
    }),
    (error: unknown) =>
      error instanceof XPublishError && error.code === "x_media_id_missing",
  );

  let createCalls = 0;
  await assert.rejects(
    createXPost({
      accessToken: "token",
      text: "Post valide",
      mediaIds: ["3_1880028106020515840"],
      fetchImpl: asFetch(async () => {
        createCalls += 1;
        return jsonResponse({});
      }),
    }),
    (error: unknown) =>
      error instanceof XPublishError && error.code === "x_media_id_invalid",
  );
  assert.equal(createCalls, 0);
});

test("X video rejects provider-invalid duration and streamed size drift before Post creation", async () => {
  let calls = 0;
  await assert.rejects(
    uploadXVideoFromUrl({
      accessToken: "token",
      sourceUrl: "https://media.example/video.mp4",
      totalBytes: 3,
      mimeType: "video/mp4",
      durationSeconds: 140.01,
      fetchImpl: asFetch(async () => {
        calls += 1;
        return jsonResponse({});
      }),
    }),
    (error: unknown) =>
      error instanceof XPublishError && error.code === "x_video_duration_invalid",
  );
  assert.equal(calls, 0);

  const visited: string[] = [];
  const fetchImpl = asFetch(async (input) => {
    const url = String(input);
    visited.push(url);
    if (url.endsWith("/initialize")) {
      return jsonResponse({ data: { id: "1880028106020515840" } });
    }
    if (url === "https://media.example/video.mp4") {
      return new Response(Uint8Array.from([1, 2, 3]));
    }
    throw new Error(`unexpected X call: ${url}`);
  });
  await assert.rejects(
    uploadXVideoFromUrl({
      accessToken: "token",
      sourceUrl: "https://media.example/video.mp4",
      totalBytes: 2,
      mimeType: "video/mp4",
      durationSeconds: 5,
      fetchImpl,
    }),
    (error: unknown) =>
      error instanceof XPublishError && error.code === "x_video_source_size_mismatch",
  );
  assert.deepEqual(visited, [
    "https://api.x.com/2/media/upload/initialize",
    "https://media.example/video.mp4",
  ]);
});

test("a 5xx create response is delivery-unknown and is never advertised as retryable", async () => {
  let createCalls = 0;
  await assert.rejects(
    createXPost({
      accessToken: "token",
      text: "Un seul Post, jamais de doublon.",
      fetchImpl: asFetch(async () => {
        createCalls += 1;
        return jsonResponse({ title: "Temporary server error" }, 503);
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof XPublishError);
      assert.equal(error.code, "x_create_failed");
      assert.equal(error.retryable, false);
      assert.equal(error.deliveryUnknown, true);
      return true;
    },
  );
  assert.equal(createCalls, 1);
});

test("createXPost accepts at most four unique numeric media ids", async () => {
  let calls = 0;
  await assert.rejects(
    createXPost({
      accessToken: "token",
      mediaIds: ["1", "2", "3", "4", "5"],
      fetchImpl: asFetch(async () => {
        calls += 1;
        return jsonResponse({});
      }),
    }),
    (error: unknown) =>
      error instanceof XPublishError && error.code === "x_media_count_invalid",
  );
  assert.equal(calls, 0);
});

test("createXPost rejects every URL before calling the X API", async () => {
  for (const text of [
    "Voir https://example.com",
    "Voir example.fr",
    "Voir example [.] com",
    "Voir bit.ly/offre",
  ]) {
    let calls = 0;
    await assert.rejects(
      createXPost({
        accessToken: "token",
        text,
        mediaIds: ["1880028106020515840"],
        fetchImpl: asFetch(async () => {
          calls += 1;
          return jsonResponse({ data: { id: "1880028106020515841" } });
        }),
      }),
      (error: unknown) =>
        error instanceof XPublishError &&
        error.code === "x_url_forbidden" &&
        error.retryable === false,
    );
    assert.equal(calls, 0, text);
  }
});
