"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import styles from "./MediaGenerator.module.css";

type SpeechAlternative = { transcript?: string };
type SpeechResult = {
  readonly isFinal?: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternative | undefined;
};
type SpeechResultList = {
  readonly length: number;
  readonly [index: number]: SpeechResult | undefined;
};
type SpeechEvent = Event & { readonly results?: SpeechResultList };
type SpeechErrorEvent = Event & { readonly error?: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type Props = {
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  onBusyChange?: (busy: boolean) => void;
  contextLabel?: string;
  purpose?: "subject" | "instruction" | "title" | "content" | "cta" | "hashtags";
  placement?: "overlay" | "inline";
  mergeMode?: "paragraph" | "space" | "replace";
  maxLength?: number;
};

type VoiceState = "idle" | "requesting" | "recording" | "transcribing";
type RecordingMode = "media" | "liveOnly" | null;

type ActiveVoiceSession = {
  id: symbol;
  cancel: () => void;
};

type VoiceTextMerge = {
  text: string;
  truncated: boolean;
};

let activeVoiceSession: ActiveVoiceSession | null = null;

const MAX_SECONDS = 90;
const MIN_AUDIO_BYTES = 900;
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg;codecs=opus",
  "audio/wav",
];

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function speechRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  const voiceWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return voiceWindow.SpeechRecognition || voiceWindow.webkitSpeechRecognition || null;
}

function preferredMimeType() {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return "";
  if (typeof window.MediaRecorder.isTypeSupported !== "function") return "";
  try {
    return MIME_CANDIDATES.find((candidate) => window.MediaRecorder.isTypeSupported(candidate)) || "";
  } catch {
    return "";
  }
}

function normalizeRecordedMimeType(type: string) {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized.startsWith("video/mp4")) {
    return normalized.replace(/^video\/mp4/, "audio/mp4");
  }
  return normalized || "audio/webm";
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function normalizeTranscript(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 2_000);
}

function clipVoiceTextAtBoundary(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, Math.max(0, maxLength));
  for (let index = clipped.length - 1; index > 0; index -= 1) {
    const character = clipped[index];
    if (/\s/.test(character)) return clipped.slice(0, index).trimEnd();
    if (/[,.!?;:]/.test(character)) {
      return clipped.slice(0, index + 1).trimEnd();
    }
  }
  return "";
}

function appendVoiceText(
  current: string,
  next: string,
  mergeMode: "paragraph" | "space" | "replace",
  maxLength?: number,
): VoiceTextMerge {
  const cleanCurrent = current.trim();
  const cleanNext = next.trim();
  const separator = mergeMode === "space" ? " " : "\n";
  const merged = mergeMode === "replace"
    ? cleanNext
    : !cleanCurrent
    ? cleanNext
    : !cleanNext
      ? cleanCurrent
      : `${cleanCurrent}${separator}${cleanNext}`;

  if (typeof maxLength !== "number" || maxLength <= 0 || merged.length <= maxLength) {
    return { text: merged, truncated: false };
  }

  if (mergeMode === "replace" || !cleanCurrent) {
    return {
      text: clipVoiceTextAtBoundary(merged, maxLength),
      truncated: true,
    };
  }

  if (cleanCurrent.length >= maxLength) {
    return { text: cleanCurrent.slice(0, maxLength), truncated: true };
  }

  const available = maxLength - cleanCurrent.length - separator.length;
  if (available <= 0) return { text: cleanCurrent, truncated: true };

  const safeNext = clipVoiceTextAtBoundary(cleanNext, available);
  return {
    text: safeNext ? `${cleanCurrent}${separator}${safeNext}` : cleanCurrent,
    truncated: true,
  };
}

