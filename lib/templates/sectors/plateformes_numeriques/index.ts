import { plateformes_numeriquesTemplates } from './common';
import { createJobTemplates } from '../shared';
import { plateforme_mise_en_relationJobTemplates } from './plateforme_mise_en_relation';
import { mise_en_relation_particuliers_prosJobTemplates } from './mise_en_relation_particuliers_pros';
import { mise_en_relation_b2bJobTemplates } from './mise_en_relation_b2b';
import { mise_en_relation_particuliersJobTemplates } from './mise_en_relation_particuliers';
import { marketplace_servicesJobTemplates } from './marketplace_services';
import { annuaire_comparateurJobTemplates } from './annuaire_comparateur';
import { plateforme_reservationJobTemplates } from './plateforme_reservation';
import { plateforme_emploi_talentsJobTemplates } from './plateforme_emploi_talents';
import { communaute_reseauJobTemplates } from './communaute_reseau';
import { logiciel_saasJobTemplates } from './logiciel_saas';

export { plateformes_numeriquesTemplates };

export function buildPlateformesNumeriquesJobTemplates() {
  return [
    plateforme_mise_en_relationJobTemplates,
    mise_en_relation_particuliers_prosJobTemplates,
    mise_en_relation_b2bJobTemplates,
    mise_en_relation_particuliersJobTemplates,
    marketplace_servicesJobTemplates,
    annuaire_comparateurJobTemplates,
    plateforme_reservationJobTemplates,
    plateforme_emploi_talentsJobTemplates,
    communaute_reseauJobTemplates,
    logiciel_saasJobTemplates,
  ].flatMap((definition) => createJobTemplates(definition));
}
