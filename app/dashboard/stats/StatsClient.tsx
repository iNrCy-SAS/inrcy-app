"use client";

import { useLocale, useTranslations } from "next-intl";


import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./stats.module.css";
import { useRouter } from "next/navigation";
import ResponsiveActionButton from "../_components/ResponsiveActionButton";
import HelpButton from "../_components/HelpButton";
import HelpModal from "../_components/HelpModal";
import {
  applyStatsEditionActionPolicy,
  buildCubeModel,
  buildSummaryActionItems,
  cubeSessionKey,
  emptyCubeState,
  fmtInt,
  hasCapturedLeadsBlocks,
  parseCachedCubeSnapshot,
  parseCachedSummarySnapshot,
  readUiCacheValue,
  safeNum,
  summarySessionKey,
  isPremiumStatsRecommendedTool,
  type CubeKey,
  type CubeModel,
  type CubeState,
  type Overview,
  type Period,
  type StatsTranslator,
} from "./stats.shared";
import {
  EMPTY_INRBADGE_STATS,
  EMPTY_INR_SEARCH_STATS,
  buildInrBadgeCubeModel,
  buildInrSearchCubeModel,
  buildInrSearchOpportunity30,
  buildInitialMailStatsSnapshot,
  buildMailCubeModel,
  buildMailOpportunity30,
  cleanChannelIdentityHint,
  normalizeCapturedLeads,
  readCachedDashboardChannelConnectivity,
  readCachedMailStats,
  type CachedChannelConnectivity,
  type ChannelIdentityHints,
  type InrBadgeStatsSnapshot,
  type InrSearchStatsSnapshot,
  type MailStatsSnapshot,
  type OfficialChannelConnectionStatuses,
} from "./stats.client-foundations";
import { useStatsChannelIdentitySync, useStatsDataController } from "./stats.client-hooks";
import { Cube } from "./stats.ui";
import { useDashboardEdition } from "@/app/dashboard/_components/DashboardEditionProvider";

const useBrowserLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type StatsPanelKey = "all" | CubeKey;

