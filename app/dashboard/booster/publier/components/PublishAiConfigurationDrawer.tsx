import { useTranslations } from "next-intl";
import React from "react";
import AiConfigurationContent from "../../../settings/_components/AiConfigurationContent";
import { useUnsavedExitGuard } from "../../../_hooks/useUnsavedExitGuard";

type PublishAiConfigurationDrawerProps = {
  open: boolean;
  isMobile: boolean;
  drawerHeight: string;
  onClose: () => void;
};

const MOBILE_DOCK_HEIGHT =
  "var(--inrcy-mobile-bottom-nav-total-height, calc(50px + var(--inrcy-safe-area-bottom)))";

export default function PublishAiConfigurationDrawer({
  open,
  isMobile,
  drawerHeight,
  onClose,
}: PublishAiConfigurationDrawerProps) {
  const i18nT = useTranslations("booster");
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const { confirmExit } = useUnsavedExitGuard({
    active: open,
    shouldBlock: hasUnsavedChanges,
    onConfirmExit: onClose,
    eyebrow: i18nT("configuration_ia_f620c8d8"),
    title: i18nT("quitter_sans_enregistrer_6208bd94"),
    message: i18nT("cette_configuration_contient_des_modifications_n_b64cbc4f"),
    confirmLabel: i18nT("fermer_sans_enregistrer_15fdc373"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    variant: "warning",
  });

  if (!open) return null;

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
            {i18nT("configuration_ia_f620c8d8")}{" "}</h2>
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
            {i18nT("fermer_5ab4ec64")}{" "}</button>
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
            mode="drawer"
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
