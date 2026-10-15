"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { MediaGenerationKind } from "../_hooks/useMediaGeneration";
import styles from "./MediaPromptHelp.module.css";

function PromptHelpDialog({ kind, onClose }: { kind: MediaGenerationKind; onClose: () => void }) {
  const t = useTranslations("media");
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tipKeys = [
    `ai_generator_prompt_helper_subject_${kind}`,
    `ai_generator_prompt_helper_style_${kind}`,
    ...(kind === "video" ? ["ai_generator_prompt_helper_sound_video"] : []),
    `ai_generator_prompt_helper_text_${kind}`,
  ];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialogRef} className={styles.dialog} aria-modal="true"
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} data-media-prompt-help-dialog
    onKeyDown={(event) => {
      event.stopPropagation();
      // This optional, read-only help has one focusable control.
      if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); }
    }}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onClick={(event) => {
      event.stopPropagation();
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className={styles.header}>
      <h2 id={`${id}-title`}>{t(`ai_generator_prompt_helper_title_${kind}`)}</h2>
      <button ref={closeRef} type="button" className={styles.close} onClick={onClose}
        aria-label={t("ai_generator_prompt_helper_close")}>×</button>
    </header>
    <div className={styles.body}>
      <p id={`${id}-intro`} className={styles.intro}>{t("ai_generator_prompt_helper_intro")}</p>
      <ul className={styles.tips}>{tipKeys.map((key) => <li key={key}>{t(key)}</li>)}</ul>
      <section className={styles.example}>
        <h3>{t("ai_generator_prompt_helper_example_label")}</h3>
        <p>{t(`ai_generator_prompt_helper_example_${kind}`)}</p>
      </section>
      <p className={styles.note}>{t(`ai_generator_prompt_helper_settings_${kind}`)}</p>
      <p className={styles.note}>{t("ai_generator_prompt_helper_references")}</p>
    </div>
  </dialog>;
}

/** Read-only advice: opening help never rewrites or submits the pro's prompt. */
export default function MediaPromptHelp({ kind }: { kind: MediaGenerationKind }) {
  const t = useTranslations("media");
  const [open, setOpen] = useState(false);
  const label = t(`ai_generator_prompt_helper_title_${kind}`);
  return <>
    <button type="button" className={styles.trigger} aria-label={label} title={label}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} data-media-prompt-help>
      <span aria-hidden="true">?</span>
    </button>
    {open ? <PromptHelpDialog kind={kind} onClose={() => setOpen(false)} /> : null}
  </>;
}
