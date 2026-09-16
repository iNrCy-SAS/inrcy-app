import "server-only";

import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import type { AiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";
import { buildAiMediaBusinessDnaPayload } from "@/lib/aiMediaBusinessDna";
import { isAiMediaTechnicalCopyAllowed } from "./aiMediaTechnicalText.ts";
import {
  aiMediaDialogueSignature,
  selectAiMediaDialogueLine,
} from "@/lib/aiMediaDialogue";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import { hasAiLanguageMismatch } from "@/lib/aiLanguageValidation";
import {
  buildAiLanguageInstruction,
  getAiLanguageLabel,
} from "@/lib/aiWritingProfile";
import {
  AI_MEDIA_SPOKEN_LINE_MAX_CHARACTERS,
  AI_MEDIA_SPOKEN_LINE_MAX_WORDS,
  AI_MEDIA_VISIBLE_BODY_MAX_CHARACTERS,
  AI_MEDIA_VISIBLE_EYEBROW_MAX_CHARACTERS,
  AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS,
  acceptCompleteAiMediaVisibleCopy,
  collectAiMediaProtectedTerms,
  normalizeAiMediaCopy,
  preservesAiMediaProtectedTerms,
} from "@/lib/aiMediaTextIntegrity";

const MEDIA_COPY_SCHEMA = {
  name: "inrcy_media_visible_copy",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string", minLength: 3, maxLength: AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS },
      cta: { type: "string", minLength: 2, maxLength: 58 },
      scenes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            eyebrow: { type: "string", minLength: 1, maxLength: AI_MEDIA_VISIBLE_EYEBROW_MAX_CHARACTERS },
            title: { type: "string", minLength: 2, maxLength: AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS },
            body: { type: "string", minLength: 0, maxLength: AI_MEDIA_VISIBLE_BODY_MAX_CHARACTERS },
            spokenLine: { type: "string", minLength: 2, maxLength: AI_MEDIA_SPOKEN_LINE_MAX_CHARACTERS },
            spokenReply: { type: "string", minLength: 2, maxLength: AI_MEDIA_SPOKEN_LINE_MAX_CHARACTERS },
          },
          required: ["eyebrow", "title", "body", "spokenLine", "spokenReply"],
        },
      },
    },
    required: ["headline", "cta", "scenes"],
  },
} as const;

type GeneratedMediaCopy = {
  headline?: unknown;
  cta?: unknown;
  scenes?: Array<{
    eyebrow?: unknown;
    title?: unknown;
    body?: unknown;
    spokenLine?: unknown;
    spokenReply?: unknown;
  }>;
};

function compactCopy(value: unknown, maximum: number) {
  return acceptCompleteAiMediaVisibleCopy(value, maximum);
}

function compactCompleteBody(value: unknown, maximum = AI_MEDIA_VISIBLE_BODY_MAX_CHARACTERS) {
  return acceptCompleteAiMediaVisibleCopy(value, maximum);
}

function compactHeadline(value: unknown) {
  return compactCopy(
    normalizeAiMediaCopy(value).replace(/[+·|/]+/g, " "),
    AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS
  );
}

