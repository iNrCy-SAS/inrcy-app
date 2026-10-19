import assert from "node:assert/strict";
import test from "node:test";
import { getCharacterVoicePreviewUrl, getCharacterVoiceSelectionState, isCharacterVoiceUploadFileAllowed } from "../../lib/aiMediaCharacterVoiceClient.ts";
import { beginCharacterVoiceRecording, CharacterVoiceRecorderUnavailableError, type CharacterVoiceRecording } from "../../lib/aiMediaCharacterVoiceRecorderClient.ts";
import { AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES, type AiMediaCharacterVoiceSample } from "../../lib/aiMediaCharacterVoices.ts";

const sample: AiMediaCharacterVoiceSample = { path: "_studio-voice-references/date/account__sample.wav", name: "vocal.wav", mimeType: "audio/wav", durationSeconds: 2, sizeBytes: 64_044 };

test("each character reports supplied voices regardless of reference usage", () => {
  assert.deepEqual(getCharacterVoiceSelectionState([{ role: "character" }, { role: "character", voiceMode: "ai" }]), { hasProvidedVoice: false, missingSample: false });
  const provided = { role: "character", voiceMode: "provided" as const, voiceSample: sample };
  for (const usage of ["required", "inspiration"]) {
    const reference = { ...provided, usage };
    assert.deepEqual(getCharacterVoiceSelectionState([reference]), { hasProvidedVoice: true, missingSample: false });
  }
  assert.deepEqual(getCharacterVoiceSelectionState([{ ...provided, voiceSample: undefined }]), { hasProvidedVoice: true, missingSample: true });
  assert.deepEqual(getCharacterVoiceSelectionState([provided, { role: "character", voiceMode: "provided" }]), { hasProvidedVoice: true, missingSample: true });
  assert.deepEqual(getCharacterVoiceSelectionState([{ ...provided, role: "product" }]), { hasProvidedVoice: false, missingSample: false });
});

test("imports accept MP3/WAV within the byte limit and preview keeps an opaque escaped path", () => {
  assert.equal(isCharacterVoiceUploadFileAllowed({ name: "VOICE.MP3", size: AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES, type: "audio/mpeg" }), true);
  assert.equal(isCharacterVoiceUploadFileAllowed({ name: "vocal.wav", size: 100, type: "" }), true);
  for (const file of [
    { name: "vocal.wav", size: 0, type: "audio/wav" },
    { name: "vocal.wav", size: AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES + 1, type: "audio/wav" },
    { name: "vocal.exe", size: 100, type: "audio/mpeg" },
    { name: "vocal.mp3", size: 100, type: "video/mp4" },
  ]) assert.equal(isCharacterVoiceUploadFileAllowed(file), false);
  assert.equal(getCharacterVoicePreviewUrl(sample), `/api/media-generation/voice-reference?path=${encodeURIComponent(sample.path)}`);
});

function recorderFixture(getUserMedia?: () => Promise<MediaStream>) {
  let now = 1_000; let trackStops = 0; let recorderCount = 0;
  let deadline: (() => void) | undefined; let tick: (() => void) | undefined;
  const instances: FakeRecorder[] = [];
  const stream = { getTracks: () => [{ stop: () => { trackStops++; } }] } as unknown as MediaStream;
  class FakeRecorder {
    static isTypeSupported(type: string) { return type === "audio/webm;codecs=opus"; }
    state = "inactive"; mimeType = "audio/webm;codecs=opus";
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void; onerror?: () => void;
    constructor() { instances.push(this); recorderCount++; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["voice"] ) }); this.onstop?.(); }
  }
  const completed: CharacterVoiceRecording[] = []; const errors: Error[] = []; const elapsed: number[] = [];
  const begin = () => beginCharacterVoiceRecording({ onComplete: (value) => completed.push(value), onError: (value) => errors.push(value), onElapsed: (value) => elapsed.push(value) }, {
    getUserMedia: getUserMedia || (() => Promise.resolve(stream)), Recorder: FakeRecorder as unknown as typeof MediaRecorder,
    now: () => now,
    setInterval: (callback) => { tick = callback; return 1 as unknown as ReturnType<typeof setInterval>; },
    clearInterval: () => { tick = undefined; },
    setTimeout: (callback, milliseconds) => { assert.equal(milliseconds, 10_000); deadline = callback; return 2 as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout: () => { deadline = undefined; },
  });
  return { begin, completed, errors, elapsed, stream, trackStops: () => trackStops, recorderCount: () => recorderCount,
    advance: (milliseconds: number) => { now += milliseconds; tick?.(); },
    expire: () => { now += 10_000; deadline?.(); },
    fail: () => instances.at(-1)?.onerror?.(), hasTimers: () => Boolean(tick || deadline),
  };
}

test("microphone denial produces a recoverable error without recorder or timers", async () => {
  const fixture = recorderFixture(() => Promise.reject(new DOMException("Denied", "NotAllowedError")));
  await assert.rejects(fixture.begin().ready, { name: "NotAllowedError" });
  assert.equal(fixture.recorderCount(), 0); assert.equal(fixture.hasTimers(), false); assert.equal(fixture.completed.length, 0);
});

test("cancelling a pending permission request stops late microphone tracks without recording", async () => {
  let allow!: (stream: MediaStream) => void;
  const fixture = recorderFixture(() => new Promise((resolve) => { allow = resolve; }));
  const task = fixture.begin(); task.session.cancel(); allow(fixture.stream); await task.ready;
  assert.equal(fixture.trackStops(), 1); assert.equal(fixture.recorderCount(), 0); assert.equal(fixture.completed.length, 0); assert.equal(fixture.hasTimers(), false);
});

test("recording stops automatically at ten seconds and releases tracks and timers", async () => {
  const fixture = recorderFixture(); const task = fixture.begin(); await task.ready;
  fixture.advance(2_000); assert.deepEqual(fixture.elapsed, [2]);
  fixture.expire();
  assert.equal(fixture.completed.length, 1); assert.equal(fixture.completed[0].durationSeconds, 10); assert.equal(fixture.completed[0].blob.size, 5);
  assert.equal(fixture.trackStops(), 1); assert.equal(fixture.hasTimers(), false);
  task.session.cancel(); assert.equal(fixture.trackStops(), 1); assert.equal(fixture.completed.length, 1);
});

test("manual stop preserves the sample while cancel discards it", async () => {
  const fixture = recorderFixture(); const task = fixture.begin(); await task.ready; fixture.advance(2_000); task.session.stop();
  assert.equal(fixture.completed[0].durationSeconds, 2); assert.equal(fixture.trackStops(), 1);
  const cancelled = recorderFixture(); const second = cancelled.begin(); await second.ready; cancelled.advance(2_000); second.session.cancel();
  assert.equal(cancelled.completed.length, 0); assert.equal(cancelled.trackStops(), 1); assert.equal(cancelled.hasTimers(), false);
});

test("recorder failures release the microphone and do not create a usable vocal", async () => {
  const fixture = recorderFixture(); const task = fixture.begin(); await task.ready; fixture.fail();
  assert.equal(fixture.errors.length, 1); assert.equal(fixture.trackStops(), 1); assert.equal(fixture.completed.length, 0); assert.equal(fixture.hasTimers(), false);
});

test("an unsupported browser cannot request the microphone", () => {
  assert.throws(() => beginCharacterVoiceRecording({ onComplete() {}, onError() {}, onElapsed() {} }), CharacterVoiceRecorderUnavailableError);
});
