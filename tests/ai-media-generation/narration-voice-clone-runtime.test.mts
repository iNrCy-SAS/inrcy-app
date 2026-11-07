import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

function wav(seconds = 1, sampleRate = 16_000, marker = 0) {
  const buffer = Buffer.alloc(44 + seconds * sampleRate * 2, marker);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}

type Clone = typeof import("../../lib/aiMediaNarrationVoiceClone.ts");
function harness() {
  const reserved: Array<Record<string, unknown>> = [];
  const committed: Array<Record<string, unknown>> = [];
  const rolledBack: unknown[] = [];
  const failures: Array<Record<string, unknown>> = [];
  const load = runtimeModules({
    "@/lib/aiGatewayAccountGuard": {
      reserveAiGatewayAccountAttempt: async (account: string, options: Record<string, unknown>) => {
        const reservation = { id: String(reserved.length), account, ...options }; reserved.push(reservation); return reservation;
      },
      commitAiGatewayAccountAttempt: async (options: Record<string, unknown>) => { committed.push(options); },
      rollbackAiGatewayAccountAttempt: async (reservation: unknown) => { rolledBack.push(reservation); },
      recordAiGatewayAccountFailure: async (options: Record<string, unknown>) => { failures.push(options); },
    },
    "@/lib/mediaVideoNormalizer": { resolveVideoNormalizationFfmpegPath: () => { throw new Error("No decoding process expected here"); } },
  });
  return { clone: load<Clone>("lib/aiMediaNarrationVoiceClone.ts"), reserved, committed, rolledBack, failures };
}

function input(script = "Bonjour, voici les nouvelles paroles de cette vidéo.") {
  const timestamp = Date.now();
  return {
    accountId: "account-a", narration: { script, language: "fr", wordCount: script.split(" ").length, source: "ai" as const, sha256: "narration-hash" },
    reference: { accountId: "account-a", path: `_studio-voice-references/${new Date(timestamp).toISOString().slice(0, 10)}/account-a__${timestamp}__12345678-1234-4123-8123-123456789abc.wav`, buffer: wav(6), durationSeconds: 6 },
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

test("cloned narration splits multilingual text into provider-sized requests without dropping words", () => {
  const { clone } = harness();
  for (const script of ["Bonjour. ".repeat(75), "一二三四五六七八九十。".repeat(60), "😀".repeat(650), "a".repeat(620)]) {
    const chunks = clone.splitAiMediaClonedNarrationScript(script);
    assert.ok(chunks.length >= 2 && chunks.length <= 4);
    assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 300));
    assert.equal(chunks.join("").replace(/\s/gu, ""), script.replace(/\s/gu, ""));
  }
  assert.throws(() => clone.splitAiMediaClonedNarrationScript("a".repeat(1_201)), /script_invalid/);
  assert.throws(() => clone.splitAiMediaClonedNarrationScript(" "), /script_invalid/);
  assert.equal(clone.supportsAiMediaClonedNarrationLanguage("fr-FR"), true);
  assert.equal(clone.supportsAiMediaClonedNarrationLanguage("th"), false);
});

test("real voice-off sends NEW exact words and owned reference audio, with no photo, no gender override and no permanent clone", async () => {
  const h = harness(); const calls: Array<{ url: string; init?: RequestInit }> = [];
  await mockFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return init?.method === "POST" ? Response.json({ audio: { url: "https://v3.fal.media/files/voice.wav" } }) : new Response(new Uint8Array(wav()));
  }, async () => {
    const args = input(); const result = await h.clone.generateAiMediaClonedNarrationAudio(args);
    assert.equal(result.voice, "provided"); assert.equal(result.mimeType, "audio/wav"); assert.ok(result.buffer.equals(wav()));
    assert.equal(calls.length, 2); assert.equal(calls[0].url, "https://fal.run/fal-ai/chatterbox/text-to-speech/multilingual");
    const payload = JSON.parse(String(calls[0].init?.body));
    assert.deepEqual(Object.keys(payload).sort(), ["custom_audio_language", "enable_safety_checker", "text", "voice"]);
    assert.equal(payload.text, args.narration.script); assert.equal(payload.custom_audio_language, "french");
    assert.equal(payload.voice, `data:audio/wav;base64,${args.reference.buffer.toString("base64")}`);
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get("Authorization"), "Key fixture-private-key"); assert.equal(headers.get("X-Fal-Store-IO"), "0");
    assert.equal(headers.get("X-Fal-No-Retry"), "1"); assert.equal(headers.get("x-app-fal-disable-fallback"), "true");
    assert.equal(headers.get("X-Fal-Object-Lifecycle-Preference"), '{"expiration_duration_seconds":3600}');
    assert.equal(calls[1].init?.headers, undefined); assert.equal(calls[1].init?.redirect, "error");
    assert.equal(h.reserved[0].estimatedCostMicroUsd, Array.from(args.narration.script).length * 25);
    assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
  });
});

test("long narration uses ordered bounded paid segments and joins samples instead of replaying source audio", async () => {
  const h = harness(); const spoken: string[] = []; let downloads = 0;
  await mockFetch(async (_url, init) => {
    if (init?.method === "POST") { spoken.push(JSON.parse(String(init.body)).text); return Response.json({ audio: { url: `https://v3.fal.media/files/${spoken.length}.wav` } }); }
    return new Response(new Uint8Array(wav(1, 16_000, ++downloads)));
  }, async () => {
    const args = input("Bonjour à tous. ".repeat(45).trim());
    const result = await h.clone.generateAiMediaClonedNarrationAudio(args);
    assert.ok(spoken.length > 1); assert.ok(spoken.every((text) => Array.from(text).length <= 300));
    assert.equal(spoken.join(" "), args.narration.script);
    assert.equal(result.buffer.length, 44 + spoken.length * 32_000);
    for (let index = 0; index < spoken.length; index++) assert.equal(result.buffer[44 + index * 32_000], index + 1);
    assert.equal(h.reserved.length, spoken.length); assert.equal(h.committed.length, spoken.length);
  });
});

