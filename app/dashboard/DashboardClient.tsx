"use client";

import styles from "./dashboard.module.css";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import SettingsDrawer from "./SettingsDrawer";
import HelpButton from "./_components/HelpButton";
import DashboardHelpModals from "./_components/DashboardHelpModals";
import DashboardHero from "./_components/DashboardHero";
import GeneratorSettingsModal from "./_components/GeneratorSettingsModal";
import DashboardTopbar from "./_components/DashboardTopbar";
import { useDashboardEdition } from "./_components/DashboardEditionProvider";
import { useDashboardUnsavedNavigation } from "./_components/DashboardUnsavedNavigationProvider";
import DashboardChannelsSection from "./_components/DashboardChannelsSection";
import DashboardBoosterModalLayer from "./_components/DashboardBoosterModalLayer";
import DashboardSettingsDrawerContent from "./_components/DashboardSettingsDrawerContent";
import DashboardOnboardingAiChoice from "./_components/DashboardOnboardingAiChoice";
import { StableBootScreen } from "./_components/ClientHydrationGate";
import InrBadgePreviewModal from "./_components/InrBadgePreviewModal";
import { useDrawerMutationGuard } from "./_hooks/useDrawerMutationGuard";
import { useUnsavedExitGuard } from "./_hooks/useUnsavedExitGuard";
import { useDashboardNotifications } from "./_hooks/useDashboardNotifications";
import { useReferralForm } from "./_hooks/useReferralForm";
import { useDashboardPanelRouting } from "./_hooks/useDashboardPanelRouting";
import { useDashboardCompletionChecks } from "./_hooks/useDashboardCompletionChecks";
import { useDashboardOnboardingState } from "./_hooks/useDashboardOnboardingState";
import { useDashboardMenus } from "./_hooks/useDashboardMenus";
import { useDashboardLanguage } from "./_hooks/useDashboardLanguage";
import { useFacebookChannel } from "./_hooks/channels/useFacebookChannel";
import { useInstagramChannel } from "./_hooks/channels/useInstagramChannel";
import { useLinkedinChannel } from "./_hooks/channels/useLinkedinChannel";
import { useGoogleBusinessChannel } from "./_hooks/channels/useGoogleBusinessChannel";
import { useSiteInrcyChannel } from "./_hooks/channels/useSiteInrcyChannel";
import { useSiteWebChannel } from "./_hooks/channels/useSiteWebChannel";
import { useTiktokChannel } from "./_hooks/channels/useTiktokChannel";

// ✅ IMPORTANT : même client que ta page login
import { createClient } from "@/lib/supabaseClient";
import {
  getActiveBrowserUserId,
  purgeAllBrowserAccountCaches,
  readAccountCacheValue,
  resolveActiveBrowserUserId,
  setActiveBrowserUserId,
  writeAccountCacheValue,
} from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { expectedUiSnapshotDate, getLastChannelSyncAt, getOverviewSnapshotDate, hasFreshLocalGeneratorSnapshot, markChannelsSynced, mergeChannelBlockIntoCachedSnapshots, mergeGeneratorChannelBlockIntoCachedKpis, syncGeneratorOpportunitiesFromStatsSummary, readCachedChannelBlocks, readCachedChannelSyncAt, readCachedGeneratorChannelSyncAt, readCachedOppTotal, readGeneratorCache, readInrStatsPeriodSyncAt, statsCubeSessionKey, statsSummarySessionKey, type StatsWarmPeriod, writeUiCacheValue } from "./dashboard.client-cache";
import { markDailyStatsRefreshBootstrapChecked, markServerCacheSyncChecked, runDailyStatsRefreshBootstrap, wasDailyStatsRefreshBootstrapCheckedRecently, wasServerCacheSyncCheckedRecently, type DailyStatsRefreshBootstrapResponse } from "@/lib/dailyStatsRefreshClient";
import { buildBubbleAccessMap, isBubbleEnabled, type AppBubbleAccessMap } from "@/lib/bubbleAccess";
import { computeInertiaSnapshot } from "@/lib/loyalty/inertia";
import { PROFILE_VERSION_EVENT, type ProfileVersionChangeDetail } from "@/lib/profileVersioning";
import { resolveProfileLogoUrl } from "@/lib/profileLogo";
import { PUBLIC_PROFILE_DATA_SAVED_EVENT } from "@/lib/publicProfileRefreshClient";
import { getDrawerTitle, isDrawerPanel } from "./dashboard.utils";
import { inferChannelsFromRealtimePayload, inferChannelsFromSearchParams } from "./dashboard.shared";
import type { ActusFont, GoogleProduct, GoogleSource, Ownership } from "./dashboard.types";
import { normalizeActusAccent, normalizeActusDesign, normalizeActusLayout, normalizeActusTheme } from "./dashboard.types";
import { DASHBOARD_CHANNEL_KEYS, type DashboardChannelKey } from "@/lib/dashboardChannels";
import {
  getDashboardOnboardingPanel,
  getDashboardOnboardingProgress,
  type DashboardOnboardingInitialState,
} from "@/lib/dashboardOnboarding";
import { buildFluxBubbleItems } from "./dashboard.flux-bubbles";
import { createInrBadgePublicUrl, type InrBadgeProfileSummary } from "@/lib/inrBadge";
import { buildDashboardPanelProps } from "./dashboard.panel-props";
import { createEmptyChannelBlock, createEmptyChannelBlocks, type InrstatsChannelBlock, type InrstatsChannelBlocksByChannel } from "@/lib/inrstats/channelBlocks";
import { getDashboardTranslations } from "@/lib/dashboardI18n";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import { isDashboardRequiredSetupProtectedDestination, isDashboardRequiredSetupProtectedLocation } from "@/lib/dashboardRequiredSetupAccess";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { reportHandledClientError } from "@/lib/clientExpectedErrors";
import { fetchSharedDashboardRefreshJson } from "@/lib/dashboardRefreshOrchestrator";
import {
  STANDARD_BONUS_CHANNEL_KEYS,
  STANDARD_PUBLICATION_CHANNEL_KEYS,
} from "@/lib/dashboardEdition";


import {
  AUTO_DAILY_REFRESH_DEDUP_MS,
  CHANNEL_REFRESH_DEDUP_MS,
  FORCED_SERVER_CACHE_CHECK_DEDUP_MS,
  GENERATOR_ACTIVE_CACHE_KEY,
  GENERATOR_POWER_CACHE_KEY,
  GENERATOR_POWER_SETTLE_MS,
  SITE_BUBBLE_PROGRESS_CACHE_KEY,
  createUnverifiedBubbleAccessMap,
  getRuntimeInrSearchOrigin,
  isConnectionStatus,
  isOwnership,
  mergeCachedDashboardChannelState,
  readCachedBubbleAccessMap,
  readCachedDashboardBoolean,
  readCachedDashboardChannelState,
  readCachedDashboardOptionalBoolean,
  readCachedDashboardString,
  readCachedGeneratorIsActive,
  readCachedGeneratorPowerPercent,
  readCachedGeneratorPowerSnapshot,
  readCachedInrBadgeProfile,
  readCachedInrSearchConnected,
  readCachedInrSearchDirectoryEnabled,
  readCachedMailAccountsConnectedCount,
  readCachedSiteBubbleProgress,
  readCachedSiteInrcyDisplayAccess,
  sanitizeCachedInrBadgeProfile,
  sanitizeGeneratorPowerSnapshot,
  sanitizeMailAccountsConnectedCount,
  writeCachedBubbleAccessMap,
  writeCachedDashboardChannelState,
  writeCachedGeneratorPowerSnapshot,
  type ChannelRefreshOptions,
  type ChannelStatsRefreshResult,
  type GeneratorChannelRefreshResult,
  type GeneratorPowerSnapshot,
  type SiteBubbleProgress,
  type SiteBubbleProgressCache,
} from "./dashboard.bootstrap-cache";

const useBrowserLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const STANDARD_DASHBOARD_BUBBLE_KEYS = new Set<string>([
  ...STANDARD_PUBLICATION_CHANNEL_KEYS,
  ...STANDARD_BONUS_CHANNEL_KEYS,
]);

type DashboardClientProps = {
  isAdmin?: boolean;
  initialOnboardingState?: DashboardOnboardingInitialState;
};

