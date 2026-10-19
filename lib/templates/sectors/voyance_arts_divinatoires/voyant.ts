import type { JobTemplateDefinition } from '../shared';

export const voyantJobTemplates: JobTemplateDefinition = {
  sector: 'voyance_arts_divinatoires', professionKey: 'voyant', professionLabel: 'Voyant / Voyante',
  pack: {
    label: 'Voyant / Voyante',
    signature: 'présenter une consultation de voyance comme un échange autour des questions de la personne et de l’approche du praticien',
    promoLead: 'décrire une consultation de voyance, sa durée, son tarif et le format proposé',
    infoLead: 'expliquer la préparation des questions, le déroulement de l’échange et les supports éventuellement utilisés',
    followLead: 'suivre les demandes d’information et confirmer les modalités d’une consultation de voyance convenue',
    surveyLead: 'recueillir les préférences de format, de durée et de préparation des questions avant une consultation de voyance',
    seasonal: 'présentation d’un temps de réflexion personnel et des modalités de consultation à cette période',
    loyalty: 'remerciement aux personnes qui choisissent de reprendre contact, avec les conditions actuelles de consultation',
    maintenance: 'rappel pratique d’un échange déjà réservé et des questions que la personne souhaite préparer',
    localHook: 'une consultation de voyance en cabinet ou à distance selon les formats effectivement proposés',
    audience: 'adultes souhaitant comprendre l’approche d’un voyant et préparer leurs questions',
  },
};
