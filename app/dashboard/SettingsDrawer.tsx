"use client";

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDashboardI18n } from "./_hooks/useDashboardI18n";
import LanguageSelector from "./_components/LanguageSelector";

type Props = {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  /** Ajout optionnel (ex: bouton ? d'aide) placé à gauche de "Fermer" */
  headerActions?: React.ReactNode;
  /** Libellé discret affiché au-dessus du titre pendant le parcours initial. */
  progressLabel?: string;
  /** Autorise la fermeture en cliquant sur l'arrière-plan. Activé par défaut. */
  closeOnBackdrop?: boolean;
  /** Autorise la fermeture avec la touche Échap. Activé par défaut. */
  closeOnEscape?: boolean;
  /** Présentation dédiée au tout premier parcours, sans dashboard visible sur desktop. */
  presentation?: "drawer" | "onboarding";
  /** Libellé du bouton de fermeture. */
  closeLabel?: string;
  /** Affiche le bouton de fermeture. Masqué pendant l'onboarding obligatoire. */
  showCloseButton?: boolean;
  /** Identifie la page interne du parcours afin d'animer son remplacement. */
  contentKey?: string;
  /** Sens de lecture de la transition entre deux pages du parcours. */
  contentDirection?: "forward" | "backward";
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
  headerActions,
  progressLabel,
  closeOnBackdrop = true,
  closeOnEscape = true,
  presentation = "drawer",
  closeLabel,
  showCloseButton = true,
  contentKey,
  contentDirection = "forward",
  children,
}: Props) {
  const t = useDashboardI18n();
  const titleId = useId();
  // Valeurs stables côté serveur/client au premier rendu : évite les erreurs React #418
  // quand le drawer est ouvert directement via /dashboard?panel=ia sur mobile.
  const [portalReady, setPortalReady] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(1440);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState(0);
  const drawerScrollRef = useRef<HTMLElement | null>(null);
  const isResponsive = viewportWidth <= RESPONSIVE_BREAKPOINT;
  const isPhone = viewportWidth <= PHONE_BREAKPOINT;
  const isDesktopOnboarding = presentation === "onboarding" && !isResponsive;

  useEffect(() => {
    setPortalReady(true);
  }, []);

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

  const drawerHeight = isResponsive ? responsiveDrawerHeight : "100%";

  useLayoutEffect(() => {
    if (!contentKey) return;
    const drawer = drawerScrollRef.current;
    if (!drawer) return;
    drawer.scrollTop = 0;
  }, [contentKey]);

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

  if (!isOpen || !portalReady) return null;

  const drawer = (
    <div
      onClick={closeOnBackdrop ? onClose : undefined}
      style={{
        position: "fixed",
        top: isResponsive ? viewportOffsetTop : 0,
        left: 0,
        right: 0,
        bottom: "auto",
        width: "100%",
        height: drawerHeight,
        maxHeight: drawerHeight,
        background: isDesktopOnboarding
          ? "radial-gradient(circle at 50% 15%, rgba(56,189,248,.16), transparent 34%), radial-gradient(circle at 78% 76%, rgba(236,72,153,.12), transparent 30%), #06101f"
          : "rgba(0,0,0,0.55)",
        zIndex: 10050,
        display: "flex",
        justifyContent: isPhone ? "stretch" : isDesktopOnboarding ? "center" : "flex-end",
        overflow: "hidden",
        padding: isPhone ? 0 : isDesktopOnboarding ? "0 24px" : undefined,
        boxSizing: "border-box",
      }}
    >
      <aside
        ref={drawerScrollRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isPhone
            ? "100vw"
            : isDesktopOnboarding
              ? "min(860px, calc(100vw - 48px))"
              : "min(560px, 92vw)",
          maxWidth: "100vw",
          height: "100%",
          maxHeight: "100%",
          minHeight: 0,
          boxSizing: "border-box",
          background: "rgba(16,16,16,0.98)",
          color: "rgba(255,255,255,0.92)",
          borderLeft: isPhone ? 0 : "1px solid rgba(255,255,255,0.08)",
          borderRight: isDesktopOnboarding ? "1px solid rgba(255,255,255,0.08)" : 0,
          boxShadow: isDesktopOnboarding ? "0 0 80px rgba(0,0,0,.45)" : undefined,
          padding: isPhone
            ? "max(12px, var(--inrcy-safe-area-top)) max(12px, var(--inrcy-safe-area-right)) max(24px, var(--inrcy-safe-area-bottom)) max(12px, var(--inrcy-safe-area-left))"
            : 16,
          overflowY: "auto",
          overflowX: "hidden",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          scrollPaddingBottom: 24,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            alignItems: "center",
            gap: 12,
            minWidth: 0,
            width: "100%",
          }}
        >
          <div style={{ minWidth: 0, maxWidth: "100%" }}>
            {progressLabel ? (
              <div
                data-dashboard-onboarding-progress={progressLabel}
                style={{
                  marginBottom: 4,
                  color: "rgba(255,255,255,0.62)",
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  lineHeight: 1.2,
                  textTransform: "uppercase",
                }}
              >
                {progressLabel}
              </div>
            ) : null}
            <h2
              id={titleId}
              style={{
                margin: 0,
                color: "white",
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
            }}
          >
            {presentation === "onboarding" ? (
              <LanguageSelector compact mobile={isPhone} />
            ) : null}
            {headerActions}
            {showCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                style={{
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "transparent",
                  color: "white",
                  borderRadius: 10,
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
              >
                {closeLabel ?? t.drawer.close}
              </button>
            ) : null}
          </div>
        </div>

        <div
          key={contentKey}
          data-settings-drawer-page={contentKey || undefined}
          data-settings-drawer-direction={contentKey ? contentDirection : undefined}
          style={{
            marginTop: 12,
            minWidth: 0,
            maxWidth: "100%",
            overflowX: "hidden",
            paddingBottom: isResponsive ? 8 : 0,
            animation: contentKey
              ? `inrcy-onboarding-page-${contentDirection} 280ms cubic-bezier(.22,.8,.3,1) both`
              : undefined,
            transformOrigin: contentDirection === "forward" ? "left center" : "right center",
          }}
        >
          {children}
        </div>

        <style>{`
          @keyframes inrcy-onboarding-page-forward {
            from {
              opacity: 0;
              transform: perspective(1200px) translateX(26px) rotateY(-1.8deg);
            }
            to {
              opacity: 1;
              transform: perspective(1200px) translateX(0) rotateY(0);
            }
          }

          @keyframes inrcy-onboarding-page-backward {
            from {
              opacity: 0;
              transform: perspective(1200px) translateX(-26px) rotateY(1.8deg);
            }
            to {
              opacity: 1;
              transform: perspective(1200px) translateX(0) rotateY(0);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            [data-settings-drawer-page] {
              animation-duration: 1ms !important;
              transform: none !important;
            }
          }
        `}</style>
      </aside>
    </div>
  );

  return createPortal(drawer, document.body);
}
