import assert from "node:assert/strict";
import test from "node:test";
import { hydrateStudioReferenceMemory, prepareStudioReferenceMemory, requestStudioReferenceMemory, studioReferenceDraftFingerprint, studioReferenceImageFile, type StudioReferenceDraft } from "../../lib/studioReferenceMemoryClient.ts";
import type { StudioReferenceMemory, StudioReferencesResponse } from "../../lib/studioReferences.ts";

const id = (last: number) => `00000000-0000-4000-8000-${String(last).padStart(12, "0")}`;
const sample = (last: number) => ({ path: `_studio-voice-references/test/account-a__${last}.wav`, name: `voice-${last}.wav`,
  mimeType: "audio/wav" as const, durationSeconds: 6, sizeBytes: 192_044, libraryMediaId: id(last) });
function draft(): StudioReferenceDraft {
  return { references: [{ id: id(1), name: "portrait.png", data: Buffer.from("normalised-image").toString("base64"), mimeType: "image/jpeg",
    role: "character", usage: "required", voiceMode: "provided", characterName: "David", fromVideo: false },
  { id: id(2), name: "environment.jpg", data: Buffer.from("other-image").toString("base64"), mimeType: "image/jpeg",
    role: "environment", usage: "inspiration", fromVideo: false, libraryMediaId: id(12) }],
  voices: [{ id: id(3), sample: sample(13), target: { characterId: id(1) }, gender: "male" },
    { id: id(4), sample: sample(14), target: "narration", gender: "female" }], activeNarrationVoiceId: id(4) };
}
function scope() { const controller = new AbortController(); return { controller, accountId: "account-a", signal: controller.signal, isCurrent: () => true }; }
function reply(memory: StudioReferenceMemory | null): StudioReferencesResponse {
  return { ok: true, accountId: "account-a", memory, media: [], unavailableMediaIds: [] };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }
async function withFetch(run: (requests: Array<{ url: string; init: RequestInit }>, set: (handler: (url: string, init: RequestInit) => Promise<Response>) => void) => Promise<void>) {
  const previous = globalThis.fetch; const requests: Array<{ url: string; init: RequestInit }> = [];
  let handler: (url: string, init: RequestInit) => Promise<Response> = async () => { throw new Error("Unexpected offline IO"); };
  globalThis.fetch = async (url, init = {}) => { requests.push({ url: String(url), init }); return handler(String(url), init); };
  try { await run(requests, next => { handler = next; }); } finally { globalThis.fetch = previous; }
}

test("saving remembers stable photo/voice links and uploads only images without a library ID", async () => {
  const current = draft(); const uploads: File[] = []; const recorded: Array<[string, string]> = [];
  const memory = await prepareStudioReferenceMemory(current, scope(), async file => { uploads.push(file); return id(11); }, (...args) => { recorded.push(args); });
  assert.equal(uploads.length, 1); assert.equal(uploads[0].name, "portrait.jpg"); assert.equal(uploads[0].type, "image/jpeg");
  assert.equal(await uploads[0].text(), "normalised-image"); assert.deepEqual(recorded, [[id(1), id(11)]]);
  assert.deepEqual(memory.references.map(reference => reference.mediaLibraryId), [id(11), id(12)]);
  assert.deepEqual(memory.voices[0].target, { referenceId: id(1) }); assert.equal(memory.references[0].characterName, "David");
  assert.equal(memory.activeNarrationVoiceId, id(4));
  assert.doesNotMatch(JSON.stringify(memory), /normalised-image|data:|_studio-voice|consent|dialogue|prompt|engine|duration/);
  assert.equal(current.references[0].libraryMediaId, undefined, "the helper does not mutate the creative draft");
});

test("all validation happens before uploading: missing voice, incomplete role and invalid linkage fail without IO", async () => {
  for (const change of [(value: StudioReferenceDraft) => { delete value.voices[0].sample.libraryMediaId; },
    (value: StudioReferenceDraft) => { delete value.references[0].role; },
    (value: StudioReferenceDraft) => { value.voices[0].target = { characterId: id(2) }; }]) {
    const value = draft(); change(value); let uploads = 0;
    await assert.rejects(prepareStudioReferenceMemory(value, scope(), async () => { uploads++; return id(11); }, () => {}));
    assert.equal(uploads, 0);
  }
});

