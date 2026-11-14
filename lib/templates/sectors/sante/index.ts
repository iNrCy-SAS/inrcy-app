import { santeTemplates } from './common';
import { createJobTemplates } from '../shared';
import { dentisteJobTemplates } from './dentiste';
import { infirmierJobTemplates } from './infirmier';
import { kineJobTemplates } from './kine';
import { medecin_generalisteJobTemplates } from './medecin_generaliste';
import { orthophonisteJobTemplates } from './orthophoniste';
import { osteopatheJobTemplates } from './osteopathe';
import { pharmacieJobTemplates } from './pharmacie';
import { podologueJobTemplates } from './podologue';
import { psychologueJobTemplates } from './psychologue';
import { buildChirurgienJobTemplates } from './chirurgien';

export { santeTemplates };

export function buildSanteJobTemplates() {
  return [
    ...[dentisteJobTemplates, infirmierJobTemplates, kineJobTemplates, medecin_generalisteJobTemplates, orthophonisteJobTemplates, osteopatheJobTemplates, pharmacieJobTemplates, podologueJobTemplates, psychologueJobTemplates].flatMap((definition) => createJobTemplates(definition)),
    ...buildChirurgienJobTemplates(),
  ];
}
