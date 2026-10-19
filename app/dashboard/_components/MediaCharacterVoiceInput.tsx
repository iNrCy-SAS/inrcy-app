"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AI_MEDIA_CHARACTER_VOICE_MIN_SECONDS, AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS, type AiMediaCharacterVoiceSample } from "@/lib/aiMediaCharacterVoices";
import { deleteCharacterVoiceSample, getCharacterVoicePreviewUrl, isCharacterVoiceUploadFileAllowed } from "@/lib/aiMediaCharacterVoiceClient";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { beginCharacterVoiceRecording, CharacterVoiceRecorderUnavailableError, type CharacterVoiceRecording, type CharacterVoiceRecorderSession } from "@/lib/aiMediaCharacterVoiceRecorderClient";
import styles from "./MediaCharacterVoiceInput.module.css";
import MediaCharacterVoiceLibraryPicker from "./MediaCharacterVoiceLibraryPicker";

type Props = {
  mode?: "ai" | "provided";
  sample?: AiMediaCharacterVoiceSample;
  disabled: boolean;
  onModeChange: (mode: "ai" | "provided") => void;
  onSampleChange: (sample: AiMediaCharacterVoiceSample | undefined) => void;
  onBusyChange: (busy: boolean) => void;
};
type RecordingState = "closed" | "idle" | "starting" | "recording" | "preview";

