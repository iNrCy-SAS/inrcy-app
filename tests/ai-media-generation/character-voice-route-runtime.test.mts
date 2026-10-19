import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT, load, sample, voicePath, wav } from "./character-voice-runtime-fixtures.mts";
import { AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES } from "../../lib/aiMediaCharacterVoices.ts";

const LIBRARY_ID = "00000000-0000-4000-8000-000000000001";
function routeRuntime(options: { authError?: boolean; limited?: boolean; normalizeError?: string; storageError?: string; persistError?: string; libraryReadError?: string; cleanupError?: string } = {}) {
  const calls: { operation: string; args: Record<string, unknown> }[] = [];
  const authResponse = Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const limitedResponse = Response.json({ ok: false, code: "voice_upload_rate_limit" }, { status: 429 });
  const route = load<typeof import("../../app/api/media-generation/voice-reference/route.ts")>("app/api/media-generation/voice-reference/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/requireUser": { requireUser: async () => { calls.push({ operation: "auth", args: {} }); return { activeUserId: ACCOUNT, errorResponse: options.authError ? authResponse : null }; } },
    "@/lib/rateLimit": { enforceRateLimit: async (args: Record<string, unknown>) => { calls.push({ operation: "rate", args }); return options.limited ? limitedResponse : null; } },
    "@/lib/aiMediaCharacterVoiceAudio": { normalizeAiMediaCharacterVoiceAudio: async (args: Record<string, unknown>) => {
      calls.push({ operation: "normalize", args }); if (options.normalizeError) throw new Error(options.normalizeError);
      return { buffer: wav(), durationSeconds: 2, mimeType: "audio/wav" };
    } },
    "@/lib/aiMediaCharacterVoiceStorage": {
      saveAiMediaCharacterVoice: async (args: Record<string, unknown>) => { calls.push({ operation: "save", args }); if (options.storageError) throw new Error(options.storageError); return sample(); },
      readAiMediaCharacterVoice: async (args: Record<string, unknown>) => { calls.push({ operation: "read", args }); if (options.storageError) throw new Error(options.storageError); return { buffer: wav() }; },
      removeAiMediaCharacterVoice: async (args: Record<string, unknown>) => { calls.push({ operation: "remove", args }); if (options.cleanupError || options.storageError) throw new Error(options.cleanupError || options.storageError); },
    },
    "@/lib/aiMediaCharacterVoiceLibrary": { readAiMediaCharacterVoiceFromLibrary: async (args: Record<string, unknown>) => {
      calls.push({ operation: "library-read", args }); if (options.libraryReadError) throw new Error(options.libraryReadError);
      return { buffer: wav(), name: "existing-voice.mp3", mediaId: LIBRARY_ID };
    } },
    "@/lib/mediaLibraryAudioStorage": { saveMediaLibraryAudio: async (args: Record<string, unknown>) => {
      calls.push({ operation: "library-save", args }); if (options.persistError) throw new Error(options.persistError);
      return { id: LIBRARY_ID };
    } },
  });
  return { route, calls, authResponse, limitedResponse };
}

function upload(type = "audio/wav", name = "sample.wav", source?: string, bytes = Buffer.from("real bytes inspected by normalizer")) {
  const form = new FormData(); form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  if (source) form.append("source", source);
  return new Request("http://localhost/api/media-generation/voice-reference", { method: "POST", body: form });
}

test("all voice endpoints authenticate before reading request data or touching Storage", async () => {
  for (const method of ["POST", "GET", "DELETE"] as const) {
    const runtime = routeRuntime({ authError: true });
    const response = await runtime.route[method](new Request("http://localhost/voice", { method }));
    assert.equal(response, runtime.authResponse); assert.deepEqual(runtime.calls.map((call) => call.operation), ["auth"]);
  }
});

test("uploads are limited per active account with a fail-closed rate gate before multipart parsing", async () => {
  const runtime = routeRuntime({ limited: true });
  const response = await runtime.route.POST(upload());
  assert.equal(response, runtime.limitedResponse);
  assert.deepEqual(runtime.calls, [{ operation: "auth", args: {} }, { operation: "rate", args: {
    name: "studio_character_voice_upload", identifier: ACCOUNT, limit: 18, fallbackLimit: 9,
    window: "10 m", failClosed: true, code: "voice_upload_rate_limit",
  } }]);
});

