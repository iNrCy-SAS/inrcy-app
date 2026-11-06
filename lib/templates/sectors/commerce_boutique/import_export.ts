import type { JobTemplateDefinition } from '../shared';

export const import_exportJobTemplates: JobTemplateDefinition = {
  sector: 'commerce_boutique',
  professionKey: 'import_export',
  professionLabel: 'Import-export',
  pack: {
    label: 'Import-export',
    signature: 'accompagner des échanges de marchandises avec des informations commerciales et logistiques vérifiées',
    promoLead: 'présenter des produits, des disponibilités et des conditions commerciales réellement proposés à l’international',
    infoLead: 'expliquer le sourcing, les étapes de commande et les modalités logistiques confirmées pour les marchandises',
    followLead: 'suivre les demandes de devis, les approvisionnements et les commandes internationales',
    surveyLead: 'préciser les produits recherchés, les quantités, les destinations et les contraintes de livraison',
    seasonal: 'approvisionnement ou disponibilité de saison, selon les fournisseurs et délais confirmés',
    loyalty: 'suivi des besoins de réassort des clients et partenaires commerciaux existants',
    maintenance: 'un rappel utile pour vérifier un devis, une commande ou une prochaine expédition',
    localHook: 'sourcing et échanges commerciaux internationaux de marchandises',
    audience: 'entreprises, acheteurs professionnels, fournisseurs et distributeurs',
  },
};
