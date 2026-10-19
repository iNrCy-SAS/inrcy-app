import type { JobTemplateDefinition } from '../shared';

export const boutique_cosmetiquesJobTemplates: JobTemplateDefinition = {
  sector: 'beaute_bien_etre', professionKey: 'boutique_cosmetiques', professionLabel: 'Boutique de cosmétiques',
  pack: {
    label: 'Boutique de cosmétiques',
    signature: 'aider à choisir des cosmétiques selon les usages recherchés, les textures, les formats et le budget',
    promoLead: 'présenter une sélection de cosmétiques, ses prix et ses conditions de vente réellement disponibles',
    infoLead: 'expliquer les différences entre références, les ingrédients déclarés et les précautions indiquées sur les emballages',
    followLead: 'suivre les commandes, les disponibilités et les questions après un achat de cosmétiques',
    surveyLead: 'connaître les catégories de produits, textures, formats et niveaux de prix recherchés en boutique',
    seasonal: 'sélection de cosmétiques ou de coffrets adaptée aux envies de la saison',
    loyalty: 'avantage produit dont les conditions sont précisées aux clients réguliers de la boutique',
    maintenance: 'rappel facultatif pour renouveler un produit selon son usage et les indications de conservation',
    localHook: 'une boutique où comparer les cosmétiques et obtenir des informations avant achat',
    audience: 'personnes recherchant des cosmétiques et un conseil de choix en boutique',
  },
};
