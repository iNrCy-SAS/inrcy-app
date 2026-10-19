import { voyance_arts_divinatoiresTemplates } from './common';
import { createVoyanceJobTemplates } from './consultationTemplates';
import { voyantJobTemplates } from './voyant';
import { mediumJobTemplates } from './medium';
import { tarologueJobTemplates } from './tarologue';
import { cartomancienJobTemplates } from './cartomancien';
import { astrologueJobTemplates } from './astrologue';
import { numerologueJobTemplates } from './numerologue';
import { chiromancienJobTemplates } from './chiromancien';
import { radiesthesiste_divinatoireJobTemplates } from './radiesthesiste_divinatoire';

export { voyance_arts_divinatoiresTemplates };
export { createVoyanceSectorTemplates } from './consultationTemplates';

export const VOYANCE_JOB_TEMPLATE_DEFINITIONS = [
  voyantJobTemplates, mediumJobTemplates, tarologueJobTemplates, cartomancienJobTemplates,
  astrologueJobTemplates, numerologueJobTemplates, chiromancienJobTemplates, radiesthesiste_divinatoireJobTemplates,
];

export function buildVoyanceArtsDivinatoiresJobTemplates() {
  return VOYANCE_JOB_TEMPLATE_DEFINITIONS.flatMap(createVoyanceJobTemplates);
}
