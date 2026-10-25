"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import DashboardMobileSelect from "./DashboardMobileSelect";
import styles from "./DashboardAccountTabs.module.css";

type DashboardSettingsTab<TPanel extends string> = {
  panel: TPanel;
  label: string;
  icon: ReactNode;
};

type DashboardSettingsTabsProps<TPanel extends string> = {
  panel: TPanel;
  onSelect: (panel: TPanel) => void;
  tabs: readonly DashboardSettingsTab<TPanel>[];
  panelId: string;
  getTabId: (panel: TPanel) => string;
  label: string;
  scope: "account" | "boutique";
};

/** Shared presentation only: routing and unsaved-changes guards remain upstream. */
export default function DashboardSettingsTabs<TPanel extends string>({
  panel,
  onSelect,
  tabs,
  panelId,
  getTabId,
  label,
  scope,
}: DashboardSettingsTabsProps<TPanel>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // The routed panel is the source of truth, even when an exit guard is cancelled.
  const select = (nextPanel: TPanel) => {
    if (nextPanel !== panel) onSelect(nextPanel);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey || tabs.length === 0) return;

    let nextIndex: number;
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case "ArrowRight":
        nextIndex = (index + 1) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    buttonRefs.current[nextIndex]?.focus({ preventScroll: true });
    select(tabs[nextIndex].panel);
  };

  return (
    <>
      <nav
      className={`${styles.tabs} ${styles.desktopNavigation}`}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      data-dashboard-account-tabs={scope === "account" ? "true" : undefined}
      data-dashboard-boutique-tabs={scope === "boutique" ? "true" : undefined}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.panel}
          ref={(button) => { buttonRefs.current[index] = button; }}
          id={getTabId(tab.panel)}
          type="button"
          role="tab"
          className={styles.tab}
          aria-selected={panel === tab.panel}
          aria-controls={panelId}
          tabIndex={panel === tab.panel ? 0 : -1}
          onClick={() => select(tab.panel)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
      </nav>
      <DashboardMobileSelect
        value={panel}
        options={tabs.map((tab) => ({ value: tab.panel, label: tab.label, icon: tab.icon }))}
        onChange={select}
        ariaLabel={label}
        controls={panelId}
      />
    </>
  );
}
