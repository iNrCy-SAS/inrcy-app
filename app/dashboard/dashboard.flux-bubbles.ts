import { getInrDirectoryUrl } from "@/lib/inrDirectorySettings";
import type { NativeChannelStates } from "@/lib/nativeChannelActivation";
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
import { DASHBOARD_CHANNEL_CREATE_HREF_BY_KEY } from "./dashboard.channel-setup";

type BuildFluxBubbleItemsArgs = {
  nativeChannelStates?: NativeChannelStates | null;
  bubbleAccessMap: AppBubbleAccessMap;
  standardMode?: boolean;
  metaPilotEnabled?: boolean;
  threadsConnected?: boolean;
  threadsConnectionStatus?: ConnectionDisplayStatus;
  threadsUrl?: string;
  canAccessPinterest: boolean;
  officialChannelStatesReady: boolean;
  channelBlocks: any;
  facebookPageConnected: boolean;
  facebookConnectionStatus: ConnectionDisplayStatus;
  facebookUrl: string | null | undefined;
  getSiteBubbleProgress: (kind: "site_web") => { status: ModuleStatus; text: string };
  gmbConnected: boolean;
  gmbConnectionStatus: ConnectionDisplayStatus;
  gmbUrl: string | null | undefined;
  instagramConnected: boolean;
  instagramConnectionStatus: ConnectionDisplayStatus;
  instagramUrl: string | null | undefined;
  inrBadgeLogoUrl?: string | null;
  inrBadgeProfileReady: boolean;
  inrBadgeProfileCheckReady: boolean;
  inrBadgePublicUrl: string;
  onOpenInrAgent: () => void;
  linkedinConnected: boolean;
  linkedinConnectionStatus: ConnectionDisplayStatus;
  linkedinUrl: string | null | undefined;
  xConnected: boolean;
  xConnectionStatus: ConnectionDisplayStatus;
  xRequiresUpdate?: boolean;
  xUrl: string | null | undefined;
  mailAccountsConnectedCount: number;
  mailAccountsRequireUpdate?: boolean;
  tiktokConnected: boolean;
  tiktokRequiresUpdate?: boolean;
  tiktokUrl: string | null | undefined;
  pinterestConnected?: boolean;
  pinterestRequiresUpdate?: boolean;
  pinterestUrl?: string | null | undefined;
  inrDirectoryEnabled?: boolean | null;
  inrSearchConnected?: boolean | null;
  inrSearchUrl?: string | null | undefined;
  youtubeShortsConnected: boolean;
  youtubeShortsRequiresUpdate?: boolean;
  youtubeShortsUrl: string | null | undefined;
  openPanel: (panel: any) => void;
  savedSiteWebUrlMeta: unknown;
  siteWebSavedUrl: string | null | undefined;
  copy: DashboardCopy;
};

