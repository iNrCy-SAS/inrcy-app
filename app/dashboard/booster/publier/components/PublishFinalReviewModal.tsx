import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import type { ChannelKey, PublicationMediaType } from "../publishModal.shared";
import css from "./PublishFinalReviewModal.module.css";

export type PublishFinalReviewItem = {
  channel: ChannelKey;
  label: string;
  mediaType: PublicationMediaType;
  mediaLabel: string;
  imageCount: number;
  details?: string[];
  warnings: string[];
  blockers: string[];
  publishable?: boolean;
  tiktokParametersValidated?: boolean;
  hasContent: boolean;
  hasTitle: boolean;
  hasText: boolean;
  hasImage: boolean;
};


type Props = {
  open: boolean;
  styles: Readonly<Record<string, string>>;
  items: PublishFinalReviewItem[];
  hasBlockers: boolean;
  publishableCount: number;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function PublishFinalReviewModal({
  open, styles, items, hasBlockers, publishableCount, saving, onClose, onConfirm,
}: Props) {
  const t = useTranslations("booster");
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!saving) onClose();
      }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") || []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!first) { event.preventDefault(); dialogRef.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); previous?.focus({ preventScroll: true }); };
  }, [open, onClose, saving]);
  if (!open) return null;
  return createPortal(
    <div className={css.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className={css.dialog} ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={saving} tabIndex={-1}>
        <span className={css.mark} aria-hidden="true"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m21 3-7 18-4-7-7-4Z"/><path d="m10 14 5-5"/></svg></span>
        <h2 id={titleId}>{t("wizard_confirm_publication")}</h2>
        <p id={descriptionId}>{hasBlockers ? t("publier_les_value_canal_aux_prets_400cb943", { value0: publishableCount }) : t("value_canal_aux_selectionne_s_e508e84f", { value0: items.length })}</p>
        <div className={css.actions}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={saving}>{t("annuler_49ba3292")}</button>
          <button type="button" className={styles.primaryBtn} onClick={onConfirm} disabled={!publishableCount || saving}>{t("publier_34e6b19e")}</button>
        </div>
      </div>
    </div>, document.body,
  );
}