test("MP3/WAV imports and declared browser recordings pass bytes through normalization and account-scoped saving", async () => {
  for (const [type, name, source] of [
    ["audio/mpeg", "voice.mp3"], ["audio/x-wav", "voice.wav"], ["application/octet-stream", "voice.mp3"],
    ["audio/webm;codecs=opus", "recording.webm", "recording"], ["audio/ogg", "recording.ogg", "recording"], ["audio/mp4", "recording.m4a", "recording"],
  ]) {
    const runtime = routeRuntime();
    const request = upload(type, name, source);
    const response = await runtime.route.POST(request);
    assert.equal(response.status, 200, type);
    assert.deepEqual(await response.json(), { ok: true, sample: { ...sample(), libraryMediaId: LIBRARY_ID } });
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const normalized = runtime.calls.find((call) => call.operation === "normalize")!;
    assert.equal(normalized.args.signal, request.signal); assert.ok(Buffer.isBuffer(normalized.args.buffer));
    assert.equal(normalized.args.recording, source === "recording");
    const saved = runtime.calls.find((call) => call.operation === "save")!;
    assert.equal(saved.args.accountId, ACCOUNT); assert.equal(saved.args.name, name); assert.deepEqual(saved.args.buffer, wav());
    assert.deepEqual(runtime.calls.find((call) => call.operation === "library-save")?.args, {
      accountId: ACCOUNT, name: `${name.replace(/\.[^.]+$/, "")}.wav`, buffer: wav(), mimeType: "audio/wav", durationSeconds: 2, source: "studio_character_voice",
    });
    assert.deepEqual(runtime.calls.map((call) => call.operation), ["auth", "rate", "normalize", "save", "library-save"]);
  }
});

test("unsupported imports, empty files and files above 3 MB never reach the decoder or Storage", async () => {
  for (const request of [
    upload("audio/webm", "recording.webm"), upload("text/html", "voice.wav"), upload("audio/mpeg", "voice.mp3", undefined, Buffer.alloc(0)),
    upload("audio/mpeg", "voice.mp3", undefined, Buffer.alloc(AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES + 1)),
    new Request("http://localhost/voice", { method: "POST", body: JSON.stringify({ file: "bogus" }), headers: { "content-type": "application/json" } }),
  ]) {
    const runtime = routeRuntime();
    const response = await runtime.route.POST(request);
    assert.equal(response.status, 400);
    assert.deepEqual(runtime.calls.map((call) => call.operation), ["auth", "rate"]);
  }
});

test("multipart stream size is bounded even without a Content-Length header", async () => {
  let cancelled = false;
  const request = new Request("http://localhost/voice", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=voice" },
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES + 64 * 1024 + 1)); }, cancel() { cancelled = true; } }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const runtime = routeRuntime();
  const response = await runtime.route.POST(request);
  assert.equal(response.status, 400); assert.equal(cancelled, true);
  assert.equal((await response.json()).code, "voice_audio_size_invalid");
  assert.deepEqual(runtime.calls.map((call) => call.operation), ["auth", "rate"]);
});

test("declared oversized multipart requests are rejected before reading their stream", async () => {
  let consumed = false;
  const request = new Request("http://localhost/voice", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=voice", "content-length": "999999999" },
    body: new ReadableStream({ pull() { consumed = true; } }, { highWaterMark: 0 }), duplex: "half",
  } as RequestInit & { duplex: "half" });
  const runtime = routeRuntime();
  const response = await runtime.route.POST(request);
  assert.equal(response.status, 400);
  assert.equal(runtime.calls.some((call) => call.operation === "normalize"), false);
  assert.equal(consumed, false);
});

test("normalization and Storage errors produce bounded client-safe responses", async () => {
  for (const [options, code, status] of [
    [{ normalizeError: "voice_audio_duration_invalid" }, "voice_audio_duration_invalid", 400],
    [{ normalizeError: "decoder failed https://private.invalid?token=secret" }, "voice_upload_failed", 400],
    [{ storageError: "voice_storage_unavailable" }, "voice_storage_unavailable", 503],
  ] as const) {
    const runtime = routeRuntime(options);
    const response = await runtime.route.POST(upload());
    assert.equal(response.status, status);
    const payload = await response.json(); assert.equal(payload.code, code); assert.doesNotMatch(JSON.stringify(payload), /token=secret|private\.invalid/);
    if (options.normalizeError) assert.equal(runtime.calls.some((call) => call.operation === "save"), false);
  }
});

