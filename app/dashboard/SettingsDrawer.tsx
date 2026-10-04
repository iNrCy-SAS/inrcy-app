"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DrawerHeaderActionsContext, DrawerHeaderDetailsContext, DrawerHeaderTabsContext } from "./DrawerHeaderTabs";
import headerTabsStyles from "./DrawerHeaderTabs.module.css";
import { useDashboardI18n } from "./_hooks/useDashboardI18n";

type Props = {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  /** Disposition du bandeau. Toutes les présentations occupent le plein écran. */
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
  /** Prépare le portail masqué afin qu'un changement de panneau reste visuellement continu. */
  keepMounted?: boolean;
  children: React.ReactNode;
};

const RESPONSIVE_BREAKPOINT = 1100;
const PHONE_BREAKPOINT = 640;

function isVisibleElement(element: HTMLElement) {
  return element.getClientRects().length > 0
    && !element.closest('[inert], [aria-hidden="true"]')
    && getComputedStyle(element).visibility !== "hidden";
}

function dialogStackOrder(element: HTMLElement) {
  const order: number[] = [];
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.zIndex !== "auto" || style.position === "fixed" || style.isolation === "isolate" || style.transform !== "none") {
      order.unshift(Number.parseInt(style.zIndex, 10) || 0);
    }
  }
  return order;
}

function isTopmostDialog(dialog: HTMLElement) {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter(isVisibleElement);
  const top = dialogs.sort((left, right) => {
    const leftOrder = dialogStackOrder(left);
    const rightOrder = dialogStackOrder(right);
    for (let index = 0; index < Math.max(leftOrder.length, rightOrder.length); index += 1) {
      const difference = (leftOrder[index] || 0) - (rightOrder[index] || 0);
      if (difference) return difference;
    }
    return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }).at(-1);
  return top === dialog;
}

function getFocusRoots(dialog: HTMLElement) {
  const portals = Array.from(dialog.querySelectorAll<HTMLElement>("[aria-controls]"))
    .flatMap((control) => (control.getAttribute("aria-controls") || "").split(/\s+/))
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLElement => Boolean(element && isVisibleElement(element)));
  return [dialog, ...portals];
}

