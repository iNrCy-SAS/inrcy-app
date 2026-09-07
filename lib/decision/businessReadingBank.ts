import type { ActionType, ChannelKey, DecisionInput, ModeType } from "./decisionEngine";

type SituationKey =
  | "highPotentialLowLeads"
  | "highPotentialHighLeads"
  | "lowPotentialHighLeads"
  | "lowPotentialLowLeads"
  | "balanced";

type ReadingContext = {
  channelName: string;
  channelAngle: string;
  boosterAngle: string;
  templateAngle: string;
  opp: number;
  weekLeads: number;
  monthLeads: number;
  quality: number;
  dominant?: string;
};

type ReadingTemplate = (_ctx: ReadingContext) => string;

type ProvenanceInfo = {
  dominantLabel?: string;
  dominantShare?: number;
};

const CHANNEL_COPY: Record<ChannelKey, {
  name: string;
  angle: string;
  boosterAngle: string;
  templateAngle: string;
}> = {
  site_inrcy: {
    name: "Site iNrCy",
    angle: "machine à demandes",
    boosterAngle: "alimenter le site avec une actualité, une offre ou une preuve récente",
    templateAngle: "relancer les contacts entrants depuis le CRM",
  },
  site_web: {
    name: "Site web",
    angle: "point de conversion",
    boosterAngle: "publier un contenu ou une offre qui ramène vers la prise de contact",
    templateAngle: "transformer les visiteurs et demandes déjà captées",
  },
  gmb: {
    name: "Google Business",
    angle: "levier local d’appels, clics et itinéraires",
    boosterAngle: "publier une actu locale, une offre ou une preuve rassurante",
    templateAngle: "relancer les demandes locales et demander des avis",
  },
  facebook: {
    name: "Facebook",
    angle: "audience locale et preuve sociale",
    boosterAngle: "publier régulièrement pour réchauffer l’audience locale",
    templateAngle: "relancer les contacts et transformer l’intérêt social en demandes",
  },
  instagram: {
    name: "Instagram",
    angle: "vitrine visuelle et notoriété",
    boosterAngle: "publier un contenu visuel simple pour recréer de l’attention",
    templateAngle: "réactiver les contacts avec une offre ou une relance ciblée",
  },
  linkedin: {
    name: "LinkedIn",
    angle: "crédibilité professionnelle",
    boosterAngle: "publier une prise de parole pro pour créer de la confiance",
    templateAngle: "suivre les prospects et relations utiles depuis le CRM",
  },
  x: {
    name: "X",
    angle: "prise de parole courte et conversationnelle",
    boosterAngle: "publier une idée concise et actuelle pour rejoindre les conversations utiles",
    templateAngle: "réactiver les contacts issus de vos prises de parole professionnelles",
  },
  tiktok: {
    name: "TikTok",
    angle: "visibilité vidéo et photo courte",
    boosterAngle: "publier un contenu court, visuel et local pour créer de l’attention",
    templateAngle: "réactiver les contacts attirés par vos contenus visuels",
  },
  youtube_shorts: {
    name: "YouTube",
    angle: "visibilité vidéo YouTube",
    boosterAngle: "publier une vidéo YouTube utile, locale et dynamique pour créer de l’attention",
    templateAngle: "réactiver les contacts attirés par vos vidéos YouTube",
  },
  pinterest: {
    name: "Pinterest",
    angle: "visibilité inspiration et découverte visuelle",
    boosterAngle: "publier un visuel utile et inspirant pour créer de la découverte",
    templateAngle: "réactiver les contacts attirés par vos contenus visuels",
  },
};

const DEFAULT_CHANNEL = {
  name: "Canal",
  angle: "levier business",
  boosterAngle: "publier rapidement pour recréer du mouvement",
  templateAngle: "exploiter les contacts depuis le CRM",
};

