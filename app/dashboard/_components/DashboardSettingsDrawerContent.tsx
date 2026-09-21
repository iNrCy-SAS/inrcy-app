"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import ContactContent from "../settings/_components/ContactContent";
import AccountContent from "../settings/_components/AccountContent";
import GeneralPreferencesContent from "../settings/_components/GeneralPreferencesContent";
import AbonnementContent from "../settings/_components/AbonnementContent";
import LegalContent from "../settings/_components/LegalContent";
import RgpdContent from "../settings/_components/RgpdContent";
import MailsSettingsContent from "../settings/_components/MailsSettingsContent";
import AgendaSettingsContent from "../settings/_components/AgendaSettingsContent";
import InertiaContent from "../settings/_components/InertiaContent";
import BoutiqueContent from "../settings/_components/BoutiqueContent";
import NotificationsSettingsContent from "../settings/_components/NotificationsSettingsContent";
import DocumentsSettingsContent from "../settings/_components/DocumentsSettingsContent";
import ReferralPanel from "./ReferralPanel";
import SiteInrcyPanelBlock from "./SiteInrcyPanelBlock";
import SiteWebPanelBlock from "./SiteWebPanelBlock";
import InstagramPanelBlock from "./InstagramPanelBlock";
import LinkedinPanelBlock from "./LinkedinPanelBlock";
import GmbPanelBlock from "./GmbPanelBlock";
import FacebookPanelBlock from "./FacebookPanelBlock";
import TiktokPanelBlock from "./TiktokPanelBlock";
import YoutubeShortsSettingsContent from "../settings/_components/YoutubeShortsSettingsContent";
import PinterestSettingsContent from "../settings/_components/PinterestSettingsContent";
import XSettingsContent from "../settings/_components/XSettingsContent";
import InrSearchSettingsContent from "../settings/_components/InrSearchSettingsContent";
import InrBadgeSettingsContent from "../settings/_components/InrBadgeSettingsContent";
import StandardSubscriptionContent from "../settings/_components/StandardSubscriptionContent";
import type { DashboardEdition } from "@/lib/dashboardEdition";
import GoogleOAuthConsentBanner from "./GoogleOAuthConsentBanner";
import styles from "../dashboard.module.css";

const PANELS_WITH_LOCAL_GOOGLE_NOTICE = new Set([
  "gmb",
  "site_inrcy",
  "site_web",
  "youtube_shorts",
]);

const MEMORIZED_CHANNEL_PANELS = new Set([
  "inrbadge",
  "mails",
  "site_inrcy",
  "site_web",
  "instagram",
  "linkedin",
  "gmb",
  "facebook",
  "tiktok",
  "youtube_shorts",
  "pinterest",
  "x",
  "inr_search",
]);

function MemorizedPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      hidden={!active}
      aria-hidden={!active}
      data-memorized-channel-panel="true"
    >
      {children}
    </div>
  );
}

type DashboardPanelName =
  | "contact"
  | "profil"
  | "preferences"
  | "inrbadge"
  | "compte"
  | "activite"
  | "ia"
  | "ai_memory"
  | "abonnement"
  | "mails"
  | "agenda"
  | "site_inrcy"
  | "site_web"
  | "instagram"
  | "linkedin"
  | "x"
  | "gmb"
  | "inr_search"
  | "facebook"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest"
  | "legal"
  | "rgpd"
  | "inertie"
  | "boutique"
  | "notifications"
  | "parrainage"
  | "documents";

type DashboardSettingsDrawerContentProps = {
  edition?: DashboardEdition;
  panel: string | null;
  discardRevisions?: Record<string, number>;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  inertiaSnapshot: any;
  openPanel: (name: DashboardPanelName) => void;
  referralName: string;
  referralPhone: string;
  referralEmail: string;
  referralFrom: string;
  referralSubmitting: boolean;
  referralNotice: string | null;
  referralError: string | null;
  onReferralNameChange: (value: string) => void;
  onReferralPhoneChange: (value: string) => void;
  onReferralEmailChange: (value: string) => void;
  onReferralFromChange: (value: string) => void;
  submitReferral: () => void | Promise<void>;
  siteInrcyPanelProps: any;
  siteWebPanelProps: any;
  instagramPanelProps: any;
  linkedinPanelProps: any;
  gmbPanelProps: any;
  facebookPanelProps: any;
  tiktokPanelProps: any;
  inrBadgeSettingsProps: any;
  pinterestAccessEnabled?: boolean;
  xAccessEnabled?: boolean;
  inrSearchAccessEnabled?: boolean;
  inrSearchConnected?: boolean | null;
  inrSearchUrl?: string;
  inrSearchDirectoryEnabled?: boolean | null;
};