export function buildFluxBubbleItems(args: BuildFluxBubbleItemsArgs): DashboardFluxBubbleData[] {
  const {
    nativeChannelStates,
    bubbleAccessMap,
    standardMode = false,
    metaPilotEnabled = false,
    threadsConnected = false,
    threadsConnectionStatus = "disconnected",
    threadsUrl = "",

    canAccessPinterest,

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
    inrBadgePublicUrl,
    onOpenInrAgent,
    linkedinConnected,
    linkedinConnectionStatus,
    linkedinUrl,
    xConnected,
    xConnectionStatus,
    xRequiresUpdate = false,
    xUrl,
    mailAccountsConnectedCount,
    mailAccountsRequireUpdate = false,
    tiktokConnected,
    tiktokRequiresUpdate = false,
    tiktokUrl,
    pinterestConnected = false,
    pinterestRequiresUpdate = false,
    pinterestUrl,
    inrDirectoryEnabled = null,
    inrSearchConnected = null,
    inrSearchUrl,
    youtubeShortsConnected,
    youtubeShortsRequiresUpdate = false,
    youtubeShortsUrl,
    openPanel,
    savedSiteWebUrlMeta,


    siteWebSavedUrl,
    copy,
  } = args;

  return fluxModules.flatMap((m) => {
    if (m.key === "threads" && !metaPilotEnabled) return [];
    const moduleIcon = MODULE_ICONS[m.key] ?? MODULE_ICONS.site_web;
    const bubbleKey = normalizeAppBubbleKey(m.key);
    const storedAccessEnabled = bubbleKey ? isBubbleEnabled(bubbleAccessMap, bubbleKey) : true;
    const mailPremiumLocked = standardMode && m.key === "mails";
    const accessEnabled = storedAccessEnabled && !mailPremiumLocked;
    const displayAccessEnabled = accessEnabled;
    const channelKey = m.key as DashboardChannelKey;
    const channelBlock = channelBlocks?.[channelKey] ?? null;
    const blockDrivenViewHref = getBubbleViewHrefFromBlock(channelKey, channelBlock);
    const officialConnection = m.key === "gmb"
      ? { connected: gmbConnected, connectionStatus: gmbConnectionStatus }
      : m.key === "facebook"
        ? { connected: facebookPageConnected, connectionStatus: facebookConnectionStatus }
        : m.key === "threads"
          ? { connected: threadsConnected, connectionStatus: threadsConnectionStatus }
        : m.key === "instagram"
          ? { connected: instagramConnected, connectionStatus: instagramConnectionStatus }
          : m.key === "linkedin"
            ? { connected: linkedinConnected, connectionStatus: linkedinConnectionStatus }
            : m.key === "tiktok"
              ? { connected: tiktokConnected, requiresUpdate: tiktokRequiresUpdate }
              : m.key === "x"
                ? { connected: xConnected, connectionStatus: xConnectionStatus, requiresUpdate: xRequiresUpdate }
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
      (m.key === "site_web" && viewActionRaw)
          ? { ...viewActionRaw, href: normalizeExternalHref(siteWebSavedUrl) || blockDrivenViewHref || "#" }
          : (m.key === "instagram" && viewActionRaw)
            ? { ...viewActionRaw, href: normalizeExternalHref(instagramUrl) || "#" }
            : (m.key === "linkedin" && viewActionRaw)
              ? { ...viewActionRaw, href: normalizeExternalHref(linkedinUrl) || "#" }
              : viewActionRaw,
    );

    const isNative = m.key === "inrbadge" || m.key === "inr_search" || m.key === "inr_directory";
    const nativeState = isNative ? nativeChannelStates?.[m.key as keyof NativeChannelStates] : undefined;
    const resolvedBubbleProgressRaw = nativeState
      ? { status: nativeState.published ? "connected" as ModuleStatus : "available" as ModuleStatus, text: nativeState.published ? copy.nativeChannels.published : nativeState.pending ? copy.nativeChannels.pending : copy.nativeChannels.inactive }
      : isNative ? { status: "available" as ModuleStatus, text: copy.status.syncing }
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
          if (m.key === "inr_directory") {
            if (inrDirectoryEnabled === null) return { status: "available" as ModuleStatus, text: copy.status.syncing };
            return { status: (inrDirectoryEnabled ? "connected" : "available") as ModuleStatus, text: inrDirectoryEnabled ? "Visible dans l’annuaire" : "Hors annuaire" };
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
          text: copy.status.disabled,
        };

    const specialViewHref = m.key === "inr_directory" ? getInrDirectoryUrl() : m.key === "inrbadge" ? (normalizeExternalHref(inrBadgePublicUrl) || "#") : m.key === "threads" ? (normalizeExternalHref(threadsUrl) || "#") : m.key === "site_web"
          ? (normalizeExternalHref(siteWebSavedUrl) || blockDrivenViewHref || "#")
          : m.key === "instagram"
          ? (normalizeExternalHref(instagramUrl) || "#")
          : m.key === "linkedin"
            ? (normalizeExternalHref(linkedinUrl) || "#")
            : m.key === "x"
              ? (normalizeExternalHref(xUrl) || "#")
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
        ? moduleCopy?.view || viewAction?.label
        : undefined;

    const canViewSpecial = nativeState ? nativeState.published && Boolean(specialViewHref && specialViewHref !== "#") : m.key === "inr_directory" ? false : m.key === "inrbadge"
      ? inrBadgeProfileReady && Boolean(inrBadgePublicUrl)
      : m.key === "threads" ? Boolean(threadsUrl) : m.key === "site_web"
          ? Boolean(blockDrivenViewHref || savedSiteWebUrlMeta)
        : m.key === "instagram"
          ? Boolean(instagramUrl)
          : m.key === "linkedin"
            ? Boolean(linkedinUrl)
            : m.key === "x"
              ? Boolean(xUrl)
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

    const configureDestination = mailPremiumLocked
      ? ({ kind: "panel", value: "abonnement" } as const)
      : m.key === "inr_agent"
      ? ({ kind: "path", value: "/dashboard/agent" } as const)
      : ({ kind: "panel", value: m.key } as const);

    const onConfigure = () => {
      if (mailPremiumLocked) {
        openPanel("abonnement");
        return;
      }
      if (!accessEnabled) return;
      if (m.key === "inr_directory") { openPanel("inr_directory"); return; }

      if (m.key === "tiktok") {
        openPanel("tiktok");
        return;
      }
      if (m.key === "x") {
        openPanel("x");
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
        openPanel("inrbadge");
        return;
      }
      if (m.key === "mails") {
        openPanel("mails");
        return;
      }
      if (["site_web", "instagram", "threads", "linkedin", "gmb", "facebook"].includes(m.key)) openPanel(m.key as any);
    };

    const createHref = m.key in DASHBOARD_CHANNEL_CREATE_HREF_BY_KEY
      ? DASHBOARD_CHANNEL_CREATE_HREF_BY_KEY[m.key as keyof typeof DASHBOARD_CHANNEL_CREATE_HREF_BY_KEY]
      : null;

    return {
      key: m.key,
      name: moduleCopy?.name || m.name,
      description: moduleCopy?.description || m.description,
      accent: m.accent,
      logoSrc: moduleIcon.src,
      logoAlt: moduleIcon.alt,
      bubbleStatus,
      bubbleStatusText,
      specialViewHref,
      specialViewLabel,
      canViewSpecial: accessEnabled ? canViewSpecial : false,
      viewAction: accessEnabled && !(specialViewHref || m.key === "inrbadge") ? viewAction : undefined,
      createHref,
      // « Créer » est réservé aux réseaux traditionnels disposant d'une page
      // officielle de création. Les outils iNrCy, Mails et les sites conservent
      // strictement leurs actions existantes.
      onCreate: undefined,
      createLabel: copy.bubble.create,
      createDisabled: !accessEnabled,
      onConfigure,
      configureDestination,
      configureDisabled: !accessEnabled,
      configureTitle: !accessEnabled
        ? mailPremiumLocked
          ? copy.status.premiumPlan
          : copy.bubble.disabled
        : undefined,
      // Toutes les bulles ouvrent leur panneau de configuration avec le même
      // libellé. La connexion réelle se fait ensuite dans le panneau dédié.
      configureLabel: m.key === "inr_agent"
        ? moduleCopy?.view || copy.bubble.open
        : copy.bubble.configure,
      viewFallbackLabel: copy.bubble.viewFallback,
      emphasizeDisabledReason: !displayAccessEnabled && (mailPremiumLocked),
      premiumLocked: mailPremiumLocked,
      premiumLabel: copy.modules.campaignsPremiumLabel,
    };
  });
}
