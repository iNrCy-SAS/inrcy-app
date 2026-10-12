import assert from "node:assert/strict";
import test from "node:test";
import { threadsPublish, threadsDeletePost, parseThreadsPublishCheckpoint, buildThreadsMediaSourceIdentity, type ThreadsMediaItem, type ThreadsPublishCheckpoint } from "../../lib/threadsPublish.ts";
import { THREADS_PUBLICATION_CAPABILITIES } from "../../lib/inrsend/threadsCapabilities.ts";

const fixedNow = () => new Date("2026-10-12T08:00:00Z");
const input = { userId: "123", accessToken: "secret-token", text: "Bonjour 👋" };
type Call = { url: URL; method: string; form: URLSearchParams };
function transport(handle: (call: Call) => unknown | Response) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    const call = { url: new URL(String(url)), method: options?.method || "GET", form: new URLSearchParams(String(options?.body || "")) };
    calls.push(call);
    assert.equal(call.url.hostname, "graph.threads.com");
    assert.equal(call.url.toString().includes("secret-token"), false);
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer secret-token");
    const result = handle(call);
    return result instanceof Response ? result : Response.json(result);
  };
  return { calls, fetchImpl, now: fixedNow };
}
function singleContainer(call: Call) {
  if (call.method === "POST" && call.url.pathname.endsWith("/threads")) return { id: "100" };
  if (call.method === "GET") return { id: "100", status: "FINISHED" };
  if (call.method === "POST" && call.url.pathname.endsWith("/threads_publish")) return { id: "200" };
  throw new Error("Unexpected request");
}

test("Threads creates and publishes TEXT, IMAGE and VIDEO with separate durable IDs", async () => {
  for (const media of [[], [{ type: "IMAGE", url: "https://media.test/photo.jpg" }], [{ type: "VIDEO", url: "https://media.test/video.mp4" }]] as ThreadsMediaItem[][]) {
    const snapshots: ThreadsPublishCheckpoint[] = [];
    const deps = transport((call) => {
      if (call.url.pathname.endsWith("/threads_publish")) assert.equal(snapshots.at(-1)?.state, "publish_unknown");
      return singleContainer(call);
    });
    const result = await threadsPublish({ ...input, media, onCheckpoint: async (cp) => { snapshots.push(cp); } }, deps);
    assert.equal(result.ok, true);
    assert.equal(result.checkpoint?.containerId, "100");
    assert.equal(result.ok && result.postId, "200");
    assert.equal(deps.calls[0].form.get("media_type"), media[0]?.type || "TEXT");
    assert.equal(deps.calls[2].form.get("creation_id"), "100");
    assert.equal(deps.calls[0].form.has("auto_publish_text"), false);
    assert.deepEqual(snapshots.map((cp) => cp.state), ["created", "ready", "publish_unknown", "published"]);
  }
});

test("Threads resumes a processing video without recreating the container", async () => {
  const media: ThreadsMediaItem[] = [{ type: "VIDEO", url: "https://media.test/video.mp4" }];
  const first = transport((call) => call.method === "POST" ? { id: "100" } : { status: "IN_PROGRESS" });
  const pending = await threadsPublish({ ...input, media }, first);
  assert.equal(pending.ok, false);
  assert.equal(!pending.ok && pending.code, "threads_processing");
  assert.equal(!pending.ok && pending.retryAfterMs, 60_000);
  const second = transport(singleContainer);
  const done = await threadsPublish({ ...input, media, checkpoint: pending.checkpoint }, second);
  assert.equal(done.ok, true);
  assert.deepEqual(second.calls.map((call) => call.method), ["GET", "POST"]);
  assert.equal(second.calls.some((call) => call.url.pathname.endsWith("/threads")), false);
});

test("Threads mixed carousel keeps children across polls and publishes only the parent", async () => {
  const media: ThreadsMediaItem[] = [{ type: "IMAGE", url: "https://media.test/1.jpg" }, { type: "VIDEO", url: "https://media.test/2.mp4" }];
  let created = 0;
  const first = transport((call) => {
    if (call.method === "POST") { assert.equal(call.form.get("is_carousel_item"), "true"); return { id: String(100 + created++) }; }
    return { status: call.url.pathname.endsWith("101") ? "IN_PROGRESS" : "FINISHED" };
  });
  const pending = await threadsPublish({ ...input, media }, first);
  assert.equal(!pending.ok && pending.code, "threads_processing");
  assert.deepEqual(pending.checkpoint?.childContainerIds, ["100", "101"]);
  const second = transport((call) => {
    if (call.method === "GET") return { status: "FINISHED" };
    if (call.url.pathname.endsWith("/threads")) { assert.equal(call.form.get("media_type"), "CAROUSEL"); assert.equal(call.form.get("children"), "100,101"); return { id: "102" }; }
    assert.equal(call.form.get("creation_id"), "102"); return { id: "200" };
  });
  const done = await threadsPublish({ ...input, media, checkpoint: pending.checkpoint }, second);
  assert.equal(done.ok && done.mediaType, "CAROUSEL");
  assert.equal(second.calls.filter((call) => call.form.has("is_carousel_item")).length, 0);
});