function normalizedWords(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const IDEA_STOP_WORDS = new Set([
  "avec",
  "cette",
  "dans",
  "faire",
  "image",
  "mettre",
  "montrer",
  "notre",
  "pour",
  "publication",
  "quand",
  "quelque",
  "video",
  "votre",
]);

function headlineRespectsIdea(
  headline: string,
  idea: string,
  requireLexicalAnchor: boolean
) {
  const normalizedHeadline = normalizedWords(headline);
  const normalizedIdea = normalizedWords(idea);
  if (!normalizedIdea) return true;
  const ideaLooksLikeInstruction = /^(?:je\s+(?:veux|souhaite|voudrais)\b|(?:cr[eé]er|faire|mettre|montrer|pr[eé]senter|illustrer|raconter|expliquer|valoriser|animer|filmer)\b)/i.test(
    String(idea || "").trim()
  );
  // Une véritable consigne collée derrière un préfixe éditorial reste une
  // recopie brute. Un sujet publiable peut rester entier, noms propres inclus.
  if (
    ideaLooksLikeInstruction &&
    normalizedIdea.length >= 12 &&
    normalizedHeadline.includes(normalizedIdea)
  ) {
    return false;
  }
  // Une traduction idiomatique ne partage pas nécessairement les mêmes mots.
  // L'ancrage lexical strict ne s'applique donc qu'au chemin français ; la
  // protection anti-recopie ci-dessus reste active dans toutes les langues.
  if (!requireLexicalAnchor) return true;
  const headlineTokens = normalizedHeadline.split(" ").filter(Boolean);
  const ideaTokens = normalizedIdea
    .split(" ")
    .filter((token) => token.length >= 5 && !IDEA_STOP_WORDS.has(token));
  if (!ideaTokens.length) return true;
  return ideaTokens.some((ideaToken) => {
    const stem = ideaToken.slice(0, Math.min(6, ideaToken.length));
    return headlineTokens.some((headlineToken) =>
      headlineToken.startsWith(stem)
    );
  });
}

function isNaturalHeadline(
  value: string,
  keywords: readonly string[],
  idea: string,
  language: NormalizedAiGenerationProfile["preferences"]["language"]
) {
  if (value.length < 3 || /[+·|]/.test(value)) return false;
  if (keywords.length > 1 && value.split(/\s+/).length < 4) return false;
  const rawList = keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return (
    value.toLocaleLowerCase() !== rawList &&
    headlineRespectsIdea(value, idea, language === "fr")
  );
}

function applyLocalizedCopy(
  plan: AiMediaCreativePlan,
  generated: GeneratedMediaCopy,
  language: NormalizedAiGenerationProfile["preferences"]["language"],
  protectedTerms: readonly string[],
  requireSpokenTerms: boolean
) {
  const headline = compactHeadline(generated.headline);
  const cta = compactCopy(generated.cta, 58);
  if (!headline || !cta) return plan;
  if (!preservesAiMediaProtectedTerms(headline, protectedTerms)) return plan;

  const generatedScenes = Array.isArray(generated.scenes)
    ? generated.scenes
    : [];
  if (
    requireSpokenTerms &&
    protectedTerms.length > 0 &&
    !preservesAiMediaProtectedTerms(generatedScenes[0]?.spokenLine, protectedTerms)
  ) {
    return plan;
  }
  const usedDialogue = new Set<string>();
  const usedTitles = new Set<string>();
  const scenes = plan.scenes.map((scene, index) => {
    const candidate = generatedScenes[index];
    const generatedTitle =
      index === 0
        ? headline
        : compactCopy(candidate?.title, AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS) ||
          compactCopy(scene.title, AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS);
    const titleSignature = aiMediaDialogueSignature(generatedTitle);
    const title =
      titleSignature && !usedTitles.has(titleSignature)
        ? generatedTitle
        : compactCopy(scene.title, AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS);
    usedTitles.add(aiMediaDialogueSignature(title));
    if (!candidate) {
      const spokenLine = selectAiMediaDialogueLine({
        value: scene.spokenLine,
        language,
        sceneIndex: index,
        sceneCount: plan.scenes.length,
        speaker: "lead",
        usedSignatures: usedDialogue,
      });
      usedDialogue.add(aiMediaDialogueSignature(spokenLine));
      const spokenReply = selectAiMediaDialogueLine({
        value: scene.spokenReply,
        language,
        sceneIndex: index,
        sceneCount: plan.scenes.length,
        speaker: "reply",
        usedSignatures: usedDialogue,
      });
      usedDialogue.add(aiMediaDialogueSignature(spokenReply));
      return {
        ...scene,
        title,
        body: compactCompleteBody(scene.body),
        spokenLine,
        spokenReply,
      };
    }
    const spokenLine = selectAiMediaDialogueLine({
      value: candidate.spokenLine,
      language,
      sceneIndex: index,
      sceneCount: plan.scenes.length,
      speaker: "lead",
      usedSignatures: usedDialogue,
    });
    usedDialogue.add(aiMediaDialogueSignature(spokenLine));
    const spokenReply = selectAiMediaDialogueLine({
      value: candidate.spokenReply,
      language,
      sceneIndex: index,
      sceneCount: plan.scenes.length,
      speaker: "reply",
      usedSignatures: usedDialogue,
    });
    usedDialogue.add(aiMediaDialogueSignature(spokenReply));
    return {
      ...scene,
      eyebrow:
        compactCopy(candidate.eyebrow, AI_MEDIA_VISIBLE_EYEBROW_MAX_CHARACTERS) ||
        scene.eyebrow,
      title,
      body:
        compactCompleteBody(candidate.body) || compactCompleteBody(scene.body),
      spokenLine,
      spokenReply,
    };
  });
  const visibleCopy = [
    headline,
    cta,
    ...scenes.flatMap((scene) => [
      scene.eyebrow,
      scene.title,
      scene.body,
      scene.spokenLine,
      scene.spokenReply,
    ]),
  ].join(" ");
  if (hasAiLanguageMismatch(language, visibleCopy)) return plan;

  return {
    ...plan,
    headline,
    cta,
    scenes,
  };
}

/**
 * Transforme les tags de finition en une accroche éditoriale. Les mots fournis
 * orientent le sens ; ils ne sont jamais concaténés ni recopiés comme une liste.
 * En cas d'indisponibilité du petit modèle, le plan local reste publiable.
 */
export async function writeAiMediaHeadline(args: {
  accountId: string;
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  plan: AiMediaCreativePlan;
}): Promise<AiMediaCreativePlan> {
  const characterDialogueRequested =
    args.request.kind === "video" &&
    args.request.teamVideoSpeechMode === "characters";
  if (!args.request.withText && !characterDialogueRequested) return args.plan;

  const languageCode = args.profile.preferences.language;
  // Le plan français est déjà publiable sans appel supplémentaire. Une saisie
  // de mots-clés, toute langue étrangère ou le mode ADN passe par le copywriter
  // afin que le texte visible exploite réellement le contexte professionnel.
  if (
    languageCode === "fr" &&
    !args.request.textKeywords.length &&
    !args.request.aiInstruction &&
    !args.request.idea &&
    args.request.subjectSource !== "profile" &&
    !characterDialogueRequested
  ) {
    return args.plan;
  }
  const protectedTerms = collectAiMediaProtectedTerms({
    request: args.request,
    profile: args.profile,
  });

  try {
    const generated = await aiGenerateJSON<GeneratedMediaCopy>({
      feature: args.request.kind === "video" ? "media.video" : "media.image",
      accountId: args.accountId,
      model: String(
        process.env.AI_MEDIA_COPY_MODEL || "openai/gpt-4o-mini"
      ).trim(),
      system: [
        "Tu es le directeur éditorial multilingue du studio média iNrCy.",
        buildAiLanguageInstruction(args.profile),
        `Tous les textes réellement visibles dans le média doivent être en ${getAiLanguageLabel(
          args.profile
        )} : headline, cta, eyebrow, title et body de chaque scène.`,
        "Adapte ou traduis les informations utiles de l’ADN de l’entreprise dans cette langue sans traduire les noms propres, marques ou villes.",
        "Retourne exactement le même nombre de scènes et conserve leur ordre.",
        "Rédige une accroche publicitaire courte, naturelle, idiomatique et crédible.",
        "Les mots-clés sont des idées sémantiques à intégrer intelligemment dans le sens d'une phrase : ne les additionne jamais, ne les liste jamais et n'utilise jamais +, ·, / ou des hashtags.",
        "L'idée du professionnel est le SUJET CENTRAL OBLIGATOIRE : conserve ses personnes, objets, lieux, actions, relations et résultat attendu dans toutes les scènes. Reformule-la naturellement sans la réciter ni la remplacer par un autre service de l'ADN.",
        "La consigne ponctuelle est une CONSIGNE DE RÉALISATION PRIORITAIRE : applique intégralement chacun de ses éléments visuels et narratifs, même s'ils ne figurent pas dans l'ADN. Ne neutralise un fragment que pour la sécurité, les droits, une impossibilité technique ou un fait commercial non vérifié ; ne la cite jamais.",
        `Chaque title visible est une accroche autonome de ${AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS} caractères maximum. Chaque body visible est vide ou forme une seule phrase autonome et grammaticalement complète de ${AI_MEDIA_VISIBLE_BODY_MAX_CHARACTERS} caractères maximum.`,
        "RÈGLE ABSOLUE : écris dès le départ une formulation qui tient entièrement dans la limite. Aucun texte visible ne doit être tronqué, abrégé, finir par des points de suspension, ni se terminer par un article, une préposition ou une conjonction. Si aucune phrase body utile ne tient, retourne une chaîne vide.",
        `Pour chaque scène, spokenLine est une phrase orale naturelle et complète de 5 à ${AI_MEDIA_SPOKEN_LINE_MAX_WORDS} mots et ${AI_MEDIA_SPOKEN_LINE_MAX_CHARACTERS} caractères maximum, directement liée au sujet central exact et à l'action demandée dans cette scène ; aucun dialogue vague, générique ou hors sujet.`,
        "spokenReply est une réponse très courte qui poursuit naturellement spokenLine pour une éventuelle seconde personne.",
        "Pour un film en plusieurs scènes, les dialogues racontent une seule histoire : la première scène ouvre précisément le sujet, chaque scène intermédiaire apporte une preuve ou une étape nouvelle, et la dernière conclut le sujet avec une action ou un appel clair. Ne recommence jamais l'introduction et ne change jamais de sujet.",
        "Chaque réplique doit être différente de toutes les répliques des autres scènes : ne répète jamais une phrase, une accroche ou une question déjà utilisée.",
        "Les répliques ne doivent jamais être vagues ou passe-partout : interdiction d'écrire « On s'y met ? », « On avance bien », « C'est prêt », « Exactement » ou une variante.",
        "Chaque réplique finit sur un mot porteur de sens, jamais sur un article, une préposition ou une conjonction. Aucun libellé de dialogue, guillemet, nom de locuteur ni question adressée à un interlocuteur indéfini dans spokenLine ou spokenReply.",
        `L'accroche contient au maximum ${AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS} caractères. Aucun guillemet, emoji ou promesse inventée.`,
        protectedTerms.length
          ? `TERMES LITTÉRAUX OBLIGATOIRES : ${protectedTerms.join(" ; ")}. Chaque expression est atomique : recopie-la exactement, sans la traduire, la raccourcir, la séparer ni en supprimer le dernier mot. Réécris les mots autour si nécessaire.`
          : "Ne coupe jamais un nom propre, une marque ou un lieu.",
        "Utilise uniquement les faits fournis et n'ajoute ni prix, promotion, certification, adresse, délai ni résultat garanti.",
        "Les couleurs, cadrages et paramètres sont des directives visuelles, jamais du texte visible ou prononcé. Aucun code couleur ni préfixe technique, sauf texte littéral explicitement demandé.",
      ].join(" "),
      input: JSON.stringify({
        langue_cible: getAiLanguageLabel(args.profile),
        idee: args.request.idea || null,
        consigne_ponctuelle: args.request.aiInstruction || null,
        mots_a_evoquer: args.request.textKeywords,
        termes_obligatoires_exacts: protectedTerms,
        adn_de_l_entreprise: buildAiMediaBusinessDnaPayload(args.profile),
        type_de_contenu: args.request.typology,
        copie_visible_de_secours: {
          headline: args.plan.headline,
          cta: args.plan.cta,
          scenes: args.plan.scenes.map((scene, index) => ({
            role_narratif:
              args.plan.scenes.length === 1
                ? "histoire_complete"
                : index === 0
                ? "ouverture"
                : index === args.plan.scenes.length - 1
                ? "conclusion"
                : "preuve",
            eyebrow: scene.eyebrow,
            title: scene.title,
            body: scene.body,
            spokenLine: scene.spokenLine,
            spokenReply: scene.spokenReply,
          })),
        },
      }),
      responseSchema: MEDIA_COPY_SCHEMA,
      maxOutputTokens: 512,
      temperature: args.request.creativity === "bold" ? 0.85 : 0.45,
      retries: 0,
      // Une idée libre doit être reformulée, mais cette touche éditoriale
      // ne doit pas ralentir sensiblement le lancement du moteur vidéo. Le
      // plan local, déjà ancré dans l'idée, prend le relais après une seule
      // tentative bornée. La deadline courte empêche les 2 fournisseurs de
      // secours de rejouer un JSON tronqué avant de lancer le rendu média.
      timeoutMs: args.request.idea ? 5_000 : 18_000,
      deadlineAt: args.request.idea ? Date.now() + 5_900 : undefined,
    });
    // Check before typography cleanup can hide the marker identifying a leak.
    const copyFields = [
      generated.headline,
      generated.cta,
      ...(Array.isArray(generated.scenes) ? generated.scenes : []).flatMap(
        (scene) => [
          scene.eyebrow,
          scene.title,
          scene.body,
          scene.spokenLine,
          scene.spokenReply,
        ]
      ),
    ];
    if (
      copyFields.some(
        (value) => !isAiMediaTechnicalCopyAllowed(value, args.request)
      )
    ) {
      return args.plan;
    }
    const headline = compactHeadline(generated.headline);
    if (
      args.request.withText &&
      !isNaturalHeadline(
        headline,
        args.request.textKeywords,
        args.request.idea,
        languageCode
      )
    ) {
      return args.plan;
    }
    return applyLocalizedCopy(
      args.plan,
      generated,
      languageCode,
      protectedTerms,
      characterDialogueRequested
    );
  } catch {
    return args.plan;
  }
}
