"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useTranslations } from "next-intl";


import { useEffect, useId, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "../dashboard.module.css";
import BaseModal from "./WorkflowBaseModal";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { requestDashboardToolWarmup } from "./DashboardToolWarmup";
import { useDelayedPendingAction } from "@/hooks/useDelayedPendingAction";
import { hasAccountingDashboardAccess } from "@/lib/dashboardEdition";
import { useDashboardEdition } from "./DashboardEditionProvider";
import { DASHBOARD_GEARBOX_ANCHOR_ID } from "../dashboard.scroll";
import signatureStyles from "./DashboardSignatureTools.module.css";
import DashboardAgentLogoButton from "./DashboardAgentLogoButton";
import { DashboardPremiumLockIcon } from "./DashboardPremiumLockIcon";

const DashboardAgentPlanningModal = dynamic(
  () => import("../agent/_components/DashboardAgentPlanningModal"),
  { ssr: false },
);

type DashboardPanelName =
  | "contact"
  | "profil"
  | "inrbadge"
  | "compte"
  | "activite"
  | "abonnement"
  | "mails"
  | "agenda"
  | "site_inrcy"
  | "site_web"
  | "instagram"
  | "linkedin"
  | "gmb"
  | "inr_search"
  | "facebook"
  | "legal"
  | "rgpd"
  | "inertie"
  | "boutique"
  | "notifications"
  | "parrainage"
  | "documents";

type DashboardModulesCardProps = {
  goToModule: (path: string) => void;
  openPanel: (panel: DashboardPanelName) => void;
  onOpenStats?: () => void;
  onOpenBoosterPublish?: () => void;
  onOpenBoosterStats?: () => void;
  adsPilotEnabled?: boolean;
  inrAgentEnabled?: boolean;
  standardMode?: boolean;
};

function PlanningIcon() {
  return (
    <svg
      className={signatureStyles.planningIcon}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect x="3.5" y="5.5" width="17" height="15" rx="3" />
      <path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17" />
      <path d="m8 15 2.2 2.2L16 12.7" />
    </svg>
  );
}

function ArrowIcon() {
  return <span aria-hidden="true">→</span>;
}

function BoosterIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M37 9c8.8-2.8 16.9-2 18-1-1 11-3.4 19.1-12 27.7l-6.9 6.9-13.7-13.7 6.9-6.9C31.9 15.7 34.4 11.9 37 9Z" />
      <path d="m24.2 27.7-9.8 1.4-7.1 7.1 13.5 1.3M36.3 39.8l-1.4 9.8-7.1 7.1-1.3-13.5" />
      <circle cx="42.5" cy="21.5" r="5.2" />
      <path d="M18 44c-5.8 1.1-8.8 4.1-10 10 5.9-1.2 8.9-4.2 10-10Z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a7.9 7.9 0 0 0 .1-1 7.9 7.9 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7.7 7.7 0 0 0-1.7-1l-.4-2.6H10l-.4 2.6a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.9 7.9 0 0 0-.1 1 7.9 7.9 0 0 0 .1 1l-2 1.5 2 3.5 2.4-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.5-2-1.5Z" />
    </svg>
  );
}

type ToolGlyphKind = "mail" | "stats" | "ads" | "megaphone" | "sparkles" | "image" | "planning" | "dna" | "document" | "people" | "trophy";

