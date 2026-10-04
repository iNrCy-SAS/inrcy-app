import { useTranslations } from "next-intl";
import React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DrawerHeaderTabsContext } from "../../../DrawerHeaderTabs";
import headerTabsStyles from "../../../DrawerHeaderTabs.module.css";

import AiConfigurationIcon, { AI_CONFIGURATION_BUBBLE_STYLE } from "../../../_components/AiConfigurationIcon";
import BusinessDnaIcon from "../../../_components/BusinessDnaIcon";
import { useDashboardUnsavedNavigation } from "../../../_components/DashboardUnsavedNavigationProvider";
import DashboardWorkspaceHeader, {
  dashboardWorkspaceContentStyle,
  dashboardWorkspacePageStyle,
} from "../../../_components/DashboardWorkspaceHeader";
import { useDashboardCompletionChecks } from "../../../_hooks/useDashboardCompletionChecks";
import { useDashboardEdition } from "../../../_components/DashboardEditionProvider";
import { useDashboardPreparationScores } from "../../../_hooks/useDashboardPreparationScores";
import AiConfigurationContent from "../../../settings/_components/AiConfigurationContent";
import { useUnsavedExitGuard } from "../../../_hooks/useUnsavedExitGuard";
import styles from "../../../dashboard.module.css";

type PublishAiConfigurationDrawerProps = {
  open: boolean;
  isMobile: boolean;
  drawerHeight: string;
  onClose: () => void;
  presentation?: "drawer" | "workspace";
};

type AiConfigurationSurfaceProps = Omit<
  PublishAiConfigurationDrawerProps,
  "open" | "presentation"
>;

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  const selector =
    'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  const controlledPortals = Array.from(
    container.querySelectorAll<HTMLElement>("[aria-controls]"),
  ).flatMap((control) => {
    const controlledId = control.getAttribute("aria-controls");
    const controlled = controlledId ? document.getElementById(controlledId) : null;
    return controlled ? Array.from(controlled.querySelectorAll<HTMLElement>(selector)) : [];
  });
  return Array.from(new Set([
    ...Array.from(container.querySelectorAll<HTMLElement>(selector)),
    ...controlledPortals,
  ])).filter(
    (element) =>
      !element.hasAttribute("aria-hidden") &&
      !element.closest("[inert]") &&
      element.getClientRects().length > 0,
  );
}

