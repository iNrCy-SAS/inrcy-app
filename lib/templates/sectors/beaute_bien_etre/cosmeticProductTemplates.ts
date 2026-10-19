import type { TemplateAction, TemplateDef } from '@/lib/messageTemplates';
import { createJobTemplates, type JobTemplateDefinition, type SectorPack } from '../shared';

type Angle = readonly [title: string, description: string];
// Keep the canonical variant keys and intelligent metadata, while replacing
// the service/appointment copy only for these product professions.
const ANGLES: Record<TemplateAction, Record<string, Angle>> = {
  valoriser: {
    realisation: ['Une référence en détail', 'Présentons une référence ou un projet précis, avec ses caractéristiques effectivement documentées.'],
    savoir_faire: ['Notre approche des produits', 'Voici comment nous aidons à comparer les choix et à comprendre les informations disponibles.'],
    pourquoi_nous: ['Pourquoi nous choisir', 'Un choix éclairé commence par des informations concrètes et un interlocuteur identifiable.'],
    cas_client: ['Un besoin et une réponse concrète', 'Partons d’un besoin réel : [besoin partagé avec accord]. Voici la réponse apportée : [éléments vérifiés].'],
    preuve_locale: ['Nos produits et nos interlocuteurs', 'Retrouvez les points de contact ou de distribution effectivement proposés sur {{zones}}.'],
    coulisses: ['Dans les coulisses de notre activité', 'Découvrons une étape de notre travail : [étape réellement pratiquée et illustrée].'],
    faq_rassurante: ['Les questions avant de choisir', 'Quelles caractéristiques comparer ? Quelles informations demander ? Quelle est la prochaine étape adaptée à votre besoin ?'],
    engagements: ['Des informations claires pour choisir', 'Notre approche repose sur des références identifiées, des explications accessibles et des conditions précisées avant toute décision.'],
  },
  avis: {
    apres_prestation: ['Votre retour après notre échange', 'Merci pour votre confiance. Votre retour sur le choix proposé et la clarté des informations nous est utile.'],
    experience_client: ['Votre expérience avec nous', 'Comment avez-vous vécu les échanges, la commande ou les étapes convenues avec notre équipe ?'],
    preuve_locale: ['Un avis utile à ceux qui nous découvrent', 'Un retour concret sur votre expérience peut aider d’autres personnes ou partenaires à comprendre notre activité.'],
    recommandation: ['Partager votre expérience', 'Si vous le souhaitez, partagez ce que vous avez apprécié dans les produits, les informations ou les échanges avec notre équipe.'],
  },
  offres: {
    decouverte: ['Découvrir notre proposition', 'Découvrez une sélection ou une proposition dont le contenu et les conditions sont précisés ci-dessous.'],
    saison: ['Notre sélection du moment', 'Pour ce temps fort, nous présentons une proposition adaptée aux besoins exprimés.'],
    flash: ['Conditions ponctuelles à découvrir', 'Voici une proposition ponctuelle, à utiliser uniquement pendant la période et selon les conditions indiquées.'],
    fidelite: ['Les conditions pour nos clients réguliers', 'Retrouvez les conditions effectivement proposées à nos clients ou partenaires réguliers.'],
    nouveau_client: ['Pour une première découverte', 'Pour un premier échange, commençons par identifier les références ou le périmètre qui correspondent à votre besoin.'],
    pack: ['Une sélection ou un périmètre regroupé', 'Une proposition regroupée permet de préciser ensemble son contenu, les quantités et les conditions applicables.'],
    disponibilite: ['Disponibilités à confirmer', 'Faisons le point sur les références, volumes ou possibilités actuellement confirmés.'],
    lancement: ['Une nouveauté à découvrir', 'Nous vous présentons une nouveauté : [référence ou périmètre effectivement proposé].'],
    urgent: ['Votre besoin prioritaire', 'Précisez votre besoin et votre échéance afin que nous confirmions les possibilités réelles, sans engagement de délai implicite.'],
    reactivation: ['Reprendre le fil de votre besoin', 'Vos besoins ont peut-être évolué. Nous pouvons refaire le point sur une sélection ou une proposition adaptée.'],
  },
  informations: {
    nouveaute: ['Nouveauté produit ou projet', 'Voici une nouveauté et les informations vérifiées qui permettent d’en comprendre l’usage ou le périmètre.'],
    infos_pratiques: ['Les informations pratiques', 'Retrouvez les références, documents et modalités utiles avant de faire votre choix.'],
    actualite: ['Nos actualités produits', 'Partageons une actualité réelle de notre activité : [actualité à renseigner].'],
    partenariat: ['Un partenaire ou une référence à découvrir', 'Présentons un partenaire ou une référence effectivement distribuée ou impliquée dans un projet, avec son rôle précis.'],
    local: ['Où nous retrouver et nous contacter', 'Voici les points de contact ou de distribution proposés : [lieux ou liens à confirmer].'],
    disponibilites: ['Le point sur les disponibilités', 'Voici les disponibilités confirmées et les éléments restant à vérifier avant une commande ou une validation.'],
  },
  suivis: {
    merci: ['Merci pour votre confiance', 'Merci pour votre commande ou pour les étapes de projet déjà partagées avec notre équipe.'],
    prise_nouvelles: ['Un point après notre échange', 'Avez-vous trouvé les informations nécessaires ? Vous pouvez nous signaler une question sur une référence ou sur la suite convenue.'],
    rappel: ['Un rappel utile sur votre besoin', 'Voici un rappel lié à votre demande et aux informations que vous avez choisi de recevoir.'],
    relance_devis: ['Le point sur votre proposition', 'Avez-vous pu consulter la proposition transmise ? Nous pouvons préciser son contenu ou les conditions restant à valider.'],
    fidelite: ['Poursuivre nos échanges', 'Faisons le point sur vos besoins actuels et sur les conditions effectivement proposées aux clients ou partenaires réguliers.'],
    apres_vente: ['Vos questions après réception ou validation', 'Pour traiter votre demande, indiquez la référence concernée et, si nécessaire, le numéro de commande ou de lot.'],
    reprise_contact: ['Reprendre contact simplement', 'Si votre besoin est toujours d’actualité, dites-nous ce qui a changé depuis notre dernier échange.'],
    controle: ['Vérifier les informations de votre dossier', 'Vérifions les références, documents et éléments encore nécessaires avant la prochaine étape convenue.'],
    renouvellement: ['Anticiper un prochain besoin', 'Si un renouvellement ou une nouvelle étape est utile, précisons d’abord les références, quantités et conditions souhaitées.'],
    saisonnier: ['Préparer votre prochain temps fort', 'Votre sélection ou votre projet doit-il évoluer pour la saison ? Faisons le point avant toute nouvelle décision.'],
  },
  enquetes: {
    satisfaction: ['Votre retour nous aide à progresser', 'Qu’avez-vous apprécié ? Quelle information ou quelle étape devrions-nous améliorer ?'],
    besoins: ['Vos prochains besoins', 'Quelles références ou quel projet envisagez-vous ? Quels formats, quantités ou échéances souhaitez-vous préciser ?'],
    recommandation: ['À qui notre activité serait-elle utile ?', 'À quel type de personne ou de partenaire notre sélection ou notre accompagnement pourrait-il être utile ? Aucun contact personnel n’est nécessaire.'],
    attentes: ['Ce qui compte pour vous', 'Qu’attendez-vous en priorité : des informations produit, davantage de choix, des conditions plus lisibles ou un suivi plus simple ?'],
    nouveau_service: ['Votre avis sur une future proposition', 'Quelle catégorie de produits ou quel périmètre de projet aimeriez-vous pouvoir explorer avec nous ?'],
    experience: ['Votre expérience dans son ensemble', 'Qu’est-ce qui a facilité votre choix ? Quelle étape pourrait être plus claire ou plus simple ?'],
    localite: ['Vos habitudes de découverte', 'Où préférez-vous découvrir les références ou échanger avec nous : en ligne, en point de vente ou directement avec notre équipe ?'],
    priorites: ['Vos priorités actuelles', 'Quel critère compte le plus aujourd’hui : l’usage recherché, les informations disponibles, le format, les quantités ou le budget ?'],
    offre_idee: ['Une idée à construire avec vous', 'Quel contenu ou quelle sélection rendrait une prochaine proposition plus utile pour votre besoin ?'],
    canal: ['Vos préférences de contact', 'Préférez-vous recevoir nos informations par email, par téléphone ou uniquement à votre demande ?'],
  },
};

