import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const ENDPOINT = "https://queue.fal.run/fal-ai/chatterbox/text-to-speech/multilingual";
const ID = "12345678-1234-4123-8123-123456789abc";
const REQUEST = "https://queue.fal.run/fal-ai/chatterbox/requests/" + ID;
const AUDIO = "https://v3.fal.media/files/voice.wav";
const nativeFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error("Live provider calls forbidden in clone runtime tests"); }; });
test.after(() => { globalThis.fetch = nativeFetch; });
function receipt(overrides: Record<string, unknown> = {}) {
  return { request_id: ID, status: "IN_QUEUE", status_url: REQUEST + "/status", response_url: REQUEST, ...overrides };
}
function wav(seconds = 1, sampleRate = 16_000, marker = 0) {
  const buffer = Buffer.alloc(44 + seconds * sampleRate * 2, marker);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(buffer.length - 44, 40); return buffer;
}
type Clone = typeof import("../../lib/aiMediaNarrationVoiceClone.ts");
function harness() {
  const reserved: Array<Record<string, unknown>> = [], committed: Array<Record<string, unknown>> = [];
  const rolledBack: unknown[] = [], failures: Array<Record<string, unknown>> = [];
  const load = runtimeModules({
    "@/lib/aiGatewayAccountGuard": {
      reserveAiGatewayAccountAttempt: async (account: string, options: Record<string, unknown>) => {
        const reservation = { id: String(reserved.length), account, ...options }; reserved.push(reservation); return reservation;
      },
      commitAiGatewayAccountAttempt: async (options: Record<string, unknown>) => { committed.push(options); },
      rollbackAiGatewayAccountAttempt: async (reservation: unknown) => { rolledBack.push(reservation); },
      recordAiGatewayAccountFailure: async (options: Record<string, unknown>) => { failures.push(options); },
    },
    "node:timers/promises": { setTimeout: async (_ms: number, _value: unknown, options: { signal?: AbortSignal }) => { options.signal?.throwIfAborted(); } },
    "@/lib/mediaVideoNormalizer": { resolveVideoNormalizationFfmpegPath: () => { throw new Error("No decoding expected"); } },
  });
  return { clone: load<Clone>("lib/aiMediaNarrationVoiceClone.ts"), reserved, committed, rolledBack, failures };
}
function input(script = "Bonjour, voici les nouvelles paroles de cette vidéo.") {
  const timestamp = Date.now();
  return {
    accountId: "account-a", narration: { script, language: "fr", wordCount: script.split(" ").length, source: "ai" as const, sha256: "narration-hash" },
    reference: { accountId: "account-a", path: "_studio-voice-references/" + new Date(timestamp).toISOString().slice(0, 10) + "/account-a__" + timestamp + "__" + ID + ".wav", buffer: wav(6), durationSeconds: 6 },
    narrationVoiceConsent: true, narrationVoiceGender: "female" as const, durationSeconds: 10,
  };
}
async function mockFetch<T>(handler: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch, previous = process.env.FAL_KEY;
  globalThis.fetch = handler; process.env.FAL_KEY = "fixture-private-key";
  try { return await run(); } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = previous;
  }
}
function fixture(options: {
  submit?: () => Response | Promise<Response>;
  status?: (read: number) => Response | Promise<Response>;
  result?: () => Response | Promise<Response>;
  download?: () => Response | Promise<Response>;
} = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []; let reads = 0;
  const handler: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init }); init?.signal?.throwIfAborted();
    if (String(url) === ENDPOINT && init?.method === "POST") return options.submit?.() ?? Response.json(receipt());
    if (String(url) === REQUEST + "/status" && init?.method === "GET") return options.status?.(++reads) ?? Response.json({ status: "COMPLETED", request_id: ID });
    if (String(url) === REQUEST && init?.method === "GET") return options.result?.() ?? Response.json({ audio: { url: AUDIO } });
    if (String(url) === AUDIO && init?.method === "GET") return options.download?.() ?? new Response(new Uint8Array(wav()));
    throw new Error("Unexpected request outside local fixture");
  };
  return { handler, calls, posts: () => calls.filter(call => call.init?.method === "POST") };
}
function privateError(error: unknown, expected: RegExp | string) {
  assert.ok(error instanceof Error);
  if (typeof expected === "string") assert.equal(error.message, expected); else assert.match(error.message, expected);
  assert.equal(error.cause, undefined); assert.doesNotMatch(JSON.stringify(error), /private|secret|base64|fixture|token|fal\.media/);
  return error as Error & { diagnostics: Record<string, unknown> };
}

