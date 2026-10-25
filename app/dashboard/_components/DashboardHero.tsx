"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import styles from "./DashboardHeroPremium.module.css";

type HeroIconName = "channels" | "dna" | "ai";

function HeroIcon({ name }: { name: HeroIconName }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === "channels" ? <><path d="m16 5 12 7-12 7-12-7 12-7Z" /><path d="m4 17 12 7 12-7M4 22l12 7 12-7" /></> : null}
      {name === "dna" ? <><path d="M9 3c0 11 14 15 14 26M23 3C23 14 9 18 9 29" /><path d="M10 6h12M12 11h8M12 21h8M10 26h12" /></> : null}
      {name === "ai" ? <><path d="M13 5a4 4 0 0 0-7 3 4 4 0 0 0-2 7 5 5 0 0 0 2 8 4 4 0 0 0 7 4V5ZM19 5a4 4 0 0 1 7 3 4 4 0 0 1 2 7 5 5 0 0 1-2 8 4 4 0 0 1-7 4V5Z" /><path d="M8 10c3 1 3 3 2 5M6 21c3-1 4 1 4 3M24 10c-3 1-3 3-2 5M26 21c-3-1-4 1-4 3M13 19l-4-2M19 19l4-2" /></> : null}
    </svg>
  );
}

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
  connectedChannels: number;
  totalChannels: number;
  uiBalance: number;
  onOpenChannels: () => void;
  onOpenDna: () => void;
  onOpenAi: () => void;
};

export default function DashboardHero({
  generatorPower,
  dnaPower,
  aiPower,
  channelPowerSteps,
  connectedChannels,
  totalChannels,
  uiBalance,
  onOpenChannels,
  onOpenDna,
  onOpenAi,
}: DashboardHeroProps) {
  const heroT = useTranslations("dashboard.hero");
  const channelsT = useTranslations("dashboard.channels");
  const locale = useLocale();
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
    <section className={`${styles.hero} ${openInfo ? styles.heroInfoOpen : ""}`}>
      <div ref={cockpitRef} className={`${styles.heroLeft} ${styles.cockpitPanel}`}>
        <header className={styles.cockpitSummaryHeader}>
          <strong>
            <span className={styles.cockpitTitleDesktop}>{heroT("cockpitTitle")}</span>
            <span className={styles.cockpitTitleMobile}>{heroT("cockpitShortTitle")}</span>
          </strong>
          <span>{heroT("inertiaPower")}</span>
          <span className={styles.cockpitBalance} title={heroT("inertiaUnits")}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m11.5 2-7 9H10l-1 7 7-10h-5.5l1-6Z" fill="currentColor" /></svg>
            {uiBalance.toLocaleString(locale)} UI
          </span>
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
              data-step={step.key}
              data-complete={step.value >= 100}
            >
              <div className={styles.cockpitStageHeading}>
                <span className={styles.cockpitStageNumber}>{index + 1}</span>
                <div className={styles.cockpitStageTitleWrap}>
                  <span className={styles.cockpitStageIcon}><HeroIcon name={step.key} /></span>
                  <div className={styles.cockpitStageLabel}>
                    <small>{step.title}</small>
                  </div>
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
              <div className={styles.cockpitStageProgress}>
                {step.key === "channels" ? (
                  <span className={styles.cockpitChannelCount} aria-label={`${connectedChannels} / ${totalChannels} ${channelsT("connected")}`}>
                    <i aria-hidden="true" /><b>{connectedChannels} / {totalChannels}</b> <span>{channelsT("connected")}</span>
                  </span>
                ) : null}
                <div className={styles.cockpitStageValueBar}>
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
                  <span className={styles.cockpitStageScore}>
                    {step.value >= 100 ? <span className={styles.cockpitComplete}><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 10 3.2 3.2L15 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>{heroT("stepComplete")}</span> : null}
                    {step.key !== "channels" ? <b>{step.value}%</b> : null}
                  </span>
                </div>
              </div>
              <button type="button" onClick={step.action}>{step.actionLabel}</button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