function contextFor(professionKey: string) {
  if (professionKey === 'fabricant_cosmetiques') return {
    detail: 'Cahier des charges, quantités envisagées, conditionnement et calendrier à qualifier ensemble.',
    question: 'Quel type de produit souhaitez-vous faire fabriquer, dans quels volumes et à quelle échéance ?',
    scope: 'Périmètre de fabrication et étapes à valider', cta: 'Présenter mon projet de fabrication',
    information: 'Les possibilités, essais, documents et délais sont précisés pour le projet étudié.',
  };
  if (professionKey === 'formulateur_cosmetiques') return {
    detail: 'Usage visé, texture, contraintes du brief, prototypes et essais à définir ensemble.',
    question: 'Quel produit souhaitez-vous développer ou reformuler et quelles contraintes faut-il étudier ?',
    scope: 'Périmètre du développement et validations attendues', cta: 'Présenter mon brief de formulation',
    information: 'Le périmètre technique, les essais et les livrables sont définis dans la proposition de développement.',
  };
  if (professionKey === 'grossiste_cosmetiques') return {
    detail: 'Références distribuées, conditionnements, volumes, minimums de commande et disponibilités à confirmer.',
    question: 'Quelles références et quantités recherchez-vous pour votre assortiment ou votre réassort de revendeur ?',
    scope: 'Assortiment revendeur et quantités souhaitées', cta: 'Demander les conditions professionnelles',
    information: 'Les caractéristiques produit proviennent des marques distribuées ; les stocks et conditions de réassort sont confirmés avant commande.',
  };
  return {
    detail: 'Références, formats, prix et modalités de commande indiqués pour la sélection présentée.',
    question: 'Quelles références, textures, teintes ou formats recherchez-vous et pour quel usage ?',
    scope: 'Références et formats concernés', cta: 'Découvrir les produits',
    information: 'Les caractéristiques, conseils d’utilisation et précautions sont ceux de la fiche et de l’emballage de chaque référence.',
  };
}

