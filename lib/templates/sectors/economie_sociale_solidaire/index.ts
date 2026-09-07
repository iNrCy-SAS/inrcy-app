import { economie_sociale_solidaireTemplates } from './common';
import { createJobTemplates } from '../shared';
import { association_interet_generalJobTemplates } from './association_interet_general';
import { cooperative_scop_scicJobTemplates } from './cooperative_scop_scic';
import { entreprise_sociale_esusJobTemplates } from './entreprise_sociale_esus';
import { fintech_finance_solidaire_mutualisteJobTemplates } from './fintech_finance_solidaire_mutualiste';
import { structure_insertion_siaeJobTemplates } from './structure_insertion_siae';
import { esat_entreprise_adapteeJobTemplates } from './esat_entreprise_adaptee';
import { mutuelle_protection_socialeJobTemplates } from './mutuelle_protection_sociale';
import { fondation_fonds_dotationJobTemplates } from './fondation_fonds_dotation';
import { ressourcerie_recyclerieJobTemplates } from './ressourcerie_recyclerie';
import { centre_social_tiers_lieuJobTemplates } from './centre_social_tiers_lieu';
import { ong_solidarite_internationaleJobTemplates } from './ong_solidarite_internationale';
import { reseau_accompagnement_essJobTemplates } from './reseau_accompagnement_ess';

export { economie_sociale_solidaireTemplates };

export function buildEconomieSocialeSolidaireJobTemplates() {
  return [
    association_interet_generalJobTemplates,
    cooperative_scop_scicJobTemplates,
    entreprise_sociale_esusJobTemplates,
    fintech_finance_solidaire_mutualisteJobTemplates,
    structure_insertion_siaeJobTemplates,
    esat_entreprise_adapteeJobTemplates,
    mutuelle_protection_socialeJobTemplates,
    fondation_fonds_dotationJobTemplates,
    ressourcerie_recyclerieJobTemplates,
    centre_social_tiers_lieuJobTemplates,
    ong_solidarite_internationaleJobTemplates,
    reseau_accompagnement_essJobTemplates,
  ].flatMap((definition) => createJobTemplates(definition));
}