function PlugIcon() {
  return (
    <svg className={styles.plugSvgIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3v5" />
      <path d="M15 3v5" />
      <path d="M8 8h8v4a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4V8Z" />
      <path d="M12 16v5" />
      <path d="M9.5 21h5" />
    </svg>
  );
}

type StatsClientProps = {
  initialInrSearch?: {
    published: boolean;
    slug: string;
    publicUrl: string;
    pageTitle: string;
  };
};

export default function StatsClient({ initialInrSearch }: StatsClientProps) {
  const locale = useLocale();
  const i18nT = useTranslations("stats");
  const runtimeT = i18nT as unknown as StatsTranslator;
  const formatInt = (value: number) => fmtInt(value, locale);
  const router = useRouter();
  const dashboardEdition = useDashboardEdition();
  const standardMode = dashboardEdition === "standard";
  const [helpOpen, setHelpOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);


  // ✅ Période globale (7j / 30j) pour éviter un mix incohérent entre blocs.
  const period: Period = 30;

  const [dataByCube, setDataByCube] = useState<Record<CubeKey, CubeState>>(emptyCubeState);

  const [summaryOpp, setSummaryOpp] = useState<{ loading: boolean; total: number; byCube: Record<CubeKey, number> }>({
    loading: true,
    total: 0,
    byCube: { inrbadge: 0, inr_search: 0, site_inrcy: 0, site_web: 0, gmb: 0, facebook: 0, instagram: 0, linkedin: 0, mails: 0, tiktok: 0, youtube_shorts: 0, pinterest: 0 },
  });
  const [summaryProfile, setSummaryProfile] = useState<{ lead_conversion_rate: number; avg_basket: number }>({ lead_conversion_rate: 0, avg_basket: 0 });
  const [summaryEstimatedByCube, setSummaryEstimatedByCube] = useState<Record<CubeKey, number>>({
    inrbadge: 0,
    inr_search: 0,
    site_inrcy: 0,
    site_web: 0,
    gmb: 0,
    facebook: 0,
    instagram: 0,
    linkedin: 0,
    mails: 0,
    tiktok: 0,
    youtube_shorts: 0,
    pinterest: 0,
  });
  const [, setSummaryHydrated] = useState(false);
  const [activeStatsPanel, setActiveStatsPanel] = useState<StatsPanelKey>("all");
  const [statsMenuOpen, setStatsMenuOpen] = useState(false);
  const [dailyBootReady, setDailyBootReady] = useState(false);
  const [mailStats, setMailStats] = useState<MailStatsSnapshot>(() => buildInitialMailStatsSnapshot(period));
  const [inrBadgeStats, setInrBadgeStats] = useState<InrBadgeStatsSnapshot>(EMPTY_INRBADGE_STATS);
  const [inrSearchStats, setInrSearchStats] = useState<InrSearchStatsSnapshot>(() => ({
    ...EMPTY_INR_SEARCH_STATS,
    loading: false,
    enabled: Boolean(initialInrSearch?.published),
    slug: String(initialInrSearch?.slug || ""),
    publicUrl: String(initialInrSearch?.publicUrl || ""),
    pageTitle: String(initialInrSearch?.pageTitle || ""),
  }));
  const [channelIdentityHints, setChannelIdentityHints] = useState<ChannelIdentityHints>({});
  const [cachedChannelConnectivity, setCachedChannelConnectivity] = useState<CachedChannelConnectivity>(() => readCachedDashboardChannelConnectivity());
  const [officialChannelConnectionStatuses, setOfficialChannelConnectionStatuses] = useState<OfficialChannelConnectionStatuses>({});

  const scrollTo = (key: CubeKey) => {
    setActiveStatsPanel(key);
    setStatsMenuOpen(false);
  };

  // In-memory cache to avoid duplicate fetch bursts (React strict-mode/dev & quick navigations)
  const periodCacheRef = useRef(new Map<number, Record<CubeKey, Overview>>());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const hydratedPeriodsRef = useRef(new Set<number>());
  const lastAutoRefreshAtRef = useRef(0);
  const refreshTimeoutRef = useRef<number | null>(null);
  const lastServerCacheCheckAtRef = useRef(0);
  const serverCacheCheckPromiseRef = useRef<Promise<void> | null>(null);

  useStatsChannelIdentitySync({
    refreshNonce,
    setChannelIdentityHints,
    setCachedChannelConnectivity,
    setOfficialChannelConnectionStatuses,
  });

  const hydrateMailStatsFromCache = useCallback((targetPeriod: Period) => {
    if (standardMode) return false;
    const cachedMail = readCachedMailStats(targetPeriod);
    if (!cachedMail) return false;
    setMailStats((prev) => {
      if (safeNum(prev.syncedAt) > cachedMail.syncedAt) return prev;
      return { ...cachedMail.stats, loading: false, error: undefined, syncedAt: cachedMail.syncedAt };
    });
    return true;
  }, [standardMode]);

  useBrowserLayoutEffect(() => {
    const cachedCube = parseCachedCubeSnapshot(readUiCacheValue(cubeSessionKey(period)));
    const cachedSummary = parseCachedSummarySnapshot(readUiCacheValue(summarySessionKey(period)));
    hydrateMailStatsFromCache(period);

    if (cachedCube?.overviews && hasCapturedLeadsBlocks(cachedCube.blocks)) {
      periodCacheRef.current.set(period, cachedCube.overviews);
      setDataByCube((prev) => {
        const next: typeof prev = { ...prev };
        for (const k of Object.keys(cachedCube.overviews) as CubeKey[]) {
          const cachedBlock = cachedCube.blocks?.[k];
          const hasAuthoritativeOverview = Boolean(cachedBlock && Object.prototype.hasOwnProperty.call(cachedBlock, "overview"));
          next[k] = {
            ov: hasAuthoritativeOverview ? (cachedBlock?.overview as Overview | null | undefined) ?? null : cachedCube.overviews[k] ?? null,
            loading: false,
            error: cachedBlock?.error || undefined,
            capturedLeads: normalizeCapturedLeads(cachedCube.blocks?.[k]?.capturedLeads, prev[k]?.capturedLeads),
          };
        }
        return next;
      });
    }

    if (cachedSummary) {
      const byCubePartial = cachedSummary.byCube || {};
      const estimatedByCubePartial = cachedSummary.estimatedByCube || {};
      setSummaryHydrated(true);
      setSummaryOpp({
        loading: false,
        total: safeNum(cachedSummary.total),
        byCube: {
          inrbadge: 0,
          inr_search: 0,
          site_inrcy: safeNum(byCubePartial.site_inrcy),
          site_web: safeNum(byCubePartial.site_web),
          gmb: safeNum(byCubePartial.gmb),
          facebook: safeNum(byCubePartial.facebook),
          instagram: safeNum(byCubePartial.instagram),
          linkedin: safeNum(byCubePartial.linkedin),
          mails: 0,
          tiktok: safeNum(byCubePartial.tiktok),
          youtube_shorts: safeNum(byCubePartial.youtube_shorts),
          pinterest: safeNum(byCubePartial.pinterest),
        },
      });
      setSummaryProfile({
        lead_conversion_rate: safeNum(cachedSummary.profile?.lead_conversion_rate),
        avg_basket: safeNum(cachedSummary.profile?.avg_basket),
      });
      setSummaryEstimatedByCube({
        inrbadge: 0,
        inr_search: 0,
        site_inrcy: safeNum(estimatedByCubePartial.site_inrcy),
        site_web: safeNum(estimatedByCubePartial.site_web),
        gmb: safeNum(estimatedByCubePartial.gmb),
        facebook: safeNum(estimatedByCubePartial.facebook),
        instagram: safeNum(estimatedByCubePartial.instagram),
        linkedin: safeNum(estimatedByCubePartial.linkedin),
        mails: 0,
        tiktok: safeNum(estimatedByCubePartial.tiktok),
        youtube_shorts: safeNum(estimatedByCubePartial.youtube_shorts),
      pinterest: safeNum(estimatedByCubePartial.pinterest),
      });
    }
  }, [hydrateMailStatsFromCache, period]);

  const { handleSharedStatsRefresh } = useStatsDataController({
    period,
    refreshNonce,
    dailyBootReady,
    isRefreshing,
    periodCacheRef,
    hydratedPeriodsRef,
    lastAutoRefreshAtRef,
    refreshTimeoutRef,
    lastServerCacheCheckAtRef,
    serverCacheCheckPromiseRef,
    setDataByCube,
    setSummaryHydrated,
    setSummaryOpp,
    setSummaryProfile,
    setSummaryEstimatedByCube,
    setLastRefreshAt,
    setIsRefreshing,
    setRefreshNonce,
    setDailyBootReady,
    setMailStats,
    setInrBadgeStats,
    setInrSearchStats,
    hydrateMailStatsFromCache,
    includeMailStats: !standardMode,
  });


  const mailOpportunity30 = useMemo(
    () => (standardMode ? 0 : buildMailOpportunity30(mailStats)),
    [mailStats, standardMode],
  );
  const inrBadgeOpportunity30 = useMemo(() => Math.max(0, Math.round(safeNum(inrBadgeStats.opportunity30))), [inrBadgeStats.opportunity30]);
  const inrSearchOpportunity30 = useMemo(() => buildInrSearchOpportunity30(inrSearchStats), [inrSearchStats]);

  const centralByCube = useMemo<Record<CubeKey, number>>(() => {
    const next: Record<CubeKey, number> = {
      ...summaryOpp.byCube,
      inrbadge: inrBadgeOpportunity30,
      inr_search: inrSearchOpportunity30,
      mails: standardMode ? 0 : mailOpportunity30,
    };

    // L'état officiel de connexion est prioritaire sur tout snapshot de statistiques.
    // Un canal déconnecté ou à reconnecter ne doit jamais conserver d'anciens chiffres.
    for (const [key, status] of Object.entries(officialChannelConnectionStatuses)) {
      if (status && status !== "connected" && key in next) next[key as CubeKey] = 0;
    }

    return next;
  }, [inrBadgeOpportunity30, inrSearchOpportunity30, mailOpportunity30, officialChannelConnectionStatuses, standardMode, summaryOpp.byCube]);

  const centralPotential30 = Math.max(
    0,
    Object.values(centralByCube).reduce((sum, value) => sum + safeNum(value), 0),
  );

  const models: CubeModel[] = useMemo(() => {
    const baseModels: CubeModel[] = [
      buildInrBadgeCubeModel(period, inrBadgeStats, { appointmentsEnabled: !standardMode }, locale, runtimeT),
      buildInrSearchCubeModel(period, inrSearchStats, locale, runtimeT),
      ...(!standardMode ? [buildMailCubeModel(mailStats, period, locale, runtimeT)] : []),
      buildCubeModel("site_inrcy", i18nT("site_inrcy_57016d6f"), i18nT("subtitle_optimized_for_conversion"), period, dataByCube.site_inrcy, centralByCube, officialChannelConnectionStatuses.site_inrcy, locale, runtimeT),
      buildCubeModel("site_web", i18nT("site_web_c72c13ef"), i18nT("subtitle_your_image"), period, dataByCube.site_web, centralByCube, officialChannelConnectionStatuses.site_web, locale, runtimeT),
      buildCubeModel("gmb", i18nT("google_business_a605b655"), i18nT("visibilite_locale_afa9cdc9"), period, dataByCube.gmb, centralByCube, officialChannelConnectionStatuses.gmb, locale, runtimeT),
      buildCubeModel("facebook", i18nT("facebook_82da67b2"), i18nT("subtitle_social_visibility"), period, dataByCube.facebook, centralByCube, officialChannelConnectionStatuses.facebook, locale, runtimeT),
      buildCubeModel("instagram", i18nT("instagram_5721bbef"), i18nT("subtitle_brand_visibility"), period, dataByCube.instagram, centralByCube, officialChannelConnectionStatuses.instagram, locale, runtimeT),
      buildCubeModel("linkedin", i18nT("linkedin_6b6390a4"), i18nT("subtitle_professional_visibility"), period, dataByCube.linkedin, centralByCube, officialChannelConnectionStatuses.linkedin, locale, runtimeT),
      buildCubeModel("tiktok", i18nT("tiktok_fc49f156"), i18nT("subtitle_short_photos_videos"), period, dataByCube.tiktok, centralByCube, officialChannelConnectionStatuses.tiktok, locale, runtimeT),
      buildCubeModel("youtube_shorts", i18nT("youtube_558865a1"), i18nT("subtitle_short_long_videos"), period, dataByCube.youtube_shorts, centralByCube, officialChannelConnectionStatuses.youtube_shorts, locale, runtimeT),
      buildCubeModel("pinterest", i18nT("title_pinterest"), i18nT("subtitle_inspiration_ideas"), period, dataByCube.pinterest, centralByCube, officialChannelConnectionStatuses.pinterest, locale, runtimeT),
    ];

    return baseModels.map((model) => {
      const officialStatus = officialChannelConnectionStatuses[model.key];
      const cachedConnected = officialStatus
        ? officialStatus === "connected"
        : cachedChannelConnectivity[model.key] === true;
      const isSite = model.key === "site_inrcy" || model.key === "site_web";
      const liveConnected = isSite
        ? Boolean(model.connections.ga4 || model.connections.gsc)
        : Boolean(model.connections.main);
      const forceUnavailable = Boolean(officialStatus && officialStatus !== "connected");
      const hydratedModel: CubeModel = forceUnavailable
        ? {
            ...model,
            connectionStatus: officialStatus,
            connectionPending: false,
            connections: isSite
              ? { ...model.connections, ga4: false, gsc: false }
              : { ...model.connections, main: false },
            opportunity30: 0,
            capturedLeads: { week: 0, month: 0 },
            action: {
              key: "connect",
              title: officialStatus === "needs_update" ? i18nT("reconnecter_value_d8079aa6", { value0: model.title }) : i18nT("connexion_a33c58f5"),
              detail: officialStatus === "needs_update"
                ? i18nT("stats_reconnect_expired_channel")
                : i18nT("stats_connect_channel_to_activate"),
              href: "/dashboard",
              pill: i18nT("connexion_a33c58f5"),
            },
          }
        : cachedConnected && !liveConnected
          ? {
            ...model,
            connectionPending: false,
            connectionStatus: "connected",
            connections: isSite
              ? { ...model.connections, ga4: true }
              : { ...model.connections, main: true },
          }
          : model;
      const availabilityAwareModel: CubeModel = officialStatus === "unavailable"
        ? {
            ...hydratedModel,
            connectionPending: true,
            action: {
              key: "loading",
              title: i18nT("synchronisation_indisponible_8d911564"),
              detail: i18nT("stats_old_data_neutralized"),
              href: "",
              pill: i18nT("connexion_a33c58f5"),
            },
          }
        : hydratedModel;
      const identityHint = cleanChannelIdentityHint(channelIdentityHints[model.key]);
      const identityAwareModel = identityHint
        ? {
            ...availabilityAwareModel,
            // La source fraîche est la même que celle des bulles du Dashboard.
            // Elle prend donc le dessus sur un éventuel snapshot iNrStats plus ancien.
            accountLabel: identityHint,
          }
        : availabilityAwareModel;

      return {
        ...identityAwareModel,
        action: applyStatsEditionActionPolicy(identityAwareModel.action, standardMode),
      };
    });
  }, [cachedChannelConnectivity, centralByCube, channelIdentityHints, dataByCube, i18nT, inrBadgeStats, inrSearchStats, locale, mailStats, officialChannelConnectionStatuses, period, runtimeT, standardMode]);

  const computedEstimatedByCube = useMemo<Record<CubeKey, number>>(() => {
    const rate = Math.max(0, safeNum(summaryProfile.lead_conversion_rate)) / 100;
    const basket = Math.max(0, safeNum(summaryProfile.avg_basket));
    const estimate = (opportunities: number) => Math.round(Math.max(0, safeNum(opportunities)) * rate * basket);

    return {
      inrbadge: estimate(centralByCube.inrbadge),
      inr_search: estimate(centralByCube.inr_search),
      site_inrcy: estimate(centralByCube.site_inrcy),
      site_web: estimate(centralByCube.site_web),
      gmb: estimate(centralByCube.gmb),
      facebook: estimate(centralByCube.facebook),
      instagram: estimate(centralByCube.instagram),
      linkedin: estimate(centralByCube.linkedin),
      mails: standardMode ? 0 : estimate(centralByCube.mails),
      tiktok: estimate(centralByCube.tiktok),
      youtube_shorts: estimate(centralByCube.youtube_shorts),
      pinterest: estimate(centralByCube.pinterest),
    };
  }, [centralByCube, standardMode, summaryProfile.avg_basket, summaryProfile.lead_conversion_rate]);

  const summaryActionItems = useMemo(() => buildSummaryActionItems({
    centralByCube,
    computedEstimatedByCube,
    models,
    summaryEstimatedByCube,
    t: runtimeT,
  }), [centralByCube, computedEstimatedByCube, models, runtimeT, summaryEstimatedByCube]);

  const summaryActionByChannel = useMemo(() => {
    return new Map(summaryActionItems.map((item) => [item.key, item]));
  }, [summaryActionItems]);

  const connectedChannelsCount = useMemo(() => {
    return models.reduce((total, model) => {
      const isSite = model.key === "site_inrcy" || model.key === "site_web";
      const connected = isSite ? !!model.connections.ga4 || !!model.connections.gsc : !!model.connections.main || !!model.connectionPending;
      return total + (connected ? 1 : 0);
    }, 0);
  }, [models]);

  const totalCapturedLeads30 = useMemo(() => {
    return models.reduce((total, model) => total + safeNum(model.capturedLeads.month), 0);
  }, [models]);

  const activeModel = activeStatsPanel === "all"
    ? null
    : models.find((model) => model.key === activeStatsPanel) ?? models[0] ?? null;

  const navigateFromStats = (href: string) => {
    if (/^https?:\/\//i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
    else if (href.startsWith("/api/")) window.location.href = href;
    else router.push(href);
  };

  async function generateStatsReportNow() {
    if (isGeneratingReport) return;

    setIsGeneratingReport(true);
    setReportNotice(i18nT("report_generation_progress"));

    try {
      const response = await fetch("/api/agent/actions/send-stats-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: "inrstats" }),
      });
      const payload = (await response.json().catch(() => null)) as {
        sent?: boolean;
        recipientEmail?: string;
        error?: string;
        detail?: string;
      } | null;

      if (!response.ok || !payload?.sent) {
        throw new Error(
          payload?.error ||
            payload?.detail ||
            i18nT("report_generation_failed"),
        );
      }

      setReportNotice(i18nT("report_sent", {
        hasEmail: payload.recipientEmail ? "yes" : "no",
        email: payload.recipientEmail || "",
      }));
      setTimeout(() => setReportNotice(null), 4500);
    } catch (error) {
      setReportNotice(
        error instanceof Error
          ? error.message
          : i18nT("report_generation_failed"),
      );
    } finally {
      setIsGeneratingReport(false);
    }
  }

  const selectStatsPanel = (panel: StatsPanelKey) => {
    setActiveStatsPanel(panel);
    setStatsMenuOpen(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.brand}>
            <img
              src="/inrstats-logo.png"
              alt={i18nT("inr_stats_323b32a2")}
              width={154}
              height={64}
              className={styles.headerLogo}
              loading="eager"
              decoding="sync"
              fetchPriority="high"
            />
            <div className={`${styles.tagline} ${styles.taglineDesktop}`}>{i18nT("vos_donnees_analysees_en_mode_business_11b869ec")}</div>
          </div>

          <div className={styles.headerActions}>
            <div className={styles.headerCloseControls}>
              <HelpButton onClick={() => setHelpOpen(true)} title={i18nT("aide_inr_stats_14d89e71")} size={34} />
              <button
                type="button"
                className={styles.statsMobileNavButton}
                onClick={() => setStatsMenuOpen(true)}
                aria-label={i18nT("ouvrir_les_canaux_inr_stats_23157396")}
                title={i18nT("canaux_27cb4473")}
              >
                ☰
              </button>
              <ResponsiveActionButton
                desktopLabel={isRefreshing ? i18nT("refresh_in_progress") : i18nT("refresh_now")}
                mobileIcon="↻"
                onClick={() => {
                  void handleSharedStatsRefresh();
                }}
                ariaLabel={i18nT("actualiser_les_donnees_inr_stats_86d7bbef")}
                title={lastRefreshAt ? i18nT("stats_last_refresh", { time: new Date(lastRefreshAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }) : i18nT("stats_refresh")}
              />
              <ResponsiveActionButton desktopLabel={i18nT("fermer_5ab4ec64")} mobileIcon="✕" onClick={() => router.push("/dashboard")} title={i18nT("retour_au_tableau_de_bord_72006dd2")} />
            </div>
          </div>
        </div>
        <div className={`${styles.tagline} ${styles.taglineMobile}`}>{i18nT("vos_donnees_analysees_en_mode_business_11b869ec")}</div>
        {reportNotice ? (
          <div className={styles.reportNotice} role="status">
            {reportNotice}
          </div>
        ) : null}
      </div>

      <HelpModal open={helpOpen} title={i18nT("inr_stats_323b32a2")} onClose={() => setHelpOpen(false)}>
        <p style={{ marginTop: 0 }}>
          {i18nT("inr_stats_analyse_les_donnees_recuperees_0a6b0cad")}{" "}</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>{i18nT("comprenez_votre_potentiel_d_opportunites_sur_fa5e3aab")}</li>
          <li>{i18nT("identifiez_les_actions_a_mener_pour_09a3bade")}</li>
          <li>{i18nT("suivez_l_evolution_par_canal_et_c09ea54b")}</li>
        </ul>
      </HelpModal>

      {statsMenuOpen ? (
        <div className={styles.statsMobileDrawerOverlay} role="presentation" onClick={() => setStatsMenuOpen(false)}>
          <aside className={styles.statsMobileDrawer} aria-label={i18nT("choisir_une_vue_inr_stats_4a70e095")} onClick={(event) => event.stopPropagation()}>
            <div className={styles.statsMobileDrawerHead}>
              <strong>{i18nT("canaux_27cb4473")}</strong>
              <button type="button" onClick={() => setStatsMenuOpen(false)} aria-label={i18nT("fermer_le_menu_des_canaux_d436bbec")}>×</button>
            </div>

            <div className={styles.statsMobileDrawerList}>
              <button
                type="button"
                className={`${styles.statsMobileDrawerItem} ${styles.statsRailItemGlobal} ${connectedChannelsCount > 0 ? styles.statsRailItemConnected : styles.statsRailItemOff} ${activeStatsPanel === "all" ? styles.statsMobileDrawerItemActive : ""}`}
                onClick={() => selectStatsPanel("all")}
              >
                <span className={styles.statsRailDot} aria-hidden />
                <span className={styles.statsRailText}>
                  <b>{i18nT("tous_b97ae3b4")}</b>
                  <small>{i18nT("vue_globale_08073c33")}</small>
                </span>
                <span className={styles.statsRailValue}>+{formatInt(centralPotential30)}</span>
              </button>

              {models.map((model) => {
                const isSite = model.key === "site_inrcy" || model.key === "site_web";
                const connectionPending = model.connectionStatus === "unavailable" || (model.key === "mails" && !!model.connectionPending) || (model.key === "inr_search" && model.loading);
                const connected = !connectionPending && (isSite ? !!model.connections.ga4 || !!model.connections.gsc : !!model.connections.main);
                const reconnectRequired = model.connectionStatus === "needs_update";
                const isActive = activeStatsPanel === model.key;

                return (
                  <button
                    type="button"
                    key={model.key}
                    className={`${styles.statsMobileDrawerItem} ${isActive ? styles.statsMobileDrawerItemActive : ""} ${reconnectRequired ? styles.statsRailItemReconnect : connected ? styles.statsRailItemConnected : styles.statsRailItemOff}`}
                    onClick={() => selectStatsPanel(model.key)}
                  >
                    <span className={styles.statsRailDot} aria-hidden />
                    <span className={styles.statsRailText}>
                      <b>{model.title}</b>
                      <small>{reconnectRequired ? i18nT("a_reconnecter_bb56a9d2") : model.key === "inr_search" ? (connectionPending ? i18nT("synchronisation_cc8ad3ae") : connected ? i18nT("page_publiee_1916dffd") : i18nT("page_indisponible_1d78169a")) : connectionPending ? i18nT("verification_bb27abfb") : connected ? i18nT("connecte_ce09957c") : i18nT("deconnecte_3a67fd80")}</small>
                    </span>
                    <span className={styles.statsRailValue}>+{formatInt(model.opportunity30)}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      ) : null}

      <div
        className={`${styles.statsWorkspace} ${activeStatsPanel === "all" ? "" : styles.statsWorkspaceChannel}`}
        data-stats-view={activeStatsPanel === "all" ? "global" : "channel"}
      >
        <aside className={styles.statsRail} aria-label={i18nT("canaux_inr_stats_d37cba0f")}>
          <button
            type="button"
            className={`${styles.statsRailItem} ${styles.statsRailItemGlobal} ${connectedChannelsCount > 0 ? styles.statsRailItemConnected : styles.statsRailItemOff} ${activeStatsPanel === "all" ? styles.statsRailItemActive : ""}`}
            onClick={() => selectStatsPanel("all")}
          >
            <span className={styles.statsRailDot} aria-hidden />
            <span className={styles.statsRailText}>
              <b>{i18nT("tous_b97ae3b4")}</b>
              <small>{i18nT("vue_globale_08073c33")}</small>
            </span>
            <span className={styles.statsRailValue}>+{formatInt(centralPotential30)}</span>
          </button>

          {models.map((model) => {
            const isSite = model.key === "site_inrcy" || model.key === "site_web";
            const connectionPending = model.connectionStatus === "unavailable" || (model.key === "mails" && !!model.connectionPending) || (model.key === "inr_search" && model.loading);
            const connected = !connectionPending && (isSite ? !!model.connections.ga4 || !!model.connections.gsc : !!model.connections.main);
            const reconnectRequired = model.connectionStatus === "needs_update";
            const isActive = activeStatsPanel === model.key;

            return (
              <button
                key={model.key}
                type="button"
                className={`${styles.statsRailItem} ${isActive ? styles.statsRailItemActive : ""} ${reconnectRequired ? styles.statsRailItemReconnect : connected ? styles.statsRailItemConnected : styles.statsRailItemOff}`}
                onClick={() => selectStatsPanel(model.key)}
              >
                <span className={styles.statsRailDot} aria-hidden />
                <span className={styles.statsRailText}>
                  <b>{model.title}</b>
                  <small>{reconnectRequired ? i18nT("a_reconnecter_bb56a9d2") : model.key === "inr_search" ? (connectionPending ? i18nT("synchronisation_cc8ad3ae") : connected ? i18nT("page_publiee_1916dffd") : i18nT("page_indisponible_1d78169a")) : connectionPending ? i18nT("verification_bb27abfb") : connected ? i18nT("connecte_ce09957c") : i18nT("deconnecte_3a67fd80")}</small>
                </span>
                <span className={styles.statsRailValue}>+{formatInt(model.opportunity30)}</span>
              </button>
            );
          })}
        </aside>

        <main className={styles.statsPanel}>
          {activeStatsPanel === "all" ? (
            <section className={styles.allStatsPanel} aria-label={i18nT("vue_globale_inr_stats_db5feb84")}>
              <div className={styles.allStatsHero}>
                <div className={styles.allStatsHeaderMain}>
                  <div className={styles.allStatsHeadingRow}>
                    <h2 className={styles.allStatsTitle}>{i18nT("vue_globale_tous_vos_canaux_en_60fb6351")}</h2>
                    <button
                      type="button"
                      className={styles.allStatsReportButton}
                      onClick={() => {
                        void generateStatsReportNow();
                      }}
                      disabled={isGeneratingReport}
                      aria-label={i18nT("generer_un_bilan_inr_stats_manuel_30ea8535")}
                      title={i18nT("creer_et_envoyer_un_bilan_manuel_f462a5fc")}
                    >
                      {isGeneratingReport ? i18nT("generation_du_bilan_9b3321bd") : i18nT("generer_un_bilan_77d1d8d2")}
                    </button>
                  </div>
                  <p className={styles.allStatsText}>
                    {i18nT("synthese_par_canal_opportunites_activables_ca_7b735b50")}{" "}</p>
                </div>

                <div className={styles.allStatsKpis}>
                  <div className={`${styles.allStatsKpi} ${styles.kpiToneBlue}`}>
                    <span>{i18nT("opportunites_0dbfa3c5")}</span>
                    <b>+{formatInt(centralPotential30)}</b>
                  </div>
                  <div className={`${styles.allStatsKpi} ${styles.kpiTonePurple}`}>
                    <span>{i18nT("ca_potentiel_fc9eeae4")}</span>
                    <b>+{formatInt(summaryActionItems.reduce((total, item) => total + safeNum(item.revenue), 0))} €</b>
                  </div>
                  <div className={`${styles.allStatsKpi} ${styles.kpiToneGreen}`}>
                    <span>{i18nT("demandes_captees_30_j_a45db939")}</span>
                    <b>{formatInt(totalCapturedLeads30)}</b>
                  </div>
                  <div className={`${styles.allStatsKpi} ${styles.kpiToneSlate}`}>
                    <span>{i18nT("canaux_27cb4473")}</span>
                    <b>{models.length}</b>
                  </div>
                </div>
              </div>

              <div className={styles.allStatsActions}>
                {models.map((model) => {
                  const actionItem = summaryActionByChannel.get(model.key);
                  const revenue = summaryEstimatedByCube[model.key] || computedEstimatedByCube[model.key] || actionItem?.revenue || 0;
                  const isSite = model.key === "site_inrcy" || model.key === "site_web";
                  const connectionPending = model.connectionStatus === "unavailable" || (model.key === "mails" && !!model.connectionPending) || (model.key === "inr_search" && model.loading);
                  const connected = !connectionPending && (isSite ? !!model.connections.ga4 || !!model.connections.gsc : !!model.connections.main);
                  const displayedTool = actionItem?.badge ?? model.action.pill;
                  const premiumLocked = standardMode && connected && isPremiumStatsRecommendedTool(actionItem?.recommendedTool);
                  const actionHref = premiumLocked ? "" : actionItem?.actionHref || model.action.href || "#";
                  const actionTitle = premiumLocked
                    ? i18nT("stats_premium_action_locked", { tool: displayedTool })
                    : connected
                      ? i18nT("stats_run_recommended_action")
                      : i18nT("stats_configure_channel");

                  return (
                    <article
                      key={model.key}
                      className={`${styles.allStatsActionCard} ${connected ? styles.allStatsActionCardConnected : styles.allStatsActionCardOff}`}
                    >
                      <button
                        type="button"
                        className={styles.allStatsDetailArrow}
                        onClick={() => scrollTo(model.key)}
                        aria-label={i18nT("voir_le_detail_value_ba79238d", { value0: model.title })}
                        title={i18nT("voir_le_detail_c6565c15")}
                      >
                        ↗
                      </button>

                      <button type="button" className={styles.allStatsChannelButton} onClick={() => scrollTo(model.key)}>
                        <span className={styles.allStatsChannelName}>{model.title}</span>
                      </button>

                      <div className={styles.allStatsMetrics}>
                        <span>
                          <small>{i18nT("opportunites_0dbfa3c5")}</small>
                          <b>+{formatInt(model.opportunity30)}</b>
                        </span>
                        <span>
                          <small>{i18nT("ca_potentiel_fc9eeae4")}</small>
                          <b>+{formatInt(revenue)} €</b>
                        </span>
                      </div>

                      <div className={styles.allStatsRecommendedAction}>
                        <span
                          className={`${styles.allStatsToolBadge} ${connected ? "" : styles.allStatsToolBadgeConnect} ${premiumLocked ? styles.actionPillPremiumLocked : ""}`}
                          title={premiumLocked ? actionTitle : undefined}
                          aria-label={premiumLocked ? actionTitle : undefined}
                        >
                          {premiumLocked ? <span className={styles.premiumLockIcon} aria-hidden="true">🔒</span> : null}
                          {displayedTool}
                        </span>
                      </div>

                      <button
                        type="button"
                        className={`${styles.allStatsGoButton} ${connected ? styles.allStatsGoButtonOn : styles.allStatsGoButtonConnect} ${premiumLocked ? styles.allStatsGoButtonDisabled : ""}`}
                        onClick={() => {
                          if (premiumLocked) return;
                          if (actionHref && actionHref !== "#") navigateFromStats(actionHref);
                          else scrollTo(model.key);
                        }}
                        disabled={premiumLocked}
                        aria-disabled={premiumLocked || undefined}
                        title={actionTitle}
                      >
                        {premiumLocked
                          ? i18nT("stats_go_locked")
                          : connected
                            ? i18nT("go_bb63fc96")
                            : <>{i18nT("go_f63f96ef")}{" "}<PlugIcon /></>}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : activeModel ? (
            <section className={styles.channelStatsPanel} aria-label={i18nT("donnees_value_9d3b1503", { value0: activeModel.title })}>
              <div className={styles.channelStatsHeader}>
                <div className={styles.channelStatsTitleBlock}>
                  <div className={styles.allStatsEyebrow}>{i18nT("canal_actif_09801074")}</div>
                  <h2 className={styles.allStatsTitle}>{activeModel.title}</h2>
                  <p className={styles.allStatsText}>{activeModel.subtitle}</p>
                </div>

                <div className={`${styles.allStatsKpis} ${styles.channelStatsKpis} ${activeModel.key === "mails" ? styles.channelStatsKpisMail : ""}`}>
                  <div className={`${styles.allStatsKpi} ${styles.kpiToneBlue}`}>
                    <span>{i18nT("opportunites_0dbfa3c5")}</span>
                    <b>+{formatInt(activeModel.opportunity30)}</b>
                  </div>
                  <div className={`${styles.allStatsKpi} ${styles.kpiTonePurple}`}>
                    <span>{i18nT("ca_potentiel_fc9eeae4")}</span>
                    <b>+{formatInt(summaryEstimatedByCube[activeModel.key] || computedEstimatedByCube[activeModel.key] || 0)} €</b>
                  </div>
                  {activeModel.key !== "mails" ? (
                    <div className={`${styles.allStatsKpi} ${styles.kpiToneGreen} ${styles.channelDemandesKpi}`}>
                      <span className={styles.channelDemandesKpiLabel}>{i18nT("demandes_captees_7j_30j_d1d1b0de")}</span>
                      <b>{activeModel.capturedLeadsUnavailable ? "—" : `${formatInt(activeModel.capturedLeads.week)} / ${formatInt(activeModel.capturedLeads.month)}`}</b>
                    </div>
                  ) : null}
                </div>
              </div>

              <Cube
                model={activeModel}
                onNavigate={navigateFromStats}
                forceOpen
                hideDetailsToggle
                estimatedRevenue={summaryEstimatedByCube[activeModel.key] || computedEstimatedByCube[activeModel.key] || 0}
              />
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
