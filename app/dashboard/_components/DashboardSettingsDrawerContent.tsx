"use client";

import { useLayoutEffect, useRef } from "react";

import ContactContent from "../settings/_components/ContactContent";
import AccountContent from "../settings/_components/AccountContent";
import GeneralPreferencesContent from "../settings/_components/GeneralPreferencesContent";
import AbonnementContent from "../settings/_components/AbonnementContent";
import LegalContent from "../settings/_components/LegalContent";
import RgpdContent from "../settings/_components/RgpdContent";
import AgendaSettingsContent from "../settings/_components/AgendaSettingsContent";
import InertiaContent from "../settings/_components/InertiaContent";
import BoutiqueContent from "../settings/_components/BoutiqueContent";
import NotificationsSettingsContent from "../settings/_components/NotificationsSettingsContent";
import DocumentsSettingsContent from "../settings/_components/DocumentsSettingsContent";
import ReferralPanel from "./ReferralPanel";
import { useDashboardSubscriptionEdition } from "./DashboardEditionProvider";
import StandardSubscriptionContent from "../settings/_components/StandardSubscriptionContent";
import type { DashboardEdition } from "@/lib/dashboardEdition";
import GoogleOAuthConsentBanner from "./GoogleOAuthConsentBanner";
import styles from "../dashboard.module.css";

type DashboardPanelName =
  "contact" | "profil" | "preferences" | "inrbadge" | "compte" | "activite" | "ia" | "ai_memory" | "abonnement" | "mails" | "agenda" | "site_web" | "instagram" | "threads" | "linkedin" | "x" | "gmb" | "inr_search" | "facebook" | "tiktok" | "youtube_shorts" | "pinterest" | "legal" | "rgpd" | "inertie" | "boutique" | "notifications" | "parrainage" | "documents";

type DashboardSettingsDrawerContentProps = {
  edition?: DashboardEdition;
  panel: string | null;
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
};

export default function DashboardSettingsDrawerContent({
  edition = "standard",
  panel,
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

}: DashboardSettingsDrawerContentProps) {
  const subscriptionEdition = useDashboardSubscriptionEdition();
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroll = contentRef.current?.closest<HTMLElement>('[data-dashboard-settings-drawer-scroll="true"]');
    if (scroll) scroll.scrollTop = 0;
  }, [panel]);

  return (
    <div ref={contentRef} className={styles.settingsDrawerContent} data-dashboard-settings-drawer-content="true">
      <GoogleOAuthConsentBanner panel={panel} />
      {panel === "contact" && <ContactContent mode="drawer" />}
      {panel === "compte" && (
        <AccountContent
          mode="drawer"
          edition={subscriptionEdition}
          onOpenSubscription={() => openPanel("abonnement")}
          onUnsavedChange={onUnsavedChange}
        />
      )}
      {panel === "preferences" && <GeneralPreferencesContent mode="drawer" onUnsavedChange={onUnsavedChange} />}
      {panel === "abonnement" && (
        subscriptionEdition === "founder"
          ? <AbonnementContent mode="drawer" />
          : <StandardSubscriptionContent onOpenContact={() => openPanel("contact")} />
      )}
      {panel === "legal" && <LegalContent mode="drawer" />}
      {panel === "rgpd" && <RgpdContent mode="drawer" />}
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
    </div>
  );
}
