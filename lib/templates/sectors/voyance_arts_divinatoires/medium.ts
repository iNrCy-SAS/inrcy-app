import type { JobTemplateDefinition } from '../shared';

export const mediumJobTemplates: JobTemplateDefinition = {
  sector: 'voyance_arts_divinatoires', professionKey: 'medium', professionLabel: 'Médium',
  pack: {
    label: 'Médium',
    signature: 'présenter un échange de médiumnité et la façon dont le praticien décrit ses ressentis, dans un cadre de consultation expliqué',
    promoLead: 'décrire un échange avec un médium, sa durée, son tarif et ses modalités de réservation',
    infoLead: 'expliquer l’approche du médium, la place des ressentis dans son discours et le déroulement annoncé de la consultation',
    followLead: 'répondre aux questions sur une consultation de médiumnité et confirmer les modalités déjà convenues',
    surveyLead: 'comprendre les attentes sur le cadre de l’échange, les explications de méthode et le format de consultation',
    seasonal: 'information sur les formats et disponibilités de consultation de médiumnité à cette période',
    loyalty: 'remerciement aux personnes qui reprennent contact de leur propre initiative et rappel des modalités en vigueur',
    maintenance: 'rappel d’un échange déjà convenu ou réponse aux questions pratiques demandées par la personne',
    localHook: 'un interlocuteur qui explique sa pratique de médiumnité avant une consultation en cabinet ou à distance',
    audience: 'adultes souhaitant découvrir la pratique d’un médium et le cadre proposé pour l’échange',
  },
};
