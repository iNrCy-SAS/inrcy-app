"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import AiMemoryContent, {
  type AiMemoryWorkspaceTab,
} from "../settings/_components/AiMemoryContent";
import DashboardWorkspaceHeader, {
  dashboardWorkspaceContentStyle,
  dashboardWorkspacePageStyle,
} from "../_components/DashboardWorkspaceHeader";
import { useDashboardEdition } from "../_components/DashboardEditionProvider";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { useDashboardUnsavedNavigation } from "../_components/DashboardUnsavedNavigationProvider";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import { useDashboardCompletionChecks } from "../_hooks/useDashboardCompletionChecks";
import AiConfigurationIcon from "../_components/AiConfigurationIcon";

const BUSINESS_DNA_TABS = new Set<AiMemoryWorkspaceTab>([
  "analysis",
  "documents",
  "profile",
  "activity",
  "audience",
  "local",
  "identity",
  "news",
  "strategy",
]);

export default function BusinessDnaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = useDashboardI18n();
  const settingsDrawerT = useTranslations("dashboard.settingsDrawer");
  const edition = useDashboardEdition();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const {
    checkProfile,
    checkActivity,
    markProfileCompleted,
    markActivityCompleted,
  } = useDashboardCompletionChecks();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);

  useUnsavedExitGuard({
    active: true,
    shouldBlock: hasUnsavedChanges || voiceBusy,
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

  const requestedTab = searchParams.get("tab") as AiMemoryWorkspaceTab | null;
  const initialTab = requestedTab && BUSINESS_DNA_TABS.has(requestedTab)
    ? requestedTab
    : "analysis";

  const syncTabInAddressBar = useCallback((tab: AiMemoryWorkspaceTab) => {
    const url = new URL(window.location.href);
    if (tab === "analysis") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return (
    <main
      data-business-dna-page
      data-disable-pull-refresh={voiceBusy ? "true" : undefined}
      style={dashboardWorkspacePageStyle}
    >
      <DashboardWorkspaceHeader
        logoSrc="/icons/business-dna.svg"
        title={copy.aiMemory.title}
        subtitle={copy.aiMemory.openDescription}
        responsiveTwoRow
        actions={[
          {
            label: copy.userMenu.ai,
            onClick: () => navigate("/dashboard/configuration-ia"),
            tone: "violet",
            disabled: voiceBusy,
            mobileBare: true,
            mobileIcon: (
              <AiConfigurationIcon
                size={28}
                style={{
                  borderRadius: 999,
                  border: "1px solid rgba(250,204,21,0.42)",
                  background: "radial-gradient(circle at 28% 22%, rgba(255,255,255,0.32), transparent 26%), linear-gradient(135deg, rgba(250,204,21,0.28), rgba(251,146,60,0.16), rgba(167,139,250,0.12))",
                  boxShadow: "0 0 18px rgba(250,204,21,0.18)",
                  fontSize: 10,
                }}
              />
            ),
          },
          {
            label: copy.drawer.close,
            onClick: () => navigate("/dashboard"),
            tone: "neutral",
            disabled: voiceBusy,
            mobileIcon: "×",
          },
        ]}
      />

      <section style={dashboardWorkspaceContentStyle}>
        <AiMemoryContent
          edition={edition}
          initialTab={initialTab}
          profileLabel={copy.userMenu.profile}
          onTabChange={syncTabInAddressBar}
          onProfileSaved={() => {
            markProfileCompleted();
            void checkProfile();
          }}
          onActivitySaved={() => {
            markActivityCompleted();
            void checkActivity();
          }}
          onUnsavedChange={setHasUnsavedChanges}
          onVoiceBusyChange={setVoiceBusy}
        />
      </section>
    </main>
  );
}
