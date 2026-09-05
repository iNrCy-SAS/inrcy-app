"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import DashboardWorkspaceHeader, {
  dashboardWorkspaceContentStyle,
  dashboardWorkspacePageStyle,
} from "../_components/DashboardWorkspaceHeader";
import { useDashboardUnsavedNavigation } from "../_components/DashboardUnsavedNavigationProvider";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { useDashboardCompletionChecks } from "../_hooks/useDashboardCompletionChecks";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import ProfileAndActivityContent from "../settings/_components/ProfileAndActivityContent";

export default function ProfileWorkspacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = useDashboardI18n();
  const profileT = useTranslations("dashboard.profilePanel");
  const settingsDrawerT = useTranslations("dashboard.settingsDrawer");
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const {
    checkProfile,
    checkActivity,
    markProfileCompleted,
    markActivityCompleted,
  } = useDashboardCompletionChecks();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const initialSection = searchParams.get("section") === "activity" ? "activity" : "identity";

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
    <main data-profile-workspace-page style={dashboardWorkspacePageStyle}>
      <DashboardWorkspaceHeader
        logoSrc="/icons/profile-workspace.svg"
        title={copy.userMenu.profile}
        subtitle={profileT("pageDescription")}
        actions={[
          { label: copy.userMenu.aiMemory, onClick: () => navigate("/dashboard/adn-entreprise"), tone: "violet" },
          { label: copy.userMenu.ai, onClick: () => navigate("/dashboard/configuration-ia"), tone: "cyan" },
          { label: copy.drawer.close, onClick: () => navigate("/dashboard"), tone: "neutral" },
        ]}
      />

      <section style={dashboardWorkspaceContentStyle}>
        <ProfileAndActivityContent
          initialSection={initialSection}
          onUnsavedChange={setHasUnsavedChanges}
          onProfileSaved={() => {
            markProfileCompleted();
            void checkProfile();
          }}
          onActivitySaved={() => {
            markActivityCompleted();
            void checkActivity();
          }}
          onOpenAiMemory={() => navigate("/dashboard/adn-entreprise")}
        />
      </section>
    </main>
  );
}
