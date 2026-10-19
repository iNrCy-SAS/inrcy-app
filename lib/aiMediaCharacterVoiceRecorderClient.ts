export type CharacterVoiceRecording = { blob: Blob; durationSeconds: number; mimeType: string };
export type CharacterVoiceRecorderSession = { stop: () => void; cancel: () => void };

type RecordingOptions = {
  onElapsed: (seconds: number) => void;
  onComplete: (recording: CharacterVoiceRecording) => void;
  onError: (error: Error) => void;
};
type RecordingEnvironment = {
  getUserMedia: () => Promise<MediaStream>;
  Recorder: typeof MediaRecorder;
  now: () => number;
  setInterval: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
  setTimeout: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

export class CharacterVoiceRecorderUnavailableError extends Error {}

export function beginCharacterVoiceRecording(options: RecordingOptions, providedEnvironment?: RecordingEnvironment): { session: CharacterVoiceRecorderSession; ready: Promise<void> } {
  if (!providedEnvironment && (typeof MediaRecorder === "undefined" || !globalThis.navigator?.mediaDevices?.getUserMedia)) {
    throw new CharacterVoiceRecorderUnavailableError();
  }
  const environment = providedEnvironment ?? {
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
    Recorder: MediaRecorder,
    now: () => Date.now(),
    setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
    clearInterval: (timer) => clearInterval(timer),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: (timer) => clearTimeout(timer),
  };
  let cancelled = false;
  let finished = false;
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  let startedAt = 0;
  let tick: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const chunks: Blob[] = [];
  const release = () => {
    if (tick !== undefined) environment.clearInterval(tick);
    if (deadline !== undefined) environment.clearTimeout(deadline);
    tick = undefined;
    deadline = undefined;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
  };
  const session: CharacterVoiceRecorderSession = {
    stop: () => {
      if (finished) return;
      // Release the microphone as soon as the user stops, before encoding completes.
      if (recorder?.state === "recording") recorder.stop();
      release();
    },
    cancel: () => {
      cancelled = true;
      session.stop();
      release();
    },
  };
  const ready = (async () => {
    try {
      stream = await environment.getUserMedia();
      if (cancelled) { release(); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"]
        .find((candidate) => environment.Recorder.isTypeSupported(candidate));
      if (!mimeType) throw new CharacterVoiceRecorderUnavailableError();
      recorder = new environment.Recorder(stream, { mimeType });
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onerror = () => {
        if (finished) return;
        finished = true;
        release();
        if (!cancelled) options.onError(new Error("recording_failed"));
      };
      recorder.onstop = () => {
        release();
        if (finished) return;
        finished = true;
        if (!cancelled) options.onComplete({
          blob: new Blob(chunks, { type: recorder?.mimeType || mimeType }),
          mimeType: recorder?.mimeType || mimeType,
          durationSeconds: Math.min(10, Math.max(0, (environment.now() - startedAt) / 1000)),
        });
      };
      startedAt = environment.now();
      recorder.start();
      tick = environment.setInterval(() => options.onElapsed(Math.min(10, Math.floor((environment.now() - startedAt) / 1000))), 200);
      deadline = environment.setTimeout(() => session.stop(), 10_000);
    } catch (caught) {
      finished = true;
      release();
      if (!cancelled) throw caught;
    }
  })();
  return { session, ready };
}
