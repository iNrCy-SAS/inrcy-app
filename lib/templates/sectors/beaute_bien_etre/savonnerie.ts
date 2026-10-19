import type { JobTemplateDefinition } from '../shared';

export const savonnerieJobTemplates: JobTemplateDefinition = {
  sector: 'beaute_bien_etre', professionKey: 'savonnerie', professionLabel: 'Savonnerie artisanale',
  pack: {
    label: 'Savonnerie artisanale',
    signature: 'présenter des savons et leurs usages avec une composition déclarée, des formats lisibles et des conseils de conservation',
    promoLead: 'faire découvrir une sélection de savons, assortiments ou coffrets selon les références effectivement disponibles',
    infoLead: 'expliquer les ingrédients déclarés, les étapes de fabrication réellement pratiquées et les précautions propres à chaque savon',
    followLead: 'suivre les commandes de savons, les demandes de coffrets et les questions d’utilisation après achat',
    surveyLead: 'recueillir les préférences de formats, de parfums et de compositions pour les futurs assortiments de savons',
    seasonal: 'assortiment de savons ou coffrets cadeaux préparé pour un temps fort identifié',
    loyalty: 'avantage sur les savons ou assortiments pour les clients réguliers, avec des conditions précisées',
    maintenance: 'rappel sur le séchage, le stockage et le renouvellement des savons selon leur étiquette et leur usage',
    localHook: 'une savonnerie qui explique ses références et les étapes de fabrication qu’elle réalise',
    audience: 'clients et revendeurs à la recherche de savons, d’assortiments et d’informations sur leur utilisation',
  },
};
