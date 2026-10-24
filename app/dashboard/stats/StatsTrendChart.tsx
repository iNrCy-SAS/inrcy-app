"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { statsTrendSegments, statsWeeklyChange, type StatsTrend } from "./stats.trends";
import css from "./statsPanorama.module.css";

export default function StatsTrendChart({ trend, compact = false, comparison = true, fractionDigits = 0, zeroBased = true, filled = false, unitLabelKey }: { trend: StatsTrend; compact?: boolean; comparison?: boolean; fractionDigits?: number; zeroBased?: boolean; filled?: boolean; unitLabelKey?: string }) {
  const locale = useLocale();
  const t = useTranslations("stats");
  const id = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotSize, setPlotSize] = useState({ width: 560, height: 170 });
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(100, Math.round(entry.contentRect.width));
      const height = Math.max(60, Math.round(entry.contentRect.height));
      setPlotSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const points = trend.points;
  const index = hoverIndex === null ? points.length - 1 : Math.min(hoverIndex, points.length - 1);
  const selected = points[index];
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: fractionDigits });
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(points[0].date.slice(0, 4) !== points.at(-1)!.date.slice(0, 4) ? { year: "numeric" as const } : {}), timeZone: "UTC" });
  const largest = Math.max(1, ...points.map(point => point.value));
  const smallest = Math.min(...points.map(point => point.value));
  const padding = zeroBased ? 0 : Math.max(largest * .01, (largest - smallest) * .15);
  const minimum = zeroBased ? 0 : Math.max(0, smallest - padding);
  const maximum = largest + padding;
  const start = Date.parse(points[0].date);
  const duration = Math.max(86_400_000, Date.parse(points.at(-1)!.date) - start);
  const x = (day: string) => 46 + (Date.parse(day) - start) / duration * (plotSize.width - 60);
  const baseline = plotSize.height - 25;
  const y = (value: number) => baseline - (value - minimum) / (maximum - minimum) * (plotSize.height - 39);
  const change = comparison ? statsWeeklyChange(points) : null;
  const changeText = change === null ? null : new Intl.NumberFormat(locale, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 1 }).format(change);

  return <figure className={css.trendChart} data-compact={compact || undefined} tabIndex={0} onKeyDown={event => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setHoverIndex(Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1))));
    }
  }}>
    <figcaption><span>{t("panorama_evolution")} · {t(trend.metricLabelKey)}</span>{changeText ? <b data-direction={change! < 0 ? "down" : change! > 0 ? "up" : "flat"} title={t("panorama_weekly_compare")}>{change! < 0 ? "↘" : change! > 0 ? "↗" : "→"} {changeText}</b> : null}</figcaption>
    <div className={css.trendPointCard} aria-live="polite"><span>{date.format(new Date(`${selected.date}T00:00:00Z`))}</span><strong>{number.format(selected.value)}</strong><small>{t(unitLabelKey || trend.metricLabelKey)}</small></div>
    <div ref={plotRef} className={css.trendPlot} data-stats-trend-plot>
    <svg viewBox={`0 0 ${plotSize.width} ${plotSize.height}`} role="img" aria-label={`${t("panorama_evolution")} · ${t(trend.metricLabelKey)}`} onPointerLeave={() => setHoverIndex(null)}>
      <defs><linearGradient id={`${id}-stroke`} x1="0" x2="1"><stop stopColor="#50d4ed"/><stop offset="1" stopColor="#b58cff"/></linearGradient><linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#5bc8e7" stopOpacity=".22"/><stop offset="1" stopColor="#9d7adf" stopOpacity=".015"/></linearGradient></defs>
      {[0, .5, 1].map(step => <g key={step}><line x1="46" x2={plotSize.width - 14} y1={y(minimum + (maximum - minimum) * step)} y2={y(minimum + (maximum - minimum) * step)} stroke="#89a5d11b" strokeDasharray="3 5"/><text x="39" y={y(minimum + (maximum - minimum) * step) + 3} fill="#8298b7" fontSize="10" textAnchor="end">{number.format(minimum + (maximum - minimum) * step)}</text></g>)}
      {filled ? statsTrendSegments(points).map((segment, i) => <polygon key={`area-${i}`} points={`${x(segment[0].date)},${baseline} ${segment.map(point => `${x(point.date)},${y(point.value)}`).join(" ")} ${x(segment.at(-1)!.date)},${baseline}`} fill={`url(#${id}-area)`}/>) : null}
      {statsTrendSegments(points).map((segment, i) => <polyline key={i} points={segment.map(point => `${x(point.date)},${y(point.value)}`).join(" ")} fill="none" stroke={`url(#${id}-stroke)`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>)}
      {hoverIndex !== null ? <line x1={x(selected.date)} x2={x(selected.date)} y1="10" y2={baseline} stroke="#b8c8ed50" strokeDasharray="3 4"/> : null}
      {points.map((point, i) => <g key={point.date}>
        {points.length < 60 || i % Math.ceil(points.length / 20) === 0 || i === index ? <circle cx={x(point.date)} cy={y(point.value)} r={hoverIndex !== null && i === index ? 4.5 : 2} fill={hoverIndex !== null && i === index ? "#d8c7ff" : "#77cbea"}/> : null}
        <rect x={x(point.date) - Math.max(1, (plotSize.width - 60) / points.length / 2)} y="8" width={Math.max(2, (plotSize.width - 60) / points.length)} height={Math.max(1, baseline - 4)} fill="transparent" onPointerEnter={() => setHoverIndex(i)} onClick={() => setHoverIndex(i)}/>
      </g>)}
      <text x="46" y={plotSize.height - 5} fill="#8298b7" fontSize="10">{date.format(new Date(`${points[0].date}T00:00:00Z`))}</text>
      <text x={plotSize.width - 14} y={plotSize.height - 5} fill="#8298b7" fontSize="10" textAnchor="end">{date.format(new Date(`${points.at(-1)!.date}T00:00:00Z`))}</text>
    </svg>
    </div>
    {!compact && changeText ? <p>{t("panorama_weekly_compare")}</p> : null}
  </figure>;
}
