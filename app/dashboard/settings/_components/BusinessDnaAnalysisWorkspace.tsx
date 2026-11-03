"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { BusinessDnaDashboardChannelAvailability } from "@/lib/businessDnaChannelAvailability";
import { PUBLISH_CHANNEL_IDENTITY } from "../../booster/publier/components/publishChannelIdentity";
import styles from "./BusinessDnaAnalysisWorkspace.module.css";

type Props = {
  channels: readonly BusinessDnaDashboardChannelAvailability[];
  selectedChannels: ReadonlySet<string>;
  onToggleChannel: (key: string) => void;
  documents: ReactNode;
  animation: ReactNode;
  completionScore: number;
  analyzing: boolean;
  progress: number;
  quota: { limit: number; remaining: number; resetAt: string } | null;
  summary: { analyzedAt: string; changedFields: string[]; addedItems: number; sources: { key: string; label: string; status: string; itemCount: number }[] } | null;
  error: string;
  busy: boolean;
  hasSources: boolean;
  selective: boolean;
  onAnalyze: () => void;
  onSchedule: () => void;
  onReset: () => void;
};

export default function BusinessDnaAnalysisWorkspace({
  channels, selectedChannels, onToggleChannel, documents, animation, completionScore,
  analyzing, progress, quota, summary, error, busy, hasSources, selective,
  onAnalyze, onSchedule, onReset,
}: Props) {
  const t = useTranslations("dashboard.aiMemory");
  const moduleT = useTranslations("dashboard.moduleCards");
  const reportReady = Boolean(summary?.analyzedAt);
  const launchDisabled = busy || analyzing || !hasSources || quota?.remaining === 0;

  return (
    <section className={styles.workspace} data-business-dna-channel-analysis data-analysis-running={analyzing ? "true" : "false"}>
      <aside className={styles.sources} aria-label={t("analysisSourcesTitle")}>
        <div className={styles.sourceScroll}>
          <section className={styles.channelSection}>
          <header className={styles.sourceHeading}><h2>{t("analysisChannelsTitle")}</h2></header>
          <div className={styles.channelGrid} data-business-dna-channel-states aria-label={t("analysisChannelsAria")}>
            {channels.map((channel) => {
              const selectable = channel.status === "connected" && channel.analyzable;
              const checked = selectable && selectedChannels.has(channel.key);
              const name = moduleT(`${channel.key}.name`);
              const status = channel.status === "needs_reconnect" ? t("analysisChannelReconnect") : selectable ? t("analysisChannelConnected") : t("analysisChannelDisconnected");
              return (
                <label key={channel.key} className={styles.channel} data-selected={checked} data-channel-key={channel.key} data-channel-status={channel.status} data-channel-analyzable={channel.analyzable ? "true" : "false"} aria-disabled={!selectable || busy || analyzing}>
                  <input type="checkbox" aria-label={name} checked={checked} disabled={!selectable || busy || analyzing} onChange={() => onToggleChannel(channel.key)} />
                  <img src={PUBLISH_CHANNEL_IDENTITY[channel.key].icon} alt="" aria-hidden="true" width={30} height={30} loading="eager" decoding="sync" />
                  <span><strong>{name}</strong><small>{status}</small></span>
                </label>
              );
            })}
          </div>
          </section>
          <div className={styles.documents} data-analysis-documents>{documents}</div>
        </div>
      </aside>

      <div className={styles.result} data-has-report={reportReady ? "true" : "false"}>
        <header className={styles.resultHeading}><span>{analyzing ? t("analysisRunning") : reportReady ? t("analysisReportTitle") : ""}</span><span className={styles.score} data-dna-score-summary title={t("scoreHelp")}>{completionScore}%</span></header>
        <div className={styles.resultBody} aria-live="polite" aria-busy={analyzing}>
          <h2 className={styles.dnaTitle}>{t("title")}</h2>
          <div className={styles.animation}>{animation}</div>
          {analyzing ? (
            <div className={styles.progress} data-analysis-progress data-running="true" role="progressbar" aria-label={t("analysisRunning")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <span><i style={{ width: `${progress}%` }} /></span><strong>{progress}%</strong>
              <p>{t(selective ? "analysisSelectedRunHint" : "analysisBackgroundHint")}</p>
            </div>
          ) : null}
          {summary ? (
            <div className={styles.report}>
              {reportReady ? <strong>{summary.changedFields.length ? t("analysisSaved", { fields: summary.changedFields.length, items: summary.addedItems }) : t("analysisNoChange")}</strong> : null}
              <ul>{summary.sources.map((source) => <li key={source.key}><span><i aria-hidden="true">{source.status === "analyzed" ? "✓" : "!"}</i>{source.label}</span><small>{source.status === "analyzed" ? t("analysisSourceItems", { count: source.itemCount }) : t("analysisSourceUnavailable")}</small></li>)}</ul>
            </div>
          ) : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>
      </div>

      <footer className={styles.footer} data-analysis-action-group>
        <div className={styles.quota}>
          <span className={styles.quotaIcon} aria-hidden="true">◷</span>
          <div><strong>{quota ? t("analysisQuota", { remaining: quota.remaining, limit: quota.limit }) : t("analysisQuotaLoading")}</strong></div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.schedule} disabled={busy || analyzing} onClick={onSchedule}>{t("analysisScheduleButton")}</button>
          <button type="button" className={styles.launch} disabled={launchDisabled} aria-busy={analyzing} onClick={onAnalyze}>{analyzing ? t("analysisRunning") : quota?.remaining === 0 ? t("analysisQuotaReachedButton") : t("analysisButton")}</button>
        </div>
        <div className={styles.footerMeta}>
          {!hasSources && !analyzing ? <small className={styles.emptyHint}>{t("analysisNoSourcesHint")}</small> : null}
          <button type="button" className={styles.reset} disabled={busy || analyzing} onClick={onReset}>{t("analysisResetButton")}</button>
        </div>
      </footer>
    </section>
  );
}
