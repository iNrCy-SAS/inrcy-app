import type { JobTemplateDefinition } from '../shared';

export const parfumerieJobTemplates: JobTemplateDefinition = {
  sector: 'beaute_bien_etre', professionKey: 'parfumerie', professionLabel: 'Parfumerie',
  pack: {
    label: 'Parfumerie',
    signature: 'guider le choix d’un parfum selon les préférences olfactives, la concentration indiquée, le format et le budget',
    promoLead: 'présenter des parfums, formats découverte ou coffrets cadeaux avec leurs disponibilités et conditions d’achat',
    infoLead: 'expliquer les notes annoncées par les marques, les concentrations et les précautions d’usage figurant sur les produits',
    followLead: 'suivre les demandes de références, achats cadeaux, commandes et questions de conservation des parfums',
    surveyLead: 'connaître les familles olfactives, formats et budgets recherchés pour soi ou pour un cadeau',
    seasonal: 'sélection de parfums et de coffrets pour les envies et cadeaux de la saison',
    loyalty: 'avantage sur une sélection de parfums pour les clients fidèles, selon les conditions annoncées',
    maintenance: 'rappel facultatif pour retrouver une référence appréciée et ses indications de conservation',
    localHook: 'une parfumerie où découvrir des fragrances et comparer leurs formats',
    audience: 'personnes recherchant un parfum personnel, une découverte olfactive ou un cadeau',
  },
};
