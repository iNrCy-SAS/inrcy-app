import type { JobTemplateDefinition } from '../shared';

export const astrologueJobTemplates: JobTemplateDefinition = {
  sector: 'voyance_arts_divinatoires', professionKey: 'astrologue', professionLabel: 'Astrologue',
  pack: {
    label: 'Astrologue',
    signature: 'présenter une lecture symbolique du thème astrologique et les éléments qui structurent cette interprétation',
    promoLead: 'décrire une lecture de thème astrologique, son périmètre, sa durée et son tarif',
    infoLead: 'expliquer les notions astrologiques abordées, le déroulement d’une lecture et les éléments utiles à sa préparation',
    followLead: 'suivre les demandes de lecture astrologique et confirmer le périmètre et les modalités d’une consultation convenue',
    surveyLead: 'connaître les sujets symboliques, niveaux d’explication et formats de lecture astrologique recherchés',
    seasonal: 'présentation d’une lecture astrologique symbolique pour un anniversaire ou un temps de réflexion choisi',
    loyalty: 'remerciement aux personnes qui souhaitent reprendre un échange sur leur lecture astrologique',
    maintenance: 'rappel d’une lecture déjà prévue et des seuls éléments nécessaires à la préparation annoncée',
    localHook: 'un interlocuteur qui rend accessible sa méthode de lecture astrologique en cabinet ou à distance',
    audience: 'adultes souhaitant comprendre une interprétation symbolique de leur thème astrologique',
  },
};
