import type { JobTemplateDefinition } from '../shared';

export const formateurJobTemplates: JobTemplateDefinition = {
  sector: 'formation_enseignement',
  professionKey: 'formateur',
  professionLabel: 'Formateur',
  pack: {
    label: 'Formateur',
    signature: 'accompagner l’acquisition de compétences avec des objectifs clairs, des exercices adaptés et une évaluation des acquis',
    promoLead: 'présenter les formations individuelles, en groupe, en entreprise ou à distance et les ateliers pratiques réellement proposés',
    infoLead: 'expliquer les objectifs, le contenu, les prérequis, les modalités pédagogiques et l’évaluation des acquis',
    followLead: 'suivre les demandes de programme sur mesure, les inscriptions, la progression et les questions des apprenants',
    surveyLead: 'comprendre les compétences recherchées, le niveau de départ, les disponibilités et les préférences de format des apprenants',
    seasonal: 'session ou atelier pratique adapté aux objectifs de formation et aux disponibilités des apprenants',
    loyalty: 'accompagnement complémentaire pour poursuivre un parcours de formation selon les besoins exprimés',
    maintenance: 'un rappel utile pour préparer une session, retrouver les supports ou organiser le suivi des apprenants',
    localHook: 'formation et développement des compétences, en présence ou à distance selon les modalités proposées',
    audience: 'personnes, groupes et entreprises souhaitant développer leurs compétences avec un formateur',
  },
};
