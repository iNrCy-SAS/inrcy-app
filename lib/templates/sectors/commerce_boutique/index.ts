import { commerce_boutiqueTemplates } from './common';
import { createJobTemplates } from '../shared';
import { bijouterieJobTemplates } from './bijouterie';
import { boulangerieJobTemplates } from './boulangerie';
import { boutique_modeJobTemplates } from './boutique_mode';
import { boutique_cafe_theJobTemplates } from './boutique_cafe_the';
import { cavisteJobTemplates } from './caviste';
import { epicerieJobTemplates } from './epicerie';
import { fleuristeJobTemplates } from './fleuriste';
import { friperieJobTemplates } from './friperie';
import { librairieJobTemplates } from './librairie';
import { magasin_meublesJobTemplates } from './magasin_meubles';
import { magasin_vetementsJobTemplates } from './magasin_vetements';
import { opticienJobTemplates } from './opticien';
import { torrefacteurJobTemplates } from './torrefacteur';

export { commerce_boutiqueTemplates };

export function buildCommerceBoutiqueJobTemplates() {
  return [bijouterieJobTemplates, boulangerieJobTemplates, boutique_modeJobTemplates, boutique_cafe_theJobTemplates, cavisteJobTemplates, epicerieJobTemplates, fleuristeJobTemplates, friperieJobTemplates, librairieJobTemplates, magasin_meublesJobTemplates, magasin_vetementsJobTemplates, opticienJobTemplates, torrefacteurJobTemplates].flatMap((definition) => createJobTemplates(definition));
}
