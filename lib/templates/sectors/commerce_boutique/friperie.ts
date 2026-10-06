import type { JobTemplateDefinition } from '../shared';

export const friperieJobTemplates: JobTemplateDefinition = {
  sector: 'commerce_boutique',
  professionKey: 'friperie',
  professionLabel: 'Friperie / vêtements de seconde main',
  pack: {
    label: 'friperie',
    signature: 'proposer des vêtements de seconde main sélectionnés avec soin',
    promoLead: 'faire découvrir les nouvelles pièces et sélections vintage',
    infoLead: 'partager des conseils de style et des informations sur la seconde main',
    followLead: 'suivre les demandes de pièces, de tailles et de dépôt-vente',
    surveyLead: 'connaître les styles et catégories que recherchent les clients',
    seasonal: 'sélection de seconde main adaptée à la saison',
    loyalty: 'avantage réservé aux habitués de la friperie',
    maintenance: 'un rappel utile pour les dépôts et les nouveaux arrivages',
    localHook: 'une friperie de proximité',
    audience: 'clients intéressés par les vêtements de seconde main',
  },
};
