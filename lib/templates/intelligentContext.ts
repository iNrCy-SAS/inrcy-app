import type { TemplateAction, TemplateDef, TemplateModule } from '@/lib/messageTemplates';

export type CommunicationObjective =
  | 'acquisition'
  | 'valorisation'
  | 'fidelisation'
  | 'avis'
  | 'information'
  | 'enquete'
  | 'suivi'
  | 'reactivation'
  | 'urgence'
  | 'saisonnier';

export type CommunicationTone =
  | 'professionnel'
  | 'rassurant'
  | 'direct'
  | 'premium'
  | 'local'
  | 'pedagogique'
  | 'chaleureux';

export type CommunicationSeason =
  | 'toute_annee'
  | 'printemps'
  | 'ete'
  | 'rentrée'
  | 'automne'
  | 'hiver'
  | 'noel'
  | 'soldes'
  | 'vacances'
  | 'intemperies'
  | 'canicule';

export type CommunicationChannel =
  | 'email'
  | 'site_web'
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'google_business';

export type IntelligentTemplateMetadata = {
  objective: CommunicationObjective;
  tones: CommunicationTone[];
  seasons: CommunicationSeason[];
  channels: CommunicationChannel[];
  priority: number;
};

export type IntelligentTemplateContext = {
  objective?: CommunicationObjective | null;
  tone?: CommunicationTone | null;
  season?: CommunicationSeason | null;
  channel?: CommunicationChannel | null;
};

const actionObjectiveMap: Record<TemplateAction, CommunicationObjective> = {
  valoriser: 'valorisation',
  avis: 'avis',
  offres: 'acquisition',
  informations: 'information',
  suivis: 'suivi',
  enquetes: 'enquete',
};

const actionDefaultToneMap: Record<TemplateAction, CommunicationTone> = {
  valoriser: 'rassurant',
  avis: 'chaleureux',
  offres: 'direct',
  informations: 'pedagogique',
  suivis: 'rassurant',
  enquetes: 'chaleureux',
};

const moduleChannels: Record<TemplateModule, CommunicationChannel[]> = {
  booster: ['email', 'site_web', 'facebook', 'instagram', 'google_business'],
  fideliser: ['email', 'facebook', 'instagram', 'linkedin'],
};

const actionTones: Record<TemplateAction, CommunicationTone[]> = {
  valoriser: ['rassurant', 'professionnel', 'local', 'premium'],
  avis: ['rassurant', 'chaleureux', 'local'],
  offres: ['direct', 'professionnel', 'local'],
  informations: ['professionnel', 'pedagogique', 'rassurant'],
  suivis: ['rassurant', 'professionnel', 'chaleureux'],
  enquetes: ['chaleureux', 'rassurant', 'professionnel'],
};

export function getDefaultObjectiveForAction(action: TemplateAction): CommunicationObjective {
  return actionObjectiveMap[action];
}

export function getDefaultToneForAction(action: TemplateAction): CommunicationTone {
  return actionDefaultToneMap[action];
}

export function getCurrentCommunicationSeason(date = new Date()): CommunicationSeason {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (month === 12 && day >= 1 && day <= 26) return 'noel';
  if ((month === 7 && day >= 1) || month === 8) return 'vacances';
  if (month === 9) return 'rentrée';
  if (month >= 3 && month <= 5) return 'printemps';
  if (month >= 6 && month <= 8) return 'ete';
  if (month >= 10 && month <= 11) return 'automne';
  return 'hiver';
}

export function buildIntelligentTemplateContext(args: {
  action: TemplateAction;
  module: TemplateModule;
  channel?: CommunicationChannel | null;
  tone?: CommunicationTone | null;
  season?: CommunicationSeason | null;
  objective?: CommunicationObjective | null;
}): IntelligentTemplateContext {
  return {
    objective: args.objective ?? getDefaultObjectiveForAction(args.action),
    tone: args.tone ?? getDefaultToneForAction(args.action),
    season: args.season ?? getCurrentCommunicationSeason(),
    channel: args.channel ?? 'email',
  };
}

