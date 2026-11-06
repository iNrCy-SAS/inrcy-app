import { BOOK_ALIASES, BOOK_PROFESSIONS } from './bookPublishing.ts';
import { TRAVEL_ALIASES, TRAVEL_PROFESSIONS } from './travelTourism.ts';
import { TRADE_ALIASES, TRADE_PROFESSIONS } from './internationalTrade.ts';

export const ACTIVITY_PROFESSION_COMPLEMENTS = [
  ...TRADE_PROFESSIONS,
  ...TRAVEL_PROFESSIONS,
  ...BOOK_PROFESSIONS,
];

export const ACTIVITY_EXISTING_PROFESSION_ALIASES = [
  ...TRADE_ALIASES,
  ...TRAVEL_ALIASES,
  ...BOOK_ALIASES,
  { sector: 'plateformes_numeriques' as const, professionKey: 'logiciel_saas', aliases: ['Éditeur de logiciels', 'Éditeur logiciel', 'Édition de logiciels', 'Software publisher'] },
  { sector: 'bois_foret' as const, professionKey: 'negoce_bois', aliases: ['Négociant en bois', 'Négociante en bois', 'Grossiste en bois', 'Distributeur de bois'] },
  { sector: 'immobilier' as const, professionKey: 'mandataire_immobilier', aliases: ['Commercial indépendant immobilier', 'Commerciale indépendante immobilière', 'Agent commercial spécialisé en immobilier', 'Agente commerciale spécialisée en immobilier'] },
  { sector: 'assurance' as const, professionKey: 'conseiller_assurances', aliases: ['Agent commercial en assurance', 'Agente commerciale en assurance', 'Représentant commercial en assurances', 'Représentante commerciale en assurances'] },
];

function normalizeProfession(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const professionNames = [
  ...ACTIVITY_PROFESSION_COMPLEMENTS.flatMap(entry =>
    [entry.professionLabel, ...entry.aliases].map(name => ({ name: normalizeProfession(name), sector: entry.sector }))),
  ...ACTIVITY_EXISTING_PROFESSION_ALIASES.flatMap(entry =>
    entry.aliases.map(name => ({ name: normalizeProfession(name), sector: entry.sector }))),
].filter(entry => entry.name).sort((a, b) => b.name.length - a.name.length);

/** Match the primary profession, never a client's trade elsewhere in a sentence. */
export function inferComplementaryActivitySector(value: string) {
  const primary = normalizeProfession(value).replace(/^(?:je suis|nous sommes)\s+/, '')
    .replace(/^(?:un|une|le|la|les|mon|ma|notre)\s+/, '');
  if (/\b(?:import export|importation exportation)\b/.test(primary) && /\b(?:donnees|fichiers|contacts|csv)\b/.test(primary)) return null;
  const exact = professionNames.find(entry => entry.name === primary);
  if (exact) return exact.sector;
  // Explicit commercial specialisms outrank the generic sales profession.
  // Restrict this to the primary role; a client's trade later in a sentence
  // must not reclassify a general representative.
  if (/^(?:agent(?:e)? commercial(?:e)?|representant(?:e)? commercial(?:e)?|commercial(?:e)?)(?: independant(?:e)?)?(?: specialise(?:e)?)?(?: en| dans l)? immobilier(?:e)?\b/.test(primary)) return 'immobilier';
  if (/^(?:agent(?:e)? commercial(?:e)?|representant(?:e)? commercial(?:e)?|commercial(?:e)?)(?: independant(?:e)?)?(?: specialise(?:e)?)?(?: en| dans l)? assurances?\b/.test(primary)) return 'assurance';
  return professionNames.find(entry => entry.name.length >= 8 && primary.startsWith(`${entry.name} `))?.sector ?? null;
}
