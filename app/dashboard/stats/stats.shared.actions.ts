import { type DecisionResult } from "@/lib/decision/decisionEngine";
import { type ActionKey, type CapturedLeads, type CubeKey, type CubeModel, type Overview, type StatsTranslator } from "./stats.shared.types";
import { fmtInt, safeNum } from "./stats.shared.core";
import { computeOpportunity30, getGmbTotals, isIntentQuery, pageKind } from "./stats.shared.opportunity";
import { getSocialMetrics, isLinkedInStatsPartial } from "./stats.shared.quality";
import { hasTikTokStatsSignal, isTikTokStatsPermissionError, readMetricError } from "./stats.shared.metrics";

function decisionProvenanceLabel(cubeKey: CubeKey, index: number) {
  const labels: Partial<Record<CubeKey, string[]>> = {
    gmb: ["maps", "search"],
    facebook: ["audience", "interaction"],
    instagram: ["audience", "engagement"],
    linkedin: ["impressions", "click"],
    tiktok: ["audience", "engagement"],
    youtube_shorts: ["audience", "engagement"],
    pinterest: ["audience", "engagement"],
    site_inrcy: ["google", "direct", "social", "other"],
    site_web: ["google", "direct", "social", "other"],
  };
  return labels[cubeKey]?.[index] || "other";
}

export function getDecisionInput(
  cubeKey: Exclude<CubeKey, "mails" | "inrbadge" | "inr_search">,
  ov: Overview,
  qualityScore: number,
  opp30: number,
  provenance: Array<{ label: string; value: number; colorVar: string }>,
  capturedLeads: CapturedLeads,
) {

  if (cubeKey === "facebook" || cubeKey === "instagram" || cubeKey === "linkedin" || cubeKey === "tiktok" || cubeKey === "youtube_shorts" || cubeKey === "pinterest") {
    const metrics = getSocialMetrics(cubeKey, ov);
    const connected =
      cubeKey === "facebook"
        ? !!ov?.sources?.facebook?.connected
        : cubeKey === "instagram"
          ? !!ov?.sources?.instagram?.connected
          : cubeKey === "tiktok"
          ? !!ov?.sources?.tiktok?.connected
          : cubeKey === "youtube_shorts"
            ? !!ov?.sources?.youtube_shorts?.connected
            : cubeKey === "pinterest"
              ? !!ov?.sources?.pinterest?.connected
              : !!ov?.sources?.linkedin?.connected;

    return {
      channelType: "social" as const,
      channelKey: cubeKey,
      connected,
      opportunities: opp30,
      quality: qualityScore,
      capturedLeads,
      metrics: {
        audience: metrics.audience,
        engagement: metrics.engagement,
        conversions: metrics.conversions,
        visibility: metrics.visibility,
      },
      provenance: provenance.map((entry, index) => ({ label: decisionProvenanceLabel(cubeKey, index), value: entry.value })),
    };
  }

  if (cubeKey === "gmb") {
    const m = ov?.sources?.gmb?.metrics;
    const { impressions: visibility, websiteClicks, callClicks, directionRequests } = getGmbTotals(m);

    const conversions = websiteClicks + callClicks + directionRequests;

    return {
      channelType: "gmb" as const,
      channelKey: cubeKey,
      connected: !!ov?.sources?.gmb?.connected,
      opportunities: opp30,
      quality: qualityScore,
      capturedLeads,
      metrics: {
        traffic: conversions,
        conversions,
        visibility,
      },
      provenance: provenance.map((entry, index) => ({ label: decisionProvenanceLabel(cubeKey, index), value: entry.value })),
    };
  }


  const queries = Array.isArray(ov.topQueries) ? ov.topQueries : [];
  const topPages = Array.isArray(ov.topPages) ? ov.topPages : [];
  const intentClicks = queries.filter((q) => isIntentQuery(q.query)).reduce((s, q) => s + safeNum(q.clicks), 0);
  const contactViews = topPages.filter((p) => pageKind(p.path) === "contact").reduce((s, p) => s + safeNum(p.views), 0);
  const traffic = safeNum(ov?.totals?.sessions);
  const visibility = safeNum(ov?.totals?.impressions);
  const engagement = Math.round((safeNum(ov?.totals?.engagementRate) || 0) * 100);

  return {
    channelType: "website" as const,
    channelKey: cubeKey,
    connected: cubeKey === "site_inrcy"
      ? !!ov?.sources?.site_inrcy?.connected?.ga4 || !!ov?.sources?.site_inrcy?.connected?.gsc
      : !!ov?.sources?.site_web?.connected?.ga4 || !!ov?.sources?.site_web?.connected?.gsc,
    opportunities: opp30,
    quality: qualityScore,
    capturedLeads,
    metrics: {
      traffic,
      intent: intentClicks,
      conversions: contactViews,
      engagement,
      visibility,
    },
    provenance: provenance.map((entry, index) => ({ label: decisionProvenanceLabel(cubeKey, index), value: entry.value })),
  };
}


