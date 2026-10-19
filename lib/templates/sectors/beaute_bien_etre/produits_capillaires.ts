import type { JobTemplateDefinition } from '../shared';

export const produits_capillairesJobTemplates: JobTemplateDefinition = {
  sector: 'beaute_bien_etre', professionKey: 'produits_capillaires', professionLabel: 'Vente de produits capillaires',
  pack: {
    label: 'Vente de produits capillaires',
    signature: 'guider le choix de shampooings, après-shampooings, produits coiffants et accessoires selon les usages décrits sur leurs notices',
    promoLead: 'présenter une sélection de produits capillaires, leurs formats et leurs conditions de vente',
    infoLead: 'expliquer l’usage des références, les textures et les précautions indiquées par les fabricants',
    followLead: 'suivre les commandes et les questions sur l’utilisation des produits capillaires déjà achetés',
    surveyLead: 'connaître les habitudes capillaires, les formats recherchés et les préférences de texture ou de coiffage',
    seasonal: 'sélection de produits capillaires et accessoires pour les habitudes de la saison',
    loyalty: 'avantage annoncé sur des références capillaires pour les clients réguliers',
    maintenance: 'rappel facultatif de renouvellement d’un produit et d’entretien des accessoires selon les notices',
    localHook: 'un point de vente de produits capillaires et d’accessoires avec des informations de choix et d’utilisation',
    audience: 'clients et professionnels recherchant des produits capillaires, des formats adaptés et des accessoires de coiffage',
  },
};
