import ContactContent from "../settings/_components/ContactContent";
import AccountContent from "../settings/_components/AccountContent";
import ProfileAndActivityContent from "../settings/_components/ProfileAndActivityContent";
import GeneralPreferencesContent from "../settings/_components/GeneralPreferencesContent";
import AiConfigurationContent from "../settings/_components/AiConfigurationContent";
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
import InrSearchSettingsContent from "../settings/_components/InrSearchSettingsContent";
import InrBadgeSettingsContent from "../settings/_components/InrBadgeSettingsContent";
import StandardSubscriptionContent from "../settings/_components/StandardSubscriptionContent";
import type { DashboardEdition } from "@/lib/dashboardEdition";
import GoogleOAuthConsentBanner from "./GoogleOAuthConsentBanner";

type DashboardPanelName =
  | "contact"
  | "profil"
  | "preferences"
  | "inrbadge"
  | "compte"
  | "activite"
  | "ia"
  | "abonnement"
  | "mails"
  | "agenda"
  | "site_inrcy"
  | "site_web"
  | "instagram"
  | "linkedin"
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
  profileInitialSection?: "identity" | "activity" | null;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  onProfileSaved: () => unknown | Promise<unknown>;
  onProfileReset: () => unknown | Promise<unknown>;
  onActivitySaved: () => unknown | Promise<unknown>;
  onActivityReset: () => unknown | Promise<unknown>;
  inertiaSnapshot: any;
  openPanel: (name: DashboardPanelName) => void;
  onCloseDrawer: () => void;
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
  inrSearchAccessEnabled?: boolean;
  inrSearchConnected?: boolean | null;
  inrSearchUrl?: string;
  inrSearchDirectoryEnabled?: boolean | null;
};

export default function DashboardSettingsDrawerContent({
  edition = "premium",
  panel,
  profileInitialSection = null,
  onUnsavedChange,
  onProfileSaved,
  onProfileReset,
  onActivitySaved,
  onActivityReset,
  inertiaSnapshot,
  openPanel,
  onCloseDrawer,
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
  inrSearchAccessEnabled = false,
  inrSearchConnected = null,
  inrSearchUrl = "",
  inrSearchDirectoryEnabled = null,
}: DashboardSettingsDrawerContentProps) {
  return (
    <>
      <GoogleOAuthConsentBanner panel={panel} />
      {panel === "contact" && <ContactContent mode="drawer" />}
      {panel === "compte" && (
        <AccountContent
          mode="drawer"
          edition={edition}
          onOpenSubscription={() => openPanel("abonnement")}
          onUnsavedChange={onUnsavedChange}
        />
      )}
      {(panel === "profil" || panel === "activite") && (
        <ProfileAndActivityContent
          initialSection={panel === "activite" ? "activity" : profileInitialSection}
          onProfileSaved={onProfileSaved}
          onProfileReset={onProfileReset}
          onActivitySaved={onActivitySaved}
          onActivityReset={onActivityReset}
          onCloseDrawer={onCloseDrawer}
          onUnsavedChange={onUnsavedChange}
        />
      )}
      {panel === "preferences" && <GeneralPreferencesContent mode="drawer" onUnsavedChange={onUnsavedChange} />}
      {panel === "inrbadge" && <InrBadgeSettingsContent {...inrBadgeSettingsProps} />}
      {panel === "ia" && (
        <AiConfigurationContent
          onSaved={onCloseDrawer}
          onUnsavedChange={onUnsavedChange}
        />
      )}
      {panel === "abonnement" && (
        edition === "standard"
          ? <StandardSubscriptionContent onOpenContact={() => openPanel("contact")} />
          : <AbonnementContent mode="drawer" />
      )}
      {panel === "legal" && <LegalContent mode="drawer" />}
      {panel === "rgpd" && <RgpdContent mode="drawer" />}
      {panel === "mails" && <MailsSettingsContent onUnsavedChange={onUnsavedChange} />}
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
      {panel === "documents" && <DocumentsSettingsContent onUnsavedChange={onUnsavedChange} />}
      {panel === "youtube_shorts" && <YoutubeShortsSettingsContent onUnsavedChange={onUnsavedChange} />}
      {panel === "pinterest" && pinterestAccessEnabled && <PinterestSettingsContent onUnsavedChange={onUnsavedChange} />}
      {panel === "inr_search" && inrSearchAccessEnabled && (
        <InrSearchSettingsContent
          initialConnected={inrSearchConnected}
          initialPublicUrl={inrSearchUrl}
          initialDirectoryEnabled={inrSearchDirectoryEnabled}
        />
      )}

      <SiteInrcyPanelBlock panel={panel} panelProps={siteInrcyPanelProps} />
      <SiteWebPanelBlock panel={panel} panelProps={siteWebPanelProps} />
      <InstagramPanelBlock panel={panel} panelProps={instagramPanelProps} />
      <LinkedinPanelBlock panel={panel} panelProps={linkedinPanelProps} />
      <GmbPanelBlock panel={panel} panelProps={gmbPanelProps} />
      <FacebookPanelBlock panel={panel} panelProps={facebookPanelProps} />
      <TiktokPanelBlock panel={panel} panelProps={tiktokPanelProps} />
    </>
  );
}