function getFocusableElements(roots: HTMLElement[]) {
  const selector = 'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"]';
  return Array.from(new Set(roots.flatMap((root) => [root, ...root.querySelectorAll<HTMLElement>(selector)])))
    .filter((element) => !element.matches(":disabled")
      && (element.tabIndex >= 0 || element.isContentEditable)
      && isVisibleElement(element));
}

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
  keepMounted = false,
  children,
}: Props) {
  const t = useDashboardI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [headerTabsHost, setHeaderTabsHost] = useState<HTMLDivElement | null>(null);
  const [headerActionsHost, setHeaderActionsHost] = useState<HTMLDivElement | null>(null);
  const [headerDetailsHost, setHeaderDetailsHost] = useState<HTMLDivElement | null>(null);
  const closeOptionsRef = useRef({ onClose, closeOnEscape });
  // Valeurs stables côté serveur/client au premier rendu : évite les erreurs React #418
  // quand le drawer est ouvert directement depuis une URL sur mobile.
  const [portalReady, setPortalReady] = useState(false);
  const [hasBeenOpened, setHasBeenOpened] = useState(keepMounted || isOpen);
  const [viewportWidth, setViewportWidth] = useState<number>(1440);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState(0);
  const isResponsive = viewportWidth <= RESPONSIVE_BREAKPOINT;
  const isPhone = viewportWidth <= PHONE_BREAKPOINT;
  const isCentered = presentation === "centered";

  useEffect(() => {
    closeOptionsRef.current = { onClose, closeOnEscape };
  }, [onClose, closeOnEscape]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (isOpen || keepMounted) setHasBeenOpened(true);
  }, [isOpen, keepMounted]);

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

  const drawerHeight = viewportHeight ? `${viewportHeight}px` : "100dvh";

  useEffect(() => {
    if (!isOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    const previousRootOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      document.documentElement.style.overscrollBehavior = previousRootOverscroll;
    };
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !portalReady || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusDialog = () => dialog.focus({ preventScroll: true });
    if (isTopmostDialog(dialog) && !dialog.contains(document.activeElement)) focusDialog();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopmostDialog(dialog)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.key === "Escape") {
        // An open select/popover handles Escape before the enclosing settings window.
        if (target?.closest('[role="listbox"], [role="menu"], [aria-expanded="true"]')) return;
        if (closeOptionsRef.current.closeOnEscape) {
          event.preventDefault();
          event.stopPropagation();
          closeOptionsRef.current.onClose();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const roots = getFocusRoots(dialog);
      const focusable = getFocusableElements(roots);
      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        focusDialog();
      } else if (!roots.some((root) => root.contains(active)) || active === dialog
        || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isTopmostDialog(dialog)) return;
      const target = event.target instanceof Node ? event.target : null;
      if (target && !getFocusRoots(dialog).some((root) => root.contains(target))) focusDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      const active = document.activeElement;
      // Avoid stealing focus from a different window opened during this close.
      if (previousFocus?.isConnected && (active === document.body || !active?.isConnected
        || getFocusRoots(dialog).some((root) => root.contains(active)))) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [hasBeenOpened, isOpen, portalReady]);

  if (!hasBeenOpened || !portalReady) return null;

  const drawer = (
    <div
      aria-hidden={!isOpen}
      onClick={closeOnBackdrop ? onClose : undefined}
      style={{
        position: "fixed",
        top: viewportOffsetTop,
        left: 0,
        right: 0,
        bottom: "auto",
        width: "100%",
        height: drawerHeight,
        maxHeight: drawerHeight,
        background: "var(--inrcy-theme-drawer-backdrop, rgba(0,0,0,0.55))",
        zIndex: 2147483001,
        display: isOpen ? "flex" : "none",
        alignItems: "stretch",
        justifyContent: "stretch",
        overflow: "hidden",
        isolation: "isolate",
        pointerEvents: "auto",
        padding: 0,
        boxSizing: "border-box",
      }}
    >
      <aside
        ref={dialogRef}
        data-dashboard-settings-drawer="true"
        data-dashboard-settings-modal="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "100%",
          height: "100%",
          maxHeight: "100%",
          minHeight: 0,
          boxSizing: "border-box",
          background: "radial-gradient(ellipse at 0% 0%, rgba(0,190,255,0.25), transparent 60%), radial-gradient(ellipse at 100% 10%, rgba(161,72,255,0.27), transparent 60%), radial-gradient(ellipse at 75% 100%, rgba(239,68,170,0.17), transparent 65%), color-mix(in srgb, var(--inrcy-theme-drawer-background, #081226) 82%, #175bbc)",
          color: "var(--inrcy-theme-text-primary, rgba(255,255,255,0.92))",
          border: 0,
          borderLeft: 0,
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
          className={headerTabsStyles.header}
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
                : "18px clamp(16px, 2.4vw, 44px)",
            borderBottom: "1px solid rgba(124,169,255,0.25)",
            background: "linear-gradient(110deg, rgba(14,165,233,0.22), rgba(93,79,240,0.14) 45%, rgba(218,67,187,0.20)), var(--inrcy-theme-drawer-background, #081226)",
            boxShadow: "0 8px 30px rgba(3,8,30,0.18)",
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
            className={headerTabsStyles.headerTitle}
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
                  fontSize: "clamp(18px, 2vw, 26px)",
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
            <div ref={setHeaderDetailsHost} className={headerTabsStyles.headerDetails} data-dashboard-settings-header-details />
          </div>

          <div ref={setHeaderTabsHost} className={headerTabsStyles.headerTabs} data-dashboard-settings-header-tabs />

          {/* Zone actions (ex: ?) + Fermer avec gap */}
          <div
            className={headerTabsStyles.headerActions}
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
            <div ref={setHeaderActionsHost} className={headerTabsStyles.portaledActions} data-dashboard-settings-header-actions />
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label={t.drawer.close}
              title={t.drawer.close}
              style={{
                border: "1px solid var(--inrcy-theme-border-strong, rgba(255,255,255,0.12))",
                background: "var(--inrcy-theme-surface-soft, rgba(255,255,255,0.07))",
                color: "var(--inrcy-theme-text-primary, white)",
                display: "inline-grid",
                placeItems: "center",
                width: isResponsive ? 40 : undefined,
                minWidth: isResponsive ? 40 : undefined,
                height: isResponsive ? 40 : undefined,
                minHeight: isResponsive ? 40 : isCentered ? 38 : undefined,
                borderRadius: isResponsive ? 12 : 999,
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
              : isCentered ? "12px 16px 16px" : "clamp(16px, 2.4vw, 36px) clamp(16px, 2.4vw, 44px)",
            scrollPaddingBottom: isResponsive ? 24 : 16,
          }}
        >
          <DrawerHeaderTabsContext.Provider value={headerTabsHost}>
            <DrawerHeaderActionsContext.Provider value={headerActionsHost}>
              <DrawerHeaderDetailsContext.Provider value={headerDetailsHost}>
                {children}
              </DrawerHeaderDetailsContext.Provider>
            </DrawerHeaderActionsContext.Provider>
          </DrawerHeaderTabsContext.Provider>
        </div>
      </aside>
    </div>
  );

  return createPortal(drawer, document.body);
}
