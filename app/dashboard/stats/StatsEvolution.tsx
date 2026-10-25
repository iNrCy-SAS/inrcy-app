"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import DashboardMobileSelect from "../_components/DashboardMobileSelect";
import StatsMeasuredEvolution from "./StatsMeasuredEvolution";
import StatsVisibilityIndex from "./StatsVisibilityIndex";
import type { CubeKey } from "./stats.shared.types";
import css from "./statsPanorama.module.css";

type Props = { enabled: boolean; accountId: string; refreshKey: number; channels: Array<{ key: CubeKey; title: string }>; ready: boolean };
export default function StatsEvolution({ enabled, accountId, refreshKey, channels, ready }: Props) {
  const t = useTranslations("stats");
  const [view, setView] = useState<"index" | "measured">("measured");
  const [historyRevision, setHistoryRevision] = useState(0);
  const onHistoryLoaded = useCallback(() => setHistoryRevision(value => value + 1), []);
  const tabs = <div className={css.evolutionViewNavigation}>
    <div className={css.evolutionViewTabs} role="group" aria-label={t("panorama_evolution")}>
      <button type="button" aria-pressed={view === "measured"} onClick={() => setView("measured")}>{t("visibility_index_measured")}</button>
      <button type="button" aria-pressed={view === "index"} onClick={() => setView("index")}>{t("visibility_index_title")}</button>
    </div>
    <DashboardMobileSelect
      value={view}
      options={[{ value: "measured", label: t("visibility_index_measured") }, { value: "index", label: t("visibility_index_title") }]}
      onChange={setView}
      ariaLabel={t("panorama_evolution")}
    />
  </div>;
  return <div className={css.evolutionHost} hidden={!enabled}>
    <StatsMeasuredEvolution enabled={enabled && view === "measured"} accountId={accountId} refreshKey={refreshKey} channels={channels} ready={ready} tabs={tabs} onHistoryLoaded={onHistoryLoaded} />
    <StatsVisibilityIndex enabled={enabled && view === "index"} accountId={accountId} refreshKey={refreshKey} ready={ready} channels={channels} tabs={tabs} historyRevision={historyRevision} />
  </div>;
}
