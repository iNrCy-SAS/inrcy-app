"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import type { CubeKey } from "./stats.shared.types";
import css from "./statsPanorama.module.css";
import type { StatsTrend } from "./stats.trends";

export type StatsOverviewChannel = {
  key: CubeKey; title: string; accountLabel?: string; subtitle: string; iconSrc: string;
  status: "connected" | "pending" | "disconnected" | "needs_update";
  opportunities: string; opportunityValue: number | null; visibilityValue: number | null; revenue: string;
  actionLabel: string; actionTitle: string; actionHref: string; premiumLocked: boolean;
  trend?: StatsTrend | null;
};
type Props = {
  channels: StatsOverviewChannel[]; ready: boolean;
  connectedCount: string;
  onOpenChannel: (key: CubeKey) => void; onRunAction: (channel: StatsOverviewChannel) => void;
};

const CHANNEL_COLORS: Record<CubeKey, string> = {
  inrbadge: "#a797ff", site_web: "#40cee8", gmb: "#78a9ff", inr_search: "#ba8aff",
  facebook: "#5a9cff", instagram: "#f58abe", threads: "#c7d1e6", linkedin: "#53baff",
  tiktok: "#5edbd8", youtube_shorts: "#ff8e96", pinterest: "#f7799f", x: "#b7c8e5", mails: "#edb977",
};

export default function StatsOverview({ channels, ready, connectedCount, onOpenChannel, onRunAction }: Props) {
  const t = useTranslations("stats");
  const locale = useLocale();
  const total = channels.reduce((sum, channel) => sum + Math.max(0, channel.visibilityValue || 0), 0);
  const percentFormatter = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const formatPercent = (value: number) => percentFormatter.format(value);
  const share = (channel: StatsOverviewChannel) => ready && channel.visibilityValue !== null && total > 0 ? channel.visibilityValue / total : null;
  const stateLabel = (channel: StatsOverviewChannel) => channel.status === "connected" ? t("connecte_ce09957c") : channel.status === "needs_update" ? t("a_reconnecter_bb56a9d2") : channel.status === "pending" ? t("verification_bb27abfb") : t("deconnecte_3a67fd80");

  return <section className={css.overview} aria-label={t("vue_globale_inr_stats_db5feb84")} aria-busy={!ready} data-testid="stats-global-overview">
    <div className={css.channelsHeading}>
      <h2>{t("panorama_channels")}</h2>
      <span className={css.connectedCount}><span aria-hidden="true"/>{t("panorama_connected", { count: connectedCount })}</span>
    </div>
    <div className={css.channelGrid} style={{ "--rows": Math.ceil(channels.length / 4), "--rows-wide": Math.ceil(channels.length / 5) } as CSSProperties}>
      {channels.map(channel => <article key={channel.key} className={css.channelCard} data-state={channel.status} data-channel={channel.key} style={{ "--channel-color": CHANNEL_COLORS[channel.key] } as CSSProperties}>
        <button type="button" className={css.cardOpen} onClick={() => onOpenChannel(channel.key)} aria-label={t("voir_le_detail_value_ba79238d", { value0: channel.title })}>
          <div className={css.cardHeading}><span className={css.channelLogo}><Image src={channel.iconSrc} alt="" width={38} height={38} unoptimized /></span><div><h3>{channel.title}</h3><span className={css.accountLabel}>{channel.accountLabel || channel.subtitle}</span></div><svg className={css.openArrow} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></div>
          <dl className={css.cardMetrics}><div><dt>{t("opportunites_0dbfa3c5")}</dt><dd>{channel.opportunities}</dd></div><div><dt>{t("ca_potentiel_fc9eeae4")}</dt><dd>{channel.revenue}</dd></div></dl>
          <div className={css.cardInsight}>
            <div className={css.contribution} title={t("panorama_visibility_basis")}><span>{t("panorama_contribution")}</span><b>{share(channel) !== null ? formatPercent(share(channel)!) : "—"}</b></div>
          </div>
        </button>
        <footer className={css.cardFooter}>
          <span className={css.connectionStatus}><span aria-hidden="true"/>{stateLabel(channel)}</span>
          <button type="button" className={css.channelAction} disabled={channel.premiumLocked || channel.status === "pending"} title={channel.actionTitle} onClick={() => onRunAction(channel)}><span>{channel.actionLabel}</span>{channel.premiumLocked ? <span aria-hidden="true">🔒</span> : <span aria-hidden="true">↗</span>}</button>
        </footer>
      </article>)}
    </div>
  </section>;
}

export function StatsOverviewMetrics({ opportunities, potentialRevenue, capturedLeads, capturedLabel }: { opportunities: string; potentialRevenue: string; capturedLeads: string; capturedLabel?: string }) {
  const t = useTranslations("stats");
  return <div className={css.summaryMetrics}>
    <div data-tone="cyan" title={t("panorama_captured_hint")}><MetricIcon kind="contacts" /><span><small>{capturedLabel || t("demandes_captees_30_j_a45db939")}</small><b>{capturedLeads}</b></span></div>
    <div data-tone="violet" title={t("panorama_opportunity_hint")}><MetricIcon kind="opportunity" /><span><small>{t("opportunites_0dbfa3c5")}</small><b>{opportunities}</b></span></div>
    <div data-tone="gold"><MetricIcon kind="revenue" /><span><small>{t("ca_potentiel_fc9eeae4")}</small><b>{potentialRevenue}</b></span></div>
  </div>;
}

function MetricIcon({ kind }: { kind: "contacts" | "opportunity" | "revenue" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "contacts" ? <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3V11.5A7.5 7.5 0 0 1 9.5 4H13"/><path d="M18 2v6m-3-3h6M7 10h5m-5 4h8"/></> : kind === "opportunity" ? <><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 .8-1 1.5-1 2H9c0-.5 0-1.2-1-2Z"/><path d="M12 6v4m-2-2h4"/></> : <><path d="M18 5a7 7 0 1 0 0 14M3 10h12M3 14h10"/><path d="m18 12 3-3m-3 0h3v3"/></>}</svg>;
}
