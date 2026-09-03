import type { JobTemplateDefinition } from '../shared';

export const annuaire_comparateurJobTemplates: JobTemplateDefinition = {
  sector: 'plateformes_numeriques',
  professionKey: 'annuaire_comparateur',
  professionLabel: 'Annuaire / comparateur en ligne',
  pack: {
    label: 'Annuaire / comparateur en ligne',
    signature: 'aider les utilisateurs à repérer et comparer les solutions qui correspondent vraiment à leurs critères',
    promoLead: 'inviter à lancer une recherche, comparer des profils ou référencer une activité',
    infoLead: 'expliquer les critères de comparaison et valoriser la qualité des fiches professionnelles',
    followLead: 'suivre les recherches, demandes de contact et mises à jour des fiches',
    surveyLead: 'comprendre les critères, la zone et le niveau de service recherchés',
    seasonal: 'sélection thématique de professionnels ou de solutions à comparer',
    loyalty: 'avantage réservé aux utilisateurs et professionnels référencés',
    maintenance: 'un rappel utile pour mettre à jour une fiche ou reprendre une comparaison',
    localHook: 'une recherche claire pour trouver la solution la plus pertinente',
    audience: 'utilisateurs souhaitant comparer et professionnels désirant gagner en visibilité',
  },
};