test("preview and deletion pass active-account ownership through and never cache private audio", async () => {
  const runtime = routeRuntime();
  const url = `http://localhost/voice?path=${encodeURIComponent(voicePath())}`;
  const request = new Request(url);
  const response = await runtime.route.GET(request);
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "audio/wav");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), wav());
  assert.deepEqual(runtime.calls.find((call) => call.operation === "read")?.args, { accountId: ACCOUNT, path: voicePath(), signal: request.signal });
  const deleted = await runtime.route.DELETE(new Request(url, { method: "DELETE" }));
  assert.deepEqual(await deleted.json(), { ok: true });
  assert.deepEqual(runtime.calls.find((call) => call.operation === "remove")?.args, { accountId: ACCOUNT, path: voicePath() });
  assert.ok(runtime.calls.every((call) => !call.operation.startsWith("library-")), "Preview and removal only touch the temporary sample");
});

test("choosing an existing library vocal creates only a temporary copy and preserves its library identifier", async () => {
  const runtime = routeRuntime();
  const request = new Request("http://localhost/voice", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ mediaLibraryId: LIBRARY_ID, accountId: "untrusted-other-account", url: "https://untrusted.invalid/audio.wav", recording: true }),
  });
  const response = await runtime.route.POST(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, sample: { ...sample(), libraryMediaId: LIBRARY_ID } });
  assert.deepEqual(runtime.calls.map((call) => call.operation), ["auth", "rate", "library-read", "normalize", "save"]);
  assert.deepEqual(runtime.calls.find((call) => call.operation === "library-read")?.args, { accountId: ACCOUNT, mediaId: LIBRARY_ID, signal: request.signal });
  assert.deepEqual(runtime.calls.find((call) => call.operation === "normalize")?.args, { buffer: wav(), signal: request.signal }, "An imported library vocal cannot enable recorder trimming");
  assert.equal(runtime.calls.find((call) => call.operation === "save")?.args.name, "existing-voice.mp3");
});

test("persistence failure removes only the newly created temporary sample and returns a fixed error", async () => {
  for (const cleanupError of [undefined, "https://private.invalid?token=cleanup-secret"]) {
    const runtime = routeRuntime({ persistError: "database constraint failed secret-token", cleanupError });
    const response = await runtime.route.POST(upload());
    assert.equal(response.status, 503);
    assert.deepEqual(runtime.calls.map((call) => call.operation), ["auth", "rate", "normalize", "save", "library-save", "remove"]);
    assert.deepEqual(runtime.calls.at(-1)?.args, { accountId: ACCOUNT, path: voicePath() });
    const payload = await response.json(); assert.equal(payload.code, "voice_storage_unavailable");
    assert.doesNotMatch(JSON.stringify(payload), /secret|private\.invalid|constraint/);
  }
});

test("unavailable or invalid-duration library vocals never create temporary or durable copies", async () => {
  for (const options of [{ libraryReadError: "voice_library_reference_unavailable" }, { normalizeError: "voice_audio_duration_invalid" }]) {
    const runtime = routeRuntime(options);
    const response = await runtime.route.POST(new Request("http://localhost/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mediaLibraryId: LIBRARY_ID }) }));
    assert.equal(response.status, 400);
    assert.ok(runtime.calls.every((call) => !["save", "library-save", "remove"].includes(call.operation)));
  }
});

test("library selection authenticates and rate-limits before looking up an existing vocal", async () => {
  for (const options of [{ authError: true }, { limited: true }]) {
    const runtime = routeRuntime(options);
    const response = await runtime.route.POST(new Request("http://localhost/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mediaLibraryId: LIBRARY_ID }) }));
    assert.equal(response.status, options.authError ? 401 : 429);
    assert.ok(runtime.calls.every((call) => ["auth", "rate"].includes(call.operation)));
  }
});

test("library selection rejects malformed JSON and bounds the stream at 1024 bytes without Content-Length", async () => {
  for (const body of ["{", "null", "[]", JSON.stringify({ mediaLibraryId: 42 }), JSON.stringify({ wrong: LIBRARY_ID })]) {
    const runtime = routeRuntime();
    const response = await runtime.route.POST(new Request("http://localhost/voice", { method: "POST", headers: { "content-type": "application/json" }, body }));
    assert.equal(response.status, 400); assert.equal((await response.json()).code, "voice_library_reference_invalid");
    assert.deepEqual(runtime.calls.map((call) => call.operation), ["auth", "rate"]);
  }
  let cancelled = false;
  const request = new Request("http://localhost/voice", { method: "POST", headers: { "content-type": "application/json" },
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1025)); }, cancel() { cancelled = true; } }), duplex: "half",
  } as RequestInit & { duplex: "half" });
  const runtime = routeRuntime();
  const response = await runtime.route.POST(request);
  assert.equal(response.status, 400); assert.equal(cancelled, true);
  assert.deepEqual(runtime.calls.map((call) => call.operation), ["auth", "rate"]);
});
