import { buildBusinessReading } from "./businessReadingBank";
export type ActionType =
  | "publier"
  | "offrir"
  | "recolter"
  | "informer"
  | "suivre"
  | "enqueter";

export type ModeType = "booster" | "fideliser";
export type ChannelType = "website" | "social" | "gmb";
export type ChannelKey = "site_inrcy" | "site_web" | "gmb" | "facebook" | "instagram" | "linkedin" | "x" | "tiktok" | "youtube_shorts" | "pinterest";

export type DecisionInput = {
  channelType: ChannelType;
  channelKey?: ChannelKey;
  connected?: boolean;
  opportunities?: number;
  quality?: number;
  capturedLeads?: { week?: number; month?: number };
  metrics?: {
    audience?: number;
    engagement?: number;
    traffic?: number;
    intent?: number;
    conversions?: number;
    visibility?: number;
  };
  provenance?: Array<{
    label: string;
    value: number;
  }>;
};

export type RankedAction = {
  action: ActionType;
  score: number;
};

export type DecisionResult = {
  mode: ModeType;
  action: ActionType;
  reason: string;
  businessLecture?: string[];
  confidence?: number;
  ranking?: RankedAction[];
};

type ScoreCard = Record<ActionType, number>;

type ProvenanceSummary = {
  dominantLabel: string;
  dominantShare: number;
  googleShare: number;
  directShare: number;
  socialShare: number;
  searchShare: number;
  mapsShare: number;
  audienceShare: number;
  interactionShare: number;
  clickShare: number;
  balanced: boolean;
};

