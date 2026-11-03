"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import styles from "./MediaFreeGenerator.module.css";

function BusinessDnaDialog({ onClose, openerRef }: { onClose: () => void; openerRef: RefObject<HTMLButtonElement | null> }) {
  const t = useTranslations("media");
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = openerRef.current;
    // Unlike popover, dialog works in Safari 15.4+. Older engines still receive
    // a conditionally mounted, explicitly opened help panel instead of stray UI.
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (typeof dialog.close === "function") dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [openerRef]);
  return <dialog ref={dialogRef} className={styles.businessDnaInfo} role="dialog" aria-modal="true"
    data-business-dna-info aria-labelledby={`${id}-title`}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); }
    }}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onClick={(event) => {
      event.stopPropagation();
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className={styles.businessDnaInfoHeader}>
      <h3 id={`${id}-title`}>{t("ai_generator_use_business_dna_label")}</h3>
      <button ref={closeRef} type="button" className={styles.businessDnaInfoClose} onClick={onClose}
        aria-label={t("ai_generator_use_business_dna_info_close")}>×</button>
    </header>
    <p>{t("ai_generator_use_business_dna_info_sources")}</p>
    <p>{t("ai_generator_use_business_dna_info_identity")}</p>
    <p>{t("ai_generator_use_business_dna_info_contacts")}</p>
    <p>{t("ai_generator_use_business_dna_info_freedom")}</p>
  </dialog>;
}

/** Optional help is absent from the DOM until requested, including on old Safari. */
export default function MediaBusinessDnaHelp() {
  const t = useTranslations("media");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={triggerRef} type="button" className={styles.businessDnaInfoButton}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
      aria-label={t("ai_generator_use_business_dna_info_label")} title={t("ai_generator_use_business_dna_info_label")}>
      <span aria-hidden="true">i</span>
    </button>
    {open ? <BusinessDnaDialog onClose={() => setOpen(false)} openerRef={triggerRef} /> : null}
  </>;
}