function boosterToolAction(detail: string, t: StatsTranslator): CubeModel["action"] {
  return {
    key: "booster_publier",
    title: t("booster_8e4caec0"),
    detail,
    href: "/dashboard?action=publish",
    pill: t("booster_8e4caec0"),
    effort: { level: "faible", label: t("effort_faible_5_min_e034d335") },
  };
}

function propulserToolAction(detail: string, t: StatsTranslator): CubeModel["action"] {
  return {
    key: "propulser_action",
    title: t("propulser_2de43942"),
    detail,
    href: "/dashboard/propulser",
    pill: t("propulser_2de43942"),
    effort: { level: "moyen", label: t("effort_moyen_10_15_min_33514efc") },
  };
}

function fideliserToolAction(detail: string, t: StatsTranslator): CubeModel["action"] {
  return {
    key: "fideliser_action",
    title: t("fideliser_8fa9e4f1"),
    detail,
    href: "/dashboard/fideliser",
    pill: t("fideliser_8fa9e4f1"),
    effort: { level: "moyen", label: t("effort_moyen_10_15_min_33514efc") },
  };
}

export function actionFromDecision(baseAction: CubeModel["action"], decision: DecisionResult, t: StatsTranslator): CubeModel["action"] {
  const localizedReason = t(`decision_reason_${decision.action}`);

  const map: Record<DecisionResult["action"], CubeModel["action"]> = {
    publier: boosterToolAction(localizedReason, t),
    offrir: propulserToolAction(localizedReason, t),
    recolter: propulserToolAction(localizedReason, t),
    informer: fideliserToolAction(localizedReason, t),
    suivre: fideliserToolAction(localizedReason, t),
    enqueter: fideliserToolAction(localizedReason, t),
  };

  return { ...baseAction, ...map[decision.action] };
}