export default function DashboardSettingsDrawerContent({
  edition = "standard",
  panel,
  discardRevisions = {},
  onUnsavedChange,
  inertiaSnapshot,
  openPanel,
  referralName,
  referralPhone,
  referralEmail,
  referralFrom,
  referralSubmitting,
  referralNotice,
  referralError,
  onReferralNameChange,
  onReferralPhoneChange,
  onReferralEmailChange,
  onReferralFromChange,
  submitReferral,
  siteInrcyPanelProps,
  siteWebPanelProps,
  instagramPanelProps,
  linkedinPanelProps,
  gmbPanelProps,
  facebookPanelProps,
  tiktokPanelProps,
  inrBadgeSettingsProps,
  pinterestAccessEnabled = true,
  xAccessEnabled = false,
  inrSearchAccessEnabled = false,
  inrSearchConnected = null,
  inrSearchUrl = "",
  inrSearchDirectoryEnabled = null,
}: DashboardSettingsDrawerContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previousPanelRef = useRef<string | null>(panel);
  const panelScrollPositionsRef = useRef(new Map<string, number>());
  const [visitedChannelPanels, setVisitedChannelPanels] = useState<Set<string>>(() => (
    panel && MEMORIZED_CHANNEL_PANELS.has(panel) ? new Set([panel]) : new Set()
  ));

  useEffect(() => {
    if (!panel || !MEMORIZED_CHANNEL_PANELS.has(panel)) return;
    setVisitedChannelPanels((current) => {
      if (current.has(panel)) return current;
      const next = new Set(current);
      next.add(panel);
      return next;
    });
  }, [panel]);

  useLayoutEffect(() => {
    const scrollContainer = contentRef.current?.closest<HTMLElement>(
      '[data-dashboard-settings-drawer-scroll="true"]',
    );
    if (!scrollContainer) return;

    const previousPanel = previousPanelRef.current;
    if (previousPanel && MEMORIZED_CHANNEL_PANELS.has(previousPanel) && previousPanel !== panel) {
      panelScrollPositionsRef.current.set(previousPanel, scrollContainer.scrollTop);
    }

    previousPanelRef.current = panel;
    if (panel && MEMORIZED_CHANNEL_PANELS.has(panel)) {
      scrollContainer.scrollTop = panelScrollPositionsRef.current.get(panel) ?? 0;
    } else if (panel) {
      scrollContainer.scrollTop = 0;
    }
  }, [panel]);

  const shouldKeepPanel = (name: string) => panel === name || visitedChannelPanels.has(name);

  return (
    <div ref={contentRef} className={styles.settingsDrawerContent} data-dashboard-settings-drawer-content="true">
      <GoogleOAuthConsentBanner panel={panel && !PANELS_WITH_LOCAL_GOOGLE_NOTICE.has(panel) ? panel : null} />
      {panel === "contact" && <ContactContent mode="drawer" />}
      {panel === "compte" && (
        <AccountContent
          mode="drawer"
          edition={edition}
          onOpenSubscription={() => openPanel("abonnement")}
          onUnsavedChange={onUnsavedChange}
        />
      )}
      {panel === "preferences" && <GeneralPreferencesContent mode="drawer" onUnsavedChange={onUnsavedChange} />}
      {shouldKeepPanel("inrbadge") ? (
        <MemorizedPanel active={panel === "inrbadge"}>
          <InrBadgeSettingsContent {...inrBadgeSettingsProps} />
        </MemorizedPanel>
      ) : null}
      {panel === "abonnement" && (
        edition === "standard"
          ? <StandardSubscriptionContent onOpenContact={() => openPanel("contact")} />
          : <AbonnementContent mode="drawer" />
      )}
      {panel === "legal" && <LegalContent mode="drawer" />}
      {panel === "rgpd" && <RgpdContent mode="drawer" />}
      {shouldKeepPanel("mails") ? (
        <MemorizedPanel key={`mails:${discardRevisions.mails ?? 0}`} active={panel === "mails"}>
          <MailsSettingsContent onUnsavedChange={panel === "mails" ? onUnsavedChange : undefined} />
        </MemorizedPanel>
      ) : null}
      {panel === "agenda" && <AgendaSettingsContent />}
      {panel === "inertie" && (
        <InertiaContent
          mode="drawer"
          edition={edition}
          snapshot={inertiaSnapshot}
          onOpenBoutique={() => openPanel("boutique")}
        />
      )}
      {panel === "boutique" && (
        <BoutiqueContent
          mode="drawer"
          onOpenInertia={() => openPanel("inertie")}
        />
      )}
      {panel === "parrainage" && (
        <ReferralPanel
          referralName={referralName}
          referralPhone={referralPhone}
          referralEmail={referralEmail}
          referralFrom={referralFrom}
          referralSubmitting={referralSubmitting}
          referralNotice={referralNotice}
          referralError={referralError}
          onReferralNameChange={onReferralNameChange}
          onReferralPhoneChange={onReferralPhoneChange}
          onReferralEmailChange={onReferralEmailChange}
          onReferralFromChange={onReferralFromChange}
          onSubmit={submitReferral}
          onUnsavedChange={onUnsavedChange}
        />
      )}
      {panel === "notifications" && <NotificationsSettingsContent />}
      {panel === "documents" && edition === "founder" ? (
        <DocumentsSettingsContent onUnsavedChange={onUnsavedChange} />
      ) : null}
      {shouldKeepPanel("youtube_shorts") ? (
        <MemorizedPanel key={`youtube_shorts:${discardRevisions.youtube_shorts ?? 0}`} active={panel === "youtube_shorts"}>
          <YoutubeShortsSettingsContent onUnsavedChange={panel === "youtube_shorts" ? onUnsavedChange : undefined} />
        </MemorizedPanel>
      ) : null}
      {shouldKeepPanel("pinterest") && pinterestAccessEnabled ? (
        <MemorizedPanel key={`pinterest:${discardRevisions.pinterest ?? 0}`} active={panel === "pinterest"}>
          <PinterestSettingsContent onUnsavedChange={panel === "pinterest" ? onUnsavedChange : undefined} />
        </MemorizedPanel>
      ) : null}
      {shouldKeepPanel("x") && xAccessEnabled ? (
        <MemorizedPanel active={panel === "x"}>
          <XSettingsContent />
        </MemorizedPanel>
      ) : null}
      {shouldKeepPanel("inr_search") && inrSearchAccessEnabled ? (
        <MemorizedPanel active={panel === "inr_search"}>
          <InrSearchSettingsContent
            active={panel === "inr_search"}
            initialConnected={inrSearchConnected}
            initialPublicUrl={inrSearchUrl}
            initialDirectoryEnabled={inrSearchDirectoryEnabled}
          />
        </MemorizedPanel>
      ) : null}

      {shouldKeepPanel("site_inrcy") ? (
        <MemorizedPanel active={panel === "site_inrcy"}>
          <SiteInrcyPanelBlock panel="site_inrcy" panelProps={siteInrcyPanelProps} />
        </MemorizedPanel>
      ) : null}
      {shouldKeepPanel("site_web") ? (
        <MemorizedPanel active={panel === "site_web"}>
          <SiteWebPanelBlock panel="site_web" panelProps={siteWebPanelProps} />
        </MemorizedPanel>
      ) : null}
      {shouldKeepPanel("instagram") ? (
        <MemorizedPanel active={panel === "instagram"}>
          <InstagramPanelBlock panel="instagram" panelProps={instagramPanelProps} />
        </MemorizedPanel>
      ) : null}
      {shouldKeepPanel("linkedin") ? (
        <MemorizedPanel active={panel === "linkedin"}>
          <LinkedinPanelBlock panel="linkedin" panelProps={linkedinPanelProps} />
        </MemorizedPanel>
      ) : null}
      {shouldKeepPanel("gmb") ? (
        <MemorizedPanel active={panel === "gmb"}>
          <GmbPanelBlock panel="gmb" panelProps={gmbPanelProps} />
        </MemorizedPanel>
      ) : null}
      {shouldKeepPanel("facebook") ? (
        <MemorizedPanel active={panel === "facebook"}>
          <FacebookPanelBlock panel="facebook" panelProps={facebookPanelProps} />
        </MemorizedPanel>
      ) : null}
      {shouldKeepPanel("tiktok") ? (
        <MemorizedPanel active={panel === "tiktok"}>
          <TiktokPanelBlock panel="tiktok" panelProps={tiktokPanelProps} />
        </MemorizedPanel>
      ) : null}
    </div>
  );
}
