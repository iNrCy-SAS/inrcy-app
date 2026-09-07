import type { JobTemplateDefinition } from '../shared';

export const association_interet_generalJobTemplates: JobTemplateDefinition = {
  sector: 'economie_sociale_solidaire',
  professionKey: 'association_interet_general',
  professionLabel: 'Association / organisme d’intérêt général',
  pack: {
    label: 'Association / organisme d’intérêt général',
    signature: 'expliquer clairement la mission de l’association, montrer son impact et donner à chacun une façon simple d’agir',
    promoLead: 'mobiliser autour d’une action, d’une adhésion, d’un appel aux bénévoles ou d’une collecte',
    infoLead: 'partager une actualité associative, un résultat de terrain ou une information destinée aux bénéficiaires',
    followLead: 'suivre les adhésions, bénévoles, bénéficiaires, dons et partenariats',
    surveyLead: 'recueillir les besoins des bénéficiaires, adhérents, bénévoles et habitants',
    seasonal: 'campagne associative liée à un temps fort, une cause ou un besoin du territoire',
    loyalty: 'remerciement adressé aux adhérents, bénévoles, donateurs et soutiens fidèles',
    maintenance: 'rappel pour renouveler une adhésion, confirmer une participation ou poursuivre un accompagnement',
    localHook: 'une association ancrée dans son territoire et proche des personnes qu’elle accompagne',
    audience: 'bénéficiaires, adhérents, bénévoles, donateurs, partenaires et habitants concernés par la mission',
  },
};
