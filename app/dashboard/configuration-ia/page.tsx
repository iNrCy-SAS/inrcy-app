"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import DashboardWorkspaceHeader, {
  dashboardWorkspaceContentStyle,
  dashboardWorkspacePageStyle,
} from "../_components/DashboardWorkspaceHeader";
import { useDashboardEdition } from "../_components/DashboardEditionProvider";
import { useDashboardUnsavedNavigation } from "../_components/DashboardUnsavedNavigationProvider";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import AiConfigurationContent from "../settings/_components/AiConfigurationContent";
import AiConfigurationIcon from "../_components/AiConfigurationIcon";

export default function AiConfigurationPage() {
  const router = useRouter();
  const copy = useDashboardI18n();
  const settingsT = useTranslations("settings");
  const settingsDrawerT = useTranslations("dashboard.settingsDrawer");
  const edition = useDashboardEdition();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useUnsavedExitGuard({
    active: true,
    shouldBlock: hasUnsavedChanges,
    onConfirmExit: () => router.push("/dashboard"),
    eyebrow: settingsDrawerT("settings"),
    title: settingsDrawerT("exitWithoutSavingTitle"),
    message: settingsDrawerT("exitWithoutSavingMessage"),
    confirmLabel: settingsDrawerT("closeWithoutSaving"),
    cancelLabel: settingsDrawerT("continueEditing"),
    variant: "warning",
  });

  const navigate = useCallback((href: string) => {
    void requestNavigation(() => router.push(href));
  }, [requestNavigation, router]);

  return (
    <main data-ai-configuration-page style={dashboardWorkspacePageStyle}>
      <DashboardWorkspaceHeader
        logo={(
          <AiConfigurationIcon
            size={42}
            style={{
              borderRadius: 999,
              border: "1px solid rgba(250,204,21,0.42)",
              background: "radial-gradient(circle at 28% 22%, rgba(255,255,255,0.32), transparent 26%), linear-gradient(135deg, rgba(250,204,21,0.28), rgba(251,146,60,0.16), rgba(167,139,250,0.12))",
              boxShadow: "0 0 22px rgba(250,204,21,0.16)",
              fontSize: 15,
            }}
          />
        )}
        title={settingsT("votre_signature_ia_329379e6")}
        subtitle={settingsT("reglez_une_fois_votre_facon_de_4a141f29")}
        actions={[
          { label: copy.userMenu.profile, onClick: () => navigate("/dashboard/mon-profil"), tone: "cyan" },
          { label: copy.userMenu.aiMemory, onClick: () => navigate("/dashboard/adn-entreprise"), tone: "violet" },
          { label: copy.drawer.close, onClick: () => navigate("/dashboard"), tone: "neutral" },
        ]}
      />

      <section style={dashboardWorkspaceContentStyle}>
        <AiConfigurationContent
          edition={edition}
          hideAiMemoryShortcut
          workspaceMode
          onUnsavedChange={setHasUnsavedChanges}
        />
      </section>
    </main>
  );
}
