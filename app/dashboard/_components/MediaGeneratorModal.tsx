"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

import {
  discardMediaGenerationDraft,
  type MediaGenerationResult,
  type MediaGenerationSource,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import MediaGenerator, {
  type MediaGeneratorAcceptMode,
  type MediaGeneratorOrigin,
  type MediaGeneratorStudioMode,
} from "./MediaGenerator";
import MediaModifier from "./MediaModifier";
import MediaRetoucher, {
  type MediaStudioInitialPreview,
  type MediaRetoucherSavedValue,
} from "./MediaRetoucher";
import MediaVideoRetoucher, {
  type MediaVideoRetoucherInitialContext,
  type MediaVideoRetoucherSavedValue,
} from "./MediaVideoRetoucher";

import styles from "./MediaGeneratorModal.module.css";

type MediaGeneratorModalProps = {
  open: boolean;
  embedded?: boolean;
  source: MediaGenerationSource;
  origin: MediaGeneratorOrigin;
  initialTab?: MediaGeneratorStudioMode;
  initialSource?: File | null;
  initialPreview?: MediaStudioInitialPreview | null;
  initialSourceLoading?: boolean;
  initialMediaType?: "image" | "video";
  initialVideoContext?: MediaVideoRetoucherInitialContext | null;
  publicationBrief?: string;
  acceptMode: MediaGeneratorAcceptMode;
  handoffOriginLabel?: string | null;
  onClose: () => void;
  onAbandonHandoff?: () => void | Promise<void>;
  onAccepted: (result: MediaGenerationResult) => void | Promise<void>;
  onRetouched?: (value: MediaRetoucherSavedValue) => void | Promise<void>;
  onVideoRetouched?: (
    value: MediaVideoRetoucherSavedValue
  ) => void | Promise<void>;
};

type StudioMediaType = "image" | "video";

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("aria-hidden"));
}

