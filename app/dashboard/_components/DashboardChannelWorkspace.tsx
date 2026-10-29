"use client";

import { lazy, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInrAssistantScreen } from "./DashboardAssistantScreenContext";
import { useTranslations } from "next-intl";
import DashboardFluxBubble, { ChannelBubbleIcon, type DashboardFluxBubbleData } from "./DashboardFluxBubble";
import bubbleStyles from "./DashboardChannelBubble.module.css";
import type { ChannelBubbleConnection, ChannelBubbleRenderer } from "./channel-bubble.types";
import type { buildDashboardPanelProps } from "../dashboard.panel-props";
import type { useThreadsChannel } from "../_hooks/channels/useThreadsChannel";
import { useDashboardViewerAccess } from "./DashboardViewerAccessProvider";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import { useDashboardUnsavedNavigation } from "./DashboardUnsavedNavigationProvider";
import ChannelParametersDialog from "./ChannelParametersDialog";
import EditableChannelUrlField from "./EditableChannelUrlField";
import type { EditableChannelPublicUrlChannel, LinkedinPublicUrlTarget } from "@/lib/channelPublicUrl";
import type { GoogleBusinessLocation } from "@/lib/googleBusinessLocations";
import SiteWebBubbleControls from "./SiteWebBubbleControls";
import SiteWebWidgetSettings from "./SiteWebWidgetSettings";
import { InrBadgeQrButton, InrBadgeDownloadButton, InrBadgeCopyButton } from "./InrBadgeBubbleActions";

const ThreadsPublicationSettings = lazy(() => import("./ThreadsPublicationSettings"));
const InrBadgeSettingsContent = lazy(() => import("../settings/_components/InrBadgeSettingsContent"));
const GoogleBusinessProfileEditor = lazy(() => import("./GoogleBusinessProfileEditor"));
const GoogleBusinessReviews = lazy(() => import("../e-reputation/EReputationReviewsClient"));
// Load controls with the workspace so switching bubbles never shows an incomplete action row.
// Only the selected controller mounts; secondary parameter forms stay lazy.
import XSettingsContent from "../settings/_components/XSettingsContent";
import YoutubeShortsSettingsContent from "../settings/_components/YoutubeShortsSettingsContent";
import PinterestSettingsContent from "../settings/_components/PinterestSettingsContent";
import MailsSettingsContent from "../settings/_components/MailsSettingsContent";
import InrDirectorySettingsContent from "../settings/_components/InrDirectorySettingsContent";
import InrSearchSettingsContent from "../settings/_components/InrSearchSettingsContent";

type Props = ReturnType<typeof buildDashboardPanelProps> & {
  item: DashboardFluxBubbleData;
  threadsChannel: ReturnType<typeof useThreadsChannel>;
  inrBadgeSettingsProps: Parameters<typeof InrBadgeSettingsContent>[0];
  inrSearchConnected: boolean | null;
  inrSearchUrl: string;
  inrSearchDirectoryEnabled: boolean | null;
};

