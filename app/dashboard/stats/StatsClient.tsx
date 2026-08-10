"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./stats.module.css";
import { useRouter } from "next/navigation";
import ResponsiveActionButton from "../_components/ResponsiveActionButton";
import HelpButton from "../_components/HelpButton";
import HelpModal from "../_components/HelpModal";
import {
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
  type CubeKey,
  type CubeModel,
  type CubeState,
  type Overview,
  type Period,
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
  });

  const hydrateMailStatsFromCache = useCallback((targetPeriod: Period) => {
    const cachedMail = readCachedMailStats(targetPeriod);
    if (!cachedMail) return false;
    setMailStats((prev) => {
      if (safeNum(prev.syncedAt) > cachedMail.syncedAt) return prev;
      return { ...cachedMail.stats, loading: false, error: undefined, syncedAt: cachedMail.syncedAt };
    });
    return true;
  }, []);

  useBrowserLayoutEffect(() => {
    const cachedCube = parseCachedCubeSnapshot(readUiCacheValue(cubeSessionKey(period)));
    const cachedSummary = parseCachedSummarySnapshot(readUiCacheValue(summarySessionKey(period)));
    hydrateMailStatsFromCache(period);

    if (cachedCube?.overviews && hasCapturedLeadsBlocks(cachedCube.blocks)) {
      periodCacheRef.current.set(period, cachedCube.overviews);
      setDataByCube((prev) => {
        const next: typeof prev = { ...prev };
        for (const k of Object.keys(cachedCube.overviews) as CubeKey[]) {
          next[k] = {
            ov: cachedCube.overviews[k] ?? null,
            loading: false,
            error: undefined,
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
  });


  const mailOpportunity30 = useMemo(() => buildMailOpportunity30(mailStats), [mailStats]);
  const inrBadgeOpportunity30 = useMemo(() => Math.max(0, Math.round(safeNum(inrBadgeStats.opportunity30))), [inrBadgeStats.opportunity30]);
  const inrSearchOpportunity30 = useMemo(() => buildInrSearchOpportunity30(inrSearchStats), [inrSearchStats]);

  const centralByCube = useMemo<Record<CubeKey, number>>(() => ({
    ...summaryOpp.byCube,
    inrbadge: inrBadgeOpportunity30,
    inr_search: inrSearchOpportunity30,
    mails: mailOpportunity30,
  }), [inrBadgeOpportunity30, inrSearchOpportunity30, mailOpportunity30, summaryOpp.byCube]);

  const centralPotential30 = Math.max(0, safeNum(summaryOpp.total) + mailOpportunity30 + inrBadgeOpportunity30 + inrSearchOpportunity30);

  const models: CubeModel[] = useMemo(() => {
    const baseModels: CubeModel[] = [
      buildInrBadgeCubeModel(period, inrBadgeStats, { appointmentsEnabled: !standardMode }),
      buildInrSearchCubeModel(period, inrSearchStats),
      buildMailCubeModel(mailStats, period),
      buildCubeModel("site_inrcy", "Site iNrCy", "Optimisé pour convertir", period, dataByCube.site_inrcy, centralByCube),
      buildCubeModel("site_web", "Site Web", "Votre image", period, dataByCube.site_web, centralByCube),
      buildCubeModel("gmb", "Google Business", "Visibilité locale", period, dataByCube.gmb, centralByCube),
      buildCubeModel("facebook", "Facebook", "Visibilité sociale", period, dataByCube.facebook, centralByCube),
      buildCubeModel("instagram", "Instagram", "Visibilité de marque", period, dataByCube.instagram, centralByCube),
      buildCubeModel("linkedin", "LinkedIn", "Visibilité professionnelle", period, dataByCube.linkedin, centralByCube),
      buildCubeModel("tiktok", "TikTok", "Photos & vidéos courtes", period, dataByCube.tiktok, centralByCube),
      buildCubeModel("youtube_shorts", "YouTube", "Vidéos courtes & longues", period, dataByCube.youtube_shorts, centralByCube),
      buildCubeModel("pinterest", "Pinterest", "Inspiration & idées", period, dataByCube.pinterest, centralByCube),
    ];

    return baseModels.map((model) => {
      const cachedConnected = cachedChannelConnectivity[model.key] === true;
      const isSite = model.key === "site_inrcy" || model.key === "site_web";
      const liveConnected = isSite
        ? Boolean(model.connections.ga4 || model.connections.gsc)
        : Boolean(model.connections.main);
      const hydratedModel = cachedConnected && !liveConnected
        ? {
            ...model,
            connectionPending: false,
            connections: isSite
              ? { ...model.connections, ga4: true }
              : { ...model.connections, main: true },
          }
        : model;
      const identityHint = cleanChannelIdentityHint(channelIdentityHints[model.key]);
      if (!identityHint) return hydratedModel;

      // La source fraîche est la même que celle des bulles du Dashboard.
      // Elle prend donc le dessus sur un éventuel snapshot iNrStats plus ancien.
      return { ...hydratedModel, accountLabel: identityHint };
    });
  }, [cachedChannelConnectivity, centralByCube, channelIdentityHints, dataByCube, inrBadgeStats, inrSearchStats, mailStats, period, standardMode]);

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
      mails: estimate(centralByCube.mails),
      tiktok: estimate(centralByCube.tiktok),
      youtube_shorts: estimate(centralByCube.youtube_shorts),
      pinterest: estimate(centralByCube.pinterest),
    };
  }, [centralByCube, summaryProfile.avg_basket, summaryProfile.lead_conversion_rate]);

  const summaryActionItems = useMemo(() => buildSummaryActionItems({
    centralByCube,
    computedEstimatedByCube,
    models,
    summaryEstimatedByCube,
  }), [centralByCube, computedEstimatedByCube, models, summaryEstimatedByCube]);

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
    setReportNotice("Génération du bilan en cours…");

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
            "Génération ou envoi du bilan iNr’Stats impossible.",
        );
      }

      setReportNotice(
        `Bilan généré et envoyé${payload.recipientEmail ? ` à ${payload.recipientEmail}` : ""}.`,
      );
      setTimeout(() => setReportNotice(null), 4500);
    } catch (error) {
      setReportNotice(
        error instanceof Error
          ? error.message
          : "Génération ou envoi du bilan iNr’Stats impossible.",
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
              alt="iNr’Stats"
              width={154}
              height={64}
              className={styles.headerLogo}
              loading="eager"
              decoding="sync"
              fetchPriority="high"
            />
            <div className={`${styles.tagline} ${styles.taglineDesktop}`}>Vos données analysées en mode business.</div>
          </div>

          <div className={styles.headerActions}>
            <div className={styles.headerCloseControls}>
              <HelpButton onClick={() => setHelpOpen(true)} title="Aide iNr’Stats" size={34} />
              <button
                type="button"
                className={styles.statsMobileNavButton}
                onClick={() => setStatsMenuOpen(true)}
                aria-label="Ouvrir les canaux iNr’Stats"
                title="Canaux"
              >
                ☰
              </button>
              <ResponsiveActionButton
                desktopLabel={isRefreshing ? "Actualisation…" : "Actualiser"}
                mobileIcon="↻"
                onClick={() => {
                  void handleSharedStatsRefresh();
                }}
                ariaLabel="Actualiser les données iNr’Stats"
                title={lastRefreshAt ? `Dernière actualisation : ${new Date(lastRefreshAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Mettre à jour les statistiques"}
              />
              <ResponsiveActionButton desktopLabel="Fermer" mobileIcon="✕" onClick={() => router.push("/dashboard")} title="Retour au tableau de bord" />
            </div>
          </div>
        </div>
        <div className={`${styles.tagline} ${styles.taglineMobile}`}>Vos données analysées en mode business.</div>
        {reportNotice ? (
          <div className={styles.reportNotice} role="status">
            {reportNotice}
          </div>
        ) : null}
      </div>

      <HelpModal open={helpOpen} title="iNr’Stats" onClose={() => setHelpOpen(false)}>
        <p style={{ marginTop: 0 }}>
          iNr’Stats analyse les données récupérées sur vos canaux (site, Google, réseaux…) et les transforme en analyse business.
        </p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Comprenez votre potentiel d’opportunités sur les 30 jours à venir.</li>
          <li>Identifiez les actions à mener pour capter ce potentiel.</li>
          <li>Suivez l’évolution par canal et identifiez les actions à mener sur les 30 jours à venir.</li>
        </ul>
      </HelpModal>

      {statsMenuOpen ? (
        <div className={styles.statsMobileDrawerOverlay} role="presentation" onClick={() => setStatsMenuOpen(false)}>
          <aside className={styles.statsMobileDrawer} aria-label="Choisir une vue iNr’Stats" onClick={(event) => event.stopPropagation()}>
            <div className={styles.statsMobileDrawerHead}>
              <strong>Canaux</strong>
              <button type="button" onClick={() => setStatsMenuOpen(false)} aria-label="Fermer le menu des canaux">×</button>
            </div>

            <div className={styles.statsMobileDrawerList}>
              <button
                type="button"
                className={`${styles.statsMobileDrawerItem} ${styles.statsRailItemGlobal} ${connectedChannelsCount > 0 ? styles.statsRailItemConnected : styles.statsRailItemOff} ${activeStatsPanel === "all" ? styles.statsMobileDrawerItemActive : ""}`}
                onClick={() => selectStatsPanel("all")}
              >
                <span className={styles.statsRailDot} aria-hidden />
                <span className={styles.statsRailText}>
                  <b>Tous</b>
                  <small>Vue globale</small>
                </span>
                <span className={styles.statsRailValue}>+{fmtInt(centralPotential30)}</span>
              </button>

              {models.map((model) => {
                const isSite = model.key === "site_inrcy" || model.key === "site_web";
                const connectionPending = (model.key === "mails" && !!model.connectionPending) || (model.key === "inr_search" && model.loading);
                const connected = !connectionPending && (isSite ? !!model.connections.ga4 || !!model.connections.gsc : !!model.connections.main);
                const isActive = activeStatsPanel === model.key;

                return (
                  <button
                    type="button"
                    key={model.key}
                    className={`${styles.statsMobileDrawerItem} ${isActive ? styles.statsMobileDrawerItemActive : ""} ${connected ? styles.statsRailItemConnected : styles.statsRailItemOff}`}
                    onClick={() => selectStatsPanel(model.key)}
                  >
                    <span className={styles.statsRailDot} aria-hidden />
                    <span className={styles.statsRailText}>
                      <b>{model.title}</b>
                      <small>{model.key === "inr_search" ? (connectionPending ? "Synchronisation…" : connected ? "Page publiée" : "Page indisponible") : connectionPending ? "Vérification" : connected ? "Connecté" : "Déconnecté"}</small>
                    </span>
                    <span className={styles.statsRailValue}>+{fmtInt(model.opportunity30)}</span>
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
        <aside className={styles.statsRail} aria-label="Canaux iNr’Stats">
          <button
            type="button"
            className={`${styles.statsRailItem} ${styles.statsRailItemGlobal} ${connectedChannelsCount > 0 ? styles.statsRailItemConnected : styles.statsRailItemOff} ${activeStatsPanel === "all" ? styles.statsRailItemActive : ""}`}
            onClick={() => selectStatsPanel("all")}
          >
            <span className={styles.statsRailDot} aria-hidden />
            <span className={styles.statsRailText}>
              <b>Tous</b>
              <small>Vue globale</small>
            </span>
            <span className={styles.statsRailValue}>+{fmtInt(centralPotential30)}</span>
          </button>

          {models.map((model) => {
            const isSite = model.key === "site_inrcy" || model.key === "site_web";
            const connectionPending = (model.key === "mails" && !!model.connectionPending) || (model.key === "inr_search" && model.loading);
            const connected = !connectionPending && (isSite ? !!model.connections.ga4 || !!model.connections.gsc : !!model.connections.main);
            const isActive = activeStatsPanel === model.key;

            return (
              <button
                key={model.key}
                type="button"
                className={`${styles.statsRailItem} ${isActive ? styles.statsRailItemActive : ""} ${connected ? styles.statsRailItemConnected : styles.statsRailItemOff}`}
                onClick={() => selectStatsPanel(model.key)}
              >
                <span className={styles.statsRailDot} aria-hidden />
                <span className={styles.statsRailText}>
                  <b>{model.title}</b>
                  <small>{model.key === "inr_search" ? (connectionPending ? "Synchronisation…" : connected ? "Page publiée" : "Page indisponible") : connectionPending ? "Vérification" : connected ? "Connecté" : "Déconnecté"}</small>
                </span>
                <span className={styles.statsRailValue}>+{fmtInt(model.opportunity30)}</span>
              </button>
            );
          })}
        </aside>

        <main className={styles.statsPanel}>
          {activeStatsPanel === "all" ? (
            <section className={styles.allStatsPanel} aria-label="Vue globale iNr’Stats">
              <div className={styles.allStatsHero}>
                <div className={styles.allStatsHeaderMain}>
                  <div className={styles.allStatsHeadingRow}>
                    <h2 className={styles.allStatsTitle}>Vue globale — Tous vos canaux en un coup d’œil</h2>
                    <button
                      type="button"
                      className={styles.allStatsReportButton}
                      onClick={() => {
                        void generateStatsReportNow();
                      }}
                      disabled={isGeneratingReport}
                      aria-label="Générer un bilan iNr’Stats manuel"
                      title="Créer et envoyer un bilan manuel maintenant"
                    >
                      {isGeneratingReport ? "Génération du bilan…" : "🧾 Générer un bilan"}
                    </button>
                  </div>
                  <p className={styles.allStatsText}>
                    Synthèse par canal : opportunités activables, CA potentiel et outil recommandé.
                  </p>
                </div>

                <div className={styles.allStatsKpis}>
                  <div className={`${styles.allStatsKpi} ${styles.kpiToneBlue}`}>
                    <span>Opportunités</span>
                    <b>+{fmtInt(centralPotential30)}</b>
                  </div>
                  <div className={`${styles.allStatsKpi} ${styles.kpiTonePurple}`}>
                    <span>CA potentiel</span>
                    <b>+{fmtInt(summaryActionItems.reduce((total, item) => total + safeNum(item.revenue), 0))} €</b>
                  </div>
                  <div className={`${styles.allStatsKpi} ${styles.kpiToneGreen}`}>
                    <span>Demandes captées 30 j</span>
                    <b>{fmtInt(totalCapturedLeads30)}</b>
                  </div>
                  <div className={`${styles.allStatsKpi} ${styles.kpiToneSlate}`}>
                    <span>Canaux</span>
                    <b>{models.length}</b>
                  </div>
                </div>
              </div>

              <div className={styles.allStatsActions}>
                {models.map((model) => {
                  const actionItem = summaryActionByChannel.get(model.key);
                  const revenue = summaryEstimatedByCube[model.key] || computedEstimatedByCube[model.key] || actionItem?.revenue || 0;
                  const actionHref = model.action?.href || "#";
                  const channelText = model.insights.find((text) => !text.toLowerCase().startsWith("recommandation")) || model.capturedLeadsHint || model.subtitle;
                  const actionText = actionItem?.kicker || model.action.title;
                  const isSite = model.key === "site_inrcy" || model.key === "site_web";
                    const connectionPending = (model.key === "mails" && !!model.connectionPending) || (model.key === "inr_search" && model.loading);
                  const connected = !connectionPending && (isSite ? !!model.connections.ga4 || !!model.connections.gsc : !!model.connections.main);

                  return (
                    <article
                      key={model.key}
                      className={`${styles.allStatsActionCard} ${connected ? styles.allStatsActionCardConnected : styles.allStatsActionCardOff}`}
                    >
                      <button
                        type="button"
                        className={styles.allStatsDetailArrow}
                        onClick={() => scrollTo(model.key)}
                        aria-label={`Voir le détail ${model.title}`}
                        title="Voir le détail"
                      >
                        ↗
                      </button>

                      <button type="button" className={styles.allStatsChannelButton} onClick={() => scrollTo(model.key)}>
                        <span className={styles.allStatsChannelName}>{model.title}</span>
                      </button>

                      <div className={styles.allStatsMetrics}>
                        <span>
                          <small>Opportunités</small>
                          <b>+{fmtInt(model.opportunity30)}</b>
                        </span>
                        <span>
                          <small>CA potentiel</small>
                          <b>+{fmtInt(revenue)} €</b>
                        </span>
                      </div>

                      <div className={styles.allStatsRecommendedAction}>
                        <span className={`${styles.allStatsToolBadge} ${connected ? "" : styles.allStatsToolBadgeConnect}`}>
                          {actionItem?.badge ?? model.action.pill}
                        </span>
                      </div>

                      <button
                        type="button"
                        className={`${styles.allStatsGoButton} ${connected ? styles.allStatsGoButtonOn : styles.allStatsGoButtonConnect}`}
                        onClick={() => actionHref && actionHref !== "#" ? navigateFromStats(actionHref) : scrollTo(model.key)}
                        disabled={false}
                        title={connected ? "Lancer l’action recommandée" : "Configurer ce canal"}
                      >
                        {connected ? "GO ⚡" : <>GO <PlugIcon /></>}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : activeModel ? (
            <section className={styles.channelStatsPanel} aria-label={`Données ${activeModel.title}`}>
              <div className={styles.channelStatsHeader}>
                <div className={styles.channelStatsTitleBlock}>
                  <div className={styles.allStatsEyebrow}>Canal actif</div>
                  <h2 className={styles.allStatsTitle}>{activeModel.title}</h2>
                  <p className={styles.allStatsText}>{activeModel.subtitle}</p>
                </div>

                <div className={`${styles.allStatsKpis} ${styles.channelStatsKpis} ${activeModel.key === "mails" ? styles.channelStatsKpisMail : ""}`}>
                  <div className={`${styles.allStatsKpi} ${styles.kpiToneBlue}`}>
                    <span>Opportunités</span>
                    <b>+{fmtInt(activeModel.opportunity30)}</b>
                  </div>
                  <div className={`${styles.allStatsKpi} ${styles.kpiTonePurple}`}>
                    <span>CA potentiel</span>
                    <b>+{fmtInt(summaryEstimatedByCube[activeModel.key] || computedEstimatedByCube[activeModel.key] || 0)} €</b>
                  </div>
                  {activeModel.key !== "mails" ? (
                    <div className={`${styles.allStatsKpi} ${styles.kpiToneGreen} ${styles.channelDemandesKpi}`}>
                      <span className={styles.channelDemandesKpiLabel}>Demandes captées 7j / 30j</span>
                      <b>{activeModel.capturedLeadsUnavailable ? "—" : `${fmtInt(activeModel.capturedLeads.week)} / ${fmtInt(activeModel.capturedLeads.month)}`}</b>
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
