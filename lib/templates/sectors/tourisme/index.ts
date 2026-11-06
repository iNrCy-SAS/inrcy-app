import { tourismeTemplates } from './common';
import { createJobTemplates } from '../shared';
import { campingJobTemplates } from './camping';
import { location_saisonniereJobTemplates } from './location_saisonniere';
import { guide_touristiqueJobTemplates } from './guide_touristique';
import { excursionsJobTemplates } from './excursions';
import { activite_touristiqueJobTemplates } from './activite_touristique';
import { agence_voyagesJobTemplates } from './agence_voyages';

export { tourismeTemplates };

export function buildTourismeJobTemplates() {
  return [agence_voyagesJobTemplates, campingJobTemplates, location_saisonniereJobTemplates, guide_touristiqueJobTemplates, excursionsJobTemplates, activite_touristiqueJobTemplates].flatMap((definition) => createJobTemplates(definition));
}