test("an uploaded image ID is retained for retry when a later image upload fails", async () => {
  const value = draft(); delete value.references[1].libraryMediaId; let uploads = 0;
  const onUploaded = (referenceId: string, mediaId: string) => { value.references.find(reference => reference.id === referenceId)!.libraryMediaId = mediaId; };
  await assert.rejects(prepareStudioReferenceMemory(value, scope(), async () => { if (++uploads === 2) throw new Error("offline"); return id(11); }, onUploaded));
  const result = await prepareStudioReferenceMemory(value, scope(), async () => { uploads++; return id(12); }, onUploaded);
  assert.equal(uploads, 3, "the successful first image is not uploaded twice");
  assert.deepEqual(result.references.map(reference => reference.mediaLibraryId), [id(11), id(12)]);
});

test("memory fingerprints ignore refreshed temporary WAV paths and track actual names, roles and voice assignments", () => {
  const value = draft(); const fingerprint = studioReferenceDraftFingerprint(value);
  value.voices[0].sample.path = "_studio-voice-references/next-temporary.wav"; value.references[0].libraryMediaId = id(11);
  assert.equal(studioReferenceDraftFingerprint(value), fingerprint);
  value.references[0].characterName = "Marie"; assert.notEqual(studioReferenceDraftFingerprint(value), fingerprint);
  value.references[0].characterName = "David"; value.voices[0].target = null;
  assert.notEqual(studioReferenceDraftFingerprint(value), fingerprint);
});

test("memory requests pin the active professional, confirm the exact persisted selection and forget only the memory", async () => {
  const memory = await prepareStudioReferenceMemory(draft(), scope(), async () => id(11), () => {});
  await withFetch(async (requests, set) => {
    set(async (_url, init) => Response.json(reply(init.method === "DELETE" ? null : memory)));
    await requestStudioReferenceMemory("GET", scope());
    await requestStudioReferenceMemory("PUT", scope(), memory);
    await requestStudioReferenceMemory("DELETE", scope());
    assert.deepEqual(requests.map(request => request.init.method), ["GET", "PUT", "DELETE"]);
    for (const request of requests) {
      assert.equal(request.url, "/api/media-generation/references"); assert.equal(request.init.credentials, "include");
      assert.equal((request.init.headers as Record<string, string>)["X-Inrcy-Account-Id"], "account-a");
    }
    assert.deepEqual(JSON.parse(String(requests[1].init.body)), memory);
    assert.equal(requests[2].init.body, undefined, "forget is not an asset deletion request");
  });
});

test("a wrong account or an unconfirmed write cannot produce a successful save", async () => {
  const memory = await prepareStudioReferenceMemory(draft(), scope(), async () => id(11), () => {});
  await withFetch(async (_requests, set) => {
    set(async () => Response.json({ ...reply(memory), accountId: "account-b" }));
    await assert.rejects(requestStudioReferenceMemory("GET", scope()));
    set(async () => Response.json(reply(null)));
    await assert.rejects(requestStudioReferenceMemory("PUT", scope(), memory));
    set(async () => Response.json(reply(memory)));
    await assert.rejects(requestStudioReferenceMemory("DELETE", scope()));
  });
});

test("account invalidation after a pending response prevents applying it, and invalidation before a request performs no IO", async () => {
  await withFetch(async (requests, set) => {
    let current = false; const guarded = { ...scope(), isCurrent: () => current };
    await assert.rejects(requestStudioReferenceMemory("GET", guarded)); assert.equal(requests.length, 0);
    current = true; const waiting = deferred<Response>(); set(async () => waiting.promise);
    const load = requestStudioReferenceMemory("GET", guarded); current = false; waiting.resolve(Response.json(reply(null)));
    await assert.rejects(load);
  });
});

