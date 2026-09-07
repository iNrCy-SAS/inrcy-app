import type { JobTemplateDefinition } from '../shared';

export const structure_insertion_siaeJobTemplates: JobTemplateDefinition = {
  sector: 'economie_sociale_solidaire',
  professionKey: 'structure_insertion_siae',
  professionLabel: 'Structure d’insertion / SIAE',
  pack: {
    label: 'Structure d’insertion / SIAE',
    signature: 'mettre en valeur les compétences, les parcours et le retour durable vers l’emploi sans réduire les personnes à leurs difficultés',
    promoLead: 'présenter une prestation, un recrutement en insertion, une formation ou un partenariat employeur',
    infoLead: 'partager les parcours, métiers, résultats et besoins de la structure d’insertion',
    followLead: 'suivre les candidatures, parcours socioprofessionnels, missions, formations et partenariats employeurs',
    surveyLead: 'identifier les besoins des personnes accompagnées et des employeurs du territoire',
    seasonal: 'campagne de recrutement, de mise en activité ou de mobilisation des entreprises partenaires',
    loyalty: 'remerciement destiné aux salariés, clients, prescripteurs et employeurs partenaires',
    maintenance: 'rappel pour un point de parcours, une candidature, une mission ou un échange avec un employeur',
    localHook: 'des activités utiles qui deviennent des tremplins vers l’emploi sur le territoire',
    audience: 'personnes en parcours d’insertion, prescripteurs, employeurs, clients, collectivités et partenaires sociaux',
  },
};
