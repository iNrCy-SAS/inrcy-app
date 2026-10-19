import type { JobTemplateDefinition } from '../shared';

export const cartomancienJobTemplates: JobTemplateDefinition = {
  sector: 'voyance_arts_divinatoires', professionKey: 'cartomancien', professionLabel: 'Cartomancien / Cartomancienne',
  pack: {
    label: 'Cartomancien / Cartomancienne',
    signature: 'présenter la lecture symbolique des cartes, les jeux utilisés et la manière de conduire un échange autour d’un tirage',
    promoLead: 'décrire une consultation de cartomancie avec le jeu de cartes utilisé, la durée et les conditions tarifaires',
    infoLead: 'expliquer les supports de cartomancie, les dispositions de cartes et les questions préparatoires',
    followLead: 'suivre les demandes sur les jeux et tirages proposés et confirmer les modalités d’une consultation réservée',
    surveyLead: 'recueillir les préférences de jeux de cartes, de formats de tirage et d’explications pendant la consultation',
    seasonal: 'découverte d’un jeu de cartes ou d’un format de tirage symbolique pour une période de l’année',
    loyalty: 'remerciement aux personnes qui reprennent contact pour des informations sur les tirages de cartes',
    maintenance: 'rappel pratique d’un tirage déjà réservé et des modalités de participation convenues',
    localHook: 'une pratique de cartomancie dont les supports et le déroulement sont présentés avant la consultation',
    audience: 'adultes souhaitant découvrir une lecture de cartes et poser leurs questions dans un cadre expliqué',
  },
};