function PublishAiConfigurationWorkspace({
  drawerHeight,
  onClose,
}: AiConfigurationSurfaceProps) {
  const i18nT = useTranslations("booster");
  const settingsT = useTranslations("settings");
  const memoryT = useTranslations("dashboard.aiMemory");
  const router = useRouter();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const openBusinessDna = () => void requestNavigation(() => {
    onClose();
    router.push("/dashboard/adn-entreprise");
  });
  const edition = useDashboardEdition();
  const { accountId } = useDashboardCompletionChecks();
  const { aiScore } = useDashboardPreparationScores({ accountId, edition });
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [headerTabsHost, setHeaderTabsHost] = React.useState<HTMLDivElement | null>(null);
  const [voiceBusy, setVoiceBusy] = React.useState(false);
  const [viewportOffsetTop, setViewportOffsetTop] = React.useState(0);
  const workspaceRef = React.useRef<HTMLElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const aiSignatureTitle = settingsT("votre_signature_ia_329379e6");

  const { confirmExit } = useUnsavedExitGuard({
    active: true,
    shouldBlock: hasUnsavedChanges,
    onConfirmExit: onClose,
    eyebrow: i18nT("configuration_ia_f620c8d8"),
    title: i18nT("quitter_sans_enregistrer_6208bd94"),
    message: i18nT("cette_configuration_contient_des_modifications_n_b64cbc4f"),
    confirmLabel: i18nT("fermer_sans_enregistrer_15fdc373"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    variant: "warning",
  });

  React.useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    const previousPageOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    workspace.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousPageOverflow;
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, []);

  React.useEffect(() => {
    const updateViewport = () => {
      setViewportOffsetTop(
        Math.max(0, Math.round(window.visualViewport?.offsetTop || 0)),
      );
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

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const workspace = workspaceRef.current;
      if (!workspace) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const globalDialog = document
        .getElementById("inrcy-dialog-title")
        ?.closest<HTMLElement>('[role="dialog"]');
      if (globalDialog?.contains(target)) {
        if (event.key === "Escape") event.stopPropagation();
        return;
      }

      if (event.key === "Escape") {
        event.stopPropagation();
        if (target?.closest('[role="listbox"], [aria-expanded="true"]')) return;
        event.preventDefault();
        void confirmExit();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(workspace);
      if (!focusable.length) {
        event.preventDefault();
        workspace.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (
        !workspace.contains(activeElement) &&
        (!activeElement || !focusable.includes(activeElement))
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmExit]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <main
      ref={workspaceRef}
      role="dialog"
      aria-modal="true"
      aria-label={aiSignatureTitle}
      tabIndex={-1}
      data-ai-configuration-workspace-overlay
      style={{
        ...dashboardWorkspacePageStyle,
        padding: "14px clamp(10px, 2.2vw, 28px) max(20px, var(--inrcy-safe-area-bottom))",
        position: "fixed",
        top: viewportOffsetTop,
        right: 0,
        bottom: "auto",
        left: 0,
        zIndex: 9990,
        width: "100vw",
        height: drawerHeight,
        minHeight: 0,
        maxHeight: drawerHeight,
        boxSizing: "border-box",
        overflowY: "auto",
        overscrollBehavior: "contain",
        isolation: "isolate",
      }}
    >
      <DashboardWorkspaceHeader
        navigation={<div ref={setHeaderTabsHost} />}
        responsiveTwoRow
        logo={(
          <AiConfigurationIcon
            size={42}
            style={{
              ...AI_CONFIGURATION_BUBBLE_STYLE,
            }}
          />
        )}
        title={aiSignatureTitle}
        mobileTitle={i18nT("configuration_ia_f620c8d8")}
        subtitle=""
        status={(
          <span
            data-dashboard-workspace-status
            className={styles.cockpitGlobalPower}
            aria-label={`${i18nT("configuration_ia_f620c8d8")} : ${aiScore}%`}
            title={`${i18nT("configuration_ia_f620c8d8")} : ${aiScore}%`}
            style={{
              "--cockpit-global-power-mid": `${aiScore * 1.8}deg`,
              "--cockpit-global-power": `${aiScore * 3.6}deg`,
            } as React.CSSProperties}
          >
            {aiScore}%
          </span>
        )}
        actions={[
          {
            label: memoryT("title"),
            onClick: openBusinessDna,
            disabled: voiceBusy,
            tone: "violet",
            mobileBare: true,
            mobileIcon: <BusinessDnaIcon size={28} />,
          },
          {
            label: i18nT("retour_dans_booster_publier"),
            onClick: () => void confirmExit(),
            tone: "neutral",
            mobileBare: true,
            mobileIcon: "←",
          },
        ]}
      />

      <section style={dashboardWorkspaceContentStyle}>
        <DrawerHeaderTabsContext.Provider value={headerTabsHost}>
        <AiConfigurationContent
          edition={edition}
          onVoiceBusyChange={setVoiceBusy}
          hideAiMemoryShortcut
          workspaceMode
          onSaved={() => {
            setHasUnsavedChanges(false);
            onClose();
          }}
          onUnsavedChange={setHasUnsavedChanges}
        />
        </DrawerHeaderTabsContext.Provider>
      </section>
    </main>,
    document.body,
  );
}

function PublishAiConfigurationSideDrawer({
  isMobile,
  drawerHeight,
  onClose,
}: AiConfigurationSurfaceProps) {
  const i18nT = useTranslations("booster");
  const settingsT = useTranslations("settings");
  const memoryT = useTranslations("dashboard.aiMemory");
  const router = useRouter();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const openBusinessDna = () => void requestNavigation(() => {
    onClose();
    router.push("/dashboard/adn-entreprise");
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [headerTabsHost, setHeaderTabsHost] = React.useState<HTMLDivElement | null>(null);
  const [voiceBusy, setVoiceBusy] = React.useState(false);
  const dialogRef = React.useRef<HTMLElement | null>(null);
  const [viewportHeight, setViewportHeight] = React.useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = React.useState(0);
  const { confirmExit } = useUnsavedExitGuard({
    active: true,
    shouldBlock: hasUnsavedChanges,
    onConfirmExit: onClose,
    eyebrow: i18nT("configuration_ia_f620c8d8"),
    title: i18nT("quitter_sans_enregistrer_6208bd94"),
    message: i18nT("cette_configuration_contient_des_modifications_n_b64cbc4f"),
    confirmLabel: i18nT("fermer_sans_enregistrer_15fdc373"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    variant: "warning",
  });

  React.useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousPageOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousPageOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  React.useEffect(() => {
    const updateViewport = () => {
      setViewportHeight(Math.round(window.visualViewport?.height || window.innerHeight));
      setViewportOffsetTop(Math.max(0, Math.round(window.visualViewport?.offsetTop || 0)));
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

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const globalDialog = document.getElementById("inrcy-dialog-title")
        ?.closest<HTMLElement>('[role="dialog"]');
      if (globalDialog?.contains(target)) {
        if (event.key === "Escape") event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        if (target?.closest('[role="listbox"], [aria-expanded="true"]')) return;
        event.preventDefault();
        void confirmExit();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(dialog);
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
      } else if (!active || !focusable.includes(active)) {
        event.preventDefault();
        (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
      } else if (event.shiftKey && active === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && active === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmExit]);

  if (typeof document === "undefined") return null;
  const visibleHeight = viewportHeight ? `${viewportHeight}px` : drawerHeight;

  return createPortal(
    <div
      data-ai-configuration-fullscreen-overlay
      style={{
        position: "fixed",
        top: viewportOffsetTop,
        left: 0,
        right: 0,
        bottom: "auto",
        width: "100%",
        height: visibleHeight,
        maxHeight: visibleHeight,
        minHeight: 0,
        zIndex: 2147483001,
        background: "radial-gradient(ellipse at 0% 0%, rgba(0,190,255,0.20), transparent 54%), radial-gradient(ellipse at 100% 12%, rgba(161,72,255,0.20), transparent 54%), radial-gradient(ellipse at 76% 100%, rgba(239,68,170,0.11), transparent 48%), var(--inrcy-theme-drawer-background, #081226)",
        display: "flex",
        alignItems: "stretch",
        overflow: "hidden",
        padding: 0,
        isolation: "isolate",
        overscrollBehavior: "contain",
      }}
    >
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT("configuration_ia_f620c8d8")}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "100%",
          height: "100%",
          maxHeight: "100%",
          minHeight: 0,
          minWidth: 0,
          boxSizing: "border-box",
          color: "var(--inrcy-theme-text-primary, white)",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div
          data-ai-configuration-fullscreen-header
          className={headerTabsStyles.header}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            alignItems: "center",
            gap: isMobile ? 12 : 24,
            minWidth: 0,
            width: "100%",
            flex: "0 0 auto",
            boxSizing: "border-box",
            padding: isMobile
              ? "max(12px, var(--inrcy-safe-area-top)) max(12px, var(--inrcy-safe-area-right)) 12px max(12px, var(--inrcy-safe-area-left))"
              : "20px clamp(24px, 3vw, 48px)",
            background: "linear-gradient(110deg, rgba(14,165,233,0.13), rgba(99,102,241,0.05) 48%, rgba(168,85,247,0.13))",
            borderBottom: "1px solid rgba(134,186,255,0.22)",
            boxShadow: "0 12px 36px rgba(4,10,24,0.16), inset 0 1px 0 rgba(255,255,255,0.10)",
          }}
        >
          <div className={headerTabsStyles.headerTitle} style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 16, minWidth: 0 }}>
            <AiConfigurationIcon
              size={isMobile ? 42 : 52}
              style={{
                ...AI_CONFIGURATION_BUBBLE_STYLE,
                fontSize: isMobile ? 17 : 20,
              }}
            />
            <div style={{ display: "grid", gap: 5, minWidth: 0 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: isMobile ? "clamp(17px, 4.3vw, 21px)" : "clamp(22px, 1.9vw, 28px)",
                  fontWeight: 850,
                  minWidth: 0,
                  maxWidth: "100%",
                  overflowWrap: "break-word",
                  wordBreak: "normal",
                  hyphens: "auto",
                  lineHeight: 1.15,
                  letterSpacing: "-0.025em",
                  color: "var(--inrcy-theme-text-primary, white)",
                  textShadow: "0 2px 20px rgba(125,211,252,0.14)",
                }}
              >
                {isMobile ? i18nT("configuration_ia_f620c8d8") : settingsT("votre_signature_ia_329379e6")}
              </h2>
            </div>
          </div>
          <div ref={setHeaderTabsHost} className={headerTabsStyles.headerTabs} />
          <div className={headerTabsStyles.headerActions} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={openBusinessDna}
            disabled={voiceBusy}
            aria-label={memoryT("title")}
            title={memoryT("title")}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 42, padding: isMobile ? 8 : "8px 12px", borderRadius: 13, border: "1px solid rgba(192,160,255,0.42)", background: "rgba(139,92,246,0.18)", color: "var(--inrcy-theme-text-primary, white)", fontWeight: 750, cursor: "pointer" }}
          >
            <BusinessDnaIcon size={26} />
            {!isMobile ? memoryT("title") : null}
          </button>
          <button
            type="button"
            onClick={() => void confirmExit()}
            style={{
              border: "1px solid rgba(148,183,255,0.34)",
              background: "linear-gradient(135deg, rgba(56,189,248,0.13), rgba(139,92,246,0.22))",
              color: "var(--inrcy-theme-text-primary, white)",
              boxShadow: "0 4px 18px rgba(53,74,143,0.18), inset 0 1px 0 rgba(255,255,255,0.14)",
              borderRadius: 13,
              minHeight: 42,
              padding: isMobile ? "8px 12px" : "10px 18px",
              fontWeight: 750,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {i18nT("fermer_5ab4ec64")} {" "}
          </button>
          </div>
        </div>
        <div
          data-ai-configuration-fullscreen-scroll
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            minWidth: 0,
            width: "100%",
            maxWidth: "100%",
            boxSizing: "border-box",
            padding: isMobile
              ? "12px max(12px, var(--inrcy-safe-area-right)) max(16px, var(--inrcy-safe-area-bottom)) max(12px, var(--inrcy-safe-area-left))"
              : "clamp(20px, 2.6vw, 36px) clamp(24px, 3vw, 48px) 32px",
            overflowY: "auto",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <DrawerHeaderTabsContext.Provider value={headerTabsHost}>
          <AiConfigurationContent
            hideAiMemoryShortcut
            onVoiceBusyChange={setVoiceBusy}
            workspaceMode
            onSaved={() => {
              setHasUnsavedChanges(false);
              onClose();
            }}
            onUnsavedChange={setHasUnsavedChanges}
          />
          </DrawerHeaderTabsContext.Provider>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export default function PublishAiConfigurationDrawer({
  open,
  isMobile,
  drawerHeight,
  onClose,
  presentation = "drawer",
}: PublishAiConfigurationDrawerProps) {
  if (!open) return null;

  const surfaceProps = { isMobile, drawerHeight, onClose };
  return presentation === "workspace" ? (
    <PublishAiConfigurationWorkspace {...surfaceProps} />
  ) : (
    <PublishAiConfigurationSideDrawer {...surfaceProps} />
  );
}
