"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import HelpButton from "./HelpButton";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import styles from "./DashboardHeroPremium.module.css";
import legacyStyles from "../dashboard.module.css";

type HeroIconName = "channels" | "dna" | "ai" | "rocket" | "chart" | "target" | "people";

function HeroIcon({ name }: { name: HeroIconName }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === "channels" ? <><path d="m16 5 12 7-12 7-12-7 12-7Z" /><path d="m4 17 12 7 12-7M4 22l12 7 12-7" /></> : null}
      {name === "dna" ? <><path d="M9 3c0 11 14 15 14 26M23 3C23 14 9 18 9 29" /><path d="M10 6h12M12 11h8M12 21h8M10 26h12" /></> : null}
      {name === "ai" ? <><path d="M13 5a4 4 0 0 0-7 3 4 4 0 0 0-2 7 5 5 0 0 0 2 8 4 4 0 0 0 7 4V5ZM19 5a4 4 0 0 1 7 3 4 4 0 0 1 2 7 5 5 0 0 1-2 8 4 4 0 0 1-7 4V5Z" /><path d="M8 10c3 1 3 3 2 5M6 21c3-1 4 1 4 3M24 10c-3 1-3 3-2 5M26 21c-3-1-4 1-4 3M13 19l-4-2M19 19l4-2" /></> : null}
      {name === "rocket" ? <><path d="M12 21c2-9 7-15 17-18-1 11-7 17-16 19l-1-1Z" /><path d="m11 14-5 1-3 7 8-2M19 22l-1 5-7 3 2-8M9 24l-5 5" /><circle cx="22" cy="10" r="3" /></> : null}
      {name === "chart" ? <><rect x="5" y="18" width="5" height="11" rx="1.5" fill="currentColor" stroke="none" opacity=".7" /><rect x="14" y="11" width="5" height="18" rx="1.5" fill="currentColor" stroke="none" opacity=".85" /><rect x="23" y="4" width="5" height="25" rx="1.5" fill="currentColor" stroke="none" /></> : null}
      {name === "target" ? <><path d="M27 15a11 11 0 1 1-10-10M22 16a6 6 0 1 1-6-6" /><path d="m16 16 12-12M22 4h6v6" /><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none" /></> : null}
      {name === "people" ? <><circle cx="16" cy="10" r="4" /><circle cx="6" cy="13" r="3" /><circle cx="26" cy="13" r="3" /><path d="M9 27v-3a7 7 0 0 1 14 0v3H9ZM3 26v-3a5 5 0 0 1 4-5M29 26v-3a5 5 0 0 0-4-5" /></> : null}
    </svg>
  );
}

type InertiaSnapshot = {
  multiplier: number;
  connectedCount: number;
  totalChannels: number;
};

type ChannelPowerStep = {
  key: string;
  label: string;
  weight: number;
  completed: boolean;
};

type DashboardHeroProps = {
  generatorPower: number;
  dnaPower: number;
  aiPower: number;
  channelPowerSteps: readonly ChannelPowerStep[];
  onOpenChannels: () => void;
  onOpenDna: () => void;
  onOpenAi: () => void;
  onOpenGeneratorHelp: () => void;
  onOpenGeneratorSettings: () => void;
  onRefreshGenerator: () => void;
  kpisLoading: boolean;
  generatorIsActive: boolean;
  uiBalance: number;
  inertiaSnapshot: InertiaSnapshot;
  estimatedValue: number | null;
  oppTotal: number | null;
  onOpenStats: () => void;
  leadsWeek: number | null;
  leadsMonth: number | null;
};