export default function MediaCharacterVoiceInput({ mode = "ai", sample, disabled, onModeChange, onSampleChange, onBusyChange }: Props) {
  const t = useTranslations("media");
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<CharacterVoiceRecorderSession | null>(null);
  const previewUrlRef = useRef("");
  const ownsBusyRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingState>("closed");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recording, setRecording] = useState<CharacterVoiceRecording | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const locallyBusy = libraryOpen || uploading || recordingState === "starting" || recordingState === "recording" || recordingState === "preview";
  const externallyLocked = disabled && !locallyBusy;
  const recordingOpen = recordingState !== "closed";

  const setBusy = (busy: boolean) => {
    if (!busy && !ownsBusyRef.current) return;
    ownsBusyRef.current = busy;
    onBusyChange(busy);
  };
  const clearPreview = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = ""; setPreviewUrl(""); setRecording(null);
  };
  const cancelRecording = () => {
    recorderRef.current?.cancel(); recorderRef.current = null;
    clearPreview(); setRecordingState("closed"); setElapsedSeconds(0); setBusy(false);
  };

  useEffect(() => {
    const cancel = () => {
      uploadRef.current?.abort(); uploadRef.current = null;
      recorderRef.current?.cancel(); recorderRef.current = null;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
      if (ownsBusyRef.current) onBusyChange(false);
      ownsBusyRef.current = false;
    };
    const onAccountChange = () => {
      cancel(); setLibraryOpen(false); setRecordingState("closed"); setPreviewUrl(""); setRecording(null); setUploading(false); setError("");
    };
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, onAccountChange);
    return () => { window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, onAccountChange); cancel(); };
  }, [onBusyChange]);

  const uploadSample = async (file: File, source: "import" | "recording" = "import") => {
    if (uploadRef.current || externallyLocked) return;
    if (source === "import" && !isCharacterVoiceUploadFileAllowed(file)) { setError(t("ai_generator_character_voice_file_error")); return; }
    const controller = new AbortController(); uploadRef.current = controller;
    setError(""); setMenuOpen(false); setUploading(true); setBusy(true);
    try {
      const form = new FormData(); form.append("file", file);
      if (source === "recording") form.append("source", "recording");
      const response = await fetch("/api/media-generation/voice-reference", {
        method: "POST", credentials: "include", cache: "no-store", body: form, signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted) {
        if (body?.ok && body.sample?.path) void deleteCharacterVoiceSample(body.sample);
        return;
      }
      if (!response.ok || body?.ok !== true || !body.sample?.path) throw new Error(body?.message || body?.error || t("ai_generator_character_voice_upload_error"));
      onSampleChange(body.sample as AiMediaCharacterVoiceSample);
      clearPreview(); setRecordingState("closed");
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : t("ai_generator_character_voice_upload_error"));
    } finally {
      if (uploadRef.current === controller) {
        uploadRef.current = null; setUploading(false);
        // Keep an unsaved recording open after an upload failure for a retry.
        setBusy(source === "recording" && Boolean(previewUrlRef.current));
      }
    }
  };

  const selectLibrarySample = async (mediaLibraryId: string) => {
    if (uploadRef.current) return;
    const controller = new AbortController(); uploadRef.current = controller;
    setLibraryOpen(false); setUploading(true); setBusy(true); setError("");
    try {
      const response = await fetch("/api/media-generation/voice-reference", {
        method: "POST", credentials: "include", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaLibraryId }),
      });
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted) { if (body?.ok && body.sample?.path) void deleteCharacterVoiceSample(body.sample); return; }
      if (!response.ok || body?.ok !== true || !body.sample?.path) throw new Error(body?.error || t("ai_generator_character_voice_library_unavailable"));
      onSampleChange(body.sample as AiMediaCharacterVoiceSample);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : t("ai_generator_character_voice_library_unavailable"));
    } finally {
      if (uploadRef.current === controller) { uploadRef.current = null; setUploading(false); setBusy(false); }
    }
  };

  const startRecording = async () => {
    if (externallyLocked || recorderRef.current || uploading) return;
    clearPreview(); setError(""); setElapsedSeconds(0); setRecordingState("starting"); setBusy(true);
    try {
      const started = beginCharacterVoiceRecording({
        onElapsed: setElapsedSeconds,
        onComplete: (candidate) => {
          recorderRef.current = null;
          if (candidate.durationSeconds < AI_MEDIA_CHARACTER_VOICE_MIN_SECONDS || candidate.durationSeconds > AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS || candidate.blob.size === 0) {
            setError(t("ai_generator_character_voice_duration_error")); setRecordingState("idle"); setBusy(false); return;
          }
          const url = URL.createObjectURL(candidate.blob); previewUrlRef.current = url;
          setPreviewUrl(url); setRecording(candidate); setRecordingState("preview");
        },
        onError: () => { recorderRef.current = null; setError(t("ai_generator_character_voice_record_error")); setRecordingState("idle"); setBusy(false); },
      });
      recorderRef.current = started.session;
      await started.ready;
      if (recorderRef.current === started.session) setRecordingState("recording");
    } catch (caught) {
      if (!ownsBusyRef.current) return;
      recorderRef.current = null;
      const denied = caught instanceof DOMException && ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(caught.name);
      setError(t(caught instanceof CharacterVoiceRecorderUnavailableError ? "ai_generator_character_voice_record_unavailable" : denied ? "ai_generator_character_voice_record_denied" : "ai_generator_character_voice_record_error"));
      setRecordingState("idle"); setBusy(false);
    }
  };

  return <div className={styles.voice} data-character-voice-mode={mode}>
    <label htmlFor={`${id}-mode`}>{t("ai_generator_character_voice_label")}</label>
    <select id={`${id}-mode`} value={mode} disabled={disabled || uploading || recordingOpen} onChange={(event) => {
      setError(""); setMenuOpen(false); onModeChange(event.target.value === "provided" ? "provided" : "ai");
    }}>
      <option value="ai">{t("ai_generator_character_voice_ai")}</option>
      <option value="provided">{t("ai_generator_character_voice_provided")}</option>
    </select>
    {mode === "provided" ? <div className={styles.sample}>
      <small id={`${id}-limits`}>{t("ai_generator_character_voice_limits")}</small>
      <input ref={inputRef} id={`${id}-file`} className={styles.fileInput} type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,.mp3,.wav" disabled={disabled || uploading || recordingOpen} aria-label={t("ai_generator_character_voice_import")} aria-describedby={`${id}-limits`} onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void uploadSample(file);
      }} />
      {sample && !recordingOpen ? <>
        <small className={styles.fileName} title={sample.name}>{sample.name}</small>
        <audio key={sample.path} controls preload="none" src={getCharacterVoicePreviewUrl(sample)} aria-label={t("ai_generator_character_voice_preview")} />
      </> : null}
      {!recordingOpen ? <div className={styles.actions}>
        <button type="button" disabled={disabled || uploading} aria-expanded={menuOpen} aria-controls={`${id}-choices`} onClick={() => setMenuOpen((open) => !open)}>{t(uploading ? "ai_generator_character_voice_uploading" : sample ? "ai_generator_character_voice_replace" : "ai_generator_character_voice_upload")}</button>
        {sample ? <button type="button" disabled={disabled || uploading} onClick={() => { setError(""); onSampleChange(undefined); }}>{t("ai_generator_character_voice_remove")}</button> : null}
        <button type="button" disabled={disabled || uploading} onClick={() => { setMenuOpen(false); setLibraryOpen(true); setBusy(true); }}>{t("ai_generator_character_voice_library")}</button>
      </div> : null}
      {sample?.libraryMediaId ? <small role="status">{t("ai_generator_character_voice_saved")}</small> : null}
      {libraryOpen ? <MediaCharacterVoiceLibraryPicker onClose={() => { setLibraryOpen(false); setBusy(false); }} onSelect={(mediaId) => void selectLibrarySample(mediaId)} /> : null}
      {menuOpen && !recordingOpen ? <div id={`${id}-choices`} className={styles.actions} role="group" aria-label={t("ai_generator_character_voice_upload")}>
        <button type="button" disabled={disabled || uploading} onClick={() => { setMenuOpen(false); inputRef.current?.click(); }}>{t("ai_generator_character_voice_import")}</button>
        <button type="button" disabled={disabled || uploading} onClick={() => { setMenuOpen(false); setError(""); setRecordingState("idle"); }}>{t("ai_generator_character_voice_record")}</button>
      </div> : null}
      {recordingOpen ? <div className={styles.recorder}>
        {recordingState === "starting" ? <small role="status">{t("ai_generator_character_voice_record_starting")}</small> : null}
        {recordingState === "recording" ? <small role="timer" aria-live="off">{t("ai_generator_character_voice_record_elapsed", { seconds: elapsedSeconds })}</small> : null}
        {previewUrl ? <audio controls preload="metadata" src={previewUrl} aria-label={t("ai_generator_character_voice_preview")} /> : null}
        <div className={styles.actions}>
          {recordingState === "idle" ? <button type="button" disabled={externallyLocked} onClick={() => void startRecording()}>{t("ai_generator_character_voice_record_start")}</button> : null}
          {recordingState === "recording" ? <button type="button" onClick={() => recorderRef.current?.stop()}>{t("ai_generator_character_voice_record_stop")}</button> : null}
          {recordingState === "preview" ? <>
            <button type="button" disabled={externallyLocked || uploading} onClick={() => void startRecording()}>{t("ai_generator_character_voice_record_retry")}</button>
            <button type="button" disabled={externallyLocked || uploading || !recording} onClick={() => {
              if (!recording) return;
              const extension = recording.mimeType.includes("mp4") ? "m4a" : recording.mimeType.includes("ogg") ? "ogg" : "webm";
              void uploadSample(new File([recording.blob], `vocal.${extension}`, { type: recording.mimeType }), "recording");
            }}>{t("ai_generator_character_voice_record_use")}</button>
          </> : null}
          <button type="button" disabled={uploading} onClick={cancelRecording}>{t("ai_generator_character_voice_record_cancel")}</button>
        </div>
      </div> : null}
      {uploading ? <small role="status" aria-live="polite">{t("ai_generator_character_voice_uploading")}</small> : null}
      {error ? <small className={styles.error} role="alert">{error}</small> : null}
    </div> : null}
  </div>;
}
