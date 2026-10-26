"use client";

import type { DashboardPanelName } from "../_hooks/useDashboardPanelRouting";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { useEffect, useId, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "../dashboard.module.css";
import BaseModal from "./WorkflowBaseModal";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { requestDashboardToolWarmup } from "./DashboardToolWarmup";
import { useDelayedPendingAction } from "@/hooks/useDelayedPendingAction";
import { hasAccountingDashboardAccess, isStandardDashboardEdition } from "@/lib/dashboardEdition";
import { useDashboardEdition, useDashboardSubscriptionEdition } from "./DashboardEditionProvider";
import { DASHBOARD_GEARBOX_ANCHOR_ID } from "../dashboard.scroll";
import signatureStyles from "./DashboardSignatureTools.module.css";
import DashboardAgentLogoButton from "./DashboardAgentLogoButton";
import { DashboardPremiumLockIcon } from "./DashboardPremiumLockIcon";
import AdsChannelInfoModal from "./AdsChannelInfoModal";
import StudioIcon from "./StudioIcon";
import DashboardToolArtwork from "./DashboardToolArtwork";
import { INR_AGENT_WORKSPACES, type InrAgentWorkspace } from "@/lib/inrAgentWorkspaces";

const DashboardAgentPlanningModal = dynamic(
  () => import("../agent/_components/DashboardAgentPlanningModal"),
  { ssr: false },
);

export type DashboardOverviewMetrics = {
  estimatedValue: number | null;
  oppTotal: number | null;
  leadsWeek: number | null;
  leadsMonth: number | null;
};

type DashboardModulesCardProps = {
  cockpit?: ReactNode;
  generator?: ReactNode;
  overview?: DashboardOverviewMetrics;
  goToModule: (path: string) => void;
  openPanel: (panel: DashboardPanelName) => void;
  onOpenStats?: () => void;
  onOpenGeneratorSettings?: () => void;
  onOpenBoosterPublish?: () => void;
  onOpenBoosterStats?: () => void;
  adsPilotEnabled?: boolean;
  inrAgentEnabled?: boolean;
  standardMode?: boolean;
};

function ArrowIcon() {
  return <span aria-hidden="true">→</span>;
}

function PremiumCrown() {
  const gradientId = `premium-crown-${useId().replace(/:/g, "")}`;
  return <svg viewBox="0 0 32 32" fill="none"><defs><linearGradient id={gradientId} x1="5" y1="7" x2="28" y2="27"><stop stopColor="#fff3b0" /><stop offset=".5" stopColor="#ffc45b" /><stop offset="1" stopColor="#f36bc9" /></linearGradient></defs><path d="m4 10 6 5 6-10 6 10 6-5-3 14H7L4 10Z" fill={`url(#${gradientId})`} stroke="#ffe7a8" strokeWidth="1.4" strokeLinejoin="round" /><path d="M9 28h14" stroke="#ffd575" strokeWidth="2.5" strokeLinecap="round" /><path d="m27 2 .7 2.3L30 5l-2.3.7L27 8l-.7-2.3L24 5l2.3-.7L27 2Z" fill="#fff0c4" /><circle cx="16" cy="19" r="2" fill="#8951c3" /></svg>;
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a7.9 7.9 0 0 0 .1-1 7.9 7.9 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7.7 7.7 0 0 0-1.7-1l-.4-2.6H10l-.4 2.6a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.9 7.9 0 0 0-.1 1 7.9 7.9 0 0 0 .1 1l-2 1.5 2 3.5 2.4-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.5-2-1.5Z" />
    </svg>
  );
}

type ToolGlyphKind = "mail" | "stats" | "ads" | "megaphone" | "sparkles" | "image" | "planning" | "people" | "trophy";