export function recommendAction(cubeKey: CubeKey, ov: Overview, qualityScore: number, t: StatsTranslator): CubeModel["action"] {
  if (cubeKey === "site_inrcy") {
    const ownership = ov?.inrcySiteOwnership;
    const c = ov?.sources?.site_inrcy?.connected;

    if (ownership === "none") {
      return {
        key: "connect",
        title: t("configurer_382efbe9"),
        detail: t("action_no_inrcy_site"),
        href: "/dashboard?panel=site_inrcy",
        pill: t("connexion_a33c58f5"),
      };
    }

    if (!c?.ga4) {
      return {
        key: "connect",
        title: t("connecter_ga4_60ec761a"),
        detail: t("action_connect_ga4_detail"),
        href: "/dashboard?panel=site_inrcy",
        pill: t("connexion_a33c58f5"),
      };
    }
    if (!c?.gsc) {
      return {
        key: "connect",
        title: t("connecter_google_search_console_f3404063"),
        detail: t("action_connect_gsc_detail"),
        href: "/dashboard?panel=site_inrcy",
        pill: t("connexion_a33c58f5"),
      };
    }
  }

  if (cubeKey === "site_web") {
    const c = ov?.sources?.site_web?.connected;
    if (!c?.ga4) {
      return {
        key: "connect",
        title: t("connecter_ga4_60ec761a"),
        detail: t("action_connect_ga4_detail"),
        href: "/dashboard?panel=site_web",
        pill: t("connexion_a33c58f5"),
      };
    }
    if (!c?.gsc) {
      return {
        key: "connect",
        title: t("connecter_google_search_console_f3404063"),
        detail: t("action_connect_gsc_detail"),
        href: "/dashboard?panel=site_web",
        pill: t("connexion_a33c58f5"),
      };
    }
  }

  if (cubeKey === "gmb" && !ov?.sources?.gmb?.connected) {
    return {
      key: "connect",
      title: t("connecter_google_business_ca8b3513"),
      detail: t("action_connect_gmb_detail"),
      href: "/dashboard?panel=gmb",
      pill: t("connexion_a33c58f5"),
    };
  }

  if (cubeKey === "facebook" && !ov?.sources?.facebook?.connected) {
    return {
      key: "connect",
      title: t("connecter_facebook_380a5db4"),
      detail: t("action_connect_facebook_detail"),
      href: "/dashboard?panel=facebook",
      pill: t("connexion_a33c58f5"),
    };
  }

  if (cubeKey === "instagram" && !ov?.sources?.instagram?.connected) {
    return {
      key: "connect",
      title: t("connecter_instagram_ea138dc0"),
      detail: t("action_connect_instagram_detail"),
      href: "/dashboard?panel=instagram",
      pill: t("connexion_a33c58f5"),
    };
  }

  if (cubeKey === "linkedin" && !ov?.sources?.linkedin?.connected) {
    return {
      key: "connect",
      title: t("connecter_linkedin_dd6eba4d"),
      detail: t("action_connect_linkedin_detail"),
      href: "/dashboard?panel=linkedin",
      pill: t("connexion_a33c58f5"),
    };
  }

  if (cubeKey === "tiktok" && !ov?.sources?.tiktok?.connected) {
    return {
      key: "connect",
      title: t("connecter_tiktok_bce38f69"),
      detail: t("action_connect_tiktok_detail"),
      href: "/dashboard?panel=tiktok",
      pill: t("connexion_a33c58f5"),
    };
  }

  if (cubeKey === "tiktok" && isTikTokStatsPermissionError(ov?.sources?.tiktok?.metrics)) {
    return {
      key: "connect",
      title: t("reconnecter_tiktok_125091e5"),
      detail: t("action_reconnect_tiktok_detail"),
      href: "/dashboard?panel=tiktok",
      pill: t("connexion_a33c58f5"),
    };
  }

  if (cubeKey === "youtube_shorts" && !ov?.sources?.youtube_shorts?.connected) {
    return {
      key: "connect",
      title: t("configurer_youtube_b6b1b98d"),
      detail: t("action_connect_youtube_detail"),
      href: "/dashboard?panel=youtube_shorts",
      pill: t("connexion_a33c58f5"),
    };
  }

  if (cubeKey === "pinterest" && !ov?.sources?.pinterest?.connected) {
    return {
      key: "connect",
      title: t("connecter_pinterest_05788f6c"),
      detail: t("action_connect_pinterest_detail"),
      href: "/dashboard?panel=pinterest",
      pill: t("connexion_a33c58f5"),
    };
  }

  const effortMap: Partial<Record<ActionKey, CubeModel["action"]["effort"] | undefined>> = {
    booster_publier: { level: "faible", label: t("effort_faible_5_min_e034d335") },
    propulser_action: { level: "moyen", label: t("effort_moyen_10_15_min_33514efc") },
    fideliser_action: { level: "moyen", label: t("effort_moyen_10_15_min_33514efc") },
    booster_avis: { level: "moyen", label: t("effort_moyen_10_min_beff4f02") },
    booster_promotion: { level: "moyen", label: t("effort_moyen_15_min_121017e1") },
    fideliser_informer: { level: "moyen", label: t("effort_moyen_15_min_121017e1") },
    fideliser_satisfaction: { level: "faible", label: t("effort_faible_3_min_25abc8a8") },
    fideliser_remercier: { level: "faible", label: t("effort_faible_2_min_57b40ff4") },
    connect: undefined,
    loading: undefined,
  };

  const attachEffort = (a: CubeModel["action"]): CubeModel["action"] => {
    if (a.key === "connect") return a;
    return { ...a, effort: effortMap[a.key] };
  };

  const opp30 = computeOpportunity30(cubeKey, ov);

  if (cubeKey === "site_inrcy") {
    if (qualityScore >= 70) {
      return fideliserToolAction(t("action_nurture_satisfied_clients"), t);
    }
    return propulserToolAction(t("action_highlight_offer_or_proof"), t);
  }

  if (cubeKey === "site_web") {
    if (qualityScore < 60) {
      return propulserToolAction(t("action_strengthen_commercial_trigger"), t);
    }
    if (qualityScore >= 75 && opp30 > 4) {
      return fideliserToolAction(t("action_build_regular_contact"), t);
    }
    return boosterToolAction(t("action_publish_local_news"), t);
  }

  if (cubeKey === "mails") {
    if (!ov?.sources?.mails?.connected) {
      return {
        key: "connect",
        title: t("configurer_382efbe9"),
        detail: t("connectez_au_moins_une_boite_d_817ecdef"),
        href: "/dashboard?panel=mails",
        pill: t("connexion_a33c58f5"),
      };
    }
    return fideliserToolAction(t("action_communicate_by_mail"), t);
  }

  if (cubeKey === "gmb") {
    const m = ov?.sources?.gmb?.metrics;
    const hasError = !!m?.error;
    if (hasError) {
      return boosterToolAction(t("action_publish_gmb_post"), t);
    }
    return propulserToolAction(t("action_launch_gmb_propulser"), t);
  }

  const socialLabel = cubeKey === "linkedin"
    ? t("audience_professional")
    : cubeKey === "pinterest"
      ? t("audience_inspiration")
      : (cubeKey === "tiktok" || cubeKey === "youtube_shorts")
        ? t("audience_video")
        : t("audience_general");
  return boosterToolAction(t("action_weekly_social_post", { audience: socialLabel }), t);
}