const TOOL_TEXT_BANK: Record<ActionType, Record<SituationKey, ReadingTemplate[]>> = {
  publier: {
    highPotentialLowLeads: [
      (ctx) => `${ctx.channelName} a un potentiel élevé (+${ctx.opp}), mais capte encore peu de demandes (${ctx.monthLeads} sur 30 j).`,
      (ctx) => `Priorité : Booster / Publier pour ${ctx.boosterAngle} et convertir ce potentiel en contacts réels.`,
      (ctx) => `Ce canal doit d’abord retrouver du rythme : une publication simple et régulière est plus rentable qu’une analyse trop longue.`,
    ],
    highPotentialHighLeads: [
      (ctx) => `${ctx.channelName} capte déjà des demandes (${ctx.monthLeads} sur 30 j) et garde un potentiel fort (+${ctx.opp}).`,
      (ctx) => `Il faut continuer à publier avec Booster pour maintenir la pression commerciale et éviter que le canal retombe.`,
      (ctx) => `Ensuite, Fidéliser peut prendre le relais si le CRM contient assez de contacts à relancer.`,
    ],
    lowPotentialHighLeads: [
      (ctx) => `${ctx.channelName} capte déjà de l’activité (${ctx.monthLeads} demandes sur 30 j), même si le potentiel additionnel reste limité (+${ctx.opp}).`,
      (ctx) => `Publier sert ici à entretenir la présence et à ne pas laisser refroidir les demandes existantes.`,
      (ctx) => `Le relais naturel sera le suivi CRM : remerciement, relance ou offre selon les contacts disponibles.`,
    ],
    lowPotentialLowLeads: [
      (ctx) => `${ctx.channelName} reste encore discret : peu de demandes captées (${ctx.monthLeads} sur 30 j) et peu d’opportunités immédiates (+${ctx.opp}).`,
      (ctx) => `Le bon réflexe est Booster / Publier : une action courte pour tester le canal sans y passer trop de temps.`,
      (ctx) => `Objectif : créer les premiers signaux avant de lancer Propulser ou Fidéliser.`,
    ],
    balanced: [
      (ctx) => `${ctx.channelName} montre une base exploitable : +${ctx.opp} opportunités et ${ctx.monthLeads} demandes captées sur 30 j.`,
      (ctx) => `Publier avec Booster reste le levier prioritaire pour augmenter le volume sans complexifier l’action.`,
      (ctx) => `Fidéliser viendra ensuite convertir les contacts si le CRM est suffisamment rempli.`,
    ],
  },
  offrir: {
    highPotentialLowLeads: [
      (ctx) => `${ctx.channelName} a du potentiel (+${ctx.opp}) mais ne déclenche pas encore assez de demandes (${ctx.monthLeads} sur 30 j).`,
      (ctx) => `Priorité Propulser : lancer une offre claire, visible et facile à comprendre pour provoquer le passage à l’action.`,
      (ctx) => `Le canal n’a pas besoin de plus de théorie : il a besoin d’un déclencheur commercial simple.`,
    ],
    highPotentialHighLeads: [
      (ctx) => `${ctx.channelName} fonctionne déjà (${ctx.monthLeads} demandes sur 30 j) et peut encore accélérer (+${ctx.opp}).`,
      (ctx) => `Une action Offrir lancée avec Propulser peut transformer l’attention existante en demandes plus chaudes.`,
      (ctx) => `Si le CRM suit, Fidéliser permettra ensuite de relancer les contacts qui n’ont pas encore converti.`,
    ],
    lowPotentialHighLeads: [
      (ctx) => `${ctx.channelName} génère déjà des demandes (${ctx.monthLeads} sur 30 j), mais le potentiel additionnel est plus mesuré (+${ctx.opp}).`,
      (ctx) => `Ici, une offre ponctuelle suffit : inutile de surinvestir, il faut surtout rentabiliser ce qui arrive déjà.`,
      (ctx) => `Fidéliser peut compléter avec un suivi ou un remerciement si le CRM contient assez de contacts.`,
    ],
    lowPotentialLowLeads: [
      (ctx) => `${ctx.channelName} manque encore de traction : ${ctx.monthLeads} demandes sur 30 j et +${ctx.opp} opportunités.`,
      (ctx) => `Une petite offre lancée via Propulser est le test le plus rapide pour voir si le canal peut se réveiller.`,
      (ctx) => `Avant de lancer des campagnes CRM, il faut d’abord créer une raison claire de contacter l’entreprise.`,
    ],
    balanced: [
      (ctx) => `${ctx.channelName} a une base correcte, mais le passage à l’action peut être renforcé.`,
      (ctx) => `Propulser doit servir à lancer une offre ou un message très concret, orienté demande.`,
      (ctx) => `Fidéliser devient utile ensuite pour relancer ceux qui ont montré un intérêt.`,
    ],
  },
  recolter: {
    highPotentialLowLeads: [
      (ctx) => `${ctx.channelName} laisse voir un potentiel (+${ctx.opp}), mais la confiance ne se transforme pas encore assez en demandes.`,
      (ctx) => `Propulser doit pousser une preuve : avis, témoignage, réalisation, avant/après ou retour client.`,
      (ctx) => `Le but est de rassurer vite pour aider ce canal à capter plus que ${ctx.monthLeads} demandes sur 30 j.`,
    ],
    highPotentialHighLeads: [
      (ctx) => `${ctx.channelName} capte déjà (${ctx.monthLeads} demandes sur 30 j) et dispose encore d’un vrai potentiel (+${ctx.opp}).`,
      (ctx) => `Valoriser des preuves avec Propulser peut amplifier ce qui marche déjà, sans changer toute la stratégie.`,
      (ctx) => `Ensuite, Fidéliser peut demander des avis ou relancer les clients satisfaits.`,
    ],
    lowPotentialHighLeads: [
      (ctx) => `${ctx.channelName} capte des demandes réelles (${ctx.monthLeads} sur 30 j), même si le potentiel restant est plus limité.`,
      (ctx) => `Le meilleur usage de Propulser est de valoriser ces réussites : avis, preuve sociale, cas client.`,
      (ctx) => `Fidéliser peut ensuite aider à récupérer plus d’avis depuis le CRM.`,
    ],
    lowPotentialLowLeads: [
      (ctx) => `${ctx.channelName} n’a pas encore assez de preuves visibles pour déclencher beaucoup de demandes.`,
      (ctx) => `Une action Valoriser basée sur un avis ou une réalisation peut créer le premier déclic.`,
      (ctx) => `Fidéliser viendra après, quand le CRM aura assez de clients à solliciter.`,
    ],
    balanced: [
      (ctx) => `${ctx.channelName} est exploitable, mais gagnerait à montrer davantage de preuves concrètes.`,
      (ctx) => `Propulser / Valoriser doit servir à rassurer avant de vendre : avis, résultat, cas client ou preuve terrain.`,
      (ctx) => `C’est un bon pont vers Fidéliser si le CRM est prêt.`,
    ],
  },
  informer: {
    highPotentialLowLeads: [
      (ctx) => `${ctx.channelName} a encore du potentiel (+${ctx.opp}) mais pas assez de demandes captées (${ctx.monthLeads} sur 30 j).`,
      (ctx) => `Si Fidéliser est recommandé, il faut nourrir les contacts avec un message utile, simple et régulier.`,
      (ctx) => `Fidéliser devient utile après, si le CRM contient assez de contacts à nourrir.`,
    ],
    highPotentialHighLeads: [
      (ctx) => `${ctx.channelName} est actif : ${ctx.monthLeads} demandes sur 30 j et encore +${ctx.opp} opportunités activables.`,
      (ctx) => `Booster maintient la visibilité, puis Fidéliser entretient la relation dans le CRM.`,
      (ctx) => `La logique est simple : publier pour attirer, informer pour rester présent.`,
    ],
    lowPotentialHighLeads: [
      (ctx) => `${ctx.channelName} capte déjà des demandes (${ctx.monthLeads} sur 30 j), sans énorme potentiel additionnel immédiat.`,
      (ctx) => `Il faut entretenir cette base : publication légère côté Booster, puis information régulière via Fidéliser si le CRM le permet.`,
      (ctx) => `L’objectif est de rester en tête sans surcharger le canal.`,
    ],
    lowPotentialLowLeads: [
      (ctx) => `${ctx.channelName} reste calme : peu d’opportunités (+${ctx.opp}) et peu de demandes (${ctx.monthLeads} sur 30 j).`,
      (ctx) => `Un contenu informatif publié avec Booster est une bonne première action pour réchauffer le canal.`,
      (ctx) => `Les actions Fidéliser attendront d’avoir assez de contacts utiles.`,
    ],
    balanced: [
      (ctx) => `${ctx.channelName} peut être entretenu sans action lourde.`,
      (ctx) => `Publier un conseil via Booster maintient la présence ; Fidéliser prend le relais côté CRM.`,
      (ctx) => `C’est une logique de continuité : visible dehors, présent auprès des contacts.`,
    ],
  },
  suivre: {
    highPotentialLowLeads: [
      (ctx) => `${ctx.channelName} a du potentiel (+${ctx.opp}) mais pas encore assez de demandes à suivre (${ctx.monthLeads} sur 30 j).`,
      (ctx) => `Il faut donc publier avec Booster avant tout pour créer plus de matière commerciale.`,
      (ctx) => `Fidéliser deviendra prioritaire dès que le CRM contiendra assez de demandes ou contacts chauds.`,
    ],
    highPotentialHighLeads: [
      (ctx) => `${ctx.channelName} génère déjà de l’activité (${ctx.monthLeads} demandes sur 30 j) et garde un potentiel fort (+${ctx.opp}).`,
      (ctx) => `Le bon enchaînement : Booster pour continuer à attirer, puis Fidéliser / Suivre pour relancer vite les contacts du CRM.`,
      (ctx) => `C’est typiquement un canal à ne pas laisser dormir : chaque demande non suivie peut coûter du chiffre.`,
    ],
    lowPotentialHighLeads: [
      (ctx) => `${ctx.channelName} capte déjà des demandes (${ctx.monthLeads} sur 30 j), même si l’accélération possible est plus limitée.`,
      (ctx) => `Ici, le suivi est rentable : répondre, remercier, relancer et transformer ce qui existe déjà.`,
      (ctx) => `Booster reste utile en entretien, mais le CRM doit récupérer les contacts à exploiter.`,
    ],
    lowPotentialLowLeads: [
      (ctx) => `${ctx.channelName} n’a pas encore assez de demandes pour justifier une grosse séquence de suivi.`,
      (ctx) => `Avant Fidéliser, il faut publier avec Booster pour créer des signaux et remplir progressivement le CRM.`,
      (ctx) => `Le suivi viendra ensuite, quand le canal aura plus de contacts à traiter.`,
    ],
    balanced: [
      (ctx) => `${ctx.channelName} présente une base exploitable : ${ctx.monthLeads} demandes sur 30 j et +${ctx.opp} opportunités.`,
      (ctx) => `Booster maintient l’arrivée de demandes ; Fidéliser transforme ensuite les contacts présents dans le CRM.`,
      (ctx) => `C’est le duo le plus logique : visibilité puis relance.`,
    ],
  },
  enqueter: {
    highPotentialLowLeads: [
      (ctx) => `${ctx.channelName} affiche un potentiel fort (+${ctx.opp}) mais ne capte pas assez de demandes (${ctx.monthLeads} sur 30 j).`,
      (ctx) => `Avant de pousser plus fort, il faut tester avec Booster ou Propulser : lancer un message clair pour comprendre ce qui déclenche ou bloque.`,
      (ctx) => `Fidéliser pourra ensuite interroger les contacts CRM si la base est suffisante.`,
    ],
    highPotentialHighLeads: [
      (ctx) => `${ctx.channelName} capte déjà (${ctx.monthLeads} demandes sur 30 j), mais le potentiel restant indique qu’il y a encore quelque chose à optimiser.`,
      (ctx) => `Booster permet de tester de nouveaux angles de publication ; Fidéliser / Enquêter sert ensuite à comprendre les freins côté contacts.`,
      (ctx) => `Le canal mérite une action rapide, pas une remise à zéro.`,
    ],
    lowPotentialHighLeads: [
      (ctx) => `${ctx.channelName} capte des demandes, mais l’opportunité additionnelle est plus basse (+${ctx.opp}).`,
      (ctx) => `Il faut enquêter légèrement avec Fidéliser pour comprendre ce qui fonctionne déjà, puis renforcer le bon levier.`,
      (ctx) => `Une enquête CRM courte peut aider, à condition d’avoir assez de contacts.`,
    ],
    lowPotentialLowLeads: [
      (ctx) => `${ctx.channelName} donne peu de signaux : ${ctx.monthLeads} demandes sur 30 j et +${ctx.opp} opportunités.`,
      (ctx) => `Le bon test est une publication Booster simple, puis une action Enquêter seulement si des contacts CRM peuvent répondre.`,
      (ctx) => `Inutile de complexifier : il faut d’abord identifier le message qui réveille le canal.`,
    ],
    balanced: [
      (ctx) => `${ctx.channelName} montre des signaux mixtes : assez pour agir, pas assez pour foncer sans comprendre.`,
      (ctx) => `Booster sert à tester un angle de publication ; Enquêter permet ensuite de lire les freins côté CRM.`,
      (ctx) => `La bonne approche est test court, mesure, puis relance.`,
    ],
  },
};

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(value: number) {
  return `${Math.round(Math.max(0, value) * 100)}%`;
}

