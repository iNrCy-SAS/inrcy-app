"use client";

import { useTranslations } from "next-intl";
import DashboardSettingsTabs from "./DashboardSettingsTabs";

export const DASHBOARD_ACCOUNT_PANELS = [
  "compte",
  "abonnement",
  "factures",
  "parrainage",
  "preferences",
  "legal",
  "rgpd",
] as const;

export type DashboardAccountPanel = (typeof DASHBOARD_ACCOUNT_PANELS)[number];

/** The dashboard owns one account drawer and one active content panel. */
export const DASHBOARD_ACCOUNT_PANEL_ID = "dashboard-account-tabpanel";

export function getDashboardAccountTabId(panel: DashboardAccountPanel) {
  return `dashboard-account-tab-${panel}`;
}

export function isDashboardAccountPanel(panel: string | null | undefined): panel is DashboardAccountPanel {
  return DASHBOARD_ACCOUNT_PANELS.some((candidate) => candidate === panel);
}

type DashboardAccountTabsProps = {
  panel: string;
  onSelect: (panel: DashboardAccountPanel) => void;
};

function AccountTabIcon({ panel }: { panel: DashboardAccountPanel }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {panel === "compte" ? <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></> : null}
      {panel === "abonnement" ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h4" /></> : null}
      {panel === "factures" ? <><path d="M6 3h9l4 4v14H6V3Z" /><path d="M14 3v5h5M9 12h7m-7 4h7" /></> : null}
      {panel === "preferences" ? <><path d="M4 6h5m5 0h6M4 12h9m5 0h2M4 18h2m5 0h9" /><circle cx="11.5" cy="6" r="2.5" /><circle cx="15.5" cy="12" r="2.5" /><circle cx="8.5" cy="18" r="2.5" /></> : null}
      {panel === "legal" ? <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></> : null}
      {panel === "rgpd" ? <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m8.5 11.5 2.5 2.5 4.5-5" /></> : null}
      {panel === "parrainage" ? <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13M12 8H8a2.5 2.5 0 1 1 2.4-3.2L12 8Zm0 0h4a2.5 2.5 0 1 0-2.4-3.2L12 8Z" /></> : null}
    </svg>
  );
}

export default function DashboardAccountTabs({ panel, onSelect }: DashboardAccountTabsProps) {
  const t = useTranslations("dashboard.accountTabs");
  const labels: Record<DashboardAccountPanel, string> = {
    compte: t("compte"),
    abonnement: t("abonnement"),
    factures: t("factures"),
    preferences: t("preferences"),
    legal: t("legal"),
    rgpd: t("rgpd"),
    parrainage: t("parrainage"),
  };

  if (!isDashboardAccountPanel(panel)) return null;

  return (
    <DashboardSettingsTabs
      panel={panel}
      onSelect={onSelect}
      tabs={DASHBOARD_ACCOUNT_PANELS.map((tabPanel) => ({ panel: tabPanel, label: labels[tabPanel], icon: <AccountTabIcon panel={tabPanel} /> }))}
      panelId={DASHBOARD_ACCOUNT_PANEL_ID}
      getTabId={getDashboardAccountTabId}
      label={t("compte")}
      scope="account"
    />
  );
}
