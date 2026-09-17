export const GOOGLE_REVIEW_REPLY_PROMPT_MAX_CHARS = 16_000;

// Conserve une marge par rapport au garde-fou de la Gateway pour absorber une
// évolution mineure des libellés sans bloquer la génération en production.
export const GOOGLE_REVIEW_REPLY_PROMPT_TARGET_CHARS =
  GOOGLE_REVIEW_REPLY_PROMPT_MAX_CHARS - 500;

const MAX_AI_CONFIG_CHARS = 3_600;
const MAX_AI_DIRECTIVE_CHARS = 4_000;
const MAX_LANGUAGE_INSTRUCTION_CHARS = 500;
const MAX_REVIEW_COMMENT_CHARS = 2_500;
const MAX_EXISTING_REPLY_CHARS = 2_500;

export const GOOGLE_REVIEW_REPLY_RESPONSE_SCHEMA = {
  name: "google_review_reply",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reply_text: {
        type: "string",
        minLength: 1,
        maxLength: 4_096,
      },
    },
    required: ["reply_text"],
  },
} as const;

type GoogleReviewReplyPromptArgs = {
  company?: string;
  locationTitle?: string;
  city?: string;
  sectorLabel?: string;
  profession?: string;
  activityDescription?: string;
  services?: string[];
  strengths?: string[];
  aiConfig?: string;
  aiDirective: string;
  aiLanguageInstruction: string;
  openingVariant: string;
  toneVariant: string;
  closingVariant: string;
  signatureInstruction: string;
  reviewerName: string;
  rating: number;
  reviewComment?: string;
  existingReply?: string;
};

