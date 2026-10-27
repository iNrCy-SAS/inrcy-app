"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { parseMediaSoundtrackOptions, type MediaSoundtrackOption } from "@/lib/mediaSoundtrackSelection";
import styles from "./MediaSoundtrackSelector.module.css";

type Props = { soundtrackId: string | null; onChange: (id: string | null) => void; disabled?: boolean; scopeKey?: string; selectionLocked?: boolean };

/** Controlled selection over the shared iNrCy catalogue. Previewing never generates media. */
export default function MediaSoundtrackSelector({ soundtrackId, onChange, disabled = false, scopeKey = "", selectionLocked = false }: Props) {
  const t = useTranslations("booster");
  const titleId = useId(), radioName = useId();
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<MediaSoundtrackOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const loadedScopeRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const stopPreview = useCallback(() => {
    playingRef.current = null;
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    setPlayingId(null);
  }, []);
  const close = useCallback(() => { stopPreview(); setOpen(false); }, [stopPreview]);

  useEffect(() => {
    stopPreview(); setOpen(false); setTracks([]); setLoadError(false); setPreviewError(false);
    loadedScopeRef.current = null;
    controllerRef.current?.abort(); controllerRef.current = null;
    const audio = audioRef.current;
    return () => {
      controllerRef.current?.abort(); controllerRef.current = null; playingRef.current = null;
      if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    };
  }, [scopeKey, stopPreview]);

  useEffect(() => { stopPreview(); setPreviewError(false); }, [soundtrackId, stopPreview]);
  useEffect(() => { if (disabled) close(); }, [disabled, close]);

  useEffect(() => {
    if ((!open && !soundtrackId) || loadedScopeRef.current === scopeKey || controllerRef.current) return;
    const controller = new AbortController(); controllerRef.current = controller;
    setLoading(true); setLoadError(false);
    void fetch("/api/booster/soundtracks", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("catalogue_unavailable"); return parseMediaSoundtrackOptions(await response.json()); })
      .then(options => {
        if (controller.signal.aborted || controllerRef.current !== controller) return;
        if (!options.length) throw new Error("catalogue_empty");
        loadedScopeRef.current = scopeKey; setTracks(options);
      })
      .catch(() => { if (!controller.signal.aborted && controllerRef.current === controller) setLoadError(true); })
      .finally(() => { if (controllerRef.current === controller) { controllerRef.current = null; setLoading(false); } });
  }, [open, soundtrackId, scopeKey]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); triggerRef.current?.focus({ preventScroll: true }); };
  }, [open]);

  const choose = (id: string | null) => { if (!disabled && !selectionLocked) { stopPreview(); onChange(id); } };
  const preview = async (track: MediaSoundtrackOption) => {
    if (disabled) return;
    if (playingRef.current === track.id) { stopPreview(); return; }
    stopPreview(); setPreviewError(false);
    const audio = audioRef.current;
    if (!audio) return;
    playingRef.current = track.id; setPlayingId(track.id); audio.src = track.audioPreview;
    try { await audio.play(); }
    catch { if (playingRef.current === track.id) { stopPreview(); setPreviewError(true); } }
  };
  const selected = tracks.find(track => track.id === soundtrackId);
  const selectedLabel = soundtrackId ? selected?.label || t("publication_music_selected") : t("publication_music_auto");
  return <span className={styles.root}>
    <button ref={triggerRef} type="button" className={styles.trigger} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!disabled) setOpen(true); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 18V5l12-3v13M9 9l12-3"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="18" cy="15" rx="3" ry="2.5"/></svg>
      <span>{t("publication_music_label")}</span><strong>{selectedLabel}</strong>
    </button>
    <audio ref={audioRef} preload="none" onEnded={() => { playingRef.current = null; setPlayingId(null); }} />
    {open && typeof document !== "undefined" ? createPortal(<dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <header className={styles.header}><h2 id={titleId}>{t("publication_music_title")}</h2><button type="button" className={styles.close} onClick={close} aria-label={t("publication_music_close")}>×</button></header>
      <p className={styles.description}>{t("publication_music_scope")}</p>
      {selectionLocked ? <p className={styles.description} role="status">{t("publication_music_resume_locked")}</p> : null}
      <fieldset className={styles.options} disabled={disabled || selectionLocked}>
        <legend className={styles.srOnly}>{t("publication_music_title")}</legend>
        <label className={styles.auto}><input type="radio" name={radioName} value="" checked={soundtrackId === null} onChange={() => choose(null)} /><span><strong>{t("publication_music_auto")}</strong><small>{t("publication_music_auto_description")}</small></span></label>
        {loading ? <p role="status">{t("publication_music_loading")}</p> : null}
        {loadError ? <p role="alert">{t("publication_music_unavailable")}</p> : null}
        {tracks.map(track => <div className={styles.track} key={track.id} data-selected={soundtrackId === track.id}>
          <label><input type="radio" name={radioName} value={track.id} checked={soundtrackId === track.id} onChange={() => choose(track.id)} /><span><strong>{track.label}</strong>{track.description ? <small>{track.description}</small> : null}</span></label>
          <button type="button" className={styles.preview} aria-label={t(playingId === track.id ? "publication_music_stop_track" : "publication_music_preview_track", { name: track.label })} aria-pressed={playingId === track.id} onClick={() => void preview(track)}>{playingId === track.id ? "■" : "▶"}</button>
        </div>)}
      </fieldset>
      {previewError ? <p className={styles.error} role="alert">{t("publication_music_preview_unavailable")}</p> : null}
      <footer className={styles.footer}><button type="button" onClick={close}>{t("publication_music_done")}</button></footer>
    </dialog>, document.body) : null}
  </span>;
}
