import type { JobTemplateDefinition } from '../shared';

export const mandataire_immobilierJobTemplates: JobTemplateDefinition = {
  sector: 'immobilier',
  professionKey: 'mandataire_immobilier',
  professionLabel: 'Mandataire immobilier',
  pack: {
    label: 'Mandataire immobilier',
    signature: 'accompagner vendeurs et acquéreurs avec proximité, clarté et suivi à chaque étape de leur projet immobilier',
    promoLead: 'présenter un bien disponible, proposer une estimation ou organiser une visite selon les prestations du mandataire',
    infoLead: 'partager des conseils sur la préparation d’une vente, la recherche d’un bien et les étapes d’une transaction immobilière',
    followLead: 'suivre une estimation, une recherche de bien, une visite ou une offre avec le vendeur ou l’acquéreur',
    surveyLead: 'comprendre le secteur recherché, le type de bien, le budget et le calendrier du projet des vendeurs et acquéreurs',
    seasonal: 'faire le point sur un projet d’achat ou de vente et préparer les prochaines visites',
    loyalty: 'remercier les clients pour leur confiance et accompagner leurs prochains projets immobiliers',
    maintenance: 'reprendre contact pour actualiser les critères de recherche ou faire le point sur la commercialisation du bien',
    localHook: 'accompagnement immobilier de proximité',
    audience: 'propriétaires vendeurs et acquéreurs recherchant un accompagnement immobilier local',
  },
};
