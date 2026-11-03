"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { confirmInrcy } from "@/lib/inrcyDialog";
import DashboardWorkspaceHeader, {
  dashboardWorkspaceContentStyle,
  dashboardWorkspacePageStyle,
} from "../_components/DashboardWorkspaceHeader";
import { useDashboardEdition } from "../_components/DashboardEditionProvider";
import { useDashboardUnsavedNavigation } from "../_components/DashboardUnsavedNavigationProvider";
import { useDashboardCompletionChecks } from "../_hooks/useDashboardCompletionChecks";
import { useDashboardPreparationScores } from "../_hooks/useDashboardPreparationScores";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import type { AiMemoryContentHandle, AiMemoryWorkspaceTab } from "../settings/_components/AiMemoryContent";
import type { AiConfigurationContentHandle, AiConfigurationTab } from "../settings/_components/AiConfigurationContent";
import styles from "./personalization.module.css";
import formStyles from "./PersonalizationForms.module.css";
import PersonalizationSectionIcon from "./PersonalizationSectionIcon";

const AiMemoryContent = dynamic(() => import("../settings/_components/AiMemoryContent"));
const AiConfigurationContent = dynamic(() => import("../settings/_components/AiConfigurationContent"));
type Section = "analysis" | "company" | "communication";

export default function PersonalizationPage() {
  const t = useTranslations("dashboard.personalization");
  const memoryT = useTranslations("dashboard.aiMemory");
  const drawerT = useTranslations("dashboard.settingsDrawer");
  const router = useRouter();
  const searchParams = useSearchParams();
  const edition = useDashboardEdition();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const { accountId, checkProfile, checkActivity, markProfileCompleted, markActivityCompleted } = useDashboardCompletionChecks();
  const { dnaScore, aiScore, refreshPreparationScores } = useDashboardPreparationScores({ accountId, edition });
  const requestedSection = searchParams.get("section");
  const initialSection: Section = requestedSection === "communication" ? "communication" : requestedSection === "company" || requestedSection === "identity" ? "company" : "analysis";
  const [section, setSection] = useState<Section>(initialSection);
  const [communicationVisited, setCommunicationVisited] = useState(initialSection === "communication");
  const [companyDirty, setCompanyDirty] = useState(false);
  const [communicationDirty, setCommunicationDirty] = useState(false);
  const [companyVoiceBusy, setCompanyVoiceBusy] = useState(false);
  const [communicationVoiceBusy, setCommunicationVoiceBusy] = useState(false);
  const companyRef = useRef<AiMemoryContentHandle | null>(null);
  const communicationRef = useRef<AiConfigurationContentHandle | null>(null);
  const [vocabularyTarget, setVocabularyTarget] = useState<HTMLDivElement | null>(null);
  const [memoryTab, setMemoryTab] = useState<AiMemoryWorkspaceTab>(requestedSection === "identity" ? "identity" : initialSection === "company" ? "profile" : "analysis");
  const [communicationTab, setCommunicationTab] = useState<AiConfigurationTab | "strategy" | "news">("parameters");
  const voiceBusy = companyVoiceBusy || communicationVoiceBusy;
  const score = Math.round((dnaScore + aiScore) / 2);

  useUnsavedExitGuard({
    active: true,
    shouldBlock: companyDirty || communicationDirty || voiceBusy,
    onConfirmExit: () => router.push("/dashboard"),
    onBlockedExit: async () => {
      if (voiceBusy) return false;
      const communicationSaved = !communicationDirty || await communicationRef.current?.savePendingChanges() === true;
      const companySaved = !companyDirty || await companyRef.current?.savePendingChanges() === true;
      if (communicationSaved && companySaved) return true;
      const discard = await confirmInrcy({
        eyebrow: drawerT("settings"),
        title: drawerT("exitWithoutSavingTitle"),
        message: drawerT("exitWithoutSavingMessage"),
        confirmLabel: drawerT("closeWithoutSaving"),
        cancelLabel: drawerT("continueEditing"),
        variant: "warning",
      });
      if (discard) {
        companyRef.current?.discardPendingChanges();
        communicationRef.current?.discardPendingChanges();
      }
      return discard;
    },
  });

  const selectSection = (next: Section) => {
    if (voiceBusy || next === section) return;
    if (next === "communication") {
      setCommunicationVisited(true);
      if (communicationTab === "strategy" || communicationTab === "news") setMemoryTab(communicationTab);
    }
    else setMemoryTab(next === "company" ? "profile" : "analysis");
    setSection(next);
    const url = new URL(window.location.href);
    if (next === "analysis") url.searchParams.delete("section");
    else url.searchParams.set("section", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    void refreshPreparationScores();
  };

  const sections = [
    { key: "analysis", title: memoryT("tabAnalysis") },
    { key: "company", title: t("companyTitle") },
    { key: "communication", title: t("communicationTitle") },
  ] as const;
  const visibleMemoryTabs: readonly AiMemoryWorkspaceTab[] = section === "analysis" ? ["analysis"]
    : section === "communication" ? ["news", "strategy"] : ["profile", "activity", "audience", "local", "identity"];
  const companyTabs = [
    { key: "profile", icon: "◈", label: t("profileLabel") },
    { key: "activity", icon: "▥", label: memoryT("tabActivity") },
    { key: "audience", icon: "◎", label: memoryT("tabAudience") },
    { key: "local", icon: "⌖", label: memoryT("tabLocal") },
    { key: "identity", icon: "✦", label: memoryT("tabIdentity") },
  ] as const;
  const communicationTabs = [
    { key: "parameters", icon: "⚙", label: t("parametersTab") },
    { key: "instructions", icon: "☷", label: t("instructionsTab") },
    { key: "ctas", icon: "↗", label: t("ctasTab") },
    { key: "strategy", icon: "◇", label: t("strategyTab") },
    { key: "news", icon: "ϟ", label: memoryT("tabNews") },
  ] as const;
  const communicationMemoryVisible = communicationTab === "strategy" || communicationTab === "news";

  return (
    <main data-personalization-page data-analysis-view={section === "analysis" ? "true" : undefined} className={`${styles.page} ${formStyles.workspace}`} style={dashboardWorkspacePageStyle}>
      <DashboardWorkspaceHeader
        logoSrc="/icons/business-dna.svg"
        title={t("mobileTitle")}
        mobileTitle={t("mobileTitle")}
        subtitle=""
        responsiveTwoRow
        navigation={(
          <nav className={styles.sections} aria-label={t("title")}>
            {sections.map((item) => <button key={item.key} type="button" id={`personalization-tab-${item.key}`} aria-pressed={section === item.key} disabled={voiceBusy} onClick={() => selectSection(item.key)} className={styles.sectionButton}><strong>{item.title}</strong></button>)}
          </nav>
        )}
        status={<span data-dashboard-workspace-status className={styles.score} aria-label={`${t("title")} : ${score}%`}>{score}%</span>}
        actions={[{
          label: t("close"),
          onClick: () => { void requestNavigation(() => router.push("/dashboard")); },
          tone: "neutral",
          disabled: voiceBusy,
          mobileIcon: "×",
          mobileBare: true,
        }]}
      />

      <section style={dashboardWorkspaceContentStyle} className={styles.content}>
        {section !== "analysis" ? <nav className={styles.subsections} aria-label={t(section === "company" ? "companyTitle" : "communicationTitle")}>
          {(section === "company" ? companyTabs : communicationTabs).map((tab) => <button key={tab.key} type="button" data-subsection={tab.key} aria-pressed={(section === "company" ? memoryTab : communicationTab) === tab.key} disabled={voiceBusy} onClick={() => {
            if (section === "company") {
              companyRef.current?.selectTab?.(tab.key as AiMemoryWorkspaceTab);
              setMemoryTab(tab.key as AiMemoryWorkspaceTab);
            } else {
              setCommunicationTab(tab.key as typeof communicationTab);
              if (tab.key === "strategy" || tab.key === "news") {
                companyRef.current?.selectTab?.(tab.key);
                setMemoryTab(tab.key);
              }
            }
          }}><span className={styles.subsectionIcon}><PersonalizationSectionIcon name={tab.key} /></span>{tab.label}</button>)}
        </nav> : null}

        <div
          key={`company-${accountId ?? "current"}`}
          id="personalization-panel-company"
          role="region"
          aria-label={section === "analysis" ? memoryT("tabAnalysis") : section === "communication" ? t("strategyTab") : t("companyTitle")}
          hidden={section === "communication" && !communicationMemoryVisible}
          className={styles.panel}
        >
          <AiMemoryContent
            ref={companyRef}
            edition={edition}
            initialTab={memoryTab}
            visibleTabs={visibleMemoryTabs}
            hideNavigation
            vocabularyPortalTarget={section === "communication" && communicationTab === "instructions" ? vocabularyTarget : null}
            profileLabel={t("profileLabel")}
            onTabChange={setMemoryTab}
            onProfileSaved={() => { markProfileCompleted(); void checkProfile(); void refreshPreparationScores(); }}
            onActivitySaved={() => { markActivityCompleted(); void checkActivity(); void refreshPreparationScores(); }}
            onUnsavedChange={setCompanyDirty}
            onVoiceBusyChange={setCompanyVoiceBusy}
            onAnalysisCompleted={() => { void refreshPreparationScores(); }}
          />
        </div>
        {communicationVisited ? (
          <div
            key={`communication-${accountId ?? "current"}`}
            id="personalization-panel-communication"
            role="region"
            aria-labelledby="personalization-tab-communication"
            hidden={section !== "communication" || communicationMemoryVisible}
            className={styles.panel}
          >
            <AiConfigurationContent
              persistenceRef={communicationRef}
              edition={edition}
              workspaceMode
              hideNavigation
              initialTab={communicationMemoryVisible ? "parameters" : communicationTab as AiConfigurationTab}
              hideAiMemoryShortcut
              onVocabularyTargetChange={setVocabularyTarget}
              onSaved={refreshPreparationScores}
              onAutoSaved={refreshPreparationScores}
              onUnsavedChange={setCommunicationDirty}
              onVoiceBusyChange={setCommunicationVoiceBusy}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}
