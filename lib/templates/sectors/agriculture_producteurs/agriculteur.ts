import type { JobTemplateDefinition } from '../shared';

export const agriculteurJobTemplates: JobTemplateDefinition = {
  sector: 'agriculture_producteurs',
  professionKey: 'agriculteur',
  professionLabel: 'Agriculteur',
  pack: {
    label: 'agriculture locale',
    signature: 'faire connaître la production de la ferme et le travail agricole au fil des saisons',
    promoLead: 'présenter les produits disponibles et les prochaines récoltes',
    infoLead: 'partager des nouvelles de l’exploitation et des conseils sur les produits',
    followLead: 'suivre les commandes et les demandes de vente directe',
    surveyLead: 'mieux connaître les produits que recherchent les clients',
    seasonal: 'produits de la ferme disponibles cette saison',
    loyalty: 'avantage réservé aux clients fidèles de l’exploitation',
    maintenance: 'un rappel utile pour les commandes et les prochaines récoltes',
    localHook: 'une exploitation agricole de proximité',
    audience: 'clients à la recherche de produits agricoles locaux',
  },
};