function dedupe(lines: string[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const clean = line.trim();
    if (!clean || seen.has(clean)) return false;
    seen.add(clean);
    return true;
  });
}

function getSituation(opp: number, monthLeads: number, weekLeads: number): SituationKey {
  const highPotential = opp >= 14;
  const lowPotential = opp < 7;
  const highLeads = monthLeads >= 12 || weekLeads >= 4;
  const lowLeads = monthLeads <= 3 && weekLeads <= 1;

  if (highPotential && lowLeads) return "highPotentialLowLeads";
  if (highPotential && highLeads) return "highPotentialHighLeads";
  if (lowPotential && highLeads) return "lowPotentialHighLeads";
  if (lowPotential && lowLeads) return "lowPotentialLowLeads";
  return "balanced";
}

function channelCopy(key?: ChannelKey) {
  return key ? CHANNEL_COPY[key] || DEFAULT_CHANNEL : DEFAULT_CHANNEL;
}

function buildContext(input: DecisionInput, provenance: ProvenanceInfo): ReadingContext {
  const channel = channelCopy(input.channelKey);
  const dominantLabel = String(provenance?.dominantLabel || "").trim();
  const dominantShare = n(provenance?.dominantShare);

  return {
    channelName: channel.name,
    channelAngle: channel.angle,
    boosterAngle: channel.boosterAngle,
    templateAngle: channel.templateAngle,
    opp: Math.max(0, Math.round(n(input.opportunities))),
    weekLeads: Math.max(0, Math.round(n(input.capturedLeads?.week))),
    monthLeads: Math.max(0, Math.round(n(input.capturedLeads?.month))),
    quality: Math.max(0, Math.round(n(input.quality))),
    dominant: dominantLabel ? `Provenance dominante : ${dominantLabel}${dominantShare > 0 ? ` (${pct(dominantShare)})` : ""}.` : undefined,
  };
}

