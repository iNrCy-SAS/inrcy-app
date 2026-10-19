import type { JobTemplateDefinition } from '../shared';

export const fabricant_cosmetiquesJobTemplates: JobTemplateDefinition = {
  sector: 'beaute_bien_etre', professionKey: 'fabricant_cosmetiques', professionLabel: 'Fabricant de cosmétiques',
  pack: {
    label: 'Fabricant de cosmétiques',
    signature: 'qualifier un projet de fabrication cosmétique avec un cahier des charges, des volumes et des étapes validés',
    promoLead: 'présenter les possibilités de fabrication et de conditionnement réellement proposées, sous réserve d’étude du projet',
    infoLead: 'expliquer les étapes de fabrication, les éléments techniques attendus et les documents disponibles pour un projet donné',
    followLead: 'suivre les demandes de fabrication, devis, validations d’échantillons et jalons de production convenus',
    surveyLead: 'préciser le type de produit, les quantités envisagées, le conditionnement et le calendrier du donneur d’ordre',
    seasonal: 'préparation d’un lancement cosmétique selon les volumes, approvisionnements et délais confirmés',
    loyalty: 'revue des conditions de fabrication des projets récurrents avec les marques et donneurs d’ordre partenaires',
    maintenance: 'point de validation avant une nouvelle série ou une évolution du cahier des charges de fabrication',
    localHook: 'un interlocuteur de fabrication cosmétique pour cadrer un projet professionnel et ses contraintes',
    audience: 'marques et donneurs d’ordre recherchant un fabricant de cosmétiques pour un projet B2B',
  },
};