function n(v: unknown) {
  const value = Number(v);
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function emptyScores(): ScoreCard {
  return {
    publier: 0,
    offrir: 0,
    recolter: 0,
    informer: 0,
    suivre: 0,
    enqueter: 0,
  };
}

function add(scores: ScoreCard, action: ActionType, points: number) {
  scores[action] += points;
}

function addMany(scores: ScoreCard, actions: ActionType[], points: number) {
  actions.forEach((action) => add(scores, action, points));
}

function buildProvenanceSummary(entries?: DecisionInput["provenance"]): ProvenanceSummary {
  const safeEntries = Array.isArray(entries)
    ? entries
        .map((entry) => ({ label: String(entry?.label || "").trim(), value: Math.max(0, n(entry?.value)) }))
        .filter((entry) => entry.label)
    : [];

  const total = safeEntries.reduce((sum, entry) => sum + entry.value, 0);
  const sorted = [...safeEntries].sort((a, b) => b.value - a.value);
  const dominant = sorted[0] || { label: "", value: 0 };

  const share = (matcher: (_label: string) => boolean) => {
    if (total <= 0) return 0;
    return clamp(
      safeEntries.filter((entry) => matcher(entry.label.toLowerCase())).reduce((sum, entry) => sum + entry.value, 0) / total,
    );
  };

  return {
    dominantLabel: dominant.label,
    dominantShare: total > 0 ? clamp(dominant.value / total) : 0,
    googleShare: share((label) => label.includes("google")),
    directShare: share((label) => label.includes("direct")),
    socialShare: share((label) => label.includes("social")),
    searchShare: share((label) => label.includes("search")),
    mapsShare: share((label) => label.includes("maps")),
    audienceShare: share((label) => label.includes("audience") || label.includes("impression")),
    interactionShare: share((label) => label.includes("interaction") || label.includes("engagement")),
    clickShare: share((label) => label.includes("clic")),
    balanced: total > 0 ? dominant.value / total <= 0.65 : false,
  };
}

const ACTION_PRIORITY: Record<ActionType, number> = {
  suivre: 6,
  publier: 5,
  offrir: 4,
  recolter: 3,
  informer: 2,
  enqueter: 1,
};

function sortRanking(scores: ScoreCard): RankedAction[] {
  return (Object.entries(scores) as Array<[ActionType, number]>)
    .map(([action, score]) => ({ action, score: Math.max(0, Math.round(score)) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return ACTION_PRIORITY[b.action] - ACTION_PRIORITY[a.action];
    });
}

function confidenceFromRanking(ranking: RankedAction[]): number {
  const first = ranking[0]?.score ?? 0;
  const second = ranking[1]?.score ?? 0;
  return Math.round(clamp((first - second) / 5, 0, 1) * 100);
}

function selectAction(mode: ModeType, scores: ScoreCard): ActionType {
  const allowed: ActionType[] = mode === "booster" ? ["publier", "recolter", "offrir"] : ["informer", "suivre", "enqueter"];
  const tiePriority: Partial<Record<ActionType, number>> = mode === "booster"
    ? { publier: 3, recolter: 2, offrir: 1 }
    : { suivre: 3, informer: 2, enqueter: 1 };

  return allowed.sort((a, b) => {
    if (scores[b] !== scores[a]) return scores[b] - scores[a];
    return (tiePriority[b] || 0) - (tiePriority[a] || 0);
  })[0];
}

function makeReason(action: ActionType, channelType: ChannelType, p: ProvenanceSummary, opp: number, quality: number) {
  const channelLabel = channelType === "website" ? "site" : channelType === "social" ? "réseau" : "fiche locale";
  const dominant = p.dominantLabel ? ` La provenance dominante est « ${p.dominantLabel} ». ` : " ";

  if (action === "publier") {
    return `Le ${channelLabel} n'active pas encore assez d'opportunités (${opp}).${dominant}La priorité est de relancer la visibilité et le mouvement du canal.`;
  }
  if (action === "offrir") {
    return `Le ${channelLabel} capte déjà de l'attention mais transforme encore trop peu.${dominant}Il faut pousser une offre claire, visible et immédiatement actionnable.`;
  }
  if (action === "recolter") {
    return `Le ${channelLabel} montre déjà des signaux utiles mais manque de preuves pour rassurer et convertir.${dominant}Il faut récolter avis, retours ou cas clients.`;
  }
  if (action === "informer") {
    return `Le ${channelLabel} fonctionne déjà correctement (${opp} opportunités, qualité ${quality}/100).${dominant}Le bon levier est d'informer régulièrement pour entretenir la relation.`;
  }
  if (action === "suivre") {
    return `Le ${channelLabel} fonctionne déjà et génère des signaux business exploitables.${dominant}La priorité est maintenant le suivi : réponse, relance, remerciement et conversion.`;
  }
  return `Le ${channelLabel} génère des opportunités mais les signaux restent contradictoires.${dominant}Avant d'accélérer, il faut enquêter pour comprendre ce qui bloque.`;
}

function detectMode(input: DecisionInput, p: ProvenanceSummary): ModeType {
  const opp = n(input.opportunities);
  const quality = n(input.quality);
  const engagement = n(input.metrics?.engagement);
  const audience = n(input.metrics?.audience);
  const conversions = n(input.metrics?.conversions);
  const visibility = n(input.metrics?.visibility);
  const weekLeads = n(input.capturedLeads?.week);
  const monthLeads = n(input.capturedLeads?.month);

  // Règle business : on part de Booster / Publier par défaut.
  // On ne bascule vers Fidéliser que si le canal prouve déjà qu'il capte des demandes réelles.
  const weakQuality = quality > 0 && quality < 60;
  const weakDemand = monthLeads < 10 && weekLeads < 3 && conversions < 4;
  const highPotentialButNotEnoughDemand = opp >= 7 && (monthLeads < 12 || weekLeads < 3);

  if (weakQuality || (highPotentialButNotEnoughDemand && weakDemand)) {
    return "booster";
  }

  if (input.channelType === "website") {
    const isInrcySite = input.channelKey === "site_inrcy";
    const matureDemand = isInrcySite
      ? monthLeads >= 18 || weekLeads >= 4 || conversions >= 10
      : monthLeads >= 14 || weekLeads >= 4 || conversions >= 8;
    const strongStructure = quality >= (isInrcySite ? 62 : 65);

    return matureDemand && strongStructure ? "fideliser" : "booster";
  }

  if (input.channelType === "gmb") {
    const localDemand = monthLeads >= 18 || weekLeads >= 5 || conversions >= 8;
    const localSignal = visibility >= 250 || p.mapsShare >= 0.35 || p.searchShare >= 0.35 || p.googleShare >= 0.45;

    return quality >= 58 && localDemand && localSignal ? "fideliser" : "booster";
  }

  const socialDemand = monthLeads >= 16 || weekLeads >= 5 || conversions >= 4;
  const socialActivity = engagement >= 20 || audience >= 300 || visibility >= 500 || p.interactionShare >= 0.35;
  const socialMature = quality >= 62 && socialDemand && socialActivity;

  return socialMature ? "fideliser" : "booster";
}

function scoreBooster(input: DecisionInput, p: ProvenanceSummary): ScoreCard {
  const scores = emptyScores();
  const quality = n(input.quality);
  const opp = n(input.opportunities);
  const audience = n(input.metrics?.audience);
  const engagement = n(input.metrics?.engagement);
  const traffic = n(input.metrics?.traffic);
  const intent = n(input.metrics?.intent);
  const conversions = n(input.metrics?.conversions);
  const visibility = n(input.metrics?.visibility);
  const weekLeads = n(input.capturedLeads?.week);
  const monthLeads = n(input.capturedLeads?.month);

  addMany(scores, ["publier", "recolter", "offrir"], 1);

  // Recalibrage iNrCy : quand un canal est faible/moyen, Booster / Publier doit rester le réflexe.
  if (quality > 0 && quality < 60) add(scores, "publier", 5);
  if (monthLeads < 10 && weekLeads < 3) add(scores, "publier", 3);
  if (opp >= 7 && monthLeads < 12) add(scores, "publier", 3);

  if (input.channelType === "website") {
    if (opp <= 2) add(scores, "publier", 4);
    else if (opp <= 4) add(scores, "publier", 2);

    if (quality < 70) add(scores, "publier", 2);
    if (quality < 60) add(scores, "publier", 3);
    if (quality < 55) add(scores, "offrir", 1);

    if (traffic > 0 && conversions <= 0) add(scores, "offrir", 4);
    if (intent > 0 && conversions <= 0) add(scores, "offrir", 3);
    if (p.googleShare + p.searchShare >= 0.45) add(scores, "offrir", 2);
    if (p.directShare >= 0.4 && conversions <= 0) add(scores, "offrir", 1);

    if (traffic > 0 && quality >= 65 && conversions <= 0) add(scores, "recolter", 2);
    if (conversions > 0 && conversions < 3) add(scores, "recolter", 1);
  }

  if (input.channelType === "social") {
    if (opp <= 3) add(scores, "publier", 3);
    if (audience < 120 || visibility < 150) add(scores, "publier", 3);
    if (quality < 55) add(scores, "publier", 2);
    if (p.audienceShare >= 0.45) add(scores, "publier", 2);

    if (engagement > 0 && conversions <= 0) add(scores, "recolter", 3);
    if (engagement >= 8 && audience >= 120 && conversions <= 1) add(scores, "recolter", 2);
    if (p.interactionShare >= 0.35) add(scores, "recolter", 2);

    if ((engagement >= 12 || traffic > 0) && conversions <= 0) add(scores, "offrir", 2);
    if (p.clickShare >= 0.25) add(scores, "offrir", 2);
  }

  if (input.channelType === "gmb") {
    if (opp <= 2) add(scores, "publier", 3);
    if (visibility < 220) add(scores, "publier", 3);
    if (quality < 55) add(scores, "publier", 1);

    if (visibility >= 220 && conversions <= 1) add(scores, "recolter", 3);
    if (p.mapsShare >= 0.45 && conversions <= 1) add(scores, "recolter", 2);

    if (conversions > 0 && conversions < 4) add(scores, "offrir", 3);
    if (p.searchShare >= 0.35 || p.googleShare >= 0.45) add(scores, "offrir", 2);
  }

  return scores;
}

function scoreFideliser(input: DecisionInput, p: ProvenanceSummary): ScoreCard {
  const scores = emptyScores();
  const quality = n(input.quality);
  const opp = n(input.opportunities);
  const audience = n(input.metrics?.audience);
  const engagement = n(input.metrics?.engagement);
  const conversions = n(input.metrics?.conversions);
  const visibility = n(input.metrics?.visibility);
  const traffic = n(input.metrics?.traffic);
  const intent = n(input.metrics?.intent);
  const weekLeads = n(input.capturedLeads?.week);
  const monthLeads = n(input.capturedLeads?.month);

  addMany(scores, ["informer", "suivre", "enqueter"], 1);

  // En fidélisation, le suivi doit dominer dès qu'il y a déjà de vraies demandes à transformer.
  if (monthLeads >= 18 || weekLeads >= 5) add(scores, "suivre", 5);
  else if (monthLeads >= 10 || weekLeads >= 3) add(scores, "suivre", 3);
  if (monthLeads < 10 && weekLeads < 3) add(scores, "informer", 1);

  if (input.channelType === "website") {
    if (opp >= 10) add(scores, "suivre", 2);
    if (conversions > 0) add(scores, "suivre", 4);
    if (quality >= 70) add(scores, "suivre", 2);
    if (p.directShare >= 0.35 || p.googleShare >= 0.35) add(scores, "suivre", 1);

    if (quality >= 65 && conversions <= 0 && engagement > 0) add(scores, "informer", 2);
    if (p.balanced) add(scores, "informer", 1);

    const contradictorySignals = (traffic > 30 && conversions <= 0) || (intent > 0 && conversions <= 0) || (p.directShare >= 0.4 && conversions <= 0);
    if (contradictorySignals) add(scores, "enqueter", 4);
    if (quality < 70 && contradictorySignals) add(scores, "enqueter", 2);
  }

  if (input.channelType === "social") {
    if (opp >= 8) add(scores, "suivre", 1);
    if (engagement >= 20 || conversions >= 2) add(scores, "suivre", 4);
    if (p.interactionShare >= 0.35) add(scores, "suivre", 1);

    if (audience >= 150 && engagement >= 8 && conversions <= 1) add(scores, "informer", 3);
    if (p.audienceShare >= 0.4 && engagement >= 8) add(scores, "informer", 1);

    if (audience >= 200 && engagement < 8) add(scores, "enqueter", 4);
    if (visibility >= 300 && conversions <= 0 && engagement < 10) add(scores, "enqueter", 2);
  }

  if (input.channelType === "gmb") {
    if (opp >= 5) add(scores, "suivre", 1);
    if (conversions >= 3) add(scores, "suivre", 4);
    if (p.mapsShare >= 0.4 && conversions >= 2) add(scores, "suivre", 1);

    if (visibility >= 250 && conversions >= 2) add(scores, "informer", 2);
    if (p.balanced) add(scores, "informer", 1);

    if (visibility >= 250 && conversions <= 1) add(scores, "enqueter", 4);
    if (p.mapsShare >= 0.45 && conversions <= 1) add(scores, "enqueter", 1);
  }

  return scores;
}



function formatPct(value: number) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function channelLabel(channelType: ChannelType) {
  if (channelType === "website") return "site";
  if (channelType === "social") return "réseau";
  return "fiche Google Business";
}

function buildBusinessLecture(input: DecisionInput, action: ActionType, mode: ModeType, p: ProvenanceSummary): string[] {
  const opp = n(input.opportunities);
  const quality = n(input.quality);
  const audience = n(input.metrics?.audience);
  const engagement = n(input.metrics?.engagement);
  const conversions = n(input.metrics?.conversions);
  const visibility = n(input.metrics?.visibility);
  const traffic = n(input.metrics?.traffic);
  const intent = n(input.metrics?.intent);

  const bankLines = buildBusinessReading({ input, action, mode, provenance: p });
  if (bankLines.length) return bankLines;

  const lines: string[] = [];
  const label = channelLabel(input.channelType);
  const dominant = p.dominantLabel ? `La provenance dominante est « ${p.dominantLabel} » (${formatPct(p.dominantShare)}).` : "";

  if (input.channelType === "website") {
    if (mode === "booster") {
      if (action === "publier") {
        lines.push(
          opp <= 2
            ? `Le ${label} active encore peu d'opportunités (${opp}) : il faut d'abord recréer du mouvement.`
            : `Le ${label} reste en phase de relance : il faut encore densifier sa présence avant de chercher à fidéliser.`
        );
        if (quality < 60) {
          lines.push(`La qualité perçue reste faible (${quality}/100) : la structure n'aide pas encore assez la conversion.`);
        } else if (quality < 72) {
          lines.push(`La structure est exploitable (${quality}/100), mais elle manque encore d'impact pour accélérer seule.`);
        }
        if (traffic <= 20 && visibility <= 100) {
          lines.push("Le volume de trafic et de visibilité reste léger : publier aide à regagner de l'exposition.");
        } else if (dominant) {
          lines.push(dominant.replace("La provenance dominante", "Aujourd'hui, la provenance dominante"));
        }
        lines.push("Publier est donc le levier prioritaire pour remettre le canal en mouvement avant de pousser une offre plus forte.");
      }

      if (action === "offrir") {
        lines.push(`Le ${label} capte déjà un minimum d'attention mais transforme encore trop peu.`);
        if (traffic > 0) {
          lines.push(`Le trafic existe (${Math.round(traffic)} sessions) mais les signaux de conversion restent limités (${Math.round(conversions)}).`);
        } else if (intent > 0) {
          lines.push(`Des signaux d'intention existent (${Math.round(intent)}) sans débouché clair côté conversion.`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Une offre plus claire, plus visible et plus immédiate est le meilleur levier pour déclencher le contact.");
      }

      if (action === "recolter") {
        lines.push(`Le ${label} commence à être crédible, mais il manque encore des preuves pour rassurer.`);
        if (traffic > 0 || conversions > 0) {
          lines.push(`Le canal montre déjà des signaux réels (trafic ${Math.round(traffic)}, conversions ${Math.round(conversions)}) qui méritent d'être appuyés.`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Récolter des avis, retours ou cas clients aidera à transformer plus vite l'attention déjà captée.");
      }
    } else {
      if (action === "suivre") {
        lines.push(`Le ${label} fonctionne déjà : le volume d'opportunités (${opp}) justifie une logique de fidélisation.`);
        if (conversions > 0) {
          lines.push(`Des signaux business existent déjà (${Math.round(conversions)} conversions / points de contact) : il faut désormais les suivre et les relancer.`);
        } else if (traffic > 30) {
          lines.push(`Le canal reçoit déjà du trafic exploitable (${Math.round(traffic)} sessions) et la qualité reste solide (${quality}/100).`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Le bon levier est donc le suivi : réponse rapide, relance, remerciement et transformation des demandes.");
      }

      if (action === "enqueter") {
        lines.push(`Le ${label} produit des opportunités (${opp}), mais les signaux restent contradictoires.`);
        if (traffic > 30 && conversions <= 0) {
          lines.push(`Le trafic est là (${Math.round(traffic)} sessions) sans conversion suffisante (${Math.round(conversions)}) : un blocage subsiste dans le parcours.`);
        } else if (intent > 0 && conversions <= 0) {
          lines.push(`De l'intention est détectée (${Math.round(intent)}) mais elle ne se transforme pas encore en prise de contact.`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Avant d'accélérer, il faut enquêter : clarifier l'offre, la zone, les déclencheurs et le parcours de contact.");
      }

      if (action === "informer") {
        lines.push(`Le ${label} est déjà exploitable (${opp} opportunités, qualité ${quality}/100), sans urgence de correction majeure.`);
        if (traffic > 0) {
          lines.push(`Le canal continue de vivre avec un trafic utile (${Math.round(traffic)} sessions) mais sans pic de conversion immédiat.`);
        }
        if (p.balanced) {
          lines.push("La provenance est assez équilibrée, ce qui favorise un travail régulier de présence et d'information.");
        } else if (dominant) {
          lines.push(dominant);
        }
        lines.push("Informer régulièrement permet donc d'entretenir la confiance, rester présent et préparer les prochaines demandes.");
      }
    }
  }

  if (input.channelType === "social") {
    if (mode === "booster") {
      if (action === "publier") {
        lines.push(`Le ${label} n'a pas encore assez de mouvement pour produire une dynamique stable.`);
        if (visibility > 0 || audience > 0) {
          lines.push(`La présence existe (${Math.round(Math.max(visibility, audience))} signaux de portée/audience), mais elle reste trop peu activée.`);
        }
        if (engagement <= 5) {
          lines.push(`L'engagement reste très faible (${Math.round(engagement)}) : le canal manque surtout de régularité visible.`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Publier est donc l'action prioritaire pour relancer la visibilité, créer du rythme et rouvrir le canal.");
      }

      if (action === "recolter") {
        lines.push(`Le ${label} capte déjà de l'attention, mais il transforme encore peu cette attention en réassurance concrète.`);
        lines.push(`Les interactions existent (${Math.round(engagement)}), alors que les conversions restent limitées (${Math.round(conversions)}).`);
        if (dominant) lines.push(dominant);
        lines.push("Récolter des avis, témoignages ou preuves sociales est le meilleur levier pour crédibiliser ce qui fonctionne déjà.");
      }

      if (action === "offrir") {
        lines.push(`Le ${label} commence à créer des signaux utiles, mais le passage à l'action reste trop faible.`);
        if (engagement > 0 || traffic > 0) {
          lines.push(`Il y a déjà de l'activité (${Math.round(engagement)} engagements, ${Math.round(traffic)} trafic) sans offre assez déclenchante.`);
        }
        if (p.clickShare >= 0.25) {
          lines.push("Une part non négligeable de la provenance vient déjà des clics : le canal est prêt pour une proposition plus directe.");
        } else if (dominant) {
          lines.push(dominant);
        }
        lines.push("Offrir permet ici de transformer l'attention sociale en intention concrète de prise de contact.");
      }
    } else {
      if (action === "suivre") {
        lines.push(`Le ${label} fonctionne déjà suffisamment pour passer en logique de fidélisation.`);
        if (engagement >= 20 || conversions >= 2) {
          lines.push(`Les signaux d'activité sont déjà solides (${Math.round(engagement)} engagements, ${Math.round(conversions)} conversions).`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Le bon levier est désormais le suivi : répondre, relancer, remercier et convertir la communauté active.");
      }

      if (action === "enqueter") {
        lines.push(`Le ${label} est visible, mais la mécanique sociale ne convertit pas encore correctement.`);
        if (audience >= 200 && engagement < 8) {
          lines.push(`L'audience est présente (${Math.round(audience)}) alors que l'engagement reste faible (${Math.round(engagement)}) : il y a un décalage à comprendre.`);
        } else if (visibility >= 300 && conversions <= 0) {
          lines.push(`La visibilité est réelle (${Math.round(visibility)}) mais ne débouche pas sur de conversion (${Math.round(conversions)}).`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Il faut donc enquêter sur le contenu, le message, l'offre ou la cible avant d'insister davantage.");
      }

      if (action === "informer") {
        lines.push(`Le ${label} est suffisamment vivant pour nourrir la relation plutôt que simplement chercher de la portée brute.`);
        if (audience >= 150) {
          lines.push(`L'audience est déjà installée (${Math.round(audience)}), avec assez de présence pour travailler la continuité.`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Informer régulièrement aide ici à garder le canal chaud, rester crédible et préparer les prochaines conversions.");
      }
    }
  }

  if (input.channelType === "gmb") {
    if (mode === "booster") {
      if (action === "publier") {
        lines.push("La fiche locale a encore besoin d'être animée pour gagner en présence dans son bassin local.");
        if (visibility < 220) {
          lines.push(`La visibilité locale reste limitée (${Math.round(visibility)}) pour enclencher un vrai flux de demandes.`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Publier régulièrement sur Google Business est le levier le plus simple pour relancer la visibilité locale.");
      }

      if (action === "recolter") {
        lines.push("La fiche locale commence à être vue, mais elle manque encore de preuves pour rassurer et faire passer à l'action.");
        if (visibility >= 220) {
          lines.push(`La visibilité existe déjà (${Math.round(visibility)}), alors que les conversions restent faibles (${Math.round(conversions)}).`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Récolter des avis est ici l'action la plus rentable pour renforcer la crédibilité locale.");
      }

      if (action === "offrir") {
        lines.push("La fiche locale génère déjà quelques signaux, mais elle peut encore mieux orienter vers une demande concrète.");
        if (conversions > 0) {
          lines.push(`Des interactions existent déjà (${Math.round(conversions)}) : une offre ou un message plus direct peut les amplifier.`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Mettre en avant une offre, une disponibilité ou un avantage clair aide à convertir la visibilité locale plus vite.");
      }
    } else {
      if (action === "suivre") {
        lines.push("La fiche locale fonctionne déjà : elle capte des signaux business qu'il faut maintenant exploiter rapidement.");
        if (conversions >= 3) {
          lines.push(`Les conversions locales sont déjà présentes (${Math.round(conversions)}) : le suivi commercial devient prioritaire.`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Le bon levier est donc le suivi des appels, clics site et demandes issues de la fiche.");
      }

      if (action === "enqueter") {
        lines.push("La fiche locale est visible, mais cette visibilité ne se transforme pas encore assez en demandes utiles.");
        if (visibility >= 250 && conversions <= 1) {
          lines.push(`Le décalage est net entre visibilité (${Math.round(visibility)}) et conversions (${Math.round(conversions)}).`);
        }
        if (dominant) lines.push(dominant);
        lines.push("Il faut enquêter sur la fiche, les catégories, les contenus et les éléments de réassurance avant d'accélérer.");
      }

      if (action === "informer") {
        lines.push("La fiche locale est déjà saine : l'enjeu est surtout de rester présente et cohérente dans le temps.");
        if (visibility >= 250 && conversions >= 2) {
          lines.push(`Les signaux locaux sont bons (${Math.round(visibility)} impressions, ${Math.round(conversions)} interactions).`);
        }
        if (p.balanced) {
          lines.push("La répartition entre Search et Maps reste équilibrée, ce qui favorise une animation régulière.");
        } else if (dominant) {
          lines.push(dominant);
        }
        lines.push("Informer régulièrement permet de maintenir la confiance locale sans forcer inutilement le canal.");
      }
    }
  }

  return lines.filter(Boolean).slice(0, 4);
}

export function decideAction(input: DecisionInput): DecisionResult {
  if (input.connected === false) {
    return {
      mode: "booster",
      action: "publier",
      reason: "Le canal n'est pas encore connecté : commencez par l'activer pour pouvoir exploiter ses données.",
      businessLecture: [
        "Le canal n'est pas encore branché : aucune lecture business fiable n'est possible tant qu'il reste déconnecté.",
        "La priorité absolue est donc l'activation du canal pour commencer à capter ses premiers signaux.",
      ],
      confidence: 100,
      ranking: [
        { action: "publier", score: 100 },
        { action: "offrir", score: 0 },
        { action: "recolter", score: 0 },
      ],
    };
  }

  const p = buildProvenanceSummary(input.provenance);
  const mode = detectMode(input, p);
  const rawScores = mode === "booster" ? scoreBooster(input, p) : scoreFideliser(input, p);
  const action = selectAction(mode, rawScores);
  const ranking = sortRanking(rawScores).filter((entry) =>
    mode === "booster"
      ? ["publier", "recolter", "offrir"].includes(entry.action)
      : ["informer", "suivre", "enqueter"].includes(entry.action),
  );

  const businessLecture = buildBusinessLecture(input, action, mode, p);
  const reason = businessLecture[0] || makeReason(action, input.channelType, p, n(input.opportunities), n(input.quality));

  return {
    mode,
    action,
    reason,
    businessLecture,
    confidence: confidenceFromRanking(ranking),
    ranking,
  };
}
