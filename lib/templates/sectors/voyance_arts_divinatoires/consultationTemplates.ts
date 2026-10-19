import type { TemplateAction, TemplateDef } from '@/lib/messageTemplates';
import { createJobTemplates, createSectorTemplates, type JobTemplateDefinition, type SectorPack, type SectorTemplateDefinition } from '../shared';

type Angle = readonly [title: string, description: string];
// The shared registry supplies canonical keys and ranking metadata. The copy
// here describes consultations rather than importing its result/urgency claims.
const ANGLES: Record<TemplateAction, Record<string, Angle>> = {
  valoriser: {
    realisation: ['Un aperçu de consultation', 'Voici comment se déroule un échange : [étapes de consultation effectivement proposées].'],
    savoir_faire: ['Notre méthode de consultation', 'Prenons le temps de présenter notre approche, les supports utilisés et la place des questions pendant l’échange.'],
    pourquoi_nous: ['Le cadre de notre échange', 'Avant de choisir une consultation, vous pouvez demander des précisions sur la méthode, la durée et les modalités pratiques.'],
    cas_client: ['Un exemple de question abordée', 'Voici un exemple de question et de déroulement : [exemple présenté avec accord ou clairement annoncé comme illustration].'],
    preuve_locale: ['Où et comment nous consulter', 'Retrouvez les lieux ou formats de consultation effectivement proposés sur {{zones}} ou à distance.'],
    coulisses: ['La préparation d’un échange', 'Découvrons la manière de préparer une consultation : [préparation et supports réellement utilisés].'],
    faq_rassurante: ['Les questions avant une consultation', 'Quel format choisir ? Combien de temps dure l’échange ? Quelles questions et quels éléments préparer ?'],
    engagements: ['Des modalités expliquées à l’avance', 'Notre cadre de consultation précise la méthode, le tarif, la durée et les possibilités de poser des questions avant de réserver.'],
  },
  avis: {
    apres_prestation: ['Votre avis sur le déroulement', 'Merci pour votre confiance. Votre retour sur l’accueil, les explications et l’organisation de l’échange nous est utile.'],
    experience_client: ['Comment avez-vous vécu l’échange ?', 'La méthode et le cadre de consultation vous ont-ils été expliqués de façon claire ?'],
    preuve_locale: ['Un retour pour ceux qui nous découvrent', 'Votre expérience du déroulement peut aider d’autres personnes à comprendre les modalités de nos consultations.'],
    recommandation: ['Partager votre propre expérience', 'Si vous le souhaitez, racontez ce que vous avez apprécié dans l’accueil, les explications ou le format de l’échange.'],
  },
  offres: {
    decouverte: ['Découvrir une consultation', 'Voici une présentation de la consultation proposée et de ses modalités.'],
    saison: ['Un temps de réflexion à cette période', 'Si vous souhaitez prendre un temps d’échange à cette période, voici les formats proposés.'],
    flash: ['Une proposition ponctuelle', 'Voici une proposition ponctuelle, selon la période et les conditions indiquées ci-dessous.'],
    fidelite: ['Les modalités pour reprendre contact', 'Si vous choisissez de reprendre contact, voici les conditions actuelles de consultation.'],
    nouveau_client: ['Une première consultation', 'Pour un premier échange, vous pouvez commencer par demander des informations sur le déroulement.'],
    pack: ['Le contenu de la consultation', 'Précisons le contenu proposé, la durée et les modalités de l’échange avant toute réservation.'],
    disponibilite: ['Disponibilités de consultation', 'Voici les disponibilités confirmées pour les personnes souhaitant réserver une consultation.'],
    lancement: ['Un format de consultation à découvrir', 'Nous présentons un format proposé : [format effectivement disponible et contenu à préciser].'],
    urgent: ['Vos questions avant de réserver', 'Vous avez une question pratique sur le format, le tarif ou l’organisation ? Vous pouvez nous la transmettre avant de décider.'],
    reactivation: ['Reprendre contact à votre initiative', 'Si vous souhaitez un nouvel échange, nous pouvons vous préciser les formats et les conditions actuellement proposés.'],
  },
  informations: {
    nouveaute: ['Un support ou un format à découvrir', 'Voici un support ou un format de consultation effectivement proposé : [description à renseigner].'],
    infos_pratiques: ['Préparer sa consultation', 'Retrouvez les informations pratiques utiles avant l’échange et les éléments à préparer selon la méthode annoncée.'],
    actualite: ['Nos actualités de consultation', 'Voici une actualité réelle de notre activité : [actualité à préciser].'],
    partenariat: ['Une rencontre ou un événement', 'Voici une rencontre, un partenaire ou un événement confirmé : [rôle, lieu et modalités à préciser].'],
    local: ['Où nous retrouver', 'Voici les coordonnées de contact, les lieux ou les formats à distance proposés : [informations à confirmer].'],
    disponibilites: ['Les prochaines disponibilités', 'Voici les horaires et formats actuellement disponibles, sous réserve de confirmation lors de votre demande.'],
  },
  suivis: {
    merci: ['Merci pour notre échange', 'Merci d’avoir pris le temps de cet échange. Vous pouvez nous signaler une question sur les explications ou le déroulement.'],
    prise_nouvelles: ['Une question après la consultation ?', 'Si vous souhaitez une précision sur le cadre ou les explications déjà abordées, vous pouvez nous écrire.'],
    rappel: ['Le rappel de votre consultation', 'Voici un rappel pratique lié à la consultation déjà convenue avec vous.'],
    relance_devis: ['Votre demande d’information', 'Avez-vous trouvé les précisions demandées sur le contenu, la durée et le tarif ? Vous pouvez nous poser une question avant de donner suite.'],
    fidelite: ['Vos modalités de consultation', 'À votre demande, voici les informations actuelles pour reprendre contact et choisir un format d’échange.'],
    apres_vente: ['Une précision sur le déroulement', 'Une question sur l’organisation ou les explications partagées ? Indiquez simplement le point que vous souhaitez clarifier.'],
    reprise_contact: ['À votre demande, reprenons contact', 'Vous nous avez demandé des informations sur une consultation. Voici les modalités que nous pouvons préciser ensemble.'],
    controle: ['Vérifier les modalités convenues', 'Vérifions la date, l’heure, le format et les éléments utiles à la consultation que vous avez choisie.'],
    renouvellement: ['Choisir librement un nouvel échange', 'Si vous souhaitez un nouvel échange de votre propre initiative, vous pouvez demander les conditions actuelles.'],
    saisonnier: ['Un échange pour une période choisie', 'Vous souhaitez des informations pour une période particulière ? Précisons les formats et disponibilités annoncés.'],
  },
  enquetes: {
    satisfaction: ['Votre retour sur la consultation', 'Qu’avez-vous apprécié dans l’accueil et les explications ? Quel point du déroulement pourrait être plus clair ?'],
    besoins: ['Les informations qui vous seraient utiles', 'Sur quelle méthode ou quel format de consultation aimeriez-vous recevoir davantage d’explications ?'],
    recommandation: ['Ce qui aide à comprendre notre démarche', 'Quelles informations vous sembleraient utiles pour présenter notre démarche à quelqu’un qui la découvre ?'],
    attentes: ['Vos attentes sur le cadre de l’échange', 'Qu’est-ce qui compte le plus pour vous : la présentation de la méthode, le temps de questions, le format ou les informations pratiques ?'],
    nouveau_service: ['Votre avis sur un format de consultation', 'Un autre format d’explication ou d’échange vous intéresserait-il ? Vous pouvez préciser ce qui vous serait utile.'],
    experience: ['Votre expérience du déroulement', 'Qu’est-ce qui a facilité la préparation et la compréhension de la consultation ? Quelle étape pourrait être plus simple ?'],
    localite: ['Vos préférences de format', 'Préférez-vous un échange en cabinet, par téléphone ou en visioconférence lorsque ces modalités sont proposées ?'],
    priorites: ['Les précisions que vous recherchez', 'Quelle information aimeriez-vous connaître en premier : la méthode, le contenu, la durée, le tarif ou les disponibilités ?'],
    offre_idee: ['Un contenu à construire avec vos retours', 'Quel contenu de présentation de notre méthode ou de nos consultations aimeriez-vous découvrir ?'],
    canal: ['Vos préférences de contact', 'Préférez-vous recevoir les informations pratiques par email, par téléphone ou uniquement à votre demande ?'],
  },
};