export default function DashboardChannelWorkspace(props: Props) {
  const { item, siteWebPanelProps: site, gmbPanelProps: gmb, facebookPanelProps: fb, instagramPanelProps: ig, linkedinPanelProps: li, tiktokPanelProps: tik, threadsChannel: threads } = props;
  const t = useTranslations("dashboard.channelBubble");
  const shell = useTranslations("shell");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const reviewsRequested = searchParams.get("googleReviews") === "1";
  // Open after the channel dialog mounts, so its native top layer exists first.
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviewsDirty, setReviewsDirty] = useState(false);
  useEffect(() => { setReviewsOpen(reviewsRequested); }, [reviewsRequested]);
  const closeReviews = () => void requestNavigation(() => {
    setReviewsOpen(false);
    if (reviewsRequested) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("googleReviews");
      router.replace(`/dashboard?${params.toString()}`, { scroll: false });
    }
  });
  const { metaPilotEnabled } = useDashboardViewerAccess();
  useEffect(() => {
    if (item.key === "gmb" && gmb.gmbAccountConnected && !item.configureDisabled && !item.premiumLocked) void gmb.loadGmbAccountsAndLocations({ autoSelect: false });
  }, [item.key, item.configureDisabled, item.premiumLocked, gmb?.gmbAccountConnected, gmb?.loadGmbAccountsAndLocations]);
  const [dirty, setDirty] = useState(false);
  const [profileLinkDirty, setProfileLinkDirty] = useState(false);
  const [organizationLinkDirty, setOrganizationLinkDirty] = useState(false);
  const [widgetDirty, setWidgetDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [actionFeedback, setActionFeedback] = useState<{ channel: string; error?: string; notice?: string } | null>(null);
  const onActionError = (error: string) => setActionFeedback({ channel: item.key, error });
  const onActionNotice = (notice: string) => setActionFeedback({ channel: item.key, notice });
  const hasUnsavedChanges = dirty || profileLinkDirty || organizationLinkDirty || widgetDirty || reviewsDirty;
  useInrAssistantScreen({ action: "channels", channel: item.key, pendingChanges: hasUnsavedChanges });
  useUnsavedExitGuard({ active: hasUnsavedChanges, shouldBlock: hasUnsavedChanges, onConfirmExit: () => { setDirty(false); setProfileLinkDirty(false); setOrganizationLinkDirty(false); setWidgetDirty(false); setReviewsDirty(false); setRevision(value => value + 1); } });
  const knownConnection = getKnownChannelConnection(item);
  const renderBubble: ChannelBubbleRenderer = connection => <DashboardFluxBubble key={revision} item={{ ...item, connection: { ...(connection.loading && knownConnection.accountConnected ? {
    ...connection,
    accountConnected: connection.accountConnected || knownConnection.accountConnected,
    resourceLabel: connection.resourceLabel || knownConnection.resourceLabel,
  } : connection), ...(actionFeedback?.channel === item.key ? { error: actionFeedback.error || connection.error, notice: actionFeedback.notice || connection.notice } : {}) } }} />;
  const publicLink = (channel: EditableChannelPublicUrlChannel, value: string, onSaved: (url: string) => void, canEdit: boolean, target?: LinkedinPublicUrlTarget) => <EditableChannelUrlField channel={channel} target={target} value={value || ""} onSaved={onSaved} onDirtyChange={target === "profile" ? setProfileLinkDirty : target === "organization" ? setOrganizationLinkDirty : setDirty} ariaLabel={`${t("publicLink")} — ${item.name}${target ? ` — ${shell(target === "profile" ? "profil_personnel_8e5d4316" : "page_entreprise_a6ed751d")}` : ""}`} viewLabel={t("view")} editorOnly disabled={!canEdit} />;

  // Access checks run before mounting a controller or exposing any mutation.
  if (item.configureDisabled || item.premiumLocked || item.bubbleStatus === "coming") return <DashboardFluxBubble item={item} />;
  switch (item.key) {
    case "x": return <XSettingsContent key={revision} renderBubble={renderBubble} onUnsavedChange={setDirty} />;
    case "youtube_shorts": return <YoutubeShortsSettingsContent key={revision} renderBubble={renderBubble} onUnsavedChange={setDirty} />;
    case "pinterest": return <PinterestSettingsContent key={revision} renderBubble={renderBubble} onUnsavedChange={setDirty} />;
    case "mails": return <MailsSettingsContent key={revision} renderBubble={renderBubble} onUnsavedChange={setDirty} />;
    case "inr_directory": return <InrDirectorySettingsContent renderBubble={renderBubble} initialEnabled={props.inrSearchDirectoryEnabled} />;
    case "inr_search": return <InrSearchSettingsContent renderBubble={renderBubble} initialConnected={props.inrSearchConnected} initialPublicUrl={props.inrSearchUrl} initialDirectoryEnabled={props.inrSearchDirectoryEnabled} />;
  }

  let connection: ChannelBubbleConnection;
  switch (item.key) {
    case "gmb":
      connection = {
        accountConnected: gmb.gmbAccountConnected,
        accountLabel: gmb.gmbAccountEmail || undefined,
        resourceLabel: gmb.gmbConfigured ? gmb.gmbLocationLabel : gmb.gmbAccountEmail,
        value: gmb.gmbConfigured ? gmb.gmbLocationName : "",
        options: gmb.gmbLocations.map((location: GoogleBusinessLocation) => ({ value: location.name, label: location.title || location.name })),
        onSelect: gmb.saveGmbLocation,
        onLoad: () => gmb.loadGmbAccountsAndLocations({ autoSelect: false }),
        onConnect: gmb.connectGmbAccount,
        onDisconnect: gmb.gmbConfigured ? gmb.disconnectGmbBusiness : gmb.disconnectGmbAccount,
        onDisconnectAccount: gmb.gmbConfigured ? gmb.disconnectGmbAccount : undefined,
        publicLinks: publicLink("gmb", gmb.gmbUrl, gmb.setGmbUrl, gmb.gmbConfigured),
        loading: gmb.gmbLoadingList, busy: gmb.gmbLocationBusy || gmb.gmbAccountBusy || gmb.gmbLocationsPhase === "connecting",
        error: gmb.gmbUrlError || gmb.gmbListError,
        extraActions: gmb.gmbConfigured ? <button type="button" className={`${bubbleStyles.iconAction} ${bubbleStyles.googleReviewsAction}`} title={t("googleReviews")} aria-label={`${t("googleReviews")} — Google Business`} onClick={() => setReviewsOpen(true)}><ChannelBubbleIcon kind="reviews" /></button> : undefined,
        parameters: gmb.gmbConfigured ? <GoogleBusinessProfileEditor key={gmb.gmbLocationName} locationName={gmb.gmbLocationName} onDirtyChange={setDirty} /> : undefined,
        parametersLabel: t("manageGoogleProfile"),
        parametersIcon: "businessProfile",
        parametersCompact: true,
      }; break;
    case "facebook":
      connection = {
        accountConnected: fb.facebookAccountConnected,
        accountLabel: fb.facebookAccountEmail || undefined,
        resourceLabel: fb.fbSelectedPageName || fb.facebookAccountEmail,
        value: fb.facebookPageConnected ? fb.fbSelectedPageId : "",
        options: fb.fbPages.map((page: { id: string; name?: string }) => ({ value: page.id, label: page.name || page.id })),
        onSelect: fb.saveFacebookPage, onLoad: () => fb.loadFacebookPages({ autoSelect: !fb.facebookPageConnected }),
        connectOptions: [{ label: "Connexion Facebook", href: "/api/integrations/facebook/start?returnTo=%2Fdashboard%3Fpanel%3Dfacebook&mode=standard", onConnect: fb.connectFacebookAccount }, { label: "Connexion Business", href: "/api/integrations/facebook/start?returnTo=%2Fdashboard%3Fpanel%3Dfacebook&mode=business", onConnect: fb.connectFacebookBusinessAccount }],
        connectNotice: t("facebookPageRequired"),
        onDisconnect: fb.facebookPageConnected ? fb.disconnectFacebookPage : fb.disconnectFacebookAccount,
        onDisconnectAccount: fb.facebookPageConnected ? fb.disconnectFacebookAccount : undefined,
        publicLinks: publicLink("facebook", fb.facebookUrl, fb.setFacebookUrl, fb.facebookPageConnected),
        loading: fb.fbPagesLoading, busy: fb.facebookPageBusy || fb.facebookAccountBusy,
        error: fb.facebookUrlError || fb.fbPagesError,
        publicationTypes: { value: fb.facebookPublicationPreferences, loading: fb.facebookPublicationPreferencesLoading, saving: fb.facebookPublicationPreferencesSaving, error: fb.facebookPublicationPreferencesError, onLoad: fb.loadFacebookPublicationPreferences, onChange: fb.saveFacebookPublicationPreferences },
      }; break;
    case "instagram":
      connection = {
        accountConnected: ig.instagramAccountConnected,
        resourceLabel: ig.instagramUsername ? `@${ig.instagramUsername}` : "",
        value: ig.instagramConnected ? ig.igSelectedPageId : "",
        ...(ig.instagramAuthMode === "instagram_login" ? {} : {
          options: ig.igAccounts.map((account: { page_id: string; username?: string; page_name?: string }) => ({ value: account.page_id, label: account.username ? `@${account.username}` : account.page_name || account.page_id })),
          onSelect: ig.saveInstagramProfile, onLoad: () => ig.loadInstagramAccounts({ autoSelect: !ig.instagramConnected }),
        }),
        connectNotice: t("instagramProfessionalRequired"),
        connectOptions: [
          ...(metaPilotEnabled ? [{ label: t("directConnection"), primary: true, href: "/api/integrations/instagram-direct/start?returnTo=%2Fdashboard%3Fpanel%3Dinstagram", onConnect: ig.connectInstagramDirectAccount }] : []),
          { label: t("classicConnection"), menu: t("facebookConnection"), href: `/api/integrations/instagram/start?returnTo=%2Fdashboard%3Fpanel%3Dinstagram&mode=standard${item.bubbleStatus === "reconnect" ? "&repair=1" : ""}`, onConnect: item.bubbleStatus === "reconnect" ? () => ig.connectInstagramAccount({ repair: true }) : ig.connectInstagramAccount },
          { label: t("businessConnection"), menu: t("facebookConnection"), href: "/api/integrations/instagram/start?returnTo=%2Fdashboard%3Fpanel%3Dinstagram&mode=business", onConnect: ig.connectInstagramBusinessAccount },
        ],
        onDisconnect: ig.instagramConnected ? ig.disconnectInstagramProfile : ig.disconnectInstagramAccount,
        onDisconnectAccount: ig.instagramConnected ? ig.disconnectInstagramAccount : undefined,
        publicLinks: publicLink("instagram", ig.instagramUrl, ig.setInstagramUrl, ig.instagramConnected),
        loading: ig.igAccountsLoading, busy: ig.instagramProfileBusy || ig.instagramAccountBusy,
        error: ig.instagramUrlError || ig.igAccountsError,
        publicationTypes: { value: ig.instagramPublicationPreferences, loading: ig.instagramPublicationPreferencesLoading, saving: ig.instagramPublicationPreferencesSaving, error: ig.instagramPublicationPreferencesError, onLoad: ig.loadInstagramPublicationPreferences, onChange: ig.saveInstagramPublicationPreferences },
      }; break;
    case "linkedin":
      connection = {
        accountConnected: li.linkedinAccountConnected,
        accountLabel: li.linkedinSelectedOrganizationId ? li.linkedinDisplayName || undefined : undefined,
        resourceLabel: li.linkedinSelectedOrganizationName || li.linkedinDisplayName,
        value: li.linkedinAccountConnected ? li.linkedinSelectedOrganizationId || "profile" : "",
        options: [{ value: "profile", label: li.linkedinDisplayName || "Profil personnel" }, ...li.linkedinOrganizations.map((org: { id: string; name: string }) => ({ value: org.id, label: org.name }))],
        onSelect: value => value === "profile" ? li.useLinkedinPersonalProfile() : li.selectLinkedinOrganization(value),
        onLoad: () => li.loadLinkedinOrganizations({ autoSelect: false }),
        connectOptions: [{ label: "Connexion LinkedIn", onConnect: li.connectLinkedinAccount }, { label: "Connexion Business", onConnect: li.connectLinkedinBusinessAccount }],
        onDisconnect: li.linkedinSelectedOrganizationId ? li.disconnectLinkedinOrganization : li.disconnectLinkedinAccount,
        onDisconnectAccount: li.linkedinSelectedOrganizationId ? li.disconnectLinkedinAccount : undefined,
        publicLinks: <><div><strong>{shell("profil_personnel_8e5d4316")}</strong>{publicLink("linkedin", li.linkedinProfileUrl, li.setLinkedinProfileUrl, li.linkedinAccountConnected, "profile")}</div>{li.linkedinSelectedOrganizationId ? <div><strong>{shell("page_entreprise_a6ed751d")}</strong>{publicLink("linkedin", li.linkedinOrganizationUrl, li.setLinkedinOrganizationUrl, true, "organization")}</div> : null}</>,
        loading: li.linkedinOrganizationsLoading, busy: li.linkedinAccountBusy || li.linkedinOrganizationBusy,
        error: li.linkedinUrlError, notice: li.linkedinUrlNotice,
        parameters: li.linkedinSelectedOrganizationId ? <label style={{ display: "flex", gap: 12, alignItems: "center" }}><input type="checkbox" checked={li.linkedinShareToPersonalProfile} disabled={li.linkedinShareToPersonalProfileBusy} onChange={event => void li.updateLinkedinShareToPersonalProfile(event.target.checked)} />Publier aussi sur mon profil personnel</label> : undefined,
      }; break;
    case "threads":
      connection = {
        accountConnected: threads.connection.connected,
        resourceLabel: threads.connection.username ? `@${threads.connection.username}` : "",
        onConnect: threads.connectThreads, onDisconnect: threads.disconnectThreads,
        loading: threads.loading, busy: threads.busy, error: threads.error, notice: threads.notice,
        parameters: <ThreadsPublicationSettings channel={threads} />, parametersOwnHeading: true,
      }; break;
    case "tiktok":
      connection = {
        accountConnected: tik.tiktokConnected,
        resourceLabel: tik.tiktokUsername ? `@${tik.tiktokUsername.trim().replace(/^@+/, "")}` : "",
        onConnect: tik.connectTiktok, onDisconnect: tik.disconnectTiktok,
        publicLinks: publicLink("tiktok", tik.tiktokProfileUrl, tik.setTiktokProfileUrl, tik.tiktokConnected),
        loading: tik.tiktokLoading, error: tik.tiktokProfileUrlError || tik.tiktokSettingsError,
      }; break;
    case "site_web":
      connection = {
        accountConnected: site.hasSiteWebUrl, resourceLabel: site.siteWebSavedUrl,
        resourceContent: <SiteWebBubbleControls site={site} onDirtyChange={setDirty} onError={onActionError} />,
        busy: site.siteWebUrlBusy,
        error: site.siteWebSettingsError,
        notice: site.siteWebUrlNotice || site.siteWebGa4Notice || site.siteWebGscNotice,
        parameters: site.hasSiteWebUrl ? <SiteWebWidgetSettings site={site} onDirtyChange={setWidgetDirty} /> : undefined,
        parametersLabel: t("widget"), parametersIcon: "widget", parametersOwnHeading: true,
      }; break;
    case "inrbadge":
      connection = {
        accountConnected: props.inrBadgeSettingsProps.profileReady,
        resourceLabel: props.inrBadgeSettingsProps.profile?.companyLegalName || item.name,
        resourceContent: <InrBadgeQrButton publicUrl={props.inrBadgeSettingsProps.publicUrl} companyName={props.inrBadgeSettingsProps.profile?.companyLegalName || item.name} />,
        extraActions: <><InrBadgeDownloadButton publicUrl={props.inrBadgeSettingsProps.publicUrl} profile={props.inrBadgeSettingsProps.profile} /><InrBadgeCopyButton publicUrl={props.inrBadgeSettingsProps.publicUrl} onNotice={onActionNotice} onError={onActionError} /></>,
        parameters: <InrBadgeSettingsContent {...props.inrBadgeSettingsProps} />,
        parametersFullScreen: true,
      }; break;
    default: return <DashboardFluxBubble item={item} />;
  }
  return <>{renderBubble(connection)}{item.key === "gmb" && reviewsOpen ? <ChannelParametersDialog name="Google Business" title={t("googleReviews")} contentOnly layout="reviews" onClose={closeReviews}><GoogleBusinessReviews key={`${revision}:${gmb.gmbLocationName}`} embedded locationName={gmb.gmbLocationName} onDirtyChange={setReviewsDirty} reviews={[]} reviewsReady={false} reviewsError={null} locationLabel={gmb.gmbLocationLabel} gmbReady={gmb.gmbConfigured} /></ChannelParametersDialog> : null}</>;
}

/** The dashboard already knows connection status and the public destination. */
export function getKnownChannelConnection(item: DashboardFluxBubbleData): ChannelBubbleConnection {
  const accountConnected = item.bubbleStatus === "connected" || item.bubbleStatus === "reconnect";
  let resourceLabel = "";
  if (accountConnected) {
    try {
      const url = new URL(item.specialViewHref || item.viewAction?.href || "");
      const path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
      if (item.key === "x" || item.key === "pinterest") resourceLabel = path ? `@${path.replace(/^@/, "")}` : "";
      else if (item.key === "youtube_shorts") resourceLabel = path.startsWith("@") ? path : url.href;
    } catch { /* A missing public URL does not mean the account is disconnected. */ }
  }
  return { accountConnected, resourceLabel };
}
