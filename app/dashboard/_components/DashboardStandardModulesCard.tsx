"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { useDelayedPendingAction } from "@/hooks/useDelayedPendingAction";
import styles from "../dashboard.module.css";
import { requestDashboardToolWarmup } from "./DashboardToolWarmup";
import standardStyles from "./DashboardStandardModulesCard.module.css";

type Props = {
  goToModule: (path: string) => void;
  onOpenStats?: () => void;
  onOpenBoosterPublish?: () => void;
  onOpenBoosterStats?: () => void;
};

function ArrowIcon() {
  return <span aria-hidden="true">→</span>;
}

function ReputationIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="m32 7 7.4 15 16.6 2.4-12 11.7 2.8 16.5L32 44.8l-14.8 7.8L20 36.1 8 24.4 24.6 22 32 7Z" />
    </svg>
  );
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

export default function DashboardStandardModulesCard({
  goToModule,
  onOpenStats,
  onOpenBoosterPublish,
  onOpenBoosterStats,
}: Props) {
  const i18nT = useTranslations("shell");
  const t = useTranslations("dashboard.standard");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pendingKey, beginAction, completeAction, isVisible } = useDelayedPendingAction<string>();

  useEffect(() => {
    if (!pendingKey) return;

    if (pendingKey.startsWith("route:")) {
      const href = pendingKey.slice("route:".length);
      const target = new URL(href, "https://inrcy.local");
      const queryMatches = Array.from(target.searchParams.entries()).every(
        ([key, value]) => searchParams.get(key) === value,
      );
      if (pathname === target.pathname && queryMatches) completeAction(pendingKey);
      return;
    }

    if (
      pendingKey === "modal:publish" &&
      (searchParams.get("action") === "publish" || searchParams.get("panel"))
    ) {
      completeAction(pendingKey);
    }
  }, [completeAction, pathname, pendingKey, searchParams]);

  const startModuleNavigation = (path: string, action?: () => void) => {
    const key = `route:${path}`;
    if (!beginAction(key)) return;
    requestDashboardToolWarmup(path);
    if (action) action();
    else goToModule(path);
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

  const statsPath = "/dashboard/stats";
  const publicationsPath = "/dashboard/mails?folder=publications&boxView=sent";
  const reputationPath = "/dashboard/e-reputation";

  return (
    <div className={styles.lowerRow} data-dashboard-standard-lower-blocks="true">
      <section className={`${styles.blockCard} ${standardStyles.panel} ${standardStyles.pilotPanel}`}>
        <div className={`${styles.blockHead} ${standardStyles.pilotHead}`}>
          <h3 className={styles.h3}>{t("pilotTitle")}</h3>
          <span className={styles.smallMuted}>{t("pilotSubtitle")}</span>
        </div>

        <div className={standardStyles.dashboardList}>
          <span className={standardStyles.pilotOrbit} aria-hidden="true" />

          <article className={`${standardStyles.toolRow} ${standardStyles.statsRow}`}>
            <span className={standardStyles.toolLogo} aria-hidden="true">
              <img src="/inrstats-logo-seul.png" alt="" />
            </span>
            <div className={standardStyles.toolCopy}>
              <h4>{i18nT("inr_apos_stats_e43f5622")}</h4>
              <p>{t("statsDescription")}</p>
            </div>
            <button
              type="button"
              className={standardStyles.toolAction}
              data-dashboard-prefetch={statsPath}
              onClick={() => startModuleNavigation(statsPath, onOpenStats)}
              disabled={isVisible(`route:${statsPath}`)}
              aria-busy={isVisible(`route:${statsPath}`) || undefined}
            >
              {isVisible(`route:${statsPath}`) ? t("loading") : t("statsCta")} <ArrowIcon />
            </button>
          </article>

          <article className={`${standardStyles.toolRow} ${standardStyles.sendRow}`}>
            <span className={standardStyles.toolLogo} aria-hidden="true">
              <img src="/inrsend-logo-seul.png" alt="" />
            </span>
            <div className={standardStyles.toolCopy}>
              <h4>{i18nT("inr_apos_send_aaa1fcec")}</h4>
              <p>{t("sendDescription")}</p>
            </div>
            <button
              type="button"
              className={standardStyles.toolAction}
              data-dashboard-prefetch={publicationsPath}
              onClick={() => startModuleNavigation(publicationsPath)}
              disabled={isVisible(`route:${publicationsPath}`)}
              aria-busy={isVisible(`route:${publicationsPath}`) || undefined}
            >
              {isVisible(`route:${publicationsPath}`) ? t("loading") : t("sendCta")} <ArrowIcon />
            </button>
          </article>

          <article className={`${standardStyles.toolRow} ${standardStyles.reputationRow}`}>
            <span className={`${standardStyles.toolLogo} ${standardStyles.reputationLogo}`} aria-hidden="true">
              <ReputationIcon />
            </span>
            <div className={standardStyles.toolCopy}>
              <h4>{t("reputationName")}</h4>
              <p>{t("reputationDescription")}</p>
            </div>
            <button
              type="button"
              className={standardStyles.toolAction}
              data-dashboard-prefetch={reputationPath}
              onClick={() => startModuleNavigation(reputationPath)}
              disabled={isVisible(`route:${reputationPath}`)}
              aria-busy={isVisible(`route:${reputationPath}`) || undefined}
            >
              {isVisible(`route:${reputationPath}`) ? t("loading") : t("reputationCta")} <ArrowIcon />
            </button>
          </article>
        </div>
      </section>

      <section className={`${styles.blockCard} ${standardStyles.panel} ${standardStyles.boosterPanel}`}>
        <span className={standardStyles.boosterGrid} aria-hidden="true" />
        <span className={standardStyles.boosterOrbit} aria-hidden="true" />
        <span className={standardStyles.boosterNodeOne} aria-hidden="true" />
        <span className={standardStyles.boosterNodeTwo} aria-hidden="true" />
        <span className={standardStyles.boosterNodeThree} aria-hidden="true" />

        <div className={standardStyles.boosterContent}>
          <span className={standardStyles.boosterEyebrow}>{t("boosterEyebrow")}</span>
          <span className={standardStyles.boosterLogo} aria-hidden="true"><BoosterIcon /></span>
          <div className={standardStyles.boosterCopy}>
            <h3>{i18nT("booster_8e4caec0")}</h3>
            <p>{t("boosterLine1")}<br /><strong>{t("boosterLine2")}</strong></p>
            <button
              type="button"
              onClick={openPublishModal}
              disabled={isVisible("modal:publish")}
              aria-busy={isVisible("modal:publish") || undefined}
            >
              {isVisible("modal:publish") ? t("loading") : t("boosterCta")} <ArrowIcon />
            </button>
          </div>
        </div>

        <button
          type="button"
          className={standardStyles.boosterStats}
          aria-label={t("boosterSummaryAria")}
          title={t("boosterSummaryAria")}
          onClick={openBoosterSummary}
        >
          <span aria-hidden="true"><i /><i /><i /></span>
          <b>{t("boosterSummary")}</b>
        </button>
      </section>
    </div>
  );
}
