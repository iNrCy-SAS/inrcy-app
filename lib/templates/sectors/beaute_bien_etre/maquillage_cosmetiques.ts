import type { JobTemplateDefinition } from '../shared';

export const maquillage_cosmetiquesJobTemplates: JobTemplateDefinition = {
  sector: 'beaute_bien_etre', professionKey: 'maquillage_cosmetiques', professionLabel: 'Vente de maquillage / cosmétiques',
  pack: {
    label: 'Vente de maquillage / cosmétiques',
    signature: 'aider à comparer les teintes, finis, textures et formats de maquillage selon le rendu recherché et les indications produit',
    promoLead: 'présenter une sélection de maquillage, de teintes ou de coffrets avec leurs disponibilités et conditions d’achat',
    infoLead: 'expliquer les nuances, les finis et les conseils d’application, de conservation et d’entretien des applicateurs figurant sur les notices',
    followLead: 'suivre les commandes, les références de teintes et les questions d’utilisation après achat',
    surveyLead: 'recueillir les préférences de teintes, de textures, de rendus et de formats pour les futures sélections',
    seasonal: 'sélection de teintes et de coffrets de maquillage pour les envies de la saison',
    loyalty: 'avantage annoncé sur les références de maquillage pour les clients réguliers',
    maintenance: 'rappel facultatif des indications de conservation du maquillage et d’entretien des applicateurs',
    localHook: 'un point de vente pour comparer des teintes, des textures et des accessoires de maquillage',
    audience: 'personnes et professionnels qui recherchent du maquillage, des teintes précises et des conseils d’utilisation',
  },
};
