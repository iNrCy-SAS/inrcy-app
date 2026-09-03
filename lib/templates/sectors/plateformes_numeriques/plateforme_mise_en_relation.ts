import type { JobTemplateDefinition } from '../shared';

export const plateforme_mise_en_relationJobTemplates: JobTemplateDefinition = {
  sector: 'plateformes_numeriques',
  professionKey: 'plateforme_mise_en_relation',
  professionLabel: 'Plateforme de mise en relation',
  pack: {
    label: 'Plateforme de mise en relation',
    signature: 'mettre en contact les bonnes personnes autour d’un besoin clairement identifié',
    promoLead: 'inviter les utilisateurs à déposer leur besoin ou à créer leur profil',
    infoLead: 'expliquer le fonctionnement, la sélection des profils et les étapes de mise en relation',
    followLead: 'suivre les demandes, réponses, rendez-vous et mises en relation engagées',
    surveyLead: 'préciser le besoin, les critères de recherche et les attentes de chaque utilisateur',
    seasonal: 'campagne thématique pour susciter de nouvelles demandes et inscriptions',
    loyalty: 'avantage réservé aux utilisateurs et partenaires réguliers',
    maintenance: 'un rappel utile pour compléter un profil ou répondre à une demande reçue',
    localHook: 'une mise en relation simple, ciblée et rassurante',
    audience: 'personnes et professionnels souhaitant trouver rapidement le bon interlocuteur',
  },
};
