"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import css from "./PublishReferencePicker.module.css";

type MediaChoice = { onSelect: () => void; disabled?: boolean; disabledReason?: string; detail?: string };
type Props = {
  disabled: boolean; image: MediaChoice; video: MediaChoice; camera?: MediaChoice;
  documentDetail: string; documentCount?: number;
  onPickDocument: () => void; onGenerateMedia: () => void; onOpenMediaLibrary: () => void;
};

export default function PublishReferencePicker({ disabled, image, video, camera, documentDetail, documentCount = 0, onPickDocument, onGenerateMedia, onOpenMediaLibrary }: Props) {
  const t = useTranslations("booster");
  const mediaT = useTranslations("media");
  const [view, setView] = useState<"sources" | "media" | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const open = view !== null;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setView(null); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const elements = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([aria-disabled="true"])'));
      const first = elements[0], last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); return; }
      if (!dialogRef.current.contains(document.activeElement) || document.activeElement === dialogRef.current || event.shiftKey && document.activeElement === first) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  function choose(onSelect: () => void) { setView(null); onSelect(); }
  const mediaChoices = [
    { key: "image", label: mediaT("local_upload_image"), glyph: "image", formats: ".jpg · .png · .webp · .heic", tone: "cyan", ...image },
    { key: "video", label: mediaT("local_upload_video"), glyph: "video", formats: ".mp4 · .mov · .webm", tone: "pink", ...video },
    ...(camera ? [{ key: "camera", label: t("wizard_camera"), glyph: "camera", formats: "", tone: "violet", ...camera }] : []),
  ];

  return <>
    <button ref={triggerRef} type="button" className={css.trigger} disabled={disabled}
      aria-label={t("wizard_reference_add")} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setView("sources")} data-testid="booster-reference-add"><span aria-hidden="true">＋</span></button>
    {open ? createPortal(<div className={css.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) setView(null); }}>
      <section ref={dialogRef} className={css.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className={css.heading}>
          {view === "media" ? <button type="button" className={css.roundButton} aria-label={t("wizard_reference_back")} onClick={() => { setView("sources"); dialogRef.current?.focus(); }}>←</button> : <ReferenceGlyph kind="add" />}
          <h2 id={titleId}>{view === "media" ? t("wizard_step_media") : t("wizard_reference_add")}</h2>
          <button type="button" className={css.roundButton} aria-label={t("fermer_5ab4ec64")} onClick={() => setView(null)}>×</button>
        </header>
        <div className={css.choices}>
          {view === "sources" ? <>
            <button type="button" className={css.choice} data-tone="cyan" onClick={() => { setView("media"); dialogRef.current?.focus(); }}>
              <ReferenceGlyph kind="media" /><span className={css.mediaLabel}><strong>{t("wizard_step_media")}</strong><small>{t("wizard_reference_media_detail")}</small></span><span className={css.arrow} aria-hidden="true">→</span>
            </button>
            <button type="button" className={css.choice} data-tone="violet" onClick={() => choose(onGenerateMedia)}>
              <ReferenceGlyph kind="sparkle" /><span className={css.mediaLabel}><strong>{t("wizard_generate_media")}</strong><small>{t("wizard_reference_generate_detail")}</small></span><span className={css.arrow} aria-hidden="true">↗</span>
            </button>
            <button type="button" className={css.choice} data-tone="pink" onClick={() => choose(onOpenMediaLibrary)}>
              <ReferenceGlyph kind="library" /><span className={css.mediaLabel}><strong>{t("wizard_media_library")}</strong><small>{t("wizard_reference_library_detail")}</small></span><span className={css.arrow} aria-hidden="true">↗</span>
            </button>
            <button type="button" className={css.choice} data-tone="gold" aria-disabled={documentCount >= 5 || undefined}
              onClick={() => { if (documentCount < 5) choose(onPickDocument); }} title={documentDetail} data-testid="booster-pdf-context-control">
              <ReferenceGlyph kind="file" /><span className={css.mediaLabel}><strong>{t("wizard_file")} <span className={css.count}>{documentCount}/5</span></strong><small className={css.formats}>.pdf · .docx · .xlsx · .csv · .txt</small><small>{t("wizard_reference_document_limits")}</small></span><span className={css.arrow} aria-hidden="true">↗</span>
            </button>
          </> : mediaChoices.map(choice => <button key={choice.key} type="button" className={css.choice} data-tone={choice.tone}
            aria-disabled={choice.disabled || undefined} onClick={() => { if (!choice.disabled) choose(choice.onSelect); }}
            title={choice.disabled ? choice.disabledReason : choice.detail} data-reference-media-choice={choice.key}>
            <ReferenceGlyph kind={choice.glyph} /><span className={css.mediaLabel}><strong>{choice.label}</strong>{choice.formats ? <small className={css.formats}>{choice.formats}</small> : null}<small>{choice.disabled ? choice.disabledReason : choice.detail}</small></span><span className={css.arrow} aria-hidden="true">↗</span>
          </button>)}
        </div>
      </section>
    </div>, document.body) : null}
  </>;
}

function ReferenceGlyph({ kind }: { kind: string }) {
  return <span className={css.glyph} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {kind === "add" ? <><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6M13 3v5h5M13 3l5 5M8 12h3M8 16h3M19 11v6m-3-3h6"/></>
      : kind === "file" ? <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/></>
      : kind === "media" ? <><rect x="2" y="4" width="15" height="15" rx="3"/><circle cx="7" cy="9" r="1.5"/><path d="m2 16 4-4 4 4 3-4 4 4m0-7 5-3v13l-5-3"/></>
      : kind === "image" ? <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>
      : kind === "video" ? <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/></>
      : kind === "camera" ? <><path d="m8 5 2-2h4l2 2h4a1 1 0 0 1 1 1v14H3V6a1 1 0 0 1 1-1Z"/><circle cx="12" cy="12" r="4"/></>
      : kind === "library" ? <><rect x="5" y="7" width="16" height="14" rx="2"/><path d="M2 17V5a2 2 0 0 1 2-2h13m-8 8h8m-8 4h5"/></>
      : <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="M20 2v4m-2-2h4"/></>}
  </svg></span>;
}