function voicePlatformInfo() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      hasSpeechRecognition: false,
      canUseLivePreview: false,
      shouldUseLiveOnly: false,
      shouldWarmupMicrophone: false,
    };
  }

  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const isIOS =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
  const isSafari =
    /Safari/i.test(userAgent) &&
    !/Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|Opera/i.test(userAgent);
  const hasSpeechRecognition = Boolean(speechRecognitionConstructor());
  const hasMediaRecording = Boolean(
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof window.MediaRecorder !== "undefined",
  );

  return {
    hasSpeechRecognition,
    canUseLivePreview: hasSpeechRecognition && hasMediaRecording && !isIOS && !isSafari,
    shouldUseLiveOnly: hasSpeechRecognition && !hasMediaRecording,
    shouldWarmupMicrophone: isIOS || isSafari,
  };
}

async function warmupMicrophoneIfNeeded() {
  if (!voicePlatformInfo().shouldWarmupMicrophone) return;

  try {
    if (window.sessionStorage.getItem("inrcy_voice_micro_warmed_v1") === "1") return;
  } catch {
    // sessionStorage can be unavailable in strict private navigation.
  }

  const warmupStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  warmupStream.getTracks().forEach((track) => track.stop());

  try {
    window.sessionStorage.setItem("inrcy_voice_micro_warmed_v1", "1");
  } catch {
    // Best-effort only.
  }

  await new Promise<void>((resolve) => window.setTimeout(resolve, 450));
}

function responseMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const message = record.user_message || record.userMessage || record.message || record.error;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