function ToolGlyph({ kind }: { kind: ToolGlyphKind }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {kind === "mail" ? <><rect x="7" y="12" width="34" height="25" rx="5" /><path d="m8 15 16 12 16-12M8 35l10-10m22 10L30 25" /></> : null}
      {kind === "stats" ? <><rect x="7" y="28" width="7" height="13" rx="2" fill="currentColor" stroke="none" /><rect x="21" y="19" width="7" height="22" rx="2" fill="currentColor" stroke="none" /><rect x="35" y="7" width="7" height="34" rx="2" fill="currentColor" stroke="none" /></> : null}
      {kind === "ads" ? <><circle cx="21" cy="27" r="15" /><circle cx="21" cy="27" r="8" /><path d="m21 27 18-18m-1-5v7h7M9 8V4m-2 2h4" /></> : null}
      {kind === "megaphone" ? <><path d="M28 9 15 17H8v15h7l13 8V9Z" fill="currentColor" fillOpacity=".3" /><path d="m15 32 4 11h-7L8 32m25-15 6-3m-6 18 6 3m-5-11h8M28 16c7 1 7 15 0 16" /></> : null}
      {kind === "sparkles" ? <><path d="m24 6 4.7 13.3L42 24l-13.3 4.7L24 42l-4.7-13.3L6 24l13.3-4.7L24 6Z" fill="currentColor" /><path d="m39 5 1.3 3.7L44 10l-3.7 1.3L39 15l-1.3-3.7L34 10l3.7-1.3L39 5ZM8 34l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" fill="currentColor" stroke="none" /></> : null}
      {kind === "image" ? <><rect x="6" y="8" width="36" height="32" rx="5" fill="currentColor" fillOpacity=".12" /><circle cx="16" cy="18" r="3" /><path d="m8 36 11-12 7 7 7-9 8 14" fill="currentColor" fillOpacity=".3" /></> : null}
      {kind === "planning" ? <><rect x="6" y="9" width="36" height="33" rx="5" /><path d="M15 5v9M33 5v9M6 20h36M15 28h5m7 0h5m-17 7h5m7 0h5" /></> : null}
      {kind === "dna" ? <><path d="M14 5c0 16 20 21 20 38M34 5c0 16-20 21-20 38M16 10h16M19 16h10M18 33h12M15 39h18" /><path d="m20 23 8 5m0-5-8 5" opacity=".5" /></> : null}
      {kind === "document" ? <><rect x="9" y="5" width="29" height="38" rx="4" fill="currentColor" fillOpacity=".1" /><path d="M16 14h15M16 21h15M16 28h15M16 35h9" /></> : null}
      {kind === "people" ? <><circle cx="19" cy="16" r="7" fill="currentColor" fillOpacity=".35" /><path d="M5 40v-5a14 14 0 0 1 28 0v5H5Z" fill="currentColor" fillOpacity=".35" /><path d="M32 10a7 7 0 0 1 0 14m7 16h5v-5a13 13 0 0 0-8-12" /></> : null}
      {kind === "trophy" ? <><path d="M15 7h18v11c0 9-5 12-9 12s-9-3-9-12V7Z" fill="currentColor" fillOpacity=".3" /><path d="M15 11H7v6c0 7 6 8 10 8M33 11h8v6c0 7-6 8-10 8M24 30v9m-8 3h16m-3-3H19" /></> : null}
    </svg>
  );
}

function BoosterWave() {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={signatureStyles.boosterWave} viewBox="0 0 720 240" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-wave`} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#08d6ff" /><stop offset=".48" stopColor="#546cff" /><stop offset="1" stopColor="#f289ff" /></linearGradient>
        <radialGradient id={`${id}-star`}><stop stopColor="#fff" /><stop offset=".2" stopColor="#b8caff" /><stop offset="1" stopColor="#8956ff" stopOpacity="0" /></radialGradient>
      </defs>
      {Array.from({ length: 16 }, (_, index) => (
        <path key={index} d={`M160 ${220 + index * 2}C290 ${55 + index * 7} 300 ${285 - index * 3} 450 ${145 - index * 4}S600 ${20 + index * 6} 745 ${12 + index * 5}`} fill="none" stroke={`url(#${id}-wave)`} strokeWidth={index === 7 ? 2.5 : .7} opacity={index === 7 ? .92 : .08 + index * .014} />
      ))}
      <circle cx="618" cy="39" r="20" fill={`url(#${id}-star)`} /><circle cx="440" cy="144" r="13" fill={`url(#${id}-star)`} /><circle cx="275" cy="187" r="10" fill={`url(#${id}-star)`} /><circle cx="573" cy="101" r="3" fill="#d5dbff" /><circle cx="496" cy="54" r="2" fill="#ab8fff" /><circle cx="352" cy="174" r="2" fill="#7beaff" />
    </svg>
  );
}

