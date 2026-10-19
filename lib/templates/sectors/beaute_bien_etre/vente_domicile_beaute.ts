import type { JobTemplateDefinition } from '../shared';

export const vente_domicile_beauteJobTemplates: JobTemplateDefinition = {
  sector: 'beaute_bien_etre', professionKey: 'vente_domicile_beaute', professionLabel: 'Vente à domicile de produits de beauté / VDI',
  pack: {
    label: 'Vente à domicile de produits de beauté / VDI',
    signature: 'faire découvrir des produits de beauté et expliquer librement leur choix, leur utilisation et les modalités de commande',
    promoLead: 'présenter le catalogue, une sélection découverte ou une commande groupée avec ses conditions précises',
    infoLead: 'partager les informations des marques distribuées, les démonstrations d’usage et les modalités de livraison ou de retour annoncées',
    followLead: 'suivre les commandes individuelles ou groupées et répondre aux questions après réception des produits',
    surveyLead: 'identifier les catégories de produits, formats de présentation et modes de réception préférés des clients',
    seasonal: 'sélection de produits ou de coffrets pour une présentation à domicile liée à la saison',
    loyalty: 'avantage produit communiqué aux clients réguliers selon les conditions du catalogue',
    maintenance: 'rappel facultatif sur une référence déjà achetée ou la clôture annoncée d’une commande groupée',
    localHook: 'un interlocuteur de vente à domicile pour découvrir un catalogue de produits de beauté',
    audience: 'clients souhaitant découvrir des produits de beauté à domicile ou commander auprès d’un vendeur indépendant',
  },
};