export default function MediaSubjectVoiceButton({
  disabled = false,
  value,
  onChange,
  onBusyChange,
  contextLabel,
  purpose = "subject",
  placement = "overlay",
  mergeMode = "paragraph",
  maxLength,
}: Props) {
  const t = useTranslations("booster");
  const locale = useLocale();
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingModeRef = useRef<RecordingMode>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");
  const liveTextRef = useRef("");
  const hasLiveDraftRef = useRef(false);
  const liveOnlyUnavailableRef = useRef(false);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const currentSessionIdRef = useRef<symbol | null>(null);

  const setVoiceState = (next: VoiceState) => {
    setState(next);
    onBusyChange?.(next !== "idle");
  };

  const clearTimers = () => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const stopSpeechCapture = () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      try {
        recognition.abort();
      } catch {
        // Best-effort cleanup only.
      }
    }
  };

  const resetLiveDraft = () => {
    baseTextRef.current = "";
    liveTextRef.current = "";
    hasLiveDraftRef.current = false;
  };

  const restoreLiveDraft = () => {
    if (!mountedRef.current || !hasLiveDraftRef.current) return;
    onChange(baseTextRef.current);
  };

  const ownsVoiceSession = (sessionId: symbol | null) =>
    Boolean(
      sessionId &&
        currentSessionIdRef.current === sessionId &&
        activeVoiceSession?.id === sessionId,
    );

  const finish = (sessionId: symbol | null = currentSessionIdRef.current) => {
    if (!ownsVoiceSession(sessionId)) return;
    clearTimers();
    stopStream();
    recordingModeRef.current = null;
    activeVoiceSession = null;
    currentSessionIdRef.current = null;
    if (mountedRef.current) {
      setSeconds(0);
      setVoiceState("idle");
    } else {
      onBusyChange?.(false);
    }
  };

  const cancelSession = (sessionId: symbol | null = currentSessionIdRef.current) => {
    if (!ownsVoiceSession(sessionId)) return;
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    clearTimers();
    stopSpeechCapture();
    restoreLiveDraft();
    resetLiveDraft();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Best-effort cleanup only.
        }
      }
    }
    chunksRef.current = [];
    finish(sessionId);
  };

  const claimVoiceSession = () => {
    activeVoiceSession?.cancel();
    const sessionId = Symbol("inrcy-voice-dictation-session");
    currentSessionIdRef.current = sessionId;
    activeVoiceSession = {
      id: sessionId,
      cancel: () => cancelSession(sessionId),
    };
    return sessionId;
  };

  const isCurrentVoiceSession = (sessionId: symbol | null) =>
    mountedRef.current && ownsVoiceSession(sessionId);

  const startTimer = (stop: () => void, sessionId: symbol | null) => {
    setSeconds(0);
    intervalRef.current = window.setInterval(() => {
      if (!isCurrentVoiceSession(sessionId)) return;
      setSeconds((current) => Math.min(MAX_SECONDS, current + 1));
    }, 1_000);
    timeoutRef.current = window.setTimeout(() => {
      if (isCurrentVoiceSession(sessionId)) stop();
    }, MAX_SECONDS * 1_000);
  };

  const applyVoiceText = (
    baseText: string,
    transcript: string,
    sessionId: symbol | null,
  ) => {
    if (!isCurrentVoiceSession(sessionId)) return false;
    const merged = appendVoiceText(baseText, transcript, mergeMode, maxLength);
    onChange(merged.text);
    setError(merged.truncated ? t("voice_text_truncated") : "");
    return true;
  };

  const submitLiveTextForCorrection = async (sessionId: symbol | null) => {
    if (!isCurrentVoiceSession(sessionId)) return;
    const liveTranscript = normalizeTranscript(liveTextRef.current);
    if (!liveTranscript) {
      setError(t("aucun_texte_n_a_ete_detecte_7c72cc50"));
      resetLiveDraft();
      finish(sessionId);
      return;
    }

    setVoiceState("transcribing");
    setError("");
    const abortController = new AbortController();
    transcriptionAbortRef.current = abortController;

    try {
      const formData = new FormData();
      formData.append("text", liveTranscript);
      const response = await fetch("/api/booster/transcribe", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!isCurrentVoiceSession(sessionId)) return;
      if (!response.ok) {
        throw new Error(responseMessage(payload, t("voice_correction_failed_live_kept")));
      }

      const correctedText = String(payload?.text || "").trim();
      if (!correctedText) throw new Error(t("aucun_texte_n_a_ete_detecte_7c72cc50"));
      applyVoiceText(baseTextRef.current, correctedText, sessionId);
    } catch (caught) {
      if (abortController.signal.aborted || !isCurrentVoiceSession(sessionId)) return;
      const message = caught instanceof Error ? caught.message : "";
      setError(message || t("voice_correction_failed_live_kept"));
    } finally {
      if (transcriptionAbortRef.current === abortController) {
        transcriptionAbortRef.current = null;
      }
      if (isCurrentVoiceSession(sessionId)) {
        resetLiveDraft();
        finish(sessionId);
      }
    }
  };

  const submitAudio = async (blob: Blob, sessionId: symbol | null) => {
    if (!isCurrentVoiceSession(sessionId)) return;
    if (!blob.size || blob.size < MIN_AUDIO_BYTES) {
      if (hasLiveDraftRef.current && liveTextRef.current.trim()) {
        await submitLiveTextForCorrection(sessionId);
        return;
      }
      setError(t("voice_too_short"));
      resetLiveDraft();
      finish(sessionId);
      return;
    }

    setVoiceState("transcribing");
    setError("");
    const abortController = new AbortController();
    transcriptionAbortRef.current = abortController;

    try {
      const mimeType = normalizeRecordedMimeType(blob.type || "audio/webm");
      const formData = new FormData();
      formData.append(
        "audio",
        new File([blob], `inrcy-sujet.${extensionForMime(mimeType)}`, { type: mimeType }),
      );
      const response = await fetch("/api/booster/transcribe", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!isCurrentVoiceSession(sessionId)) return;
      if (!response.ok) {
        throw new Error(responseMessage(payload, t("voice_transcription_failed")));
      }

      const transcript = String(payload?.text || "").trim();
      if (!transcript) throw new Error(t("aucun_texte_n_a_ete_detecte_7c72cc50"));
      applyVoiceText(baseTextRef.current || value, transcript, sessionId);
    } catch (caught) {
      if (abortController.signal.aborted || !isCurrentVoiceSession(sessionId)) return;
      const liveDraftKept = hasLiveDraftRef.current && liveTextRef.current.trim();
      const message = caught instanceof Error ? caught.message : "";
      setError(
        liveDraftKept
          ? t("voice_transcription_failed_live_kept")
          : message || t("voice_transcription_failed"),
      );
    } finally {
      if (transcriptionAbortRef.current === abortController) {
        transcriptionAbortRef.current = null;
      }
      if (isCurrentVoiceSession(sessionId)) {
        resetLiveDraft();
        finish(sessionId);
      }
    }
  };

  const startSpeechCapture = (
    baseText: string,
    liveOnly: boolean,
    sessionId: symbol | null,
  ) => {
    if (!isCurrentVoiceSession(sessionId)) return false;
    const SpeechRecognition = speechRecognitionConstructor();
    if (!SpeechRecognition) return false;

    try {
      stopSpeechCapture();
      resetLiveDraft();
      const recognition = new SpeechRecognition();
      recognition.lang = locale;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      baseTextRef.current = baseText;

      recognition.onresult = (event) => {
        if (!isCurrentVoiceSession(sessionId)) return;
        const results = event.results;
        if (!results?.length) return;
        let transcript = "";
        for (let index = 0; index < results.length; index += 1) {
          transcript += ` ${results[index]?.[0]?.transcript || ""}`;
        }
        const normalized = normalizeTranscript(transcript);
        if (!normalized) return;
        liveTextRef.current = normalized;
        hasLiveDraftRef.current = true;
        applyVoiceText(baseTextRef.current, normalized, sessionId);
      };

      recognition.onerror = () => {
        recognitionRef.current = null;
        if (!isCurrentVoiceSession(sessionId)) return;
        if (recordingModeRef.current === "liveOnly") {
          liveOnlyUnavailableRef.current = true;
          clearTimers();
          recordingModeRef.current = null;
          if (hasLiveDraftRef.current && liveTextRef.current.trim()) {
            void submitLiveTextForCorrection(sessionId);
          } else {
            setError(t("voice_live_unavailable"));
            resetLiveDraft();
            finish(sessionId);
          }
        }
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        if (!isCurrentVoiceSession(sessionId)) return;
        if (recordingModeRef.current === "liveOnly") {
          clearTimers();
          recordingModeRef.current = null;
          void submitLiveTextForCorrection(sessionId);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
      if (liveOnly) recordingModeRef.current = "liveOnly";
      return true;
    } catch {
      recognitionRef.current = null;
      return false;
    }
  };

  const stopRecording = () => {
    const sessionId = currentSessionIdRef.current;
    if (!isCurrentVoiceSession(sessionId)) return;
    if (recordingModeRef.current === "liveOnly") {
      clearTimers();
      stopSpeechCapture();
      recordingModeRef.current = null;
      void submitLiveTextForCorrection(sessionId);
      return;
    }

    stopSpeechCapture();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      setVoiceState("transcribing");
      recorder.stop();
      return;
    }
    finish(sessionId);
  };

  const startLiveOnlyRecording = (sessionId: symbol | null) => {
    if (!startSpeechCapture(value, true, sessionId)) {
      liveOnlyUnavailableRef.current = true;
      return false;
    }
    setVoiceState("recording");
    startTimer(stopRecording, sessionId);
    return true;
  };

  const startMediaRecording = async (
    allowLivePreview: boolean,
    sessionId: symbol | null,
  ) => {
    if (!isCurrentVoiceSession(sessionId)) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === "undefined") {
      setError(t("voice_recording_unsupported"));
      finish(sessionId);
      return;
    }

    try {
      await warmupMicrophoneIfNeeded();
      if (!isCurrentVoiceSession(sessionId)) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isCurrentVoiceSession(sessionId)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = preferredMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recordingModeRef.current = "media";
      baseTextRef.current = value;

      recorder.ondataavailable = (event) => {
        if (!isCurrentVoiceSession(sessionId)) return;
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        if (!isCurrentVoiceSession(sessionId)) return;
        recorder.onstop = null;
        clearTimers();
        stopSpeechCapture();
        stopStream();
        recorderRef.current = null;
        recordingModeRef.current = null;
        if (hasLiveDraftRef.current && liveTextRef.current.trim()) {
          void submitLiveTextForCorrection(sessionId);
        } else {
          setError(t("voice_micro_recording_error"));
          resetLiveDraft();
          finish(sessionId);
        }
      };
      recorder.onstop = () => {
        if (!isCurrentVoiceSession(sessionId)) return;
        clearTimers();
        stopSpeechCapture();
        stopStream();
        const type = normalizeRecordedMimeType(
          chunksRef.current[0]?.type || recorder.mimeType || mimeType || "audio/webm",
        );
        const blob = new Blob(chunksRef.current, { type });
        recorderRef.current = null;
        recordingModeRef.current = null;
        chunksRef.current = [];
        void submitAudio(blob, sessionId);
      };

      recorder.start();
      if (allowLivePreview) startSpeechCapture(value, false, sessionId);
      setVoiceState("recording");
      startTimer(stopRecording, sessionId);
    } catch (caught) {
      if (!isCurrentVoiceSession(sessionId)) return;
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
      }
      recorderRef.current = null;
      chunksRef.current = [];
      stopSpeechCapture();
      stopStream();
      recordingModeRef.current = null;
      const name = caught instanceof DOMException ? caught.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError(t("voice_micro_permission_denied"));
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setError(t("voice_micro_not_found"));
      } else if (
        voicePlatformInfo().hasSpeechRecognition &&
        startLiveOnlyRecording(sessionId)
      ) {
        return;
      } else {
        setError(t("voice_micro_activation_failed"));
      }
      resetLiveDraft();
      finish(sessionId);
    }
  };

  const startRecording = async () => {
    setError("");
    stopSpeechCapture();
    resetLiveDraft();
    recordingModeRef.current = null;
    const sessionId = claimVoiceSession();
    setVoiceState("requesting");

    if (!window.isSecureContext && window.location.hostname !== "localhost") {
      setError(t("voice_https_required"));
      finish(sessionId);
      return;
    }

    const platform = voicePlatformInfo();
    if (
      platform.shouldUseLiveOnly &&
      !liveOnlyUnavailableRef.current &&
      startLiveOnlyRecording(sessionId)
    ) {
      return;
    }
    await startMediaRecording(platform.canUseLivePreview, sessionId);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      restoreLiveDraft();
      mountedRef.current = false;
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      cancelSession(currentSessionIdRef.current);
    };
  }, []);

  const recording = state === "recording";
  const titleKey =
    purpose === "instruction"
      ? "voice_instruction_title"
      : purpose === "title"
        ? "voice_title_title"
        : purpose === "content"
          ? "voice_content_title"
          : purpose === "cta"
            ? "voice_cta_title"
            : purpose === "hashtags"
              ? "voice_hashtags_title"
              : "voice_subject_title";
  const label = recording
    ? t("arreter_le_vocal_value_aace3fb5", { value0: formatDuration(seconds) })
    : state === "requesting" || state === "transcribing"
      ? t("correction_du_vocal_en_cours_2a811504")
      : t(titleKey);
  const accessibleLabel = contextLabel ? `${label} — ${contextLabel}` : label;

  const button = (
    <button
      type="button"
      className={styles.voiceButton}
      data-recording={recording ? "true" : undefined}
      disabled={disabled || state === "requesting" || state === "transcribing"}
      aria-label={accessibleLabel}
      aria-busy={state === "requesting" || state === "transcribing"}
      aria-pressed={recording}
      title={contextLabel ? `${t(titleKey)} — ${contextLabel}` : t(titleKey)}
      onClick={() => (recording ? stopRecording() : void startRecording())}
    >
      {recording ? `■ ${formatDuration(seconds)}` : state === "idle" ? "🎙️" : "…"}
    </button>
  );

  const errorMessage = error ? (
    <span className={styles.voiceError} role="alert">
      {error}
    </span>
  ) : null;

  return placement === "inline" ? (
    <span className={styles.voiceInlineControl}>
      {button}
      {errorMessage}
    </span>
  ) : (
    <>
      {button}
      {errorMessage}
    </>
  );
}
