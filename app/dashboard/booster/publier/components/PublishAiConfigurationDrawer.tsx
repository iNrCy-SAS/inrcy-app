import { useTranslations } from "next-intl";
import React from "react";
import { createPortal } from "react-dom";

import AiConfigurationIcon from "../../../_components/AiConfigurationIcon";
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

const MOBILE_DOCK_HEIGHT =
  "var(--inrcy-mobile-bottom-nav-total-height, calc(50px + var(--inrcy-safe-area-bottom)))";

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
  const edition = useDashboardEdition();
  const { accountId } = useDashboardCompletionChecks();
  const { aiScore } = useDashboardPreparationScores({ accountId, edition });
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
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

    document.body.style.overflow = "hidden";
    workspace.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousOverflow;
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
        responsiveTwoRow
        logo={(
          <AiConfigurationIcon
            size={42}
            style={{
              borderRadius: 999,
              border: "1px solid rgba(250,204,21,0.42)",
              background:
                "radial-gradient(circle at 28% 22%, rgba(255,255,255,0.32), transparent 26%), linear-gradient(135deg, rgba(250,204,21,0.28), rgba(251,146,60,0.16), rgba(167,139,250,0.12))",
              boxShadow: "0 0 22px rgba(250,204,21,0.16)",
              fontSize: 15,
            }}
          />
        )}
        title={aiSignatureTitle}
        mobileTitle={i18nT("configuration_ia_f620c8d8")}
        subtitle={settingsT("reglez_une_fois_votre_facon_de_4a141f29")}
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
            label: i18nT("retour_dans_booster_publier"),
            onClick: () => void confirmExit(),
            tone: "neutral",
            mobileBare: true,
            mobileIcon: "←",
          },
        ]}
      />

      <section style={dashboardWorkspaceContentStyle}>
        <AiConfigurationContent
          edition={edition}
          hideAiMemoryShortcut
          workspaceMode
          onSaved={() => {
            setHasUnsavedChanges(false);
            onClose();
          }}
          onUnsavedChange={setHasUnsavedChanges}
        />
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={i18nT("configuration_ia_f620c8d8")}
      style={{
        position: "fixed",
        inset: 0,
        bottom: isMobile ? MOBILE_DOCK_HEIGHT : undefined,
        height: isMobile
          ? `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`
          : "100dvh",
        maxHeight: isMobile
          ? `calc(100dvh - ${MOBILE_DOCK_HEIGHT})`
          : "100dvh",
        minHeight: 0,
        zIndex: 10020,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        justifyContent: isMobile ? "stretch" : "flex-end",
        alignItems: "stretch",
        overflow: "hidden",
        padding: isMobile ? 0 : undefined,
        overscrollBehavior: "contain",
      }}
    >
      <aside
        onClick={(event) => event.stopPropagation()}
        style={{
          width: isMobile ? "100vw" : "min(560px, 92vw)",
          maxWidth: "100vw",
          height: isMobile ? "100%" : drawerHeight,
          maxHeight: isMobile ? "100%" : drawerHeight,
          minHeight: 0,
          boxSizing: "border-box",
          background: "rgba(16,16,16,0.98)",
          borderLeft: isMobile ? 0 : "1px solid rgba(255,255,255,0.08)",
          padding: isMobile
            ? "max(12px, var(--inrcy-safe-area-top)) max(12px, var(--inrcy-safe-area-right)) max(12px, var(--inrcy-safe-area-bottom)) max(12px, var(--inrcy-safe-area-left))"
            : 16,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
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
          <h2
            style={{
              margin: 0,
              fontSize: "clamp(16px, 4.3vw, 18px)",
              fontWeight: 800,
              minWidth: 0,
              maxWidth: "100%",
              overflowWrap: "break-word",
              wordBreak: "normal",
              hyphens: "auto",
              lineHeight: 1.25,
              color: "white",
            }}
          >
            {i18nT("configuration_ia_f620c8d8")} {" "}
          </h2>
          <button
            type="button"
            onClick={() => void confirmExit()}
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              background: "transparent",
              color: "white",
              borderRadius: 10,
              padding: "8px 10px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {i18nT("fermer_5ab4ec64")} {" "}
          </button>
        </div>
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            marginTop: 12,
            minWidth: 0,
            maxWidth: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <AiConfigurationContent
            onSaved={() => {
              setHasUnsavedChanges(false);
              onClose();
            }}
            onUnsavedChange={setHasUnsavedChanges}
          />
        </div>
      </aside>
    </div>
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
