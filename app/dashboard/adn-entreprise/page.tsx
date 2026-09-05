"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import AiMemoryContent from "../settings/_components/AiMemoryContent";
import DashboardWorkspaceHeader, {
  dashboardWorkspaceContentStyle,
  dashboardWorkspacePageStyle,
} from "../_components/DashboardWorkspaceHeader";
import { useDashboardEdition } from "../_components/DashboardEditionProvider";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { useDashboardUnsavedNavigation } from "../_components/DashboardUnsavedNavigationProvider";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";

export default function BusinessDnaPage() {
  const router = useRouter();
  const copy = useDashboardI18n();
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
    <main data-business-dna-page style={dashboardWorkspacePageStyle}>
      <DashboardWorkspaceHeader
        logoSrc="/icons/business-dna.svg"
        title={copy.aiMemory.title}
        subtitle={copy.aiMemory.openDescription}
        actions={[
          { label: copy.userMenu.profile, onClick: () => navigate("/dashboard/mon-profil"), tone: "cyan" },
          { label: copy.userMenu.ai, onClick: () => navigate("/dashboard/configuration-ia"), tone: "violet" },
          { label: copy.drawer.close, onClick: () => navigate("/dashboard"), tone: "neutral" },
        ]}
      />

      <section style={dashboardWorkspaceContentStyle}>
        <AiMemoryContent
          edition={edition}
          onUnsavedChange={setHasUnsavedChanges}
        />
      </section>
    </main>
  );
}
