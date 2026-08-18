"use client";

import { useTranslations } from "next-intl";


type DashboardStyles = Readonly<Record<string, string>>;

export default function PublishExecutionProgress({
  styles,
  scheduling = false,
  publishProgress,
  publishProgressLabel,
  phaseIndex,
  phaseTotal,
  phaseLabel,
}: {
  styles: DashboardStyles;
  scheduling?: boolean;
  publishProgress: number;
  publishProgressLabel: string;
  phaseIndex?: number;
  phaseTotal?: number;
  phaseLabel?: string;
}) {
  const i18nT = useTranslations("booster");
  const safeProgress = Math.max(
    0,
    Math.min(100, Math.round(Number(publishProgress) || 0)),
  );
  const hasPhaseDetails =
    !scheduling &&
    Number.isFinite(phaseIndex) &&
    Number.isFinite(phaseTotal) &&
    Number(phaseIndex) > 0 &&
    Number(phaseTotal) > 0;

  return (
    <div className={styles.publishProgressBox} aria-live="polite">
      <div className={styles.publishProgressHeader}>
        <div className={styles.publishProgressHeadingGroup}>
          <strong className={styles.publishProgressTitle}>
            {scheduling ? i18nT("programmation_en_cours_63e2106d") : i18nT("publication_en_cours_58f34b8e")}
          </strong>
          {hasPhaseDetails ? (
            <span className={styles.publishProgressPhase}>
              {i18nT("etape_13146b48")}{" "}{phaseIndex}/{phaseTotal}
              {phaseLabel ? ` · ${phaseLabel}` : ""}
            </span>
          ) : null}
        </div>
        <strong className={styles.publishProgressPercent}>{safeProgress}%</strong>
      </div>
      <span className={styles.publishProgressLabel}>
        {publishProgressLabel ||
          (scheduling
            ? i18nT("programmation_en_cours_33f59055")
            : i18nT("publication_en_cours_09ec4187"))}
      </span>
      <div
        className={styles.publishProgressTrack}
        role="progressbar"
        aria-label={publishProgressLabel || "Progression de la publication"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safeProgress}
      >
        <div
          className={`${styles.publishProgressFill} ${safeProgress < 100 ? styles.publishProgressFillActive : ""}`}
          style={{ width: `${safeProgress}%` }}
        />
      </div>
    </div>
  );
}