function qualityLine(ctx: ReadingContext) {
  if (ctx.quality <= 0) return "La qualité du signal reste à confirmer : mieux vaut lancer une action simple et mesurer la réaction.";
  if (ctx.quality < 55) return `Qualité ${ctx.quality}/100 : le canal doit être réveillé par une action simple avant d’être trop automatisé.`;
  if (ctx.quality < 70) return `Qualité ${ctx.quality}/100 : la base est exploitable, mais la communication doit encore créer plus de régularité.`;
  return `Qualité ${ctx.quality}/100 : le canal est assez solide pour combiner publication et exploitation CRM.`;
}

function sourceLine(ctx: ReadingContext) {
  if (ctx.dominant) return ctx.dominant;
  return `Le canal ${ctx.channelAngle} doit être lu avec une priorité simple : créer du mouvement, puis convertir.`;
}

export function buildBusinessReading(args: {
  input: DecisionInput;
  action: ActionType;
  mode: ModeType;
  provenance: ProvenanceInfo;
}): string[] {
  const ctx = buildContext(args.input, args.provenance);
  const situation = getSituation(ctx.opp, ctx.monthLeads, ctx.weekLeads);
  const templates = TOOL_TEXT_BANK[args.action]?.[situation] || TOOL_TEXT_BANK.publier.balanced;
  const mainLines = templates.map((template) => template(ctx));

  const extraLines = args.mode === "booster"
    ? [sourceLine(ctx)]
    : [qualityLine(ctx), sourceLine(ctx)];

  return dedupe([...mainLines, ...extraLines]).slice(0, 4);
}
