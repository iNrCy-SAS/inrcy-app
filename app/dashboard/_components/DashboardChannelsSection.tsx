"use client";

import DashboardChannelsModal from "./DashboardChannelsModal";
import type { ReactNode } from "react";
import type { DashboardOverviewMetrics } from "./DashboardModulesCard";
import type { DashboardFluxBubbleData } from "./DashboardFluxBubble";
import DashboardModulesCard from "./DashboardModulesCard";
import DashboardStandardModulesCard from "./DashboardStandardModulesCard";
import { getChannelTone } from "./dashboard-channel-presentation";
import { DASHBOARD_TOOLS_ANCHOR_ID } from "../dashboard.scroll";
import styles from "./DashboardExperience.module.css";

type DashboardPanelName = Parameters<typeof DashboardModulesCard>[0]["openPanel"] extends (panel: infer P) => void ? P : never;

type Props = {
  cockpit: ReactNode;
  generator: ReactNode;
  overview: DashboardOverviewMetrics;
  fluxBubbleItems: DashboardFluxBubbleData[];
  goToModule: (path: string) => void;
  openPanel: (panel: DashboardPanelName) => void;
  onOpenChannelsHelp: () => void;
  onOpenStats?: () => void;
  onOpenGeneratorSettings?: () => void;
  onOpenBoosterPublish?: () => void;
  onOpenBoosterStats?: () => void;
  standardMode?: boolean;
  isAdmin?: boolean;
  inrAgentEnabled?: boolean;
  channelsOpen: boolean;
  onCloseChannels: () => void;
  initialSelectedKey?: string;
  renderSelected?: Parameters<typeof import("./DashboardChannelsModal").default>[0]["renderSelected"];
};

export default function DashboardChannelsSection({ cockpit, generator, overview, fluxBubbleItems, goToModule, openPanel, onOpenChannelsHelp, onOpenStats, onOpenGeneratorSettings, onOpenBoosterPublish, onOpenBoosterStats, standardMode = false, inrAgentEnabled = true, channelsOpen, onCloseChannels, initialSelectedKey, renderSelected }: Props) {
  const connected = fluxBubbleItems.filter((item) => getChannelTone(item) === "connected").length;
  const total = fluxBubbleItems.length;

  return (
    <section className={styles.experience}>
      <div id={DASHBOARD_TOOLS_ANCHOR_ID} className={styles.toolsAnchor}>
        {standardMode ? (
          <DashboardStandardModulesCard cockpit={cockpit} generator={generator} overview={overview} goToModule={goToModule} onOpenPremium={() => openPanel("abonnement")} onOpenStats={onOpenStats} onOpenGeneratorSettings={onOpenGeneratorSettings} onOpenBoosterPublish={onOpenBoosterPublish} onOpenBoosterStats={onOpenBoosterStats} adsPilotEnabled inrAgentEnabled={inrAgentEnabled} />
        ) : (
          <DashboardModulesCard cockpit={cockpit} generator={generator} overview={overview} goToModule={goToModule} openPanel={openPanel} onOpenStats={onOpenStats} onOpenGeneratorSettings={onOpenGeneratorSettings} onOpenBoosterPublish={onOpenBoosterPublish} onOpenBoosterStats={onOpenBoosterStats} adsPilotEnabled inrAgentEnabled={inrAgentEnabled} />
        )}
      </div>
      {channelsOpen ? <DashboardChannelsModal items={fluxBubbleItems} summary={{ connected, total }} onClose={onCloseChannels} initialSelectedKey={initialSelectedKey} renderSelected={renderSelected} onOpenHelp={onOpenChannelsHelp} /> : null}
    </section>
  );
}
