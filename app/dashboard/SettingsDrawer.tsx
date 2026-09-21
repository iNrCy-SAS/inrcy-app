"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDashboardI18n } from "./_hooks/useDashboardI18n";

type Props = {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  /** Présentation latérale historique ou grand dialogue central. */
  presentation?: "drawer" | "centered";
  /** Contenu visuel optionnel remplaçant le titre standard du bandeau. */
  headerContent?: React.ReactNode;
  /** Courte description affichée à gauche du bandeau des outils plein écran. */
  headerLead?: React.ReactNode;
  /** Ajustements visuels optionnels du bandeau, sans modifier sa structure. */
  headerStyle?: React.CSSProperties;
  /** Ajout optionnel (ex: bouton ? d'aide) placé à gauche de "Fermer" */
  headerActions?: React.ReactNode;
  /** Autorise la fermeture en cliquant sur l'arrière-plan. Activé par défaut. */
  closeOnBackdrop?: boolean;
  /** Autorise la fermeture avec la touche Échap. Activé par défaut. */
  closeOnEscape?: boolean;
  children: React.ReactNode;
};

const RESPONSIVE_BREAKPOINT = 1100;
const PHONE_BREAKPOINT = 640;
const MOBILE_BOTTOM_NAV_HEIGHT =
  "var(--inrcy-mobile-bottom-nav-total-height, calc(50px + var(--inrcy-safe-area-bottom)))";

