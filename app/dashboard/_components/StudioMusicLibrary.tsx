"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useInrAssistantLocalInterface } from "../_hooks/useInrAssistantLocalInterface";
import { parseMediaSoundtrackOptions, type MediaSoundtrackOption } from "@/lib/mediaSoundtrackSelection";
import styles from "./StudioMusicLibrary.module.css";

type Props = {
  withMusic: boolean;
  soundtrackId: string | null;
  scopeKey: string;
  disabled: boolean;
  open: boolean;
  available: boolean;
  onOpen: () => void;
  onClose: () => void;
  renderDialog: (content: ReactNode) => ReactNode;
  onChange: (withMusic: boolean, soundtrackId: string | null) => void;
};

/** Studio's catalogue picker only reads bundled tracks and plays their previews. */
export default function StudioMusicLibrary({ withMusic, soundtrackId, scopeKey, disabled, open, available, onOpen, onClose, renderDialog, onChange }: Props) {
  const t = useTranslations("media");
  const musicT = useTranslations("booster");
  const commonT = useTranslations("common");
  const [tracks, setTracks] = useState<MediaSoundtrackOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playbackEpoch = useRef(0);
  const stopPreview = useCallback(() => {
    playbackEpoch.current += 1;
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    setPlayingId(null);
    setPlaybackActive(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const audio = audioRef.current;
    const controller = new AbortController();
    let active = true;
    setTracks([]); setLoading(true); setLoadError(false); setLoadedScope(null);
    const timeout = window.setTimeout(() => {
      if (!active) return;
      controller.abort(); setLoadError(true); setLoading(false);
    }, 10_000);
    void fetch("/api/booster/soundtracks", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("catalogue_unavailable"); return parseMediaSoundtrackOptions(await response.json()); })
      .then(options => { if (!active || controller.signal.aborted) return; if (!options.length) throw new Error("catalogue_empty"); setTracks(options); setLoadedScope(scopeKey); })
      .catch(() => { if (active && !controller.signal.aborted) setLoadError(true); })
      .finally(() => { window.clearTimeout(timeout); if (active && !controller.signal.aborted) setLoading(false); });
    return () => {
      active = false; window.clearTimeout(timeout); controller.abort();
      // The dialog can clear the audio ref before passive cleanup runs.
      if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
      stopPreview();
    };
  }, [scopeKey, attempt, open, stopPreview]);

  useEffect(() => { stopPreview(); }, [disabled, withMusic, soundtrackId, stopPreview]);

  const choose = (enabled: boolean, id: string | null) => {
    if (disabled) return;
    stopPreview(); onChange(enabled, id);
  };
  const preview = async (track: MediaSoundtrackOption) => {
    if (disabled) return;
    if (playingId === track.id) { stopPreview(); return; }
    stopPreview(); setPreviewError(false);
    const audio = audioRef.current;
    if (!audio) return;
    const epoch = playbackEpoch.current;
    audio.src = track.audioPreview;
    setPlayingId(track.id);
    try { await audio.play(); if (playbackEpoch.current === epoch && !audio.paused) setPlaybackActive(true); }
    catch { if (playbackEpoch.current === epoch) { stopPreview(); setPreviewError(true); } }
  };
  const ready = loadedScope === scopeKey && !loading && !loadError && tracks.length > 0;
  useInrAssistantLocalInterface("studio_video_music", { open, withMusic, soundtrackId, ready, catalogue: ready ? tracks.map(track => track.id) : [], playingId, playbackActive, scopeKey, loadAttempt: attempt }, {
    open: { invoke: () => { if (disabled || !available) throw new Error("studio_music_unavailable"); onOpen(); }, matches: snapshot => !!snapshot && typeof snapshot === "object" && (snapshot as { open?: boolean }).open === true },
    close: { invoke: () => { if (disabled) throw new Error("studio_music_busy"); stopPreview(); onClose(); }, matches: snapshot => !!snapshot && typeof snapshot === "object" && (snapshot as { open?: boolean }).open === false },
    select: {
      invoke: value => {
        if (disabled || !available || !open) throw new Error("studio_music_unavailable");
        if (value === "auto") choose(true, null);
        else if (value === "off") choose(false, null);
        else if (ready && tracks.some(track => track.id === value)) choose(true, value);
        else throw new Error("studio_music_choice_unavailable");
      },
      matches: (snapshot, value) => !!snapshot && typeof snapshot === "object" && (snapshot as { scopeKey?: string }).scopeKey === scopeKey &&
        (value === "off" ? (snapshot as { withMusic?: boolean }).withMusic === false : (snapshot as { withMusic?: boolean }).withMusic === true && (snapshot as { soundtrackId?: string | null }).soundtrackId === (value === "auto" ? null : value)),
    },
    play: {
      invoke: async value => {
        const selected = ready && tracks.find(track => track.id === (value ?? soundtrackId));
        if (!open || disabled || !available || !selected) throw new Error("studio_music_preview_unavailable");
        if (playingId !== selected.id) await preview(selected);
        if (audioRef.current?.paused !== false) throw new Error("studio_music_preview_unconfirmed");
      },
      matches: (snapshot, value) => !!snapshot && typeof snapshot === "object" && (snapshot as { scopeKey?: string }).scopeKey === scopeKey && (snapshot as { playingId?: string | null }).playingId === (value ?? soundtrackId) && (snapshot as { playbackActive?: boolean }).playbackActive === true,
    },
    stop: { invoke: stopPreview, matches: snapshot => !!snapshot && typeof snapshot === "object" && (snapshot as { playingId?: string | null }).playingId === null && (snapshot as { playbackActive?: boolean }).playbackActive === false },
    retry: { invoke: () => { if (!open || disabled || !loadError) throw new Error("studio_music_retry_unavailable"); setAttempt(value => value + 1); }, matches: snapshot => !!snapshot && typeof snapshot === "object" && (snapshot as { scopeKey?: string }).scopeKey === scopeKey && (snapshot as { loadAttempt?: number }).loadAttempt! > attempt && (snapshot as { ready?: boolean }).ready === true },
  }, available || open, disabled);

  if (!open) return null;
  return renderDialog(<div className={styles.library} data-studio-music-library>
    <div className={styles.defaults} role="group" aria-label={t("ai_generator_music_title")}>
      <button type="button" aria-pressed={withMusic && !soundtrackId} disabled={disabled} data-studio-music-auto onClick={() => choose(true, null)}>{musicT("publication_music_auto")}</button>
      <button type="button" aria-pressed={!withMusic} disabled={disabled} data-studio-music-off onClick={() => choose(false, null)}>{t("ai_generator_music_off")}</button>
    </div>
    {loading ? <p role="status">{musicT("publication_music_loading")}</p> : null}
    {loadError ? <div className={styles.notice} role="alert"><p>{musicT("publication_music_unavailable")}</p><button type="button" disabled={disabled} onClick={() => setAttempt(value => value + 1)}>{commonT("retry")}</button></div> : null}
    <ul className={styles.tracks} aria-label={t("ai_generator_music_title")}>
      {tracks.map(track => <li key={track.id}>
        <button type="button" className={styles.choice} data-studio-music-track={track.id} aria-pressed={withMusic && soundtrackId === track.id} disabled={disabled} onClick={() => choose(true, track.id)}>
          <span>{track.label}</span><small>{track.description}</small>
        </button>
        <button type="button" className={styles.preview} data-studio-music-preview={track.id} disabled={disabled} aria-pressed={playingId === track.id}
          aria-label={musicT(playingId === track.id ? "publication_music_stop_track" : "publication_music_preview_track", { name: track.label })}
          onClick={() => void preview(track)}>{playingId === track.id ? "■" : "▶"}</button>
      </li>)}
    </ul>
    {previewError ? <p className={styles.notice} role="alert">{musicT("publication_music_preview_unavailable")}</p> : null}
    <audio ref={audioRef} preload="none" onEnded={stopPreview} onError={() => { if (playingId) { stopPreview(); setPreviewError(true); } }} />
  </div>);
}
