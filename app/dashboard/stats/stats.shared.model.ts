import { decideAction, type DecisionResult } from "@/lib/decision/decisionEngine";
import { type CapturedLeads, type CubeKey, type CubeModel, type CubeState, type Overview, type Period, type StatsTranslator } from "./stats.shared.types";
import { safeNum } from "./stats.shared.core";
import { computeOpportunity30 } from "./stats.shared.opportunity";
import { buildProvenance, computeQuality, isLinkedInStatsPartial } from "./stats.shared.quality";
import { buildActionStats, buildInrcyActivityStats, buildVisibilityStats, hasTikTokStatsSignal, isTikTokStatsPermissionError, readMetricError } from "./stats.shared.metrics";
import { actionFromDecision, buildInsights, getDecisionInput, recommendAction } from "./stats.shared.actions";
import type { StatsRecommendedTool } from "./stats.edition-policy";

export function buildCubeModel(
  key: Exclude<CubeKey, "mails" | "inrbadge" | "inr_search">,
  title: string,
  subtitle: string,
  period: Period,
  state: CubeState | undefined | null,
  summaryOppByCube: Record<CubeKey, number>,
  officialConnectionStatus?: "connected" | "needs_update" | "disconnected" | "unavailable",
  locale = "fr-FR",
  t?: StatsTranslator,
): CubeModel {
  if (!t) throw new Error("buildCubeModel requires a stats translator");
  const safeState: CubeState = state && typeof state === "object"
    ? state
    : { ov: null, loading: false, error: undefined, capturedLeads: { week: 0, month: 0 } };
  const stateConnectionStatus = officialConnectionStatus || safeState.connectionStatus;
  const officialStatsActive = !stateConnectionStatus || stateConnectionStatus === "connected";
  const hasRealOverview = officialStatsActive && !!safeState.ov;
  const ov = (officialStatsActive ? safeState.ov : null) ||
    ({
      days: period,
      totals: { users: 0, sessions: 0, pageviews: 0, engagementRate: 0, avgSessionDuration: 0, clicks: 0, impressions: 0, ctr: 0 },
      topPages: [],
      channels: [],
      topQueries: [],
      sources: {
        site_inrcy: { connected: { ga4: false, gsc: false } },
        site_web: { connected: { ga4: false, gsc: false } },
        gmb: { connected: false, metrics: null },
        facebook: { connected: false },
        instagram: { connected: false },
        linkedin: { connected: false },
        tiktok: { connected: false },
        youtube_shorts: { connected: false },
        pinterest: { connected: false },
        mails: { connected: false },
      },
    } as Overview);

  const accountLabel = String(ov?.identities?.[key]?.label || ov?.identities?.[key]?.url || "").trim();
  const inrcyOwnership = (ov as any)?.inrcySiteOwnership;
  const inrcyDisconnected = inrcyOwnership === "none";

  const connections =
    key === "site_inrcy"
      ? inrcyDisconnected
        ? { ga4: false, gsc: false }
        : { ga4: !!ov.sources?.site_inrcy?.connected?.ga4, gsc: !!ov.sources?.site_inrcy?.connected?.gsc }
      : key === "site_web"
        ? { ga4: !!ov.sources?.site_web?.connected?.ga4, gsc: !!ov.sources?.site_web?.connected?.gsc }
        : key === "gmb"
          ? { main: !!ov.sources?.gmb?.connected }
          : key === "facebook"
            ? { main: !!ov.sources?.facebook?.connected }
            : key === "instagram"
              ? { main: !!ov.sources?.instagram?.connected }
              : key === "tiktok"
                  ? { main: !!ov.sources?.tiktok?.connected }
                  : key === "youtube_shorts"
                    ? { main: !!ov.sources?.youtube_shorts?.connected }
                    : key === "pinterest"
                      ? { main: !!ov.sources?.pinterest?.connected }
                      : { main: !!ov.sources?.linkedin?.connected };

  const provenance = buildProvenance(key, ov, t);
  const computedOpp30 = computeOpportunity30(key, ov);
  const linkedInPartial = key === "linkedin" && isLinkedInStatsPartial(ov);
  const summaryOpp30 = summaryOppByCube[key];
  const computedOpportunity = linkedInPartial && computedOpp30 > safeNum(summaryOpp30)
    ? computedOpp30
    : summaryOpp30 ?? computedOpp30;
  const opp30 = officialStatsActive ? computedOpportunity : 0;

  const q = computeQuality(key, ov, t);
  const capturedLeads: CapturedLeads = {
    week: officialStatsActive ? Math.max(0, Math.round(safeNum(safeState.capturedLeads?.week))) : 0,
    month: officialStatsActive ? Math.max(0, Math.round(safeNum(safeState.capturedLeads?.month))) : 0,
  };
  let action = recommendAction(key, ov, q.score, t);
  let decision: DecisionResult | undefined;

  if (action.key !== "connect" && action.key !== "loading") {
    decision = decideAction(getDecisionInput(key, ov, q.score, opp30, provenance, capturedLeads));
    action = actionFromDecision(action, decision, t);
  }

  if (linkedInPartial && action.key !== "connect" && action.key !== "loading") {
    action = {
      ...action,
      key: "booster_publier",
      title: t("booster_8e4caec0"),
      detail: t("stats_linkedin_publish_and_retry"),
      href: "/dashboard?action=publish",
      pill: t("booster_8e4caec0"),
    };
  }

  const insights = buildInsights(key, ov, q.score, decision, locale, t);

  if (safeState.loading && !hasRealOverview) {
    action = {
      key: "loading",
      title: t("connexion_807c2021"),
      detail: t("stats_fetching_connections"),
      href: "",
      pill: t("connexion_a33c58f5"),
    };
  }

  const inferredConnected = key === "site_inrcy" || key === "site_web"
    ? Boolean(connections.ga4 || connections.gsc)
    : Boolean(connections.main);
  const connectionStatus = stateConnectionStatus || (inferredConnected ? "connected" : "disconnected");

  if (connectionStatus === "needs_update") {
    action = {
      key: "connect",
      title: t("reconnecter_value_d8079aa6", { value0: title }),
      detail: t("stats_reconnect_expired_channel"),
      href: "/dashboard",
      pill: t("connexion_a33c58f5"),
    };
  }

  if (connectionStatus === "unavailable") {
    action = {
      key: "loading",
      title: t("synchronisation_indisponible_8d911564"),
      detail: t("stats_channel_verification_unavailable"),
      href: "",
      pill: t("connexion_a33c58f5"),
    };
  }

  const opportunityLabel =
    opp30 >= 14
      ? t("opportunity_high")
      : opp30 >= 7
        ? t("opportunity_real")
        : opp30 >= 3
          ? t("opportunity_moderate")
          : t("a_activer_15406658");

  return {
    key,
    inrcyOwnership: key === "site_inrcy" ? (inrcyOwnership as any) : undefined,
    title,
    subtitle,
    accountLabel: accountLabel || undefined,
    period,
    loading: !!safeState.loading,
    error: safeState.error,
    connectionStatus,
    connections,
    provenance,
    opportunity30: opp30,
    opportunityLabel,
    capturedLeads,
    capturedLeadsUnavailable: linkedInPartial,
    capturedLeadsHint: linkedInPartial
      ? t("stats_linkedin_retry_tomorrow")
      : t("stats_measured_requests_hint"),
    provenanceHint:
      key === "linkedin" && (linkedInPartial || provenance.every((entry) => safeNum(entry.value) <= 0))
        ? t("stats_data_unavailable")
        : key === "tiktok" && ov?.sources?.tiktok?.connected && isTikTokStatsPermissionError(ov?.sources?.tiktok?.metrics)
          ? t("stats_tiktok_permissions_hint")
          : key === "tiktok" && ov?.sources?.tiktok?.connected && readMetricError(ov?.sources?.tiktok?.metrics)
            ? t("stats_tiktok_temporarily_unavailable")
            : key === "tiktok" && ov?.sources?.tiktok?.connected && !hasTikTokStatsSignal(ov?.sources?.tiktok?.metrics)
              ? t("stats_tiktok_waiting_for_data")
              : key === "gmb" && provenance.length === 1 && provenance[0]?.label === t("visibilite_locale_afa9cdc9")
                ? t("stats_gmb_distribution_unavailable")
                : undefined,
    visibilityStats: buildVisibilityStats(key, ov, locale, t),
    actionStats: buildActionStats(key, ov, locale, t),
    inrcyActivityStats: buildInrcyActivityStats(key, ov),
    qualityScore: q.score,
    qualityLabel: q.label,
    qualityTone: q.tone,
    insights,
    action,
  };
}

