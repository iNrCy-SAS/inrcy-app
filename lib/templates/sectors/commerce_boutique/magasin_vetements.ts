import type { JobTemplateDefinition } from '../shared';

export const magasin_vetementsJobTemplates: JobTemplateDefinition = {
  sector: 'commerce_boutique',
  professionKey: 'magasin_vetements',
  professionLabel: 'Magasin de vêtements',
  pack: {
    label: 'magasin de vêtements',
    signature: 'aider chacun à trouver une tenue adaptée à son style et à sa taille',
    promoLead: 'présenter une collection, une sélection de saison ou une offre en boutique',
    infoLead: 'partager les nouveautés, conseils de style et informations pratiques du magasin',
    followLead: 'accompagner les demandes de disponibilité, de taille et de commande',
    surveyLead: 'mieux connaître les styles et tailles recherchés par les clients',
    seasonal: 'sélection de vêtements adaptée à la saison',
    loyalty: 'avantage réservé aux clients fidèles du magasin',
    maintenance: 'un rappel utile pour les commandes ou les nouvelles collections',
    localHook: 'un magasin de vêtements de proximité',
    audience: 'clients à la recherche de vêtements et de conseils en boutique',
  },
};