export function mergeIntelligentTemplateContext(
  base: IntelligentTemplateContext,
  override?: IntelligentTemplateContext | null
): IntelligentTemplateContext {
  return {
    objective: override?.objective ?? base.objective,
    tone: override?.tone ?? base.tone,
    season: override?.season ?? base.season,
    channel: override?.channel ?? base.channel,
  };
}

export function buildTemplateMetadata(args: {
  module: TemplateModule;
  action: TemplateAction;
  slug?: string;
  priority?: number;
}): IntelligentTemplateMetadata {
  const slug = (args.slug ?? '').toLowerCase();
  const isSeasonal = /saison|hiver|ete|été|printemps|automne|noel|vacances|intemperies|intempéries|canicule|rentrée|rentree/.test(slug);
  const isUrgent = /urgent|urgence|flash|rapide|disponibilite|disponibilité/.test(slug);
  const isReactivation = /reactivation|réactivation|retour|relance/.test(slug);
  const isPremium = /premium|haut_de_gamme|luxe|expert/.test(slug);

  const objective: CommunicationObjective = isUrgent
    ? 'urgence'
    : isSeasonal
      ? 'saisonnier'
      : isReactivation
        ? 'reactivation'
        : actionObjectiveMap[args.action];

  const seasons: CommunicationSeason[] = isSeasonal
    ? ['printemps', 'ete', 'rentrée', 'automne', 'hiver', 'noel', 'vacances', 'intemperies', 'canicule']
    : ['toute_annee'];

  const tones = new Set<CommunicationTone>(actionTones[args.action]);
  if (isUrgent) tones.add('direct');
  if (isSeasonal) tones.add('local');
  if (isReactivation) tones.add('chaleureux');
  if (isPremium) tones.add('premium');

  return {
    objective,
    tones: [...tones],
    seasons,
    channels: moduleChannels[args.module],
    priority: args.priority ?? 50,
  };
}

function seasonMatches(metaSeasons: CommunicationSeason[], season?: CommunicationSeason | null): boolean {
  if (!season) return false;
  return metaSeasons.includes(season) || metaSeasons.includes('toute_annee');
}

function scoreTemplate(template: TemplateDef, ctx: IntelligentTemplateContext): number {
  const meta = template.intelligent;
  if (!meta) return 0;

  let score = meta.priority;

  if (ctx.objective && meta.objective === ctx.objective) score += 45;
  if (ctx.tone && meta.tones.includes(ctx.tone)) score += 18;
  if (ctx.season && meta.seasons.includes(ctx.season)) score += 22;
  if (ctx.season && meta.seasons.includes('toute_annee')) score += 4;
  if (ctx.channel && meta.channels.includes(ctx.channel)) score += 16;

  // Un template métier reste prioritaire sur un template secteur/base.
  if (template.professionKey) score += 12;

  // Évite qu'un template très contextuel remonte quand il ne correspond pas au contexte demandé.
  if (ctx.objective && meta.objective !== ctx.objective && meta.objective !== 'saisonnier') score -= 20;
  if (ctx.channel && !meta.channels.includes(ctx.channel)) score -= 30;
  if (ctx.season && !seasonMatches(meta.seasons, ctx.season)) score -= 8;

  return score;
}

export function sortTemplatesByIntelligentContext<T extends TemplateDef>(
  templates: T[],
  ctx?: IntelligentTemplateContext | null
): T[] {
  if (!ctx || (!ctx.objective && !ctx.tone && !ctx.season && !ctx.channel)) return templates;
  return [...templates].sort((a, b) => {
    const diff = scoreTemplate(b, ctx) - scoreTemplate(a, ctx);
    if (diff !== 0) return diff;
    return a.title.localeCompare(b.title, 'fr');
  });
}