function compactText(value: unknown, maxChars: number) {
  const text = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return text.slice(0, Math.max(0, maxChars));
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function compactDirective(value: unknown, maxChars: number) {
  const text = compactText(value, Number.MAX_SAFE_INTEGER);
  if (text.length <= maxChars) return text;
  const candidate = text.slice(0, Math.max(0, maxChars - 1));
  const lastCompleteLine = candidate.lastIndexOf("\n");
  if (lastCompleteLine >= Math.floor(maxChars * 0.6)) {
    return candidate.slice(0, lastCompleteLine).trimEnd();
  }
  return `${candidate.trimEnd()}…`;
}

function compactList(values: string[] | undefined, maxItems: number) {
  return (Array.isArray(values) ? values : [])
    .map((value) => compactText(value, 90))
    .filter(Boolean)
    .slice(0, maxItems);
}

function joinSections(sections: Array<string | null | undefined>) {
  return sections.filter((section): section is string => Boolean(section)).join("\n\n");
}

function buildBudgetedSection(
  heading: string,
  content: string,
  availableChars: number,
) {
  const separatorChars = 2;
  const prefix = `${heading}\n`;
  const contentBudget = Math.floor(availableChars) - separatorChars - prefix.length;
  if (contentBudget < 32) return "";
  return `${prefix}${compactText(content, contentBudget)}`;
}

/**
 * Construit le prompt exact envoyé à la Gateway. Les données indispensables
 * (avis, identité minimale, Configuration IA) restent prioritaires ; seuls la
 * réponse précédente et les détails métier complémentaires sont compactés si
 * le cas maximal approche la limite de 16 000 caractères.
 */
export function buildGoogleReviewReplyPrompt(args: GoogleReviewReplyPromptArgs) {
  const languageInstruction = compactDirective(
    args.aiLanguageInstruction,
    MAX_LANGUAGE_INSTRUCTION_CHARS,
  );
  const writingDirective = compactDirective(args.aiDirective, MAX_AI_DIRECTIVE_CHARS);

  const system = `Tu es l'assistant IA d'iNrCy spécialisé dans les réponses aux avis Google Business.
Réponds uniquement en JSON valide : {"reply_text":"..."}.
Objectif : proposer une réponse courte, humaine, professionnelle et prête à publier sur Google.
Règles strictes :
- Répondre au nom de l'entreprise, jamais au nom d'iNrCy.
- Ne jamais inventer de fait, prix, geste commercial, garantie, délai, certification ou promesse.
- Ne jamais divulguer d'information privée ou sensible.
- Si l'avis est négatif ou mitigé : rester calme, empathique, remercier, reconnaître le ressenti sans admettre une faute non établie, proposer un échange direct.
- Si l'avis est positif : remercier naturellement, valoriser l'équipe/le service sans surjouer.
- Si l'avis ne contient pas de commentaire écrit : produire une réponse simple adaptée à la note.
- Adapter clairement le ton selon la note : 5★ chaleureux et valorisant ; 4★ positif avec nuance ; 3★ neutre et ouvert ; 1–2★ empathique, calme et orienté résolution.
- Varier fortement les formulations d'un avis à l'autre : éviter les copier-coller et les ouvertures répétitives.
- Éviter si possible les phrases trop vues comme « Merci beaucoup pour votre excellente note » ou « Nous sommes ravis de savoir que notre service vous satisfait » si une formulation plus naturelle peut être proposée.
- Ajouter une courte signature personnalisée seulement de temps en temps, jamais systématiquement.
- Pas de markdown, pas de HTML, pas de hashtag, pas de formule lourde.
- Une réponse Google doit rester concise et proportionnée à l'avis. Ne force pas un nombre fixe de phrases : une réponse très courte peut suffire, une réponse négative peut nécessiter un peu plus de matière.
- Respecter la Configuration IA du professionnel quand elle est compatible avec une réponse d'avis Google.
${languageInstruction}
${writingDirective}`;

  const identitySection = `Entreprise : ${compactText(args.company || args.locationTitle || "Non précisée", 160)}
Ville : ${compactText(args.city || "Non précisée", 80)}
Secteur : ${compactText(args.sectorLabel || "Non précisé", 120)}
Métier : ${compactText(args.profession || "Non précisé", 120)}
Fiche Google : ${compactText(args.locationTitle || "Fiche Google Business", 180)}`;

  const aiConfigSection = `Configuration IA :
${compactDirective(args.aiConfig || "- Non précisée", MAX_AI_CONFIG_CHARS)}`;

  const variationSection = `Pistes facultatives anti-répétition pour cette réponse :
- Angle d'ouverture : ${compactText(args.openingVariant, 180)}
- Style attendu : ${compactText(args.toneVariant, 180)}
- Clôture : ${compactText(args.closingVariant, 180)}
- Signature : ${compactText(args.signatureInstruction, 320)}

Ces pistes sont des inspirations, pas un plan obligatoire. Si une autre construction naturelle convient mieux au moteur actif et à l'avis, utilise-la.`;

  const reviewSection = `Avis Google à traiter :
- Auteur : ${compactText(args.reviewerName || "Client Google", 120)}
- Note : ${Number.isFinite(args.rating) && args.rating > 0 ? Math.min(5, Math.round(args.rating)) : "Non précisée"}/5
- Commentaire : ${compactText(args.reviewComment || "Avis sans commentaire écrit.", MAX_REVIEW_COMMENT_CHARS)}`;

  const finalInstruction = "Génère une seule réponse prête à publier, naturelle, rassurante et adaptée à la note. Ne recopie pas mot pour mot l'avis. Ne commence pas par le prénom si le nom semble incomplet ou anonymisé. Fais une réponse différente des formulations génériques habituelles lorsque c'est possible.";

  const mandatorySections = [
    identitySection,
    aiConfigSection,
    variationSection,
    reviewSection,
    finalInstruction,
  ];
  const mandatoryInput = joinSections(mandatorySections);
  const mandatoryTotal = system.length + mandatoryInput.length;
  if (mandatoryTotal > GOOGLE_REVIEW_REPLY_PROMPT_TARGET_CHARS) {
    throw new Error("Le prompt essentiel de réponse Google dépasse son budget de sécurité.");
  }

  let remainingChars = GOOGLE_REVIEW_REPLY_PROMPT_TARGET_CHARS - mandatoryTotal;
  const existingReply = compactText(args.existingReply, MAX_EXISTING_REPLY_CHARS);
  const existingReplySection = existingReply
    ? buildBudgetedSection(
        "Réponse actuelle à améliorer/modifier :",
        existingReply,
        remainingChars,
      )
    : "";
  if (existingReplySection) remainingChars -= existingReplySection.length + 2;

  const services = compactList(args.services, 10);
  const strengths = compactList(args.strengths, 8);
  const businessDetails = [
    args.activityDescription
      ? `Description activité : ${compactText(args.activityDescription, 800)}`
      : "",
    services.length ? `Prestations : ${services.join(", ")}` : "",
    strengths.length ? `Forces : ${strengths.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  const businessSection = businessDetails
    ? buildBudgetedSection(
        "Contexte métier complémentaire :",
        businessDetails,
        remainingChars,
      )
    : "";

  const input = joinSections([
    identitySection,
    businessSection,
    aiConfigSection,
    variationSection,
    reviewSection,
    existingReplySection,
    finalInstruction,
  ]);

  if (system.length + input.length > GOOGLE_REVIEW_REPLY_PROMPT_TARGET_CHARS) {
    throw new Error("Le prompt de réponse Google dépasse son budget de sécurité.");
  }

  return { system, input };
}
