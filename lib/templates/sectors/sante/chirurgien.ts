import type { TemplateAction, TemplateDef } from '@/lib/messageTemplates';
import { buildTemplateMetadata } from '@/lib/templates/intelligentContext';
import type { JobTemplateDefinition } from '../shared';

export const chirurgienJobTemplates: JobTemplateDefinition = {
  sector: 'sante',
  professionKey: 'chirurgien',
  professionLabel: 'Chirurgien',
  pack: {
    label: 'Chirurgien',
    signature: 'expliquer le parcours chirurgical et ses modalités avec clarté, en respectant la situation et les questions de chaque patient',
    promoLead: 'présenter les consultations chirurgicales, les informations sur l’intervention et les modalités de prise de contact',
    infoLead: 'expliquer la consultation, le bilan préopératoire, la préparation de l’intervention et le suivi postopératoire',
    followLead: 'accompagner les questions pratiques, les consultations de contrôle et la coordination des soins convenus avec le patient',
    surveyLead: 'recueillir les attentes sur la clarté des explications, l’accueil et l’organisation du parcours',
    seasonal: 'information pratique sur les modalités de consultation et de suivi effectivement proposées',
    loyalty: 'continuité du suivi convenu avec le patient et l’équipe de soins',
    maintenance: 'un rappel pratique pour préparer un rendez-vous convenu ou demander une précision au cabinet',
    localHook: 'consultation chirurgicale, préparation de l’intervention et coordination du suivi',
    audience: 'patients souhaitant comprendre le parcours proposé et contacter le cabinet pour leurs questions',
  },
};

type Variant = readonly [slug: string, title: string, message: string];

// This new profession has its own copy: shared commercial seeds would add
// urgency, loyalty benefits and result claims to a medical information message.
const variants: Record<TemplateAction, readonly Variant[]> = {
  valoriser: [
    ['consultation_chirurgicale', 'Comprendre la consultation chirurgicale', 'La consultation chirurgicale permet de faire le point sur votre demande, de présenter les informations disponibles et de poser vos questions. La suite du parcours dépend de votre situation et de l’échange avec l’équipe de soins.'],
    ['preparation_consultation', 'Préparer les questions de la consultation', 'Avant une consultation, vous pouvez noter les questions que vous souhaitez aborder et demander au cabinet quels documents apporter. Les éléments utiles vous sont précisés selon le rendez-vous prévu.'],
    ['information_intervention', 'Des explications sur le parcours chirurgical', 'Les échanges avec le chirurgien permettent de comprendre l’intervention envisagée, ses modalités, ses limites et les questions qu’elle soulève. Les explications sont adaptées au parcours discuté avec le patient.'],
    ['coordination_soins', 'Comprendre la coordination des soins', 'Le parcours chirurgical peut impliquer plusieurs professionnels. Vous pouvez demander à l’équipe comment s’organisent les échanges, les étapes convenues et les contacts utiles à votre suivi.'],
  ],
  avis: [
    ['accueil_cabinet', 'Votre retour sur l’accueil', 'Si vous le souhaitez, vous pouvez partager votre expérience de l’accueil et de l’organisation au cabinet.'],
    ['clarte_explications', 'La clarté des explications', 'Les informations pratiques et le déroulement de la consultation vous ont-ils été présentés de façon compréhensible ? Votre retour sur ces explications nous est utile.'],
    ['preparation_rendez_vous', 'La préparation de votre rendez-vous', 'Qu’est-ce qui vous a aidé à préparer le rendez-vous ? Vous pouvez nous faire part de votre expérience des informations pratiques reçues.'],
    ['organisation_parcours', 'Votre expérience de l’organisation', 'Si vous souhaitez donner un retour, vous pouvez évoquer la facilité de prise de contact et l’organisation des échanges avec le cabinet.'],
  ],
  offres: [
    ['premier_contact', 'Prendre contact avec le cabinet', 'Vous souhaitez connaître les modalités d’une consultation chirurgicale ? Le cabinet peut vous renseigner sur la prise de rendez-vous et les informations utiles pour préparer votre demande.'],
    ['informations_consultation', 'Les modalités de consultation', 'Avant de demander un rendez-vous, vous pouvez vous informer sur les modalités de consultation et les documents à prévoir. Les renseignements sont précisés selon votre demande.'],
    ['informations_suivi', 'S’informer sur les modalités de suivi', 'Vous avez une question sur l’organisation d’un suivi postopératoire ou d’une consultation de contrôle ? Contactez l’équipe pour connaître les modalités correspondant au parcours convenu.'],
    ['question_organisation', 'Une question pratique avant le rendez-vous', 'Pour une précision sur l’accès au cabinet, les modalités de contact ou la préparation administrative du rendez-vous, vous pouvez adresser votre question au secrétariat.'],
  ],
  informations: [
    ['documents_consultation', 'Les documents utiles à la consultation', 'Le cabinet peut vous préciser les documents nécessaires pour préparer votre consultation. Demandez la liste adaptée au rendez-vous et aux informations déjà transmises à l’équipe.'],
    ['bilan_preoperatoire', 'Comprendre le bilan préopératoire', 'Lorsqu’un bilan préopératoire est prévu, l’équipe vous explique les démarches et les éléments à réunir pour votre parcours. Les indications personnelles sont données lors des échanges de soins.'],
    ['preparation_intervention', 'Préparer les échanges avant une intervention', 'Avant une intervention convenue, il est utile de savoir à qui poser vos questions et où retrouver les informations transmises par l’équipe. Les consignes de préparation de l’intervention sont celles données par l’équipe pour votre situation.'],
    ['suivi_postoperatoire', 'Comprendre le suivi postopératoire', 'Le suivi postopératoire et les consultations de contrôle s’organisent selon le parcours convenu avec l’équipe. Vous pouvez demander des précisions sur les rendez-vous et les contacts à utiliser.'],
  ],
  suivis: [
    ['modalites_rendez_vous', 'Vérifier les modalités du rendez-vous', 'Pour vérifier les modalités d’un rendez-vous convenu, contactez le cabinet avec votre question sur l’organisation ou les documents attendus.'],
    ['question_consultation', 'Une précision après la consultation', 'Un point pratique abordé pendant la consultation demande une précision ? Vous pouvez contacter l’équipe afin de savoir comment obtenir l’information adaptée à votre parcours.'],
    ['consultation_controle', 'Organiser une consultation de contrôle', 'Lorsqu’une consultation de contrôle a été prévue, le cabinet peut vous préciser les modalités du rendez-vous et les éléments à préparer.'],
    ['coordination_suivi', 'Les contacts pour votre suivi', 'Pour une question sur la coordination des rendez-vous ou des informations déjà demandées par l’équipe, le cabinet peut vous orienter vers le contact approprié.'],
  ],
  enquetes: [
    ['informations_utiles', 'Quelles informations pratiques vous seraient utiles ?', 'Sur quels points d’organisation aimeriez-vous recevoir davantage d’explications : préparation du rendez-vous, documents, accès au cabinet ou contacts ?'],
    ['clarte_parcours', 'Rendre le parcours plus compréhensible', 'Qu’est-ce qui pourrait rendre la présentation des étapes et des contacts plus claire ? Vous pouvez nous proposer une amélioration des informations pratiques.'],
    ['organisation_echanges', 'Votre avis sur l’organisation des échanges', 'Quels éléments ont facilité la préparation de votre rendez-vous et les échanges avec le cabinet ? Quel point d’organisation pourrait être amélioré ?'],
    ['preferences_contact', 'Vos préférences de contact', 'Pour les informations pratiques du cabinet, quel mode de contact préférez-vous parmi ceux effectivement proposés ? Vous pouvez aussi indiquer que vous souhaitez être contacté uniquement à votre demande.'],
  ],
};

