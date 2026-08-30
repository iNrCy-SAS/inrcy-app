import type { DashboardFluxBubbleData } from "./_components/DashboardFluxBubble";
import { fluxModules, MODULE_ICONS } from "./dashboard.constants";
import { statusLabel } from "./dashboard.utils";
import { getBubbleViewHrefFromBlock, normalizeExternalHref } from "./dashboard.shared";
import { projectCanonicalChannelConnection } from "@/lib/dashboardChannelSync";
import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import type { ModuleAction, ModuleStatus } from "./dashboard.types";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import { isBubbleEnabled, normalizeAppBubbleKey, type AppBubbleAccessMap } from "@/lib/bubbleAccess";
import {
  getDashboardModuleCopy,
  translateDashboardStatusText,
  type DashboardCopy,
} from "@/i18n/dashboard";

type BuildFluxBubbleItemsArgs = {
  bubbleAccessMap: AppBubbleAccessMap;
  standardMode?: boolean;
  siteInrcyAccessReady: boolean;
  siteInrcyDisplayAccess: boolean;
  canAccessPinterest: boolean;
  canConfigureSite: boolean;
  canViewSite: boolean;
  officialChannelStatesReady: boolean;
  channelBlocks: any;
  facebookPageConnected: boolean;
  facebookConnectionStatus: ConnectionDisplayStatus;
  facebookUrl: string | null | undefined;
  getSiteBubbleProgress: (kind: "site_inrcy" | "site_web") => { status: ModuleStatus; text: string };
  gmbConnected: boolean;
  gmbConnectionStatus: ConnectionDisplayStatus;
  gmbUrl: string | null | undefined;
  instagramConnected: boolean;
  instagramConnectionStatus: ConnectionDisplayStatus;
  instagramUrl: string | null | undefined;
  inrBadgeLogoUrl?: string | null;
  inrBadgeProfileReady: boolean;
  inrBadgeProfileCheckReady: boolean;
  onOpenInrBadgeModal: () => void;
  onOpenInrAgent: () => void;
  linkedinConnected: boolean;
  linkedinConnectionStatus: ConnectionDisplayStatus;
  linkedinUrl: string | null | undefined;
  mailAccountsConnectedCount: number;
  mailAccountsRequireUpdate?: boolean;
  tiktokConnected: boolean;
  tiktokRequiresUpdate?: boolean;
  tiktokUrl: string | null | undefined;
  pinterestConnected?: boolean;
  pinterestRequiresUpdate?: boolean;
  pinterestUrl?: string | null | undefined;
  inrSearchConnected?: boolean | null;
  inrSearchUrl?: string | null | undefined;
  youtubeShortsConnected: boolean;
  youtubeShortsRequiresUpdate?: boolean;
  youtubeShortsUrl: string | null | undefined;
  openPanel: (panel: any) => void;
  savedSiteWebUrlMeta: unknown;
  setHelpSiteInrcyOpen: (open: boolean) => void;
  setHelpSiteWebOpen: (open: boolean) => void;
  siteInrcySavedUrl: string | null | undefined;
  siteWebSavedUrl: string | null | undefined;
  copy: DashboardCopy;
};