export default function DashboardClient({
  isAdmin = false,
  initialOnboardingState,
}: DashboardClientProps) {
  const [helpGeneratorOpen, setHelpGeneratorOpen] = useState(false);
  const [generatorSettingsOpen, setGeneratorSettingsOpen] = useState(false);
  const [helpCanauxOpen, setHelpCanauxOpen] = useState(false);
  const [helpSiteInrcyOpen, setHelpSiteInrcyOpen] = useState(false);
  const [helpSiteWebOpen, setHelpSiteWebOpen] = useState(false);
  const [helpInertieOpen, setHelpInertieOpen] = useState(false);
  const [helpInstagramOpen, setHelpInstagramOpen] = useState(false);
  const [helpFacebookOpen, setHelpFacebookOpen] = useState(false);
  const [dashboardBoosterModal, setDashboardBoosterModal] = useState<null | "publish" | "stats">(null);
  const [siteConnectionsReady, setSiteConnectionsReady] = useState(false);
  const [bubbleAccessReady, setBubbleAccessReady] = useState(false);
  const [displayedSiteInrcyAccess, setDisplayedSiteInrcyAccess] = useState(() => readCachedSiteInrcyDisplayAccess());
  const [mailAccountsConnectedCount, setMailAccountsConnectedCount] = useState(() => readCachedMailAccountsConnectedCount() ?? 0);
  const [youtubeShortsConnected, setYoutubeShortsConnected] = useState(() => readCachedDashboardBoolean("youtubeShortsConnected"));
  const [youtubeShortsUrl, setYoutubeShortsUrl] = useState(() => readCachedDashboardString("youtubeShortsUrl"));
  const [pinterestConnected, setPinterestConnected] = useState(() => readCachedDashboardBoolean("pinterestConnected"));
  const [pinterestUrl, setPinterestUrl] = useState(() => readCachedDashboardString("pinterestUrl"));
  const [inrSearchConnected, setInrSearchConnected] = useState<boolean | null>(() => readCachedInrSearchConnected());
  const [inrSearchUrl, setInrSearchUrl] = useState(() => readCachedDashboardString("inrSearchUrl"));
  const [inrSearchDirectoryEnabled, setInrSearchDirectoryEnabled] = useState<boolean | null>(() => readCachedInrSearchDirectoryEnabled());
  const [inrBadgeProfile, setInrBadgeProfile] = useState<InrBadgeProfileSummary>(() => readCachedInrBadgeProfile());
  const [lastKnownInrBadgeProfileReady, setLastKnownInrBadgeProfileReady] = useState<boolean | null>(
    () => readCachedDashboardOptionalBoolean("inrBadgeProfileReady"),
  );
  const [inrBadgeModalOpen, setInrBadgeModalOpen] = useState(false);
  const [displayedGeneratorPower, setDisplayedGeneratorPower] = useState<number | null>(
    () => readCachedGeneratorPowerPercent() ?? readCachedGeneratorPowerSnapshot()?.power ?? null,
  );
  const [displayedGeneratorPowerSnapshot, setDisplayedGeneratorPowerSnapshot] = useState<GeneratorPowerSnapshot | null>(
    () => readCachedGeneratorPowerSnapshot(),
  );
  const [displayedGeneratorIsActive, setDisplayedGeneratorIsActive] = useState<boolean | null>(() => readCachedGeneratorIsActive());
  const [displayedSiteBubbleProgress, setDisplayedSiteBubbleProgress] = useState<SiteBubbleProgressCache>(() => readCachedSiteBubbleProgress());
  const router = useRouter();
  const searchParams = useSearchParams();
  const dashboardEdition = useDashboardEdition();
  const isStandardEdition = dashboardEdition === "standard";
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const { language: dashboardLanguage } = useDashboardLanguage();
  const dashboardCopy = useMemo(() => getDashboardTranslations(dashboardLanguage), [dashboardLanguage]);
  const { panel, openPanel, replacePanelDirect, closePanel, goToModule } = useDashboardPanelRouting();
  const {
    profileIncomplete,
    activityIncomplete,
    profileCompleted,
    activityCompleted,
    profileCheckReady,
    activityCheckReady,
    completionCheckReady,
    requiredSetupCompleted,
    requiredSetupIncomplete,
    checkProfile,
    checkActivity,
  } = useDashboardCompletionChecks();
  // Les boutons restent immédiatement cliquables pendant la vérification.
  // Seul un état incomplet déjà confirmé bloque réellement la destination.
  const requiredSetupAccessAllowed = !completionCheckReady || requiredSetupCompleted;
  const requiredSetupLockVisible = completionCheckReady && requiredSetupIncomplete;
  const onboardingState = useDashboardOnboardingState(initialOnboardingState);
  const {
    accountId: onboardingAccountId,
    onboardingStatus,
    onboardingCurrentStep,
    setCurrentOnboardingStep,
    deferOnboarding,
    completeOnboarding,
  } = onboardingState;
  const guidedOnboardingPanel = getDashboardOnboardingPanel(onboardingCurrentStep);
  const guidedOnboardingProgress = getDashboardOnboardingProgress(onboardingCurrentStep);
  const guidedOnboardingActive =
    onboardingStatus === "in_progress" &&
    guidedOnboardingPanel !== null &&
    guidedOnboardingProgress !== null;
  const isGuidedOnboardingPanel = guidedOnboardingActive && panel === guidedOnboardingPanel;
  const onboardingProgressLabel = isGuidedOnboardingPanel && guidedOnboardingProgress
    ? `Configuration initiale · Étape ${guidedOnboardingProgress.current}/${guidedOnboardingProgress.total}`
    : undefined;
  const onboardingStateLoading = !onboardingState.onboardingReady;
  const onboardingInitialPreparationBlocking =
    guidedOnboardingActive &&
    guidedOnboardingPanel !== null &&
    panel !== guidedOnboardingPanel;
  const onboardingAutoOpenKeyRef = useRef<string | null>(null);
  const onboardingSkipConfirmingRef = useRef(false);
  const [onboardingAiMode, setOnboardingAiMode] = useState<"choice" | "configure">("choice");
  const [onboardingAiCompleting, setOnboardingAiCompleting] = useState(false);
  const [settingsDrawerHasUnsavedChanges, setSettingsDrawerHasUnsavedChanges] = useState(false);
  const settingsDrawerGuardActive = panel === "ia" || panel === "preferences" || panel === "documents" || panel === "mails" || panel === "compte" || panel === "parrainage" || panel === "profil" || panel === "activite" || panel === "youtube_shorts" || panel === "pinterest";
  const settingsDrawerRequiresExplicitClose = settingsDrawerGuardActive || panel === "profil" || panel === "activite";

  useEffect(() => {
    setSettingsDrawerHasUnsavedChanges(false);
  }, [panel]);

  useEffect(() => {
    setOnboardingAiMode("choice");
    setOnboardingAiCompleting(false);
  }, [onboardingAccountId, onboardingCurrentStep]);

  useEffect(() => {
    if (!guidedOnboardingActive || !guidedOnboardingPanel) {
      onboardingAutoOpenKeyRef.current = null;
      return;
    }

    const autoOpenKey = `${onboardingAccountId ?? "unknown"}:${onboardingCurrentStep}`;
    const openingKey = `opening:${autoOpenKey}`;
    const openedKey = `opened:${autoOpenKey}`;

    if (panel === guidedOnboardingPanel) {
      onboardingAutoOpenKeyRef.current = openedKey;
      try {
        sessionStorage.setItem("inrcy_panel_explicit_open", "1");
        sessionStorage.setItem("inrcy_last_panel", guidedOnboardingPanel);
      } catch {}
      return;
    }
    if (onboardingAutoOpenKeyRef.current === openingKey) return;

    onboardingAutoOpenKeyRef.current = openingKey;
    openPanel(guidedOnboardingPanel);
  }, [
    guidedOnboardingActive,
    guidedOnboardingPanel,
    onboardingAccountId,
    onboardingCurrentStep,
    openPanel,
    panel,
  ]);

  const closeSettingsDrawer = useCallback(async () => {
    if (isGuidedOnboardingPanel) {
      onboardingAutoOpenKeyRef.current = `closing:${onboardingAccountId ?? "unknown"}:${onboardingCurrentStep}`;
      if (onboardingCurrentStep === "ai") {
        await completeOnboarding();
      } else {
        await deferOnboarding();
      }
    }
    closePanel();
  }, [
    closePanel,
    completeOnboarding,
    deferOnboarding,
    isGuidedOnboardingPanel,
    onboardingAccountId,
    onboardingCurrentStep,
  ]);

  const guidedSkipIsAiStep = isGuidedOnboardingPanel && onboardingCurrentStep === "ai";
  const guidedSkipUnsavedPrefix = settingsDrawerHasUnsavedChanges
    ? "Les modifications non enregistrées seront perdues. "
    : "";
  const guidedSkipTitle = guidedSkipIsAiStep
    ? "Conserver les réglages par défaut ?"
    : "Continuer plus tard ?";
  const guidedSkipMessage = guidedSkipIsAiStep
    ? `${guidedSkipUnsavedPrefix}Votre IA conservera les réglages recommandés par défaut. Vous pourrez les personnaliser plus tard depuis Configuration IA.`
    : `${guidedSkipUnsavedPrefix}Passer cette étape ne permet pas l’activation de tous les outils iNrCy. Vous pourrez reprendre la configuration depuis le dashboard. Voulez-vous continuer plus tard ?`;
  const guidedSkipConfirmLabel = guidedSkipIsAiStep
    ? "Conserver par défaut"
    : "Continuer plus tard";

  const { confirmExit: confirmSettingsDrawerExit } = useUnsavedExitGuard({
    active: settingsDrawerGuardActive,
    shouldBlock: isGuidedOnboardingPanel || settingsDrawerHasUnsavedChanges,
    onConfirmExit: () => {
      void closeSettingsDrawer();
    },
    eyebrow: isGuidedOnboardingPanel ? "Configuration initiale" : "Réglages",
    title: isGuidedOnboardingPanel ? guidedSkipTitle : "Quitter sans enregistrer ?",
    message: isGuidedOnboardingPanel
      ? guidedSkipMessage
      : "Cette fenêtre contient des modifications non enregistrées. Si vous la fermez maintenant, elles seront perdues.",
    confirmLabel: isGuidedOnboardingPanel ? guidedSkipConfirmLabel : "Fermer sans enregistrer",
    cancelLabel: isGuidedOnboardingPanel ? "Revenir à la configuration" : "Continuer l’édition",
    variant: "warning",
  });

  const requestSkipGuidedOnboarding = useCallback(async () => {
    if (!isGuidedOnboardingPanel || onboardingSkipConfirmingRef.current) return;

    onboardingSkipConfirmingRef.current = true;
    try {
      const confirmed = await confirmInrcy({
        eyebrow: "Configuration initiale",
        title: guidedSkipTitle,
        message: guidedSkipMessage,
        confirmLabel: guidedSkipConfirmLabel,
        cancelLabel: "Revenir à la configuration",
        variant: "warning",
      });
      if (!confirmed) return;
      await closeSettingsDrawer();
    } finally {
      onboardingSkipConfirmingRef.current = false;
    }
  }, [
    closeSettingsDrawer,
    guidedSkipConfirmLabel,
    guidedSkipMessage,
    guidedSkipTitle,
    isGuidedOnboardingPanel,
  ]);

  const requestCloseSettingsDrawer = useCallback(() => {
    if (isGuidedOnboardingPanel) {
      void requestSkipGuidedOnboarding();
      return;
    }
    if (!settingsDrawerGuardActive) {
      void closeSettingsDrawer();
      return;
    }
    void confirmSettingsDrawerExit();
  }, [
    closeSettingsDrawer,
    confirmSettingsDrawerExit,
    isGuidedOnboardingPanel,
    requestSkipGuidedOnboarding,
    settingsDrawerGuardActive,
  ]);

  const handleSettingsDrawerUnsavedChange = useCallback((hasUnsavedChanges: boolean) => {
    setSettingsDrawerHasUnsavedChanges(hasUnsavedChanges);
  }, []);

  const advanceOnboardingFromProfile = useCallback(async () => {
    const completion = await checkProfile();
    if (!completion?.profileCompleted) return;

    // La sauvegarde a déjà nettoyé le formulaire. On prépare la prochaine
    // étape avant la mutation afin que l'effet d'auto-ouverture ne repasse pas
    // par le guard pendant le changement d'état React.
    setSettingsDrawerHasUnsavedChanges(false);
    onboardingAutoOpenKeyRef.current = `opening:${onboardingAccountId ?? "unknown"}:activity`;
    const row = await setCurrentOnboardingStep("activity");
    if (!row) {
      onboardingAutoOpenKeyRef.current = null;
      return;
    }
    replacePanelDirect("activite");
  }, [checkProfile, onboardingAccountId, replacePanelDirect, setCurrentOnboardingStep]);

  const advanceOnboardingFromActivity = useCallback(async () => {
    const completion = await checkActivity();
    if (!completion?.activityCompleted) return;

    setSettingsDrawerHasUnsavedChanges(false);
    setOnboardingAiMode("choice");
    onboardingAutoOpenKeyRef.current = `opening:${onboardingAccountId ?? "unknown"}:ai`;
    const row = await setCurrentOnboardingStep("ai");
    if (!row) {
      onboardingAutoOpenKeyRef.current = null;
      return;
    }
    replacePanelDirect("ia");
  }, [checkActivity, onboardingAccountId, replacePanelDirect, setCurrentOnboardingStep]);

  const completeOnboardingFromAi = useCallback(async () => {
    if (onboardingAiCompleting) return;
    setOnboardingAiCompleting(true);
    setSettingsDrawerHasUnsavedChanges(false);
    onboardingAutoOpenKeyRef.current = `closing:${onboardingAccountId ?? "unknown"}:ai`;
    const row = await completeOnboarding();
    if (!row) {
      onboardingAutoOpenKeyRef.current = null;
      setOnboardingAiCompleting(false);
      return;
    }
    closePanel();
  }, [closePanel, completeOnboarding, onboardingAccountId, onboardingAiCompleting]);

  const openRequiredSetupPanel = useCallback(() => {
    openPanel(profileIncomplete ? "profil" : activityIncomplete ? "activite" : "profil");
  }, [activityIncomplete, openPanel, profileIncomplete]);

  const goToRequiredSetupAwareModule = useCallback((path: string) => {
    if (isDashboardRequiredSetupProtectedDestination(path) && !requiredSetupAccessAllowed) {
      openRequiredSetupPanel();
      return;
    }
    goToModule(path);
  }, [goToModule, openRequiredSetupPanel, requiredSetupAccessAllowed]);

  const navigateDashboardCta = useCallback((ctaUrl: string) => {
    if (isDashboardRequiredSetupProtectedDestination(ctaUrl) && !requiredSetupAccessAllowed) {
      openRequiredSetupPanel();
      return;
    }

    void requestNavigation(() => {
      if (ctaUrl.startsWith("/")) {
        router.push(ctaUrl);
      } else {
        window.location.href = ctaUrl;
      }
    });
  }, [openRequiredSetupPanel, requestNavigation, requiredSetupAccessAllowed, router]);

  const openBoosterPublish = useCallback(() => {
    if (!requiredSetupAccessAllowed) {
      openRequiredSetupPanel();
      return;
    }

    void requestNavigation(() => {
      // L'URL est aussi l'état partagé avec le bandeau mobile. Sans ce
      // paramètre, l'ouverture locale de la modale laisse le bouton « Publier »
      // actif sur le Dashboard.
      setDashboardBoosterModal("publish");
      router.replace("/dashboard?action=publish", { scroll: false });
    });
  }, [openRequiredSetupPanel, requestNavigation, requiredSetupAccessAllowed, router]);

  const openBoosterStats = useCallback(() => {
    if (!requiredSetupAccessAllowed) {
      openRequiredSetupPanel();
      return;
    }
    setDashboardBoosterModal("stats");
  }, [openRequiredSetupPanel, requiredSetupAccessAllowed]);

  const openStatsModule = useCallback(() => {
    void requestNavigation(() => {
      try {
        sessionStorage.setItem("inrcy_dashboard_scrollY", String(window.scrollY ?? 0));
      } catch {}

      router.push("/dashboard/stats");

      window.setTimeout(() => {
        if (window.location.pathname !== "/dashboard/stats") {
          window.location.assign("/dashboard/stats");
        }
      }, 120);
    });
  }, [requestNavigation, router]);

  useEffect(() => {
    if (!completionCheckReady) return;

    if (
      !requiredSetupCompleted &&
      isDashboardRequiredSetupProtectedLocation("/dashboard", searchParams)
    ) {
      setDashboardBoosterModal(null);
      router.replace("/dashboard", { scroll: false });
      return;
    }

    const action = searchParams.get("action");
    const stats = searchParams.get("stats");
    if (action === "publish") {
      setDashboardBoosterModal("publish");
    } else if (stats === "1") {
      setDashboardBoosterModal("stats");
    }
  }, [completionCheckReady, requiredSetupCompleted, router, searchParams]);

  // Orientation: gérée globalement via <OrientationGuard />

  // ✅ Déconnexion Supabase + retour /login
  const handleLogout = async () => {
    const supabase = createClient();
    setActiveBrowserUserId(null);
    const { error } = await (supabase.auth.signOut as any)({ scope: "local" }).catch(() => ({ error: null as { message?: string } | null }));
    if (error) {
      console.error("Erreur déconnexion:", error.message);
      return;
    }
    window.location.replace("/login");
  };

  const {
    notifications,
    notificationsLoading,
    notificationsError,
    unreadNotificationsCount,
    refreshNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
  } = useDashboardNotifications();
  const kpisRequestSeqRef = useRef(0);
  const siteConfigRequestSeqRef = useRef(0);
  const inrSearchSettingsRequestRef = useRef<Promise<void> | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const latestApplyBootstrapRefreshRef = useRef<((bootstrap: DailyStatsRefreshBootstrapResponse) => { syncAt: number; bootstrapSnapshotDate: string | null }) | null>(null);
  const latestSyncFromServerCacheIfNeededRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  const latestFallbackToServerSyncThenGlobalRef = useRef<(() => Promise<void>) | null>(null);
  const latestTriggerChannelsRefreshRef = useRef<((channelsInput: DashboardChannelKey[]) => Promise<void>) | null>(null);
  const initialGeneratorRefreshDoneRef = useRef(false);
  const lastAutoDailyRefreshAtRef = useRef(0);
  const dashboardChannelCacheLastWriteRef = useRef("");
  const [kpisLoading, setKpisLoading] = useState(false);
  const [dailyBootReady, setDailyBootReady] = useState(false);
  const [kpis, setKpis] = useState<null | {
    leads: { today: number; week: number; month: number };
    estimatedValue: number;
  }>(null);
  const [oppTotal, setOppTotal] = useState<number | null>(null);
  const [channelBlocks, setChannelBlocks] = useState<InrstatsChannelBlocksByChannel | null>(() => readCachedChannelBlocks());
  const channelBlocksRef = useRef<InrstatsChannelBlocksByChannel | null>(channelBlocks);

  useEffect(() => {
    channelBlocksRef.current = channelBlocks;
  }, [channelBlocks]);
  const { runDrawerMutation, isDrawerMutationPending } = useDrawerMutationGuard();

  useBrowserLayoutEffect(() => {
    try {
      const cached = readGeneratorCache();
      const payload = cached?.payload;
      if (payload?.leads) {
        setKpis(payload);
        const oppMonth = Number(payload?.details?.opportunities?.month);
        if (Number.isFinite(oppMonth)) {
          setOppTotal(oppMonth);
        }
      }
    } catch {
      // ignore
    }

    const cachedOppTotal = readCachedOppTotal();
    if (cachedOppTotal !== null) {
      setOppTotal((prev) => prev ?? cachedOppTotal);
    }

    const cachedBlocks = readCachedChannelBlocks();
    if (cachedBlocks) {
      setChannelBlocks(cachedBlocks);
    }
  }, []);

  const extractDomain = useCallback((input: string) => {
    const url = (input || "").trim();
    if (!url) return "";
    try {
      const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      return new URL(withProto).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return url
        .toLowerCase()
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .split("/")[0];
    }
  }, []);

  const normalizeSiteUrl = useCallback((input: string) => {
    const raw = (input || "").trim();
    if (!raw) return null;
    try {
      const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      const parsed = new URL(withProto);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (!hostname || !hostname.includes(".")) return null;
      if (!["http:", "https:"].includes(parsed.protocol)) return null;
      return {
        normalizedUrl: withProto,
        hostname,
      };
    } catch {
      return null;
    }
  }, []);

  const fetchWidgetToken = useCallback(async (domain: string, source: "inrcy_site" | "site_web") => {
    if (!domain) return "";
    try {
      const res = await fetch(
        `/api/widgets/issue-token?domain=${encodeURIComponent(domain)}&source=${encodeURIComponent(source)}`,
        { method: "GET", credentials: "include" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) return "";
      return String(json.token || "");
    } catch {
      // Une indisponibilité réseau ne doit pas faire échouer le dashboard.
      return "";
    }
  }, []);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const {
    userMenuOpen,
    setUserMenuOpen,
    userMenuRef,
    notificationMenuOpen,
    setNotificationMenuOpen,
    desktopNotificationMenuRef,
    mobileNotificationMenuRef,
    userFirstLetter,
  } = useDashboardMenus(userEmail);

const {
  referralName,
  referralPhone,
  referralEmail,
  referralFrom,
  referralSubmitting,
  referralNotice,
  referralError,
  setReferralName,
  setReferralPhone,
  setReferralEmail,
  setReferralFrom,
  submitReferral,
} = useReferralForm();
const patchChannelConnectionLocallyRef = useRef<(
  channel: DashboardChannelKey,
  patch: Partial<InrstatsChannelBlock["connection"]>,
  options?: { clearData?: boolean; clearError?: boolean },
) => void>(() => {});
const triggerChannelRefreshRef = useRef<(channel: DashboardChannelKey) => Promise<void>>(async () => {});

const [bubbleAccessMap, setBubbleAccessMap] = useState<AppBubbleAccessMap>(() => readCachedBubbleAccessMap());
const canAccessSiteInrcy = isBubbleEnabled(bubbleAccessMap, "site_inrcy");
const canAccessInrAgent = isBubbleEnabled(bubbleAccessMap, "inr_agent");
const canAccessPinterest = isBubbleEnabled(bubbleAccessMap, "pinterest");
const canAccessInrSearch = isBubbleEnabled(bubbleAccessMap, "inr_search");

const patchChannelConnectionLocallyProxy = useCallback((
  channel: DashboardChannelKey,
  patch: Partial<InrstatsChannelBlock["connection"]>,
  options?: { clearData?: boolean; clearError?: boolean },
) => patchChannelConnectionLocallyRef.current(channel, patch, options), []);

const triggerChannelRefreshProxy = useCallback(
  (channel: DashboardChannelKey) => triggerChannelRefreshRef.current(channel),
  []
);

const updateRootSettingsKey = useCallback(
  async (key: "gmb" | "facebook" | "instagram" | "linkedin", nextObj: any) => {
    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;

    const { data: row, error: readErr } = await supabase
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", resolveActiveBrowserUserId(user.id))
      .maybeSingle();

    if (readErr) return;

    const current = (row as any)?.settings ?? {};
    const merged = { ...(current ?? {}), [key]: nextObj ?? {} };

    await supabase.from("pro_tools_configs").upsert({ user_id: resolveActiveBrowserUserId(user.id), settings: merged }, { onConflict: "user_id" });
  },
  []
);

const {
  siteInrcyOwnership,
  setSiteInrcyOwnership,
  siteInrcyUrl,
  setSiteInrcyUrl,
  siteInrcySavedUrl,
  setSiteInrcySavedUrl,
  siteInrcyContactEmail,
  setSiteInrcyContactEmail,
  siteInrcySettingsText,
  setSiteInrcySettingsText,
  siteInrcySettingsError,
  setSiteInrcySettingsError,
  siteInrcyTrackingBusy,
  siteInrcyGa4Notice,
  setSiteInrcyGa4Notice,
  siteInrcyGscNotice,
  setSiteInrcyGscNotice,
  siteInrcyUrlNotice,
  widgetTokenInrcySite,
  siteInrcyActusLayout,
  setSiteInrcyActusLayout,
  siteInrcyActusLimit,
  setSiteInrcyActusLimit,
  siteInrcyActusFont,
  setSiteInrcyActusFont,
  siteInrcyActusDesign,
  setSiteInrcyActusDesign,
  siteInrcyActusTheme,
  setSiteInrcyActusTheme,
  siteInrcyActusAccent,
  setSiteInrcyActusAccent,
  showSiteInrcyWidgetCode,
  setShowSiteInrcyWidgetCode,
  siteInrcyGa4Connected,
  setSiteInrcyGa4Connected,
  siteInrcyGscConnected,
  setSiteInrcyGscConnected,
  ga4MeasurementId,
  setGa4MeasurementId,
  ga4PropertyId,
  setGa4PropertyId,
  gscProperty,
  setGscProperty,
  connectSiteInrcyGa4,
  connectSiteInrcyGsc,
  activateSiteInrcyTracking,
  deactivateSiteInrcyTracking,
  disconnectSiteInrcyGa4,
  disconnectSiteInrcyGsc,
  saveSiteInrcyUrl,
  deleteSiteInrcyUrl,
  saveSiteInrcyActusWidgetSettings,
  resetSiteInrcyAll,
} = useSiteInrcyChannel({
  normalizeSiteUrl,
  extractDomain,
  fetchWidgetToken,
  patchChannelConnectionLocally: patchChannelConnectionLocallyProxy,
  triggerChannelRefresh: triggerChannelRefreshProxy,
});

const {
  siteWebUrl,
  setSiteWebUrl,
  siteWebSavedUrl,
  setSiteWebSavedUrl,
  siteWebSettingsText,
  setSiteWebSettingsText,
  siteWebSettingsError,
  setSiteWebSettingsError,
  siteWebGa4MeasurementId,
  setSiteWebGa4MeasurementId,
  siteWebGa4PropertyId,
  setSiteWebGa4PropertyId,
  siteWebGscProperty,
  setSiteWebGscProperty,
  siteWebGa4Notice,
  setSiteWebGa4Notice,
  siteWebGscNotice,
  setSiteWebGscNotice,
  siteWebUrlNotice,
  widgetTokenSiteWeb,
  siteWebActusLayout,
  setSiteWebActusLayout,
  siteWebActusLimit,
  setSiteWebActusLimit,
  siteWebActusFont,
  setSiteWebActusFont,
  siteWebActusDesign,
  setSiteWebActusDesign,
  siteWebActusTheme,
  setSiteWebActusTheme,
  siteWebActusAccent,
  setSiteWebActusAccent,
  showSiteWebWidgetCode,
  setShowSiteWebWidgetCode,
  siteWebGa4Connected,
  setSiteWebGa4Connected,
  siteWebGscConnected,
  setSiteWebGscConnected,
  saveSiteWebUrl,
  deleteSiteWebUrl,
  saveSiteWebActusWidgetSettings,
  resetSiteWebAll,
  attachWebsiteGoogleAnalytics,
  attachWebsiteGoogleSearchConsole,
  connectSiteWebGa4,
  connectSiteWebGsc,
  disconnectSiteWebGa4,
  disconnectSiteWebGsc,
} = useSiteWebChannel({
  normalizeSiteUrl,
  extractDomain,
  fetchWidgetToken,
  patchChannelConnectionLocally: patchChannelConnectionLocallyProxy,
  triggerChannelRefresh: triggerChannelRefreshProxy,
});

const {
  facebookUrl,
  setFacebookUrl,
  facebookAccountConnected,
  setFacebookAccountConnected,
  facebookPageConnected,
  setFacebookPageConnected,
  facebookConnectionStatus,
  setFacebookConnectionStatus,
  facebookAccountEmail,
  setFacebookAccountEmail,
  facebookUrlNotice,
  facebookUrlError,
  fbPages,
  fbPagesLoading,
  fbPagesPhase,
  fbSelectedPageId,
  setFbSelectedPageId,
  fbSelectedPageName,
  setFbSelectedPageName,
  fbPagesError,
  connectFacebookAccount,
  connectFacebookBusinessAccount,
  disconnectFacebookAccount,
  disconnectFacebookPage,
  loadFacebookPages,
  saveFacebookPage,
  setPanelSuccess: setFacebookPanelSuccess,
  setPanelError: setFacebookPanelError,
} = useFacebookChannel({
  panel,
  searchParams,
  patchChannelConnectionLocally: patchChannelConnectionLocallyProxy,
  triggerChannelRefresh: triggerChannelRefreshProxy,
  updateRootSettingsKey,
});

const {
  instagramUrl,
  setInstagramUrl,
  instagramAccountConnected,
  setInstagramAccountConnected,
  instagramConnected,
  setInstagramConnected,
  instagramConnectionStatus,
  setInstagramConnectionStatus,
  instagramUsername,
  setInstagramUsername,
  instagramUrlNotice,
  instagramUrlError,
  igAccounts,
  igAccountsLoading,
  igAccountsPhase,
  igSelectedPageId,
  setIgSelectedPageId,
  igAccountsError,
  connectInstagramAccount,
  connectInstagramBusinessAccount,
  disconnectInstagramAccount,
  disconnectInstagramProfile,
  loadInstagramAccounts,
  saveInstagramProfile,
  syncInstagramStateFromServer,
  setPanelSuccess: setInstagramPanelSuccess,
  setPanelError: setInstagramPanelError,
} = useInstagramChannel({
  panel,
  searchParams,
  patchChannelConnectionLocally: patchChannelConnectionLocallyProxy,
  triggerChannelRefresh: triggerChannelRefreshProxy,
  updateRootSettingsKey,
});

const {
  linkedinUrl,
  setLinkedinUrl,
  linkedinAccountConnected,
  setLinkedinAccountConnected,
  linkedinConnected,
  setLinkedinConnected,
  linkedinConnectionStatus,
  setLinkedinConnectionStatus,
  linkedinDisplayName,
  setLinkedinDisplayName,
  linkedinUrlNotice,
  setLinkedinUrlNotice,
  linkedinUrlError,
  connectLinkedinAccount,
  connectLinkedinBusinessAccount,
  disconnectLinkedinAccount,
  saveLinkedinProfileUrl,
  linkedinOrganizations,
  linkedinOrganizationsLoading,
  linkedinOrganizationsPhase,
  linkedinOrganizationPickerOpen,
  linkedinSelectedOrganizationId,
  setLinkedinSelectedOrganizationId,
  linkedinSelectedOrganizationName,
  setLinkedinSelectedOrganizationName,
  linkedinShareToPersonalProfile,
  setLinkedinShareToPersonalProfile,
  linkedinShareToPersonalProfileBusy,
  updateLinkedinShareToPersonalProfile,
  loadLinkedinOrganizations,
  selectLinkedinOrganization,
  useLinkedinPersonalProfile,
  setPanelSuccess: setLinkedinPanelSuccess,
  setPanelError: setLinkedinPanelError,
} = useLinkedinChannel({
  panel,
  searchParams,
  patchChannelConnectionLocally: patchChannelConnectionLocallyProxy,
  triggerChannelRefresh: triggerChannelRefreshProxy,
  updateRootSettingsKey,
});

const {
  gmbUrl,
  setGmbUrl,
  gmbConnected,
  setGmbConnected,
  gmbConnectionStatus,
  setGmbConnectionStatus,
  gmbAccountConnected,
  setGmbAccountConnected,
  gmbConfigured,
  setGmbConfigured,
  gmbAccountEmail,
  setGmbAccountEmail,
  gmbUrlNotice,
  gmbUrlError,
  gmbAccounts,
  gmbLocations,
  gmbAccountName,
  gmbLocationName,
  setGmbLocationName,
  gmbLocationLabel,
  setGmbLocationLabel,
  gmbLoadingList,
  gmbLocationsPhase,
  gmbListError,
  connectGmbAccount,
  disconnectGmbAccount,
  disconnectGmbBusiness,
  loadGmbAccountsAndLocations,
  saveGmbLocation,
  setPanelSuccess: setGmbPanelSuccess,
  setPanelError: setGmbPanelError,
} = useGoogleBusinessChannel({
  panel,
  searchParams,
  patchChannelConnectionLocally: patchChannelConnectionLocallyProxy,
  triggerChannelRefresh: triggerChannelRefreshProxy,
  updateRootSettingsKey,
});

const {
  tiktokConnected,
  tiktokUsername,
  tiktokProfileUrl,
  setTiktokProfileUrl,
  tiktokProfileUrlNotice,
  tiktokProfileUrlError,
  tiktokSettingsNotice,
  tiktokSettingsError,
  tiktokLoading,
  connectTiktok,
  disconnectTiktok,
  saveTiktokProfileUrl,
  tiktokPreferredMedia,
  setTiktokPreferredMedia,
  tiktokAllowComments,
  setTiktokAllowComments,
  tiktokAllowDuo,
  setTiktokAllowDuo,
  tiktokAllowStitch,
  setTiktokAllowStitch,
  tiktokPhotoAutoMusic,
  setTiktokPhotoAutoMusic,
  tiktokCommercialContent,
  setTiktokCommercialContent,
  tiktokAiContent,
  setTiktokAiContent,
  saveTiktokDefaults,
  applyTiktokConnectionState,
} = useTiktokChannel({
  panel,
  patchChannelConnectionLocally: patchChannelConnectionLocallyProxy,
  triggerChannelRefresh: triggerChannelRefreshProxy,
});

const applyDashboardChannelState = useCallback((state: Record<string, any> | null, options?: { markReady?: boolean }) => {
  if (!state) return false;

  if (isOwnership(state.siteInrcyOwnership)) setSiteInrcyOwnership(state.siteInrcyOwnership);
  if (typeof state.siteInrcyUrl === "string") setSiteInrcyUrl(state.siteInrcyUrl);
  if (typeof state.siteInrcySavedUrl === "string") setSiteInrcySavedUrl(state.siteInrcySavedUrl);
  if (typeof state.siteInrcyContactEmail === "string") setSiteInrcyContactEmail(state.siteInrcyContactEmail);
  if (typeof state.siteInrcySettingsText === "string") setSiteInrcySettingsText(state.siteInrcySettingsText);
  if (typeof state.ga4MeasurementId === "string") setGa4MeasurementId(state.ga4MeasurementId);
  if (typeof state.ga4PropertyId === "string") setGa4PropertyId(state.ga4PropertyId);
  if (typeof state.gscProperty === "string") setGscProperty(state.gscProperty);
  if (["list", "carousel", "grid", "compact"].includes(String(state.siteInrcyActusLayout))) setSiteInrcyActusLayout(normalizeActusLayout(state.siteInrcyActusLayout));
  if ([3, 5, 10].includes(Number(state.siteInrcyActusLimit))) setSiteInrcyActusLimit(Number(state.siteInrcyActusLimit));
  if (["site", "inter", "poppins", "montserrat", "lora"].includes(String(state.siteInrcyActusFont))) setSiteInrcyActusFont(state.siteInrcyActusFont);
  if (["essential", "classic", "contemporary", "futuristic", "elegant"].includes(String(state.siteInrcyActusDesign))) setSiteInrcyActusDesign(normalizeActusDesign(state.siteInrcyActusDesign));
  if (["white", "dark", "gray", "nature", "sand", "blue", "terracotta", "anthracite", "custom"].includes(String(state.siteInrcyActusTheme))) setSiteInrcyActusTheme(normalizeActusTheme(state.siteInrcyActusTheme));
  setSiteInrcyActusAccent(normalizeActusAccent(state.siteInrcyActusAccent));

  if (typeof state.siteWebSettingsText === "string") setSiteWebSettingsText(state.siteWebSettingsText);
  if (typeof state.siteWebUrl === "string") setSiteWebUrl(state.siteWebUrl);
  if (typeof state.siteWebSavedUrl === "string") setSiteWebSavedUrl(state.siteWebSavedUrl);
  if (typeof state.siteWebGa4MeasurementId === "string") setSiteWebGa4MeasurementId(state.siteWebGa4MeasurementId);
  if (typeof state.siteWebGa4PropertyId === "string") setSiteWebGa4PropertyId(state.siteWebGa4PropertyId);
  if (typeof state.siteWebGscProperty === "string") setSiteWebGscProperty(state.siteWebGscProperty);
  if (["list", "carousel", "grid", "compact"].includes(String(state.siteWebActusLayout))) setSiteWebActusLayout(normalizeActusLayout(state.siteWebActusLayout));
  if ([3, 5, 10].includes(Number(state.siteWebActusLimit))) setSiteWebActusLimit(Number(state.siteWebActusLimit));
  if (["site", "inter", "poppins", "montserrat", "lora"].includes(String(state.siteWebActusFont))) setSiteWebActusFont(state.siteWebActusFont);
  if (["essential", "classic", "contemporary", "futuristic", "elegant"].includes(String(state.siteWebActusDesign))) setSiteWebActusDesign(normalizeActusDesign(state.siteWebActusDesign));
  if (["white", "dark", "gray", "nature", "sand", "blue", "terracotta", "anthracite", "custom"].includes(String(state.siteWebActusTheme))) setSiteWebActusTheme(normalizeActusTheme(state.siteWebActusTheme));
  setSiteWebActusAccent(normalizeActusAccent(state.siteWebActusAccent));

  if (typeof state.instagramUrl === "string") setInstagramUrl(state.instagramUrl);
  if (typeof state.instagramAccountConnected === "boolean") setInstagramAccountConnected(state.instagramAccountConnected);
  if (typeof state.instagramConnected === "boolean") setInstagramConnected(state.instagramConnected);
  if (isConnectionStatus(state.instagramConnectionStatus)) setInstagramConnectionStatus(state.instagramConnectionStatus);
  if (typeof state.instagramUsername === "string") setInstagramUsername(state.instagramUsername);

  if (typeof state.linkedinUrl === "string") setLinkedinUrl(state.linkedinUrl);
  if (typeof state.linkedinAccountConnected === "boolean") setLinkedinAccountConnected(state.linkedinAccountConnected);
  if (typeof state.linkedinConnected === "boolean") setLinkedinConnected(state.linkedinConnected);
  if (isConnectionStatus(state.linkedinConnectionStatus)) setLinkedinConnectionStatus(state.linkedinConnectionStatus);
  if (typeof state.linkedinDisplayName === "string") setLinkedinDisplayName(state.linkedinDisplayName);
  if (typeof state.linkedinSelectedOrganizationId === "string") setLinkedinSelectedOrganizationId(state.linkedinSelectedOrganizationId);
  if (typeof state.linkedinSelectedOrganizationName === "string") setLinkedinSelectedOrganizationName(state.linkedinSelectedOrganizationName);
  if (typeof state.linkedinShareToPersonalProfile === "boolean") setLinkedinShareToPersonalProfile(state.linkedinShareToPersonalProfile);

  if (typeof state.gmbUrl === "string") setGmbUrl(state.gmbUrl);
  if (typeof state.gmbAccountConnected === "boolean") setGmbAccountConnected(state.gmbAccountConnected);
  if (typeof state.gmbConfigured === "boolean") setGmbConfigured(state.gmbConfigured);
  if (typeof state.gmbConnected === "boolean") setGmbConnected(state.gmbConnected);
  if (isConnectionStatus(state.gmbConnectionStatus)) setGmbConnectionStatus(state.gmbConnectionStatus);
  if (typeof state.gmbAccountEmail === "string") setGmbAccountEmail(state.gmbAccountEmail);
  if (typeof state.gmbLocationName === "string") setGmbLocationName(state.gmbLocationName);
  if (typeof state.gmbLocationLabel === "string") setGmbLocationLabel(state.gmbLocationLabel);

  if (typeof state.facebookUrl === "string") setFacebookUrl(state.facebookUrl);
  if (typeof state.facebookAccountConnected === "boolean") setFacebookAccountConnected(state.facebookAccountConnected);
  if (typeof state.facebookPageConnected === "boolean") setFacebookPageConnected(state.facebookPageConnected);
  if (isConnectionStatus(state.facebookConnectionStatus)) setFacebookConnectionStatus(state.facebookConnectionStatus as "connected" | "disconnected" | "needs_update");
  if (typeof state.facebookAccountEmail === "string") setFacebookAccountEmail(state.facebookAccountEmail);
  if (typeof state.fbSelectedPageId === "string") setFbSelectedPageId(state.fbSelectedPageId);
  if (typeof state.fbSelectedPageName === "string") setFbSelectedPageName(state.fbSelectedPageName);
  if (typeof state.youtubeShortsConnected === "boolean") setYoutubeShortsConnected(state.youtubeShortsConnected);
  if (typeof state.youtubeShortsUrl === "string") setYoutubeShortsUrl(state.youtubeShortsUrl);
  if (typeof state.tiktokConnected === "boolean") {
    applyTiktokConnectionState({
      connected: state.tiktokConnected,
      requiresUpdate: Boolean(state.tiktokRequiresUpdate),
      username: typeof state.tiktokUsername === "string" ? state.tiktokUsername : "",
      profileUrl: typeof state.tiktokProfileUrl === "string" ? state.tiktokProfileUrl : "",
    });
  }
  if (typeof state.pinterestConnected === "boolean") setPinterestConnected(state.pinterestConnected);
  if (typeof state.pinterestUrl === "string") setPinterestUrl(state.pinterestUrl);
  if (typeof state.inrSearchConnected === "boolean") setInrSearchConnected(state.inrSearchConnected);
  if (typeof state.inrSearchUrl === "string") setInrSearchUrl(state.inrSearchUrl);
  if (typeof state.inrSearchDirectoryEnabled === "boolean") setInrSearchDirectoryEnabled(state.inrSearchDirectoryEnabled);

  if (typeof state.siteInrcyGa4Connected === "boolean") setSiteInrcyGa4Connected(state.siteInrcyGa4Connected);
  if (typeof state.siteInrcyGscConnected === "boolean") setSiteInrcyGscConnected(state.siteInrcyGscConnected);
  if (typeof state.siteWebGa4Connected === "boolean") setSiteWebGa4Connected(state.siteWebGa4Connected);
  if (typeof state.siteWebGscConnected === "boolean") setSiteWebGscConnected(state.siteWebGscConnected);

  if (Object.prototype.hasOwnProperty.call(state, "mailAccountsConnectedCount")) {
    setMailAccountsConnectedCount(sanitizeMailAccountsConnectedCount(state.mailAccountsConnectedCount));
  }

  if (state.inrBadgeProfile && typeof state.inrBadgeProfile === "object") {
    setInrBadgeProfile(sanitizeCachedInrBadgeProfile(state.inrBadgeProfile));
  }
  if (typeof state.inrBadgeProfileReady === "boolean") {
    setLastKnownInrBadgeProfileReady(state.inrBadgeProfileReady);
  }


  setSiteInrcySettingsError(null);
  setSiteWebSettingsError(null);
  if (options?.markReady) setSiteConnectionsReady(true);
  return true;
}, [
  setFacebookAccountConnected, setFacebookConnectionStatus, setFacebookPageConnected, setFacebookUrl,
  setFbSelectedPageId, setFbSelectedPageName, setGa4MeasurementId, setGa4PropertyId, setGmbAccountConnected,
  setGmbConfigured, setGmbConnected, setGmbConnectionStatus, setGmbLocationLabel, setGmbLocationName, setGmbUrl,
  setGscProperty, setInstagramAccountConnected, setInstagramConnected, setInstagramConnectionStatus, setInstagramUrl,
  setInstagramUsername, setLinkedinAccountConnected, setLinkedinConnected, setLinkedinConnectionStatus,
  setLinkedinDisplayName, setLinkedinSelectedOrganizationId, setLinkedinSelectedOrganizationName, setLinkedinUrl,
  setSiteInrcyActusFont, setSiteInrcyActusLayout, setSiteInrcyActusLimit, setSiteInrcyActusDesign, setSiteInrcyActusTheme, setSiteInrcyActusAccent, setSiteInrcyContactEmail,
  setSiteInrcyGa4Connected, setSiteInrcyGscConnected, setSiteInrcyOwnership, setSiteInrcySavedUrl,
  setSiteInrcySettingsError, setSiteInrcySettingsText, setSiteInrcyUrl, setSiteWebActusFont, setSiteWebActusLayout,
  setSiteWebActusLimit, setSiteWebActusDesign, setSiteWebActusTheme, setSiteWebActusAccent, setSiteWebGa4Connected, setSiteWebGa4MeasurementId,
  setSiteWebGa4PropertyId, setSiteWebGscConnected, setSiteWebGscProperty, setSiteWebSavedUrl,
  setSiteWebSettingsError, setSiteWebSettingsText, setSiteWebUrl, setMailAccountsConnectedCount,
  setYoutubeShortsConnected, setYoutubeShortsUrl, setPinterestConnected, setPinterestUrl, setInrSearchConnected, setInrSearchUrl, setInrSearchDirectoryEnabled,
  applyTiktokConnectionState,
]);

useEffect(() => {
  const handlePinterestUpdate = (event: Event) => {
    const detail = (event as CustomEvent)?.detail ?? {};
    const connected = Boolean(detail.connected);
    const profileUrl = typeof detail.profileUrl === "string" ? detail.profileUrl : "";
    setPinterestConnected(connected);
    setPinterestUrl(profileUrl);
    mergeCachedDashboardChannelState({ pinterestConnected: connected, pinterestUrl: profileUrl });
  };

  const handleInrSearchUpdate = (event: Event) => {
    const detail = (event as CustomEvent)?.detail ?? {};
    const connected = Boolean(detail.connected);
    const profileUrl = typeof detail.profileUrl === "string" ? detail.profileUrl : "";
    const directoryEnabled = Boolean(detail.directoryEnabled && connected);
    setInrSearchConnected(connected);
    setInrSearchUrl(profileUrl);
    setInrSearchDirectoryEnabled(directoryEnabled);
    mergeCachedDashboardChannelState({ inrSearchConnected: connected, inrSearchUrl: profileUrl, inrSearchDirectoryEnabled: directoryEnabled });
  };

  window.addEventListener("inrcy:pinterest-settings-updated", handlePinterestUpdate);
  window.addEventListener("inrcy:inr-search-settings-updated", handleInrSearchUpdate);
  return () => {
    window.removeEventListener("inrcy:pinterest-settings-updated", handlePinterestUpdate);
    window.removeEventListener("inrcy:inr-search-settings-updated", handleInrSearchUpdate);
  };
}, []);

useEffect(() => {
  if (!canAccessPinterest || !pinterestConnected || pinterestUrl) return;

  let cancelled = false;
  void fetch("/api/integrations/pinterest/status?live=1", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      return response.json().catch(() => null);
    })
    .then((status) => {
      if (cancelled || !status?.ok) return;
      const profileUrl = String(
        status.publicProfileUrl || status.profileUrl || "",
      ).trim();
      if (!profileUrl) return;
      setPinterestUrl(profileUrl);
      mergeCachedDashboardChannelState({
        pinterestConnected: true,
        pinterestUrl: profileUrl,
      });
    })
    .catch(() => null);

  return () => {
    cancelled = true;
  };
}, [canAccessPinterest, pinterestConnected, pinterestUrl]);

useEffect(() => {
  let cancelled = false;

  if (!canAccessInrSearch) {
    setInrSearchConnected(false);
    setInrSearchUrl("");
    setInrSearchDirectoryEnabled(false);
    mergeCachedDashboardChannelState({ inrSearchConnected: false, inrSearchUrl: "", inrSearchDirectoryEnabled: false });
    return () => {
      cancelled = true;
    };
  }

  const syncInrSearch = () => {
    const existingRequest = inrSearchSettingsRequestRef.current;
    if (existingRequest) return existingRequest;

    const requestAccountId = getActiveBrowserUserId();
    const job = (async () => {
      try {
        const response = await fetch("/api/inr-search/settings", { cache: "no-store", credentials: "include" });
        const payload = await response.json().catch(() => null);
        if (
          cancelled ||
          requestAccountId !== getActiveBrowserUserId() ||
          !response.ok ||
          !payload?.ok
        ) return;
        const config = payload.inrSearch && typeof payload.inrSearch === "object" ? payload.inrSearch : {};
        const publication = payload.publication && typeof payload.publication === "object" ? payload.publication : {};
        const slug = String(config.slug || "").trim();
        const connected = Boolean(config.enabled && slug && publication.allowed);
        const directoryEnabled = Boolean(config.enabled && config.directoryEnabled && publication.allowed);
        const profileUrl = slug ? `${getRuntimeInrSearchOrigin()}/entreprises/${slug}` : "";
        setInrSearchConnected(connected);
        setInrSearchUrl(profileUrl);
        setInrSearchDirectoryEnabled(directoryEnabled);
        mergeCachedDashboardChannelState({ inrSearchConnected: connected, inrSearchUrl: profileUrl, inrSearchDirectoryEnabled: directoryEnabled });
      } catch {
        // Le dernier état connu reste affiché si la synchronisation réseau échoue.
      }
    })();

    inrSearchSettingsRequestRef.current = job;
    void job.finally(() => {
      if (inrSearchSettingsRequestRef.current === job) {
        inrSearchSettingsRequestRef.current = null;
      }
    });
    return job;
  };

  let intervalId: number | null = null;
  const stopPolling = () => {
    if (intervalId == null) return;
    window.clearInterval(intervalId);
    intervalId = null;
  };
  const syncIfVisible = () => {
    if (cancelled || document.hidden) return;
    void syncInrSearch();
  };
  const startPolling = () => {
    if (intervalId != null || document.hidden) return;
    intervalId = window.setInterval(syncIfVisible, 30_000);
  };
  const handleFocus = () => syncIfVisible();
  const handleVisibility = () => {
    if (document.hidden) {
      stopPolling();
      return;
    }
    syncIfVisible();
    startPolling();
  };
  if (!document.hidden) {
    syncIfVisible();
    startPolling();
  }
  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleVisibility);
  return () => {
    cancelled = true;
    stopPolling();
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}, [canAccessInrSearch]);

useEffect(() => {
  const handleYoutubeShortsUpdate = (event: Event) => {
    const detail = (event as CustomEvent)?.detail ?? {};
    const connected = Boolean(detail.connected);
    const channelUrl = typeof detail.channelUrl === "string" ? detail.channelUrl : "";
    const channelHandle = typeof detail.channelHandle === "string" ? detail.channelHandle : "";
    const channelName = typeof detail.channelName === "string" ? detail.channelName : "";
    const channelId = typeof detail.channelId === "string" ? detail.channelId : "";

    setYoutubeShortsConnected(connected);
    setYoutubeShortsUrl(channelUrl);
    mergeCachedDashboardChannelState({
      youtubeShortsConnected: connected,
      youtubeShortsUrl: channelUrl,
    });

    patchChannelConnectionLocallyRef.current("youtube_shorts", {
      connected,
      accountConnected: connected,
      configured: connected,
      statsConnected: connected,
      expired: false,
      requiresUpdate: false,
      connectionStatus: connected ? "connected" : "disconnected",
      resourceId: connected ? (channelId || channelHandle || channelUrl || null) : null,
      resourceLabel: connected ? (channelName || channelHandle || channelUrl || null) : null,
      resourceUrl: connected ? (channelUrl || null) : null,
    }, { clearData: !connected, clearError: true });

    void triggerChannelRefreshRef.current("youtube_shorts").catch((error) => {
      console.warn("[youtube-shorts] channel refresh failed", error);
    });
  };

  window.addEventListener("inrcy:youtube-shorts-settings-updated", handleYoutubeShortsUpdate);
  return () => window.removeEventListener("inrcy:youtube-shorts-settings-updated", handleYoutubeShortsUpdate);
}, []);

useBrowserLayoutEffect(() => {
  const cached = readCachedDashboardChannelState();
  // Cached channel values are visual continuity only. The dashboard must not
  // consider the server connections authoritative until loadSiteInrcy ends.
  applyDashboardChannelState(cached);
}, [applyDashboardChannelState]);

const setPanelSuccess = useCallback((kind: "facebook" | "instagram" | "linkedin" | "gmb", message: string, timeout = 2200) => {
  if (kind === "facebook") { setFacebookPanelSuccess(message, timeout); return; }
  if (kind === "instagram") { setInstagramPanelSuccess(message, timeout); return; }
  if (kind === "linkedin") { setLinkedinPanelSuccess(message, timeout); return; }
  setGmbPanelSuccess(message, timeout);
}, [setFacebookPanelSuccess, setInstagramPanelSuccess, setLinkedinPanelSuccess, setGmbPanelSuccess]);

const setPanelError = useCallback((kind: "facebook" | "instagram" | "linkedin" | "gmb", input: unknown, fallback: string, timeout = 3200) => {
  if (kind === "facebook") { setFacebookPanelError(input, fallback, timeout); return; }
  if (kind === "instagram") { setInstagramPanelError(input, fallback, timeout); return; }
  if (kind === "linkedin") { setLinkedinPanelError(input, fallback, timeout); return; }
  setGmbPanelError(input, fallback, timeout);
}, [setFacebookPanelError, setInstagramPanelError, setLinkedinPanelError, setGmbPanelError]);

  // ✅ Unités d'Inertie : multiplicateur basé sur les 6 canaux connectés.
  // Calculé ici (dans le composant) pour être réutilisé dans le KPI + le drawer.
  const inertiaSnapshot = useMemo(
    () =>
      computeInertiaSnapshot(
        {
          site_inrcy: Boolean(canAccessSiteInrcy && normalizeSiteUrl(siteInrcySavedUrl) && (siteInrcyGa4Connected || siteInrcyGscConnected)),
          site_web: Boolean(normalizeSiteUrl(siteWebSavedUrl) && (siteWebGa4Connected || siteWebGscConnected)),
          // IMPORTANT: on ne compte les réseaux sociaux que si le compte est réellement connecté (OAuth),
          // pas seulement si un lien est renseigné.
          // Google Business : compte + fiche (location) configurée.
          gmb: Boolean(gmbAccountConnected && gmbConfigured && gmbConnectionStatus !== "needs_update"),
          // Facebook : compte + page sélectionnée.
          facebook: Boolean(facebookAccountConnected && facebookPageConnected && facebookConnectionStatus !== "needs_update"),
          // Instagram : compte + page/profil (resource) sélectionné.
          instagram: Boolean(instagramAccountConnected && instagramConnected && instagramConnectionStatus !== "needs_update"),
          linkedin: Boolean(linkedinAccountConnected && linkedinConnectionStatus !== "needs_update"),
          // TikTok est compté uniquement quand la vraie connexion OAuth est active.
          tiktok: Boolean(tiktokConnected),
          youtube_shorts: Boolean(youtubeShortsConnected),
        },
        { maxMultiplier: 7 }
      ),
    [
      normalizeSiteUrl,
      canAccessSiteInrcy,
      siteInrcySavedUrl,
      siteInrcyGa4Connected,
      siteInrcyGscConnected,
      siteWebSavedUrl,
      siteWebGa4Connected,
      siteWebGscConnected,
      gmbAccountConnected,
      gmbConfigured,
      facebookAccountConnected,
      facebookPageConnected,
      facebookConnectionStatus,
      instagramAccountConnected,
      instagramConnected,
      instagramConnectionStatus,
      linkedinAccountConnected,
      linkedinConnectionStatus,
      tiktokConnected,
      youtubeShortsConnected,
      gmbConnectionStatus,
    ]
  );

  // ✅ Solde UI (Unités d'Inertie) pour l'affichage dans le Générateur
  // Objectif: éviter un « blink » (0 → vraie valeur) au retour de navigation / pendant un refresh.
  // On garde la dernière valeur connue en mémoire (sessionStorage) tant que la nouvelle n'est pas chargée.
  const [uiBalance, setUiBalance] = useState<number>(0);

  useEffect(() => {
    try {
      const raw = readAccountCacheValue("inrcy_ui_balance_v1");
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n)) setUiBalance(n);
    } catch {
      // ignore
    }
  }, []);

  const refreshUiBalance = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        // Ne pas écraser l'affichage par 0 pendant un instant (retour navigation / auth async)
        return;
      }
      const res = await supabase
        .from("loyalty_balance")
        .select("balance")
        .eq("user_id", resolveActiveBrowserUserId(user.id))
        .maybeSingle();
      const bal = Number((res.data as any)?.balance ?? 0);
      const next = Number.isFinite(bal) ? bal : 0;
      setUiBalance(next);
      try {
        writeAccountCacheValue("inrcy_ui_balance_v1", String(next));
      } catch {
        // ignore
      }
    } catch {
      // silence (ex: tables non activées)
      // Ne pas forcer à 0 pour éviter un flash; on garde la dernière valeur connue.
    }
  }, []);

