import type { CubeKey } from "./stats.shared.types.ts";

export type StatsPanelKey = "all" | "evolution" | CubeKey;
export type StatsNavigationPage = { key: StatsPanelKey; title: string; iconSrc?: string };

export function buildStatsNavigationPages(channels: readonly { key: CubeKey; title: string }[], globalTitle: string, icons: Partial<Record<CubeKey, string>> = {}, evolutionTitle?: string): StatsNavigationPage[] {
  return [{ key: "all", title: globalTitle }, ...(evolutionTitle ? [{ key: "evolution" as const, title: evolutionTitle }] : []), ...channels.map(channel => ({ key: channel.key, title: channel.title, iconSrc: icons[channel.key] }))];
}

export function adjacentStatsPage(pages: readonly StatsNavigationPage[], active: StatsPanelKey, direction: -1 | 1): StatsNavigationPage {
  if (!pages.length) return { key: "all", title: "" };
  const index = Math.max(0, pages.findIndex(page => page.key === active));
  return pages[(index + direction + pages.length) % pages.length];
}

export function statsSwipeDirection(start: { x: number; y: number }, end: { x: number; y: number }): -1 | 1 | null {
  const horizontal = end.x - start.x;
  const vertical = end.y - start.y;
  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical) || Math.abs(horizontal) < 56 || Math.abs(horizontal) <= Math.abs(vertical) * 1.5) return null;
  return horizontal < 0 ? 1 : -1;
}