export default function DashboardHero({
  generatorPower,
  dnaPower,
  aiPower,
  channelPowerSteps,
  onOpenChannels,
  onOpenDna,
  onOpenAi,
  onOpenGeneratorHelp,
  onOpenGeneratorSettings,
  onRefreshGenerator,
  kpisLoading,
  generatorIsActive,
  uiBalance,
  inertiaSnapshot,
  estimatedValue,
  oppTotal,
  onOpenStats,
  leadsWeek,
  leadsMonth,
}: DashboardHeroProps) {
  const i18nT = useTranslations("shell");
  const t = useDashboardI18n();
  const heroT = useTranslations("dashboard.hero");
  const [openInfo, setOpenInfo] = useState<"channels" | "dna" | "ai" | null>(null);
  const cockpitRef = useRef<HTMLDivElement | null>(null);
  const globalPower = Math.round(
    ([generatorPower, dnaPower, aiPower]
      .map((value) => Math.min(100, Math.max(0, value)))
      .reduce((total, value) => total + value, 0)) / 3,
  );

  useEffect(() => {
    if (!openInfo) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && cockpitRef.current?.contains(target)) return;
      setOpenInfo(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenInfo(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openInfo]);

  const setupSteps = [
    {
      key: "channels",
      title: heroT("channelsStepLabel"),
      actionLabel: heroT("connectStep"),
      value: generatorPower,
      action: onOpenChannels,
      infoAria: heroT("channelsInfoAria"),
      infoTitle: heroT("channelsInfoTitle"),
      infoHint: heroT("channelsInfoHint"),
    },
    {
      key: "dna",
      title: heroT("dnaStepLabel"),
      actionLabel: heroT("enrichStep"),
      value: dnaPower,
      action: onOpenDna,
      infoAria: heroT("dnaInfoAria"),
      infoTitle: heroT("dnaInfoTitle"),
      infoHint: heroT("dnaInfoHint"),
    },
    {
      key: "ai",
      title: heroT("aiStepLabel"),
      actionLabel: heroT("configureStep"),
      value: aiPower,
      action: onOpenAi,
      infoAria: heroT("aiInfoAria"),
      infoTitle: heroT("aiInfoTitle"),
      infoHint: heroT("aiInfoHint"),
    },
  ] as const;

  return (
    <section className={styles.hero}>
      <div ref={cockpitRef} className={`${styles.heroLeft} ${styles.cockpitPanel}`}>
        <header className={styles.cockpitSummaryHeader}>
          <strong>
            <span className={styles.cockpitTitleDesktop}>{heroT("cockpitTitle")}</span>
            <span className={styles.cockpitTitleMobile}>{heroT("cockpitShortTitle")}</span>
          </strong>
          <span>{heroT("inertiaPower")}</span>
          <span
            className={styles.cockpitGlobalPower}
            aria-label={`${heroT("inertiaPower")} : ${globalPower}%`}
            title={`${heroT("inertiaPower")} : ${globalPower}%`}
            style={{
              "--cockpit-global-power-mid": `${globalPower * 1.8}deg`,
              "--cockpit-global-power": `${globalPower * 3.6}deg`,
            } as CSSProperties}
          >
            {globalPower}%
          </span>
        </header>

        <div className={styles.cockpitStages}>
          {setupSteps.map((step, index) => (
            <article
              className={`${styles.cockpitStage} ${openInfo === step.key ? styles.cockpitStageInfoOpen : ""}`}
              key={step.key}
            >
              <div className={styles.cockpitStageHeading}>
                <span className={styles.cockpitStageNumber}>{index + 1}</span>
                <span className={styles.cockpitStageIcon}><HeroIcon name={step.key} /></span>
                <div className={styles.cockpitStageTitleWrap}>
                  <small>{step.title}</small>
                  <button
                    type="button"
                    className={styles.cockpitInfoButton}
                    aria-label={step.infoAria}
                    aria-expanded={openInfo === step.key}
                    onClick={() => setOpenInfo((current) => current === step.key ? null : step.key)}
                  >
                    i
                  </button>
                </div>
                <span className={styles.cockpitStageScore}>
                  <b>{step.value}%</b>
                </span>
              </div>
              {openInfo === step.key ? (
                <div className={styles.cockpitInfoPopover} role="dialog" aria-label={step.infoTitle}>
                  <strong>{step.infoTitle}</strong>
                  <p>{step.infoHint}</p>
                  {step.key === "channels" ? (
                    <div className={styles.cockpitPowerGrid}>
                      {channelPowerSteps.map((channel) => (
                        <span
                          className={channel.completed ? styles.cockpitPowerItemConnected : ""}
                          key={channel.key}
                        >
                          <i aria-hidden />
                          <em>{channel.label}</em>
                          <b>+{channel.weight}%</b>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div
                className={styles.cockpitStageBar}
                role="progressbar"
                aria-label={`${step.title} ${step.value}%`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={step.value}
              >
                <span style={{ width: `${step.value}%` }} />
              </div>
              <button type="button" onClick={step.action}>{step.actionLabel}</button>
            </article>
          ))}
        </div>
      </div>

      <div className={styles.generatorCard}>
        <div className={styles.generatorHeader}>
          <div className={styles.generatorHeaderCopy}>
            <div className={styles.generatorHeaderLead}>
              <div className={styles.generatorTitle}>{t.hero.generatorTitle}</div>
              <HelpButton onClick={onOpenGeneratorHelp} title={t.hero.generatorHelpTitle} />
            </div>
          </div>

          <div className={styles.generatorEfficiencyFlow}>
            {t.hero.flowContacts} <b>→</b> {t.hero.flowQuotes} <b>→</b> {t.hero.flowRevenue}
          </div>

          <div className={styles.generatorHeaderRight}>
            <button
              type="button"
              className={styles.generatorSettingsBtn}
              onClick={onOpenGeneratorSettings}
              aria-label={heroT("settingsAria")}
              title={heroT("settingsTitle")}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.57 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.57 1.7 1.7 0 0 0 10 3V3h4v.08A1.7 1.7 0 0 0 15.06 4.6a1.7 1.7 0 0 0 1.88-.34L17 4.2 19.83 7l-.06.06A1.7 1.7 0 0 0 19.43 9 1.7 1.7 0 0 0 21 10h.08v4H21a1.7 1.7 0 0 0-1.6 1Z" />
              </svg>
            </button>
            <button
              type="button"
              className={styles.generatorRefreshBtn}
              onClick={onRefreshGenerator}
              disabled={kpisLoading}
              aria-label={t.hero.refreshAria}
              title={t.hero.refreshTitle}
            >
              {kpisLoading ? (
                <span className={styles.miniSpinner} aria-hidden />
              ) : (
                <svg
                  className={styles.refreshIcon}
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden
                >
                  <path
                    d="M20 12a8 8 0 1 1-2.343-5.657"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M20 4v6h-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>

            <div className={`${styles.generatorStatus} ${generatorIsActive ? styles.statusLive : styles.statusSetup}`}>
              <span className={generatorIsActive ? styles.liveDot : styles.setupDot} aria-hidden />
              {generatorIsActive ? t.hero.active : t.hero.waiting}
            </div>
          </div>
        </div>

        <div className={styles.generatorGrid}>
          <div className={`${styles.metricCard} ${styles.metricInertia}`}>
            <span className={styles.metricIcon}><HeroIcon name="rocket" /></span>
            <div className={styles.metricLabel}>{t.hero.inertiaUnits}</div>
            <div className={styles.metricValue}>{uiBalance}</div>
            <div className={styles.metricHint}>
              {i18nT("turbo_ui_value_value_value_value_9a1ca86b", { value0: inertiaSnapshot.multiplier, value1: inertiaSnapshot.connectedCount, value2: inertiaSnapshot.totalChannels, value3: t.hero.channels })}</div>
          </div>

          <div className={legacyStyles.generatorCoreCenter} aria-hidden>
            <div className={legacyStyles.miniCoreRing} />
            <div className={legacyStyles.miniCoreRotor} />
            <div className={legacyStyles.miniCoreGlass} />
            <div className={legacyStyles.miniCoreGlow} />
          </div>

          <div className={`${styles.metricCard} ${styles.metricCa}`}>
            <span className={styles.metricIcon}><HeroIcon name="chart" /></span>
            <div className={styles.metricLabel}>{t.hero.potentialRevenue}</div>
            <div className={styles.metricValue}>
              {estimatedValue === null ? "—" : `${estimatedValue.toLocaleString(t.locale)} €`}
            </div>
            <div className={styles.metricHint}>{t.hero.basedOnProfile}</div>
          </div>

          <div className={`${styles.metricCard} ${styles.metricOpportunities}`}>
            <span className={styles.metricIcon}><HeroIcon name="target" /></span>
            <div className={styles.metricLabel}>{t.hero.opportunities}</div>

            <div className={styles.metricValueRow}>
              <div className={styles.metricValue}>
                <span>{oppTotal === null ? "—" : `+${oppTotal}`}</span>
              </div>

              <button
                type="button"
                className={styles.generatorGoBtnCorner}
                onClick={onOpenStats}
                aria-label={heroT("statsAria")}
                title={heroT("statsAria")}
              >
                <span className={styles.generatorGoBtnLabel}>GO</span>
              </button>
            </div>

            <div className={styles.metricHint}>{t.hero.projection30}</div>
          </div>

          <div className={`${styles.metricCard} ${styles.metricDemandes}`}>
            <span className={styles.metricIcon}><HeroIcon name="people" /></span>
            <div className={styles.metricLabel}>{t.hero.capturedLeads}</div>
            <div className={styles.metricSplit}>
              <div className={styles.metricSplitItem}>
                <div className={styles.metricSplitValue}>{leadsWeek === null ? "—" : leadsWeek}</div>
                <div className={styles.metricSplitLabel}>{t.hero.last7}</div>
              </div>
              <div className={styles.metricSplitItem}>
                <div className={styles.metricSplitValue}>{leadsMonth === null ? "—" : leadsMonth}</div>
                <div className={styles.metricSplitLabel}>{t.hero.last30}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
