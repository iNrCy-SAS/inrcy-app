import type { JobTemplateDefinition } from '../shared';

export const arboriculteurJobTemplates: JobTemplateDefinition = {
  sector: 'agriculture_producteurs',
  professionKey: 'arboriculteur',
  professionLabel: 'Arboriculteur',
  pack: {
    label: 'arboriculture fruitière',
    signature: 'proposer des fruits cultivés au verger et récoltés selon leur saison',
    promoLead: 'présenter les fruits disponibles, la cueillette ou les paniers du verger',
    infoLead: 'partager des nouvelles des récoltes et des conseils de conservation',
    followLead: 'suivre les commandes de fruits et les réservations de cueillette',
    surveyLead: 'connaître les variétés et formats de paniers préférés des clients',
    seasonal: 'fruits du verger disponibles cette saison',
    loyalty: 'avantage réservé aux clients fidèles du verger',
    maintenance: 'un rappel utile pour annoncer les prochaines récoltes',
    localHook: 'un verger de proximité',
    audience: 'clients à la recherche de fruits locaux et de saison',
  },
};
