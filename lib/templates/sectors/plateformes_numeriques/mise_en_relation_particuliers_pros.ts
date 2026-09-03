import type { JobTemplateDefinition } from '../shared';

export const mise_en_relation_particuliers_prosJobTemplates: JobTemplateDefinition = {
  sector: 'plateformes_numeriques',
  professionKey: 'mise_en_relation_particuliers_pros',
  professionLabel: 'Plateforme particuliers / professionnels',
  pack: {
    label: 'Plateforme particuliers / professionnels',
    signature: 'aider chaque particulier à trouver un professionnel adapté à son besoin',
    promoLead: 'inviter à déposer une demande, demander un devis ou prendre rendez-vous',
    infoLead: 'expliquer comment trouver, comparer et contacter les professionnels présents',
    followLead: 'suivre les besoins déposés, devis reçus et rendez-vous avec les professionnels',
    surveyLead: 'comprendre le besoin, la localisation, le délai et les critères de choix du particulier',
    seasonal: 'campagne locale pour stimuler les demandes et valoriser les professionnels disponibles',
    loyalty: 'avantage réservé aux utilisateurs réguliers et aux professionnels partenaires',
    maintenance: 'un rappel utile pour finaliser une demande ou répondre à un nouveau contact',
    localHook: 'des professionnels accessibles pour répondre aux besoins du quotidien',
    audience: 'particuliers en recherche d’un professionnel et professionnels souhaitant recevoir des contacts',
  },
};
