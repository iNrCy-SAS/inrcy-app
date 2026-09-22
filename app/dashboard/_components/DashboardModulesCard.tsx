"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useTranslations } from "next-intl";


import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "../dashboard.module.css";
import BaseModal from "./WorkflowBaseModal";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { requestDashboardToolWarmup } from "./DashboardToolWarmup";
import { useDelayedPendingAction } from "@/hooks/useDelayedPendingAction";
import { hasAccountingDashboardAccess } from "@/lib/dashboardEdition";
import { useDashboardEdition } from "./DashboardEditionProvider";
import { DASHBOARD_GEARBOX_ANCHOR_ID } from "../dashboard.scroll";
import standardStyles from "./DashboardStandardModulesCard.module.css";

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
};

function PlanningIcon() {
  return (
    <svg
      className={styles.gearPlanningIcon}
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

export default function DashboardModulesCard({ goToModule, openPanel, onOpenStats, onOpenBoosterPublish, onOpenBoosterStats }: DashboardModulesCardProps) {
  const i18nT = useTranslations("shell");
  const standardT = useTranslations("dashboard.standard");
  const t = useDashboardI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dashboardEdition = useDashboardEdition();
  const accountingEnabled = hasAccountingDashboardAccess(dashboardEdition);
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
      if (searchParams.get("action") === "publish") {
        completeAction(pendingKey);
      }
    }
  }, [campaignModalOpen, cashModalOpen, completeAction, pathname, pendingKey, searchParams]);

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
  const calendarLabel = i18nT("inr_calendar_a9473176").replace(/\s*→\s*$/u, "");
  const crmLabel = i18nT("inr_crm_aa43648a").replace(/\s*→\s*$/u, "");
  return (
    <>
        <div className={styles.lowerRow} data-dashboard-premium-lower-blocks="true">
          <section className={`${styles.blockCard} ${standardStyles.panel} ${standardStyles.pilotPanel} ${standardStyles.premiumPilotPanel}`}>
            <div className={`${styles.blockHead} ${standardStyles.pilotHead}`}>
              <h3 className={styles.h3}>{t.modules.dashboardTitle}</h3>
              <span className={styles.smallMuted}>{t.modules.dashboardSub}</span>
            </div>

            <div className={`${standardStyles.dashboardList} ${standardStyles.premiumDashboardList}`}>
              <span className={standardStyles.pilotOrbit} aria-hidden="true" />

              <article className={`${standardStyles.toolRow} ${standardStyles.sendRow}`}>
                <span className={standardStyles.toolLogo} aria-hidden="true">
                  <Image src="/inrsend-logo-seul.png" alt="" width={52} height={52} />
                </span>
                <div className={standardStyles.toolCopy}>
                  <h4>{i18nT("inr_apos_send_aaa1fcec")}</h4>
                  <p>{t.modules.mailsSub}</p>
                </div>
                <span className={standardStyles.toolActionGroup}>
                  <button
                    type="button"
                    className={standardStyles.toolSettings}
                    aria-label={t.modules.mailsSettingsAria}
                    title={t.notifications.settings}
                    onClick={() => startPanelOpening("mails")}
                    disabled={isPanelLoadingVisible("mails")}
                    aria-busy={isPanelLoadingVisible("mails") || undefined}
                  >
                    <SettingsIcon />
                  </button>
                  <button
                    type="button"
                    className={standardStyles.toolAction}
                    data-dashboard-prefetch="/dashboard/mails"
                    onClick={() => startModuleNavigation("/dashboard/mails")}
                    disabled={isModuleLoadingVisible("/dashboard/mails")}
                    aria-busy={isModuleLoadingVisible("/dashboard/mails") || undefined}
                  >
                    {isModuleLoadingVisible("/dashboard/mails") ? i18nT("chargement_01cba1df") : i18nT("inr_send_fd44a9fa")} <ArrowIcon />
                  </button>
                </span>
              </article>

              <article className={`${standardStyles.toolRow} ${standardStyles.statsRow}`}>
                <span className={standardStyles.toolLogo} aria-hidden="true">
                  <Image src="/inrstats-logo-seul.png" alt="" width={52} height={52} />
                </span>
                <div className={standardStyles.toolCopy}>
                  <h4>{i18nT("inr_apos_stats_e43f5622")}</h4>
                  <p>{t.modules.statsSub}</p>
                </div>
                <button
                  type="button"
                  className={standardStyles.toolAction}
                  data-dashboard-prefetch="/dashboard/stats"
                  onClick={openStats}
                  disabled={isModuleLoadingVisible("/dashboard/stats")}
                  aria-busy={isModuleLoadingVisible("/dashboard/stats") || undefined}
                >
                  {isModuleLoadingVisible("/dashboard/stats") ? i18nT("chargement_01cba1df") : i18nT("inr_stats_881d9239")} <ArrowIcon />
                </button>
              </article>

              <article className={`${standardStyles.toolRow} ${standardStyles.reputationRow}`}>
                <span className={standardStyles.toolLogo} aria-hidden="true">
                  <Image src="/mobile-shortcuts/optimized/reputation-shortcut.png" alt="" width={52} height={52} />
                </span>
                <div className={standardStyles.toolCopy}>
                  <h4>{standardT("reputationName")}</h4>
                  <p>{t.modules.reputationSub}</p>
                </div>
                <button
                  type="button"
                  className={standardStyles.toolAction}
                  data-dashboard-prefetch="/dashboard/e-reputation"
                  onClick={() => startModuleNavigation("/dashboard/e-reputation")}
                  disabled={isModuleLoadingVisible("/dashboard/e-reputation")}
                  aria-busy={isModuleLoadingVisible("/dashboard/e-reputation") || undefined}
                >
                  {isModuleLoadingVisible("/dashboard/e-reputation") ? i18nT("chargement_01cba1df") : t.modules.reputationCta} <ArrowIcon />
                </button>
              </article>

              <article className={`${standardStyles.toolRow} ${standardStyles.agendaRow}`}>
                <span className={standardStyles.toolLogo} aria-hidden="true">
                  <Image src="/mobile-shortcuts/inrcalendar-bubble.png" alt="" width={52} height={52} />
                </span>
                <div className={standardStyles.toolCopy}>
                  <h4>{calendarLabel}</h4>
                  <p>{t.modules.agendaSub}</p>
                </div>
                <span className={standardStyles.toolActionGroup}>
                  <button
                    type="button"
                    className={standardStyles.toolSettings}
                    aria-label={t.modules.agendaSettingsAria}
                    title={t.notifications.settings}
                    onClick={() => startPanelOpening("agenda")}
                    disabled={isPanelLoadingVisible("agenda")}
                    aria-busy={isPanelLoadingVisible("agenda") || undefined}
                  >
                    <SettingsIcon />
                  </button>
                  <button
                    type="button"
                    className={standardStyles.toolAction}
                    data-dashboard-prefetch="/dashboard/agenda"
                    onClick={() => startModuleNavigation("/dashboard/agenda")}
                    disabled={isModuleLoadingVisible("/dashboard/agenda")}
                    aria-busy={isModuleLoadingVisible("/dashboard/agenda") || undefined}
                  >
                    {isModuleLoadingVisible("/dashboard/agenda") ? i18nT("chargement_01cba1df") : calendarLabel} <ArrowIcon />
                  </button>
                </span>
              </article>

              <article className={`${standardStyles.toolRow} ${standardStyles.crmRow}`}>
                <span className={standardStyles.toolLogo} aria-hidden="true">
                  <Image src="/mobile-shortcuts/inrcrm-bubble.png" alt="" width={52} height={52} />
                </span>
                <div className={standardStyles.toolCopy}>
                  <h4>{crmLabel}</h4>
                  <p>{t.modules.crmSub}</p>
                </div>
                <button
                  type="button"
                  className={standardStyles.toolAction}
                  data-dashboard-prefetch="/dashboard/crm"
                  onClick={() => startModuleNavigation("/dashboard/crm")}
                  disabled={isModuleLoadingVisible("/dashboard/crm")}
                  aria-busy={isModuleLoadingVisible("/dashboard/crm") || undefined}
                >
                  {isModuleLoadingVisible("/dashboard/crm") ? i18nT("chargement_01cba1df") : crmLabel} <ArrowIcon />
                </button>
              </article>
            </div>
          </section>

          <div
            id={DASHBOARD_GEARBOX_ANCHOR_ID}
            className={`${standardStyles.standardActionStack} ${standardStyles.premiumActionStack}`}
          >
            <section className={`${styles.blockCard} ${standardStyles.panel} ${standardStyles.boosterPanel}`}>
              <span className={standardStyles.boosterGrid} aria-hidden="true" />
              <span className={standardStyles.boosterOrbit} aria-hidden="true" />
              <span className={standardStyles.boosterNodeOne} aria-hidden="true" />
              <span className={standardStyles.boosterNodeTwo} aria-hidden="true" />
              <span className={standardStyles.boosterNodeThree} aria-hidden="true" />

              <div className={standardStyles.boosterContent}>
                <span className={standardStyles.boosterEyebrow}>{standardT("boosterEyebrow")}</span>
                <span className={standardStyles.boosterLogo} aria-hidden="true"><BoosterIcon /></span>
                <div className={standardStyles.boosterCopy}>
                  <h3>{t.modules.publishTitle}</h3>
                  <p>{standardT("boosterLine1")}<br /><strong>{standardT("boosterLine2")}</strong></p>
                  <span className={standardStyles.boosterCtaShell}>
                    <button
                      type="button"
                      data-testid="premium-booster-publish"
                      onClick={openPublishModal}
                      disabled={isVisible("modal:publish")}
                      aria-busy={isVisible("modal:publish") || undefined}
                      aria-label={t.modules.publishCta}
                    >
                      {isVisible("modal:publish") ? i18nT("chargement_01cba1df") : t.modules.publishCta} <ArrowIcon />
                    </button>
                  </span>
                </div>
              </div>

              <button
                type="button"
                className={standardStyles.boosterStats}
                aria-label={t.modules.boosterStatsTitle}
                title={t.modules.boosterStatsTitle}
                onClick={openBoosterSummary}
              >
                <span aria-hidden="true"><i /><i /><i /></span>
                <b>{standardT("boosterSummary")}</b>
              </button>
            </section>

            <section className={`${styles.blockCard} ${standardStyles.panel} ${standardStyles.campaignPanel}`}>
              <span className={standardStyles.campaignGlow} aria-hidden="true" />
              <span className={standardStyles.campaignIcon} aria-hidden="true">◎</span>
              <div className={standardStyles.campaignCopy}>
                <span>{t.modules.campaignsTitle}</span>
                <h3>{t.modules.campaignsSub}</h3>
              </div>
              <button
                type="button"
                className={standardStyles.campaignButton}
                data-testid="premium-campaign-open"
                onClick={openCampaignModal}
                disabled={isVisible("modal:campaigns")}
                aria-busy={isVisible("modal:campaigns") || undefined}
              >
                {isVisible("modal:campaigns") ? i18nT("chargement_01cba1df") : t.modules.campaignsCta} <ArrowIcon />
              </button>
            </section>

            <div className={standardStyles.secondaryToolsRow} data-dashboard-premium-secondary-tools="true">
              <section className={`${styles.blockCard} ${standardStyles.panel} ${standardStyles.agentPanel}`}>
                <span className={standardStyles.agentGlow} aria-hidden="true" />
                <span className={standardStyles.agentMesh} aria-hidden="true" />
                <span className={standardStyles.agentOrbit} aria-hidden="true" />
                <span className={standardStyles.agentNodeOne} aria-hidden="true" />
                <span className={standardStyles.agentNodeTwo} aria-hidden="true" />
                <span className={standardStyles.agentLogo} aria-hidden="true">
                  <Image src="/icons/inr-agent-header.png" alt="" width={52} height={52} />
                </span>
                <div className={standardStyles.agentCopy}>
                  <span>{standardT("agentEyebrow")}</span>
                  <h3>{t.modules.agentTitle}</h3>
                  <p>{t.modules.agentSub}</p>
                </div>
                <button
                  className={standardStyles.agentPlanningIconButton}
                  type="button"
                  data-testid="premium-agent-planning"
                  onClick={openAgentPlanning}
                  aria-label={standardT("agentPlanning")}
                  title={standardT("agentPlanning")}
                >
                  <PlanningIcon />
                </button>
                <span className={standardStyles.agentActions}>
                  <button
                    className={standardStyles.agentPilotButton}
                    type="button"
                    data-testid="premium-agent-pilotage"
                    data-dashboard-prefetch={agentPath}
                    onClick={() => startModuleNavigation(agentPath)}
                    disabled={isModuleLoadingVisible(agentPath)}
                    aria-busy={isModuleLoadingVisible(agentPath) || undefined}
                  >
                    {isModuleLoadingVisible(agentPath) ? i18nT("chargement_01cba1df") : t.modules.agentCta} <ArrowIcon />
                  </button>
                </span>
              </section>

              <section className={`${styles.blockCard} ${standardStyles.panel} ${standardStyles.studioPanel}`}>
                <span className={standardStyles.studioGlow} aria-hidden="true" />
                <span className={standardStyles.studioGrid} aria-hidden="true" />
                <span className={standardStyles.studioOrbit} aria-hidden="true" />
                <span className={standardStyles.studioNodeOne} aria-hidden="true" />
                <span className={standardStyles.studioNodeTwo} aria-hidden="true" />
                <span className={standardStyles.studioLogo} aria-hidden="true">✦</span>
                <div className={standardStyles.studioCopy}>
                  <span>{standardT("studioEyebrow")}</span>
                  <h3 aria-label="iNr’Studio"><b>iNr’</b>Studio</h3>
                  <p>{standardT("studioLine1")} <strong>{standardT("studioLine2")}</strong></p>
                </div>
                <button
                  className={standardStyles.studioButton}
                  type="button"
                  data-testid="premium-studio-open"
                  data-dashboard-prefetch={studioPath}
                  onClick={() => startModuleNavigation(studioPath)}
                  disabled={isModuleLoadingVisible(studioPath)}
                  aria-busy={isModuleLoadingVisible(studioPath) || undefined}
                >
                  {isModuleLoadingVisible(studioPath) ? i18nT("chargement_01cba1df") : standardT("studioCta")} <ArrowIcon />
                </button>
              </section>
            </div>
          </div>
        </div>

        {campaignModalOpen ? (
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
            standardMode={false}
            onClose={() => setAgentPlanningOpen(false)}
            onManage={() => startModuleNavigation("/dashboard/agent")}
          />
        ) : null}
    </>

  );
}