test("Threads refuses expired tokens, invalid text/media and foreign or changed checkpoints before any API call", async () => {
  const never = transport(() => { throw new Error("must not fetch"); });
  for (const invalid of [
    { ...input, text: "a".repeat(501) }, { ...input, expiresAt: "2026-10-11T08:00:00Z" },
    { ...input, text: "", media: [] }, { ...input, media: [{ type: "IMAGE" as const, url: "http://media.test/1.jpg" }] },
    { ...input, media: Array.from({ length: 21 }, () => ({ type: "IMAGE" as const, url: "https://media.test/1.jpg" })) },
  ]) assert.equal((await threadsPublish(invalid, never)).ok, false);
  const ready = await threadsPublish(input, transport(singleContainer));
  for (const changed of [{ ...input, userId: "999" }, { ...input, text: "Different" }]) {
    const result = await threadsPublish({ ...changed, checkpoint: ready.checkpoint }, never);
    assert.equal(!result.ok && result.code, "threads_checkpoint_invalid");
  }
  assert.equal(never.calls.length, 0);
  assert.equal(parseThreadsPublishCheckpoint({ ...ready.checkpoint, containerId: "../../foreign" }), null);
});

test("Threads authorization and rate-limit errors have explicit recovery semantics", async () => {
  for (const [status, code, expected, retryable] of [[400, 190, "threads_reconnect_required", false], [429, 4, "threads_rate_limited", true]] as const) {
    const result = await threadsPublish(input, transport(() => Response.json({ error: { code, message: "Meta refused" } }, { status })));
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, expected);
    assert.equal(!result.ok && result.retryable, retryable);
  }
});

test("Threads ERROR and EXPIRED containers are terminal and never published", async () => {
  for (const state of ["ERROR", "EXPIRED"]) {
    const deps = transport((call) => call.method === "POST" ? { id: "100" } : { status: state, error_message: "Unusable media" });
    const result = await threadsPublish(input, deps);
    assert.equal(!result.ok && result.retryable, false);
    assert.equal(result.checkpoint?.state, "failed");
    assert.equal(deps.calls.filter((call) => call.url.pathname.endsWith("/threads_publish")).length, 0);
    const never = transport(() => { throw new Error("no retry"); });
    assert.equal((await threadsPublish({ ...input, checkpoint: result.checkpoint }, never)).ok, false);
    assert.equal(never.calls.length, 0);
  }
});

test("Threads publish timeouts persist ambiguity and prevent any automatic replay", async () => {
  let persisted: ThreadsPublishCheckpoint | undefined;
  const deps = transport((call) => {
    if (call.url.pathname.endsWith("/threads_publish")) { assert.equal(persisted?.state, "publish_unknown"); throw new Error("Network interruption"); }
    return singleContainer(call);
  });
  const result = await threadsPublish({ ...input, onCheckpoint: async (cp) => { persisted = cp; } }, deps);
  assert.equal(!result.ok && result.code, "threads_publish_ambiguous");
  assert.equal(!result.ok && result.requestMayHaveSucceeded, true);
  const never = transport(() => { throw new Error("no replay"); });
  const resumed = await threadsPublish({ ...input, checkpoint: persisted }, never);
  assert.equal(!resumed.ok && resumed.retryable, false);
  assert.equal(never.calls.length, 0);
});

test("Threads confirmed publication is idempotent, including after a lost local response", async () => {
  const done = await threadsPublish(input, transport(singleContainer));
  const never = transport(() => { throw new Error("no replay"); });
  const resumed = await threadsPublish({ ...input, checkpoint: done.checkpoint }, never);
  assert.equal(resumed.ok && resumed.postId, "200");
  assert.equal(never.calls.length, 0);
});

test("Threads deletion uses the published ID and requires explicit remote success", async () => {
  const deps = transport((call) => { assert.equal(call.method, "DELETE"); assert.equal(call.url.pathname, "/v1.0/200"); return { success: true }; });
  assert.deepEqual(await threadsDeletePost({ postId: "200", accessToken: "secret-token" }, deps), { ok: true, postId: "200" });
  await assert.rejects(threadsDeletePost({ postId: "200", accessToken: "secret-token" }, transport(() => ({ success: false }))));
  await assert.rejects(threadsDeletePost({ postId: "200", accessToken: "secret-token" }, transport(() => Response.json({ error: { code: 190 } }, { status: 401 }))));
});

