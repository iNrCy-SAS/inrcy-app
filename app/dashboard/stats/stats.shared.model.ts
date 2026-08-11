import { decideAction, type DecisionResult } from "@/lib/decision/decisionEngine";
import { type CapturedLeads, type CubeKey, type CubeModel, type CubeState, type Overview, type Period } from "./stats.shared.types";
import { safeNum } from "./stats.shared.core";
import { computeOpportunity30 } from "./stats.shared.opportunity";
import { buildProvenance, computeQuality, isLinkedInStatsPartial } from "./stats.shared.quality";
import { buildActionStats, buildInrcyActivityStats, buildVisibilityStats, hasTikTokStatsSignal, isTikTokStatsPermissionError, readMetricError } from "./stats.shared.metrics";
import { actionFromDecision, buildInsights, getDecisionInput, recommendAction } from "./stats.shared.actions";

export function buildCubeModel(
  key: Exclude<CubeKey, "mails" | "inrbadge" | "inr_search">,
  title: string,
  subtitle: string,
  period: Period,
  state: CubeState | undefined | null,
  summaryOppByCube: Record<CubeKey, number>,
  officialConnectionStatus?: "connected" | "needs_update" | "disconnected" | "unavailable",
): CubeModel {
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

  const provenance = buildProvenance(key, ov);
  const computedOpp30 = computeOpportunity30(key, ov);
  const linkedInPartial = key === "linkedin" && isLinkedInStatsPartial(ov);
  const summaryOpp30 = summaryOppByCube[key];
  const computedOpportunity = linkedInPartial && computedOpp30 > safeNum(summaryOpp30)
    ? computedOpp30
    : summaryOpp30 ?? computedOpp30;
  const opp30 = officialStatsActive ? computedOpportunity : 0;

  const q = computeQuality(key, ov);
  const capturedLeads: CapturedLeads = {
    week: officialStatsActive ? Math.max(0, Math.round(safeNum(safeState.capturedLeads?.week))) : 0,
    month: officialStatsActive ? Math.max(0, Math.round(safeNum(safeState.capturedLeads?.month))) : 0,
  };
  let action = recommendAction(key, ov, q.score);
  let decision: DecisionResult | undefined;

  if (action.key !== "connect" && action.key !== "loading") {
    decision = decideAction(getDecisionInput(key, ov, q.score, opp30, provenance, capturedLeads));
    action = actionFromDecision(action, decision);
  }

  if (linkedInPartial && action.key !== "connect" && action.key !== "loading") {
    action = {
      ...action,
      key: "booster_publier",
      title: "Booster",
      detail: "Données LinkedIn non exploitables actuellement. Publiez depuis Booster puis réessayez demain.",
      href: "/dashboard?action=publish",
      pill: "Booster",
    };
  }

  const insights = buildInsights(key, ov, q.score, decision);

  if (safeState.loading && !hasRealOverview) {
    action = {
      key: "loading",
      title: "Connexion…",
      detail: "Récupération de vos connexions",
      href: "",
      pill: "Connexion",
    };
  }

  const inferredConnected = key === "site_inrcy" || key === "site_web"
    ? Boolean(connections.ga4 || connections.gsc)
    : Boolean(connections.main);
  const connectionStatus = stateConnectionStatus || (inferredConnected ? "connected" : "disconnected");

  if (connectionStatus === "needs_update") {
    action = {
      key: "connect",
      title: `Reconnecter ${title}`,
      detail: "La connexion a expiré. Reconnectez ce canal pour réactiver les statistiques et Booster.",
      href: "/dashboard",
      pill: "Connexion",
    };
  }

  if (connectionStatus === "unavailable") {
    action = {
      key: "loading",
      title: "Synchronisation indisponible",
      detail: "L'état du canal n'a pas pu être vérifié. Aucune ancienne donnée n'est utilisée comme autorisation.",
      href: "",
      pill: "Connexion",
    };
  }

  const opportunityLabel =
    opp30 >= 14 ? "Fort potentiel" : opp30 >= 7 ? "Potentiel réel" : opp30 >= 3 ? "Potentiel modéré" : "À activer";

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
      ? "Données LinkedIn non exploitables actuellement. Réessayez demain."
      : "Demandes réelles mesurées sur ce canal.",
    provenanceHint:
      key === "linkedin" && (linkedInPartial || provenance.every((entry) => safeNum(entry.value) <= 0))
        ? "Données non exploitables actuellement."
        : key === "tiktok" && ov?.sources?.tiktok?.connected && isTikTokStatsPermissionError(ov?.sources?.tiktok?.metrics)
          ? "Autorisations statistiques TikTok incomplètes : reconnectez le canal."
          : key === "tiktok" && ov?.sources?.tiktok?.connected && readMetricError(ov?.sources?.tiktok?.metrics)
            ? "Statistiques TikTok momentanément indisponibles."
            : key === "tiktok" && ov?.sources?.tiktok?.connected && !hasTikTokStatsSignal(ov?.sources?.tiktok?.metrics)
              ? "Compte connecté : données en attente de remontée par TikTok."
              : key === "gmb" && provenance.length === 1 && provenance[0]?.label === "Visibilité locale"
                ? "La répartition Maps / Search n’est pas remontée par Google sur cette période."
                : undefined,
    visibilityStats: buildVisibilityStats(key, ov),
    actionStats: buildActionStats(key, ov),
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
}: {
  centralByCube: Record<CubeKey, number>;
  computedEstimatedByCube: Record<CubeKey, number>;
  models: CubeModel[];
  summaryEstimatedByCube: Record<CubeKey, number>;
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

  const connectedCopy: Record<CubeKey, { label: string; kicker: string; motive: string; badge: string }> = {
    inrbadge: {
      label: "Partager le badge",
      kicker: "Votre hub de conversion",
      motive: "iNr’Badge centralise vos canaux et transforme vos visiteurs en actions utiles.",
      badge: "Booster",
    },
    inr_search: {
      label: "Voir la page",
      kicker: "Votre vitrine publique iNr’Search",
      motive: "iNrCy crée, enrichit et référence automatiquement cette page pour générer de la visibilité et des contacts.",
      badge: "Propulser",
    },
    facebook: {
      label: "Utiliser Booster",
      kicker: "Relancez votre visibilité locale",
      motive: "Booster permet de publier rapidement pour remettre votre activité en mouvement.",
      badge: "Booster",
    },
    instagram: {
      label: "Utiliser Booster",
      kicker: "Réactivez votre visibilité de marque",
      motive: "Booster vous aide à publier régulièrement pour transformer l’attention en contacts.",
      badge: "Booster",
    },
    linkedin: {
      label: "Utiliser Booster",
      kicker: "Renforcez votre crédibilité pro",
      motive: "Booster vous aide à prendre la parole simplement sur LinkedIn.",
      badge: "Booster",
    },
    mails: {
      label: "Utiliser Fidéliser",
      kicker: "Animez votre base par mail",
      motive: "Mails analyse vos usages Fidéliser, Propulser et mails simples pour transformer votre CRM en actions concrètes.",
      badge: "Fidéliser",
    },
    tiktok: {
      label: "Utiliser Booster",
      kicker: "Activez vos contenus courts",
      motive: "Booster vous aide à publier photos et vidéos TikTok depuis le même flux.",
      badge: "Booster",
    },
    youtube_shorts: {
      label: "Utiliser Booster",
      kicker: "Activez vos vidéos YouTube",
      motive: "YouTube transforme vos vidéos courtes ou longues en visibilité durable depuis le même flux iNrCy.",
      badge: "Booster",
    },
    pinterest: {
      label: "Utiliser Booster",
      kicker: "Activez votre visibilité inspiration",
      motive: "Booster vous aide à publier des visuels Pinterest depuis le même flux de communication.",
      badge: "Booster",
    },
    site_web: {
      label: "Utiliser Propulser",
      kicker: "Transformez plus de visiteurs en prospects",
      motive: "Propulser vous propose une action business claire : valoriser, récolter ou offrir.",
      badge: "Propulser",
    },
    site_inrcy: {
      label: "Utiliser Propulser",
      kicker: "Accélérez une machine déjà lancée",
      motive: "Propulser aide à transformer le potentiel visible en action commerciale concrète.",
      badge: "Propulser",
    },
    gmb: {
      label: "Utiliser Propulser",
      kicker: "Débloquez un potentiel local immédiat",
      motive: "Propulser permet de valoriser vos preuves, récolter des avis ou pousser une offre locale.",
      badge: "Propulser",
    },
  };

  const disconnectedCopy: Record<CubeKey, { label: string; kicker: string; motive: string; badge: string }> = {
    inrbadge: {
      label: "Configurer iNr’Badge",
      kicker: "Activez votre fiche publique",
      motive: "Complétez iNr’Badge pour centraliser vos canaux, vos actions rapides et votre QR Code.",
      badge: "Connexion",
    },
    inr_search: {
      label: "Page en préparation",
      kicker: "Création automatique par iNrCy",
      motive: "La page sera publiée automatiquement dès que l’identité essentielle de l’entreprise sera disponible.",
      badge: "Connexion",
    },
    facebook: {
      label: "Connecter Facebook",
      kicker: "Activez un levier social local",
      motive: "Reliez Facebook pour mesurer votre visibilité sociale et capter plus de demandes locales.",
      badge: "Connexion",
    },
    instagram: {
      label: "Connecter Instagram",
      kicker: "Activez votre vitrine de marque",
      motive: "Reliez Instagram pour exploiter votre visibilité et transformer plus d’attention en opportunités.",
      badge: "Connexion",
    },
    linkedin: {
      label: "Connecter LinkedIn",
      kicker: "Activez votre crédibilité professionnelle",
      motive: "Reliez LinkedIn pour publier facilement et préparer le suivi analytics dès que les accès seront disponibles.",
      badge: "Connexion",
    },
    mails: {
      label: "Connecter une boîte mail",
      kicker: "Activez vos campagnes",
      motive: "Connectez au moins une boîte d’envoi pour utiliser Fidéliser, Propulser et les mails simples.",
      badge: "Connexion",
    },
    tiktok: {
      label: "Connecter TikTok",
      kicker: "Préparez le canal vidéo/photo",
      motive: "Reliez TikTok pour publier photos et vidéos, suivre le profil et lire les vidéos publiques dans iNrStats.",
      badge: "Connexion",
    },
    youtube_shorts: {
      label: "Configurer YouTube",
      kicker: "Préparez le canal vidéo",
      motive: "Ajoutez votre chaîne YouTube pour publier vos vidéos depuis iNrCy.",
      badge: "Connexion",
    },
    pinterest: {
      label: "Connecter Pinterest",
      kicker: "Activez le canal inspiration",
      motive: "Reliez Pinterest pour publier vos visuels et renforcer votre découverte par l’image.",
      badge: "Connexion",
    },
    site_web: {
      label: "Connecter votre site",
      kicker: "Mesurez enfin votre rendement web",
      motive: "Connectez GA4 et GSC pour analyser votre trafic, vos intentions et votre potentiel business.",
      badge: "Connexion",
    },
    site_inrcy: {
      label: "Connecter le site iNrCy",
      kicker: "Branchez votre machine à leads",
      motive: "Activez les outils de mesure du site iNrCy pour suivre sa performance et ses opportunités.",
      badge: "Connexion",
    },
    gmb: {
      label: "Connecter Google Business",
      kicker: "Débloquez un potentiel local immédiat",
      motive: "Vous laissez probablement passer des demandes locales : ce canal mérite d’être activé en priorité.",
      badge: "Connexion",
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
  ].map((item) => ({
    ...item,
    ...(connectionStateByCube[item.key] ? connectedCopy[item.key] : disconnectedCopy[item.key]),
    connected: connectionStateByCube[item.key],
  }));
}