export function buildFluxBubbleItems(args: BuildFluxBubbleItemsArgs): DashboardFluxBubbleData[] {
  const {
    bubbleAccessMap,
    standardMode = false,
    siteInrcyAccessReady,
    siteInrcyDisplayAccess,
    canAccessPinterest,
    canConfigureSite,
    canViewSite,
    officialChannelStatesReady,
    channelBlocks,
    facebookPageConnected,
    facebookConnectionStatus,
    facebookUrl,
    getSiteBubbleProgress,
    gmbConnected,
    gmbConnectionStatus,
    gmbUrl,
    instagramConnected,
    instagramConnectionStatus,
    instagramUrl,
    inrBadgeLogoUrl,
    inrBadgeProfileReady,
    inrBadgeProfileCheckReady,
    onOpenInrBadgeModal,
    onOpenInrAgent,
    linkedinConnected,
    linkedinConnectionStatus,
    linkedinUrl,
    mailAccountsConnectedCount,
    mailAccountsRequireUpdate = false,
    tiktokConnected,
    tiktokRequiresUpdate = false,
    tiktokUrl,
    pinterestConnected = false,
    pinterestRequiresUpdate = false,
    pinterestUrl,
    inrSearchConnected = null,
    inrSearchUrl,
    youtubeShortsConnected,
    youtubeShortsRequiresUpdate = false,
    youtubeShortsUrl,
    openPanel,
    savedSiteWebUrlMeta,
    setHelpSiteInrcyOpen,
    setHelpSiteWebOpen,
    siteInrcySavedUrl,
    siteWebSavedUrl,
    copy,
  } = args;

  return fluxModules.flatMap((m) => {
    const moduleIcon = MODULE_ICONS[m.key] ?? MODULE_ICONS.site_inrcy;
    const bubbleKey = normalizeAppBubbleKey(m.key);
    const storedAccessEnabled = bubbleKey ? isBubbleEnabled(bubbleAccessMap, bubbleKey) : true;
    const mailPremiumLocked = standardMode && m.key === "mails";
    const accessEnabled = storedAccessEnabled && !mailPremiumLocked;
    const displayAccessEnabled = m.key === "site_inrcy" && !siteInrcyAccessReady
      ? siteInrcyDisplayAccess
      : accessEnabled;
    const channelKey = m.key as DashboardChannelKey;
    const channelBlock = channelBlocks?.[channelKey] ?? null;
    const blockDrivenViewHref = getBubbleViewHrefFromBlock(channelKey, channelBlock);
    const officialConnection = m.key === "gmb"
      ? { connected: gmbConnected, connectionStatus: gmbConnectionStatus }
      : m.key === "facebook"
        ? { connected: facebookPageConnected, connectionStatus: facebookConnectionStatus }
        : m.key === "instagram"
          ? { connected: instagramConnected, connectionStatus: instagramConnectionStatus }
          : m.key === "linkedin"
            ? { connected: linkedinConnected, connectionStatus: linkedinConnectionStatus }
            : m.key === "tiktok"
              ? { connected: tiktokConnected, requiresUpdate: tiktokRequiresUpdate }
              : m.key === "youtube_shorts"
                ? { connected: youtubeShortsConnected, requiresUpdate: youtubeShortsRequiresUpdate }
                : m.key === "pinterest"
                  ? { connected: canAccessPinterest && pinterestConnected, requiresUpdate: pinterestRequiresUpdate }
                  : null;
    const officialBubbleStatus = officialConnection && officialChannelStatesReady
      ? projectCanonicalChannelConnection(officialConnection).bubbleStatus
      : null;
    const moduleCopy = getDashboardModuleCopy(copy, m.key);

    const localizeViewAction = (action: ModuleAction | undefined): ModuleAction | undefined => action
      ? { ...action, label: moduleCopy?.view || action.label }
      : undefined;

    const viewActionRaw = m.actions.find((a) => a.variant === "view");
    const viewAction = localizeViewAction(
      (m.key === "site_inrcy" && viewActionRaw)
        ? { ...viewActionRaw, href: normalizeExternalHref(blockDrivenViewHref || siteInrcySavedUrl) || "#" }
        : (m.key === "site_web" && viewActionRaw)
          ? { ...viewActionRaw, href: normalizeExternalHref(blockDrivenViewHref || siteWebSavedUrl) || "#" }
          : (m.key === "instagram" && viewActionRaw)
            ? { ...viewActionRaw, href: normalizeExternalHref(instagramUrl) || "#" }
            : (m.key === "linkedin" && viewActionRaw)
              ? { ...viewActionRaw, href: normalizeExternalHref(linkedinUrl) || "#" }
              : viewActionRaw,
    );

    const resolvedBubbleProgressRaw = (m.key === "site_inrcy")
      ? getSiteBubbleProgress("site_inrcy")
      : (m.key === "site_web")
        ? getSiteBubbleProgress("site_web")
        : officialConnection && !officialChannelStatesReady
          ? { status: "available" as ModuleStatus, text: copy.status.syncing }
        : officialBubbleStatus
          ? { status: officialBubbleStatus, text: statusLabel(officialBubbleStatus, copy) }
          : (() => {
          if (m.key === "inrbadge") {
            if (!inrBadgeProfileCheckReady) {
              return { status: "available" as ModuleStatus, text: copy.status.syncing };
            }
            return inrBadgeProfileReady
              ? { status: "connected" as ModuleStatus, text: copy.status.connected }
              : { status: "available" as ModuleStatus, text: copy.status.disconnected };
          }
          if (m.key === "mails") {
            if (!officialChannelStatesReady) {
              return { status: "available" as ModuleStatus, text: copy.status.syncing };
            }
            if (mailAccountsRequireUpdate) {
              return { status: "reconnect" as ModuleStatus, text: copy.status.reconnect };
            }
            const count = Math.max(0, Math.round(Number(mailAccountsConnectedCount) || 0));
            return count > 0
              ? { status: "connected" as ModuleStatus, text: copy.status.connected }
              : { status: "available" as ModuleStatus, text: copy.status.toConnect };
          }
          if (m.key === "inr_search") {
            if (inrSearchConnected === null) return { status: "available" as ModuleStatus, text: copy.status.syncing };
            return inrSearchConnected
              ? { status: "connected" as ModuleStatus, text: copy.status.pagePublished }
              : { status: "available" as ModuleStatus, text: copy.status.pageUnavailable };
          }
          if (m.key === "inr_agent") return { status: "connected" as ModuleStatus, text: copy.status.connected };
          return { status: m.status, text: statusLabel(m.status, copy) };
          })();

    const resolvedBubbleProgress = {
      ...resolvedBubbleProgressRaw,
      text: translateDashboardStatusText(resolvedBubbleProgressRaw.text, copy),
    };

    const { status: bubbleStatus, text: bubbleStatusText } = displayAccessEnabled
      ? resolvedBubbleProgress
      : {
          status: "coming" as ModuleStatus,
          text: mailPremiumLocked
            ? copy.status.premiumPlan
            : m.key === "site_inrcy"
              ? copy.status.notSubscribed
              : copy.status.disabled,
        };

    const specialViewHref = m.key === "site_inrcy"
      ? (blockDrivenViewHref || normalizeExternalHref(siteInrcySavedUrl) || "#")
        : m.key === "site_web"
          ? (blockDrivenViewHref || normalizeExternalHref(siteWebSavedUrl) || "#")
          : m.key === "instagram"
          ? (normalizeExternalHref(instagramUrl) || "#")
          : m.key === "linkedin"
            ? (normalizeExternalHref(linkedinUrl) || "#")
            : m.key === "gmb"
              ? (normalizeExternalHref(gmbUrl) || "#")
              : m.key === "facebook"
                ? (normalizeExternalHref(facebookUrl) || "#")
                : m.key === "tiktok"
                  ? (normalizeExternalHref(tiktokUrl) || "#")
                  : m.key === "youtube_shorts"
                    ? (normalizeExternalHref(youtubeShortsUrl) || "#")
                    : m.key === "pinterest"
                      ? (normalizeExternalHref(pinterestUrl) || "#")
                      : m.key === "inr_search"
                        ? (normalizeExternalHref(inrSearchUrl) || "#")
                        : undefined;

    const specialViewLabel = m.key === "inrbadge"
      ? moduleCopy?.view
      : specialViewHref
        ? moduleCopy?.view
        : undefined;

    const canViewSpecial = m.key === "inrbadge"
      ? inrBadgeProfileReady
      : m.key === "site_inrcy"
        ? Boolean(blockDrivenViewHref || canViewSite)
        : m.key === "site_web"
          ? Boolean(blockDrivenViewHref || savedSiteWebUrlMeta)
        : m.key === "instagram"
          ? Boolean(instagramUrl)
          : m.key === "linkedin"
            ? Boolean(linkedinUrl)
            : m.key === "gmb"
              ? Boolean(gmbUrl)
              : m.key === "facebook"
                ? Boolean(facebookUrl)
                : m.key === "tiktok"
                  ? Boolean(tiktokUrl)
                  : m.key === "youtube_shorts"
                    ? Boolean(youtubeShortsUrl)
                    : m.key === "pinterest"
                      ? Boolean(pinterestUrl)
                      : m.key === "inr_search"
                        ? Boolean(inrSearchConnected && inrSearchUrl)
                        : undefined;

    const configureDestination = m.key === "inr_agent"
      ? ({ kind: "path", value: "/dashboard/agent" } as const)
      : ({ kind: "panel", value: m.key } as const);

    const onConfigure = () => {
      if (!accessEnabled) return;
      if (m.key === "site_inrcy") {
        if (!canConfigureSite) return;
        openPanel("site_inrcy");
        return;
      }
      if (m.key === "tiktok") {
        openPanel("tiktok");
        return;
      }
      if (m.key === "youtube_shorts") {
        openPanel("youtube_shorts");
        return;
      }
      if (m.key === "pinterest") {
        openPanel("pinterest");
        return;
      }
      if (m.key === "inr_search") {
        openPanel("inr_search");
        return;
      }
      if (m.key === "inr_agent") {
        onOpenInrAgent();
        return;
      }
      if (m.key === "inrbadge") {
        if (!inrBadgeProfileCheckReady) return;
        openPanel("inrbadge");
        return;
      }
      if (m.key === "mails") {
        openPanel("mails");
        return;
      }
      if (["site_web", "instagram", "linkedin", "gmb", "facebook"].includes(m.key)) openPanel(m.key as any);
    };

    return {
      key: m.key,
      name: moduleCopy?.name || m.name,
      description: moduleCopy?.description || m.description,
      accent: m.accent,
      logoSrc: moduleIcon.src,
      logoAlt: moduleIcon.alt,
      bubbleStatus,
      bubbleStatusText,
      helpKind: m.key === "site_inrcy" ? "site_inrcy" : m.key === "site_web" ? "site_web" : undefined,
      onHelpSiteInrcy: () => setHelpSiteInrcyOpen(true),
      onHelpSiteWeb: () => setHelpSiteWebOpen(true),
      specialViewHref,
      specialViewLabel,
      canViewSpecial: accessEnabled ? canViewSpecial : false,
      onSpecialView: accessEnabled && m.key === "inrbadge" ? onOpenInrBadgeModal : undefined,
      viewAction: accessEnabled && !(specialViewHref || m.key === "inrbadge") ? viewAction : undefined,
      onConfigure,
      configureDestination,
      configureDisabled:
        !accessEnabled ||
        (m.key === "site_inrcy" ? !canConfigureSite : false) ||
        (m.key === "inrbadge" ? !inrBadgeProfileCheckReady : false),
      configureTitle: !accessEnabled
        ? mailPremiumLocked
          ? copy.status.premiumPlan
          : m.key === "site_inrcy"
            ? copy.status.notSubscribed
            : copy.bubble.disabled
        : m.key === "site_inrcy" && !canConfigureSite
          ? moduleCopy?.siteOnlyTitle || copy.bubble.disabled
          : m.key === "inrbadge" && !inrBadgeProfileCheckReady
            ? copy.status.profileChecking
            : undefined,
      // Toutes les bulles ouvrent leur panneau de configuration avec le même
      // libellé. La connexion réelle se fait ensuite dans le panneau dédié.
      configureLabel: m.key === "inr_agent"
        ? moduleCopy?.view || copy.bubble.open
        : copy.bubble.configure,
      viewFallbackLabel: copy.bubble.viewFallback,
      emphasizeDisabledReason: !displayAccessEnabled && (mailPremiumLocked || m.key === "site_inrcy"),
    };
  });
}
