"use client";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  discardMediaGenerationDraft,
  type MediaGenerationResult,
  type MediaGenerationSource,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import MediaGenerator, {
  type MediaGeneratorAcceptMode,
  type MediaGeneratorOrigin,
} from "./MediaGenerator";

import styles from "./MediaGeneratorModal.module.css";

type MediaGeneratorModalProps = {
  open: boolean;
  source: MediaGenerationSource;
  origin: MediaGeneratorOrigin;
  publicationBrief?: string;
  acceptMode: MediaGeneratorAcceptMode;
  onClose: () => void;
  onAccepted: (result: MediaGenerationResult) => void | Promise<void>;
};

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("aria-hidden"));
}

export default function MediaGeneratorModal({
  open,
  source,
  origin,
  publicationBrief = "",
  acceptMode,
  onClose,
  onAccepted,
}: MediaGeneratorModalProps) {
  const t = useTranslations("media");
  const titleId = useId();
  const closeTitleId = useId();
  const closeDescriptionId = useId();
  const [mounted, setMounted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [currentResult, setCurrentResult] =
    useState<MediaGenerationResult | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeConfirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const currentResultRef = useRef<MediaGenerationResult | null>(null);
  const closeInFlightRef = useRef(false);
  const hasResult = Boolean(currentResult);

  useEffect(() => setMounted(true), []);

  const handleResultChange = useCallback(
    (result: MediaGenerationResult | null) => {
      currentResultRef.current = result;
      setCurrentResult(result);
      if (!result) setCloseConfirmOpen(false);
    },
    [],
  );

  const requestClose = useCallback(() => {
    if (locked) return;
    if (hasResult) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  }, [hasResult, locked, onClose]);

  const cancelClose = useCallback(() => {
    setCloseConfirmOpen(false);
  }, []);

  const confirmClose = useCallback(async () => {
    if (locked || closeInFlightRef.current) return;
    closeInFlightRef.current = true;
    setCloseConfirmOpen(false);
    setLocked(true);
    const resultToDiscard = currentResultRef.current;
    try {
      if (resultToDiscard?.draft) {
        await discardMediaGenerationDraft(resultToDiscard.item.id);
      }
    } catch {
      // Closing must stay possible. A failed best-effort deletion remains
      // hidden and is covered by the server-side 24 h draft cleanup.
    } finally {
      if (currentResultRef.current?.item.id === resultToDiscard?.item.id) {
        currentResultRef.current = null;
        setCurrentResult(null);
      }
      closeInFlightRef.current = false;
      onClose();
    }
  }, [locked, onClose]);

  useEffect(() => {
    if (!open || !mounted) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [mounted, open]);

  useEffect(() => {
    if (!open || (!locked && !currentResult)) return;
    const preventAccidentalUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalUnload);
    return () => {
      window.removeEventListener("beforeunload", preventAccidentalUnload);
    };
  }, [currentResult, locked, open]);

  useEffect(() => {
    if (!open) return;
    const discardOnCommittedNavigation = () => {
      const pending = currentResultRef.current;
      if (pending?.draft) {
        void discardMediaGenerationDraft(pending.item.id).catch(() => undefined);
      }
    };
    window.addEventListener("pagehide", discardOnCommittedNavigation);
    return () => {
      window.removeEventListener("pagehide", discardOnCommittedNavigation);
      // Also covers an App Router navigation or an external owner closing the
      // shared modal without going through its close controls.
      discardOnCommittedNavigation();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (closeConfirmOpen) {
          cancelClose();
          return;
        }
        requestClose();
        return;
      }
      if (event.key !== "Tab" || closeConfirmOpen) return;
      const focusable = getFocusableElements(dialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelClose, closeConfirmOpen, open, requestClose]);

  useEffect(() => {
    if (!closeConfirmOpen) return;
    const frame = window.requestAnimationFrame(() => {
      closeConfirmCancelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [closeConfirmOpen]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className={styles.layer}
      role="presentation"
      data-disable-pull-refresh="true"
      data-media-generator-origin={origin}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={styles.backdrop}
        aria-label={t("fermer_5ab4ec64")}
        disabled={locked}
        onClick={requestClose}
      />
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-hidden={closeConfirmOpen ? true : undefined}
        aria-labelledby={titleId}
      >
        <header className={styles.header}>
          <div className={styles.moduleIdentity}>
            <span className={styles.icon} aria-hidden="true">✦</span>
            <div>
              <strong>{t("ai_generator_made_inrcy")}</strong>
              <p>{t("ai_generator_made_inrcy_hint")}</p>
            </div>
          </div>
          <div className={styles.heading}>
            <h2 id={titleId}>{t("ai_generator_modal_title")}</h2>
            <p>{t("ai_generator_modal_subtitle")}</p>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.profileSignals} aria-label={t("ai_generator_made_inrcy_hint")}>
              <span title={t("ai_generator_signal_profile")}><i aria-hidden="true">✓</i><b>{t("ai_generator_signal_profile")}</b></span>
              <span title={t("ai_generator_signal_brand")}><i aria-hidden="true">✓</i><b>{t("ai_generator_signal_brand")}</b></span>
              <span title={t("ai_generator_signal_history")}><i aria-hidden="true">✓</i><b>{t("ai_generator_signal_history")}</b></span>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className={styles.close}
              onClick={requestClose}
              disabled={locked}
              aria-label={t("fermer_5ab4ec64")}
            >
              <span>{t("fermer_5ab4ec64")}</span>
              <i aria-hidden="true">×</i>
            </button>
          </div>
        </header>
        <div className={styles.body}>
          <MediaGenerator
            source={source}
            origin={origin}
            publicationBrief={publicationBrief}
            acceptMode={acceptMode}
            onAccepted={onAccepted}
            onResultChange={handleResultChange}
            onBusyChange={setLocked}
          />
        </div>
      </section>

      {closeConfirmOpen ? (
        <div className={styles.closeConfirmLayer} role="presentation">
          <button
            type="button"
            className={styles.closeConfirmBackdrop}
            aria-label={t("ai_generator_close_confirm_cancel")}
            onClick={cancelClose}
          />
          <section
            className={styles.closeConfirmDialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={closeTitleId}
            aria-describedby={closeDescriptionId}
          >
            <h3 id={closeTitleId}>
              {t(
                acceptMode === "insert"
                  ? "ai_generator_close_confirm_title"
                  : "ai_generator_close_library_title",
              )}
            </h3>
            <p id={closeDescriptionId}>
              {t(
                acceptMode === "insert"
                  ? "ai_generator_close_confirm_description"
                  : "ai_generator_close_library_description",
              )}
            </p>
            <div className={styles.closeConfirmActions}>
              <button
                ref={closeConfirmCancelRef}
                type="button"
                className={styles.closeConfirmCancel}
                onClick={cancelClose}
              >
                {t("ai_generator_close_confirm_cancel")}
              </button>
              <button
                type="button"
                className={styles.closeConfirmLeave}
                onClick={() => void confirmClose()}
              >
                {t(
                  acceptMode === "insert"
                    ? "ai_generator_close_confirm_leave"
                    : "ai_generator_close_library_leave",
                )}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