// OAuth credentials must be stored server-side (env vars), not in the UI.


  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const hydrateActiveAccountCaches = () => {
      // Les useState initiaux peuvent s'exécuter avant que le compte actif soit
      // restauré après un retour OAuth. On relit alors immédiatement le cache
      // du bon compte pour conserver la dernière puissance confirmée.
      applyDashboardChannelState(readCachedDashboardChannelState());
      const cachedPower = readCachedGeneratorPowerPercent();
      if (cachedPower !== null) setDisplayedGeneratorPower(cachedPower);
      const cachedPowerSnapshot = readCachedGeneratorPowerSnapshot();
      setDisplayedGeneratorPowerSnapshot(cachedPowerSnapshot);
      if (cachedPower === null && cachedPowerSnapshot) {
        setDisplayedGeneratorPower(cachedPowerSnapshot.power);
      }
      const cachedGeneratorActive = readCachedGeneratorIsActive();
      if (cachedGeneratorActive !== null) setDisplayedGeneratorIsActive(cachedGeneratorActive);
      setDisplayedSiteBubbleProgress(readCachedSiteBubbleProgress());
      setDisplayedSiteInrcyAccess(readCachedSiteInrcyDisplayAccess());
    };

    const syncActiveAccountFromServer = async (authUserId: string) => {
      try {
        const response = await fetch("/api/multicompte/accounts", { cache: "no-store", credentials: "include" });
        const payload = await response.json().catch(() => null) as { ok?: boolean; activeUserId?: string | null } | null;
        if (cancelled) return;

        const activeUserId = response.ok && payload?.ok && typeof payload.activeUserId === "string" ? payload.activeUserId : null;
        if (activeUserId) {
          const currentUserId = getActiveBrowserUserId();
          if (currentUserId !== activeUserId) {
            purgeAllBrowserAccountCaches();
          }
          setActiveBrowserUserId(activeUserId);
          hydrateActiveAccountCaches();
          return;
        }
      } catch {
        // Scope API unavailable: keep the current browser scope if one already exists.
      }

      if (!cancelled && !getActiveBrowserUserId()) {
        setActiveBrowserUserId(authUserId);
        hydrateActiveAccountCaches();
      }
    };

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const user = data.user ?? null;
      activeUserIdRef.current = user?.id ?? null;
      setUserEmail(user?.email ?? null);
      if (user?.id) {
        void syncActiveAccountFromServer(user.id);
      } else {
        setActiveBrowserUserId(null);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      const previousUserId = activeUserIdRef.current;
      const nextUserId = nextUser?.id ?? null;
      if (previousUserId && nextUserId && previousUserId !== nextUserId) {
        purgeAllBrowserAccountCaches();
        setActiveBrowserUserId(null);
        window.location.replace("/dashboard");
        return;
      }
      activeUserIdRef.current = nextUserId;
      setUserEmail(nextUser?.email ?? null);
      if (!nextUserId) {
        setActiveBrowserUserId(null);
      } else {
        void syncActiveAccountFromServer(nextUserId);
      }
    });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, [applyDashboardChannelState]);


  // =============================
  // UI (Unités iNrCy) — récompenses auto
  // - 50 UI à la 1ère ouverture du compte
  // - 50 UI d'ancienneté tous les 30 jours (1ère fois au 30e jour après création du compte)
  // =============================
  useEffect(() => {
    let cancelled = false;

    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    const award = async (actionKey: string, amount: number, sourceId?: string, label?: string) => {
      try {
        await fetch("/api/loyalty/award", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionKey,
            amount,
            sourceId: sourceId ?? null,
            label: label ?? null,
            meta: { origin: "dashboard" },
          }),
        });
      } catch {
        // ignore
      }
    };

    (async () => {
      // On laisse la RPC gérer l'idempotence via sourceId
      const supabase = createClient();
      const { data: authRes } = await supabase.auth.getUser();
      const userCreatedAt = authRes.user?.created_at ? new Date(authRes.user.created_at) : null;

      await award("account_open", 50, "once", "Ouverture du compte");

      if (userCreatedAt && !Number.isNaN(userCreatedAt.getTime())) {
        const elapsedMs = Date.now() - userCreatedAt.getTime();
        const seniorityCycles = Math.floor(elapsedMs / THIRTY_DAYS_MS);

        for (let cycle = 1; cycle <= seniorityCycles; cycle += 1) {
          if (cancelled) return;
          await award("monthly_seniority", 50, `seniority-${cycle}`, "Ancienneté");
        }
      }

      await refreshUiBalance();
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // (re)charge le solde UI au chargement
  useEffect(() => {
    void refreshUiBalance();
  }, [refreshUiBalance]);

  const fetchGoogleConnected = useCallback(async (source: GoogleSource, product: GoogleProduct) => {
    const url = `/api/integrations/google-stats/status?source=${encodeURIComponent(source)}&product=${encodeURIComponent(product)}`;
    const res = await fetch(url, { method: "GET" }).catch(() => null);
    if (!res || !res.ok) return false;
    const json = (await res.json().catch(() => null)) as any;
    return !!json?.connected;
  }, []);

// ✅ Charge infos Site iNrCy + outils du pro depuis Supabase
// - ownership + url iNrCy : profiles
// - config iNrCy : inrcy_site_configs
// - outils du pro (site_web, gmb, facebook, houzz, pages_jaunes, ...) : pro_tools_configs
// (ancienne table site_configs supprimée)
const loadSiteInrcy = useCallback(async () => {
  const requestSeq = ++siteConfigRequestSeqRef.current;
  setSiteConnectionsReady(false);
  setBubbleAccessReady(false);
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (!user || requestSeq !== siteConfigRequestSeqRef.current) {
    if (!user) setSiteConnectionsReady(true);
    return;
  }

  const [profileRes, bubbleAccessEnsureRes, channelStates] = await Promise.all([
    supabase
      .from("profiles")
      .select("inrcy_site_ownership,logo_url,logo_path,company_legal_name,first_name,last_name,phone,contact_email")
      .eq("user_id", resolveActiveBrowserUserId(user.id))
      .maybeSingle(),
    fetch("/api/bubble-access/ensure", { method: "GET", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null),
    fetch("/api/integrations/channel-states", { cache: "no-store", credentials: "include" })
      .then((res) => (res.ok ? res.json().catch(() => null) : null))
      .catch(() => null),
  ]);
  if (requestSeq !== siteConfigRequestSeqRef.current) return;

  // TikTok et Pinterest ne doivent pas attendre les lectures de profil, logo
  // et réglages qui suivent. Leur état commun est appliqué dès cette première
  // vague de chargement, comme pour les autres bulles du dashboard.
  if (channelStates && typeof channelStates === "object") {
    applyDashboardChannelState({
      tiktokConnected: Boolean(channelStates?.tiktok?.connected && !channelStates?.tiktok?.requiresUpdate),
      tiktokRequiresUpdate: Boolean(channelStates?.tiktok?.requiresUpdate),
      tiktokUsername: String(channelStates?.tiktok?.username || ""),
      tiktokProfileUrl: String(channelStates?.tiktok?.profile_url || ""),
      pinterestConnected: Boolean(channelStates?.pinterest?.connected && !channelStates?.pinterest?.requiresUpdate),
      pinterestUrl: String(channelStates?.pinterest?.profile_url || ""),
    });
  }

  const bubbleAccessMapPayload =
    bubbleAccessEnsureRes?.bubbleAccessMap &&
    typeof bubbleAccessEnsureRes.bubbleAccessMap === "object" &&
    !Array.isArray(bubbleAccessEnsureRes.bubbleAccessMap)
      ? bubbleAccessEnsureRes.bubbleAccessMap as Record<string, unknown>
      : null;
  const hasAuthoritativeBubbleAccess = bubbleAccessMapPayload !== null;
  const nextBubbleAccessMap =
    bubbleAccessMapPayload
      ? buildBubbleAccessMap(Object.entries(bubbleAccessMapPayload).map(([bubble_key, enabled]) => ({
          bubble_key,
          enabled: Boolean(enabled),
        })))
      : createUnverifiedBubbleAccessMap();

  setBubbleAccessMap(nextBubbleAccessMap);
  if (hasAuthoritativeBubbleAccess) {
    setBubbleAccessReady(true);
    setDisplayedSiteInrcyAccess(Boolean(nextBubbleAccessMap.site_inrcy));
    writeCachedBubbleAccessMap(nextBubbleAccessMap);
  }

  const profile = profileRes.data as any | null;
  const ownership = (profile?.inrcy_site_ownership ?? "none") as Ownership;
  const resolvedProfileLogo = await resolveProfileLogoUrl(supabase, {
    logo_path: profile?.logo_path ?? null,
    logo_url: profile?.logo_url ?? null,
  });
  if (requestSeq !== siteConfigRequestSeqRef.current) return;

  const nextInrBadgeProfile: InrBadgeProfileSummary = {
    userId: resolveActiveBrowserUserId(user.id),
    logoUrl: resolvedProfileLogo.logoUrl || "",
    companyLegalName: String(profile?.company_legal_name ?? ""),
    firstName: String(profile?.first_name ?? ""),
    lastName: String(profile?.last_name ?? ""),
    phone: String(profile?.phone ?? ""),
    contactEmail: String(profile?.contact_email ?? ""),
  };

  setInrBadgeProfile(nextInrBadgeProfile);
  mergeCachedDashboardChannelState({ inrBadgeProfile: nextInrBadgeProfile });

  const [inrcyRes, proRes] = await Promise.all([
    supabase
      .from("inrcy_site_configs")
      .select("contact_email,settings,site_url")
      .eq("user_id", resolveActiveBrowserUserId(user.id))
      .maybeSingle(),
    supabase
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", resolveActiveBrowserUserId(user.id))
      .maybeSingle(),
  ]);
  if (requestSeq !== siteConfigRequestSeqRef.current) return;

  const inrcyCfg = (inrcyRes.data as any | null) ?? null;
  const proCfg = (proRes.data as any | null) ?? null;
  type SettingsRow = { settings?: any | null } | null;
  const proSettingsObj = (proCfg as SettingsRow)?.settings ?? {};

  const siteInrcyUrlValue = (inrcyCfg?.site_url as string | undefined ?? "").trim();
  const siteInrcyContactEmailValue = (inrcyCfg?.contact_email ?? "") as string;
  const inrcySettingsObj = inrcyCfg?.settings ?? {};
  let siteInrcySettingsTextValue = "{}";
  try {
    siteInrcySettingsTextValue = JSON.stringify(inrcySettingsObj, null, 2);
  } catch {
    siteInrcySettingsTextValue = "{}";
  }

  const ga4MeasurementIdValue = (inrcySettingsObj as any)?.ga4?.measurement_id ?? "";
  const ga4PropertyIdValue = String((inrcySettingsObj as any)?.ga4?.property_id ?? "");
  const gscPropertyValue = (inrcySettingsObj as any)?.gsc?.property ?? "";

  const siteWebObj = (proSettingsObj as any)?.site_web ?? {};
  let siteWebSettingsTextValue = "{}";
  try {
    siteWebSettingsTextValue = JSON.stringify(siteWebObj, null, 2);
  } catch {
    siteWebSettingsTextValue = "{}";
  }

  const igObj = ((proSettingsObj as any)?.instagram ?? {}) as any;
  const liObj = ((proSettingsObj as any)?.linkedin ?? {}) as any;
  const gmbObj = ((proSettingsObj as any)?.gmb ?? {}) as any;
  const fbObj = ((proSettingsObj as any)?.facebook ?? {}) as any;
  const ytObj = ((proSettingsObj as any)?.youtube_shorts ?? {}) as any;
  const pinterestObj = ((proSettingsObj as any)?.pinterest ?? {}) as any;
  const inrSearchObj = ((proSettingsObj as any)?.inrSearch ?? {}) as any;
  const youtubeShortsUrlValue = String(ytObj?.channelUrl ?? ytObj?.url ?? "");
  const pinterestUrlValue = String(pinterestObj?.publicProfileUrl ?? pinterestObj?.profileUrl ?? pinterestObj?.url ?? "");
  const inrSearchSlug = String(inrSearchObj?.slug ?? "").trim();
  const inrSearchUrlValue = inrSearchObj?.enabled && inrSearchSlug
    ? `${getRuntimeInrSearchOrigin()}/entreprises/${inrSearchSlug}`
    : "";

  const nextState: Record<string, any> = {
    siteInrcyOwnership: ownership,
    siteInrcyUrl: siteInrcyUrlValue,
    siteInrcySavedUrl: siteInrcyUrlValue,
    siteInrcyContactEmail: siteInrcyContactEmailValue,
    siteInrcySettingsText: siteInrcySettingsTextValue,
    ga4MeasurementId: ga4MeasurementIdValue,
    ga4PropertyId: ga4PropertyIdValue,
    gscProperty: gscPropertyValue,
    siteInrcyActusLayout: normalizeActusLayout((inrcySettingsObj as any)?.actus_widget?.layout),
    siteInrcyActusLimit: [3, 5, 10].includes(Number((inrcySettingsObj as any)?.actus_widget?.limit)) ? Number((inrcySettingsObj as any)?.actus_widget?.limit) : 5,
    siteInrcyActusFont: (["site", "inter", "poppins", "montserrat", "lora"] as const).includes((inrcySettingsObj as any)?.actus_widget?.font as never) ? (inrcySettingsObj as any)?.actus_widget?.font as ActusFont : "site" as ActusFont,
    siteInrcyActusDesign: normalizeActusDesign((inrcySettingsObj as any)?.actus_widget?.design),
    siteInrcyActusTheme: normalizeActusTheme((inrcySettingsObj as any)?.actus_widget?.theme),
    siteInrcyActusAccent: normalizeActusAccent((inrcySettingsObj as any)?.actus_widget?.accent),
    siteWebSettingsText: siteWebSettingsTextValue,
    siteWebUrl: (siteWebObj as any)?.url ?? "",
    siteWebSavedUrl: (siteWebObj as any)?.url ?? "",
    siteWebGa4MeasurementId: (siteWebObj as any)?.ga4?.measurement_id ?? "",
    siteWebGa4PropertyId: String((siteWebObj as any)?.ga4?.property_id ?? ""),
    siteWebGscProperty: (siteWebObj as any)?.gsc?.property ?? "",
    siteWebActusLayout: normalizeActusLayout((siteWebObj as any)?.actus_widget?.layout),
    siteWebActusLimit: [3, 5, 10].includes(Number((siteWebObj as any)?.actus_widget?.limit)) ? Number((siteWebObj as any)?.actus_widget?.limit) : 5,
    siteWebActusFont: (["site", "inter", "poppins", "montserrat", "lora"] as const).includes((siteWebObj as any)?.actus_widget?.font as never) ? (siteWebObj as any)?.actus_widget?.font as ActusFont : "site" as ActusFont,
    siteWebActusDesign: normalizeActusDesign((siteWebObj as any)?.actus_widget?.design),
    siteWebActusTheme: normalizeActusTheme((siteWebObj as any)?.actus_widget?.theme),
    siteWebActusAccent: normalizeActusAccent((siteWebObj as any)?.actus_widget?.accent),
    instagramUrl: igObj?.url ?? "",
    instagramAccountConnected: !!igObj?.accountConnected,
    instagramConnected: !!igObj?.connected,
    instagramConnectionStatus: (igObj?.connected ? "connected" : "disconnected") as ConnectionDisplayStatus,
    instagramUsername: String(igObj?.username ?? ""),
    linkedinUrl: liObj?.orgId ? (liObj?.orgUrl ?? liObj?.url ?? "") : (liObj?.profileUrl ?? liObj?.url ?? ""),
    linkedinAccountConnected: !!liObj?.accountConnected,
    linkedinConnected: !!liObj?.connected,
    linkedinConnectionStatus: (liObj?.connected || liObj?.accountConnected ? "connected" : "disconnected") as ConnectionDisplayStatus,
    linkedinDisplayName: String(liObj?.displayName ?? ""),
    linkedinSelectedOrganizationId: String(liObj?.orgId ?? ""),
    linkedinSelectedOrganizationName: String(liObj?.orgName ?? ""),
    linkedinShareToPersonalProfile: liObj?.shareToPersonalProfile === true || liObj?.shareToPersonalProfile === "true",
    gmbUrl: gmbObj?.url ?? "",
    gmbAccountConnected: !!gmbObj?.connected,
    gmbConfigured: !!gmbObj?.resource_id,
    gmbConnected: !!gmbObj?.connected && !!gmbObj?.resource_id,
    gmbConnectionStatus: (gmbObj?.connected && (gmbObj?.locationName || gmbObj?.resource_id) ? "connected" : "disconnected") as ConnectionDisplayStatus,
    gmbAccountEmail: gmbObj?.accountEmail ?? "",
    gmbLocationName: String(gmbObj?.locationName ?? gmbObj?.resource_id ?? ""),
    gmbLocationLabel: String(gmbObj?.locationTitle ?? gmbObj?.resource_label ?? ""),
    facebookUrl: fbObj?.url ?? "",
    facebookAccountConnected: !!fbObj?.accountConnected,
    facebookPageConnected: !!fbObj?.pageConnected,
    facebookConnectionStatus: (fbObj?.pageConnected ? "connected" : "disconnected") as ConnectionDisplayStatus,
    facebookAccountEmail: fbObj?.userEmail ?? "",
    fbSelectedPageId: fbObj?.pageId ?? "",
    fbSelectedPageName: fbObj?.pageName ?? "",
    youtubeShortsConnected: Boolean(ytObj?.connected),
    youtubeShortsUrl: youtubeShortsUrlValue,
    pinterestConnected: Boolean(pinterestObj?.connected),
    pinterestUrl: pinterestUrlValue,
    inrSearchConnected: Boolean(inrSearchObj?.enabled && inrSearchSlug),
    inrSearchUrl: inrSearchUrlValue,
    inrSearchDirectoryEnabled: Boolean(inrSearchObj?.enabled && inrSearchObj?.directoryEnabled),
    siteInrcyGa4Connected: !!(ga4MeasurementIdValue || ga4PropertyIdValue),
    siteInrcyGscConnected: !!gscPropertyValue,
    siteWebGa4Connected: !!((siteWebObj as any)?.ga4?.measurement_id || (siteWebObj as any)?.ga4?.property_id),
    siteWebGscConnected: !!((siteWebObj as any)?.gsc?.property),
    inrBadgeProfile: nextInrBadgeProfile,
  };

  try {
    const states = channelStates as any;
    if (states) {
      nextState.siteInrcyGa4Connected = Boolean(states?.site_inrcy?.ga4 || ga4MeasurementIdValue || ga4PropertyIdValue);
      nextState.siteInrcyGscConnected = Boolean(states?.site_inrcy?.gsc || gscPropertyValue);
      nextState.siteWebGa4Connected = Boolean(states?.site_web?.ga4 || (siteWebObj as any)?.ga4?.measurement_id || (siteWebObj as any)?.ga4?.property_id);
      nextState.siteWebGscConnected = Boolean(states?.site_web?.gsc || (siteWebObj as any)?.gsc?.property);

      nextState.gmbConnected = !!states?.gmb?.connected;
      nextState.gmbAccountConnected = !!states?.gmb?.accountConnected;
      nextState.gmbConfigured = !!states?.gmb?.configured;
      nextState.gmbConnectionStatus = (states?.gmb?.connection_status || (states?.gmb?.connected ? "connected" : "disconnected")) as ConnectionDisplayStatus;
      if (states?.gmb?.email) nextState.gmbAccountEmail = String(states.gmb.email);
      if (states?.gmb?.resource_id) nextState.gmbLocationName = String(states.gmb.resource_id);
      if (states?.gmb?.resource_label) nextState.gmbLocationLabel = String(states.gmb.resource_label);
      if (states?.gmb?.url) nextState.gmbUrl = String(states.gmb.url);

      nextState.facebookAccountConnected = !!states?.facebook?.accountConnected;
      nextState.facebookPageConnected = !!states?.facebook?.pageConnected;
      nextState.facebookConnectionStatus = (states?.facebook?.connection_status || (states?.facebook?.connected ? "connected" : "disconnected")) as ConnectionDisplayStatus;
      if (states?.facebook?.user_email) nextState.facebookAccountEmail = String(states.facebook.user_email);
      if (states?.facebook?.resource_id) nextState.fbSelectedPageId = String(states.facebook.resource_id);
      if (states?.facebook?.resource_label) nextState.fbSelectedPageName = String(states.facebook.resource_label);
      if (states?.facebook?.page_url) nextState.facebookUrl = String(states.facebook.page_url);

      nextState.instagramAccountConnected = !!states?.instagram?.accountConnected;
      nextState.instagramConnected = !!states?.instagram?.connected;
      nextState.instagramConnectionStatus = (states?.instagram?.connection_status || (states?.instagram?.connected ? "connected" : "disconnected")) as ConnectionDisplayStatus;
      if (states?.instagram?.username) nextState.instagramUsername = String(states.instagram.username);
      if (states?.instagram?.profile_url) nextState.instagramUrl = String(states.instagram.profile_url);

      nextState.linkedinAccountConnected = !!states?.linkedin?.accountConnected;
      nextState.linkedinConnected = !!states?.linkedin?.connected;
      nextState.linkedinConnectionStatus = (states?.linkedin?.connection_status || (states?.linkedin?.connected ? "connected" : "disconnected")) as ConnectionDisplayStatus;
      if (states?.linkedin?.display_name) nextState.linkedinDisplayName = String(states.linkedin.display_name);

      if (states?.mails && Object.prototype.hasOwnProperty.call(states.mails, "connectedCount")) {
        (nextState as any).mailAccountsConnectedCount = sanitizeMailAccountsConnectedCount(states.mails.connectedCount);
      }

      if ((states?.linkedin as any)?.organization_id) {
        nextState.linkedinSelectedOrganizationId = String((states.linkedin as any).organization_id);
        nextState.linkedinUrl = String((states.linkedin as any).organization_url || states.linkedin.profile_url || "");
      } else if (states?.linkedin?.profile_url) {
        nextState.linkedinUrl = String(states.linkedin.profile_url);
      }
      if ((states?.linkedin as any)?.organization_name) nextState.linkedinSelectedOrganizationName = String((states.linkedin as any).organization_name);

      nextState.youtubeShortsConnected = Boolean(states?.youtube_shorts?.connected && !states?.youtube_shorts?.requiresUpdate);
      nextState.youtubeShortsUrl = String(states?.youtube_shorts?.channel_url || "");

      nextState.tiktokConnected = Boolean(states?.tiktok?.connected && !states?.tiktok?.requiresUpdate);
      nextState.tiktokRequiresUpdate = Boolean(states?.tiktok?.requiresUpdate);
      nextState.tiktokUsername = String(states?.tiktok?.username || "");
      nextState.tiktokProfileUrl = String(states?.tiktok?.profile_url || "");

      nextState.pinterestConnected = Boolean(states?.pinterest?.connected && !states?.pinterest?.requiresUpdate);
      nextState.pinterestUrl = String(states?.pinterest?.profile_url || pinterestUrlValue || "");

      // iNr'Search n'est pas une connexion OAuth : son état réel provient exclusivement
      // de /api/inr-search/settings, qui vérifie que la page publique est réellement publiable.

    } else {
      const [inrcyGa4, inrcyGsc, webGa4, webGsc] = await Promise.all([
        fetchGoogleConnected("site_inrcy", "ga4"),
        fetchGoogleConnected("site_inrcy", "gsc"),
        fetchGoogleConnected("site_web", "ga4"),
        fetchGoogleConnected("site_web", "gsc"),
      ]);
      if (requestSeq !== siteConfigRequestSeqRef.current) return;
      nextState.siteInrcyGa4Connected = inrcyGa4;
      nextState.siteInrcyGscConnected = inrcyGsc;
      nextState.siteWebGa4Connected = webGa4;
      nextState.siteWebGscConnected = webGsc;
    }
  } catch {
    if (requestSeq !== siteConfigRequestSeqRef.current) return;
  }

  if (requestSeq !== siteConfigRequestSeqRef.current) return;
  writeCachedDashboardChannelState(nextState);
  applyDashboardChannelState(nextState, { markReady: true });
}, [applyDashboardChannelState, fetchGoogleConnected]);

useEffect(() => {
  loadSiteInrcy();
}, [loadSiteInrcy]);

useEffect(() => {
  const refreshProfileDependentChannels = () => {
    void loadSiteInrcy();
  };

  window.addEventListener(PUBLIC_PROFILE_DATA_SAVED_EVENT, refreshProfileDependentChannels);
  return () => {
    window.removeEventListener(PUBLIC_PROFILE_DATA_SAVED_EVENT, refreshProfileDependentChannels);
  };
}, [loadSiteInrcy]);

const savedSiteInrcyUrlMeta = normalizeSiteUrl(siteInrcySavedUrl);
const savedSiteWebUrlMeta = normalizeSiteUrl(siteWebSavedUrl);
const draftSiteInrcyUrlMeta = normalizeSiteUrl(siteInrcyUrl);
const draftSiteWebUrlMeta = normalizeSiteUrl(siteWebUrl);

const canViewSite = canAccessSiteInrcy && !!savedSiteInrcyUrlMeta;
const canConfigureSite = canAccessSiteInrcy;

// ✅ UX : Google ne devient connectable qu'une fois un vrai lien enregistré
const hasSiteInrcyUrl = !!savedSiteInrcyUrlMeta;
const hasSiteWebUrl = !!savedSiteWebUrlMeta;
const canConnectSiteInrcyGoogle = canConfigureSite && hasSiteInrcyUrl;
const canConnectSiteWebGoogle = hasSiteWebUrl;

const siteInrcyProgressCount = (hasSiteInrcyUrl ? 1 : 0) + (hasSiteInrcyUrl && siteInrcyGa4Connected ? 1 : 0) + (hasSiteInrcyUrl && siteInrcyGscConnected ? 1 : 0);
const siteWebProgressCount = (hasSiteWebUrl ? 1 : 0) + (hasSiteWebUrl && siteWebGa4Connected ? 1 : 0) + (hasSiteWebUrl && siteWebGscConnected ? 1 : 0);
const siteInrcyAllGreen = canAccessSiteInrcy && siteInrcyProgressCount === 3;
const siteWebAllGreen = siteWebProgressCount === 3;
const sitePowerLinkConnected = hasSiteInrcyUrl || hasSiteWebUrl;
const sitePowerGa4Connected = (hasSiteInrcyUrl && siteInrcyGa4Connected) || (hasSiteWebUrl && siteWebGa4Connected);
const sitePowerGscConnected = (hasSiteInrcyUrl && siteInrcyGscConnected) || (hasSiteWebUrl && siteWebGscConnected);
const videoPowerConnected = Boolean(tiktokConnected || youtubeShortsConnected);
const proNetworkPowerConnected = Boolean(
  (linkedinConnected && linkedinConnectionStatus !== "needs_update") || (canAccessPinterest && pinterestConnected)
);

const generatorPowerSteps = [
  { key: "profile", label: dashboardCopy.generatorSteps.profile.label, shortLabel: dashboardCopy.generatorSteps.profile.shortLabel, weight: 10, completed: profileCompleted },
  { key: "activity", label: dashboardCopy.generatorSteps.activity.label, shortLabel: dashboardCopy.generatorSteps.activity.shortLabel, weight: 10, completed: activityCompleted },
  { key: "site_link", label: dashboardCopy.generatorSteps.site_link.label, shortLabel: dashboardCopy.generatorSteps.site_link.shortLabel, weight: 10, completed: sitePowerLinkConnected },
  { key: "site_ga4", label: dashboardCopy.generatorSteps.site_ga4.label, shortLabel: dashboardCopy.generatorSteps.site_ga4.shortLabel, weight: 5, completed: sitePowerGa4Connected },
  { key: "site_gsc", label: dashboardCopy.generatorSteps.site_gsc.label, shortLabel: dashboardCopy.generatorSteps.site_gsc.shortLabel, weight: 5, completed: sitePowerGscConnected },
  { key: "gmb", label: dashboardCopy.generatorSteps.gmb.label, shortLabel: dashboardCopy.generatorSteps.gmb.shortLabel, weight: 20, completed: gmbConnected && gmbConnectionStatus !== "needs_update" },
  { key: "facebook", label: dashboardCopy.generatorSteps.facebook.label, shortLabel: dashboardCopy.generatorSteps.facebook.shortLabel, weight: 10, completed: facebookPageConnected && facebookConnectionStatus !== "needs_update" },
  { key: "instagram", label: dashboardCopy.generatorSteps.instagram.label, shortLabel: dashboardCopy.generatorSteps.instagram.shortLabel, weight: 10, completed: instagramConnected && instagramConnectionStatus !== "needs_update" },
  { key: "pro_network", label: dashboardCopy.generatorSteps.pro_network.label, shortLabel: dashboardCopy.generatorSteps.pro_network.shortLabel, weight: 7, completed: proNetworkPowerConnected },
  { key: "mails", label: dashboardCopy.generatorSteps.mails.label, shortLabel: dashboardCopy.generatorSteps.mails.shortLabel, weight: 5, completed: mailAccountsConnectedCount > 0 },
  { key: "video", label: dashboardCopy.generatorSteps.video.label, shortLabel: dashboardCopy.generatorSteps.video.shortLabel, weight: 8, completed: videoPowerConnected },
] as const;

const computedGeneratorPower = generatorPowerSteps.reduce((sum, step) => sum + (step.completed ? step.weight : 0), 0);
const generatorPowerReady = siteConnectionsReady && profileCheckReady && activityCheckReady;

// La valeur visible est toujours la dernière puissance confirmée.
// Pendant un retour OAuth, une connexion ou une déconnexion, les états des
// canaux peuvent arriver en plusieurs vagues : on ne montre jamais ces valeurs
// transitoires et on ne les écrit jamais dans le cache.
const generatorPower = displayedGeneratorPower ?? 0;
const generatorPowerIsSettling = generatorPowerReady && generatorPower !== computedGeneratorPower;
const computedNextGeneratorPowerStep = generatorPowerSteps.find((step) => !step.completed) ?? null;
const computedRemainingGeneratorPowerSteps = generatorPowerSteps.filter((step) => !step.completed).length;
const computedGeneratorPowerSnapshot: GeneratorPowerSnapshot = {
  power: computedGeneratorPower,
  completedStepKeys: generatorPowerSteps.filter((step) => step.completed).map((step) => step.key),
  nextStepKey: computedNextGeneratorPowerStep?.key ?? null,
  remainingSteps: computedRemainingGeneratorPowerSteps,
};
const computedGeneratorPowerSnapshotSignature = JSON.stringify(computedGeneratorPowerSnapshot);
const displayedGeneratorPowerSnapshotSignature = displayedGeneratorPowerSnapshot
  ? JSON.stringify(displayedGeneratorPowerSnapshot)
  : "";
const confirmedGeneratorPowerSnapshot = displayedGeneratorPowerSnapshot?.power === generatorPower
  ? displayedGeneratorPowerSnapshot
  : null;
const shouldUseConfirmedGeneratorPowerDetails = !generatorPowerReady || generatorPowerIsSettling;
const displayedGeneratorPowerSteps = shouldUseConfirmedGeneratorPowerDetails
  ? generatorPowerSteps.map((step) => ({
      ...step,
      completed: generatorPower >= 100
        ? true
        : confirmedGeneratorPowerSnapshot
          ? confirmedGeneratorPowerSnapshot.completedStepKeys.includes(step.key)
          : step.completed,
    }))
  : generatorPowerSteps;
const confirmedNextGeneratorPowerStep = confirmedGeneratorPowerSnapshot?.nextStepKey
  ? generatorPowerSteps.find((step) => step.key === confirmedGeneratorPowerSnapshot.nextStepKey) ?? null
  : null;
const nextGeneratorPowerStep = shouldUseConfirmedGeneratorPowerDetails
  ? generatorPower >= 100
    ? null
    : confirmedNextGeneratorPowerStep ?? computedNextGeneratorPowerStep
  : computedNextGeneratorPowerStep;
const remainingGeneratorPowerSteps = shouldUseConfirmedGeneratorPowerDetails
  ? generatorPower >= 100
    ? 0
    : confirmedGeneratorPowerSnapshot?.remainingSteps ?? computedRemainingGeneratorPowerSteps
  : computedRemainingGeneratorPowerSteps;

useEffect(() => {
  if (!generatorPowerReady || displayedGeneratorPower === computedGeneratorPower) return;

  const settleTimer = window.setTimeout(() => {
    setDisplayedGeneratorPower(computedGeneratorPower);
    try {
      writeUiCacheValue(GENERATOR_POWER_CACHE_KEY, String(computedGeneratorPower));
    } catch {
      // ignore browser storage failures
    }
  }, GENERATOR_POWER_SETTLE_MS);

  return () => window.clearTimeout(settleTimer);
}, [computedGeneratorPower, displayedGeneratorPower, generatorPowerReady]);

useEffect(() => {
  if (!generatorPowerReady || generatorPowerIsSettling) return;
  if (displayedGeneratorPowerSnapshotSignature === computedGeneratorPowerSnapshotSignature) return;

  const nextSnapshot = sanitizeGeneratorPowerSnapshot(
    JSON.parse(computedGeneratorPowerSnapshotSignature),
  );
  if (!nextSnapshot) return;
  setDisplayedGeneratorPowerSnapshot(nextSnapshot);
  writeCachedGeneratorPowerSnapshot(nextSnapshot);
}, [
  computedGeneratorPowerSnapshotSignature,
  displayedGeneratorPowerSnapshotSignature,
  generatorPowerIsSettling,
  generatorPowerReady,
]);

const applyGeneratorCacheToState = useCallback(() => {
    const mergedPayload = readGeneratorCache()?.payload;
    if (!mergedPayload || typeof mergedPayload !== "object") return false;

    setKpis(mergedPayload as any);
    const oppMonth = Number((mergedPayload as any)?.details?.opportunities?.month);
    if (Number.isFinite(oppMonth)) {
      setOppTotal(oppMonth);
      try {
        writeUiCacheValue("inrcy_opp30_total_v1", String(oppMonth));
      } catch {
        // ignore
      }
    }

    return true;
  }, []);

  useEffect(() => {
    if (!channelBlocks) return;

    const hasActiveGeneratorSource = DASHBOARD_CHANNEL_KEYS.some((channel) => {
      const block = channelBlocks[channel];
      const connection = block?.connection;
      if (!connection) return false;
      if (connection.requiresUpdate || connection.connectionStatus === "needs_update") return false;
      if (channel === "site_inrcy" || channel === "site_web") {
        return Boolean(connection.statsConnected);
      }
      return Boolean(connection.connected);
    });

    if (hasActiveGeneratorSource) return;

    syncGeneratorOpportunitiesFromStatsSummary({
      byCube: {},
      estimatedByCube: {},
      syncedAt: Date.now(),
      snapshotDate: expectedUiSnapshotDate(),
      channelBlocks,
    });
    applyGeneratorCacheToState();
  }, [applyGeneratorCacheToState, channelBlocks]);

  const notifyGeneratorRefresh = useCallback((at?: number, channels?: readonly DashboardChannelKey[]) => {
    if (typeof window === "undefined") return;
    const syncAt = Number.isFinite(Number(at)) ? Number(at) : Date.now();
    const normalizedChannels = Array.isArray(channels)
      ? Array.from(new Set(channels.filter((channel): channel is DashboardChannelKey => typeof channel === "string" && channel.length > 0)))
      : [];

    if (normalizedChannels.length) {
      for (const channel of normalizedChannels) {
        window.dispatchEvent(new CustomEvent("inrcy:generator-channel-updated", { detail: { channel, at: syncAt } }));
      }
    }

    window.dispatchEvent(new CustomEvent("inrcy:generator-channels-updated", {
      detail: { at: syncAt, channels: normalizedChannels.length ? normalizedChannels : DASHBOARD_CHANNEL_KEYS },
    }));
  }, []);

const refreshKpis = useCallback(async (options?: { fresh?: boolean; syncedAt?: number; silent?: boolean }) => {
    const requestSeq = ++kpisRequestSeqRef.current;
    const fresh = options?.fresh === true;
    const silent = options?.silent === true;
    if (!silent || !kpis) setKpisLoading(true);
    try {
      const params = new URLSearchParams();
      const snapshotDate = expectedUiSnapshotDate();
      if (fresh) params.set("fresh", "1");
      if (snapshotDate) params.set("snapshotDate", snapshotDate);
      const url = `/api/metrics/summary${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          if (requestSeq !== kpisRequestSeqRef.current) return;
          return;
        }
        throw new Error(`KPIs fetch failed: ${res.status}`);
      }
      const json = await res.json();
      if (requestSeq !== kpisRequestSeqRef.current) return;
      setKpis(json);
      const oppMonth = Number(json?.details?.opportunities?.month);
      if (Number.isFinite(oppMonth)) {
        setOppTotal(oppMonth);
        try {
          writeUiCacheValue("inrcy_opp30_total_v1", String(oppMonth));
        } catch {
          // ignore
        }
      }
      try {
        const syncedAt = Number.isFinite(Number(options?.syncedAt)) ? Number(options?.syncedAt) : Date.now();
        const responseSnapshotDate = typeof json?.meta?.snapshotDate === "string" ? json.meta.snapshotDate : null;
        writeUiCacheValue("inrcy_generator_kpis_v1", JSON.stringify({ syncedAt, snapshotDate: responseSnapshotDate || snapshotDate || null, payload: json }));
        notifyGeneratorRefresh(syncedAt, DASHBOARD_CHANNEL_KEYS);
      } catch {
        // ignore
      }
    } catch (err) {
      if (requestSeq !== kpisRequestSeqRef.current) return;
      reportHandledClientError(err, "dashboard-kpis");
      // Keep the last known KPIs to avoid a visual "blink".
      // If nothing exists yet, we'll display 0.
    } finally {
      if (requestSeq === kpisRequestSeqRef.current && (!silent || !kpis)) {
        setKpisLoading(false);
      }
    }
  }, [kpis, notifyGeneratorRefresh]);

  const notifyStatsRefresh = useCallback((at?: number, channels?: readonly DashboardChannelKey[]) => {
    if (typeof window === "undefined") return;
    const syncAt = Number.isFinite(Number(at)) ? Number(at) : Date.now();
    const normalizedChannels = Array.isArray(channels)
      ? Array.from(new Set(channels.filter((channel): channel is DashboardChannelKey => typeof channel === "string" && channel.length > 0)))
      : [];

    if (normalizedChannels.length) {
      markChannelsSynced(normalizedChannels, syncAt);
      for (const channel of normalizedChannels) {
        window.dispatchEvent(new CustomEvent("inrcy:channel-updated", { detail: { channel, at: syncAt } }));
      }
    } else {
      try {
        writeUiCacheValue("inrcy_stats_last_channel_sync_v1", String(syncAt));
      } catch {
        // ignore
      }
    }

    window.dispatchEvent(new CustomEvent("inrcy:channels-updated", { detail: { at: syncAt, channels: normalizedChannels.length ? normalizedChannels : undefined } }));
  }, []);

  const warmInrStatsUi = useCallback(async (options?: {
    syncedAt?: number;
    fresh?: boolean;
    targetPeriods?: StatsWarmPeriod[];
    syncByPeriod?: Partial<Record<StatsWarmPeriod, number>>;
  }) => {
    if (typeof window === "undefined") return;

    const periods: StatsWarmPeriod[] = options?.targetPeriods?.length ? options.targetPeriods : [7, 30];
    const syncAt = Number.isFinite(Number(options?.syncedAt)) ? Number(options?.syncedAt) : Date.now();
    const fresh = options?.fresh === true;
    const syncByPeriod = options?.syncByPeriod || {};

    await Promise.allSettled(
      periods.map(async (days) => {
        const params = new URLSearchParams({ days: String(days) });
        const expectedSnapshotDate = expectedUiSnapshotDate();
        if (fresh) params.set("fresh", "1");
        if (expectedSnapshotDate) params.set("snapshotDate", expectedSnapshotDate);
        const res = await fetch(`/api/stats/dashboard-bulk?${params.toString()}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error(`iNrStats warmup failed: ${res.status}`);
        }

        const json = await res.json().catch(() => null);
        const overviews = json?.overviews;
        const opportunities = json?.opportunities;
        const blocks = json?.blocks;
        const snapshotDate = typeof json?.meta?.snapshotDate === "string" ? json.meta.snapshotDate : getOverviewSnapshotDate(overviews) || expectedSnapshotDate;

        if (!overviews || typeof overviews !== "object") return;

        const normalizedBlocks = blocks && typeof blocks === "object" ? (blocks as InrstatsChannelBlocksByChannel) : null;

        try {
          writeUiCacheValue(
            statsCubeSessionKey(days),
            JSON.stringify({ syncedAt: Number.isFinite(Number(syncByPeriod[days])) ? Number(syncByPeriod[days]) : syncAt, snapshotDate, overviews, blocks: normalizedBlocks })
          );
        } catch {
          // ignore
        }

        if (normalizedBlocks) {
          setChannelBlocks(normalizedBlocks);
        }

        try {
          writeUiCacheValue(
            statsSummarySessionKey(days),
            JSON.stringify({
              syncedAt: Number.isFinite(Number(syncByPeriod[days])) ? Number(syncByPeriod[days]) : syncAt,
              snapshotDate,
              total: Number(opportunities?.total ?? 0),
              byCube: opportunities?.byCube ?? {},
              profile: json?.profile ?? {},
              estimatedByCube: json?.estimatedByCube ?? {},
            })
          );
        } catch {
          // ignore
        }

        if (days === 30) {
          syncGeneratorOpportunitiesFromStatsSummary({
            byCube: opportunities?.byCube ?? {},
            estimatedByCube: json?.estimatedByCube ?? {},
            profile: json?.profile ?? {},
            syncedAt: Number.isFinite(Number(syncByPeriod[days])) ? Number(syncByPeriod[days]) : syncAt,
            snapshotDate,
            channelBlocks: normalizedBlocks ?? undefined,
          });
          applyGeneratorCacheToState();
        }
      })
    );
  }, [applyGeneratorCacheToState]);

  const refreshTimersRef = useRef<number[]>([]);
  const lastGeneratorRefreshAtRef = useRef(0);
  const lastServerCacheCheckAtRef = useRef(0);
  const serverCacheCheckPromiseRef = useRef<Promise<void> | null>(null);
  const inFlightStatsChannelRefreshesRef = useRef<Partial<Record<DashboardChannelKey, Promise<ChannelStatsRefreshResult>>>>({});
  const lastStatsChannelRefreshAtRef = useRef<Partial<Record<DashboardChannelKey, number>>>({});
  const inFlightGeneratorChannelRefreshesRef = useRef<Partial<Record<DashboardChannelKey, Promise<GeneratorChannelRefreshResult>>>>({});
  const lastGeneratorChannelRefreshAtRef = useRef<Partial<Record<DashboardChannelKey, number>>>({});

  const clearScheduledGeneratorRefreshes = useCallback(() => {
    refreshTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    refreshTimersRef.current = [];
  }, []);

  const applyChannelRefreshPayload = useCallback((channel: DashboardChannelKey, payload: {
    periods?: Partial<Record<string, { block?: InrstatsChannelBlock; overview?: unknown; syncedAt?: number; snapshotDate?: string | null }>>;
  } | null | undefined, fallbackSyncAt?: number) => {
    const syncAt = Number.isFinite(Number(fallbackSyncAt)) ? Number(fallbackSyncAt) : Date.now();
    let preferredBlock: InrstatsChannelBlock | null = null;
    let latestSyncAt = syncAt;

    for (const period of [7, 30] as StatsWarmPeriod[]) {
      const periodPayload = payload?.periods?.[String(period)];
      const block = periodPayload?.block;
      if (!block || typeof block !== "object") continue;

      const periodSyncAt = Number.isFinite(Number(periodPayload?.syncedAt)) ? Number(periodPayload?.syncedAt) : (block.syncAt ?? syncAt);
      latestSyncAt = Math.max(latestSyncAt, periodSyncAt);

      mergeChannelBlockIntoCachedSnapshots({
        period,
        channel,
        block,
        overview: periodPayload?.overview,
        syncedAt: periodSyncAt,
        snapshotDate: typeof periodPayload?.snapshotDate === "string" ? periodPayload.snapshotDate : block.snapshotDate ?? null,
      });

      if (period === 30 || !preferredBlock) {
        preferredBlock = block;
      }
    }

    if (preferredBlock) {
      setChannelBlocks((previous) => ({
        ...(previous ?? createEmptyChannelBlocks()),
        [channel]: preferredBlock as InrstatsChannelBlock,
      }));
      markChannelsSynced([channel], latestSyncAt);
    }

    return { preferredBlock, syncAt: latestSyncAt };
  }, []);

  const updateChannelBlockLocally = useCallback((
    channel: DashboardChannelKey,
    updater: (current: InrstatsChannelBlock) => InrstatsChannelBlock,
  ) => {
    const currentBlocks = channelBlocksRef.current ?? createEmptyChannelBlocks();
    const currentBlock = currentBlocks[channel] ?? createEmptyChannelBlock(channel);
    const nextBlock = updater({
      ...currentBlock,
      capturedLeads: (currentBlock as Partial<InrstatsChannelBlock>).capturedLeads ?? { week: 0, month: 0 },
      connection: { ...currentBlock.connection },
    });
    const nextSyncAt = Number.isFinite(Number(nextBlock.syncAt)) ? Number(nextBlock.syncAt) : Date.now();
    const nextBlocks = { ...currentBlocks, [channel]: nextBlock };

    channelBlocksRef.current = nextBlocks;
    setChannelBlocks(nextBlocks);

    for (const period of [7, 30] as StatsWarmPeriod[]) {
      mergeChannelBlockIntoCachedSnapshots({
        period,
        channel,
        block: nextBlock,
        syncedAt: nextSyncAt,
        snapshotDate: nextBlock.snapshotDate ?? expectedUiSnapshotDate(),
      });
    }

    notifyStatsRefresh(nextSyncAt, [channel]);
    return nextBlock;
  }, [notifyStatsRefresh]);

  const patchChannelConnectionLocally = useCallback((
    channel: DashboardChannelKey,
    patch: Partial<InrstatsChannelBlock["connection"]>,
    options?: { clearData?: boolean; clearError?: boolean },
  ) => updateChannelBlockLocally(channel, (current) => ({
    ...current,
    connection: {
      ...current.connection,
      ...patch,
    },
    overview: options?.clearData ? null : current.overview,
    opportunities: options?.clearData ? 0 : current.opportunities,
    capturedLeads: options?.clearData ? { week: 0, month: 0 } : current.capturedLeads,
    estimatedValue: options?.clearData ? 0 : current.estimatedValue,
    live: options?.clearData ? false : current.live,
    error: options?.clearError === false ? current.error : null,
    syncAt: Date.now(),
    snapshotDate: expectedUiSnapshotDate(),
  })), [updateChannelBlockLocally]);
  patchChannelConnectionLocallyRef.current = patchChannelConnectionLocally;

  const refreshChannelBlocksFromApi = useCallback(async (channel: DashboardChannelKey, fallbackSyncAt?: number, options?: ChannelRefreshOptions) => {
    const inFlight = inFlightStatsChannelRefreshesRef.current[channel];
    if (inFlight) return inFlight;

    const now = Date.now();
    const dedupeMs = Number.isFinite(Number(options?.dedupeMs)) ? Number(options?.dedupeMs) : CHANNEL_REFRESH_DEDUP_MS;
    const lastRefreshAt = Number(lastStatsChannelRefreshAtRef.current[channel] ?? 0);

    if (!options?.force && lastRefreshAt > 0 && now - lastRefreshAt < dedupeMs) {
      return { preferredBlock: null, syncAt: lastRefreshAt };
    }

    const job = (async (): Promise<ChannelStatsRefreshResult> => {
      lastStatsChannelRefreshAtRef.current[channel] = Date.now();

      const json = await fetchSharedDashboardRefreshJson<{
        periods?: Partial<Record<string, { block?: InrstatsChannelBlock; overview?: unknown; syncedAt?: number; snapshotDate?: string | null }>>;
      } | null>(
        `stats-channel:${channel}`,
        "/api/stats/channel-refresh",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channel }),
          cache: "no-store",
          credentials: "include",
        },
        { reuseMs: options?.force ? 1_500 : dedupeMs },
      );

      const applied = applyChannelRefreshPayload(channel, json, fallbackSyncAt);
      lastStatsChannelRefreshAtRef.current[channel] = Number.isFinite(Number(applied.syncAt)) ? Number(applied.syncAt) : Date.now();
      return applied;
    })();

    inFlightStatsChannelRefreshesRef.current[channel] = job;

    try {
      return await job;
    } finally {
      if (inFlightStatsChannelRefreshesRef.current[channel] === job) {
        delete inFlightStatsChannelRefreshesRef.current[channel];
      }
    }
  }, [applyChannelRefreshPayload]);

  const refreshAllChannelBlocksFromApi = useCallback(async (fallbackSyncAt?: number, options?: ChannelRefreshOptions) => {
    for (const channel of DASHBOARD_CHANNEL_KEYS) {
      await refreshChannelBlocksFromApi(channel, fallbackSyncAt, options);
    }
  }, [refreshChannelBlocksFromApi]);

  const applyGeneratorChannelRefreshPayload = useCallback((channel: DashboardChannelKey, payload: {
    syncAt?: number;
    generator?: {
      block?: {
        channel?: DashboardChannelKey;
        leads?: { today?: number; week?: number; month?: number };
        opportunities?: { month?: number };
        estimatedValue?: number;
        syncAt?: number | null;
        snapshotDate?: string | null;
        live?: boolean;
        error?: string | null;
      };
      details?: { profile?: unknown };
      meta?: { snapshotDate?: string | null; live?: boolean };
    };
  } | null | undefined, fallbackSyncAt?: number) => {
    const block = payload?.generator?.block;
    if (!block || typeof block !== "object") {
      return { block: null, syncAt: Number.isFinite(Number(fallbackSyncAt)) ? Number(fallbackSyncAt) : Date.now() };
    }

    const syncAt = Number.isFinite(Number(payload?.syncAt))
      ? Number(payload?.syncAt)
      : Number.isFinite(Number(fallbackSyncAt))
        ? Number(fallbackSyncAt)
        : Date.now();
    const resolvedSnapshotDate = typeof payload?.generator?.meta?.snapshotDate === "string"
      ? payload.generator.meta.snapshotDate
      : (typeof block.snapshotDate === "string" ? block.snapshotDate : expectedUiSnapshotDate());

    mergeGeneratorChannelBlockIntoCachedKpis({
      channel,
      block: {
        channel,
        leads: {
          today: Math.max(0, Math.round(Number(block.leads?.today ?? 0))),
          week: Math.max(0, Math.round(Number(block.leads?.week ?? 0))),
          month: Math.max(0, Math.round(Number(block.leads?.month ?? 0))),
        },
        opportunities: {
          month: Math.max(0, Math.round(Number(block.opportunities?.month ?? 0))),
        },
        estimatedValue: Math.max(0, Math.round(Number(block.estimatedValue ?? 0))),
        syncAt,
        snapshotDate: resolvedSnapshotDate ?? null,
        live: typeof payload?.generator?.meta?.live === "boolean" ? payload.generator.meta.live : Boolean(block.live),
        error: typeof block.error === "string" ? block.error : null,
      },
      syncedAt: syncAt,
      snapshotDate: resolvedSnapshotDate ?? null,
      live: typeof payload?.generator?.meta?.live === "boolean" ? payload.generator.meta.live : Boolean(block.live),
      profile: payload?.generator?.details?.profile,
    });

    applyGeneratorCacheToState();
    notifyGeneratorRefresh(syncAt, [channel]);

    return { block, syncAt };
  }, [applyGeneratorCacheToState, notifyGeneratorRefresh]);

  const refreshGeneratorChannelFromApi = useCallback(async (channel: DashboardChannelKey, fallbackSyncAt?: number, options?: ChannelRefreshOptions) => {
    const inFlight = inFlightGeneratorChannelRefreshesRef.current[channel];
    if (inFlight) return inFlight;

    const now = Date.now();
    const dedupeMs = Number.isFinite(Number(options?.dedupeMs)) ? Number(options?.dedupeMs) : CHANNEL_REFRESH_DEDUP_MS;
    const lastRefreshAt = Number(lastGeneratorChannelRefreshAtRef.current[channel] ?? 0);

    if (!options?.force && lastRefreshAt > 0 && now - lastRefreshAt < dedupeMs) {
      return { block: null, syncAt: lastRefreshAt };
    }

    const job = (async (): Promise<GeneratorChannelRefreshResult> => {
      lastGeneratorChannelRefreshAtRef.current[channel] = Date.now();

      const json = await fetchSharedDashboardRefreshJson<{
        syncAt?: number;
        generator?: {
          block?: {
            channel?: DashboardChannelKey;
            leads?: { today?: number; week?: number; month?: number };
            opportunities?: { month?: number };
            estimatedValue?: number;
            syncAt?: number | null;
            snapshotDate?: string | null;
            live?: boolean;
            error?: string | null;
          };
          details?: { profile?: unknown };
          meta?: { snapshotDate?: string | null; live?: boolean };
        };
      } | null>(
        `metrics-channel:${channel}`,
        "/api/metrics/channel-refresh",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channel }),
          cache: "no-store",
          credentials: "include",
        },
        { reuseMs: options?.force ? 1_500 : dedupeMs },
      );

      const applied = applyGeneratorChannelRefreshPayload(channel, json, fallbackSyncAt);
      lastGeneratorChannelRefreshAtRef.current[channel] = Number.isFinite(Number(applied.syncAt)) ? Number(applied.syncAt) : Date.now();
      return applied;
    })();

    inFlightGeneratorChannelRefreshesRef.current[channel] = job;

    try {
      return await job;
    } finally {
      if (inFlightGeneratorChannelRefreshesRef.current[channel] === job) {
        delete inFlightGeneratorChannelRefreshesRef.current[channel];
      }
    }
  }, [applyGeneratorChannelRefreshPayload]);

  const refreshGeneratorChannelsFromApi = useCallback(async (channelsInput: readonly DashboardChannelKey[], fallbackSyncAt?: number, options?: ChannelRefreshOptions) => {
    const channels = Array.from(new Set(channelsInput.filter((channel): channel is DashboardChannelKey => typeof channel === "string" && channel.length > 0)));
    for (const channel of channels) {
      await refreshGeneratorChannelFromApi(channel, fallbackSyncAt, options);
    }
  }, [refreshGeneratorChannelFromApi]);

  const refreshAllGeneratorChannelsFromApi = useCallback(async (fallbackSyncAt?: number, options?: ChannelRefreshOptions) => {
    await refreshGeneratorChannelsFromApi(DASHBOARD_CHANNEL_KEYS, fallbackSyncAt, options);
  }, [refreshGeneratorChannelsFromApi]);

  const applyBootstrapRefresh = useCallback((bootstrap: DailyStatsRefreshBootstrapResponse) => {
    const syncAt = Number.isFinite(Number(bootstrap?.syncAt)) ? Number(bootstrap.syncAt) : Date.now();
    const bootstrapSnapshotDate = typeof bootstrap?.snapshotDate === "string"
      ? bootstrap.snapshotDate
      : expectedUiSnapshotDate();

    markDailyStatsRefreshBootstrapChecked({ snapshotDate: bootstrapSnapshotDate, checkedAt: Date.now(), syncAt });

    if (!bootstrap?.ran) {
      return { syncAt, bootstrapSnapshotDate };
    }

    const generator = bootstrap.generator;

    if (generator) {
      setKpis(generator);
      const oppMonth = Number(generator?.details?.opportunities?.month);
      if (Number.isFinite(oppMonth)) {
        setOppTotal(oppMonth);
        try {
          writeUiCacheValue("inrcy_opp30_total_v1", String(oppMonth));
        } catch {
          // ignore
        }
      }

      try {
        const generatorSnapshotDate = typeof generator?.meta?.snapshotDate === "string"
          ? generator.meta.snapshotDate
          : bootstrapSnapshotDate ?? null;
        writeUiCacheValue(
          "inrcy_generator_kpis_v1",
          JSON.stringify({ syncedAt: syncAt, snapshotDate: generatorSnapshotDate, payload: generator })
        );
      } catch {
        // ignore
      }
    }

    for (const [periodKey, payload] of Object.entries(bootstrap.inrstats || {})) {
      const days = Number(periodKey) as StatsWarmPeriod;
      if (![7, 30].includes(days)) continue;
      const overviews = payload?.overviews;
      if (!overviews || typeof overviews !== "object") continue;
      const payloadSnapshotDate = typeof payload?.meta?.snapshotDate === "string"
        ? payload.meta.snapshotDate
        : getOverviewSnapshotDate(overviews) || bootstrapSnapshotDate || null;
      const payloadBlocks = payload?.blocks && typeof payload.blocks === "object"
        ? payload.blocks as InrstatsChannelBlocksByChannel
        : null;

      try {
        writeUiCacheValue(
          statsCubeSessionKey(days),
          JSON.stringify({ syncedAt: syncAt, snapshotDate: payloadSnapshotDate, overviews, blocks: payloadBlocks })
        );
        writeUiCacheValue(
          statsSummarySessionKey(days),
          JSON.stringify({
            syncedAt: syncAt,
            snapshotDate: payloadSnapshotDate,
            total: Number(payload?.opportunities?.total ?? 0),
            byCube: payload?.opportunities?.byCube ?? {},
            profile: payload?.profile ?? {},
            estimatedByCube: payload?.estimatedByCube ?? {},
          })
        );
      } catch {
        // ignore
      }

      if (payloadBlocks) {
        setChannelBlocks(payloadBlocks);
      }
    }

    notifyStatsRefresh(syncAt);
    return { syncAt, bootstrapSnapshotDate };
  }, [notifyStatsRefresh]);
  latestApplyBootstrapRefreshRef.current = applyBootstrapRefresh;

  const syncFromServerCacheIfNeeded = useCallback(async (force = false) => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    const snapshotDate = expectedUiSnapshotDate();
    if (force) {
      if (now - lastServerCacheCheckAtRef.current < FORCED_SERVER_CACHE_CHECK_DEDUP_MS) return;
    } else {
      if (now - lastServerCacheCheckAtRef.current < 60_000) return;
      if (wasServerCacheSyncCheckedRecently("dashboard", { snapshotDate })) return;
    }
    if (serverCacheCheckPromiseRef.current) {
      await serverCacheCheckPromiseRef.current;
      return;
    }

    const job = (async () => {
      lastServerCacheCheckAtRef.current = now;
      try {
        const res = await fetch("/api/dashboard/cache-status", {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        if (json?.connections?.needsRefresh === true) {
          if (now - lastAutoDailyRefreshAtRef.current < AUTO_DAILY_REFRESH_DEDUP_MS) {
            markServerCacheSyncChecked("dashboard", { snapshotDate, checkedAt: Date.now() });
            return;
          }

          lastAutoDailyRefreshAtRef.current = now;
          const bootstrap = await runDailyStatsRefreshBootstrap({ announce: false, force });
          applyBootstrapRefresh(bootstrap);
          markServerCacheSyncChecked("dashboard", { snapshotDate, checkedAt: Date.now(), syncAt: Number(bootstrap?.syncAt ?? Date.now()) });
          return;
        }

        const generatorSyncedAt = Number(json?.generator?.syncedAt ?? 0);
        const generatorChannelStatuses = json?.generator?.channels && typeof json.generator.channels === "object"
          ? json.generator.channels as Partial<Record<DashboardChannelKey, number>>
          : null;
        const localGeneratorSyncedAt = readGeneratorCache()?.syncedAt || 0;
        const staleGeneratorChannels = generatorChannelStatuses
          ? Object.entries(generatorChannelStatuses)
              .filter(([channel, serverTs]) => Number(serverTs ?? 0) > readCachedGeneratorChannelSyncAt(channel as DashboardChannelKey))
              .map(([channel]) => channel as DashboardChannelKey)
          : [];

        const periodStatuses: Partial<Record<StatsWarmPeriod, { syncedAt?: number; channels?: Partial<Record<DashboardChannelKey, number>> }>> = {
          7: json?.inrstats?.[7] ?? json?.inrstats?.["7"] ?? null,
          30: json?.inrstats?.[30] ?? json?.inrstats?.["30"] ?? null,
        };
        const periodSyncs: Partial<Record<StatsWarmPeriod, number>> = {
          7: Number(periodStatuses[7]?.syncedAt ?? 0),
          30: Number(periodStatuses[30]?.syncedAt ?? 0),
        };
        const staleChannelsByPeriod = ([7, 30] as StatsWarmPeriod[]).reduce((acc, days) => {
          const channels = periodStatuses[days]?.channels;
          acc[days] = !channels || typeof channels !== "object"
            ? []
            : Object.entries(channels)
                .filter(([channel, serverTs]) => Number(serverTs ?? 0) > readCachedChannelSyncAt(days, channel as DashboardChannelKey))
                .map(([channel]) => channel as DashboardChannelKey);
          return acc;
        }, {} as Partial<Record<StatsWarmPeriod, DashboardChannelKey[]>>);
        const stalePeriods = ([7, 30] as StatsWarmPeriod[]).filter((days) => {
          const serverTs = Number(periodSyncs[days] ?? 0);
          if (serverTs <= readInrStatsPeriodSyncAt(days)) return false;
          return readInrStatsPeriodSyncAt(days) === 0 || !(staleChannelsByPeriod[days]?.length);
        });
        const staleChannels = Array.from(new Set((([7, 30] as StatsWarmPeriod[])
          .filter((days) => !stalePeriods.includes(days))
          .flatMap((days) => staleChannelsByPeriod[days] || []))));

        const generatorChannelsToRefresh = Array.from(new Set([
          ...staleGeneratorChannels,
          ...staleChannels,
        ]));
        if (!generatorChannelsToRefresh.length && generatorSyncedAt > localGeneratorSyncedAt) {
          generatorChannelsToRefresh.push(...DASHBOARD_CHANNEL_KEYS);
        }

        await Promise.allSettled([
          generatorChannelsToRefresh.length
            ? refreshGeneratorChannelsFromApi(generatorChannelsToRefresh, generatorSyncedAt || undefined)
            : Promise.resolve(),
          stalePeriods.length
            ? warmInrStatsUi({ targetPeriods: stalePeriods, syncByPeriod: periodSyncs })
            : Promise.resolve(),
          ...staleChannels.map((channel) => refreshChannelBlocksFromApi(channel)),
        ]);
        markServerCacheSyncChecked("dashboard", { snapshotDate, checkedAt: Date.now() });
      } catch {
        // ignore lightweight sync errors
      }
    })();

    serverCacheCheckPromiseRef.current = job;
    try {
      await job;
    } finally {
      serverCacheCheckPromiseRef.current = null;
    }
  }, [applyBootstrapRefresh, readCachedGeneratorChannelSyncAt, refreshChannelBlocksFromApi, refreshGeneratorChannelsFromApi, warmInrStatsUi]);
  latestSyncFromServerCacheIfNeededRef.current = syncFromServerCacheIfNeeded;

  const triggerGeneratorRefresh = useCallback(async () => {
    const runSync = async () => {
      const syncAt = Date.now();
      lastGeneratorRefreshAtRef.current = syncAt;
      await Promise.allSettled([
        loadSiteInrcy(),
        refreshAllGeneratorChannelsFromApi(syncAt, { force: true }),
        refreshAllChannelBlocksFromApi(syncAt, { force: true }),
      ]);
      notifyStatsRefresh(syncAt, DASHBOARD_CHANNEL_KEYS);
    };

    clearScheduledGeneratorRefreshes();
    await runSync();
  }, [clearScheduledGeneratorRefreshes, loadSiteInrcy, notifyStatsRefresh, refreshAllChannelBlocksFromApi, refreshAllGeneratorChannelsFromApi]);

  const fallbackToServerSyncThenGlobal = useCallback(async () => {
    const beforeGeneratorSyncAt = Number(readGeneratorCache()?.syncedAt ?? 0);
    const beforeStatsSyncAt = Math.max(
      Number(readInrStatsPeriodSyncAt(7) ?? 0),
      Number(readInrStatsPeriodSyncAt(30) ?? 0),
      Number(getLastChannelSyncAt() ?? 0),
    );

    try {
      await syncFromServerCacheIfNeeded(true);
    } catch {
      // Le cache serveur est la voie douce. Le refresh complet ne sert qu'en vrai secours.
    }

    const afterGeneratorSyncAt = Number(readGeneratorCache()?.syncedAt ?? 0);
    const afterStatsSyncAt = Math.max(
      Number(readInrStatsPeriodSyncAt(7) ?? 0),
      Number(readInrStatsPeriodSyncAt(30) ?? 0),
      Number(getLastChannelSyncAt() ?? 0),
    );

    if (afterGeneratorSyncAt > beforeGeneratorSyncAt || afterStatsSyncAt > beforeStatsSyncAt) {
      return;
    }

    await triggerGeneratorRefresh();
  }, [syncFromServerCacheIfNeeded, triggerGeneratorRefresh]);
  latestFallbackToServerSyncThenGlobalRef.current = fallbackToServerSyncThenGlobal;

  const triggerChannelRefresh = useCallback(async (channel: DashboardChannelKey) => {
    const syncAt = Date.now();
    lastGeneratorRefreshAtRef.current = syncAt;

    try {
      clearScheduledGeneratorRefreshes();

      const results = await Promise.allSettled([
        channel === "site_inrcy" ? loadSiteInrcy() : Promise.resolve(),
        refreshGeneratorChannelFromApi(channel, syncAt, { force: true }),
        refreshChannelBlocksFromApi(channel, syncAt, { force: true }),
      ]);

      const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
      if (rejected) throw rejected.reason;

      if (channel === "instagram") {
        await syncInstagramStateFromServer({ preserveSelection: true });
      }

      notifyStatsRefresh(syncAt, [channel]);
    } catch (error) {
      reportHandledClientError(error, "dashboard-channel-refresh");
      await fallbackToServerSyncThenGlobal();
    }
  }, [clearScheduledGeneratorRefreshes, fallbackToServerSyncThenGlobal, loadSiteInrcy, notifyStatsRefresh, refreshChannelBlocksFromApi, refreshGeneratorChannelFromApi, syncInstagramStateFromServer]);
  triggerChannelRefreshRef.current = triggerChannelRefresh;

  const triggerChannelsRefresh = useCallback(async (channelsInput: DashboardChannelKey[]) => {
    const channels = Array.from(new Set(channelsInput.filter((channel): channel is DashboardChannelKey => typeof channel === "string" && channel.length > 0)));
    if (!channels.length) return;
    if (channels.length === 1) {
      await triggerChannelRefresh(channels[0]);
      return;
    }

    const syncAt = Date.now();
    lastGeneratorRefreshAtRef.current = syncAt;

    try {
      clearScheduledGeneratorRefreshes();

      const results = await Promise.allSettled([
        channels.includes("site_inrcy") ? loadSiteInrcy() : Promise.resolve(),
        refreshGeneratorChannelsFromApi(channels, syncAt, { force: true }),
        ...channels.map((channel) => refreshChannelBlocksFromApi(channel, syncAt, { force: true })),
      ]);

      const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
      if (rejected) throw rejected.reason;

      if (channels.includes("instagram")) {
        await syncInstagramStateFromServer({ preserveSelection: true });
      }

      notifyStatsRefresh(syncAt, channels);
    } catch (error) {
      reportHandledClientError(error, "dashboard-channels-refresh");
      await fallbackToServerSyncThenGlobal();
    }
  }, [clearScheduledGeneratorRefreshes, fallbackToServerSyncThenGlobal, loadSiteInrcy, notifyStatsRefresh, refreshChannelBlocksFromApi, refreshGeneratorChannelsFromApi, triggerChannelRefresh, syncInstagramStateFromServer]);
  latestTriggerChannelsRefreshRef.current = triggerChannelsRefresh;



  const handleSharedGeneratorRefresh = useCallback(async () => {
    if (kpisLoading) return;
    setKpisLoading(true);

    try {
      const bootstrap = await runDailyStatsRefreshBootstrap({ announce: true, force: true });
      applyBootstrapRefresh(bootstrap);
      await loadSiteInrcy();

      if (!bootstrap?.ran) {
        await syncFromServerCacheIfNeeded(true);
      }
    } catch (error) {
      reportHandledClientError(error, "dashboard-generator-refresh");
    } finally {
      setKpisLoading(false);
    }
  }, [applyBootstrapRefresh, kpisLoading, loadSiteInrcy, syncFromServerCacheIfNeeded]);



  useEffect(() => {
    const applyFromGeneratorCache = () => {
      applyGeneratorCacheToState();
    };

    const handleGeneratorChannelUpdated = () => {
      applyFromGeneratorCache();
    };

    const handleGeneratorChannelsUpdated = () => {
      applyFromGeneratorCache();
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !event.key.includes("inrcy_generator_kpis_v1")) return;
      applyFromGeneratorCache();
    };

    window.addEventListener("inrcy:generator-channel-updated", handleGeneratorChannelUpdated as EventListener);
    window.addEventListener("inrcy:generator-channels-updated", handleGeneratorChannelsUpdated as EventListener);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("inrcy:generator-channel-updated", handleGeneratorChannelUpdated as EventListener);
      window.removeEventListener("inrcy:generator-channels-updated", handleGeneratorChannelsUpdated as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, [applyGeneratorCacheToState]);

  useEffect(() => {
    const handleProfileVersionChange = (event: Event) => {
      const detail = (event as CustomEvent<ProfileVersionChangeDetail>).detail;
      if (!detail) return;

      if (detail.field === "notifications_version") {
        void refreshNotifications();
        return;
      }

      if (detail.field === "loyalty_version") {
        void refreshUiBalance();
        return;
      }

      if (detail.field === "stats_version") {
        void latestSyncFromServerCacheIfNeededRef.current?.(true);
      }
    };

    window.addEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
    return () => {
      window.removeEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
    };
  }, [refreshNotifications, refreshUiBalance]);

  // ✅ Auto-refresh Générateur + statuts modules dès qu'un module se connecte / se déconnecte
  // On écoute les changements Postgres sur les tables qui impactent:
  // - integrations (OAuth/connecteurs)
  // - pro_tools_configs / inrcy_site_configs (mirrors/settings)
  // `profiles` reste centralise dans ProfileRealtimeBridge pour eviter une
  // seconde souscription sur la meme ligne dans chaque onglet.
  useEffect(() => {
    const supabase = createClient();
    let disposed = false;
    let t: number | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let authUserId: string | null = null;
    let subscribedUserId: string | null = null;
    let refreshAfterVisibilityRestore = false;

    const isSafeUserId = (value: unknown): value is string =>
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

    const resolveScopedUserId = (candidate?: unknown) => {
      if (isSafeUserId(candidate)) return candidate;
      if (!isSafeUserId(authUserId)) return null;
      const resolved = resolveActiveBrowserUserId(authUserId);
      return isSafeUserId(resolved) ? resolved : authUserId;
    };

    const removeRealtimeChannel = () => {
      const current = channel;
      channel = null;
      subscribedUserId = null;
      if (!current) return;
      try {
        void Promise.resolve(supabase.removeChannel(current)).catch(() => {});
      } catch {}
    };

    const scheduleRefresh = (payload?: any) => {
      if (disposed) return;
      if (document.visibilityState === "hidden") {
        refreshAfterVisibilityRestore = true;
        return;
      }
      if (Date.now() - lastGeneratorRefreshAtRef.current < 2500) return;
      if (t) window.clearTimeout(t);

      const impactedChannels = inferChannelsFromRealtimePayload(payload);

      t = window.setTimeout(() => {
        if (disposed) return;
        if (Date.now() - lastGeneratorRefreshAtRef.current < 2500) return;
        if (impactedChannels.length) {
          void latestTriggerChannelsRefreshRef.current?.(impactedChannels);
          return;
        }

        void latestFallbackToServerSyncThenGlobalRef.current?.();
      }, 500);
    };

    const subscribeForUser = (userId: string | null) => {
      if (
        disposed ||
        document.visibilityState === "hidden" ||
        !isSafeUserId(userId) ||
        subscribedUserId === userId
      ) {
        return;
      }

      removeRealtimeChannel();
      subscribedUserId = userId;
      const userFilter = `user_id=eq.${userId}`;
      channel = supabase
        .channel(`inrcy-generator-sync:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "integrations", filter: userFilter },
          (payload: any) => scheduleRefresh(payload),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "pro_tools_configs", filter: userFilter },
          (payload: any) => scheduleRefresh(payload),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "inrcy_site_configs", filter: userFilter },
          (payload: any) => scheduleRefresh(payload),
        )
        .subscribe();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        refreshAfterVisibilityRestore = true;
        if (t) {
          window.clearTimeout(t);
          t = null;
        }
        removeRealtimeChannel();
        return;
      }

      subscribeForUser(resolveScopedUserId());
      if (refreshAfterVisibilityRestore) {
        refreshAfterVisibilityRestore = false;
        void latestFallbackToServerSyncThenGlobalRef.current?.();
      }
    };

    const handleActiveAccountChange = (event: Event) => {
      const nextUserId = (event as CustomEvent<{ activeUserId?: unknown }>).detail?.activeUserId;
      const scopedUserId = resolveScopedUserId(nextUserId);
      if (!scopedUserId) return;
      refreshAfterVisibilityRestore = true;
      subscribeForUser(scopedUserId);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleActiveAccountChange as EventListener);

    void supabase.auth.getUser().then(({ data }) => {
      if (disposed) return;
      authUserId = data.user?.id ?? null;
      subscribeForUser(resolveScopedUserId());
    });

    return () => {
      disposed = true;
      if (t) window.clearTimeout(t);
      clearScheduledGeneratorRefreshes();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleActiveAccountChange as EventListener);
      removeRealtimeChannel();
    };
  }, [clearScheduledGeneratorRefreshes]);

  useEffect(() => {
    const linked = searchParams.get("linked");
    const activated = searchParams.get("activated");
    const ok = searchParams.get("ok");
    const toast = searchParams.get("toast");
    const warning = searchParams.get("warning");
    const targetPanel = searchParams.get("panel");

    if (!linked && !activated && !ok && !toast && !warning) return;

    const impactedChannels = inferChannelsFromSearchParams(linked, targetPanel);
    if (ok === "1" && impactedChannels.length) {
      void triggerChannelsRefresh(impactedChannels);
      return;
    }

    void fallbackToServerSyncThenGlobal();
  }, [fallbackToServerSyncThenGlobal, searchParams, triggerChannelsRefresh]);


  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          const res = await fetch("/api/security/google/risc/status", { credentials: "include" });
          const json = await res.json().catch(() => null);
          if (!res.ok || cancelled) return;
          const reauth = (json as any)?.reauth || {};

          if (reauth?.site_inrcy?.ga4) setSiteInrcyGa4Notice("Reconnexion Google Analytics requise (sécurité).");
          if (reauth?.site_inrcy?.gsc) setSiteInrcyGscNotice("Reconnexion Search Console requise (sécurité).");
          if (reauth?.site_web?.ga4) setSiteWebGa4Notice("Reconnexion Google Analytics requise (sécurité).");
          if (reauth?.site_web?.gsc) setSiteWebGscNotice("Reconnexion Search Console requise (sécurité).");
          if (reauth?.gmb) setPanelError("gmb", "Reconnexion Google Business requise (sécurité).", "Reconnexion Google Business requise (sécurité).", 5000);
        } catch {}
      })();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [setPanelError]);

  useEffect(() => {
    const linked = searchParams.get("linked");
    const ok = searchParams.get("ok");
    if (ok !== "1") return;

    if (linked === "facebook") {
      setPanelSuccess("facebook", "Compte Facebook connecté. Choisissez maintenant la page à utiliser.", 3200);
      return;
    }
    if (linked === "instagram") {
      setPanelSuccess("instagram", "Compte Instagram connecté. Choisissez maintenant le profil à utiliser.", 3200);
      void syncInstagramStateFromServer({ preserveSelection: true });
      return;
    }
    if (linked === "linkedin") {
      setPanelSuccess("linkedin", "Compte LinkedIn connecté.", 2600);
      return;
    }
    if (linked === "gmb") {
      setPanelSuccess("gmb", "Compte Google connecté. Choisissez maintenant votre établissement.", 3200);
    }
  }, [searchParams, setPanelSuccess, syncInstagramStateFromServer]);

  useEffect(() => {
    const linked = searchParams.get("linked");
    const ok = searchParams.get("ok");
    const skipped = searchParams.get("skipped");
    const targetPanel = searchParams.get("panel");
    if (ok !== "1" || skipped !== "1") return;

    if (targetPanel === "site_inrcy" && linked === "ga4") {
      setSiteInrcyGa4Notice("Google Analytics déjà connecté pour le site iNrCy.");
      window.setTimeout(() => setSiteInrcyGa4Notice(null), 2600);
      return;
    }
    if (targetPanel === "site_inrcy" && linked === "gsc") {
      setSiteInrcyGscNotice("Search Console déjà connecté pour le site iNrCy.");
      window.setTimeout(() => setSiteInrcyGscNotice(null), 2600);
      return;
    }
    if (targetPanel === "site_web" && linked === "ga4") {
      setSiteWebGa4Notice("Google Analytics déjà connecté pour le site web.");
      window.setTimeout(() => setSiteWebGa4Notice(null), 2600);
      return;
    }
    if (targetPanel === "site_web" && linked === "gsc") {
      setSiteWebGscNotice("Search Console déjà connecté pour le site web.");
      window.setTimeout(() => setSiteWebGscNotice(null), 2600);
    }
  }, [searchParams]);

  useEffect(() => {
    const linked = searchParams.get("linked");
    const ok = searchParams.get("ok");
    const error = searchParams.get("error");
    const message = searchParams.get("message");
    if (!linked || ok !== "0" || (!error && !message)) return;

    const byLinked = linked === "facebook" || linked === "instagram" || linked === "linkedin" || linked === "gmb" ? linked : null;
    const byPanel = panel === "facebook" || panel === "instagram" || panel === "linkedin" || panel === "gmb" ? panel : null;
    const target = byLinked || byPanel;
    if (!target) return;

    const fallbackByTarget = {
      facebook: "La connexion Facebook n'a pas pu aboutir.",
      instagram: "La connexion Instagram n'a pas pu aboutir.",
      linkedin: "La connexion LinkedIn n'a pas pu aboutir.",
      gmb: "La connexion Google Business n'a pas pu aboutir.",
    } as const;

    setPanelError(target, message || error, fallbackByTarget[target]);
  }, [panel, searchParams, setPanelError]);

// ✅ Onboarding non-bloquant : on affiche des alertes (badges / dots) mais
// on n'ouvre jamais un panneau automatiquement.
// (Sinon impossible de fermer un modal si le profil est incomplet.)

  useEffect(() => {
    const snapshotDate = expectedUiSnapshotDate();
    const hasFreshGenerator = hasFreshLocalGeneratorSnapshot();

    if (hasFreshGenerator) {
      try {
        const cached = readGeneratorCache();
        const payload = cached?.payload;
        if (payload?.leads) {
          setKpis(payload);
          const oppMonth = Number(payload?.details?.opportunities?.month);
          if (Number.isFinite(oppMonth)) {
            setOppTotal(oppMonth);
          }
        }
      } catch {
        // ignore
      }
    }

    if (hasFreshGenerator && wasDailyStatsRefreshBootstrapCheckedRecently({ snapshotDate })) {
      setDailyBootReady(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const bootstrap = await runDailyStatsRefreshBootstrap();
        if (cancelled) return;

        latestApplyBootstrapRefreshRef.current?.(bootstrap);

        if (!bootstrap.ran && !hasFreshGenerator) {
          await latestSyncFromServerCacheIfNeededRef.current?.(true);
        }
      } catch (error) {
        reportHandledClientError(error, "dashboard-daily-bootstrap");
      } finally {
        if (!cancelled) setDailyBootReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!dailyBootReady) return;
    try {
      const cached = readGeneratorCache();
      const payload = cached?.payload;
      if (!payload?.leads) return;
      if (cached?.snapshotDate !== expectedUiSnapshotDate()) return;
      setKpis(payload);
      const oppMonth = Number(payload?.details?.opportunities?.month);
      if (Number.isFinite(oppMonth)) {
        setOppTotal(oppMonth);
      }
    } catch {
      // ignore
    }
  }, [dailyBootReady]);

  useEffect(() => {
    if (!dailyBootReady || initialGeneratorRefreshDoneRef.current) return;
    initialGeneratorRefreshDoneRef.current = true;

    const hasFreshDashboardCache = () => {
      const cached = readGeneratorCache();
      const lastChannelSyncAt = getLastChannelSyncAt();
      return Boolean(cached?.payload?.leads && cached.syncedAt >= lastChannelSyncAt && cached.snapshotDate === expectedUiSnapshotDate());
    };

    if (hasFreshDashboardCache()) {
      return;
    }

    void syncFromServerCacheIfNeeded(true)
      .then(() => {
        if (hasFreshDashboardCache()) {
          return;
        }

        return Promise.allSettled([
          refreshAllGeneratorChannelsFromApi(undefined, { force: false }),
          refreshAllChannelBlocksFromApi(undefined, { force: false }),
        ]).then((results) => {
          const failed = results.some((result) => result.status === "rejected");
          if (!failed) return;
          void refreshKpis();
        });
      })
      .catch(() => {
        void refreshKpis();
      });
  }, [dailyBootReady, refreshAllChannelBlocksFromApi, refreshAllGeneratorChannelsFromApi, refreshKpis, syncFromServerCacheIfNeeded]);

  useEffect(() => {
    if (!dailyBootReady) return;
    // Une seule vérification légère au démarrage. Les changements réels de
    // connexion et les événements temps réel déclenchent ensuite les refreshs
    // ciblés ; le focus et visibilitychange ne reconstruisent plus les stats.
    void latestSyncFromServerCacheIfNeededRef.current?.(false);
  }, [dailyBootReady]);

  const refreshMailChannelStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/status", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const accounts = Array.isArray(data?.mailAccounts) ? data.mailAccounts : [];
      // Canal Mails = actif dès qu’au moins une boîte d’envoi est enregistrée.
      const nextCount = sanitizeMailAccountsConnectedCount(accounts.length);
      setMailAccountsConnectedCount(nextCount);
      mergeCachedDashboardChannelState({ mailAccountsConnectedCount: nextCount });
    } catch {
      // On garde le dernier état affiché si le statut mail est momentanément indisponible.
    }
  }, []);

  useEffect(() => {
    void refreshMailChannelStatus();
    const handler = () => void refreshMailChannelStatus();
    window.addEventListener("inrsend:mail-accounts-updated", handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener("inrsend:mail-accounts-updated", handler);
      window.removeEventListener("focus", handler);
    };
  }, [refreshMailChannelStatus]);

  const leadsToday = typeof kpis?.leads?.today === "number" ? kpis.leads.today : null;
  const leadsWeek = typeof kpis?.leads?.week === "number" ? kpis.leads.week : null;
  const leadsMonth = typeof kpis?.leads?.month === "number" ? kpis.leads.month : null;
  const computedGeneratorIsActive = Boolean(
    hasSiteInrcyUrl ||
    hasSiteWebUrl ||
    gmbConnected ||
    facebookPageConnected ||
    instagramConnected ||
    linkedinConnected ||
    (canAccessPinterest && pinterestConnected) ||
    tiktokConnected ||
    youtubeShortsConnected ||
    mailAccountsConnectedCount > 0
  );
  const generatorIsActive = !siteConnectionsReady && displayedGeneratorIsActive !== null
    ? displayedGeneratorIsActive
    : computedGeneratorIsActive;

  useEffect(() => {
    if (!siteConnectionsReady) return;
    setDisplayedGeneratorIsActive(computedGeneratorIsActive);
    try {
      writeUiCacheValue(GENERATOR_ACTIVE_CACHE_KEY, String(computedGeneratorIsActive));
    } catch {
      // ignore browser storage failures
    }
  }, [computedGeneratorIsActive, siteConnectionsReady]);

  const estimatedValue = typeof kpis?.estimatedValue === "number" ? kpis.estimatedValue : null;

  const computeSiteBubbleProgress = useCallback((kind: "site_inrcy" | "site_web"): SiteBubbleProgress => {
    const progress = kind === "site_inrcy" ? siteInrcyProgressCount : siteWebProgressCount;
    const hasUrl = kind === "site_inrcy" ? hasSiteInrcyUrl : hasSiteWebUrl;
    const canUseSite = kind === "site_inrcy" ? canAccessSiteInrcy : true;

    if (kind === "site_inrcy" && !canUseSite) {
      return { status: "coming", text: dashboardCopy.status.noSite };
    }

    return {
      status: hasUrl ? "connected" : "available",
      text: `${hasUrl ? dashboardCopy.status.connected : dashboardCopy.status.toConfigure} ${progress}/3`,
    };
  }, [canAccessSiteInrcy, dashboardCopy, hasSiteInrcyUrl, hasSiteWebUrl, siteInrcyProgressCount, siteWebProgressCount]);

  const siteBubbleProgressSnapshot = useMemo<SiteBubbleProgressCache>(() => ({
    site_inrcy: computeSiteBubbleProgress("site_inrcy"),
    site_web: computeSiteBubbleProgress("site_web"),
  }), [computeSiteBubbleProgress]);

  useEffect(() => {
    if (!siteConnectionsReady || !bubbleAccessReady) return;
    setDisplayedSiteBubbleProgress(siteBubbleProgressSnapshot);
    try {
      writeUiCacheValue(SITE_BUBBLE_PROGRESS_CACHE_KEY, JSON.stringify(siteBubbleProgressSnapshot));
    } catch {
      // ignore browser storage failures
    }
  }, [bubbleAccessReady, siteBubbleProgressSnapshot, siteConnectionsReady]);

  const getSiteBubbleProgress = useCallback((kind: "site_inrcy" | "site_web") => {
    if (
      (!siteConnectionsReady || (kind === "site_inrcy" && !bubbleAccessReady)) &&
      displayedSiteBubbleProgress[kind]
    ) {
      return displayedSiteBubbleProgress[kind] as SiteBubbleProgress;
    }
    return siteBubbleProgressSnapshot[kind] ?? computeSiteBubbleProgress(kind);
  }, [bubbleAccessReady, computeSiteBubbleProgress, displayedSiteBubbleProgress, siteBubbleProgressSnapshot, siteConnectionsReady]);

  useEffect(() => {
    if (!siteConnectionsReady) return;
    const state = {
      siteInrcyOwnership,
      siteInrcyUrl,
      siteInrcySavedUrl,
      siteInrcyContactEmail,
      siteInrcySettingsText,
      ga4MeasurementId,
      ga4PropertyId,
      gscProperty,
      siteInrcyActusLayout,
      siteInrcyActusLimit,
      siteInrcyActusFont,
      siteInrcyActusDesign,
      siteInrcyActusTheme,
      siteInrcyActusAccent,
      siteWebSettingsText,
      siteWebUrl,
      siteWebSavedUrl,
      siteWebGa4MeasurementId,
      siteWebGa4PropertyId,
      siteWebGscProperty,
      siteWebActusLayout,
      siteWebActusLimit,
      siteWebActusFont,
      siteWebActusDesign,
      siteWebActusTheme,
      siteWebActusAccent,
      instagramUrl,
      instagramAccountConnected,
      instagramConnected,
      instagramConnectionStatus,
      instagramUsername,
      linkedinUrl,
      linkedinAccountConnected,
      linkedinConnected,
      linkedinConnectionStatus,
      linkedinDisplayName,
      linkedinSelectedOrganizationId,
      linkedinSelectedOrganizationName,
      linkedinShareToPersonalProfile,
      tiktokConnected,
      tiktokUsername,
      tiktokProfileUrl,
      tiktokPreferredMedia,
      youtubeShortsConnected,
      youtubeShortsUrl,
      pinterestConnected,
      pinterestUrl,
      inrSearchConnected,
      inrSearchUrl,
      gmbUrl,
      gmbAccountConnected,
      gmbConfigured,
      gmbConnected,
      gmbConnectionStatus,
      gmbAccountEmail,
      gmbLocationName,
      gmbLocationLabel,
      facebookUrl,
      facebookAccountConnected,
      facebookPageConnected,
      facebookConnectionStatus,
      facebookAccountEmail,
      fbSelectedPageId,
      fbSelectedPageName,
      mailAccountsConnectedCount,
      inrBadgeProfile,
      inrBadgeProfileReady,
      siteInrcyGa4Connected,
      siteInrcyGscConnected,
      siteWebGa4Connected,
      siteWebGscConnected,
    };
    const serialized = JSON.stringify(state);
    if (serialized === dashboardChannelCacheLastWriteRef.current) return;
    dashboardChannelCacheLastWriteRef.current = serialized;
    writeCachedDashboardChannelState(state);
  });

  useEffect(() => {
    if (!profileCheckReady) return;

    // La réponse Supabase devient la nouvelle valeur autoritative. Elle est
    // mémorisée par établissement pour que le prochain affichage commence
    // directement dans le dernier état connu, sans flash "Synchronisation…".
    const nextReady = !profileIncomplete;
    setLastKnownInrBadgeProfileReady(nextReady);
    mergeCachedDashboardChannelState({ inrBadgeProfileReady: nextReady });
  }, [profileCheckReady, profileIncomplete]);

  const inrBadgeProfileCheckReady = profileCheckReady || lastKnownInrBadgeProfileReady !== null;
  const inrBadgeProfileReady = profileCheckReady
    ? !profileIncomplete
    : lastKnownInrBadgeProfileReady === true;

  const inrBadgePublicUrl = useMemo(() => {
    if (!inrBadgeProfileReady) return "";
    return createInrBadgePublicUrl(inrBadgeProfile);
  }, [inrBadgeProfile, inrBadgeProfileReady]);

  const openInrBadgeModal = useCallback(() => {
    setInrBadgeModalOpen(true);
  }, []);

  const fluxBubbleItems = useMemo(() => buildFluxBubbleItems({
    bubbleAccessMap,
    siteInrcyAccessReady: bubbleAccessReady,
    siteInrcyDisplayAccess: canAccessSiteInrcy || (!bubbleAccessReady && displayedSiteInrcyAccess),
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
    inrBadgeLogoUrl: inrBadgeProfile.logoUrl,
    inrBadgeProfileReady,
    inrBadgeProfileCheckReady,
    onOpenInrBadgeModal: openInrBadgeModal,
    onOpenInrAgent: () => goToRequiredSetupAwareModule("/dashboard/agent"),
    linkedinConnected,
    linkedinUrl,
    mailAccountsConnectedCount,
    tiktokConnected,
    tiktokUrl: tiktokProfileUrl,
    canAccessPinterest,
    pinterestConnected,
    pinterestUrl,
    inrSearchConnected,
    inrSearchUrl,
    youtubeShortsConnected,
    youtubeShortsUrl,
    openPanel,
    savedSiteWebUrlMeta,
    setHelpSiteInrcyOpen,
    setHelpSiteWebOpen,
    siteInrcySavedUrl,
    siteWebSavedUrl,
    language: dashboardLanguage,
  }), [
    bubbleAccessMap,
    bubbleAccessReady,
    canAccessPinterest,
    canAccessInrSearch,
    canConfigureSite,
    canViewSite,
    channelBlocks,
    dashboardLanguage,
    facebookPageConnected,
    facebookUrl,
    getSiteBubbleProgress,
    goToRequiredSetupAwareModule,
    gmbConnected,
    gmbUrl,
    instagramConnected,
    instagramUrl,
    inrBadgeProfile.logoUrl,
    inrBadgeProfileCheckReady,
    inrBadgeProfileReady,
    openInrBadgeModal,
    linkedinConnected,
    linkedinUrl,
    mailAccountsConnectedCount,
    tiktokConnected,
    tiktokProfileUrl,
    pinterestConnected,
    pinterestUrl,
    inrSearchConnected,
    inrSearchUrl,
    youtubeShortsConnected,
    youtubeShortsUrl,
    openPanel,
    savedSiteWebUrlMeta,
    siteInrcySavedUrl,
    displayedSiteInrcyAccess,
    siteWebSavedUrl,
  ]);

  const displayedFluxBubbleItems = useMemo(
    () => isStandardEdition
      ? fluxBubbleItems.filter((item) => STANDARD_DASHBOARD_BUBBLE_KEYS.has(item.key))
      : fluxBubbleItems,
    [fluxBubbleItems, isStandardEdition],
  );

  const inrBadgeSettingsProps = useMemo(() => ({
    profile: inrBadgeProfile,
    publicUrl: inrBadgePublicUrl,
    profileReady: inrBadgeProfileReady,
    channels: {
      siteInrcy: {
        connected: Boolean(canAccessSiteInrcy && normalizeSiteUrl(siteInrcySavedUrl)),
        url: siteInrcySavedUrl,
      },
      siteWeb: {
        connected: Boolean(normalizeSiteUrl(siteWebSavedUrl)),
        url: siteWebSavedUrl,
      },
      googleBusiness: {
        connected: Boolean(gmbConnected && gmbUrl),
        url: gmbUrl,
      },
      facebook: {
        connected: Boolean(facebookPageConnected && facebookUrl),
        url: facebookUrl,
      },
      instagram: {
        connected: Boolean(instagramConnected && instagramUrl),
        url: instagramUrl,
      },
      linkedin: {
        connected: Boolean(linkedinConnected && linkedinUrl),
        url: linkedinUrl,
      },
      pinterest: {
        connected: Boolean(canAccessPinterest && pinterestConnected),
        url: canAccessPinterest ? pinterestUrl : null,
      },
      mails: {
        connected: mailAccountsConnectedCount > 0,
        url: null,
      },
      tiktok: {
        connected: Boolean(tiktokConnected),
        url: tiktokProfileUrl,
      },
      youtubeShorts: {
        connected: Boolean(youtubeShortsConnected && youtubeShortsUrl),
        url: youtubeShortsUrl,
      },
    },
    onOpenProfile: () => openPanel("profil"),
    onOpenActivity: () => openPanel("activite"),
    onOpenCalendarSettings: () => openPanel("agenda"),
  }), [
    inrBadgeProfile,
    inrBadgePublicUrl,
    canAccessPinterest,
    inrBadgeProfileReady,
    siteInrcyOwnership,
    siteInrcySavedUrl,
    siteWebSavedUrl,
    gmbConnected,
    gmbUrl,
    facebookPageConnected,
    facebookUrl,
    instagramConnected,
    instagramUrl,
    linkedinConnected,
    linkedinUrl,
    mailAccountsConnectedCount,
    tiktokConnected,
    tiktokProfileUrl,
    pinterestConnected,
    pinterestUrl,
    youtubeShortsConnected,
    youtubeShortsUrl,
    openPanel,
  ]);

  const saveSiteInrcyUrlFromDrawer = useCallback(() => runDrawerMutation("site_inrcy:url:save", saveSiteInrcyUrl), [runDrawerMutation, saveSiteInrcyUrl]);
  const deleteSiteInrcyUrlFromDrawer = useCallback(() => runDrawerMutation("site_inrcy:url:delete", deleteSiteInrcyUrl), [runDrawerMutation, deleteSiteInrcyUrl]);
  const disconnectSiteInrcyGa4FromDrawer = useCallback(() => runDrawerMutation("site_inrcy:ga4:disconnect", disconnectSiteInrcyGa4), [runDrawerMutation, disconnectSiteInrcyGa4]);
  const disconnectSiteInrcyGscFromDrawer = useCallback(() => runDrawerMutation("site_inrcy:gsc:disconnect", disconnectSiteInrcyGsc), [runDrawerMutation, disconnectSiteInrcyGsc]);

  const saveSiteWebUrlFromDrawer = useCallback(() => runDrawerMutation("site_web:url:save", saveSiteWebUrl), [runDrawerMutation, saveSiteWebUrl]);
  const deleteSiteWebUrlFromDrawer = useCallback(() => runDrawerMutation("site_web:url:delete", deleteSiteWebUrl), [runDrawerMutation, deleteSiteWebUrl]);
  const disconnectSiteWebGa4FromDrawer = useCallback(() => runDrawerMutation("site_web:ga4:disconnect", disconnectSiteWebGa4), [runDrawerMutation, disconnectSiteWebGa4]);
  const disconnectSiteWebGscFromDrawer = useCallback(() => runDrawerMutation("site_web:gsc:disconnect", disconnectSiteWebGsc), [runDrawerMutation, disconnectSiteWebGsc]);

  const saveGmbLocationFromDrawer = useCallback(() => runDrawerMutation("gmb:location:save", saveGmbLocation), [runDrawerMutation, saveGmbLocation]);
  const disconnectGmbAccountFromDrawer = useCallback(() => runDrawerMutation("gmb:account:disconnect", disconnectGmbAccount), [runDrawerMutation, disconnectGmbAccount]);
  const disconnectGmbBusinessFromDrawer = useCallback(() => runDrawerMutation("gmb:location:disconnect", disconnectGmbBusiness), [runDrawerMutation, disconnectGmbBusiness]);

  const saveFacebookPageFromDrawer = useCallback(() => runDrawerMutation("facebook:page:save", saveFacebookPage), [runDrawerMutation, saveFacebookPage]);
  const disconnectFacebookAccountFromDrawer = useCallback(() => runDrawerMutation("facebook:account:disconnect", disconnectFacebookAccount), [runDrawerMutation, disconnectFacebookAccount]);
  const disconnectFacebookPageFromDrawer = useCallback(() => runDrawerMutation("facebook:page:disconnect", disconnectFacebookPage), [runDrawerMutation, disconnectFacebookPage]);

  const saveInstagramProfileFromDrawer = useCallback(() => runDrawerMutation("instagram:profile:save", saveInstagramProfile), [runDrawerMutation, saveInstagramProfile]);
  const disconnectInstagramAccountFromDrawer = useCallback(() => runDrawerMutation("instagram:account:disconnect", disconnectInstagramAccount), [runDrawerMutation, disconnectInstagramAccount]);
  const disconnectInstagramProfileFromDrawer = useCallback(() => runDrawerMutation("instagram:profile:disconnect", disconnectInstagramProfile), [runDrawerMutation, disconnectInstagramProfile]);

  const saveLinkedinProfileUrlFromDrawer = useCallback(() => runDrawerMutation("linkedin:url:save", saveLinkedinProfileUrl), [runDrawerMutation, saveLinkedinProfileUrl]);
  const disconnectLinkedinAccountFromDrawer = useCallback(() => runDrawerMutation("linkedin:account:disconnect", disconnectLinkedinAccount), [runDrawerMutation, disconnectLinkedinAccount]);
  const disconnectLinkedinOrganizationFromDrawer = useCallback(() => runDrawerMutation("linkedin:organization:disconnect", useLinkedinPersonalProfile), [runDrawerMutation, useLinkedinPersonalProfile]);


  const locals = {
    canConfigureSite, canConnectSiteInrcyGoogle, canConnectSiteWebGoogle,
    connectFacebookAccount, connectFacebookBusinessAccount, connectGmbAccount, connectInstagramAccount, connectInstagramBusinessAccount, connectLinkedinAccount, connectLinkedinBusinessAccount,
    connectSiteInrcyGa4, connectSiteInrcyGsc, connectSiteWebGa4, connectSiteWebGsc,
    deleteSiteInrcyUrlFromDrawer, deleteSiteWebUrlFromDrawer,
    disconnectFacebookAccountFromDrawer, disconnectFacebookPageFromDrawer, disconnectGmbAccountFromDrawer, disconnectGmbBusinessFromDrawer,
    disconnectInstagramAccountFromDrawer, disconnectInstagramProfileFromDrawer, disconnectLinkedinAccountFromDrawer, disconnectLinkedinOrganizationFromDrawer,
    disconnectSiteInrcyGa4FromDrawer, disconnectSiteInrcyGscFromDrawer, disconnectSiteWebGa4FromDrawer, disconnectSiteWebGscFromDrawer,
    draftSiteInrcyUrlMeta, draftSiteWebUrlMeta,
    facebookAccountConnected, facebookAccountEmail, facebookConnectionStatus, facebookPageConnected, facebookUrl, facebookUrlError, facebookUrlNotice,
    fbPages, fbPagesError, fbPagesLoading, fbPagesPhase, fbSelectedPageId, fbSelectedPageName,
    ga4MeasurementId, ga4PropertyId,
    gmbAccountConnected, gmbAccountEmail, gmbAccountName, gmbAccounts, gmbConfigured, gmbConnected, gmbConnectionStatus, gmbListError, gmbLoadingList, gmbLocationsPhase,
    gmbLocationLabel, gmbLocationName, gmbLocations, gmbUrl, gmbUrlError, gmbUrlNotice,
    gscProperty,
    igAccounts, igAccountsError, igAccountsLoading, igAccountsPhase, igSelectedPageId,
    instagramAccountConnected, instagramConnected, instagramConnectionStatus, instagramUrl, instagramUrlError, instagramUrlNotice, instagramUsername,
    isDrawerMutationPending,
    linkedinAccountConnected, linkedinConnected, linkedinConnectionStatus, linkedinDisplayName, linkedinUrl, linkedinUrlError, linkedinUrlNotice,
    linkedinOrganizations, linkedinOrganizationsLoading, linkedinOrganizationsPhase, linkedinOrganizationPickerOpen, linkedinSelectedOrganizationId, linkedinSelectedOrganizationName,
    linkedinShareToPersonalProfile, linkedinShareToPersonalProfileBusy, updateLinkedinShareToPersonalProfile,
    loadLinkedinOrganizations, selectLinkedinOrganization, useLinkedinPersonalProfile,
    loadFacebookPages, loadGmbAccountsAndLocations, loadInstagramAccounts,
    resetSiteInrcyAll, resetSiteWebAll, saveSiteInrcyActusWidgetSettings, saveSiteWebActusWidgetSettings,
    saveFacebookPageFromDrawer, saveGmbLocationFromDrawer, saveInstagramProfileFromDrawer, saveLinkedinProfileUrlFromDrawer, saveSiteInrcyUrlFromDrawer, saveSiteWebUrlFromDrawer,
    setFbSelectedPageId, setIgSelectedPageId, setGmbLocationName, setLinkedinUrl, setLinkedinUrlNotice,
    setShowSiteInrcyWidgetCode, setShowSiteWebWidgetCode,
    setSiteInrcyActusFont, setSiteInrcyActusLayout, setSiteInrcyActusLimit, setSiteInrcyActusDesign, setSiteInrcyActusTheme, setSiteInrcyActusAccent, setSiteInrcyUrl,
    setSiteWebActusFont, setSiteWebActusLayout, setSiteWebActusLimit, setSiteWebActusDesign, setSiteWebActusTheme, setSiteWebActusAccent, setSiteWebUrl,
    showSiteInrcyWidgetCode, showSiteWebWidgetCode,
    siteInrcyActusFont, siteInrcyActusLayout, siteInrcyActusLimit, siteInrcyActusDesign, siteInrcyActusTheme, siteInrcyActusAccent, siteInrcyAllGreen, siteInrcyContactEmail,
    siteInrcyGa4Connected, siteInrcyGa4Notice, siteInrcyGscConnected, siteInrcyGscNotice, siteInrcyOwnership, siteInrcySavedUrl, siteInrcySettingsError,
    siteInrcyUrl, siteInrcyUrlNotice,
    siteWebActusFont, siteWebActusLayout, siteWebActusLimit, siteWebActusDesign, siteWebActusTheme, siteWebActusAccent, siteWebAllGreen,
    siteWebGa4Connected, siteWebGa4MeasurementId, siteWebGa4Notice, siteWebGa4PropertyId, siteWebGscConnected, siteWebGscNotice, siteWebGscProperty,
    siteWebSavedUrl, siteWebSettingsError, siteWebUrl, siteWebUrlNotice,
    widgetTokenInrcySite, widgetTokenSiteWeb, hasSiteInrcyUrl, hasSiteWebUrl,
    tiktokConnected, tiktokUsername, tiktokProfileUrl, setTiktokProfileUrl, tiktokProfileUrlNotice, tiktokProfileUrlError, tiktokLoading,
    tiktokPreferredMedia, setTiktokPreferredMedia, tiktokAllowComments, setTiktokAllowComments,
    tiktokAllowDuo, setTiktokAllowDuo, tiktokAllowStitch, setTiktokAllowStitch,
    tiktokPhotoAutoMusic, setTiktokPhotoAutoMusic, tiktokCommercialContent, setTiktokCommercialContent,
    tiktokAiContent, setTiktokAiContent, tiktokSettingsNotice, tiktokSettingsError,
    connectTiktok, disconnectTiktok, saveTiktokProfileUrl, saveTiktokDefaults,
  };

  const {
    siteWebPanelProps,
    gmbPanelProps,
    linkedinPanelProps,
    siteInrcyPanelProps,
    instagramPanelProps,
    facebookPanelProps,
    tiktokPanelProps,
  } = buildDashboardPanelProps(locals);

  if (onboardingStateLoading) {
    return <StableBootScreen label="Chargement de votre dashboard iNrCy..." />;
  }

  if (onboardingInitialPreparationBlocking) {
    return <StableBootScreen label="Préparation de votre configuration initiale..." />;
  }

  return (
    <main
      className={styles.page}
      data-onboarding-ready={onboardingState.onboardingReady ? "true" : "false"}
      data-onboarding-status={onboardingState.onboardingStatus ?? undefined}
      data-onboarding-step={onboardingState.onboardingCurrentStep ?? undefined}
    >
      <DashboardTopbar
        desktopNotificationMenuRef={desktopNotificationMenuRef}
        mobileNotificationMenuRef={mobileNotificationMenuRef}
        userMenuRef={userMenuRef}
        notificationMenuOpen={notificationMenuOpen}
        setNotificationMenuOpen={setNotificationMenuOpen}
        unreadNotificationsCount={unreadNotificationsCount}
        refreshNotifications={refreshNotifications}
        notificationsLoading={notificationsLoading}
        notifications={notifications}
        notificationsError={notificationsError}
        markAllNotificationsRead={markAllNotificationsRead}
        markNotificationRead={markNotificationRead}
        deleteNotification={deleteNotification}
        onNavigateCta={navigateDashboardCta}
        openPanel={openPanel}
        inrAgentEnabled={canAccessInrAgent}
        showInrAgent
        requiredSetupLockVisible={requiredSetupLockVisible}
        isAdmin={isAdmin}
        userEmail={userEmail}
        userFirstLetter={userFirstLetter}
        profileIncomplete={profileIncomplete}
        activityIncomplete={activityIncomplete}
        userMenuOpen={userMenuOpen}
        setUserMenuOpen={setUserMenuOpen}
        goToGps={() => {
          void requestNavigation(() => router.push("/dashboard/gps"));
        }}
        handleLogout={async () => { await requestNavigation(handleLogout); }}
      />

      <DashboardHero
        generatorPower={generatorPower}
        generatorPowerSteps={displayedGeneratorPowerSteps}
        remainingGeneratorPowerSteps={remainingGeneratorPowerSteps}
        nextGeneratorPowerStep={nextGeneratorPowerStep}
        onOpenGeneratorHelp={() => setHelpGeneratorOpen(true)}
        onOpenGeneratorSettings={() => setGeneratorSettingsOpen(true)}
        onRefreshGenerator={() => {
          void handleSharedGeneratorRefresh();
        }}
        kpisLoading={kpisLoading}
        generatorIsActive={generatorIsActive}
        uiBalance={uiBalance}
        inertiaSnapshot={inertiaSnapshot}
        estimatedValue={estimatedValue}
        oppTotal={oppTotal}
        onOpenStats={openStatsModule}
        leadsWeek={leadsWeek}
        leadsMonth={leadsMonth}
      />

      {generatorSettingsOpen ? (
        <GeneratorSettingsModal
          opportunities={oppTotal}
          onClose={() => setGeneratorSettingsOpen(false)}
          onSaved={handleSharedGeneratorRefresh}
        />
      ) : null}

      <DashboardChannelsSection
        fluxBubbleItems={displayedFluxBubbleItems}
        goToModule={goToRequiredSetupAwareModule}
        openPanel={openPanel}
        requiredSetupAccessAllowed={requiredSetupAccessAllowed}
        requiredSetupLockVisible={requiredSetupLockVisible}
        onRequiredSetupBlocked={openRequiredSetupPanel}
        onOpenChannelsHelp={() => setHelpCanauxOpen(true)}
        onOpenStats={openStatsModule}
        onOpenBoosterPublish={openBoosterPublish}
        onOpenBoosterStats={openBoosterStats}
        standardMode={isStandardEdition}
      />

      <DashboardBoosterModalLayer
        mode={requiredSetupAccessAllowed ? dashboardBoosterModal : null}
        initialConnectedChannels={{
          inrcy_site: Boolean(canAccessSiteInrcy && normalizeSiteUrl(siteInrcySavedUrl)),
          site_web: Boolean(normalizeSiteUrl(siteWebSavedUrl)),
          inr_search: Boolean(canAccessInrSearch && inrSearchConnected),
          gmb: Boolean(gmbAccountConnected && gmbConfigured && gmbConnectionStatus !== "needs_update"),
          facebook: Boolean(facebookAccountConnected && facebookPageConnected && facebookConnectionStatus !== "needs_update"),
          instagram: Boolean(instagramAccountConnected && instagramConnected && instagramConnectionStatus !== "needs_update"),
          linkedin: Boolean(linkedinAccountConnected && linkedinConnectionStatus !== "needs_update"),
          // TikTok suit maintenant le même état hydraté que les autres canaux.
          // Si l'OAuth réel est actif, la bulle Booster est allumée dès l'ouverture.
          tiktok: Boolean(tiktokConnected),
          // YouTube suit aussi l'état Dashboard déjà hydraté.
          // Ça évite que l'icône arrive après les autres dans Booster / Publier.
          youtube_shorts: Boolean(youtubeShortsConnected),
          pinterest: Boolean(canAccessPinterest && pinterestConnected),
        }}
        onClose={() => {
          setDashboardBoosterModal(null);
          if (searchParams.get("action") === "publish" || searchParams.get("stats") === "1" || searchParams.get("draftId")) {
            router.replace("/dashboard", { scroll: false });
          }
        }}
      />


      {inrBadgeModalOpen ? (
        <InrBadgePreviewModal
          profile={inrBadgeProfile}
          publicUrl={inrBadgePublicUrl}
          onClose={() => setInrBadgeModalOpen(false)}
          onConfigure={() => {
            setInrBadgeModalOpen(false);
            openPanel("inrbadge");
          }}
        />
      ) : null}

      <SettingsDrawer
        title={getDrawerTitle(panel, dashboardLanguage)}
        progressLabel={onboardingProgressLabel}
        isOpen={isDrawerPanel(panel)}
        onClose={requestCloseSettingsDrawer}
        closeOnBackdrop={!settingsDrawerRequiresExplicitClose}
        closeOnEscape={!settingsDrawerRequiresExplicitClose}
        presentation={isGuidedOnboardingPanel ? "onboarding" : "drawer"}
        closeLabel={isGuidedOnboardingPanel ? "Passer" : undefined}
        headerActions={
          panel === "inertie" ? (
            <HelpButton onClick={() => setHelpInertieOpen(true)} title="Aide : Mon inertie" />
          ) : panel === "facebook" ? (
            <HelpButton onClick={() => setHelpFacebookOpen(true)} title="Aide connexion Facebook" />
          ) : panel === "instagram" ? (
            <HelpButton onClick={() => setHelpInstagramOpen(true)} title="Aide connexion Instagram" />
          ) : null
        }
      >
        {isGuidedOnboardingPanel && onboardingCurrentStep === "ai" && onboardingAiMode === "choice" ? (
          <DashboardOnboardingAiChoice
            onCustomize={() => setOnboardingAiMode("configure")}
            onKeepDefaults={completeOnboardingFromAi}
            busy={onboardingAiCompleting}
          />
        ) : (
          <DashboardSettingsDrawerContent
            edition={dashboardEdition}
            panel={panel}
            onUnsavedChange={handleSettingsDrawerUnsavedChange}
            checkProfile={checkProfile}
            checkActivity={checkActivity}
            inertiaSnapshot={inertiaSnapshot}
            openPanel={openPanel}
            onCloseDrawer={requestCloseSettingsDrawer}
            guidedOnboardingStep={isGuidedOnboardingPanel ? onboardingCurrentStep as "profile" | "activity" | "ai" : null}
            onAdvanceOnboardingProfile={advanceOnboardingFromProfile}
            onAdvanceOnboardingActivity={advanceOnboardingFromActivity}
            onCompleteOnboardingAi={completeOnboardingFromAi}
            referralName={referralName}
            referralPhone={referralPhone}
            referralEmail={referralEmail}
            referralFrom={referralFrom}
            referralSubmitting={referralSubmitting}
            referralNotice={referralNotice}
            referralError={referralError}
            onReferralNameChange={setReferralName}
            onReferralPhoneChange={setReferralPhone}
            onReferralEmailChange={setReferralEmail}
            onReferralFromChange={setReferralFrom}
            submitReferral={submitReferral}
            siteInrcyPanelProps={siteInrcyPanelProps}
            siteWebPanelProps={siteWebPanelProps}
            instagramPanelProps={instagramPanelProps}
            linkedinPanelProps={linkedinPanelProps}
            gmbPanelProps={gmbPanelProps}
            facebookPanelProps={facebookPanelProps}
            tiktokPanelProps={tiktokPanelProps}
            inrBadgeSettingsProps={inrBadgeSettingsProps}
            pinterestAccessEnabled={canAccessPinterest}
            inrSearchAccessEnabled={canAccessInrSearch}
            inrSearchConnected={inrSearchConnected}
            inrSearchUrl={inrSearchUrl}
            inrSearchDirectoryEnabled={inrSearchDirectoryEnabled}
          />
        )}
      </SettingsDrawer>

      <DashboardHelpModals
        helpGeneratorOpen={helpGeneratorOpen}
        helpCanauxOpen={helpCanauxOpen}
        helpSiteInrcyOpen={helpSiteInrcyOpen}
        helpSiteWebOpen={helpSiteWebOpen}
        helpInertieOpen={helpInertieOpen}
        helpFacebookOpen={helpFacebookOpen}
        helpInstagramOpen={helpInstagramOpen}
        onCloseGenerator={() => setHelpGeneratorOpen(false)}
        onCloseCanaux={() => setHelpCanauxOpen(false)}
        onCloseSiteInrcy={() => setHelpSiteInrcyOpen(false)}
        onCloseSiteWeb={() => setHelpSiteWebOpen(false)}
        onCloseInertie={() => setHelpInertieOpen(false)}
        onCloseFacebook={() => setHelpFacebookOpen(false)}
        onCloseInstagram={() => setHelpInstagramOpen(false)}
      />

      <footer className={styles.footer}>
        <div className={styles.footerLeft}>© 2026 iNrCy</div>
      </footer>
    </main>
  );
}
