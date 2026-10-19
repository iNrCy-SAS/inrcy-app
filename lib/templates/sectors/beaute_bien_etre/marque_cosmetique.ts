import type { JobTemplateDefinition } from '../shared';

export const marque_cosmetiqueJobTemplates: JobTemplateDefinition = {
  sector: 'beaute_bien_etre', professionKey: 'marque_cosmetique', professionLabel: 'Marque de cosmétiques',
  pack: {
    label: 'Marque de cosmétiques',
    signature: 'rendre la gamme cosmétique lisible avec des usages, des compositions déclarées et des caractéristiques documentées',
    promoLead: 'faire découvrir les références de la marque, un lancement ou un coffret avec ses conditions de commande',
    infoLead: 'présenter les nouveautés de la gamme, les conseils d’utilisation et les informations vérifiées propres à chaque produit',
    followLead: 'répondre aux questions sur les références, les commandes et les retours après achat auprès de la marque',
    surveyLead: 'recueillir les préférences de textures, de formats et de catégories pour préparer les prochaines gammes',
    seasonal: 'mise en avant de références ou de coffrets de la marque pour un temps fort identifié',
    loyalty: 'avantage de fidélité sur la gamme, limité aux conditions effectivement proposées par la marque',
    maintenance: 'rappel facultatif sur l’usage, la conservation ou le renouvellement d’une référence déjà achetée',
    localHook: 'une marque cosmétique joignable pour comprendre sa gamme et ses points de distribution',
    audience: 'clients et distributeurs qui souhaitent découvrir les produits et l’univers de la marque',
  },
};
