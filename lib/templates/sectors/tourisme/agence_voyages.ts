import type { JobTemplateDefinition } from '../shared';

export const agence_voyagesJobTemplates: JobTemplateDefinition = {
  sector: 'tourisme',
  professionKey: 'agence_voyages',
  professionLabel: 'Agence de voyages',
  pack: {
    label: 'Agence de voyages',
    signature: 'conseiller les voyageurs et préparer des séjours adaptés à leurs attentes et aux conditions confirmées',
    promoLead: 'présenter un séjour, un circuit ou une possibilité de départ avec ses disponibilités et conditions vérifiées',
    infoLead: 'partager des conseils de préparation, les étapes de réservation et les informations pratiques du séjour',
    followLead: 'suivre les demandes de voyage, les devis et les réservations des voyageurs',
    surveyLead: 'comprendre la destination, les dates, le budget et les attentes des voyageurs',
    seasonal: 'idée de séjour ou départ de saison, sous réserve des disponibilités réellement confirmées',
    loyalty: 'nouvelle idée de séjour adaptée aux voyageurs déjà accompagnés par l’agence',
    maintenance: 'un rappel utile pour préparer un départ ou vérifier une réservation en cours',
    localHook: 'conseil en voyages et préparation de séjours',
    audience: 'voyageurs individuels, familles, groupes et clients professionnels',
  },
};