test("Threads history advertises draft editing, native deletion and failed retries without native published edits", () => {
  assert.equal(THREADS_PUBLICATION_CAPABILITIES.editDraft, true);
  assert.equal(THREADS_PUBLICATION_CAPABILITIES.editPublished, false);
  assert.equal(THREADS_PUBLICATION_CAPABILITIES.deletePublished, true);
  assert.equal(THREADS_PUBLICATION_CAPABILITIES.retryFailed, true);
  assert.match(THREADS_PUBLICATION_CAPABILITIES.documentationUrl, /^https:\/\/www.postman.com\/meta\/threads\//);
});

test("Threads signed video URLs may rotate while a server-owned storage object stays identical", async () => {
  const sourceIdentity = buildThreadsMediaSourceIdentity({ bucket: "medias_pro", storagePath: "user/video.mp4" });
  const media: ThreadsMediaItem[] = [{ type: "VIDEO", url: "https://storage.test/object/sign/medias_pro/user/video.mp4?token=first", sourceIdentity }];
  const first = await threadsPublish({ ...input, media }, transport((call) => call.method === "POST" ? { id: "100" } : { status: "IN_PROGRESS" }));
  assert.equal(!first.ok && first.code, "threads_processing");
  const refreshedMedia = [{ ...media[0], url: media[0].url.replace("token=first", "token=refreshed") }];
  const next = transport(singleContainer);
  const done = await threadsPublish({ ...input, media: refreshedMedia, checkpoint: first.checkpoint }, next);
  assert.equal(done.ok && done.postId, "200");
  assert.deepEqual(next.calls.map((call) => call.method), ["GET", "POST"]);
  assert.equal(done.checkpoint?.containerId, "100");
  const foreign = transport(() => { throw new Error("must not fetch another object"); });
  for (const changedIdentity of [
    buildThreadsMediaSourceIdentity({ bucket: "medias_pro", storagePath: "user/other.mp4" }),
    buildThreadsMediaSourceIdentity({ bucket: "other_bucket", storagePath: "user/video.mp4" }),
  ]) {
    const rejected = await threadsPublish({ ...input, media: [{ ...refreshedMedia[0], sourceIdentity: changedIdentity }], checkpoint: first.checkpoint }, foreign);
    assert.equal(!rejected.ok && rejected.code, "threads_checkpoint_invalid");
  }
  assert.equal(foreign.calls.length, 0);
});

test("Threads mixed carousel reuses its image and video containers after signed URL renewal", async () => {
  const media: ThreadsMediaItem[] = [
    { type: "IMAGE", url: "https://storage.test/image.jpg?token=first", sourceIdentity: buildThreadsMediaSourceIdentity({ bucket: "booster", storagePath: "user/image.jpg" }) },
    { type: "VIDEO", url: "https://storage.test/video.mp4?token=first", sourceIdentity: buildThreadsMediaSourceIdentity({ bucket: "medias_pro", storagePath: "user/video.mp4" }) },
  ];
  let child = 100;
  const first = await threadsPublish({ ...input, media }, transport((call) => call.method === "POST" ? { id: String(child++) } : { status: call.url.pathname.endsWith("101") ? "IN_PROGRESS" : "FINISHED" }));
  const next = transport((call) => {
    if (call.method === "GET") return { status: "FINISHED" };
    if (call.url.pathname.endsWith("/threads")) { assert.equal(call.form.has("is_carousel_item"), false); assert.equal(call.form.get("children"), "100,101"); return { id: "102" }; }
    assert.equal(call.form.get("creation_id"), "102"); return { id: "200" };
  });
  const done = await threadsPublish({ ...input, media: media.map((item) => ({ ...item, url: item.url.replace("token=first", "token=refreshed") })), checkpoint: first.checkpoint }, next);
  assert.equal(done.ok && done.postId, "200");
  assert.deepEqual(done.checkpoint?.childContainerIds, ["100", "101"]);
});

test("Threads URL-only media retains strict URL matching and rejects invalid storage identities", async () => {
  const media: ThreadsMediaItem[] = [{ type: "VIDEO", url: "https://remote.test/video?token=first" }];
  const first = await threadsPublish({ ...input, media }, transport((call) => call.method === "POST" ? { id: "100" } : { status: "IN_PROGRESS" }));
  const never = transport(() => { throw new Error("must not fetch"); });
  const rejected = await threadsPublish({ ...input, media: [{ ...media[0], url: "https://remote.test/video?token=another" }], checkpoint: first.checkpoint }, never);
  assert.equal(!rejected.ok && rejected.code, "threads_checkpoint_invalid");
  assert.equal(never.calls.length, 0);
  for (const storagePath of ["", "user/../foreign.mp4", "user\\video.mp4"]) assert.equal(buildThreadsMediaSourceIdentity({ bucket: "medias_pro", storagePath }), undefined);
});

test("Ghost creates a TEXT container with is_ghost_post and keeps its format throughout durable publication", async () => {
  const snapshots: ThreadsPublishCheckpoint[] = [];
  const deps = transport(singleContainer);
  const result = await threadsPublish({ ...input, publicationMode: "ghost", onCheckpoint: async (cp) => { snapshots.push(cp); } }, deps);
  assert.equal(result.ok && result.publicationMode, "ghost");
  assert.equal(result.checkpoint?.publicationMode, "ghost");
  assert.equal(deps.calls[0].form.get("media_type"), "TEXT");
  assert.equal(deps.calls[0].form.get("is_ghost_post"), "true");
  assert.equal(deps.calls[0].form.has("auto_publish_text"), false);
  assert.equal(snapshots.every((cp) => cp.publicationMode === "ghost"), true);
  const classic = transport(singleContainer);
  assert.equal((await threadsPublish(input, classic)).ok, true);
  assert.equal(classic.calls[0].form.has("is_ghost_post"), false);
});

test("Ghost rejects images, video and carousel before any remote request", async () => {
  const never = transport(() => { throw new Error("must not fetch"); });
  for (const media of [
    [{ type: "IMAGE", url: "https://media.test/image.jpg" }],
    [{ type: "VIDEO", url: "https://media.test/video.mp4" }],
    [{ type: "IMAGE", url: "https://media.test/image.jpg" }, { type: "VIDEO", url: "https://media.test/video.mp4" }],
  ] as ThreadsMediaItem[][]) {
    const result = await threadsPublish({ ...input, publicationMode: "ghost", media }, never);
    assert.equal(!result.ok && result.code, "threads_ghost_media_unsupported");
    assert.equal(!result.ok && result.retryable, false);
  }
  assert.equal(never.calls.length, 0);
});

test("Ghost container resumes unchanged; Classic/Ghost drift and legacy checkpoint upgrade are refused", async () => {
  const pending = await threadsPublish({ ...input, publicationMode: "ghost" }, transport((call) => call.method === "POST" ? { id: "100" } : { status: "IN_PROGRESS" }));
  const next = transport(singleContainer);
  const done = await threadsPublish({ ...input, publicationMode: "ghost", checkpoint: pending.checkpoint }, next);
  assert.equal(done.ok && done.publicationMode, "ghost");
  assert.deepEqual(next.calls.map((call) => call.method), ["GET", "POST"]);
  const classic = await threadsPublish(input, transport((call) => call.method === "POST" ? { id: "100" } : { status: "IN_PROGRESS" }));
  const legacy = { ...classic.checkpoint }; delete legacy.publicationMode;
  const never = transport(() => { throw new Error("must not fetch"); });
  for (const changed of [
    { ...input, publicationMode: "classic" as const, checkpoint: pending.checkpoint },
    { ...input, publicationMode: "ghost" as const, checkpoint: legacy },
    { ...input, publicationMode: "ghost" as const, checkpoint: { ...classic.checkpoint, publicationMode: "ghost" } },
  ]) assert.equal(!((await threadsPublish(changed, never)).ok), true);
  assert.equal(never.calls.length, 0);
  const resumedLegacy = await threadsPublish({ ...input, checkpoint: legacy }, transport(singleContainer));
  assert.equal(resumedLegacy.ok && resumedLegacy.publicationMode, "classic");
});

test("An ambiguous Ghost publication can never replay as Ghost or Classic", async () => {
  const attempt = transport((call) => {
    if (call.url.pathname.endsWith("threads_publish")) throw new Error("Lost remote response");
    return singleContainer(call);
  });
  const result = await threadsPublish({ ...input, publicationMode: "ghost" }, attempt);
  assert.equal(!result.ok && result.code, "threads_publish_ambiguous");
  assert.equal(result.checkpoint?.publicationMode, "ghost");
  const never = transport(() => { throw new Error("must not fetch"); });
  for (const publicationMode of ["ghost", "classic"] as const) assert.equal((await threadsPublish({ ...input, publicationMode, checkpoint: result.checkpoint }, never)).ok, false);
  assert.equal(never.calls.length, 0);
});