function ToolGlyph({ kind }: { kind: ToolGlyphKind }) {
  if (kind === "sparkles") return <StudioIcon />;
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {kind === "mail" ? <><rect x="7" y="12" width="34" height="25" rx="5" /><path d="m8 15 16 12 16-12M8 35l10-10m22 10L30 25" /></> : null}
      {kind === "stats" ? <><rect x="7" y="28" width="7" height="13" rx="2" fill="currentColor" stroke="none" /><rect x="21" y="19" width="7" height="22" rx="2" fill="currentColor" stroke="none" /><rect x="35" y="7" width="7" height="34" rx="2" fill="currentColor" stroke="none" /></> : null}
      {kind === "ads" ? <><circle cx="21" cy="27" r="15" /><circle cx="21" cy="27" r="8" /><path d="m21 27 18-18m-1-5v7h7M9 8V4m-2 2h4" /></> : null}
      {kind === "megaphone" ? <><path d="M28 9 15 17H8v15h7l13 8V9Z" fill="currentColor" fillOpacity=".3" /><path d="m15 32 4 11h-7L8 32m25-15 6-3m-6 18 6 3m-5-11h8M28 16c7 1 7 15 0 16" /></> : null}
      {kind === "image" ? <><rect x="6" y="8" width="36" height="32" rx="5" fill="currentColor" fillOpacity=".12" /><circle cx="16" cy="18" r="3" /><path d="m8 36 11-12 7 7 7-9 8 14" fill="currentColor" fillOpacity=".3" /></> : null}
      {kind === "planning" ? <><rect x="6" y="9" width="36" height="33" rx="5" /><path d="M15 5v9M33 5v9M6 20h36M15 28h5m7 0h5m-17 7h5m7 0h5" /></> : null}
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

function PremiumCardAccent({ tone }: { tone: string }) {
  return <svg className={signatureStyles.premiumCardAccent} viewBox="0 0 96 64" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tone === "adsCard" ? <><circle cx="45" cy="35" r="18" /><circle cx="45" cy="35" r="9" /><path d="m45 35 25-23m-6 0h7v7" /></> : null}
    {tone === "campaignCard" ? <><rect x="26" y="18" width="45" height="31" rx="6" transform="rotate(-9 48 34)" /><path d="m27 23 22 13 20-19" /></> : null}
    {tone === "calendarCard" ? <><circle cx="49" cy="34" r="19" /><path d="M49 23v12l9 5" /></> : null}
    {tone === "crmCard" ? <><circle cx="34" cy="39" r="11" /><circle cx="65" cy="24" r="8" /><path d="m44 34 14-7m-29 18a6 6 0 0 1 10 0m-5-10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /></> : null}
  </svg>;
}

export default function DashboardModulesCard({ cockpit, generator, overview, goToModule, openPanel, onOpenStats, onOpenGeneratorSettings, onOpenBoosterPublish, onOpenBoosterStats, adsPilotEnabled = false, inrAgentEnabled = true, standardMode: standardModeOverride = false }: DashboardModulesCardProps) {
  const i18nT = useTranslations("shell");
  const standardT = useTranslations("dashboard.standard");
  const signatureT = useTranslations("dashboard.signatureTools");
  const helpT = useTranslations("dashboard.helpCenter");
  const heroT = useTranslations("dashboard.hero");
  const t = useDashboardI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dashboardEdition = useDashboardEdition();
  const studioEdition = useDashboardSubscriptionEdition();
  const standardMode = standardModeOverride || isStandardDashboardEdition(dashboardEdition);
  const accountingEnabled = !standardMode && hasAccountingDashboardAccess(dashboardEdition);
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [adsInfoOpen, setAdsInfoOpen] = useState(false);
  const [planningWorkspace, setPlanningWorkspace] = useState<InrAgentWorkspace | null>(null);
  const agentT = useTranslations("agent.workspaces");
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

  const campaignRequested = searchParams.get("action") === "campaigns";
  useEffect(() => {
    setCampaignModalOpen(!standardMode && campaignRequested);
  }, [campaignRequested, standardMode]);

  const closeCampaignModal = () => {
    setCampaignModalOpen(false);
    if (campaignRequested) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("action");
      const query = nextParams.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    }
  };

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

  const routeKey = (path: string) => `route:${path}`;
  const isModuleLoadingVisible = (path: string) => isVisible(routeKey(path));
  const isPanelLoadingVisible = (panel: DashboardPanelName) => isVisible(`panel:${panel}`);
  const studioPath = "/dashboard/generer-media";
  const sendLabel = i18nT("inr_send_fd44a9fa").replace(/\s*→\s*$/u, "");
  const statsLabel = i18nT("inr_stats_881d9239").replace(/\s*→\s*$/u, "");
  const calendarLabel = i18nT("inr_calendar_a9473176").replace(/\s*→\s*$/u, "");
  const crmLabel = i18nT("inr_crm_aa43648a").replace(/\s*→\s*$/u, "");
  const copy = {
    createTitle: signatureT("createTitle"), pilotTitle: signatureT("pilotTitle"), premiumTitle: signatureT("premiumTitle"), mailCampaigns: signatureT("mailCampaigns"), businessSpace: signatureT("businessSpace"),
    amplify: signatureT("amplify"), imagine: signatureT("imagine"), automate: signatureT("automate"), adsDescription: signatureT("adsDescription"),
    createCampaign: signatureT("createCampaign"), comingSoon: signatureT("comingSoon"), openStudio: signatureT("openStudio"), access: signatureT("access"), manage: signatureT("manage"), open: signatureT("open"), viewStats: signatureT("viewStats"),
  };
  const signatureTools: { path: string; title: string; description: string; logo?: string; tone: string; glyph: ToolGlyphKind; action: string; testId?: string; panel?: DashboardPanelName; settingsLabel?: string; premiumOnly?: boolean; onOpen?: () => void; loading?: boolean; unavailable?: boolean }[] = [
    { path: standardMode ? "/dashboard/mails?folder=publications&boxView=sent" : "/dashboard/mails", title: sendLabel, description: standardT("sendDescription"), logo: "/inrsend-logo-seul.png", tone: "sendCard", glyph: "mail", action: standardMode ? standardT("sendCta") : copy.manage, panel: "mails", settingsLabel: t.modules.mailsSettingsAria },
    { path: studioPath, title: "iNr’Studio", description: `${standardT("studioLine1")} ${standardT("studioLine2")}`, tone: "studioCard", glyph: "sparkles", action: copy.open, testId: standardMode ? "standard-studio-open" : "premium-studio-open" },
    { path: "/dashboard/stats", title: statsLabel, description: t.modules.statsSub, logo: "/inrstats-logo-seul.png", tone: "statsCard", glyph: "stats", action: copy.viewStats },
    { path: "/dashboard/e-reputation", title: standardT("reputationName"), description: t.modules.reputationSub, tone: "reputationCard", glyph: "trophy", action: t.modules.reputationCta },
    { path: "/dashboard/agenda", title: calendarLabel, description: t.modules.agendaSub, logo: "/mobile-shortcuts/inrcalendar-bubble.png", tone: "calendarCard", glyph: "planning", action: copy.open, panel: "agenda", settingsLabel: t.modules.agendaSettingsAria, premiumOnly: true },
    { path: "/dashboard/crm", title: crmLabel, description: t.modules.crmSub, logo: "/mobile-shortcuts/inrcrm-bubble.png", tone: "crmCard", glyph: "people", action: copy.access, premiumOnly: true },
    { path: "/dashboard/ads", title: "iNr’ADS", description: copy.adsDescription, tone: "adsCard", glyph: "ads", action: copy.createCampaign, premiumOnly: true, unavailable: !adsPilotEnabled, testId: adsPilotEnabled ? (standardMode ? "standard-campaign-ads" : "premium-campaign-ads") : "campaign-ads-coming-soon" },
    { path: "/dashboard?action=campaigns", title: copy.mailCampaigns, description: signatureT("mailCampaignDescription"), tone: "campaignCard", glyph: "mail", action: t.modules.campaignsCta, premiumOnly: true, onOpen: openCampaignModal, loading: isVisible("modal:campaigns"), testId: standardMode ? "standard-campaign-mails" : "premium-campaign-open" },
  ];
  const agentControls = (workspace: InrAgentWorkspace, className: string) => {
    const definition = INR_AGENT_WORKSPACES[workspace];
    const locked = dashboardEdition === "basic" || (workspace === "campaigns" && standardMode);
    return (
      <div className={`${signatureStyles.agentControls} ${className}`}>
        <DashboardAgentLogoButton workspace={workspace} enabled={inrAgentEnabled && !locked}
          busy={isModuleLoadingVisible(definition.href)}
          onClick={() => locked ? startPanelOpening("abonnement") : startModuleNavigation(definition.href)} />
      </div>
    );
  };
  const planningControl = (workspace: InrAgentWorkspace) => {
    const locked = dashboardEdition === "basic" || (workspace === "campaigns" && standardMode);
    return (
        <button type="button" className={`${signatureStyles.planningButton} ${signatureStyles.modulePlanning}`}
          data-agent-planning-workspace={workspace}
          disabled={locked}
          onClick={() => locked ? startPanelOpening("abonnement") : setPlanningWorkspace(workspace)}
          aria-label={`${agentT("planning")} — ${agentT(`${workspace}.name`)}`}
          title={`${agentT("planning")} — ${agentT(`${workspace}.name`)}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2" /></svg>
        </button>
    );
  };
  const pilotTools = [
    ...signatureTools.filter((tool) => tool.tone === "statsCard"),
    ...signatureTools.filter((tool) => tool.tone === "sendCard" || tool.tone === "studioCard" || tool.tone === "reputationCard"),
  ];
  const premiumTools = ["adsCard", "campaignCard", "calendarCard", "crmCard"].map(tone => signatureTools.find(tool => tool.tone === tone)!);
  const renderSignatureTool = (tool: (typeof signatureTools)[number]) => (
    <article className={`${signatureStyles.signatureCard} ${signatureStyles[tool.tone]}`} key={tool.path}>
      {tool.premiumOnly ? <PremiumCardAccent tone={tool.tone} /> : null}
      <span className={signatureStyles.signatureLogo} aria-hidden="true">{tool.logo ? <Image src={tool.logo} alt="" width={52} height={52} /> : <ToolGlyph kind={tool.glyph} />}</span>
      <div className={signatureStyles.signatureCopy}><h4>{tool.title}{tool.tone === "studioCard" ? <span className={signatureStyles.studioEdition} data-studio-edition={studioEdition} role="img" aria-label={`iNr’Studio — ${studioEdition === "basic" ? "Basique" : studioEdition === "standard" ? "Standard" : studioEdition === "founder" ? "Founder" : "Premium"}`} title={`iNr’Studio — ${studioEdition === "basic" ? "Basique" : studioEdition === "standard" ? "Standard" : studioEdition === "founder" ? "Founder" : "Premium"}`}>
        {studioEdition === "basic" ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="#b6c5e3" strokeWidth="1.6" /><path d="M8 12h8M12 8v8" stroke="#dce8ff" strokeWidth="1.8" strokeLinecap="round" /></svg> : studioEdition === "standard" ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2 9 10-9 10L3 12 12 2Z" fill="#48baff" fillOpacity=".2" stroke="#89e4ff" strokeWidth="1.6" /><path d="m8 12 3 3 5-6" stroke="#cefbff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : <PremiumCrown />}
      </span> : null}</h4><p title={tool.description}>{tool.description}</p></div>
      {tool.tone === "studioCard" ? (
        <button type="button" className={`${signatureStyles.settingsButton} ${signatureStyles.studioLibrary}`}
          aria-label={t.userMenu.media} title={t.userMenu.media} data-dashboard-prefetch="/dashboard/mediatheque"
          onClick={() => startModuleNavigation("/dashboard/mediatheque")}
          disabled={isModuleLoadingVisible("/dashboard/mediatheque")}
          aria-busy={isModuleLoadingVisible("/dashboard/mediatheque") || undefined}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="7" y="3" width="14" height="14" rx="3" /><path d="M3 8v10a3 3 0 0 0 3 3h10M8 14l4-4 3 3 2-2 3 3" /><circle cx="16" cy="7" r="1" /></svg>
        </button>
      ) : null}
      {tool.tone === "statsCard" ? planningControl("stats") : null}
      {tool.tone === "campaignCard" ? planningControl("campaigns") : null}
      {tool.tone === "adsCard" ? <button type="button" className={`${signatureStyles.settingsButton} ${signatureStyles.adsInfoButton}`} disabled={standardMode} onClick={() => setAdsInfoOpen(true)} aria-label={signatureT("adsInfo.open")} title={signatureT("adsInfo.open")} aria-haspopup="dialog">i</button> : null}
      {tool.tone === "statsCard" && onOpenGeneratorSettings ? (
        <button type="button" className={`${signatureStyles.settingsButton} ${signatureStyles.statsSettings}`}
          onClick={onOpenGeneratorSettings} aria-label={heroT("settingsAria")} title={heroT("settingsTitle")}
          aria-haspopup="dialog" data-testid="dashboard-stats-settings">
          <SettingsIcon />
        </button>
      ) : null}
      {tool.panel && (!standardMode || tool.premiumOnly) ? (
        <button
          type="button"
          className={signatureStyles.settingsButton}
          aria-label={tool.settingsLabel}
          title={t.notifications.settings}
          onClick={() => startPanelOpening(standardMode ? "abonnement" : tool.panel!)}
          disabled={standardMode && tool.premiumOnly || isPanelLoadingVisible(tool.panel)}
          aria-busy={isPanelLoadingVisible(standardMode ? "abonnement" : tool.panel) || undefined}
        ><SettingsIcon /></button>
      ) : null}
      {tool.tone === "statsCard" && overview ? (
        <dl className={signatureStyles.statsOverview}>
          <div title={heroT("generatedContactsHint")}><dt>{t.hero.capturedLeads} · {t.hero.last7}</dt><dd><span className={signatureStyles.statsMetricIcon}><ToolGlyph kind="people" /></span>{overview.leadsWeek === null ? "—" : overview.leadsWeek.toLocaleString(t.locale)}</dd></div>
          <div title={heroT("generatedContactsHint")}><dt>{t.hero.capturedLeads} · {t.hero.last30}</dt><dd><span className={signatureStyles.statsMetricIcon}><ToolGlyph kind="people" /></span>{overview.leadsMonth === null ? "—" : overview.leadsMonth.toLocaleString(t.locale)}</dd></div>
          <div><dt>{t.hero.opportunities}</dt><dd><span className={signatureStyles.statsMetricIcon}><ToolGlyph kind="ads" /></span>{overview.oppTotal === null ? "—" : "+" + overview.oppTotal.toLocaleString(t.locale)}</dd></div>
          <div><dt>{t.hero.potentialRevenue}</dt><dd><span className={signatureStyles.statsMetricIcon}><ToolGlyph kind="stats" /></span>{overview.estimatedValue === null ? "—" : overview.estimatedValue.toLocaleString(t.locale) + " €"}</dd></div>
        </dl>
      ) : null}
      <div className={signatureStyles.cardActions}>
        <div className={signatureStyles.manualToolActions}>
        {tool.tone !== "statsCard" ? <DashboardToolArtwork kind={tool.tone === "sendCard" ? "send" : tool.tone === "calendarCard" ? "calendar" : tool.tone === "crmCard" ? "contacts" : tool.tone === "studioCard" ? "studio" : tool.tone === "reputationCard" ? "reputation" : tool.tone === "adsCard" ? "ads" : "mail"} className={signatureStyles.pilotArtwork} /> : <span className={signatureStyles.signatureArt} aria-hidden="true"><ToolGlyph kind={tool.glyph} /></span>}
        <button
          type="button"
          className={signatureStyles.toolButton}
          data-testid={tool.testId}
          data-dashboard-prefetch={tool.unavailable || tool.onOpen || standardMode && tool.premiumOnly ? undefined : tool.path}
          onClick={standardMode && tool.premiumOnly ? () => startPanelOpening("abonnement") : tool.onOpen || (tool.path === "/dashboard/stats" ? openStats : () => startModuleNavigation(tool.path))}
          disabled={Boolean(standardMode && tool.premiumOnly) || tool.unavailable || tool.loading || isModuleLoadingVisible(tool.path)}
          aria-busy={(standardMode && tool.premiumOnly ? isPanelLoadingVisible("abonnement") : tool.loading || isModuleLoadingVisible(tool.path)) || undefined}
          aria-label={tool.title}
        >{tool.unavailable ? copy.comingSoon : <>{tool.loading || isModuleLoadingVisible(tool.path) ? i18nT("chargement_01cba1df") : tool.action}<ArrowIcon /></>}</button>
        </div>
        {tool.tone === "statsCard" ? agentControls("stats", signatureStyles.statsAgent) : null}
        {tool.tone === "campaignCard" ? agentControls("campaigns", signatureStyles.compactCampaignAgent) : null}
      </div>
    </article>
  );
  return (
    <>
        <div className={signatureStyles.lowerRow} data-dashboard-standard-lower-blocks={standardMode ? "true" : undefined} data-dashboard-premium-lower-blocks={!standardMode ? "true" : undefined}>
          {cockpit}
            <article className={signatureStyles.boosterCard}>
              <BoosterWave />
              <span className={signatureStyles.boosterAura} aria-hidden="true" />
              <DashboardToolArtwork kind="rocket" className={signatureStyles.boosterArtwork} />
              <div className={signatureStyles.boosterCopy}>
                <h4>{t.modules.publishTitle}</h4>
                <p>{standardT("boosterLine1")}<br /><strong>{standardT("boosterLine2")}</strong></p>
              </div>
              <div className={signatureStyles.boosterPublishAction}>
                <button
                  type="button"
                  className={`${signatureStyles.primaryButton} ${signatureStyles.publishButton}`}
                  data-testid={standardMode ? "standard-booster-publish" : "premium-booster-publish"}
                  onClick={openPublishModal}
                  disabled={isVisible("modal:publish")}
                  aria-busy={isVisible("modal:publish") || undefined}
                  aria-label={t.modules.publishCta}
                >{isVisible("modal:publish") ? i18nT("chargement_01cba1df") : t.modules.publishCta}</button>
              </div>
              <div className={signatureStyles.boosterSummaryActions}>
                <span className={signatureStyles.eyebrow}>{standardT("boosterEyebrow")}</span>
                <div className={signatureStyles.boosterSummaryButtons}>
              <button
                type="button"
                className={signatureStyles.boosterStats}
                aria-label={t.modules.boosterStatsTitle}
                title={t.modules.boosterStatsTitle}
                onClick={openBoosterSummary}
              ><ToolGlyph kind="stats" /></button>
                  {planningControl("publications")}
                </div>
              </div>
              {agentControls("publications", signatureStyles.publicationsAgent)}

            </article>
          {generator}
          <section className={`${signatureStyles.panel} ${signatureStyles.creationPanel}`} aria-labelledby="dashboard-pilot-title" id={DASHBOARD_GEARBOX_ANCHOR_ID}>
            <header className={signatureStyles.panelHeader}>
              <h3 id="dashboard-pilot-title"><span className={signatureStyles.headingIcon} aria-hidden="true"><ToolGlyph kind="stats" /></span>{copy.pilotTitle}</h3>
            </header>
            <div className={signatureStyles.signatureGrid} data-dashboard-relationship-tools="true" data-dashboard-standard-secondary-tools={standardMode ? "true" : undefined} data-dashboard-premium-secondary-tools={!standardMode ? "true" : undefined}>
              {pilotTools.map(renderSignatureTool)}
            </div>
          </section>

          <section className={`${signatureStyles.panel} ${signatureStyles.pilotPanel}`} aria-labelledby="dashboard-premium-title">
            <header className={signatureStyles.panelHeader}>
              <h3 id="dashboard-premium-title">
                <span className={`${signatureStyles.headingIcon} ${signatureStyles.premiumHeadingIcon}`} aria-hidden="true"><PremiumCrown /></span>
                {copy.premiumTitle}
                {standardMode ? <button type="button" className={signatureStyles.premiumGateLock} aria-label={helpT("viewOffers")} title={helpT("viewOffers")} onClick={() => startPanelOpening("abonnement")} data-testid="dashboard-premium-unlock"><DashboardPremiumLockIcon variant="luxury" /></button> : null}
              </h3>
            </header>
            <fieldset disabled={standardMode} aria-labelledby="dashboard-premium-title" className={`${signatureStyles.signatureGrid} ${signatureStyles.premiumGrid}`} data-dashboard-premium-tools="true">
              {premiumTools.map(renderSignatureTool)}
            </fieldset>
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

        {planningWorkspace ? (
          <DashboardAgentPlanningModal open workspace={planningWorkspace} standardMode={standardMode}
            onClose={() => setPlanningWorkspace(null)}
            onManage={() => startModuleNavigation(INR_AGENT_WORKSPACES[planningWorkspace].href)} />
        ) : null}
        {adsInfoOpen ? <AdsChannelInfoModal onClose={() => setAdsInfoOpen(false)} /> : null}
    </>

  );
}