export default function DashboardModulesCard({ goToModule, openPanel, onOpenStats, onOpenBoosterPublish, onOpenBoosterStats, adsPilotEnabled = false, inrAgentEnabled = true, standardMode: standardModeOverride = false }: DashboardModulesCardProps) {
  const i18nT = useTranslations("shell");
  const standardT = useTranslations("dashboard.standard");
  const signatureT = useTranslations("dashboard.signatureTools");
  const t = useDashboardI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dashboardEdition = useDashboardEdition();
  const standardMode = standardModeOverride || dashboardEdition === "standard";
  const accountingEnabled = !standardMode && hasAccountingDashboardAccess(dashboardEdition);
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [agentPlanningOpen, setAgentPlanningOpen] = useState(false);
  const {
    pendingKey,
    beginAction,
    completeAction,
    isVisible,
  } = useDelayedPendingAction<string>();

  useEffect(() => {
    if (!pendingKey) return;

    if (pendingKey.startsWith("route:")) {
      const href = pendingKey.slice("route:".length);
      const target = new URL(href, "https://inrcy.local");
      const queryMatches = Array.from(target.searchParams.entries()).every(
        ([key, value]) => searchParams.get(key) === value,
      );
      if (pathname === target.pathname && queryMatches) {
        completeAction(pendingKey);
        return;
      }
      return;
    }

    if (pendingKey.startsWith("panel:")) {
      const panel = pendingKey.slice("panel:".length);
      if (searchParams.get("panel") === panel) completeAction(pendingKey);
      return;
    }

    if (pendingKey === "modal:cash" && cashModalOpen) {
      completeAction(pendingKey);
      return;
    }

    if (pendingKey === "modal:campaigns" && campaignModalOpen) {
      completeAction(pendingKey);
      return;
    }

    if (pendingKey === "modal:publish") {
      if (searchParams.get("action") === "publish" || (standardMode && searchParams.get("panel"))) {
        completeAction(pendingKey);
      }
    }
  }, [campaignModalOpen, cashModalOpen, completeAction, pathname, pendingKey, searchParams, standardMode]);

  useEffect(() => {
    if (accountingEnabled && searchParams.get("action") === "cash") {
      setCashModalOpen(true);
      return;
    }
    if (!accountingEnabled) setCashModalOpen(false);
  }, [accountingEnabled, searchParams]);

  const closeCashModal = () => {
    setCashModalOpen(false);
    if (searchParams.get("action") === "cash") {
      router.replace("/dashboard", { scroll: false });
    }
  };

  const closeCampaignModal = () => setCampaignModalOpen(false);

  const startModuleNavigation = (path: string, action?: () => void) => {
    const key = `route:${path}`;
    if (!beginAction(key)) return;
    requestDashboardToolWarmup(path);
    action?.();
    if (!action) goToModule(path);
  };

  const startPanelOpening = (panel: DashboardPanelName) => {
    const key = `panel:${panel}`;
    if (!beginAction(key)) return;
    openPanel(panel);
  };

  const openCampaignModal = () => {
    if (standardMode) {
      startPanelOpening("abonnement");
      return;
    }
    if (!beginAction("modal:campaigns")) return;
    setCampaignModalOpen(true);
  };

  const openPublishModal = () => {
    if (!beginAction("modal:publish")) return;
    if (onOpenBoosterPublish) onOpenBoosterPublish();
    else goToModule("/dashboard?action=publish");
  };

  const openBoosterSummary = () => {
    if (onOpenBoosterStats) onOpenBoosterStats();
    else goToModule("/dashboard?stats=1");
  };

  const openStats = () => {
    startModuleNavigation("/dashboard/stats", onOpenStats);
  };

  const openAgentPlanning = () => {
    setAgentPlanningOpen(true);
  };

  const routeKey = (path: string) => `route:${path}`;
  const isModuleLoadingVisible = (path: string) => isVisible(routeKey(path));
  const isPanelLoadingVisible = (panel: DashboardPanelName) => isVisible(`panel:${panel}`);
  const agentPath = "/dashboard/agent";
  const studioPath = "/dashboard/generer-media";
  const sendLabel = i18nT("inr_send_fd44a9fa").replace(/\s*→\s*$/u, "");
  const statsLabel = i18nT("inr_stats_881d9239").replace(/\s*→\s*$/u, "");
  const calendarLabel = i18nT("inr_calendar_a9473176").replace(/\s*→\s*$/u, "");
  const crmLabel = i18nT("inr_crm_aa43648a").replace(/\s*→\s*$/u, "");
  const copy = {
    createTitle: signatureT("createTitle"), pilotTitle: signatureT("pilotTitle"), mailCampaigns: signatureT("mailCampaigns"), businessSpace: signatureT("businessSpace"),
    amplify: signatureT("amplify"), imagine: signatureT("imagine"), automate: signatureT("automate"), adsDescription: signatureT("adsDescription"),
    createCampaign: signatureT("createCampaign"), comingSoon: signatureT("comingSoon"), openStudio: signatureT("openStudio"), access: signatureT("access"), manage: signatureT("manage"), open: signatureT("open"), viewStats: signatureT("viewStats"), dnaDescription: signatureT("dnaDescription"),
  };
  const signatureTools: { path: string; title: string; description: string; logo: string; tone: string; glyph: ToolGlyphKind; action: string; panel?: DashboardPanelName; settingsLabel?: string; premiumOnly?: boolean }[] = [
    { path: standardMode ? "/dashboard/mails?folder=publications&boxView=sent" : "/dashboard/mails", title: sendLabel, description: standardMode ? standardT("sendDescription") : t.modules.mailsSub, logo: "/inrsend-logo-seul.png", tone: "sendCard", glyph: "mail", action: standardMode ? standardT("sendCta") : copy.manage, panel: "mails", settingsLabel: t.modules.mailsSettingsAria },
    { path: "/dashboard/stats", title: statsLabel, description: t.modules.statsSub, logo: "/inrstats-logo-seul.png", tone: "statsCard", glyph: "stats", action: copy.viewStats },
    { path: "/dashboard/agenda", title: calendarLabel, description: t.modules.agendaSub, logo: "/mobile-shortcuts/inrcalendar-bubble.png", tone: "calendarCard", glyph: "planning", action: copy.open, panel: "agenda", settingsLabel: t.modules.agendaSettingsAria, premiumOnly: true },
    { path: "/dashboard/crm", title: crmLabel, description: t.modules.crmSub, logo: "/mobile-shortcuts/inrcrm-bubble.png", tone: "crmCard", glyph: "people", action: copy.access, premiumOnly: true },
  ];
  return (
    <>
        <div className={signatureStyles.lowerRow} data-dashboard-standard-lower-blocks={standardMode ? "true" : undefined} data-dashboard-premium-lower-blocks={!standardMode ? "true" : undefined}>
          <section className={signatureStyles.panel} aria-labelledby="dashboard-create-title" id={DASHBOARD_GEARBOX_ANCHOR_ID}>
            <header className={signatureStyles.panelHeader}>
              <h3 id="dashboard-create-title"><span className={signatureStyles.headingIcon} aria-hidden="true">ϟ</span>{copy.createTitle}</h3>
            </header>

            <article className={signatureStyles.boosterCard}>
              <BoosterWave />
              <span className={signatureStyles.boosterAura} aria-hidden="true" />
              <span className={signatureStyles.boosterRocket} aria-hidden="true"><BoosterIcon /></span>
              <div className={signatureStyles.boosterCopy}>
                <span className={signatureStyles.eyebrow}>{standardT("boosterEyebrow")}</span>
                <h4>{t.modules.publishTitle}</h4>
                <p>{standardT("boosterLine1")}<br /><strong>{standardT("boosterLine2")}</strong></p>
                <button
                  type="button"
                  className={signatureStyles.primaryButton}
                  data-testid={standardMode ? "standard-booster-publish" : "premium-booster-publish"}
                  onClick={openPublishModal}
                  disabled={isVisible("modal:publish")}
                  aria-busy={isVisible("modal:publish") || undefined}
                  aria-label={t.modules.publishCta}
                >{isVisible("modal:publish") ? i18nT("chargement_01cba1df") : t.modules.publishCta}<ArrowIcon /></button>
              </div>
              <div className={signatureStyles.boosterChart} aria-hidden="true"><span /><span /><span /><i /></div>
              <button
                type="button"
                className={signatureStyles.boosterStats}
                aria-label={t.modules.boosterStatsTitle}
                title={t.modules.boosterStatsTitle}
                onClick={openBoosterSummary}
              ><ToolGlyph kind="stats" /><span>{standardT("boosterSummary")}</span></button>
            </article>

            <div className={signatureStyles.creationGrid} data-dashboard-standard-secondary-tools={standardMode ? "true" : undefined} data-dashboard-premium-secondary-tools={!standardMode ? "true" : undefined}>
              <article className={`${signatureStyles.creationCard} ${signatureStyles.adsCard}`}>
                <span className={signatureStyles.cardLogo} aria-hidden="true"><ToolGlyph kind="ads" /></span>
                <div className={signatureStyles.creationCopy}>
                  <span className={signatureStyles.eyebrow}>{copy.amplify}</span>
                  <h4>iNr’ADS</h4>
                  <p>{copy.adsDescription}</p>
                </div>
                <span className={signatureStyles.ghostArt} aria-hidden="true"><ToolGlyph kind="megaphone" /></span>
                <button
                  type="button"
                  className={signatureStyles.cardButton}
                  data-testid={adsPilotEnabled ? (standardMode ? "standard-campaign-ads" : "premium-campaign-ads") : "campaign-ads-coming-soon"}
                  data-dashboard-prefetch={adsPilotEnabled ? "/dashboard/ads" : undefined}
                  onClick={adsPilotEnabled ? () => startModuleNavigation("/dashboard/ads") : undefined}
                  disabled={!adsPilotEnabled || isModuleLoadingVisible("/dashboard/ads")}
                  aria-busy={isModuleLoadingVisible("/dashboard/ads") || undefined}
                  aria-label={!adsPilotEnabled ? `iNr’ADS — ${copy.comingSoon}` : standardMode ? `iNr’ADS — ${t.modules.campaignsPremiumLabel}` : "iNr’ADS"}
                >{!adsPilotEnabled ? copy.comingSoon : isModuleLoadingVisible("/dashboard/ads") ? i18nT("chargement_01cba1df") : standardMode ? <><DashboardPremiumLockIcon />{t.modules.campaignsPremiumLabel}</> : copy.createCampaign}{adsPilotEnabled && !standardMode ? <ArrowIcon /> : null}</button>
              </article>

              <article className={`${signatureStyles.creationCard} ${signatureStyles.studioCard}`}>
                <span className={signatureStyles.cardLogo} aria-hidden="true"><ToolGlyph kind="sparkles" /></span>
                <div className={signatureStyles.creationCopy}>
                  <span className={signatureStyles.eyebrow}>{copy.imagine}</span>
                  <h4>iNr’Studio</h4>
                  <p>{standardT("studioLine1")} {standardT("studioLine2")}</p>
                </div>
                <span className={signatureStyles.ghostArt} aria-hidden="true"><ToolGlyph kind="image" /></span>
                <button
                  type="button"
                  className={signatureStyles.cardButton}
                  data-testid={standardMode ? "standard-studio-open" : "premium-studio-open"}
                  data-dashboard-prefetch={studioPath}
                  onClick={() => startModuleNavigation(studioPath)}
                  disabled={isModuleLoadingVisible(studioPath)}
                  aria-busy={isModuleLoadingVisible(studioPath) || undefined}
                >{isModuleLoadingVisible(studioPath) ? i18nT("chargement_01cba1df") : copy.openStudio}<ArrowIcon /></button>
              </article>

              <article className={`${signatureStyles.creationCard} ${signatureStyles.agentCard}`}>
                <DashboardAgentLogoButton
                  className={signatureStyles.cardLogo}
                  enabled={inrAgentEnabled}
                  busy={isModuleLoadingVisible(agentPath)}
                  onClick={() => startModuleNavigation(agentPath)}
                />
                <div className={signatureStyles.creationCopy}>
                  <span className={signatureStyles.eyebrow}>{copy.automate}</span>
                  <h4>{t.modules.agentTitle}</h4>
                  <p>{t.modules.agentSub}</p>
                </div>
                <button
                  type="button"
                  className={signatureStyles.planningButton}
                  data-testid={standardMode ? "standard-agent-planning-icon" : "premium-agent-planning"}
                  onClick={openAgentPlanning}
                  aria-label={standardT("agentPlanning")}
                  title={standardT("agentPlanning")}
                ><PlanningIcon /></button>
                <span className={signatureStyles.ghostArt} aria-hidden="true"><ToolGlyph kind="planning" /></span>
                <button
                  type="button"
                  className={signatureStyles.cardButton}
                  data-testid={standardMode ? "standard-agent-pilotage" : "premium-agent-pilotage"}
                  data-dashboard-prefetch={agentPath}
                  onClick={() => startModuleNavigation(agentPath)}
                  disabled={isModuleLoadingVisible(agentPath)}
                  aria-busy={isModuleLoadingVisible(agentPath) || undefined}
                >{isModuleLoadingVisible(agentPath) ? i18nT("chargement_01cba1df") : t.modules.agentCta}<ArrowIcon /></button>
              </article>
            </div>
          </section>

          <section className={`${signatureStyles.panel} ${signatureStyles.pilotPanel}`} aria-labelledby="dashboard-pilot-title">
            <header className={signatureStyles.panelHeader}>
              <h3 id="dashboard-pilot-title"><span className={signatureStyles.headingIcon} aria-hidden="true"><ToolGlyph kind="stats" /></span>{copy.pilotTitle}</h3>
              <span className={signatureStyles.panelCaption}>{copy.businessSpace}</span>
            </header>

            <article className={signatureStyles.dnaCard}>
              <span className={signatureStyles.cardLogo} aria-hidden="true"><ToolGlyph kind="dna" /></span>
              <div className={signatureStyles.dnaCopy}><h4>iNr’ADN</h4><p>{copy.dnaDescription}</p></div>
              <span className={signatureStyles.dnaArt} aria-hidden="true"><ToolGlyph kind="document" /></span>
              <button
                type="button"
                className={signatureStyles.cardButton}
                data-dashboard-prefetch="/dashboard/adn-entreprise"
                onClick={() => startModuleNavigation("/dashboard/adn-entreprise")}
                disabled={isModuleLoadingVisible("/dashboard/adn-entreprise")}
                aria-busy={isModuleLoadingVisible("/dashboard/adn-entreprise") || undefined}
              >{isModuleLoadingVisible("/dashboard/adn-entreprise") ? i18nT("chargement_01cba1df") : copy.access}<ArrowIcon /></button>
            </article>

            <div className={signatureStyles.signatureGrid}>
              {signatureTools.map((tool) => (
                <article className={`${signatureStyles.signatureCard} ${signatureStyles[tool.tone]}`} key={tool.path}>
                  <span className={signatureStyles.signatureLogo} aria-hidden="true"><Image src={tool.logo} alt="" width={52} height={52} /></span>
                  <div className={signatureStyles.signatureCopy}><h4>{tool.title}</h4><p>{tool.description}</p></div>
                  <span className={signatureStyles.signatureArt} aria-hidden="true"><ToolGlyph kind={tool.glyph} /></span>
                  {tool.panel && (!standardMode || tool.premiumOnly) ? (
                    <button
                      type="button"
                      className={signatureStyles.settingsButton}
                      aria-label={standardMode ? `${tool.settingsLabel} — ${t.modules.campaignsPremiumLabel}` : tool.settingsLabel}
                      title={t.notifications.settings}
                      onClick={() => startPanelOpening(standardMode ? "abonnement" : tool.panel!)}
                      disabled={isPanelLoadingVisible(standardMode ? "abonnement" : tool.panel)}
                      aria-busy={isPanelLoadingVisible(standardMode ? "abonnement" : tool.panel) || undefined}
                    >{standardMode ? <DashboardPremiumLockIcon /> : <SettingsIcon />}</button>
                  ) : null}
                  <button
                    type="button"
                    className={signatureStyles.toolButton}
                    data-dashboard-prefetch={standardMode && tool.premiumOnly ? undefined : tool.path}
                    onClick={standardMode && tool.premiumOnly ? () => startPanelOpening("abonnement") : tool.path === "/dashboard/stats" ? openStats : () => startModuleNavigation(tool.path)}
                    disabled={standardMode && tool.premiumOnly ? isPanelLoadingVisible("abonnement") : isModuleLoadingVisible(tool.path)}
                    aria-busy={(standardMode && tool.premiumOnly ? isPanelLoadingVisible("abonnement") : isModuleLoadingVisible(tool.path)) || undefined}
                    aria-label={standardMode && tool.premiumOnly ? `${tool.title} — ${t.modules.campaignsPremiumLabel}` : tool.title}
                  >{standardMode && tool.premiumOnly ? <><DashboardPremiumLockIcon />{t.modules.campaignsPremiumLabel}</> : <>{isModuleLoadingVisible(tool.path) ? i18nT("chargement_01cba1df") : tool.action}<ArrowIcon /></>}</button>
                </article>
              ))}
            </div>

            <div className={signatureStyles.relationshipGrid} data-dashboard-relationship-tools="true">
              <article className={`${signatureStyles.relationshipCard} ${signatureStyles.reputationCard}`}>
                <span className={signatureStyles.relationshipLogo} aria-hidden="true"><ToolGlyph kind="trophy" /></span>
                <div className={signatureStyles.relationshipCopy}><h4>{standardT("reputationName")}</h4><p>{t.modules.reputationSub}</p></div>
                <span className={signatureStyles.reputationStars} aria-hidden="true">✦<b>★</b>★<b>★</b>✦</span>
                <button
                  type="button"
                  className={signatureStyles.cardButton}
                  data-dashboard-prefetch="/dashboard/e-reputation"
                  onClick={() => startModuleNavigation("/dashboard/e-reputation")}
                  disabled={isModuleLoadingVisible("/dashboard/e-reputation")}
                  aria-busy={isModuleLoadingVisible("/dashboard/e-reputation") || undefined}
                >{isModuleLoadingVisible("/dashboard/e-reputation") ? i18nT("chargement_01cba1df") : t.modules.reputationCta}<ArrowIcon /></button>
              </article>

              <article className={`${signatureStyles.relationshipCard} ${signatureStyles.mailCampaignCard}`}>
                <span className={signatureStyles.relationshipLogo} aria-hidden="true"><ToolGlyph kind="mail" /></span>
                <div className={signatureStyles.relationshipCopy}><h4>{copy.mailCampaigns}</h4><p>{t.modules.campaignsSub}</p></div>
                <span className={signatureStyles.mailCampaignArt} aria-hidden="true"><ToolGlyph kind="mail" /></span>
                <button
                  type="button"
                  className={signatureStyles.cardButton}
                  data-testid={standardMode ? "standard-campaign-mails" : "premium-campaign-open"}
                  onClick={openCampaignModal}
                  disabled={standardMode ? isPanelLoadingVisible("abonnement") : isVisible("modal:campaigns")}
                  aria-busy={(standardMode ? isPanelLoadingVisible("abonnement") : isVisible("modal:campaigns")) || undefined}
                  aria-label={standardMode ? `${t.modules.mailCampaignTitle} — ${t.modules.campaignsPremiumLabel}` : t.modules.mailCampaignTitle}
                >{standardMode ? <><DashboardPremiumLockIcon />{t.modules.campaignsPremiumLabel}</> : <>{isVisible("modal:campaigns") ? i18nT("chargement_01cba1df") : t.modules.campaignsCta}<ArrowIcon /></>}</button>
              </article>
            </div>
          </section>
        </div>

        {!standardMode && campaignModalOpen ? (
          <BaseModal
            title={t.modules.campaignsModalTitle}
            moduleLabel={t.modules.campaignsModalLabel}
            compact
            maxWidth={760}
            onClose={closeCampaignModal}
          >
            <div className={styles.cashModalIntro}>
              <strong>{t.modules.campaignsModalIntroStrong}</strong>{" "}
              {t.modules.campaignsModalIntroText}
            </div>

            <div className={styles.cashChoiceGrid}>
              <button
                type="button"
                className={`${styles.cashChoiceCard} ${styles.cashChoiceInvoice}`}
                onClick={() => {
                  setCampaignModalOpen(false);
                  startModuleNavigation("/dashboard/propulser");
                }}
              >
                <span className={styles.cashChoiceEyebrow}>{t.modules.propulserTitle}</span>
                <span className={styles.cashChoiceTitle}>{t.modules.propulserSub}</span>
                <span className={styles.cashChoiceText}>{t.modules.propulserCta}</span>
                <span className={styles.cashChoiceCta}>{t.modules.propulserCta} →</span>
              </button>

              <button
                type="button"
                className={`${styles.cashChoiceCard} ${styles.cashChoiceQuote}`}
                onClick={() => {
                  setCampaignModalOpen(false);
                  startModuleNavigation("/dashboard/fideliser");
                }}
              >
                <span className={styles.cashChoiceEyebrow}>{t.modules.fideliserTitle}</span>
                <span className={styles.cashChoiceTitle}>{t.modules.fideliserSub}</span>
                <span className={styles.cashChoiceText}>{t.modules.fideliserCta}</span>
                <span className={styles.cashChoiceCta}>{t.modules.fideliserCta} →</span>
              </button>
            </div>
          </BaseModal>
        ) : null}

        {accountingEnabled && cashModalOpen ? (
          <BaseModal
            title={t.modules.cashModalTitle}
            moduleLabel={t.modules.cashModalLabel}
            compact
            maxWidth={760}
            onClose={closeCashModal}
            headerActions={
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => startPanelOpening("documents")}
                title={t.modules.cashSettingsTitle}
                disabled={isPanelLoadingVisible("documents")}
                aria-busy={isPanelLoadingVisible("documents") || undefined}
              >
                {isPanelLoadingVisible("documents") ? i18nT("chargement_01cba1df") : t.modules.cashModalSettings}
              </button>
            }
          >
            <div className={styles.cashModalIntro}>
              <strong>{t.modules.cashModalIntroStrong}</strong> {t.modules.cashModalIntroText}
            </div>

            <div className={styles.cashChoiceGrid}>
              <button
                type="button"
                className={`${styles.cashChoiceCard} ${styles.cashChoiceInvoice}`}
                onClick={() => {
                  setCashModalOpen(false);
                  startModuleNavigation("/dashboard/factures/new");
                }}
              >
                <span className={styles.cashChoiceEyebrow}>{t.modules.invoiceEyebrow}</span>
                <span className={styles.cashChoiceTitle}>{t.modules.invoiceTitle}</span>
                <span className={styles.cashChoiceText}>{t.modules.invoiceText}</span>
                <span className={styles.cashChoiceCta}>{t.modules.invoiceCta}</span>
              </button>

              <button
                type="button"
                className={`${styles.cashChoiceCard} ${styles.cashChoiceQuote}`}
                onClick={() => {
                  setCashModalOpen(false);
                  startModuleNavigation("/dashboard/devis/new");
                }}
              >
                <span className={styles.cashChoiceEyebrow}>{t.modules.quoteEyebrow}</span>
                <span className={styles.cashChoiceTitle}>{t.modules.quoteTitle}</span>
                <span className={styles.cashChoiceText}>{t.modules.quoteText}</span>
                <span className={styles.cashChoiceCta}>{t.modules.quoteCta}</span>
              </button>
            </div>
          </BaseModal>
        ) : null}

        {agentPlanningOpen ? (
          <DashboardAgentPlanningModal
            open
            standardMode={standardMode}
            onClose={() => setAgentPlanningOpen(false)}
            onManage={() => startModuleNavigation("/dashboard/agent")}
          />
        ) : null}
    </>

  );
}
