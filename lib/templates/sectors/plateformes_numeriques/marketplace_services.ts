import type { JobTemplateDefinition } from '../shared';

export const marketplace_servicesJobTemplates: JobTemplateDefinition = {
  sector: 'plateformes_numeriques',
  professionKey: 'marketplace_services',
  professionLabel: 'Marketplace de services',
  pack: {
    label: 'Marketplace de services',
    signature: 'rendre la recherche et la réservation d’un service plus simples et plus transparentes',
    promoLead: 'mettre en avant les services disponibles et inviter à réserver ou déposer une demande',
    infoLead: 'présenter les prestataires, les usages de la marketplace et les critères de choix utiles',
    followLead: 'suivre les demandes, réservations, échanges et retours d’expérience',
    surveyLead: 'identifier le service recherché, le budget, le délai et les préférences utilisateur',
    seasonal: 'sélection saisonnière de services et de prestataires à découvrir',
    loyalty: 'avantage réservé aux clients réguliers et aux prestataires partenaires',
    maintenance: 'un rappel utile pour finaliser une réservation ou actualiser une offre de service',
    localHook: 'des services accessibles réunis au même endroit',
    audience: 'clients recherchant un service et prestataires souhaitant développer leur activité',
  },
};
