import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { audio, ffmpegPath, wav } from "./character-voice-runtime-fixtures.mts";

const run = promisify(execFile);

test("real FFmpeg normalizes stereo WAV, MP3, Ogg, WebM and MP4 recordings into bounded mono PCM WAV", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "inrcy-voice-fixture-"));
  try {
    const original = path.join(folder, "source.wav");
    await writeFile(original, wav(2, 44_100, 2));
    const fixtures: Buffer[] = [await readFile(original)];
    for (const [extension, codec] of [["mp3", "libmp3lame"], ["ogg", "libopus"], ["webm", "libopus"], ["mp4", "aac"]]) {
      const target = path.join(folder, `encoded.${extension}`);
      await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", original, "-c:a", codec, "-y", target], { windowsHide: true, timeout: 20_000 });
      fixtures.push(await readFile(target));
    }
    for (const input of fixtures) {
      const result = await audio.normalizeAiMediaCharacterVoiceAudio({ buffer: input });
      assert.equal(result.mimeType, "audio/wav"); assert.ok(result.buffer.length <= 320_044);
      assert.ok(result.durationSeconds >= 1.9 && result.durationSeconds <= 2.1);
      assert.equal(result.buffer.readUInt16LE(22), 1); assert.equal(result.buffer.readUInt32LE(24), 16_000);
      assert.equal(result.buffer.readUInt16LE(34), 16);
      assert.equal(audio.inspectAiMediaCharacterVoiceWav(result.buffer).durationSeconds, result.durationSeconds);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("real decoding accepts exact duration boundaries and rejects shorter, longer or corrupt recordings", async () => {
  for (const seconds of [1, 10]) {
    const result = await audio.normalizeAiMediaCharacterVoiceAudio({ buffer: wav(seconds) });
    assert.equal(result.durationSeconds, seconds); assert.equal(result.buffer.length, 44 + seconds * 32_000);
  }
  for (const seconds of [.9, 10.01, 15]) await assert.rejects(audio.normalizeAiMediaCharacterVoiceAudio({ buffer: wav(seconds) }), /voice_audio_duration_invalid/);
  await assert.rejects(audio.normalizeAiMediaCharacterVoiceAudio({ buffer: Buffer.from("not an audio file") }), /voice_audio_(format_)?invalid/);
});

test("browser recorder scheduling overruns are trimmed to ten seconds while imported long clips are rejected", async () => {
  const result = await audio.normalizeAiMediaCharacterVoiceAudio({ buffer: wav(10.05), recording: true });
  assert.equal(result.durationSeconds, 10); assert.equal(result.buffer.length, 320_044);
  await assert.rejects(audio.normalizeAiMediaCharacterVoiceAudio({ buffer: wav(10.05) }), /voice_audio_duration_invalid/);
});

test("playlist and arbitrary bytes are rejected by format detection before decoding external resources", async () => {
  for (const text of ["#EXTM3U\nhttps://private.invalid/audio.wav", "ffconcat version 1.0\nfile '/private/audio.wav'", "{\"audio\":\"file:///audio.wav\"}"]) {
    await assert.rejects(audio.normalizeAiMediaCharacterVoiceAudio({ buffer: Buffer.from(text) }), /voice_audio_format_invalid/);
  }
});

test("empty, oversized and cancelled inputs stop before any FFmpeg work", async () => {
  await assert.rejects(audio.normalizeAiMediaCharacterVoiceAudio({ buffer: Buffer.alloc(0) }), /voice_audio_size_invalid/);
  await assert.rejects(audio.normalizeAiMediaCharacterVoiceAudio({ buffer: Buffer.alloc(3 * 1024 * 1024 + 1) }), /voice_audio_size_invalid/);
  await assert.rejects(audio.normalizeAiMediaCharacterVoiceAudio({ buffer: wav(), signal: AbortSignal.abort(new Error("voice-cancelled")) }), /voice-cancelled/);
});