test("fresh hydration restores photo names and dedicated voices by IDs even when server media metadata is reversed", async () => {
  const memory = await prepareStudioReferenceMemory(draft(), scope(), async () => id(11), () => {});
  const response = reply(memory); response.media = [id(12), id(11)].map((mediaId, index) => ({ id: mediaId, media_type: "image",
    signed_url: `/private/photo-${mediaId}`, original_file_name: index ? "portrait.jpg" : "environment.jpg", mime_type: "image/jpeg", title: null,
    size_bytes: 16, width: 80, height: 80, duration_seconds: null }));
  await withFetch(async (requests, set) => {
    set(async (url, init) => {
      if (url.startsWith("/private/")) return new Response("image", { headers: { "content-type": "image/jpeg" } });
      assert.equal(url, "/api/media-generation/voice-reference");
      const mediaId = JSON.parse(String(init.body)).mediaLibraryId;
      return Response.json({ ok: true, sample: sample(mediaId === id(13) ? 13 : 14) });
    });
    const restored = await hydrateStudioReferenceMemory(response, scope(), async file => ({ name: file.name, mimeType: "image/jpeg", data: Buffer.from(await file.arrayBuffer()).toString("base64") }));
    assert.ok(restored); assert.deepEqual(restored.references.map(reference => reference.id), [id(1), id(2)]);
    assert.equal(restored.references[0].characterName, "David"); assert.equal(restored.references[0].libraryMediaId, id(11));
    assert.deepEqual(restored.voices[0].target, { characterId: id(1) }); assert.equal(restored.voices[0].sample.libraryMediaId, id(13));
    assert.equal(restored.activeNarrationVoiceId, id(4));
    assert.deepEqual(requests.filter(request => request.init.method === "POST").map(request => JSON.parse(String(request.init.body))), [{ mediaLibraryId: id(13) }, { mediaLibraryId: id(14) }]);
    assert.doesNotMatch(JSON.stringify(restored), /consent|dialogue|prompt|engine|durationSeconds":(?!6)/);
  });
});

test("an unavailable saved asset never becomes a different person's voice or a silent AI fallback", async () => {
  const memory = await prepareStudioReferenceMemory(draft(), scope(), async () => id(11), () => {});
  await withFetch(async (requests) => {
    const response = reply(memory); response.unavailableMediaIds = [id(13)];
    await assert.rejects(hydrateStudioReferenceMemory(response, scope(), async () => { assert.fail("no image conversion"); }));
    assert.equal(requests.length, 0);
  });
});

test("a late or failed voice restoration removes only newly recreated temporary WAVs", async () => {
  const value = draft(); value.references = []; value.voices[0].target = null;
  const memory = await prepareStudioReferenceMemory(value, scope(), async () => { assert.fail("no image upload"); }, () => {});
  for (const abort of [false, true]) await withFetch(async (requests, set) => {
    const guarded = scope(); let posts = 0;
    set(async (_url, init) => {
      if (init.method === "DELETE") return Response.json({ ok: true });
      if (++posts === 1) { if (abort) guarded.controller.abort(); return Response.json({ ok: true, sample: sample(13) }); }
      return Response.json({ ok: false }, { status: 503 });
    });
    await assert.rejects(hydrateStudioReferenceMemory(reply(memory), guarded, async () => { assert.fail("no image conversion"); }));
    const cleanup = requests.filter(request => request.init.method === "DELETE");
    assert.equal(cleanup.length, 1); assert.match(cleanup[0].url, /^\/api\/media-generation\/voice-reference\?path=/);
    assert.equal((cleanup[0].init.headers as Record<string, string>)["X-Inrcy-Account-Id"], "account-a");
    assert.ok(!requests.some(request => request.url.includes("media-library")));
  });
});

test("normalised image files use their actual format and a safe base name", () => {
  const reference = draft().references[0]; reference.name = "C:\\private\\portrait.png";
  const file = studioReferenceImageFile(reference);
  assert.equal(file.name, "portrait.jpg"); assert.equal(file.type, "image/jpeg"); assert.equal(file.size, 16);
});
