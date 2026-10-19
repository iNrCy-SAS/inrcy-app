import type { JobTemplateDefinition } from '../shared';

export const chiromancienJobTemplates: JobTemplateDefinition = {
  sector: 'voyance_arts_divinatoires', professionKey: 'chiromancien', professionLabel: 'Chiromancien / Chiromancienne',
  pack: {
    label: 'Chiromancien / Chiromancienne',
    signature: 'présenter la chiromancie comme une lecture symbolique des lignes de la main et expliquer les repères utilisés',
    promoLead: 'décrire une lecture symbolique de la main, son déroulement, sa durée et son tarif',
    infoLead: 'expliquer les repères symboliques observés sur la main et les modalités de présentation de la consultation',
    followLead: 'répondre aux questions sur la chiromancie et confirmer les conditions d’une lecture déjà convenue',
    surveyLead: 'comprendre les attentes sur les explications, le format et le déroulement d’une lecture symbolique de la main',
    seasonal: 'découverte des repères de la chiromancie à l’occasion d’un temps d’échange choisi',
    loyalty: 'remerciement aux personnes qui demandent des précisions sur les explications symboliques déjà abordées',
    maintenance: 'rappel pratique d’une lecture prévue et de ses modalités de réalisation annoncées',
    localHook: 'une consultation de chiromancie dont la méthode de lecture symbolique est expliquée à la personne',
    audience: 'adultes souhaitant découvrir les repères et le déroulement d’une lecture symbolique de la main',
  },
};