function bodyFor(action: TemplateAction, message: string) {
  if (action === 'avis') {
    return `Bonjour,\n\n${message}\n\nVotre retour peut rester centré sur l’accueil et les informations pratiques, sans détail sur votre santé ni sur celle d’une autre personne.\n\nPartager votre retour, si vous le souhaitez : {{avis_url}}`;
  }
  if (action === 'enquetes') {
    return `Bonjour,\n\n${message}\n\nQuelques mots sur l’organisation suffisent ; ne communiquez pas de détail médical dans ce retour.\n\nPour répondre ou contacter le cabinet : {{cta_url}}`;
  }
  return `Bonjour,\n\n${message}\n\nPrestations présentées par le cabinet : {{services}}.\n\nPour demander une information pratique ou une prise de contact : {{cta_url}}`;
}

export function buildChirurgienJobTemplates(): TemplateDef[] {
  return (Object.entries(variants) as [TemplateAction, readonly Variant[]][]).flatMap(([action, entries]) => {
    const moduleName = action === 'valoriser' || action === 'avis' || action === 'offres' ? 'booster' : 'fideliser';
    return entries.map(([slug, title, message]) => ({
      key: `${moduleName}_${action}_sante_chirurgien_${slug}`,
      module: moduleName,
      action,
      category: `${action}_sante_chirurgien_${slug}`,
      title,
      subject: `${title} — {{nom_entreprise}}`,
      body: bodyFor(action, message),
      ctaLabel: action === 'avis' ? 'Partager un retour sur l’accueil'
        : action === 'enquetes' ? 'Partager mes préférences' : 'Contacter le cabinet',
      sectorCategory: chirurgienJobTemplates.sector,
      professionKey: chirurgienJobTemplates.professionKey,
      intelligent: buildTemplateMetadata({ module: moduleName, action, slug, priority: 70 }),
    }));
  });
}
