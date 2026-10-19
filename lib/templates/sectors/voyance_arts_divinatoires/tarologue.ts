import type { JobTemplateDefinition } from '../shared';

export const tarologueJobTemplates: JobTemplateDefinition = {
  sector: 'voyance_arts_divinatoires', professionKey: 'tarologue', professionLabel: 'Tarologue',
  pack: {
    label: 'Tarologue',
    signature: 'présenter la lecture symbolique du tarot et la façon dont un tirage ouvre des pistes de réflexion sur les questions abordées',
    promoLead: 'décrire une consultation de tarot, le type de tirage, la durée et le tarif annoncé',
    infoLead: 'expliquer les arcanes, les formats de tirage et la préparation d’une question pour une lecture de tarot',
    followLead: 'répondre aux demandes sur un tirage de tarot et confirmer les consultations choisies par les personnes',
    surveyLead: 'connaître les préférences de format de tirage, d’explications symboliques et d’organisation de la consultation',
    seasonal: 'présentation d’un tirage symbolique ou d’une découverte du tarot pour un temps fort de l’année',
    loyalty: 'remerciement aux personnes qui souhaitent de nouvelles informations sur les lectures de tarot',
    maintenance: 'rappel d’un tirage déjà convenu et des questions préparatoires choisies par la personne',
    localHook: 'une lecture de tarot expliquée, en cabinet ou à distance selon les formats proposés',
    audience: 'adultes souhaitant découvrir le tarot comme support de réflexion et comprendre le déroulement d’un tirage',
  },
};
