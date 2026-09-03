import type { JobTemplateDefinition } from '../shared';

export const plateforme_reservationJobTemplates: JobTemplateDefinition = {
  sector: 'plateformes_numeriques',
  professionKey: 'plateforme_reservation',
  professionLabel: 'Plateforme de réservation',
  pack: {
    label: 'Plateforme de réservation',
    signature: 'transformer une recherche en réservation confirmée grâce à un parcours rapide et lisible',
    promoLead: 'mettre en avant les disponibilités et inviter à réserver directement en ligne',
    infoLead: 'expliquer la réservation, les confirmations, rappels et conditions pratiques',
    followLead: 'suivre les réservations, confirmations, modifications et annulations',
    surveyLead: 'connaître la date, les disponibilités et les préférences de réservation',
    seasonal: 'campagne pour valoriser les créneaux et disponibilités de la saison',
    loyalty: 'avantage réservé aux utilisateurs réguliers et prestataires partenaires',
    maintenance: 'un rappel utile avant un rendez-vous ou pour compléter une réservation',
    localHook: 'des disponibilités accessibles et réservables simplement',
    audience: 'clients souhaitant réserver facilement et prestataires voulant remplir leur planning',
  },
};
