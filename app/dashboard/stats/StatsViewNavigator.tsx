"use client";

import { useRef, type ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { adjacentStatsPage, statsSwipeDirection, type StatsNavigationPage, type StatsPanelKey } from "./stats.navigation";
import css from "./statsPanorama.module.css";

export default function StatsViewNavigator({ pages, activeKey, onSelect, summary }: { pages: StatsNavigationPage[]; activeKey: StatsPanelKey; onSelect: (key: StatsPanelKey) => void; summary?: ReactNode }) {
  const t = useTranslations("stats");
  const gesture = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const index = Math.max(0, pages.findIndex(page => page.key === activeKey));
  const page = pages[index] || { key: "all", title: t("vue_globale_08073c33") };
  const previous = adjacentStatsPage(pages, activeKey, -1);
  const next = adjacentStatsPage(pages, activeKey, 1);
  const move = (direction: -1 | 1) => onSelect(adjacentStatsPage(pages, activeKey, direction).key);

  return <nav className={css.navigator} aria-label={t("panorama_navigation")} aria-keyshortcuts="ArrowLeft ArrowRight Home End" tabIndex={0} data-testid="stats-view-navigation"
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
      if (event.key === "Home" || event.key === "End") { event.preventDefault(); onSelect(event.key === "Home" ? "all" : pages.at(-1)?.key || "all"); }
    }}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
      gesture.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerUp={event => {
      const start = gesture.current;
      gesture.current = null;
      if (!start || start.pointerId !== event.pointerId) return;
      const direction = statsSwipeDirection(start, { x: event.clientX, y: event.clientY });
      if (direction) { event.preventDefault(); move(direction); }
    }} onPointerCancel={() => { gesture.current = null; }} onLostPointerCapture={() => { gesture.current = null; }}>
    <div className={css.overviewTabs}>
      <button type="button" className={css.globalShortcut} onClick={() => onSelect("all")} aria-current={activeKey === "all" ? "page" : undefined} aria-label={t("vue_globale_08073c33")} title={t("vue_globale_08073c33")}><GridIcon /><span>{t("vue_globale_08073c33")}</span></button>
      <button type="button" className={css.globalShortcut} onClick={() => onSelect("evolution")} aria-current={activeKey === "evolution" ? "page" : undefined} aria-label={t("panorama_evolution")} title={t("panorama_evolution")}><ChartIcon /><span>{t("panorama_evolution")}</span></button>
    </div>
    <div className={css.navigationCenter}>
      <button type="button" className={css.cycleButton} onClick={() => move(-1)} aria-label={t("panorama_previous", { name: previous.title })} title={previous.title}><span aria-hidden="true">‹</span></button>
      <div className={css.currentPage} aria-live="polite" aria-atomic="true">
        <div className={css.currentTitle}>{page.iconSrc ? <Image src={page.iconSrc} alt="" width={32} height={32} unoptimized draggable={false} /> : <span className={css.globalMark}><ChartIcon /></span>}<h1>{page.title}</h1></div>
        <span className={css.pagePosition}>{t("panorama_page", { current: index + 1, total: pages.length })}</span>
      </div>
      <button type="button" className={css.cycleButton} onClick={() => move(1)} aria-label={t("panorama_next", { name: next.title })} title={next.title}><span aria-hidden="true">›</span></button>
    </div>
    {summary ? <div className={css.navigationSummary}>{summary}</div> : <div className={css.navigationHint}><span>{t("panorama_period")}</span><small>{t("panorama_swipe")}</small></div>}
    <div className={css.pageTrack} aria-hidden="true">{pages.map(item => <span key={item.key} data-active={item.key === page.key || undefined} />)}</div>
  </nav>;
}

export function GridIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>; }
export function ChartIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18M7 17v-4m5 4V9m5 8V5"/><path d="m6 8 4-3 4 1 5-4"/></svg>; }