test("consent, owner, expiry, actual duration, language, key and cancellation reject before provider costs", async () => {
  const h = harness(); let requests = 0;
  await mockFetch(async () => { requests++; throw new Error("Unexpected network call"); }, async () => {
    const args = input();
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, narrationVoiceConsent: false }), /consent_required/);
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, accountId: "another" }), /reference_invalid/);
    const expired = args.reference.path.replace(/__\d{13}__/, `__${Date.now() - 25 * 3_600_000}__`);
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, reference: { ...args.reference, path: expired } }), /reference_invalid/);
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, reference: { ...args.reference, buffer: wav(2) } }), /duration_invalid/);
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, narration: { ...args.narration, language: "th" } }), /language_unsupported/);
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio({ ...args, signal: AbortSignal.abort(new Error("user-stop")) }), /user-stop/);
    delete process.env.FAL_KEY;
    await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(args), /credentials_missing/);
    assert.equal(requests, 0); assert.equal(h.reserved.length, 0);
  });
});

test("provider rejection is not retried or replaced by an unrelated AI voice", async () => {
  for (const status of [401, 403, 422, 429]) {
    const h = harness(); let requests = 0;
    await mockFetch(async () => { requests++; return new Response("sensitive provider payload", { status }); }, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), new RegExp(`provider_http_${status}$`));
      assert.equal(requests, 1); assert.equal(h.rolledBack.length, 1); assert.equal(h.committed.length, 0);
    });
  }
});

test("ambiguous transport or server failure conservatively accounts one attempt without retry or exposing secrets", async () => {
  for (const failure of ["transport", "server"]) {
    const h = harness(); let requests = 0;
    await mockFetch(async () => { requests++; if (failure === "transport") throw new Error("fixture-private-key data:audio/wav;base64,secret"); return new Response("private body", { status: 503 }); }, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), (error: unknown) => {
        assert.ok(error instanceof Error); assert.match(error.message, /^ai_media_voice_clone_/); assert.doesNotMatch(error.message, /private|secret|base64/); assert.equal(error.cause, undefined); return true;
      });
      assert.equal(requests, 1); assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
    });
  }
});

test("untrusted result URLs and media cannot trigger SSRF, authenticated downloads or duplicate synthesis", async () => {
  for (const url of ["http://v3.fal.media/a.wav", "https://fal.media.evil.invalid/a.wav", "https://127.0.0.1/a.wav", "https://user:pass@v3.fal.media/a.wav", "https://v3.fal.media:444/a.wav"]) {
    const h = harness(); let requests = 0;
    await mockFetch(async () => { requests++; return Response.json({ audio: { url } }); }, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), /output_invalid/);
      assert.equal(requests, 1); assert.equal(h.committed.length, 1); assert.equal(h.rolledBack.length, 0);
    });
  }
  for (const body of [new Response("not audio"), new Response("x", { headers: { "content-length": String(17 * 1024 * 1024) } }), new Response(null, { status: 302, headers: { location: "https://private.invalid" } })]) {
    const h = harness(); let requests = 0;
    await mockFetch(async (_url, init) => { requests++; return init?.method === "POST" ? Response.json({ audio: { url: "https://v3.fal.media/a.wav" } }) : body; }, async () => {
      await assert.rejects(h.clone.generateAiMediaClonedNarrationAudio(input()), /ai_media_voice_clone_(audio_invalid|response_too_large|audio_download_failed)/);
      assert.equal(requests, 2); assert.equal(h.committed.length, 1);
    });
  }
});

test("WAV concatenation rejects malformed chunks, incompatible formats and empty output", () => {
  const { clone } = harness();
  assert.throws(() => clone.joinAiMediaClonedNarrationWav([]), /audio_invalid/);
  assert.throws(() => clone.joinAiMediaClonedNarrationWav([Buffer.from("not wav")]), /audio_invalid/);
  assert.throws(() => clone.joinAiMediaClonedNarrationWav([wav(), wav(1, 24_000)]), /format_mismatch/);
  const corrupt = wav(); corrupt.writeUInt32LE(corrupt.length, 40);
  assert.throws(() => clone.joinAiMediaClonedNarrationWav([corrupt]), /audio_invalid/);
});

test("sentence-aware splitting can exceed four chunks and still assembles every paid segment", async () => {
  const h = harness(); let requests = 0;
  const phrase = `${"voix ".repeat(30).trim()}. `;
  const script = phrase.repeat(7).trim();
  assert.ok(Array.from(script).length <= 1_200);
  assert.ok(h.clone.splitAiMediaClonedNarrationScript(script).length > 4);
  await mockFetch(async (_url, init) => {
    if (init?.method === "POST") { requests++; return Response.json({ audio: { url: `https://v3.fal.media/${requests}.wav` } }); }
    return new Response(new Uint8Array(wav()));
  }, async () => {
    const result = await h.clone.generateAiMediaClonedNarrationAudio(input(script));
    assert.equal(result.buffer.length, 44 + requests * 32_000);
    assert.equal(h.committed.length, requests);
  });
});
