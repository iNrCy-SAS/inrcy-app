"use client";

import { useTranslations } from "next-intl";


import { useEffect, useState } from "react";
import styles from "../dashboard.module.css";

export default function BaseModal({
  title,
  moduleLabel,
  onClose,
  headerHidden = false,
  headerStatus,
  headerStatusMobileHidden = false,
  headerActions,
  titleOnLeftOnMobile = false,
  hideModuleLabelOnMobile = false,
  compact = false,
  maxWidth,
  children,
}: {
  title: string;
  moduleLabel?: string; // ex: "Module Booster", "Module Fidéliser"
  onClose: () => void | Promise<void>;
  headerHidden?: boolean;
  headerStatus?: React.ReactNode;
  headerStatusMobileHidden?: boolean;
  headerActions?: React.ReactNode;
  titleOnLeftOnMobile?: boolean;
  hideModuleLabelOnMobile?: boolean;
  compact?: boolean;
  maxWidth?: number | string;
  children: React.ReactNode;
}) {
  const i18nT = useTranslations("shell");
  const resolvedMaxWidth = typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth;
  const [isMobileHeader, setIsMobileHeader] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 768px)");
    const sync = () => setIsMobileHeader(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  const titleMovesLeft = titleOnLeftOnMobile && isMobileHeader;
  const showModuleLabel = Boolean(moduleLabel) && !(hideModuleLabelOnMobile && isMobileHeader);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") void onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyTouchAction = body.style.touchAction;
    const prevBodyOverscroll = (body.style as any).overscrollBehavior;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    (body.style as any).overscrollBehavior = "none";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.touchAction = prevBodyTouchAction;
      (body.style as any).overscrollBehavior = prevBodyOverscroll;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={styles.fullscreenModalOverlay}
      onMouseDown={() => void onClose()}
      style={{
        position: "fixed",
        inset: 0,
        height: "100dvh",
        maxHeight: "100dvh",
        zIndex: 90,
        background:
          "radial-gradient(circle at 12% 0%, rgba(56,189,248,0.18), transparent 36%), radial-gradient(circle at 88% 8%, rgba(168,85,247,0.16), transparent 38%), linear-gradient(180deg, #050817 0%, #070a16 48%, #050711 100%)",
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
        display: "flex",
        alignItems: compact ? "center" : "stretch",
        justifyContent: compact ? "center" : "stretch",
        padding: compact
          ? "max(16px, var(--inrcy-safe-area-top)) max(16px, var(--inrcy-safe-area-right)) max(16px, var(--inrcy-safe-area-bottom)) max(16px, var(--inrcy-safe-area-left))"
          : "var(--inrcy-modal-overlay-padding, max(8px, var(--inrcy-safe-area-top)) max(8px, var(--inrcy-safe-area-right)) max(8px, var(--inrcy-safe-area-bottom)) max(8px, var(--inrcy-safe-area-left)))",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={[styles.blockCard, styles.fullscreenModalCard].join(" ")}
        style={{
          width: compact ? "min(100%, var(--inrcy-compact-modal-width, 680px))" : "100%",
          maxWidth: compact ? (resolvedMaxWidth || "680px") : "100%",
          height: compact ? "auto" : "100%",
          maxHeight: compact ? "calc(100dvh - 32px)" : "100%",
          boxSizing: "border-box",
          minWidth: 0,
          borderRadius: "var(--inrcy-modal-card-radius, 22px)",
          overflow: "hidden",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          background:
            "radial-gradient(circle at 16% 8%, rgba(56,189,248,0.14), transparent 32%), radial-gradient(circle at 86% 4%, rgba(168,85,247,0.13), transparent 34%), linear-gradient(180deg, #0b1020 0%, #0a0e1c 48%, #080b17 100%)",
        }}
      >
        {/* Header sticky (unique) */}
        {!headerHidden ? (
          <div
            className={[styles.blockHeaderRow, styles.fullscreenModalHeader].join(" ")}
            style={{
              alignItems: "center",
              padding: "var(--inrcy-modal-header-padding, max(12px, var(--inrcy-safe-area-top)) max(12px, var(--inrcy-safe-area-right)) max(12px, var(--inrcy-safe-area-bottom)) max(12px, var(--inrcy-safe-area-left)))",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              position: "sticky",
              top: 0,
              background:
                "linear-gradient(180deg, rgba(13,18,34,0.995), rgba(10,14,27,0.995))",
              backdropFilter: "none",
              WebkitBackdropFilter: "none",
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: "100%",
                minWidth: 0,
                display: "grid",
                gridTemplateColumns: titleMovesLeft
                  ? "minmax(0, auto) minmax(0, 1fr) minmax(0, auto)"
                  : "minmax(0, auto) minmax(0, 1fr) minmax(0, auto)",
                alignItems: "center",
                gap: isMobileHeader ? 5 : 12,
              }}
            >
              {/* Left badge */}
              <div style={{ minWidth: 0 }}>
                {titleMovesLeft ? (
                  <span style={isMobileHeader ? compactPillStyle : pillStyle}>{title}</span>
                ) : showModuleLabel ? (
                  <span style={isMobileHeader ? compactPillStyle : pillStyle}>{moduleLabel}</span>
                ) : null}
              </div>

              {/* Center title */}
              <div style={{ textAlign: titleMovesLeft ? "left" : "center", minWidth: 0 }}>
                {!titleMovesLeft ? <span style={isMobileHeader ? compactPillStyle : pillStyle}>{title}</span> : null}
              </div>

              {/* Right actions */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: isMobileHeader ? 5 : 8,
                  minWidth: 0,
                  flexWrap: "nowrap",
                }}
              >
                {headerStatus ? (
                  <div
                    className={styles.modalHeaderStatusDesktop}
                    style={{
                      minWidth: 0,
                      maxWidth: "min(360px, 42vw)",
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    {headerStatus}
                  </div>
                ) : null}
                {headerActions}
                <button
                  type="button"
                  className={[styles.ghostBtn, styles.modalCloseButton].join(" ")}
                  onClick={() => void onClose()}
                  style={isMobileHeader ? compactCloseBtnStyle : closeBtnStyle}
                  aria-label={i18nT("fermer_5ab4ec64")}
                  title={i18nT("fermer_5ab4ec64")}
                >
                  <span className={styles.modalCloseDesktopLabel}>{i18nT("fermer_5ab4ec64")}</span>
                  <span className={styles.modalCloseMobileLabel} aria-hidden="true">×</span>
                </button>
              </div>
            </div>
            {headerStatus && !headerStatusMobileHidden ? (
              <div className={styles.modalHeaderStatusMobile}>
                {headerStatus}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Content scroll */}
        <div
          className={styles.fullscreenModalScroll}
          style={{
            padding: "var(--inrcy-modal-content-padding, max(12px, var(--inrcy-safe-area-top)) max(12px, var(--inrcy-safe-area-right)) max(12px, var(--inrcy-safe-area-bottom)) max(12px, var(--inrcy-safe-area-left)))",
            overflowY: "auto",
            overflowX: "hidden",
            flex: compact ? "0 1 auto" : 1,
            minHeight: 0,
            minWidth: 0,
            boxSizing: "border-box",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            touchAction: "pan-y",
          }}
        >
          <div
            className={styles.fullscreenModalInner}
            style={{
              maxWidth: compact ? "100%" : "var(--inrcy-modal-inner-max-width, min(1400px, 100%))",
              margin: "0 auto",
              minWidth: 0,
              boxSizing: "border-box",
              minHeight: compact ? "auto" : "100%",
              height: compact ? "auto" : "100%",
              width: "100%",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

const pillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 12px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  whiteSpace: "normal",
  textAlign: "center",
  maxWidth: "100%",
};


const compactPillStyle: React.CSSProperties = {
  ...pillStyle,
  gap: 5,
  padding: "6px 9px",
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const closeBtnStyle: React.CSSProperties = {
  // garde le look "bulle" même si ghostBtn change
  borderRadius: 999,
  padding: "7px 12px",
};

const compactCloseBtnStyle: React.CSSProperties = {
  ...closeBtnStyle,
  width: 32,
  minWidth: 32,
  minHeight: 32,
  padding: 0,
  display: "inline-grid",
  placeItems: "center",
};
