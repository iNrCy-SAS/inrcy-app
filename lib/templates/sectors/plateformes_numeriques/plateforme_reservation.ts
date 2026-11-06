import type { JobTemplateDefinition } from '../shared';

export const plateforme_reservationJobTemplates: JobTemplateDefinition = {
  sector: 'plateformes_numeriques',
  professionKey: 'plateforme_reservation',
  professionLabel: 'Plateforme de réservation',
  pack: {
    label: 'Plateforme de réservation',
    signature: 'faciliter la réservation de créneaux, prestations, séjours ou billets réellement proposés par la plateforme',
    promoLead: 'présenter les offres réservables et leurs disponibilités confirmées selon l’activité de la plateforme',
    infoLead: 'expliquer les confirmations, rappels et conditions de réservation des prestations, séjours ou billets proposés',
    followLead: 'suivre les demandes, confirmations, modifications et annulations des réservations concernées',
    surveyLead: 'préciser l’offre recherchée, les dates, les disponibilités et les besoins des participants',
    seasonal: 'mise en avant des offres et disponibilités de saison réellement ouvertes à la réservation',
    loyalty: 'nouvelle réservation ou offre adaptée aux utilisateurs réguliers selon les prestations disponibles',
    maintenance: 'un rappel utile avant le rendez-vous, la prestation, le séjour ou l’entrée prévue, selon la réservation',
    localHook: 'recherche de disponibilités et réservation en ligne des offres effectivement proposées',
    audience: 'utilisateurs réservant des créneaux, prestations, séjours ou billets et partenaires proposant ces offres',
  },
};
