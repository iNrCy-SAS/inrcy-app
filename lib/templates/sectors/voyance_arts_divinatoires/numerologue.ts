import type { JobTemplateDefinition } from '../shared';

export const numerologueJobTemplates: JobTemplateDefinition = {
  sector: 'voyance_arts_divinatoires', professionKey: 'numerologue', professionLabel: 'Numérologue',
  pack: {
    label: 'Numérologue',
    signature: 'présenter une interprétation symbolique des nombres et expliquer les conventions utilisées pendant la consultation',
    promoLead: 'décrire une étude de numérologie, son contenu, sa durée et les conditions tarifaires annoncées',
    infoLead: 'expliquer les nombres et cycles symboliques abordés ainsi que les éléments utiles à la préparation de l’étude',
    followLead: 'répondre aux questions sur l’étude numérologique et confirmer les modalités d’un échange convenu',
    surveyLead: 'recueillir les préférences sur le contenu de l’étude, le niveau d’explication et le format de restitution',
    seasonal: 'présentation d’une étude numérologique symbolique à l’occasion d’une période choisie par la personne',
    loyalty: 'remerciement aux personnes qui choisissent de reprendre un échange sur les explications de leur étude',
    maintenance: 'rappel d’une restitution prévue et des éléments nécessaires à l’étude selon le cadre annoncé',
    localHook: 'une étude numérologique dont les conventions et le déroulement sont expliqués avant l’échange',
    audience: 'adultes souhaitant découvrir la numérologie comme grille de lecture symbolique',
  },
};
