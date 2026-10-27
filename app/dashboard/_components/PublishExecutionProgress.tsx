"use client";

import { useTranslations } from "next-intl";
import { useId, type CSSProperties, type ReactNode } from "react";
import { isBoosterPublicationPendingStatus } from "@/lib/boosterPublicationStatus";
import css from "./PublishExecutionProgress.module.css";

type DashboardStyles = Readonly<Record<string, string>>;
export type PublicationProgressDestination = {
  key: string;
  label: string;
  status?: "published" | "pending" | "failed" | "warning" | "skipped";
  href?: string;
  details?: string;
  storyProgressLabel?: string;
};

const CHANNEL_LOGOS: Readonly<Record<string, string>> = {
  site_web: "/icons/site-web.jpg",
  inr_search: "/icons/inr-search-bubble-128.png",
  gmb: "/icons/google.jpg",
  facebook: "/icons/facebook.png",
  instagram: "/icons/instagram.jpg",
  threads: "/icons/threads.svg",
  linkedin: "/icons/linkedin.png",
  x: "/icons/x.svg",
  tiktok: "/icons/tiktok.png",
  youtube_shorts: "/icons/youtube-shorts.png",
  pinterest: "/icons/pinterest-logo-128.png",
};
const DESTINATION_COLORS = ["#57d7ff", "#9e91ff", "#ee8bda", "#ffc28a"];

const DESTINATION_STATUS = {
  published: { label: "Publié", icon: "✓", color: "#6ee2ae" },
  pending: { label: "En attente", icon: "◷", color: "#f3ce71" },
  failed: { label: "Échec", icon: "!", color: "#f58397" },
  warning: { label: "Publié avec avertissement", icon: "!", color: "#f3ce71" },
  skipped: { label: "Non envoyé", icon: "−", color: "#f58397" },
} as const;

export function getPublicationDestinationStatus(entry: {
  status?: unknown;
  technicalStatus?: unknown;
  warning_kind?: unknown;
  ok?: unknown;
}): NonNullable<PublicationProgressDestination["status"]> {
  const status = String(entry.status || "").toLowerCase();
  const technicalStatus = String(entry.technicalStatus || "").toLowerCase();
  if (isBoosterPublicationPendingStatus(status) || isBoosterPublicationPendingStatus(technicalStatus) || entry.warning_kind === "pending") return "pending";
  if (status === "skipped") return "skipped";
  if (entry.ok === false || [status, technicalStatus].some((value) => value === "failed" || value === "error")) return "failed";
  if ([status, technicalStatus].includes("published_with_warning")) return "warning";
  if ([status, technicalStatus].some((value) => ["published", "completed", "success", "succeeded"].includes(value))) return "published";
  return "pending";
}