export function buildInsights(cubeKey: CubeKey, ov: Overview, qualityScore: number, decision: DecisionResult | undefined, locale: string, t: StatsTranslator) {
  const insights: string[] = [];

  if (cubeKey === "linkedin" && isLinkedInStatsPartial(ov)) {
    return [
      t("insight_linkedin_unavailable"),
      t("insight_retry_tomorrow"),
      t("insight_keep_linkedin_visible"),
    ];
  }

  if (cubeKey === "tiktok") {
    const connected = Boolean(ov?.sources?.tiktok?.connected);
    const metrics = ov?.sources?.tiktok?.metrics;
    const metricError = readMetricError(metrics);
    if (!connected) {
      return [t("insight_tiktok_disconnected"), t("insight_connect_tiktok_to_publish")];
    }
    if (isTikTokStatsPermissionError(metrics)) {
      return [
        t("insight_tiktok_permissions_incomplete"),
        t("insight_reconnect_tiktok_from_channels"),
        t("insight_tiktok_publish_still_available"),
      ];
    }
    if (metricError) {
      return [
        t("insight_tiktok_connected"),
        t("insight_tiktok_stats_temporarily_unavailable"),
        t("insight_refresh_after_publications"),
      ];
    }
    if (!hasTikTokStatsSignal(metrics)) {
      return [
        t("insight_tiktok_connected"),
        t("insight_tiktok_waiting_for_data"),
        t("insight_publish_to_activate_tracking"),
      ];
    }
  }

  if (decision) {
    const tool = decision.action === "publier"
      ? "Booster"
      : decision.action === "offrir" || decision.action === "recolter"
        ? "Propulser"
        : "Fidéliser";
    const toolLine = tool === "Booster"
      ? t("insight_recommend_booster")
      : tool === "Propulser"
        ? t("insight_recommend_propulser")
        : t("insight_recommend_fideliser");
    return [toolLine, t(`decision_reason_${decision.action}`)].filter(Boolean).slice(0, 3);
  }

  if (cubeKey === "mails") {
    if (!ov?.sources?.mails?.connected) {
      return [t("insight_mail_disconnected"), t("connectez_au_moins_une_boite_d_817ecdef")];
    }
    const m = ov?.sources?.mails?.metrics;
    return [
      t("insight_connected_mailboxes", { count: fmtInt(safeNum(m?.connectedCount), locale) }),
      t("insight_usable_crm_contacts", { count: fmtInt(safeNum(m?.contactsCrm), locale) }),
      safeNum(m?.campagnes30) > 0 ? t("insight_campaigns_visible") : t("insight_launch_first_campaign"),
    ];
  }

  if (cubeKey === "facebook") {
    if (!ov?.sources?.facebook?.connected) {
      return [t("insight_channel_disconnected"), t("insight_connect_facebook")];
    }
    return [t("insight_social_ready"), t("insight_prioritize_consistency")];
  }

  if (cubeKey === "tiktok") {
    if (!ov?.sources?.tiktok?.connected) {
      return [t("insight_channel_disconnected"), t("insight_connect_tiktok_prepare")];
    }
    return [t("insight_tiktok_measurable"), t("insight_publish_short_content")];
  }

  if (cubeKey === "youtube_shorts") {
    if (!ov?.sources?.youtube_shorts?.connected) {
      return [t("insight_youtube_disconnected"), t("insight_configure_youtube")];
    }
    return [t("insight_youtube_connected"), t("insight_publish_youtube_regularly")];
  }

  if (cubeKey === "gmb") {
    if (!ov?.sources?.gmb?.connected) {
      return [t("insight_local_channel_disconnected"), t("insight_gmb_local_calls")];
    }
    if (ov?.sources?.gmb?.metrics?.error) {
      return [t("insight_metrics_unavailable"), t("insight_posts_and_reviews")];
    }
    return [t("insight_local_presence_active"), t("insight_reviews_and_posts")];
  }

  const totals = ov.totals || ({} as any);
  const sessions = safeNum(totals.sessions);
  const queries = Array.isArray(ov.topQueries) ? ov.topQueries : [];
  const intentClicks = queries.filter((q) => isIntentQuery(q.query)).reduce((s, q) => s + safeNum(q.clicks), 0);
  const anyIntent = intentClicks > 0;

  if (sessions <= 20) insights.push(t("insight_low_traffic"));
  else insights.push(t("insight_traffic_present"));

  if (anyIntent) insights.push(t("insight_business_intent_found"));
  else insights.push(t("insight_low_business_intent"));

  if (qualityScore >= 75) insights.push(t("insight_strong_structure"));
  else if (qualityScore >= 55) insights.push(t("insight_correct_structure"));
  else insights.push(t("insight_structure_to_improve"));

  return insights.slice(0, 3);
}