function bodyFor(action: TemplateAction, slug: string, description: string, pack: SectorPack, context: ReturnType<typeof contextFor>) {
  const opening = `Bonjour,\n\n${description}\n\n`;
  const contact = '\n\nPour nous répondre ou préciser votre besoin : {{cta_url}}';
  switch (action) {
    case 'valoriser': return opening + `Dans notre activité ${pack.label.toLowerCase()}, notre objectif est de ${pack.signature}.\n\n` +
      `${pack.localHook}.\nPour ${pack.audience}.\n\n${context.detail}\nNotre offre : {{services}}.\n${context.information}` + contact;
    case 'avis': return opening + `Vous avez fait appel à notre activité ${pack.label.toLowerCase()} pour ${pack.signature}.\n\n` +
      'Votre avis peut porter sur la clarté des informations, la référence choisie ou le suivi des étapes convenues.\n' +
      'Racontez uniquement votre propre expérience.\n\nPartager votre avis : {{avis_url}}';
    case 'offres': return opening + `À découvrir : ${pack.promoLead}.\n\n` +
      `• ${context.scope} : [à préciser]\n• Conditions et prix validés : [à préciser]\n• Quantités et disponibilités confirmées : [à préciser]\n• Période et limites éventuelles : [à préciser]\n\n` +
      (slug === 'saison' ? `${pack.seasonal}.\n` : slug === 'fidelite' ? `${pack.loyalty}.\n` : '') +
      `${context.information}` + contact;
    case 'informations': return opening + `Dans notre activité ${pack.label.toLowerCase()}, nous souhaitons ${pack.infoLead}.\n\n` +
      `• Sujet ou référence : [à préciser]\n• Informations confirmées : [à renseigner]\n• Où retrouver les détails : {{cta_url}}\n\n${context.information}`;
    case 'suivis': return opening + `Notre suivi permet de ${pack.followLead}.\n\n${context.question}\n\n` +
      (slug === 'fidelite' ? `${pack.loyalty}.` : slug === 'saisonnier' ? `${pack.seasonal}.` : `${pack.maintenance}.`) + contact;
    case 'enquetes': return opening + `Dans notre activité ${pack.label.toLowerCase()}, nous souhaitons ${pack.surveyLead}.\n\n` +
      `${context.question}\n\nQuelques mots en réponse à ce message suffisent. Merci pour votre retour.`;
  }
}

export function createCosmeticProductJobTemplates(definition: JobTemplateDefinition): TemplateDef[] {
  const context = contextFor(definition.professionKey);
  return createJobTemplates(definition).map((template) => {
    const prefix = `${template.module}_${template.action}_${definition.sector}_${definition.professionKey}_`;
    const slug = template.key.slice(prefix.length);
    const angle = ANGLES[template.action][slug];
    if (!angle) throw new Error(`cosmetic_template_variant_missing:${template.action}:${slug}`);
    const [title, description] = angle;
    return { ...template, title, subject: `${title} — {{nom_entreprise}}`,
      body: bodyFor(template.action, slug, description, definition.pack, context),
      ctaLabel: template.action === 'avis' ? 'Partager mon avis' : template.action === 'enquetes' ? 'Partager mes préférences' : context.cta,
    };
  });
}
