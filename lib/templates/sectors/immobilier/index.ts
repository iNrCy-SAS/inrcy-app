import { immobilierTemplates } from './common';
import { createJobTemplates } from '../shared';
import { agence_immobiliereJobTemplates } from './agence_immobiliere';
import { mandataire_immobilierJobTemplates } from './mandataire_immobilier';
import { courtierJobTemplates } from './courtier';
import { diagnostiqueur_immobilierJobTemplates } from './diagnostiqueur_immobilier';
import { gestion_locativeJobTemplates } from './gestion_locative';
import { home_stagingJobTemplates } from './home_staging';
import { promoteur_immobilierJobTemplates } from './promoteur_immobilier';
import { syndicJobTemplates } from './syndic';

export { immobilierTemplates };

export function buildImmobilierJobTemplates() {
  return [agence_immobiliereJobTemplates, mandataire_immobilierJobTemplates, courtierJobTemplates, diagnostiqueur_immobilierJobTemplates, gestion_locativeJobTemplates, home_stagingJobTemplates, promoteur_immobilierJobTemplates, syndicJobTemplates].flatMap((definition) => createJobTemplates(definition));
}
