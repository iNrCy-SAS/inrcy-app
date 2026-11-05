"use client";

import { useTranslations } from "next-intl";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import styles from "./DashboardExperience.module.css";
import DashboardNavigationIcon from "./DashboardNavigationIcon";
import DashboardGeneratorOrb from "./DashboardGeneratorOrb";
import orbStyles from "./DashboardGeneratorOrb.module.css";
import { useState } from "react";
import { useInrAssistantLocalInterface } from "../_hooks/useInrAssistantLocalInterface";

type Props = {
  onDesktopLeftHost: (host: HTMLDivElement | null) => void;
  onDesktopRightHost: (host: HTMLDivElement | null) => void;
  onOpenGeneratorHelp: () => void;
  onRefreshGenerator: () => Promise<boolean>;
  kpisLoading: boolean;
  generatorIsActive: boolean;
};

export default function DashboardGeneratorHub({
  onDesktopLeftHost,
  onDesktopRightHost,
  onOpenGeneratorHelp,
  onRefreshGenerator,
  kpisLoading,
  generatorIsActive,
}: Props) {
  const t = useDashboardI18n();
  const heroT = useTranslations("dashboard.hero");
  const helpT = useTranslations("dashboard.helpCenter");
  const [refreshCompleted, setRefreshCompleted] = useState(0);
  const refresh = async () => {
    if (kpisLoading) return false;
    if (!await onRefreshGenerator()) return false;
    setRefreshCompleted(previous => previous + 1);
    return true;
  };
  useInrAssistantLocalInterface("generator", { refreshCompleted }, {
    retry: {
      async invoke() { if (!await refresh()) throw new Error("Generator refresh failed"); },
      matches: snapshot => (snapshot as { refreshCompleted?: unknown } | undefined)?.refreshCompleted === refreshCompleted + 1,
    },
  }, true, kpisLoading);

  return (
    <div className={styles.hubRow}>
      <span className={styles.hubBeam} aria-hidden="true" />
      <div className={styles.generatorActions}>
        <div className={styles.generatorLeftControls}>
          <div className={`${styles.desktopToolsHost} ${styles.desktopToolsLeft}`} ref={onDesktopLeftHost} />
          <button type="button" className={styles.generatorAction} onClick={onOpenGeneratorHelp}
            aria-label={helpT("aria")} title={helpT("title")} aria-haspopup="dialog"><DashboardNavigationIcon kind="help" /></button>
          <button type="button" className={`${styles.generatorAction} ${styles.refreshAction}`} onClick={() => void refresh()}
            disabled={kpisLoading} aria-busy={kpisLoading || undefined}
            aria-label={t.hero.refreshAria} title={t.hero.refreshTitle}>
            <DashboardNavigationIcon kind="refresh" />
          </button>
        </div>
        <div className={`${styles.channelsHub} ${orbStyles.host}`} role="img"
          aria-label={`${heroT("generatorShortTitle")} · ${generatorIsActive ? t.hero.active : t.hero.waiting}`}
          data-testid="dashboard-generator-hub" data-active={generatorIsActive}>
          <DashboardGeneratorOrb isActive={generatorIsActive} className={orbStyles.fill} />
        </div>
        <div className={`${styles.desktopToolsHost} ${styles.desktopToolsRight}`} ref={onDesktopRightHost} />
      </div>
    </div>
  );
}