export function PublicationVisualHub({
  progress,
  destinations,
  completed = false,
  outcome = "neutral",
  centerLabel,
  progressLabel = "Traitement de la publication",
  phaseSummary,
}: {
  progress: number;
  destinations: readonly PublicationProgressDestination[];
  completed?: boolean;
  outcome?: "published" | "pending" | "warning" | "failed" | "neutral";
  centerLabel?: string;
  progressLabel?: string;
  phaseSummary?: ReactNode;
}) {
  const progressId = useId();
  const safeProgress = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
  const targets = destinations.map((destination, index) => ({
      ...destination,
      color: destination.status ? DESTINATION_STATUS[destination.status].color : DESTINATION_COLORS[index % DESTINATION_COLORS.length],
  }));
  return (
    <div className={css.scene} data-publication-visual-hub data-complete={completed} data-outcome={outcome}>
      <div className={css.core} role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeProgress} aria-valuetext={centerLabel ? `${safeProgress} % — ${centerLabel}` : `${safeProgress} %`}>
        <div className={css.halo} />
        <svg className={css.ring} viewBox="0 0 240 240" focusable="false" aria-hidden="true">
          <defs>
            <linearGradient id={progressId} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffb975" /><stop offset="35%" stopColor="#ee69c7" />
              <stop offset="68%" stopColor="#9c7bff" /><stop offset="100%" stopColor="#4cddf5" />
            </linearGradient>
          </defs>
          <circle className={css.ringTrack} cx="120" cy="120" r="108" />
          <circle className={css.ringFill} cx="120" cy="120" r="108" pathLength="100" stroke={`url(#${progressId})`} strokeDasharray="100" strokeDashoffset={100 - safeProgress} transform="rotate(-90 120 120)" />
        </svg>
        <div className={css.coreContent}>
          <svg className={css.rocket} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45" focusable="false">
            <path d="M14 5c3-3 7-3 7-3s0 4-3 7l-7 7-4-4 7-7Z" /><circle cx="16" cy="7" r="1.6" />
            <path d="m11 8-5 1-3 4 5 1m8-3-1 5-4 3-1-5M6 16c-2 0-3 2-3 5 3 0 5-1 5-3" />
          </svg>
          <strong className={css.corePercent}>{safeProgress}<span>%</span></strong>
          {centerLabel ? <span className={css.coreLabel}>{centerLabel}</span> : null}
        </div>
      </div>
      {phaseSummary}
      <ul className={css.destinations} aria-label={destinations.some((destination) => destination.status) ? "Résultat par canal" : "Destinations sélectionnées"}>
        {targets.map((destination, index) => {
          const status = destination.status ? DESTINATION_STATUS[destination.status] : null;
          const hasDetails = Boolean(status && destination.details);
          const identity = <>
            {CHANNEL_LOGOS[destination.key] ? <img src={CHANNEL_LOGOS[destination.key]} alt="" width={38} height={38} /> : <span>{destination.label.slice(0, 1)}</span>}
            <span className={css.destinationText}><strong>{destination.label}</strong>{status ? <small>{status.label}</small> : null}{destination.storyProgressLabel ? <small data-story-confirmed-count>{destination.storyProgressLabel}</small> : null}</span>
            {status && !hasDetails ? <span className={css.destinationBadge} aria-hidden="true">{status.icon}</span> : null}
          </>;
          return (
            <li key={destination.key} className={css.destination} data-channel={destination.key} data-status={destination.status} data-feeding={(!completed && !destination.status) || destination.status === "pending"} data-linked={Boolean(destination.href)} style={{ "--destination-color": destination.color, "--pulse-delay": `${index * -.37}s` } as CSSProperties}>
              <span className={css.destinationTrigger} aria-label={(status ? `${destination.label} — ${status.label}` : destination.label) + (destination.storyProgressLabel ? ` · ${destination.storyProgressLabel}` : "")}>{identity}</span>
              {hasDetails && status ? <details className={css.destinationDetails} name={`${progressId}-channel-details`} onKeyDown={(event) => { if (event.key === "Escape" && event.currentTarget.open) { event.currentTarget.open = false; event.currentTarget.querySelector<HTMLElement>("summary")?.focus(); event.stopPropagation(); } }}>
                <summary className={css.destinationInfo} aria-label={`${destination.label} — ${status.label} : détails`} title="Voir le détail"><span className={css.destinationInfoGlyph} aria-hidden="true">i</span><span className={css.destinationCloseGlyph} aria-hidden="true">×</span></summary>
                <div className={css.destinationPopover} tabIndex={0} role="region" aria-label={`Détail ${destination.label}`}>
                  <strong>{destination.label}</strong><span>{status.label}</span>
                  <p>{destination.details}</p>
                </div>
              </details> : null}
              {destination.href ? <a className={css.destinationLink} href={destination.href} aria-label={`Voir ${destination.label}`} target="_blank" rel="noopener noreferrer">Voir <span aria-hidden="true">↗</span></a> : null}
              {destination.details ? <p className={css.inlineDetails}>{destination.details}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function PublishExecutionProgress({
  styles,
  scheduling = false,
  publishProgress,
  publishProgressLabel,
  phaseIndex,
  phaseTotal,
  phaseLabel,
  variant = "compact",
  destinations = [],
}: {
  styles: DashboardStyles;
  scheduling?: boolean;
  publishProgress: number;
  publishProgressLabel: string;
  phaseIndex?: number;
  phaseTotal?: number;
  phaseLabel?: string;
  variant?: "compact" | "immersive";
  destinations?: readonly PublicationProgressDestination[];
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

  if (variant === "immersive" && !scheduling) {
    return (
      <div className={css.immersive} data-publication-progress="immersive" data-complete={safeProgress === 100}>
        <PublicationVisualHub progress={safeProgress} progressLabel={publishProgressLabel || "Progression de la publication"} destinations={destinations} completed={safeProgress === 100} phaseSummary={<div className={css.details} data-publication-hub-summary aria-live="polite">
          <div className={css.heading}>
            <h2>{i18nT("publication_en_cours_58f34b8e")}</h2>
          </div>
          {hasPhaseDetails ? <div className={css.phase}>
            <span>{i18nT("etape_13146b48")} {phaseIndex}/{phaseTotal}</span>
            {phaseLabel ? <strong>{phaseLabel}</strong> : null}
          </div> : null}
          <p className={css.status}>{publishProgressLabel || i18nT("publication_en_cours_09ec4187")}</p>
        </div>} />
      </div>
    );
  }

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
