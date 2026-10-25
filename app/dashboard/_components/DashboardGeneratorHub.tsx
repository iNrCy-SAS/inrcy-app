"use client";

import { useTranslations } from "next-intl";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import styles from "./DashboardExperience.module.css";
import DashboardNavigationIcon from "./DashboardNavigationIcon";
import DashboardGeneratorOrb from "./DashboardGeneratorOrb";
import orbStyles from "./DashboardGeneratorOrb.module.css";

type Props = {
  onDesktopLeftHost: (host: HTMLDivElement | null) => void;
  onDesktopRightHost: (host: HTMLDivElement | null) => void;
  onOpenGeneratorHelp: () => void;
  onOpenGeneratorSettings: () => void;
  onRefreshGenerator: () => void;
  kpisLoading: boolean;
  generatorIsActive: boolean;
  inertiaSnapshot: { multiplier: number; connectedCount: number; totalChannels: number };
};

export default function DashboardGeneratorHub({
  onDesktopLeftHost,
  onDesktopRightHost,
  onOpenGeneratorHelp,
  onOpenGeneratorSettings,
  onRefreshGenerator,
  kpisLoading,
  generatorIsActive,
  inertiaSnapshot,
}: Props) {
  const t = useDashboardI18n();
  const heroT = useTranslations("dashboard.hero");
  const helpT = useTranslations("dashboard.helpCenter");
  const shellT = useTranslations("shell");
  const inertiaHint = shellT("turbo_ui_value_value_value_value_9a1ca86b", {
    value0: inertiaSnapshot.multiplier,
    value1: inertiaSnapshot.connectedCount,
    value2: inertiaSnapshot.totalChannels,
    value3: t.hero.channels,
  });

  return (
    <div className={styles.hubRow}>
      <span className={styles.hubBeam} aria-hidden="true" />
      <div className={styles.generatorActions}>
        <div className={styles.generatorLeftControls}>
          <div className={`${styles.desktopToolsHost} ${styles.desktopToolsLeft}`} ref={onDesktopLeftHost} />
          <button type="button" className={styles.generatorAction} onClick={onOpenGeneratorHelp}
            aria-label={helpT("aria")} title={helpT("title")} aria-haspopup="dialog"><DashboardNavigationIcon kind="help" /></button>
          <button type="button" className={`${styles.generatorAction} ${styles.refreshAction}`} onClick={onRefreshGenerator}
            disabled={kpisLoading} aria-busy={kpisLoading || undefined}
            aria-label={t.hero.refreshAria} title={t.hero.refreshTitle}>
            <DashboardNavigationIcon kind="refresh" />
          </button>
        </div>
        <button type="button" className={`${styles.channelsHub} ${orbStyles.host}`} onClick={onOpenGeneratorSettings}
          aria-label={`${heroT("settingsAria")} · ${generatorIsActive ? t.hero.active : t.hero.waiting}`} title={`${heroT("settingsTitle")} · ${generatorIsActive ? t.hero.active : t.hero.waiting} · ${inertiaHint}`}
          aria-haspopup="dialog" data-testid="dashboard-generator-hub" data-active={generatorIsActive}>
          <DashboardGeneratorOrb isActive={generatorIsActive} className={orbStyles.fill} />
        </button>
        <div className={`${styles.desktopToolsHost} ${styles.desktopToolsRight}`} ref={onDesktopRightHost} />
      </div>
    </div>
  );
}