function bodyFor(action: TemplateAction, slug: string, description: string, pack: SectorPack): string {
  const opening = `Bonjour,\n\n${description}\n\n`;
  const contact = '\n\nPour demander une précision : {{cta_url}}';
  switch (action) {
    case 'valoriser': return opening + `Dans notre activité ${pack.label.toLowerCase()}, nous souhaitons ${pack.signature}.\n\n` +
      `Notre cadre : ${pack.localHook}.\nÀ qui s’adresse la présentation : ${pack.audience}.\n\n` +
      'Méthodes et formats proposés : {{services}}.\nLes modalités pratiques sont expliquées avant la réservation.' + contact;
    case 'avis': return opening + `Vous avez découvert notre activité ${pack.label.toLowerCase()}.\n\n` +
      'Votre avis peut porter sur la clarté des informations, le respect des modalités convenues et votre propre expérience de l’échange.\n\n' +
      'Partager votre retour, si vous le souhaitez : {{avis_url}}';
    case 'offres': return opening + `À découvrir : ${pack.promoLead}.\n\n` +
      '• Contenu et méthode : [à préciser]\n• Durée de consultation : [à préciser]\n• Tarif et conditions : [à préciser]\n• Format et disponibilités confirmées : [à préciser]\n\n' +
      (slug === 'saison' ? `${pack.seasonal}.\n` : slug === 'fidelite' ? `${pack.loyalty}.\n` : '') +
      'Pour poser une question ou demander une réservation : {{cta_url}}';
    case 'informations': return opening + `Notre activité ${pack.label.toLowerCase()} permet de ${pack.infoLead}.\n\n` +
      '• Sujet ou méthode : [à préciser]\n• Déroulement : [à préciser]\n• Modalités pratiques : [informations confirmées]\n\n' +
      'Consulter les détails ou nous poser une question : {{cta_url}}';
    case 'suivis': return opening + `Nous restons disponibles pour ${pack.followLead}.\n\n` +
      (slug === 'fidelite' ? `${pack.loyalty}.` : slug === 'saisonnier' ? `${pack.seasonal}.` : `${pack.maintenance}.`) + contact;
    case 'enquetes': return opening + `Dans notre activité ${pack.label.toLowerCase()}, nous souhaitons ${pack.surveyLead}.\n\n` +
      'Vos préférences sur la méthode ou l’organisation suffisent ; quelques mots en réponse à ce message nous seront utiles. Merci pour votre retour.';
  }
}

function adaptConsultationTemplates(templates: TemplateDef[], pack: SectorPack): TemplateDef[] {
  return templates.map((template) => {
    const prefix = `${template.module}_${template.action}_${template.sectorCategory}${template.professionKey ? `_${template.professionKey}` : ''}_`;
    const slug = template.key.slice(prefix.length);
    const angle = ANGLES[template.action][slug];
    if (!angle) throw new Error(`divination_template_variant_missing:${template.action}:${slug}`);
    const [title, description] = angle;
    return { ...template, title, subject: `${title} — {{nom_entreprise}}`, body: bodyFor(template.action, slug, description, pack),
      ctaLabel: template.action === 'avis' ? 'Partager mon avis' : template.action === 'enquetes' ? 'Partager mes préférences'
        : template.action === 'offres' ? 'Voir les modalités de consultation' : 'Poser une question',
    };
  });
}

export function createVoyanceJobTemplates(definition: JobTemplateDefinition): TemplateDef[] {
  return adaptConsultationTemplates(createJobTemplates(definition), definition.pack);
}

export function createVoyanceSectorTemplates(definition: SectorTemplateDefinition): TemplateDef[] {
  return adaptConsultationTemplates(createSectorTemplates(definition), definition.pack);
}