export function buildSummaryActionItems({
  centralByCube,
  computedEstimatedByCube,
  models,
  summaryEstimatedByCube,
  t,
}: {
  centralByCube: Record<CubeKey, number>;
  computedEstimatedByCube: Record<CubeKey, number>;
  models: CubeModel[];
  summaryEstimatedByCube: Record<CubeKey, number>;
  t: StatsTranslator;
}) {
  const connectionStateByCube: Record<CubeKey, boolean> = {
    inrbadge: !!models.find((m) => m.key === "inrbadge")?.connections.main,
    inr_search: !!models.find((m) => m.key === "inr_search")?.connections.main,
    site_inrcy: !!models.find((m) => m.key === "site_inrcy")?.connections.ga4 || !!models.find((m) => m.key === "site_inrcy")?.connections.gsc,
    site_web: !!models.find((m) => m.key === "site_web")?.connections.ga4 || !!models.find((m) => m.key === "site_web")?.connections.gsc,
    gmb: !!models.find((m) => m.key === "gmb")?.connections.main,
    facebook: !!models.find((m) => m.key === "facebook")?.connections.main,
    instagram: !!models.find((m) => m.key === "instagram")?.connections.main,
    linkedin: !!models.find((m) => m.key === "linkedin")?.connections.main,
    mails: !!models.find((m) => m.key === "mails")?.connections.main,
    tiktok: !!models.find((m) => m.key === "tiktok")?.connections.main,
    youtube_shorts: !!models.find((m) => m.key === "youtube_shorts")?.connections.main,
    pinterest: !!models.find((m) => m.key === "pinterest")?.connections.main,
  };

  // La destination est rattachee a l'outil affiche dans la bulle. Elle ne
  // depend jamais d'une autre recommandation interne au detail du canal.
  const connectedRecommendedToolByCube: Record<CubeKey, StatsRecommendedTool> = {
    inrbadge: "booster",
    inr_search: "propulser",
    site_inrcy: "propulser",
    site_web: "propulser",
    gmb: "propulser",
    facebook: "booster",
    instagram: "booster",
    linkedin: "booster",
    mails: "fideliser",
    tiktok: "booster",
    youtube_shorts: "booster",
    pinterest: "booster",
  };
  const connectedActionHrefByCube: Record<CubeKey, string> = {
    inrbadge: "/dashboard?panel=inrbadge",
    inr_search: "/dashboard/propulser",
    site_inrcy: "/dashboard/propulser",
    site_web: "/dashboard/propulser",
    gmb: "/dashboard/propulser",
    facebook: "/dashboard?action=publish",
    instagram: "/dashboard?action=publish",
    linkedin: "/dashboard?action=publish",
    mails: "/dashboard/fideliser",
    tiktok: "/dashboard?action=publish",
    youtube_shorts: "/dashboard?action=publish",
    pinterest: "/dashboard?action=publish",
  };

  const connectedCopy: Record<CubeKey, { label: string; kicker: string; motive: string; badge: string }> = {
    inrbadge: {
      label: t("partager_le_badge_09b4365a"),
      kicker: t("votre_hub_de_conversion_e9c599b2"),
      motive: t("inr_badge_centralise_vos_canaux_et_965919b6"),
      badge: t("booster_8e4caec0"),
    },
    inr_search: {
      label: t("voir_la_page_82561348"),
      kicker: t("votre_vitrine_publique_inr_search_e67d5120"),
      motive: t("inrcy_cree_enrichit_et_reference_automatiquement_1a66bb86"),
      badge: t("propulser_2de43942"),
    },
    facebook: {
      label: t("utiliser_booster_6138c57d"),
      kicker: t("relancez_votre_visibilite_locale_b7d7ba45"),
      motive: t("booster_permet_de_publier_rapidement_pour_c5c61333"),
      badge: t("booster_8e4caec0"),
    },
    instagram: {
      label: t("utiliser_booster_6138c57d"),
      kicker: t("reactivez_votre_visibilite_de_marque_ce217439"),
      motive: t("booster_vous_aide_a_publier_regulierement_1c1c3d92"),
      badge: t("booster_8e4caec0"),
    },
    linkedin: {
      label: t("utiliser_booster_6138c57d"),
      kicker: t("renforcez_votre_credibilite_pro_a7ed6a65"),
      motive: t("booster_vous_aide_a_prendre_la_12591d89"),
      badge: t("booster_8e4caec0"),
    },
    mails: {
      label: t("utiliser_fideliser_af919842"),
      kicker: t("animez_votre_base_par_mail_6284af7b"),
      motive: t("mails_analyse_vos_usages_fideliser_propulser_37166dba"),
      badge: t("fideliser_8fa9e4f1"),
    },
    tiktok: {
      label: t("utiliser_booster_6138c57d"),
      kicker: t("activez_vos_contenus_courts_0b4dcab9"),
      motive: t("booster_vous_aide_a_publier_photos_249f5de3"),
      badge: t("booster_8e4caec0"),
    },
    youtube_shorts: {
      label: t("utiliser_booster_6138c57d"),
      kicker: t("activez_vos_videos_youtube_3bccbcbf"),
      motive: t("youtube_transforme_vos_videos_courtes_ou_cbe7ae01"),
      badge: t("booster_8e4caec0"),
    },
    pinterest: {
      label: t("utiliser_booster_6138c57d"),
      kicker: t("activez_votre_visibilite_inspiration_714ee6e6"),
      motive: t("booster_vous_aide_a_publier_des_bc2a2aa0"),
      badge: t("booster_8e4caec0"),
    },
    site_web: {
      label: t("utiliser_propulser_c4b4b56d"),
      kicker: t("transformez_plus_de_visiteurs_en_prospects_1a133cbd"),
      motive: t("propulser_vous_propose_une_action_business_392120f0"),
      badge: t("propulser_2de43942"),
    },
    site_inrcy: {
      label: t("utiliser_propulser_c4b4b56d"),
      kicker: t("accelerez_une_machine_deja_lancee_3a42543d"),
      motive: t("propulser_aide_a_transformer_le_potentiel_1256c707"),
      badge: t("propulser_2de43942"),
    },
    gmb: {
      label: t("utiliser_propulser_c4b4b56d"),
      kicker: t("debloquez_un_potentiel_local_immediat_643b2334"),
      motive: t("propulser_permet_de_valoriser_vos_preuves_b071e504"),
      badge: t("propulser_2de43942"),
    },
  };

  const disconnectedCopy: Record<CubeKey, { label: string; kicker: string; motive: string; badge: string }> = {
    inrbadge: {
      label: t("configurer_inr_badge_a14c8098"),
      kicker: t("activez_votre_fiche_publique_d68b6aa3"),
      motive: t("completez_inr_badge_pour_centraliser_vos_756c9d97"),
      badge: t("connexion_a33c58f5"),
    },
    inr_search: {
      label: t("page_en_preparation_4f41e9fc"),
      kicker: t("creation_automatique_par_inrcy_1377c3f6"),
      motive: t("la_page_sera_publiee_automatiquement_des_b97895f5"),
      badge: t("connexion_a33c58f5"),
    },
    facebook: {
      label: t("connecter_facebook_380a5db4"),
      kicker: t("activez_un_levier_social_local_ed260a0f"),
      motive: t("reliez_facebook_pour_mesurer_votre_visibilite_a27abe63"),
      badge: t("connexion_a33c58f5"),
    },
    instagram: {
      label: t("connecter_instagram_ea138dc0"),
      kicker: t("activez_votre_vitrine_de_marque_03db73d4"),
      motive: t("reliez_instagram_pour_exploiter_votre_visibilite_3de41cc3"),
      badge: t("connexion_a33c58f5"),
    },
    linkedin: {
      label: t("connecter_linkedin_dd6eba4d"),
      kicker: t("activez_votre_credibilite_professionnelle_19ce03e5"),
      motive: t("reliez_linkedin_pour_publier_facilement_et_8c294ad0"),
      badge: t("connexion_a33c58f5"),
    },
    mails: {
      label: t("connecter_une_boite_mail_f120289b"),
      kicker: t("activez_vos_campagnes_8670f54d"),
      motive: t("connectez_au_moins_une_boite_d_817ecdef"),
      badge: t("connexion_a33c58f5"),
    },
    tiktok: {
      label: t("connecter_tiktok_bce38f69"),
      kicker: t("preparez_le_canal_video_photo_d6ca6835"),
      motive: t("reliez_tiktok_pour_publier_photos_et_5f0d0a6a"),
      badge: t("connexion_a33c58f5"),
    },
    youtube_shorts: {
      label: t("configurer_youtube_b6b1b98d"),
      kicker: t("preparez_le_canal_video_643a3928"),
      motive: t("ajoutez_votre_chaine_youtube_pour_publier_b801467f"),
      badge: t("connexion_a33c58f5"),
    },
    pinterest: {
      label: t("connecter_pinterest_05788f6c"),
      kicker: t("activez_le_canal_inspiration_0f332bb9"),
      motive: t("reliez_pinterest_pour_publier_vos_visuels_72bc836e"),
      badge: t("connexion_a33c58f5"),
    },
    site_web: {
      label: t("connecter_votre_site_79fb2889"),
      kicker: t("mesurez_enfin_votre_rendement_web_7a73b8a5"),
      motive: t("connectez_ga4_et_gsc_pour_analyser_6125e506"),
      badge: t("connexion_a33c58f5"),
    },
    site_inrcy: {
      label: t("connecter_le_site_inrcy_33bf6baf"),
      kicker: t("branchez_votre_machine_a_leads_a9d5a607"),
      motive: t("activez_les_outils_de_mesure_du_59caaea2"),
      badge: t("connexion_a33c58f5"),
    },
    gmb: {
      label: t("connecter_google_business_ca8b3513"),
      kicker: t("debloquez_un_potentiel_local_immediat_643b2334"),
      motive: t("vous_laissez_probablement_passer_des_demandes_6a660812"),
      badge: t("connexion_a33c58f5"),
    },
  };

  return [
    { key: "inrbadge" as CubeKey, opportunities: centralByCube.inrbadge, revenue: computedEstimatedByCube.inrbadge || summaryEstimatedByCube.inrbadge },
    { key: "inr_search" as CubeKey, opportunities: centralByCube.inr_search, revenue: computedEstimatedByCube.inr_search || summaryEstimatedByCube.inr_search },
    { key: "site_inrcy" as CubeKey, opportunities: centralByCube.site_inrcy, revenue: computedEstimatedByCube.site_inrcy || summaryEstimatedByCube.site_inrcy },
    { key: "site_web" as CubeKey, opportunities: centralByCube.site_web, revenue: computedEstimatedByCube.site_web || summaryEstimatedByCube.site_web },
    { key: "gmb" as CubeKey, opportunities: centralByCube.gmb, revenue: computedEstimatedByCube.gmb || summaryEstimatedByCube.gmb },
    { key: "facebook" as CubeKey, opportunities: centralByCube.facebook, revenue: computedEstimatedByCube.facebook || summaryEstimatedByCube.facebook },
    { key: "instagram" as CubeKey, opportunities: centralByCube.instagram, revenue: computedEstimatedByCube.instagram || summaryEstimatedByCube.instagram },
    { key: "linkedin" as CubeKey, opportunities: centralByCube.linkedin, revenue: computedEstimatedByCube.linkedin || summaryEstimatedByCube.linkedin },
    { key: "mails" as CubeKey, opportunities: centralByCube.mails, revenue: computedEstimatedByCube.mails || summaryEstimatedByCube.mails },
    { key: "tiktok" as CubeKey, opportunities: centralByCube.tiktok, revenue: computedEstimatedByCube.tiktok || summaryEstimatedByCube.tiktok },
    { key: "youtube_shorts" as CubeKey, opportunities: centralByCube.youtube_shorts, revenue: computedEstimatedByCube.youtube_shorts || summaryEstimatedByCube.youtube_shorts },
    { key: "pinterest" as CubeKey, opportunities: centralByCube.pinterest, revenue: computedEstimatedByCube.pinterest || summaryEstimatedByCube.pinterest },
  ].map((item) => {
    const connected = connectionStateByCube[item.key];
    const model = models.find((candidate) => candidate.key === item.key);

    return {
      ...item,
      ...(connected ? connectedCopy[item.key] : disconnectedCopy[item.key]),
      connected,
      recommendedTool: connected
        ? connectedRecommendedToolByCube[item.key]
        : "connection" as const,
      actionHref: connected
        ? connectedActionHrefByCube[item.key]
        : model?.action.href || "/dashboard",
    };
  });
}