export default function MediaGeneratorModal({
  open,
  embedded = false,
  source,
  origin,
  initialTab = "generate",
  initialSource = null,
  initialPreview = null,
  initialSourceLoading = false,
  initialMediaType = "image",
  initialVideoContext = null,
  publicationBrief = "",
  acceptMode,
  handoffOriginLabel = null,
  onClose,
  onAbandonHandoff,
  onAccepted,
  onRetouched,
  onVideoRetouched,
}: MediaGeneratorModalProps) {
  const t = useTranslations("media");
  const closeTitleId = useId();
  const closeDescriptionId = useId();
  const [mounted, setMounted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [retoucherDirty, setRetoucherDirty] = useState(false);
  const [currentResult, setCurrentResult] =
    useState<MediaGenerationResult | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [studioTab, setStudioTab] =
    useState<MediaGeneratorStudioMode>(initialTab);
  const [mediaTypeByTab, setMediaTypeByTab] = useState<
    Record<MediaGeneratorStudioMode, StudioMediaType>
  >(() => ({
    generate: initialTab === "generate" ? initialMediaType : "image",
    modify: "image",
    retouch: initialTab === "retouch" ? initialMediaType : "image",
  }));
  const dialogRef = useRef<HTMLElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeConfirmDialogRef = useRef<HTMLElement | null>(null);
  const closeConfirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const closeConfirmPreviousFocusRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const currentResultRef = useRef<MediaGenerationResult | null>(null);
  const closeInFlightRef = useRef(false);
  const hasResult = Boolean(currentResult);
  const hasPendingWork = hasResult || retoucherDirty;
  const hasExternalHandoff = Boolean(
    handoffOriginLabel && onAbandonHandoff
  );
  const studioWordmark = t("ai_generator_made_inrcy");
  const activeMediaType = mediaTypeByTab[studioTab];

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!embedded || !mounted || !open || !layerRef.current) return;
    const background = Array.from(document.body.children)
      .filter((node): node is HTMLElement => node instanceof HTMLElement && node !== layerRef.current)
      .map((node) => ({ node, inert: node.inert }));
    background.forEach(({ node }) => { node.inert = true; });
    return () => { background.forEach(({ node, inert }) => { node.inert = inert; }); };
  }, [embedded, mounted, open]);

  useEffect(() => {
    if (!open) return;
    setStudioTab(initialTab);
    setMediaTypeByTab({
      generate: initialTab === "generate" ? initialMediaType : "image",
      modify: "image",
      retouch: initialTab === "retouch" ? initialMediaType : "image",
    });
    setRetoucherDirty(false);
  }, [initialMediaType, initialTab, open]);

  const handleResultChange = useCallback(
    (result: MediaGenerationResult | null) => {
      currentResultRef.current = result;
      setCurrentResult(result);
      if (!result) setCloseConfirmOpen(false);
    },
    []
  );

  const requestClose = useCallback(() => {
    if (locked) return;
    if (hasExternalHandoff || hasPendingWork) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  }, [hasExternalHandoff, hasPendingWork, locked, onClose]);

  const requestStudioTab = useCallback(
    (tab: MediaGeneratorStudioMode) => {
      if (tab === studioTab || locked || hasPendingWork) return;
      if (hasExternalHandoff) {
        setCloseConfirmOpen(true);
        return;
      }
      setStudioTab(tab);
    },
    [hasExternalHandoff, hasPendingWork, locked, studioTab]
  );

  const requestMediaType = useCallback(
    (mediaType: StudioMediaType) => {
      if (mediaType === activeMediaType || locked || hasPendingWork) return;
      if (hasExternalHandoff) {
        setCloseConfirmOpen(true);
        return;
      }
      setMediaTypeByTab((current) => ({
        ...current,
        [studioTab]: mediaType,
      }));
    },
    [activeMediaType, hasExternalHandoff, hasPendingWork, locked, studioTab]
  );

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

  const confirmAbandonHandoff = useCallback(async () => {
    if (
      !onAbandonHandoff ||
      locked ||
      closeInFlightRef.current
    ) {
      return;
    }
    closeInFlightRef.current = true;
    setCloseConfirmOpen(false);
    setLocked(true);
    const resultToDiscard = currentResultRef.current;
    try {
      if (resultToDiscard?.draft) {
        await discardMediaGenerationDraft(resultToDiscard.item.id);
      }
    } catch {
      // La fermeture du parcours reste prioritaire. Le nettoyage serveur des
      // brouillons temporaires supprimera un éventuel reliquat sous 24 h.
    } finally {
      currentResultRef.current = null;
      setCurrentResult(null);
      closeInFlightRef.current = false;
      await onAbandonHandoff();
    }
  }, [locked, onAbandonHandoff]);

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
    if (!open || (!locked && !hasPendingWork && !hasExternalHandoff)) return;
    const preventAccidentalUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalUnload);
    return () => {
      window.removeEventListener("beforeunload", preventAccidentalUnload);
    };
  }, [hasExternalHandoff, hasPendingWork, locked, open]);

  useEffect(() => {
    if (!open) return;
    const discardOnCommittedNavigation = () => {
      const pending = currentResultRef.current;
      if (pending?.draft) {
        void discardMediaGenerationDraft(pending.item.id).catch(
          () => undefined
        );
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

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Portal events must never reach the still-mounted editor's shortcuts.
    if (embedded) event.stopPropagation();
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (closeConfirmOpen) {
        cancelClose();
        return;
      }
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const activeDialog = closeConfirmOpen
      ? closeConfirmDialogRef.current
      : dialogRef.current;
    const focusable = getFocusableElements(activeDialog);
    if (!focusable.length) {
      event.preventDefault();
      activeDialog?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!activeDialog?.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [cancelClose, closeConfirmOpen, embedded, requestClose]);

  useEffect(() => {
    if (!closeConfirmOpen) return;
    closeConfirmPreviousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      closeConfirmCancelRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (dialogRef.current?.isConnected) {
        closeConfirmPreviousFocusRef.current?.focus?.({ preventScroll: true });
      }
      closeConfirmPreviousFocusRef.current = null;
    };
  }, [closeConfirmOpen]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={layerRef}
      className={styles.layer}
      onKeyDown={handleKeyDown}
      role="presentation"
      data-disable-pull-refresh="true"
      data-media-generator-origin={origin}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={styles.backdrop}
        aria-label={t("fermer_5ab4ec64")}
        aria-hidden={closeConfirmOpen ? true : undefined}
        disabled={locked || closeConfirmOpen}
        onClick={requestClose}
      />
      <section
        ref={dialogRef}
        className={styles.dialog}
        data-studio-tab={studioTab}
        role="dialog"
        aria-modal="true"
        aria-hidden={closeConfirmOpen ? true : undefined}
        inert={closeConfirmOpen ? true : undefined}
        aria-label={t("ai_generator_modal_title")}
      >
        <header className={styles.header}>
          <div className={styles.moduleIdentity}>
            <span className={styles.icon} aria-hidden="true">
              ✦
            </span>
            <div>
              <strong
                className={styles.studioWordmark}
                aria-label={studioWordmark}
              >
                <span>{studioWordmark.slice(0, 4)}</span>
                <b>{studioWordmark.slice(4)}</b>
              </strong>
              <p>{t("ai_generator_made_inrcy_hint")}</p>
            </div>
          </div>
          <div className={styles.heading}>
            <nav
              className={styles.studioTabs}
              aria-label={t("ai_generator_studio_tabs_label")}
            >
              {(
                [
                  ["generate", "ai_generator_studio_tab_generate"],
                  ["modify", "ai_generator_studio_tab_modify"],
                  ["retouch", "ai_generator_studio_tab_retouch"],
                ] as const
              ).map(([tab, labelKey]) => (
                <button
                  key={tab}
                  type="button"
                  className={styles.studioTab}
                  data-studio-tab={tab}
                  data-active={studioTab === tab ? "true" : "false"}
                  disabled={locked || hasPendingWork}
                  onClick={() => requestStudioTab(tab)}
                >
                  {t(labelKey)}
                </button>
              ))}
            </nav>
            <div
              className={styles.mediaTypeTabs}
              role="radiogroup"
              aria-label={t("ai_generator_essential_media_type")}
            >
              {(["image", "video"] as const).map((mediaType) => {
                const unavailable =
                  studioTab === "modify" && mediaType === "video";
                return (
                  <button
                    key={mediaType}
                    type="button"
                    role="radio"
                    aria-checked={activeMediaType === mediaType}
                    data-active={
                      activeMediaType === mediaType ? "true" : "false"
                    }
                    disabled={locked || hasPendingWork || unavailable}
                    onClick={() => requestMediaType(mediaType)}
                  >
                    <span aria-hidden="true">
                      {mediaType === "image" ? "▣" : "▶"}
                    </span>
                    {t(
                      mediaType === "image"
                        ? "image_50e19fda"
                        : "video_304f6ca4"
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className={styles.headerActions}>
            <Link
              href="/dashboard/mediatheque"
              className={styles.mediaLibraryLink}
              aria-label={t("mediatheque_inrcy_a885e19e")}
              title={t("mediatheque_inrcy_a885e19e")}
              aria-disabled={locked || undefined}
              tabIndex={locked ? -1 : undefined}
              onClick={(event) => {
                if (locked || hasExternalHandoff || hasPendingWork) {
                  event.preventDefault();
                }
                if (!locked && (hasExternalHandoff || hasPendingWork)) {
                  requestClose();
                }
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4.75 5.75h14.5v12.5H4.75z" />
                <path d="m7.25 15 3.15-3.15 2.35 2.35 1.65-1.65 2.35 2.45" />
                <circle cx="15.5" cy="9" r="1.35" />
              </svg>
              <span>{t("mediatheque_e4fa8e31")}</span>
            </Link>
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
          {studioTab === "retouch" ? (
            <div className={styles.retouchWorkspace}>
              {activeMediaType === "video" ? (
                <MediaVideoRetoucher
                  initialSource={
                    initialMediaType === "video" ? initialSource : null
                  }
                  initialPreview={
                    initialMediaType === "video" ? initialPreview : null
                  }
                  initialSourceLoading={
                    initialMediaType === "video" && initialSourceLoading
                  }
                  initialContext={initialVideoContext}
                  onEditingChange={setLocked}
                  onDirtyChange={setRetoucherDirty}
                  onSaved={onVideoRetouched}
                  acceptMode={acceptMode}
                />
              ) : (
                <MediaRetoucher
                  initialSource={
                    initialMediaType === "image" ? initialSource : null
                  }
                  initialPreview={
                    initialMediaType === "image" ? initialPreview : null
                  }
                  initialSourceLoading={
                    initialMediaType === "image" && initialSourceLoading
                  }
                  onEditingChange={setLocked}
                  onDirtyChange={setRetoucherDirty}
                  onSaved={onRetouched}
                  acceptMode={acceptMode}
                />
              )}
            </div>
          ) : studioTab === "modify" ? (
            <MediaModifier
              key="modify"
              source={source}
              initialSource={
                initialMediaType === "image" ? initialSource : null
              }
              initialPreview={
                initialMediaType === "image" ? initialPreview : null
              }
              initialSourceLoading={
                initialMediaType === "image" && initialSourceLoading
              }
              acceptMode={acceptMode}
              onAccepted={onAccepted}
              onResultChange={handleResultChange}
              onBusyChange={setLocked}
            />
          ) : (
            <MediaGenerator
              key="generate"
              source={source}
              origin={origin}
              publicationBrief={publicationBrief}
              acceptMode={acceptMode}
              studioMode="generate"
              mediaType={activeMediaType}
              onAccepted={onAccepted}
              onResultChange={handleResultChange}
              onBusyChange={setLocked}
            />
          )}
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
            ref={closeConfirmDialogRef}
            className={styles.closeConfirmDialog}
            role="alertdialog"
            aria-modal="true"
            tabIndex={-1}
            aria-labelledby={closeTitleId}
            aria-describedby={closeDescriptionId}
          >
            <h3 id={closeTitleId}>
              {hasExternalHandoff
                ? t("ai_studio_origin_exit_title", {
                    origin: handoffOriginLabel || "iNrCy",
                  })
                : t(
                    acceptMode === "insert"
                      ? "ai_generator_close_confirm_title"
                      : "ai_generator_close_library_title"
                  )}
            </h3>
            <p id={closeDescriptionId}>
              {hasExternalHandoff
                ? t(embedded ? "ai_studio_embedded_exit_description" : "ai_studio_origin_exit_description", {
                    origin: handoffOriginLabel || "iNrCy",
                  })
                : t(
                    acceptMode === "insert"
                      ? "ai_generator_close_confirm_description"
                      : "ai_generator_close_library_description"
                  )}
            </p>
            <div className={styles.closeConfirmActions}>
              <button
                ref={closeConfirmCancelRef}
                type="button"
                className={styles.closeConfirmCancel}
                onClick={cancelClose}
              >
                {t(
                  hasExternalHandoff
                    ? "ai_studio_origin_stay"
                    : "ai_generator_close_confirm_cancel"
                )}
              </button>
              {hasExternalHandoff && !embedded ? (
                <button
                  type="button"
                  className={styles.closeConfirmAbandon}
                  onClick={() => void confirmAbandonHandoff()}
                >
                  {t("ai_studio_origin_abandon")}
                </button>
              ) : null}
              <button
                type="button"
                className={styles.closeConfirmLeave}
                onClick={() => void confirmClose()}
              >
                {hasExternalHandoff
                  ? t("ai_studio_origin_return", {
                      origin: handoffOriginLabel || "iNrCy",
                    })
                  : t(
                      acceptMode === "insert"
                        ? "ai_generator_close_confirm_leave"
                        : "ai_generator_close_library_leave"
                    )}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>,
    document.body
  );
}
