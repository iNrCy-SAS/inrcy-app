"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useLocale } from "next-intl";
import type { DashboardFluxBubbleData } from "./DashboardFluxBubble";
import DashboardModulesCard from "./DashboardModulesCard";
import DashboardStandardModulesCard from "./DashboardStandardModulesCard";
import { getChannelTone } from "./dashboard-channel-presentation";
import { DASHBOARD_TOOLS_ANCHOR_ID } from "../dashboard.scroll";
import styles from "./DashboardExperience.module.css";

const DashboardChannelsModal = dynamic(() => import("./DashboardChannelsModal"), { ssr: false });

type DashboardPanelName = Parameters<typeof DashboardModulesCard>[0]["openPanel"] extends (panel: infer P) => void ? P : never;

type Props = {
  fluxBubbleItems: DashboardFluxBubbleData[];
  goToModule: (path: string) => void;
  openPanel: (panel: DashboardPanelName) => void;
  onOpenChannelsHelp: () => void;
  onOpenStats?: () => void;
  onOpenBoosterPublish?: () => void;
  onOpenBoosterStats?: () => void;
  standardMode?: boolean;
  isAdmin?: boolean;
  inrAgentEnabled?: boolean;
};

export default function DashboardChannelsSection({ fluxBubbleItems, goToModule, openPanel, onOpenChannelsHelp, onOpenStats, onOpenBoosterPublish, onOpenBoosterStats, standardMode = false, inrAgentEnabled = true }: Props) {
  const [channelsOpen, setChannelsOpen] = useState(false);
  const locale = useLocale();
  const isFrench = locale.startsWith("fr");
  const connected = fluxBubbleItems.filter((item) => getChannelTone(item) === "connected").length;
  const total = fluxBubbleItems.length;

  return (
    <section className={styles.experience}>
      <div className={styles.hubRow}>
        <span className={styles.hubBeam} aria-hidden="true" />
        <button
          className={styles.channelsHub}
          type="button"
          onClick={() => setChannelsOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={channelsOpen}
          aria-label={`${isFrench ? "Mes canaux" : "My channels"}, ${connected}/${total} ${isFrench ? "connectés" : "connected"}`}
          data-testid="dashboard-channels-hub"
        >
          <span className={styles.hubTiles} aria-hidden="true"><i /><i /><i /><i /></span>
          <strong>{isFrench ? "Mes canaux" : "My channels"}</strong>
          <span className={styles.hubCount}><i aria-hidden="true" />{connected}<small>/{total}</small></span>
        </button>
      </div>
      <div id={DASHBOARD_TOOLS_ANCHOR_ID} className={styles.toolsAnchor}>
        {standardMode ? (
          <DashboardStandardModulesCard goToModule={goToModule} onOpenPremium={() => openPanel("abonnement")} onOpenStats={onOpenStats} onOpenBoosterPublish={onOpenBoosterPublish} onOpenBoosterStats={onOpenBoosterStats} adsPilotEnabled inrAgentEnabled={inrAgentEnabled} />
        ) : (
          <DashboardModulesCard goToModule={goToModule} openPanel={openPanel} onOpenStats={onOpenStats} onOpenBoosterPublish={onOpenBoosterPublish} onOpenBoosterStats={onOpenBoosterStats} adsPilotEnabled inrAgentEnabled={inrAgentEnabled} />
        )}
      </div>
      {channelsOpen ? <DashboardChannelsModal items={fluxBubbleItems} summary={{ connected, total }} onClose={() => setChannelsOpen(false)} onOpenHelp={onOpenChannelsHelp} /> : null}
    </section>
  );
}