export default function SettingsDrawer({
  title,
  isOpen,
  onClose,
  presentation = "drawer",
  headerContent,
  headerLead,
  headerStyle,
  headerActions,
  closeOnBackdrop = true,
  closeOnEscape = true,
  children,
}: Props) {
  const t = useDashboardI18n();
  const titleId = useId();
  // Valeurs stables côté serveur/client au premier rendu : évite les erreurs React #418
  // quand le drawer est ouvert directement depuis une URL sur mobile.
  const [portalReady, setPortalReady] = useState(false);
  const [hasBeenOpened, setHasBeenOpened] = useState(isOpen);
  const [viewportWidth, setViewportWidth] = useState<number>(1440);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState(0);
  const isResponsive = viewportWidth <= RESPONSIVE_BREAKPOINT;
  const isPhone = viewportWidth <= PHONE_BREAKPOINT;
  const isCentered = presentation === "centered";

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (isOpen) setHasBeenOpened(true);
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewport = () => {
      const visualViewport = window.visualViewport;
      setViewportWidth(Math.round(visualViewport?.width || window.innerWidth));
      setViewportHeight(Math.round(visualViewport?.height || window.innerHeight));
      setViewportOffsetTop(Math.max(0, Math.round(visualViewport?.offsetTop || 0)));
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
    };
  }, []);

  const responsiveDrawerHeight = useMemo(() => {
    const visibleViewportHeight = viewportHeight ? `${viewportHeight}px` : "100svh";
    return `calc(${visibleViewportHeight} - ${MOBILE_BOTTOM_NAV_HEIGHT})`;
  }, [viewportHeight]);

  const centeredDrawerHeight = viewportHeight ? `${viewportHeight}px` : "100dvh";
  const drawerHeight = isCentered
    ? centeredDrawerHeight
    : isResponsive
      ? responsiveDrawerHeight
      : "100%";

  useEffect(() => {
    if (!isOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeOnEscape, isOpen, onClose]);

  if (!hasBeenOpened || !portalReady) return null;

  const drawer = (
    <div
      aria-hidden={!isOpen}
      onClick={closeOnBackdrop ? onClose : undefined}
      style={{
        position: "fixed",
        top: isCentered || isResponsive ? viewportOffsetTop : 0,
        left: 0,
        right: 0,
        bottom: "auto",
        width: "100%",
        height: drawerHeight,
        maxHeight: isCentered ? undefined : drawerHeight,
        background: "var(--inrcy-theme-drawer-backdrop, rgba(0,0,0,0.55))",
        zIndex: 2147483001,
        display: isOpen ? "flex" : "none",
        alignItems: "stretch",
        justifyContent: isPhone ? "stretch" : isCentered ? "center" : "flex-end",
        overflow: "hidden",
        isolation: "isolate",
        pointerEvents: "auto",
        padding: 0,
        boxSizing: "border-box",
      }}
    >
      <aside
        data-dashboard-settings-drawer="true"
        data-dashboard-settings-modal={isCentered ? "true" : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isCentered
            ? "100%"
            : isPhone
            ? "100%"
            : "min(560px, 92%)",
          maxWidth: isCentered ? undefined : "100%",
          height: "100%",
          maxHeight: isCentered ? undefined : "100%",
          minHeight: 0,
          boxSizing: "border-box",
          background: "var(--inrcy-theme-drawer-background, rgba(16,16,16,0.98))",
          color: "var(--inrcy-theme-text-primary, rgba(255,255,255,0.92))",
          border: 0,
          borderLeft: isPhone || isCentered
            ? 0
            : "1px solid var(--inrcy-theme-border, rgba(255,255,255,0.08))",
          borderRight: 0,
          borderRadius: 0,
          boxShadow: "none",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflowY: "hidden",
          overflowX: "hidden",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          scrollPaddingBottom: 24,
          position: "relative",
          zIndex: 1,
          pointerEvents: "auto",
        }}
      >
        <div
          data-dashboard-settings-drawer-header="true"
          style={{
            display: "grid",
            gridTemplateColumns: isCentered && !isResponsive
              ? "minmax(0, 1fr) minmax(0, 620px) minmax(0, 1fr)"
              : "minmax(0, 1fr) auto",
            alignItems: "center",
            gap: 12,
            minWidth: 0,
            width: "100%",
            flex: "0 0 auto",
            boxSizing: "border-box",
            padding: isPhone
              ? "max(9px, var(--inrcy-safe-area-top)) max(10px, var(--inrcy-safe-area-right)) 9px max(10px, var(--inrcy-safe-area-left))"
              : isCentered
                ? "10px 14px"
                : 16,
            borderBottom: "1px solid var(--inrcy-theme-border, rgba(255,255,255,0.08))",
            background: "var(--inrcy-theme-drawer-background, rgba(16,16,16,0.98))",
            ...headerStyle,
          }}
        >
          {isCentered && !isResponsive && headerLead ? (
            <div
              style={{
                gridColumn: "1",
                minWidth: 0,
                maxWidth: 420,
                justifySelf: "start",
                paddingLeft: 4,
                color: "rgba(241,245,249,0.88)",
                fontSize: "clamp(0.92rem, 1vw, 1.08rem)",
                fontWeight: 720,
                lineHeight: 1.3,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
              }}
            >
              {headerLead}
            </div>
          ) : null}

          <div
            style={{
              minWidth: 0,
              width: "100%",
              maxWidth: "100%",
              gridColumn: isCentered && !isResponsive ? "2" : "1",
              justifySelf: isCentered && !isResponsive ? "center" : "stretch",
            }}
          >
            {headerContent ? (
              <>
                <span
                  id={titleId}
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: "hidden",
                    clip: "rect(0, 0, 0, 0)",
                    whiteSpace: "nowrap",
                    border: 0,
                  }}
                >
                  {title}
                </span>
                {headerContent}
              </>
            ) : (
              <h2
                id={titleId}
                style={{
                  margin: 0,
                  color: "var(--inrcy-theme-text-primary, white)",
                  fontSize: "clamp(16px, 4.3vw, 18px)",
                  fontWeight: 800,
                  minWidth: 0,
                  maxWidth: "100%",
                  overflowWrap: "break-word",
                  wordBreak: "normal",
                  hyphens: "auto",
                  lineHeight: 1.25,
                }}
              >
                {title}
              </h2>
            )}
          </div>

          {/* Zone actions (ex: ?) + Fermer avec gap */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
              flexWrap: "wrap",
              justifyContent: "flex-end",
              maxWidth: "100%",
              gridColumn: isCentered && !isResponsive ? "3" : "2",
              justifySelf: "end",
              position: "relative",
              zIndex: 2,
              pointerEvents: "auto",
            }}
          >
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label={t.drawer.close}
              title={t.drawer.close}
              style={{
                border: "1px solid var(--inrcy-theme-border-strong, rgba(255,255,255,0.12))",
                background: "var(--inrcy-theme-surface-soft, transparent)",
                color: "var(--inrcy-theme-text-primary, white)",
                display: "inline-grid",
                placeItems: "center",
                width: isResponsive ? 40 : undefined,
                minWidth: isResponsive ? 40 : undefined,
                height: isResponsive ? 40 : undefined,
                minHeight: isResponsive ? 40 : isCentered ? 38 : undefined,
                borderRadius: isResponsive ? 12 : isCentered ? 999 : 10,
                padding: isResponsive ? 0 : isCentered ? "8px 14px" : "8px 10px",
                fontSize: isResponsive ? 24 : undefined,
                lineHeight: 1,
                fontWeight: isCentered ? 850 : undefined,
                cursor: "pointer",
                position: "relative",
                zIndex: 3,
                pointerEvents: "auto",
                touchAction: "manipulation",
              }}
            >
              <span aria-hidden="true">{isResponsive ? "×" : t.drawer.close}</span>
            </button>
          </div>
        </div>

        <div
          data-dashboard-settings-drawer-scroll="true"
          style={{
            flex: "1 1 auto",
            width: "100%",
            minWidth: 0,
            minHeight: 0,
            maxWidth: "100%",
            overflowX: "hidden",
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            boxSizing: "border-box",
            padding: isPhone
              ? "12px max(12px, var(--inrcy-safe-area-right)) max(24px, var(--inrcy-safe-area-bottom)) max(12px, var(--inrcy-safe-area-left))"
              : "12px 16px 16px",
            scrollPaddingBottom: isResponsive ? 24 : 16,
          }}
        >
          {children}
        </div>
      </aside>
    </div>
  );

  return createPortal(drawer, document.body);
}
