import type { JobTemplateDefinition } from '../shared';

export const fondation_fonds_dotationJobTemplates: JobTemplateDefinition = {
  sector: 'economie_sociale_solidaire',
  professionKey: 'fondation_fonds_dotation',
  professionLabel: 'Fondation / fonds de dotation',
  pack: {
    label: 'Fondation / fonds de dotation',
    signature: 'relier chaque soutien à une cause, à des actions vérifiables et à des résultats présentés avec transparence',
    promoLead: 'mobiliser autour d’une cause, d’un appel à projets, d’un don ou d’un partenariat de mécénat',
    infoLead: 'présenter les projets soutenus, les résultats obtenus et l’utilisation concrète des ressources',
    followLead: 'suivre les donateurs, candidatures, projets financés, conventions et partenariats',
    surveyLead: 'recueillir les besoins des porteurs de projets, bénéficiaires, donateurs et mécènes',
    seasonal: 'campagne de générosité ou appel à projets lié à un enjeu prioritaire',
    loyalty: 'remerciement personnalisé pour les donateurs, mécènes et partenaires durables',
    maintenance: 'rappel pour déposer un dossier, transmettre un bilan ou renouveler un soutien',
    localHook: 'des ressources mobilisées avec transparence pour produire un impact durable',
    audience: 'donateurs, mécènes, associations, porteurs de projets, bénéficiaires et partenaires institutionnels',
  },
};
