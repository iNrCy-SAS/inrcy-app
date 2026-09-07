import type { JobTemplateDefinition } from '../shared';

export const ressourcerie_recyclerieJobTemplates: JobTemplateDefinition = {
  sector: 'economie_sociale_solidaire',
  professionKey: 'ressourcerie_recyclerie',
  professionLabel: 'Ressourcerie / recyclerie',
  pack: {
    label: 'Ressourcerie / recyclerie',
    signature: 'donner une seconde vie aux objets, réduire les déchets et créer de la valeur sociale à l’échelle locale',
    promoLead: 'annoncer une collecte, une vente solidaire, un atelier de réparation ou une opération de réemploi',
    infoLead: 'partager les consignes de don, résultats de réemploi, horaires, nouveautés et conseils anti-gaspillage',
    followLead: 'suivre les dons, collectes, ateliers, ventes, partenariats et parcours d’insertion',
    surveyLead: 'identifier les besoins des habitants et les objets, ateliers ou services les plus utiles',
    seasonal: 'collecte ou vente thématique pour éviter le gaspillage et soutenir le réemploi',
    loyalty: 'attention destinée aux donateurs, bénévoles, clients solidaires et partenaires réguliers',
    maintenance: 'rappel pour une collecte, un retrait, un atelier ou un nouvel apport d’objets',
    localHook: 'un circuit local où chaque don réduit les déchets et soutient l’emploi solidaire',
    audience: 'habitants, donateurs, clients solidaires, bénévoles, collectivités et entreprises partenaires',
  },
};
