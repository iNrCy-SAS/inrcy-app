import type { JobTemplateDefinition } from '../shared';

export const torrefacteurJobTemplates: JobTemplateDefinition = {
  sector: 'commerce_boutique',
  professionKey: 'torrefacteur',
  professionLabel: 'Torréfacteur',
  pack: {
    label: 'torréfaction de café',
    signature: 'torréfier des cafés avec soin et conseiller une préparation adaptée à chaque goût',
    promoLead: 'présenter un café fraîchement torréfié ou une sélection d’origines',
    infoLead: 'partager des conseils sur la mouture, l’extraction et les profils de café',
    followLead: 'suivre les commandes de café et les demandes des professionnels',
    surveyLead: 'comprendre les goûts et habitudes de préparation des amateurs de café',
    seasonal: 'sélection de cafés fraîchement torréfiés pour la saison',
    loyalty: 'avantage réservé aux clients fidèles de la torréfaction',
    maintenance: 'un rappel utile pour renouveler une commande de café',
    localHook: 'une torréfaction de proximité',
    audience: 'particuliers et professionnels à la recherche de café torréfié',
  },
};
