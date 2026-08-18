import styles from "./dashboard.module.css";
import type { ModuleStatus } from "./dashboard.types";
import { DRAWER_PANELS, DRAWER_TITLES } from "./dashboard.constants";
import { getDashboardStatusLabel, type DashboardCopy } from "@/i18n/dashboard";

export function statusLabel(s: ModuleStatus, copy: DashboardCopy) {
  return getDashboardStatusLabel(s, copy);
}

export function statusClass(s: ModuleStatus) {
  if (s === "connected") return styles.badgeOk;
  if (s === "available" || s === "reconnect") return styles.badgeWarn;
  return styles.badgeSoon;
}

export function getDrawerTitle(panel: string | null, copy: DashboardCopy) {
  const translatedTitle = panel
    ? (copy.drawer.titles as Record<string, string>)[panel] || ""
    : "";
  if (translatedTitle) return translatedTitle;
  if (!panel) return "";
  return DRAWER_TITLES[panel as keyof typeof DRAWER_TITLES] ?? "";
}

export function isDrawerPanel(panel: string | null) {
  return !!panel && DRAWER_PANELS.has(panel);
}

export function getNormalizedSiteDomain(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
