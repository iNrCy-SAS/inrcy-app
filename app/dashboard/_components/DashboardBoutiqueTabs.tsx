"use client";

import { useTranslations } from "next-intl";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import DashboardSettingsTabs from "./DashboardSettingsTabs";

export const DASHBOARD_BOUTIQUE_PANELS = ["boutique", "inertie"] as const;
export type DashboardBoutiquePanel = (typeof DASHBOARD_BOUTIQUE_PANELS)[number];
export const DASHBOARD_BOUTIQUE_TABS = ["boutique", "inertie", "orders"] as const;
export type DashboardBoutiqueTab = (typeof DASHBOARD_BOUTIQUE_TABS)[number];
export const DASHBOARD_BOUTIQUE_PANEL_ID = "dashboard-boutique-tabpanel";

export function getDashboardBoutiqueTabId(tab: DashboardBoutiqueTab) {
  return `dashboard-boutique-tab-${tab}`;
}

export function isDashboardBoutiquePanel(panel: string | null | undefined): panel is DashboardBoutiquePanel {
  return DASHBOARD_BOUTIQUE_PANELS.some((candidate) => candidate === panel);
}

type DashboardBoutiqueTabsProps = {
  panel: string;
  view?: "products" | "orders";
  onSelect: (tab: DashboardBoutiqueTab) => void;
};

function BoutiqueTabIcon({ panel }: { panel: DashboardBoutiqueTab }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {panel === "boutique" ? <><path d="M5 8h14l2 5c0 2-3 3-4.5 1.5C15 16 12 16 10.5 14.5C9 16 6 16 4.5 14.5C3 15.5 2 14 3 12l2-4Z" /><path d="M5 8V4h14v4M5 16v5h14v-5M10 21v-5h4v5" /></> : null}
      {panel === "inertie" ? <><path d="m13.5 3-8 10H11l-1 8 8-11h-5.5l1-7Z" /><path d="M5 5 3 3M19 19l2 2" /></> : null}
      {panel === "orders" ? <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 7h6M9 11h6M9 15h4" /></> : null}
    </svg>
  );
}

export default function DashboardBoutiqueTabs({ panel, view = "products", onSelect }: DashboardBoutiqueTabsProps) {
  const t = useDashboardI18n();
  const settingsT = useTranslations("settings");
  if (!isDashboardBoutiquePanel(panel)) return null;
  const activeTab = panel === "boutique" && view === "orders" ? "orders" : panel;

  return (
    <DashboardSettingsTabs
      panel={activeTab}
      onSelect={onSelect}
      tabs={DASHBOARD_BOUTIQUE_TABS.map((tabPanel) => ({
        panel: tabPanel,
        label: tabPanel === "boutique" ? t.userMenu.shop : tabPanel === "inertie" ? t.userMenu.inertia : settingsT("historique_des_commandes_3b9f0e3d"),
        icon: <BoutiqueTabIcon panel={tabPanel} />,
      }))}
      panelId={DASHBOARD_BOUTIQUE_PANEL_ID}
      getTabId={getDashboardBoutiqueTabId}
      label={t.userMenu.shop}
      scope="boutique"
    />
  );
}
