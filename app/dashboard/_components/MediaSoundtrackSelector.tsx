"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { parseMediaSoundtrackOptions, type MediaSoundtrackOption } from "@/lib/mediaSoundtrackSelection";
import styles from "./MediaSoundtrackSelector.module.css";

type Props = { soundtrackId: string | null; onChange: (id: string | null) => void; disabled?: boolean; scopeKey?: string; selectionLocked?: boolean; compact?: boolean; inline?: boolean; iconOnly?: boolean; channelLabel?: string; unavailableHint?: string; inactiveHint?: string; channelStyle?: CSSProperties };
const ACTIVATION_EVENT = "inrcy:media-soundtrack-activate";
const CATALOGUE_TIMEOUT_MS = 10_000;

/** Controlled selection over the shared iNrCy catalogue. Previewing never generates media. */
export default function MediaSoundtrackSelector({ soundtrackId, onChange, disabled = false, scopeKey = "", selectionLocked = false, compact = false, inline = false, iconOnly = false, channelLabel, unavailableHint, inactiveHint, channelStyle }: Props) {
  const t = useTranslations("booster");
  const commonT = useTranslations("common");
  const titleId = useId(), selectionId = useId();
  const [open, setOpen] = useState(false);
  const [showUnavailableHint, setShowUnavailableHint] = useState(false);
  const [tracks, setTracks] = useState<MediaSoundtrackOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [previewError, setPreviewError] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [activeChoice, setActiveChoice] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const loadedScopeRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef({ text: "", at: 0 });
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
    stopPreview(); setOpen(false); setShowUnavailableHint(false); setTracks([]); setLoading(false); setLoadError(false); setPreviewError(false);
    loadedScopeRef.current = null;
    const audio = audioRef.current;
    return () => {
      playingRef.current = null;
      if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    };
  }, [scopeKey, inline, stopPreview]);

  useEffect(() => { stopPreview(); setPreviewError(false); }, [soundtrackId, stopPreview]);
  useEffect(() => { if (disabled || unavailableHint) close(); }, [disabled, unavailableHint, close]);
  useEffect(() => { if (selectionLocked) stopPreview(); }, [selectionLocked, stopPreview]);

  useEffect(() => {
    if (!inline || !open) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [inline, open]);

  useEffect(() => {
    if (!showUnavailableHint) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !triggerRef.current?.parentElement?.contains(event.target)) setShowUnavailableHint(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setShowUnavailableHint(false); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape, true); };
  }, [showUnavailableHint]);

  useEffect(() => {
    if ((!inline && unavailableHint) || (!inline && !open && !soundtrackId) || loadedScopeRef.current === scopeKey) {
      setLoading(false);
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController(); controllerRef.current = controller;
    let active = true;
    setLoading(true); setLoadError(false);
    const timeout = window.setTimeout(() => {
      if (!active || controllerRef.current !== controller) return;
      controller.abort(); controllerRef.current = null;
      setLoadError(true); setLoading(false);
    }, CATALOGUE_TIMEOUT_MS);
    void fetch("/api/booster/soundtracks", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("catalogue_unavailable"); return parseMediaSoundtrackOptions(await response.json()); })
      .then(options => {
        if (!active || controller.signal.aborted || controllerRef.current !== controller) return;
        if (!options.length) throw new Error("catalogue_empty");
        loadedScopeRef.current = scopeKey; setTracks(options);
      })
      .catch(() => { if (active && !controller.signal.aborted && controllerRef.current === controller) setLoadError(true); })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active && controllerRef.current === controller) { controllerRef.current = null; setLoading(false); }
      });
    return () => {
      active = false; window.clearTimeout(timeout); controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
      setLoading(false);
    };
  }, [open, soundtrackId, scopeKey, unavailableHint, inline, loadAttempt]);

  useEffect(() => {
    if (!open || inline) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); triggerRef.current?.focus({ preventScroll: true }); };
  }, [open, inline]);

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
  const previousSelection = soundtrackId && !selected && tracks.length > 0 && !loading && !loadError;
  const savedSelectionLabel = t(previousSelection ? "publication_music_previous" : "publication_music_selected");
  const selectedLabel = soundtrackId ? selected?.label || savedSelectionLabel : t("publication_music_auto");
  const choices = [
    { id: null, label: t("publication_music_auto"), disabled: false },
    ...(soundtrackId && !selected ? [{ id: soundtrackId, label: savedSelectionLabel, disabled: true }] : []),
    ...tracks.map(track => ({ id: track.id, label: track.label, disabled: false })),
  ];
  const listId = `${selectionId}-list`;
  const openInlineList = () => {
    searchRef.current = { text: "", at: 0 };
    setActiveChoice(Math.max(0, choices.findIndex(choice => choice.id === soundtrackId)));
    activate(); setOpen(true);
  };
  const pickChoice = (index: number) => {
    const choice = choices[index];
    if (disabled || selectionLocked || unavailableHint || loading || !choice || choice.disabled) return;
    choose(choice.id); setActiveChoice(index);
    if (inline) triggerRef.current?.focus({ preventScroll: true });
    else listRef.current?.focus({ preventScroll: true });
  };
  const moveChoice = (direction: number, edge?: "first" | "last") => {
    let next = edge === "first" ? 0 : edge === "last" ? choices.length - 1 : activeChoice;
    for (let step = 0; step < choices.length; step++) {
      if (!edge || step > 0) next = (next + direction + choices.length) % choices.length;
      if (!choices[next].disabled) { setActiveChoice(next); break; }
    }
  };
  const pickerKey = (event: ReactKeyboardEvent<HTMLUListElement | HTMLButtonElement>) => {
    if (inline && open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus({ preventScroll: true }); return; }
    if (disabled || selectionLocked || unavailableHint || loading) return;
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (inline && !open) { openInlineList(); if (event.key === "Home") moveChoice(1, "first"); if (event.key === "End") moveChoice(-1, "last"); return; }
      if (event.key === "Enter" || event.key === " ") { pickChoice(activeChoice); return; }
      moveChoice(event.key === "ArrowUp" || event.key === "End" ? -1 : 1, event.key === "Home" ? "first" : event.key === "End" ? "last" : undefined);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = event.timeStamp, text = `${now - searchRef.current.at < 700 ? searchRef.current.text : ""}${event.key.toLocaleLowerCase()}`;
      searchRef.current = { text, at: now };
      const index = choices.findIndex(choice => !choice.disabled && choice.label.toLocaleLowerCase().startsWith(text));
      if (index >= 0) { if (inline && !open) { activate(); setOpen(true); } setActiveChoice(index); }
    }
  };
  useEffect(() => {
    if (!open || inline) return;
    searchRef.current = { text: "", at: 0 };
    const selectedIndex = tracks.findIndex(track => track.id === soundtrackId);
    setActiveChoice(soundtrackId ? selectedIndex >= 0 ? selectedIndex + 1 : 1 : 0);
  }, [open, soundtrackId, tracks, inline]);
  useEffect(() => {
    if (!open) return;
    const list = listRef.current, option = list?.children[activeChoice] as HTMLElement | undefined;
    if (!list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }, [open, activeChoice]);
  const title = channelLabel ? `${t("publication_music_label")} · ${channelLabel}` : t("publication_music_title");
  const loadFailure = loadError ? <span className={inline ? styles.inlineNotice : styles.loadNotice} role="alert">
    <span>{t("publication_music_unavailable")}</span>
    <button type="button" className={styles.retry} data-soundtrack-retry disabled={disabled || selectionLocked || Boolean(unavailableHint)}
      onClick={() => { loadedScopeRef.current = null; setLoadAttempt(attempt => attempt + 1); }}>{commonT("retry")}</button>
  </span> : null;
  const hintId = `${titleId}-unavailable`;
  const inactiveHintId = `${titleId}-inactive`;
  const soundtrackList = <ul ref={listRef} id={listId} role="listbox" aria-label={t("publication_music_label")} className={`${styles.trackList}${inline ? ` ${styles.inlineList}` : ""}`}
    tabIndex={disabled || selectionLocked || loading || unavailableHint ? -1 : 0} aria-disabled={disabled || selectionLocked || loading || Boolean(unavailableHint)}
    aria-activedescendant={`${selectionId}-choice-${activeChoice}`} onKeyDown={pickerKey}>
    {choices.map((choice, index) => <li key={choice.id || "auto"} id={`${selectionId}-choice-${index}`} role="option"
      aria-selected={soundtrackId === choice.id} aria-disabled={choice.disabled || undefined} data-active={activeChoice === index}
      onMouseDown={event => event.preventDefault()} onPointerMove={event => { if (event.pointerType === "mouse" && !choice.disabled) setActiveChoice(index); }}
      onClick={() => pickChoice(index)}>{choice.label}<span aria-hidden="true">{soundtrackId === choice.id ? "✓" : ""}</span></li>)}
  </ul>;
  const previewButton = <button type="button" className={styles.preview} disabled={disabled || selectionLocked || Boolean(unavailableHint) || loading || !selected}
    aria-label={selected ? t(playingId === selected.id ? "publication_music_stop_track" : "publication_music_preview_track", { name: selected.label }) : t("publication_music_preview_choose")}
    aria-pressed={Boolean(selected && playingId === selected.id)} onClick={() => { if (selected) void preview(selected); }}>{selected && playingId === selected.id ? "■" : "▶"}</button>;
  return <span ref={rootRef} className={`${styles.root}${inline ? ` ${styles.inlineRoot}` : ""}`} style={inline ? channelStyle : undefined} data-soundtrack-inline={inline || undefined}
    onKeyDownCapture={event => { if (inline && open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus({ preventScroll: true }); } }}
    onBlurCapture={event => { if (inline && open && !(selectionLocked && !event.relatedTarget) && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onPointerEnter={event => { if (unavailableHint && event.pointerType !== "touch") setShowUnavailableHint(true); }}
    onPointerLeave={() => { if (document.activeElement !== triggerRef.current) setShowUnavailableHint(false); }}>
    {inline ? <>
      <span className={styles.inlinePicker}>
        <button ref={triggerRef} id={selectionId} type="button" className={styles.inlineControl} role="combobox" aria-label={`${title} · ${selectedLabel}`} data-selected-soundtrack data-unavailable={Boolean(unavailableHint || inactiveHint)}
          disabled={disabled || loading} aria-disabled={disabled || loading || selectionLocked || Boolean(unavailableHint)} aria-busy={loading}
          aria-controls={open ? listId : undefined} aria-expanded={open} aria-haspopup="listbox" aria-autocomplete="none"
          aria-activedescendant={open ? `${selectionId}-choice-${activeChoice}` : undefined} aria-describedby={unavailableHint ? hintId : inactiveHint ? inactiveHintId : undefined}
          title={unavailableHint || inactiveHint || (selectionLocked ? t("publication_music_resume_locked") : `${title} · ${selectedLabel}`)}
          onFocus={() => { if (unavailableHint) setShowUnavailableHint(true); }} onBlur={event => { if (!rootRef.current?.contains(event.relatedTarget)) { setOpen(false); setShowUnavailableHint(false); } }} onKeyDown={pickerKey}
          onClick={() => { if (disabled || loading || selectionLocked) return; if (unavailableHint) { setShowUnavailableHint(true); return; } if (open) setOpen(false); else openInlineList(); }}>
          <svg className={styles.inlineMusicIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 18V5l12-3v13M9 9l12-3"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="18" cy="15" rx="3" ry="2.5"/></svg>
          <span>{loading ? t("chargement_01cba1df") : selectedLabel}</span><svg className={styles.inlineChevron} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
        </button>
        {open ? soundtrackList : null}
      </span>
      {previewButton}
      {loadFailure}
      {previewError ? <span className={styles.inlineNotice} role="alert">{t("publication_music_preview_unavailable")}</span> : null}
    </> : <button ref={triggerRef} type="button" className={styles.trigger} data-compact={compact} data-icon-only={iconOnly || undefined} data-unavailable={Boolean(unavailableHint || inactiveHint)} disabled={disabled} aria-disabled={disabled || Boolean(unavailableHint)}
      aria-label={`${title} · ${selectedLabel}`} title={unavailableHint || inactiveHint ? undefined : `${title} · ${selectedLabel}`} aria-describedby={unavailableHint ? hintId : undefined}
      aria-haspopup={unavailableHint ? undefined : "dialog"} aria-expanded={unavailableHint ? showUnavailableHint : open}
      onFocus={() => { if (unavailableHint) setShowUnavailableHint(true); }} onBlur={() => setShowUnavailableHint(false)}
      onClick={() => { if (disabled) return; if (unavailableHint) { setShowUnavailableHint(true); return; } activate(); setOpen(true); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 18V5l12-3v13M9 9l12-3"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="18" cy="15" rx="3" ry="2.5"/></svg>
      <span className={compact || iconOnly ? styles.srOnly : undefined}>{t("publication_music_label")}</span><strong className={iconOnly ? styles.srOnly : undefined}>{selectedLabel}</strong>
    </button>}
    {unavailableHint ? <span id={hintId} role="tooltip" className={styles.unavailableHint} hidden={!showUnavailableHint}>{unavailableHint}</span> : null}
    {inline && inactiveHint && !unavailableHint ? <span id={inactiveHintId} className={styles.srOnly}>{inactiveHint}</span> : null}
    <audio ref={audioRef} preload="none" onEnded={() => { playingRef.current = null; setPlayingId(null); }} />
    {!inline && open && typeof document !== "undefined" ? createPortal(<dialog ref={dialogRef} className={styles.dialog} style={channelStyle} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <header className={styles.header}><h2 id={titleId}>{title}</h2><button type="button" className={styles.close} onClick={close} aria-label={t("publication_music_close")}>×</button></header>
      <p className={styles.description}>{t("publication_music_scope")}</p>
      {inactiveHint ? <p className={styles.description} role="status">{inactiveHint}</p> : null}
      {selectionLocked ? <p className={styles.description} role="status">{t("publication_music_resume_locked")}</p> : null}
      <fieldset className={styles.options} disabled={disabled || selectionLocked || Boolean(unavailableHint)}>
        <legend className={styles.srOnly}>{t("publication_music_title")}</legend>
        <div className={styles.selection}>
          <div className={styles.picker}>
            <div className={styles.combobox} data-selected-soundtrack><span>{selectedLabel}</span></div>
            {soundtrackList}
          </div>
          {previewButton}
        </div>
        <p className={styles.trackDescription}>{selected?.description || t("publication_music_auto_description")}</p>
        {loading ? <p role="status">{t("publication_music_loading")}</p> : null}
        {loadFailure}
      </fieldset>
      {previewError ? <p className={styles.error} role="alert">{t("publication_music_preview_unavailable")}</p> : null}
      <footer className={styles.footer}><button type="button" onClick={close}>{t("publication_music_done")}</button></footer>
    </dialog>, document.body) : null}
  </span>;
}
