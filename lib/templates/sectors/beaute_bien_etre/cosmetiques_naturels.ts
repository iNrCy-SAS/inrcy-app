import type { JobTemplateDefinition } from '../shared';

export const cosmetiques_naturelsJobTemplates: JobTemplateDefinition = {
  sector: 'beaute_bien_etre', professionKey: 'cosmetiques_naturels', professionLabel: 'Cosmétiques naturels / bio',
  pack: {
    label: 'Cosmétiques naturels / bio',
    signature: 'aider à choisir des cosmétiques à partir de leurs ingrédients déclarés et des caractéristiques naturelles ou biologiques documentées',
    promoLead: 'présenter une sélection de cosmétiques en précisant les caractéristiques et labels effectivement justifiés pour chaque référence',
    infoLead: 'expliquer les listes d’ingrédients disponibles, les labels attestés et les indications d’usage sans généraliser à toute la gamme',
    followLead: 'suivre les commandes et répondre aux questions sur les documents produit, l’utilisation et la conservation',
    surveyLead: 'comprendre les attentes sur la composition, les labels documentés, les textures, les formats et le budget',
    seasonal: 'sélection de cosmétiques aux caractéristiques documentées pour les usages de la saison',
    loyalty: 'avantage annoncé sur une sélection de produits pour les clients réguliers',
    maintenance: 'rappel facultatif des indications de conservation et de renouvellement propres à la référence achetée',
    localHook: 'un point de vente qui rend accessibles les informations vérifiables sur les cosmétiques naturels ou bio',
    audience: 'personnes souhaitant comparer les compositions déclarées et les labels attestés des cosmétiques',
  },
};