test("cloned narration splits multilingual text without dropping words", () => {
  const { clone } = harness();
  for (const script of ["Bonjour. ".repeat(75), "一二三四五六七八九十。".repeat(60), "😀".repeat(650), "a".repeat(620)]) {
    const chunks = clone.splitAiMediaClonedNarrationScript(script);
    assert.ok(chunks.length >= 2 && chunks.length <= 4); assert.ok(chunks.every(chunk => Array.from(chunk).length <= 300));
    assert.equal(chunks.join("").replace(/\s/gu, ""), script.replace(/\s/gu, ""));
  }
  assert.throws(() => clone.splitAiMediaClonedNarrationScript("a".repeat(1_201)), /script_invalid/);
  assert.throws(() => clone.splitAiMediaClonedNarrationScript(" "), /script_invalid/);
  assert.equal(clone.supportsAiMediaClonedNarrationLanguage("fr-FR"), true); assert.equal(clone.supportsAiMediaClonedNarrationLanguage("th"), false);
});
test("one POST sends exact new French words and original vocal; two status GETs precede result and unauthenticated audio download", async () => {
  const h = harness(); const f = fixture({ status: read => Response.json({ status: read === 1 ? "IN_PROGRESS" : "COMPLETED", request_id: ID }) });
  await mockFetch(f.handler, async () => {
    const args = input(), result = await h.clone.generateAiMediaClonedNarrationAudio(args);
    assert.equal(result.voice, "provided"); assert.equal(result.mimeType, "audio/wav"); assert.ok(result.buffer.equals(wav()));
    assert.deepEqual(f.calls.map(call => call.url), [ENDPOINT, REQUEST + "/status", REQUEST + "/status", REQUEST, AUDIO]);
    assert.equal(f.posts().length, 1);
    const body = JSON.parse(String(f.posts()[0].init?.body));
    assert.deepEqual(Object.keys(body).sort(), ["cfg_scale", "custom_audio_language", "enable_safety_checker", "exaggeration", "temperature", "text", "voice"]);
    assert.equal(body.exaggeration, 0.5); assert.equal(body.cfg_scale, 0.5); assert.equal(body.temperature, 0.5);
    assert.equal(body.text, args.narration.script); assert.equal(body.custom_audio_language, "french");
    assert.equal(body.voice, "data:audio/wav;base64," + args.reference.buffer.toString("base64"));
    const headers = new Headers(f.posts()[0].init?.headers);
    assert.equal(headers.get("Authorization"), "Key fixture-private-key"); assert.equal(headers.get("X-Fal-Store-IO"), "0");
    assert.equal(headers.get("X-Fal-No-Retry"), "1"); assert.equal(headers.get("x-app-fal-disable-fallback"), "true");
    assert.equal(headers.get("X-Fal-Object-Lifecycle-Preference"), '{"expiration_duration_seconds":3600}');
    for (const call of f.calls.slice(1, 4)) assert.equal(new Headers(call.init?.headers).get("Authorization"), "Key fixture-private-key");
    assert.equal(f.calls[4].init?.headers, undefined); assert.ok(f.calls.every(call => call.init?.redirect === "error"));
    assert.equal(h.reserved[0].estimatedCostMicroUsd, Array.from(args.narration.script).length * 25);
    assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
  });
});
test("long narration uses ordered bounded paid segments and joins samples", async () => {
  const h = harness(); let downloads = 0; const f = fixture({ download: () => new Response(new Uint8Array(wav(1, 16_000, ++downloads))) });
  await mockFetch(f.handler, async () => {
    const args = input("Bonjour à tous. ".repeat(45).trim()), result = await h.clone.generateAiMediaClonedNarrationAudio(args);
    const spoken = f.posts().map(call => JSON.parse(String(call.init?.body)).text as string);
    assert.ok(spoken.length > 1); assert.ok(spoken.every(text => Array.from(text).length <= 300)); assert.equal(spoken.join(" "), args.narration.script);
    assert.equal(result.buffer.length, 44 + spoken.length * 32_000);
    for (let index = 0; index < spoken.length; index++) assert.equal(result.buffer[44 + index * 32_000], index + 1);
    assert.equal(h.reserved.length, spoken.length); assert.equal(h.committed.length, spoken.length);
  });
});
test("consent, owner, expiry, duration, language, credentials and cancellation reject before provider costs", async () => {
  const h = harness(); let requests = 0;
  await mockFetch(async () => { requests++; throw new Error("Unexpected request"); }, async () => {
    const args = input();
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, narrationVoiceConsent: false }), /consent_required/);
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, accountId: "another" }), /reference_invalid/);
    const expired = args.reference.path.replace(/__\d{13}__/, "__" + (Date.now() - 25 * 3_600_000) + "__");
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, reference: { ...args.reference, path: expired } }), /reference_invalid/);
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, reference: { ...args.reference, buffer: wav(2) } }), /duration_invalid/);
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, narration: { ...args.narration, language: "th" } }), /language_unsupported/);
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, signal: AbortSignal.abort(new Error("user-stop")) }), /user-stop/);
    delete process.env.FAL_KEY; await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(args), /credentials_missing/);
    assert.equal(requests, 0); assert.equal(h.reserved.length, 0);
  });
});
test("definite POST rejection is rolled back without retry or substitute voice", async () => {
  for (const status of [401, 403, 422, 429]) {
    const h = harness(), f = fixture({ submit: () => new Response("private payload", { status }) });
    await mockFetch(f.handler, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), new RegExp("provider_http_" + status + "$"));
      assert.equal(f.calls.length, 1); assert.equal(h.rolledBack.length, 1); assert.equal(h.committed.length, 0);
    });
  }
});
test("ambiguous POST transport or server failure accounts one attempt without retry or leaked secrets", async () => {
  for (const failure of ["transport", "server"]) {
    const h = harness(), f = fixture({ submit: () => {
      if (failure === "transport") throw new Error("fixture-private-key data:audio/wav;base64,secret");
      return new Response("private body", { status: 503 });
    } });
    await mockFetch(f.handler, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), error => { privateError(error, /^ai_media_voice_clone_/); return true; });
      assert.equal(f.calls.length, 1); assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
    });
  }
});
test("untrusted queue origins, credentials, ports, paths, IDs and queries are rejected before authenticated GET", async () => {
  for (const fields of [
    { status_url: REQUEST.replace("https:", "http:") + "/status" },
    { status_url: REQUEST.replace("queue.fal.run", "queue.fal.run.evil.invalid") + "/status" },
    { response_url: REQUEST.replace("https://", "https://user:pass@") }, { response_url: REQUEST.replace("queue.fal.run", "queue.fal.run:444") },
    { status_url: REQUEST + "/status?leak=1" }, { response_url: REQUEST + "#fragment" },
    { status_url: REQUEST.replace("/requests/", "/text-to-speech/multilingual/requests/") + "/status" },
    { status_url: REQUEST.replace("12345678", "87654321") + "/status" }, { request_id: "invalid-id" },
    { request_id: ID + "/../other" }, { response_url: "https://127.0.0.1/result" },
  ]) {
    const h = harness(), f = fixture({ submit: () => Response.json(receipt(fields)) });
    await mockFetch(f.handler, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), /queue_invalid/);
      assert.equal(f.calls.length, 1); assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
    });
  }
});
test("status responses with a different request ID or invalid state cannot produce audio", async () => {
  for (const state of [{ status: "COMPLETED", request_id: ID.replace("12345678", "87654321") }, { status: "DONE" }, null]) {
    const h = harness(), f = fixture({ status: () => Response.json(state) });
    await mockFetch(f.handler, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), /queue_invalid/);
      assert.equal(f.calls.length, 2); assert.equal(f.posts().length, 1); assert.equal(h.committed.length, 1);
    });
  }
});
test("COMPLETED plus private error never becomes success even if result contradicts it with audio", async () => {
  const h = harness(), f = fixture({ status: () => Response.json({ status: "COMPLETED", error: "private body fixture-private-key", error_type: "private-type" }) });
  await mockFetch(f.handler, async () => {
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), error => { privateError(error, "ai_media_voice_clone_provider_failed"); return true; });
    assert.equal(f.calls.length, 3); assert.equal(f.posts().length, 1); assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
  });
});
test("GET auth, missing request or rate limit failures never roll back acknowledged work or resubmit", async () => {
  for (const stage of ["status", "result"] as const) for (const status of [401, 404, 429]) {
    const h = harness(), f = fixture({ [stage]: () => new Response("private body", { status }) });
    await mockFetch(f.handler, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), new RegExp("provider_http_" + status + "$"));
      assert.equal(f.posts().length, 1); assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
      assert.equal(f.calls.filter(call => call.url === REQUEST + (stage === "status" ? "/status" : "")).length, status === 429 ? 3 : 1);
    });
  }
});
test("transient GET failures recover by observing the same request rather than paying for another synthesis", async () => {
  const h = harness(); let resultReads = 0;
  const f = fixture({ status: read => read === 1 ? new Response("private failure", { status: 503 }) : Response.json({ status: read === 2 ? "IN_QUEUE" : "COMPLETED" }),
    result: () => ++resultReads === 1 ? new Response("private failure", { status: 503 }) : Response.json({ audio: { url: AUDIO } }) });
  await mockFetch(f.handler, async () => {
    assert.ok((await h.clone.generateAiMediaClonedNarrationAudio(input())).buffer.equals(wav()));
    assert.equal(f.posts().length, 1); assert.equal(resultReads, 2); assert.equal(h.committed.length, 1);
  });
});
test("global240s deadline is created once for queue waiting and all segments", async () => {
  const h = harness(), controller = new AbortController(), durations: number[] = [], originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = milliseconds => { durations.push(milliseconds); return milliseconds === 240_000 ? controller.signal : new AbortController().signal; };
  const f = fixture({ status: read => { if (read === 2) controller.abort(new DOMException("private total timeout", "TimeoutError")); return Response.json({ status: "IN_PROGRESS" }); } });
  try {
    await mockFetch(f.handler, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input("Une phrase. ".repeat(50))), error => {
        const e = privateError(error, "ai_media_voice_clone_timeout"); assert.equal(e.diagnostics.deadlineExceeded, true); assert.equal(e.diagnostics.callerAborted, false); return true;
      });
      assert.equal(durations.filter(ms => ms === 240_000).length, 1); assert.equal(f.posts().length, 1);
      assert.equal(h.reserved.length, 1); assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
    });
  } finally { AbortSignal.timeout = originalTimeout; }
});
test("caller route deadline interrupts queue observation without remote cancel, fallback or another POST", async () => {
  const h = harness(), controller = new AbortController(), reason = new Error("ai_media_generation_deadline");
  const f = fixture({ status: () => { controller.abort(reason); return Response.json({ status: "IN_PROGRESS" }); } });
  await mockFetch(f.handler, async () => {
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...input(), signal: controller.signal }), error => error === reason);
    assert.equal(f.calls.length, 2); assert.equal(f.posts().length, 1); assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
  });
});
test("untrusted audio URLs and media cannot cause SSRF, authenticated downloads or duplicate synthesis", async () => {
  for (const url of ["http://v3.fal.media/a.wav", "https://fal.media.evil.invalid/a.wav", "https://127.0.0.1/a.wav", "https://user:pass@v3.fal.media/a.wav", "https://v3.fal.media:444/a.wav"]) {
    const h = harness(), f = fixture({ result: () => Response.json({ audio: { url } }) });
    await mockFetch(f.handler, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), /output_invalid/);
      assert.equal(f.calls.length, 3); assert.equal(f.posts().length, 1); assert.equal(h.committed.length, 1);
    });
  }
  for (const download of [() => new Response("not audio"), () => new Response("x", { headers: { "content-length": String(17 * 1024 * 1024) } }),
    () => new Response(null, { status: 302, headers: { location: "https://private.invalid" } })]) {
    const h = harness(), f = fixture({ download });
    await mockFetch(f.handler, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), /ai_media_voice_clone_(audio_invalid|response_too_large|audio_download_failed)/);
      assert.equal(f.calls.length, 4); assert.equal(f.posts().length, 1); assert.equal(h.committed.length, 1); assert.equal(f.calls[3].init?.headers, undefined);
    });
  }
});
test("WAV concatenation rejects malformed chunks, incompatible formats and empty output", () => {
  const { clone } = harness();
  assert.throws(() => clone.joinAiMediaClonedNarrationWav([]), /audio_invalid/);
  assert.throws(() => clone.joinAiMediaClonedNarrationWav([Buffer.from("not wav")]), /audio_invalid/);
  assert.throws(() => clone.joinAiMediaClonedNarrationWav([wav(), wav(1, 24_000)]), /format_mismatch/);
  const corrupt = wav(); corrupt.writeUInt32LE(corrupt.length, 40); assert.throws(() => clone.joinAiMediaClonedNarrationWav([corrupt]), /audio_invalid/);
});
test("sentence-aware splitting beyond four chunks still assembles every paid segment", async () => {
  const h = harness(), f = fixture(), script = ("voix ".repeat(30).trim() + ". ").repeat(7).trim();
  assert.ok(Array.from(script).length <= 1_200); assert.ok(h.clone.splitAiMediaClonedNarrationScript(script).length > 4);
  await mockFetch(f.handler, async () => {
    const result = await h.clone.generateAiMediaClonedNarrationAudio(input(script));
    assert.equal(result.buffer.length, 44 + f.posts().length * 32_000); assert.equal(h.committed.length, f.posts().length);
  });
});
for (const phase of ["post", "status", "result", "download"] as const) {
  test("local " + phase + " deadline remains diagnosed without private data or another synthesis", async () => {
    const h = harness(), f = fixture(), originalTimeout = AbortSignal.timeout; let thirty = 0;
    AbortSignal.timeout = milliseconds => {
      if (milliseconds === 30_000) thirty++;
      const failed = phase === "post" ? milliseconds === 30_000 && thirty === 1 :
        phase === "download" ? milliseconds === 30_000 && thirty === 2 :
        milliseconds === 15_000 && (phase === "status" || f.calls.some(call => call.url === REQUEST + "/status"));
      return failed ? AbortSignal.abort(new DOMException("private request body fixture-private-key", "TimeoutError")) : new AbortController().signal;
    };
    try {
      await mockFetch(f.handler, async () => {
        await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), error => {
          const e = privateError(error, "ai_media_voice_clone_timeout");
          assert.equal(e.diagnostics.phase, phase === "download" ? "asset_download" : phase === "result" ? "output_validation" : "provider_submission");
          assert.equal(e.diagnostics.providerErrorName, "TimeoutError"); assert.equal(e.diagnostics.deadlineExceeded, true);
          assert.equal(e.diagnostics.providerAborted, true); assert.equal(e.diagnostics.callerAborted, false);
          const publicErrors = runtimeModules()<typeof import("../../lib/aiMediaGenerationPublicErrors.ts")>("lib/aiMediaGenerationPublicErrors.ts");
          const details = runtimeModules()<typeof import("../../lib/aiMediaSensitiveText.ts")>("lib/aiMediaSensitiveText.ts");
          const wrapped = new Error("ai_media_narration_unavailable:" + e.message, { cause: e });
          assert.equal(publicErrors.classifyAiMediaGenerationError(wrapped)?.code, "AI_MEDIA_VOICE_CLONE_UNAVAILABLE");
          assert.equal(details.safeAiMediaErrorDetails(wrapped)[1].diagnostics?.deadlineExceeded, true); return true;
        });
        assert.equal(f.posts().length, 1); assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
      });
    } finally { AbortSignal.timeout = originalTimeout; }
  });
}
test("rejected clone preserves only HTTP status and submission phase", async () => {
  const h = harness(), f = fixture({ submit: () => new Response("private body", { status: 429 }) });
  await mockFetch(f.handler, async () => {
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), error => {
      const e = privateError(error, "ai_media_voice_clone_provider_http_429");
      assert.equal(e.diagnostics.providerHttpStatus, 429); assert.equal(e.diagnostics.phase, "provider_submission"); assert.equal(e.diagnostics.deadlineExceeded, false); return true;
    });
    assert.equal(f.calls.length, 1); assert.equal(h.committed.length, 0); assert.equal(h.rolledBack.length, 1);
  });
});
test("one-hour-old owned narrator uses its prepared WAV rather than an expired signed URL", async () => {
  const h = harness(), f = fixture(), args = input(), createdAt = Date.now() - 3_600_000;
  args.reference.path = "_studio-voice-references/" + new Date(createdAt).toISOString().slice(0, 10) + "/account-a__" + createdAt + "__" + ID + ".wav";
  await mockFetch(f.handler, async () => {
    const result = await h.clone.generateAiMediaClonedNarrationAudio(args);
    assert.equal(JSON.parse(String(f.posts()[0].init?.body)).voice, "data:audio/wav;base64," + args.reference.buffer.toString("base64"));
    assert.equal(result.voice, "provided"); assert.equal(f.calls.length, 4); assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
  });
});
