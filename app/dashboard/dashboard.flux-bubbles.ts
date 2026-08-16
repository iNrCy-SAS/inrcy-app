import type { DashboardFluxBubbleData } from "./_components/DashboardFluxBubble";
import { fluxModules, MODULE_ICONS } from "./dashboard.constants";
import { statusLabel } from "./dashboard.utils";
import { getBubbleStatusFromBlock, getBubbleViewHrefFromBlock, normalizeExternalHref } from "./dashboard.shared";
import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import type { InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";
import type { ModuleAction, ModuleStatus } from "./dashboard.types";
import { isBubbleEnabled, normalizeAppBubbleKey, type AppBubbleAccessMap } from "@/lib/bubbleAccess";
import type { AppLanguageCode } from "@/lib/appLanguage";
import { getDashboardModuleCopy, getDashboardTranslations, translateDashboardStatusText } from "@/lib/dashboardI18n";

type BuildFluxBubbleItemsArgs = {
  bubbleAccessMap: AppBubbleAccessMap;
  standardMode?: boolean;
  siteInrcyAccessReady: boolean;
  siteInrcyDisplayAccess: boolean;
  canAccessPinterest: boolean;
  canConfigureSite: boolean;
  canViewSite: boolean;
  channelBlocks: any;
  facebookPageConnected: boolean;
  facebookUrl: string | null | undefined;
  getSiteBubbleProgress: (kind: "site_inrcy" | "site_web") => { status: ModuleStatus; text: string };
  gmbConnected: boolean;
  gmbUrl: string | null | undefined;
  instagramConnected: boolean;
  instagramUrl: string | null | undefined;
  inrBadgeLogoUrl?: string | null;
  inrBadgeProfileReady: boolean;
  inrBadgeProfileCheckReady: boolean;
  onOpenInrBadgeModal: () => void;
  onOpenInrAgent: () => void;
  linkedinConnected: boolean;
  linkedinUrl: string | null | undefined;
  mailAccountsConnectedCount: number;
  tiktokConnected: boolean;
  tiktokUrl: string | null | undefined;
  pinterestConnected?: boolean;
  pinterestUrl?: string | null | undefined;
  inrSearchConnected?: boolean | null;
  inrSearchUrl?: string | null | undefined;
  youtubeShortsConnected: boolean;
  youtubeShortsUrl: string | null | undefined;
  openPanel: (panel: any) => void;
  savedSiteWebUrlMeta: unknown;
  setHelpSiteInrcyOpen: (open: boolean) => void;
  setHelpSiteWebOpen: (open: boolean) => void;
  siteInrcySavedUrl: string | null | undefined;
  siteWebSavedUrl: string | null | undefined;
  language?: AppLanguageCode | string | null;
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
    channelBlocks,
    facebookPageConnected,
    facebookUrl,
    getSiteBubbleProgress,
    gmbConnected,
    gmbUrl,
    instagramConnected,
    instagramUrl,
    inrBadgeLogoUrl,
    inrBadgeProfileReady,
    inrBadgeProfileCheckReady,
    onOpenInrBadgeModal,
    onOpenInrAgent,
    linkedinConnected,
    linkedinUrl,
    mailAccountsConnectedCount,
    tiktokConnected,
    tiktokUrl,
    pinterestConnected = false,
    pinterestUrl,
    inrSearchConnected = null,
    inrSearchUrl,
    youtubeShortsConnected,
    youtubeShortsUrl,
    openPanel,
    savedSiteWebUrlMeta,
    setHelpSiteInrcyOpen,
    setHelpSiteWebOpen,
    siteInrcySavedUrl,
    siteWebSavedUrl,
    language,
  } = args;

  const copy = getDashboardTranslations(language);

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
    const blockDrivenStatus = getBubbleStatusFromBlock(channelKey, channelBlock as InrstatsChannelBlock);
    const blockDrivenViewHref = getBubbleViewHrefFromBlock(channelKey, channelBlock);
    const immediateConnectedStatus =
      (m.key === "tiktok" && tiktokConnected) || (m.key === "pinterest" && canAccessPinterest && pinterestConnected)
        ? { status: "connected" as ModuleStatus, text: copy.status.connected }
        : null;
    const blockRequiresAttention = Boolean(
      channelBlock?.connection?.requiresUpdate ||
      channelBlock?.connection?.connectionStatus === "needs_update" ||
      channelBlock?.connection?.expired,
    );
    const moduleCopy = getDashboardModuleCopy(m.key, language);

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
            ? { ...viewActionRaw, href: normalizeExternalHref(blockDrivenViewHref || instagramUrl) || "#" }
            : (m.key === "linkedin" && viewActionRaw)
              ? { ...viewActionRaw, href: normalizeExternalHref(blockDrivenViewHref || linkedinUrl) || "#" }
              : viewActionRaw,
    );

    const resolvedBubbleProgressRaw = (m.key === "site_inrcy")
      ? getSiteBubbleProgress("site_inrcy")
      : (m.key === "site_web")
        ? getSiteBubbleProgress("site_web")
        : (immediateConnectedStatus && !blockRequiresAttention)
          ? immediateConnectedStatus
          : blockDrivenStatus ?? (() => {
          if (m.key === "inrbadge") {
            if (!inrBadgeProfileCheckReady) {
              return { status: "available" as ModuleStatus, text: "Synchronisation…" };
            }
            return inrBadgeProfileReady
              ? { status: "connected" as ModuleStatus, text: copy.status.connected }
              : { status: "available" as ModuleStatus, text: copy.status.disconnected };
          }
          if (m.key === "instagram") return instagramConnected ? { status: "connected" as ModuleStatus, text: copy.status.connected } : { status: "available" as ModuleStatus, text: copy.status.toConnect };
          if (m.key === "linkedin") return linkedinConnected ? { status: "connected" as ModuleStatus, text: copy.status.connected } : { status: "available" as ModuleStatus, text: copy.status.toConnect };
          if (m.key === "gmb") return gmbConnected ? { status: "connected" as ModuleStatus, text: copy.status.connected } : { status: "available" as ModuleStatus, text: copy.status.toConnect };
          if (m.key === "facebook") return facebookPageConnected ? { status: "connected" as ModuleStatus, text: copy.status.connected } : { status: "available" as ModuleStatus, text: copy.status.toConnect };
          if (m.key === "mails") {
            const count = Math.max(0, Math.round(Number(mailAccountsConnectedCount) || 0));
            return count > 0
              ? { status: "connected" as ModuleStatus, text: copy.status.connected }
              : { status: "available" as ModuleStatus, text: copy.status.toConnect };
          }
          if (m.key === "tiktok") return tiktokConnected ? { status: "connected" as ModuleStatus, text: copy.status.connected } : { status: "available" as ModuleStatus, text: copy.status.toConnect };
          if (m.key === "youtube_shorts") return youtubeShortsConnected ? { status: "connected" as ModuleStatus, text: copy.status.connected } : { status: "available" as ModuleStatus, text: copy.status.toConnect };
          if (m.key === "pinterest") return pinterestConnected ? { status: "connected" as ModuleStatus, text: copy.status.connected } : { status: "available" as ModuleStatus, text: copy.status.toConnect };
          if (m.key === "inr_search") {
            if (inrSearchConnected === null) return { status: "available" as ModuleStatus, text: "Synchronisation…" };
            return inrSearchConnected
              ? { status: "connected" as ModuleStatus, text: "Page publiée" }
              : { status: "available" as ModuleStatus, text: "Page indisponible" };
          }
          if (m.key === "inr_agent") return { status: "connected" as ModuleStatus, text: copy.status.connected };
          return { status: m.status, text: statusLabel(m.status, language) };
          })();

    const resolvedBubbleProgress = {
      ...resolvedBubbleProgressRaw,
      text: translateDashboardStatusText(resolvedBubbleProgressRaw.text, language),
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
          ? (blockDrivenViewHref || normalizeExternalHref(instagramUrl) || "#")
          : m.key === "linkedin"
            ? (blockDrivenViewHref || normalizeExternalHref(linkedinUrl) || "#")
            : m.key === "gmb"
              ? (blockDrivenViewHref || normalizeExternalHref(gmbUrl) || "#")
              : m.key === "facebook"
                ? (blockDrivenViewHref || normalizeExternalHref(facebookUrl) || "#")
                : m.key === "tiktok"
                  ? (blockDrivenViewHref || normalizeExternalHref(tiktokUrl) || "#")
                  : m.key === "youtube_shorts"
                    ? (blockDrivenViewHref || normalizeExternalHref(youtubeShortsUrl) || "#")
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
          ? Boolean(blockDrivenViewHref || instagramUrl)
          : m.key === "linkedin"
            ? Boolean(blockDrivenViewHref || linkedinUrl)
            : m.key === "gmb"
              ? Boolean(blockDrivenViewHref || gmbUrl)
              : m.key === "facebook"
                ? Boolean(blockDrivenViewHref || facebookUrl)
                : m.key === "tiktok"
                  ? Boolean(blockDrivenViewHref || tiktokUrl)
                  : m.key === "youtube_shorts"
                    ? Boolean(blockDrivenViewHref || youtubeShortsUrl)
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
            ? "Vérification de votre profil…"
            : undefined,
      // Toutes les bulles ouvrent leur panneau de configuration avec le même
      // libellé. La connexion réelle se fait ensuite dans le panneau dédié.
      configureLabel: m.key === "inr_agent"
        ? moduleCopy?.view || "Ouvrir"
        : copy.bubble.configure,
      viewFallbackLabel: copy.bubble.viewFallback,
    };
  });
}
