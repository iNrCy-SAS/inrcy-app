"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { parseMediaSoundtrackOptions, type MediaSoundtrackOption } from "@/lib/mediaSoundtrackSelection";
import styles from "./MediaSoundtrackSelector.module.css";

type Props = { soundtrackId: string | null; onChange: (id: string | null) => void; disabled?: boolean; scopeKey?: string; selectionLocked?: boolean; compact?: boolean; channelLabel?: string; unavailableHint?: string; channelStyle?: CSSProperties };
const ACTIVATION_EVENT = "inrcy:media-soundtrack-activate";

/** Controlled selection over the shared iNrCy catalogue. Previewing never generates media. */
export default function MediaSoundtrackSelector({ soundtrackId, onChange, disabled = false, scopeKey = "", selectionLocked = false, compact = false, channelLabel, unavailableHint, channelStyle }: Props) {
  const t = useTranslations("booster");
  const titleId = useId(), selectionId = useId();
  const [open, setOpen] = useState(false);
  const [showUnavailableHint, setShowUnavailableHint] = useState(false);
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
  const close = useCallback(() => { stopPreview(); setOpen(false); setShowUnavailableHint(false); }, [stopPreview]);
  const activate = () => window.dispatchEvent(new CustomEvent(ACTIVATION_EVENT, { detail: titleId }));

  useEffect(() => {
    const stopOtherInstance = (event: Event) => { if (event instanceof CustomEvent && event.detail !== titleId) close(); };
    window.addEventListener(ACTIVATION_EVENT, stopOtherInstance);
    return () => window.removeEventListener(ACTIVATION_EVENT, stopOtherInstance);
  }, [titleId, close]);

  useEffect(() => {
    stopPreview(); setOpen(false); setShowUnavailableHint(false); setTracks([]); setLoadError(false); setPreviewError(false);
    loadedScopeRef.current = null;
    controllerRef.current?.abort(); controllerRef.current = null;
    const audio = audioRef.current;
    return () => {
      controllerRef.current?.abort(); controllerRef.current = null; playingRef.current = null;
      if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    };
  }, [scopeKey, stopPreview]);

  useEffect(() => { stopPreview(); setPreviewError(false); }, [soundtrackId, stopPreview]);
  useEffect(() => { if (disabled || unavailableHint) close(); }, [disabled, unavailableHint, close]);
  useEffect(() => { if (selectionLocked) stopPreview(); }, [selectionLocked, stopPreview]);

  useEffect(() => {
    if (!showUnavailableHint) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !triggerRef.current?.parentElement?.contains(event.target)) setShowUnavailableHint(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setShowUnavailableHint(false); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape, true); };
  }, [showUnavailableHint]);

  useEffect(() => {
    if (unavailableHint || (!open && !soundtrackId) || loadedScopeRef.current === scopeKey || controllerRef.current) return;
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
  }, [open, soundtrackId, scopeKey, unavailableHint]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); triggerRef.current?.focus({ preventScroll: true }); };
  }, [open]);

  const choose = (id: string | null) => { if (!disabled && !selectionLocked && !unavailableHint) { stopPreview(); onChange(id); } };
  const preview = async (track: MediaSoundtrackOption) => {
    if (disabled || selectionLocked || unavailableHint) return;
    if (playingRef.current === track.id) { stopPreview(); return; }
    activate();
    stopPreview(); setPreviewError(false);
    const audio = audioRef.current;
    if (!audio) return;
    playingRef.current = track.id; setPlayingId(track.id); audio.src = track.audioPreview;
    try { await audio.play(); }
    catch { if (playingRef.current === track.id) { stopPreview(); setPreviewError(true); } }
  };
  const selected = tracks.find(track => track.id === soundtrackId);
  const selectedLabel = soundtrackId ? selected?.label || t("publication_music_selected") : t("publication_music_auto");
  const title = channelLabel ? `${t("publication_music_label")} · ${channelLabel}` : t("publication_music_title");
  const hintId = `${titleId}-unavailable`;
  return <span className={styles.root}
    onPointerEnter={event => { if (unavailableHint && event.pointerType !== "touch") setShowUnavailableHint(true); }}
    onPointerLeave={() => { if (document.activeElement !== triggerRef.current) setShowUnavailableHint(false); }}>
    <button ref={triggerRef} type="button" className={styles.trigger} data-compact={compact} data-unavailable={Boolean(unavailableHint)} disabled={disabled} aria-disabled={disabled || Boolean(unavailableHint)}
      aria-label={`${title} · ${selectedLabel}`} title={unavailableHint ? undefined : `${title} · ${selectedLabel}`} aria-describedby={unavailableHint ? hintId : undefined}
      aria-haspopup={unavailableHint ? undefined : "dialog"} aria-expanded={unavailableHint ? showUnavailableHint : open}
      onFocus={() => { if (unavailableHint) setShowUnavailableHint(true); }} onBlur={() => setShowUnavailableHint(false)}
      onClick={() => { if (disabled) return; if (unavailableHint) { setShowUnavailableHint(true); return; } activate(); setOpen(true); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 18V5l12-3v13M9 9l12-3"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="18" cy="15" rx="3" ry="2.5"/></svg>
      <span className={compact ? styles.srOnly : undefined}>{t("publication_music_label")}</span><strong>{selectedLabel}</strong>
    </button>
    {unavailableHint ? <span id={hintId} role="tooltip" className={styles.unavailableHint} hidden={!showUnavailableHint}>{unavailableHint}</span> : null}
    <audio ref={audioRef} preload="none" onEnded={() => { playingRef.current = null; setPlayingId(null); }} />
    {open && typeof document !== "undefined" ? createPortal(<dialog ref={dialogRef} className={styles.dialog} style={channelStyle} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <header className={styles.header}><h2 id={titleId}>{title}</h2><button type="button" className={styles.close} onClick={close} aria-label={t("publication_music_close")}>×</button></header>
      <p className={styles.description}>{t("publication_music_scope")}</p>
      {selectionLocked ? <p className={styles.description} role="status">{t("publication_music_resume_locked")}</p> : null}
      <fieldset className={styles.options} disabled={disabled || selectionLocked || Boolean(unavailableHint)}>
        <legend className={styles.srOnly}>{t("publication_music_title")}</legend>
        <div className={styles.selection}>
          <select id={selectionId} aria-label={t("publication_music_label")} value={soundtrackId || ""} disabled={loading} onChange={event => choose(event.currentTarget.value || null)}>
            <option value="">{t("publication_music_auto")}</option>
            {soundtrackId && !selected ? <option value={soundtrackId} disabled>{t("publication_music_selected")}</option> : null}
            {tracks.map(track => <option key={track.id} value={track.id}>{track.label}</option>)}
          </select>
          <button type="button" className={styles.preview} disabled={!selected}
            aria-label={selected ? t(playingId === selected.id ? "publication_music_stop_track" : "publication_music_preview_track", { name: selected.label }) : t("publication_music_preview_choose")}
            aria-pressed={Boolean(selected && playingId === selected.id)} onClick={() => { if (selected) void preview(selected); }}>{selected && playingId === selected.id ? "■" : "▶"}</button>
        </div>
        <p className={styles.trackDescription}>{selected?.description || t("publication_music_auto_description")}</p>
        {loading ? <p role="status">{t("publication_music_loading")}</p> : null}
        {loadError ? <p role="alert">{t("publication_music_unavailable")}</p> : null}
      </fieldset>
      {previewError ? <p className={styles.error} role="alert">{t("publication_music_preview_unavailable")}</p> : null}
      <footer className={styles.footer}><button type="button" onClick={close}>{t("publication_music_done")}</button></footer>
    </dialog>, document.body) : null}
  </span>;
}
