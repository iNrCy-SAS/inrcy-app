import type { JobTemplateDefinition } from '../shared';

export const grossiste_cosmetiquesJobTemplates: JobTemplateDefinition = {
  sector: 'beaute_bien_etre', professionKey: 'grossiste_cosmetiques', professionLabel: 'Grossiste en cosmétiques',
  pack: {
    label: 'Grossiste en cosmétiques',
    signature: 'aider les revendeurs à composer leur assortiment avec des références, des volumes et des conditions d’approvisionnement clairs',
    promoLead: 'présenter les références distribuées et les conditions professionnelles confirmées selon les quantités commandées',
    infoLead: 'informer les revendeurs sur les disponibilités, conditionnements, minimums de commande et informations des marques distribuées',
    followLead: 'suivre les commandes professionnelles, réassorts, reliquats et demandes de disponibilité des revendeurs',
    surveyLead: 'comprendre les catégories recherchées, volumes de réassort, contraintes logistiques et profils de clientèle des revendeurs',
    seasonal: 'sélection de références à distribuer pour préparer les temps forts commerciaux des revendeurs',
    loyalty: 'conditions de réassort ou de fidélité professionnelles précisées aux revendeurs réguliers',
    maintenance: 'rappel de réassort fondé sur les besoins exprimés et les stocks réellement disponibles',
    localHook: 'un partenaire de distribution de cosmétiques pour l’approvisionnement des professionnels',
    audience: 'boutiques, sites marchands et autres revendeurs recherchant un approvisionnement cosmétique en gros',
  },
};
