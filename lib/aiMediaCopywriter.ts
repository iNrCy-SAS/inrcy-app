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
import { getAiEngineOption } from "@/lib/aiEnginePreference";
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

const GENERIC_MEDIA_COPY_PATTERNS = [
  /^votre projet (?:entre de bonnes mains|prend vie)$/,
  /^une (?:expertise pensee pour vous|reponse sur mesure|solution a decouvrir)$/,
  /^qualite ecoute proximite$/,
  /^(?:donnez|donner) vie a vos idees$/,
  /^ensemble (?:donnons vie|construisons) (?:a )?votre projet$/,
  /^votre reussite notre priorite$/,
  /^a vos cotes (?:au quotidien|pour reussir)$/,
  /^une solution adaptee a vos besoins$/,
  /^cap sur /,
  / prend vie$/,
  / autrement$/,
  / en lumiere$/,
  /^decouvrez /,
  /^notre (?:expertise|difference|savoir faire)/,
  / au service de votre projet$/,
  /^une nouvelle facon de /,
  /^pense pour vous$/,
  /^proche de vous$/,
  /^une solution complete$/,
  /^une etape concrete$/,
] as const;

function isGenericMediaCopy(value: unknown) {
  const normalized = normalizedWords(value);
  return GENERIC_MEDIA_COPY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function removeAiMediaFallbackCopy(
  plan: AiMediaCreativePlan,
  options: { keepSpokenCopy?: boolean } = {}
): AiMediaCreativePlan {
  return {
    ...plan,
    headline: "",
    subline: "",
    cta: "",
    scenes: plan.scenes.map((scene) => ({
      ...scene,
      eyebrow: "",
      title: "",
      body: "",
      spokenLine: options.keepSpokenCopy ? scene.spokenLine : "",
      spokenReply: options.keepSpokenCopy ? scene.spokenReply : "",
    })),
  };
}

function keepFreshLocalCopyOrRemove(
  plan: AiMediaCreativePlan,
  recentPublications: readonly RecentMediaCopy[]
) {
  const visibleValues = [
    plan.headline,
    plan.cta,
    ...plan.scenes.flatMap((scene) => [
      scene.title,
      scene.body,
      scene.spokenLine,
      scene.spokenReply,
    ]),
  ];
  if (
    visibleValues.some(isGenericMediaCopy) ||
    repeatsRecentVisibleCopy(visibleValues, recentPublications)
  ) {
    return removeAiMediaFallbackCopy(plan);
  }
  return plan;
}

function recoverCopywriterFailure(args: {
  textMode: "none" | "ai" | "exact";
  plan: AiMediaCreativePlan;
  recentPublications: readonly RecentMediaCopy[];
  keepSpokenCopy: boolean;
}) {
  if (args.textMode !== "ai") {
    return removeAiMediaFallbackCopy(args.plan, {
      keepSpokenCopy: args.keepSpokenCopy,
    });
  }
  const fallback = keepFreshLocalCopyOrRemove(
    args.plan,
    args.recentPublications
  );
  if (!normalizeAiMediaCopy(fallback.headline)) {
    // Un média qui promet du texte visible ne doit jamais atteindre le moteur
    // avec un calque vide. L'appel est arrêté proprement plutôt que de facturer
    // une image décorative impossible à utiliser.
    throw new Error("ai_media_visible_copy_unavailable");
  }
  return fallback;
}

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

type RecentMediaCopy = {
  title?: string | null;
  content?: string | null;
  idea?: string | null;
};

const RECENT_COPY_STOP_WORDS = new Set([
  "avec",
  "dans",
  "des",
  "elle",
  "elles",
  "est",
  "les",
  "notre",
  "nous",
  "pour",
  "plus",
  "que",
  "qui",
  "sur",
  "une",
  "votre",
  "vous",
  "and",
  "for",
  "from",
  "the",
  "this",
  "with",
  "your",
]);

function meaningfulCopyTokens(value: unknown) {
  return Array.from(
    new Set(
      normalizedWords(value)
        .split(" ")
        .filter(
          (token) => token.length >= 4 && !RECENT_COPY_STOP_WORDS.has(token)
        )
    )
  );
}

function recentCopyFragments(publications: readonly RecentMediaCopy[]) {
  return publications.slice(0, 20).flatMap((publication) => [
    publication.title || "",
    publication.idea || "",
    ...String(publication.content || "")
      .split(/[.!?\n|•]+/)
      .map((fragment) => fragment.trim())
      .filter(Boolean),
  ]);
}

/**
 * Contrôle local après génération. L'historique reste sur le serveur iNrCy et
 * n'est jamais ajouté à la requête envoyée au fournisseur de copywriting.
 */
function repeatsRecentVisibleCopy(
  values: readonly unknown[],
  publications: readonly RecentMediaCopy[]
) {
  const fragments = recentCopyFragments(publications).map((fragment) => ({
    normalized: normalizedWords(fragment),
    tokens: meaningfulCopyTokens(fragment),
  }));
  if (!fragments.length) return false;
  return values.some((value) => {
    const candidate = normalizedWords(value);
    if (candidate.length < 12) return false;
    const candidateTokens = meaningfulCopyTokens(candidate);
    return fragments.some((fragment) => {
      if (
        fragment.normalized.includes(candidate) ||
        (fragment.normalized.length >= 12 &&
          candidate.includes(fragment.normalized))
      ) {
        return true;
      }
      if (candidateTokens.length < 3 || fragment.tokens.length < 3) {
        return false;
      }
      const fragmentTokenSet = new Set(fragment.tokens);
      const shared = candidateTokens.filter((token) =>
        fragmentTokenSet.has(token)
      ).length;
      return shared / candidateTokens.length >= 0.8;
    });
  });
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
): AiMediaCreativePlan | null {
  const headline = compactHeadline(generated.headline);
  const cta = compactCopy(generated.cta, 58);
  if (!headline || !cta || isGenericMediaCopy(headline)) return null;

  const generatedScenes = Array.isArray(generated.scenes)
    ? generated.scenes
    : [];
  if (generatedScenes.length !== plan.scenes.length) return null;
  const visibleCopyDeck = [
    headline,
    cta,
    ...generatedScenes.flatMap((scene) => [
      scene?.eyebrow,
      scene?.title,
      scene?.body,
    ]),
  ].join(" ");
  if (!preservesAiMediaProtectedTerms(visibleCopyDeck, protectedTerms)) {
    return null;
  }
  if (
    requireSpokenTerms &&
    protectedTerms.length > 0 &&
    !preservesAiMediaProtectedTerms(generatedScenes[0]?.spokenLine, protectedTerms)
  ) {
    return null;
  }
  const usedDialogue = new Set<string>();
  const usedTitles = new Set<string>();
  const scenes = plan.scenes.map((scene, index) => {
    const candidate = generatedScenes[index];
    const generatedTitle =
      index === 0
        ? headline
        : compactCopy(candidate?.title, AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS);
    const titleSignature = aiMediaDialogueSignature(generatedTitle);
    const title =
      titleSignature && !usedTitles.has(titleSignature)
        ? generatedTitle
        : "";
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
        compactCopy(candidate.eyebrow, AI_MEDIA_VISIBLE_EYEBROW_MAX_CHARACTERS),
      title,
      body: compactCompleteBody(candidate.body),
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
  if (
    hasAiLanguageMismatch(language, visibleCopy) ||
    [headline, ...scenes.map((scene) => scene.title)].some(isGenericMediaCopy)
  ) {
    return null;
  }

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
  recentPublications?: readonly RecentMediaCopy[];
}): Promise<AiMediaCreativePlan> {
  const textMode =
    args.request.textMode || (args.request.withText ? "ai" : "none");
  const characterDialogueRequested =
    args.request.kind === "video" &&
    args.request.teamVideoSpeechMode === "characters";
  const voiceoverNarrationRequested =
    args.request.kind === "video" &&
    args.request.withNarration &&
    args.request.teamVideoSpeechMode !== "characters";
  const spokenCopyRequested =
    characterDialogueRequested || voiceoverNarrationRequested;
  if (textMode === "exact") return args.plan;
  if (textMode === "none" && !spokenCopyRequested) return args.plan;

  const languageCode = args.profile.preferences.language;
  // Tout texte visible ou prononcé passe par ce contrat éditorial central.
  // Un échec donne un média sans texte plutôt qu'un ancien slogan générique.
  const protectedTerms = collectAiMediaProtectedTerms({
    request: args.request,
    profile: args.profile,
  });

  try {
    const generated = await aiGenerateJSON<GeneratedMediaCopy>({
      feature: args.request.kind === "video" ? "media.video" : "media.image",
      accountId: args.accountId,
      model: String(
        process.env.AI_MEDIA_COPY_MODEL || getAiEngineOption("openai").model
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
        "Interdiction absolue des slogans passe-partout centrés sur un vague projet, une expertise non précisée, une solution sans objet concret ou une simple liste de qualités. Chaque accroche doit nommer un fait, un geste, un produit, un lieu, un service ou un résultat réellement présent dans le brief. Si les faits disponibles ne permettent pas une accroche spécifique, n'invente aucun cliché.",
        "Produis une formulation réellement singulière pour cette génération : varie l'angle, la construction, le vocabulaire, le CTA et la progression narrative au lieu de recycler une formule publicitaire familière. L'identifiant de variation fourni est un sel créatif opaque : utilise-le seulement pour faire varier tes choix, ne le cite jamais.",
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
        "Utilise uniquement les faits fournis : n’invente jamais de prix, promotion, certification, adresse, délai ni résultat garanti. Si le professionnel a fourni un prix, un nom d’offre, une périodicité ou une promotion, conserve-les exactement dans le deck visible.",
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
        mode_texte: textMode,
        structure_narrative: {
          nombre_de_scenes: args.plan.scenes.length,
          scenes: args.plan.scenes.map((_scene, index) => ({
            role_narratif:
              args.plan.scenes.length === 1
                ? "histoire_complete"
                : index === 0
                ? "ouverture"
                : index === args.plan.scenes.length - 1
                ? "conclusion"
                : "preuve",
          })),
        },
        identifiant_de_variation: args.request.requestId,
      }),
      responseSchema: MEDIA_COPY_SCHEMA,
      maxOutputTokens: 512,
      temperature: args.request.creativity === "bold" ? 0.88 : 0.65,
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
      return recoverCopywriterFailure({
        textMode,
        plan: args.plan,
        recentPublications: args.recentPublications || [],
        keepSpokenCopy: spokenCopyRequested,
      });
    }
    if (
      repeatsRecentVisibleCopy(
        [
          generated.headline,
          generated.cta,
          ...(Array.isArray(generated.scenes)
            ? generated.scenes.flatMap((scene) => [
                scene.title,
                scene.body,
                scene.spokenLine,
                scene.spokenReply,
              ])
            : []),
        ],
        args.recentPublications || []
      )
    ) {
      return recoverCopywriterFailure({
        textMode,
        plan: args.plan,
        recentPublications: args.recentPublications || [],
        keepSpokenCopy: spokenCopyRequested,
      });
    }
    const headline = compactHeadline(generated.headline);
    if (
      textMode === "ai" &&
      !isNaturalHeadline(
        headline,
        args.request.textKeywords,
        args.request.idea || args.request.aiInstruction,
        languageCode
      )
    ) {
      return recoverCopywriterFailure({
        textMode,
        plan: args.plan,
        recentPublications: args.recentPublications || [],
        keepSpokenCopy: spokenCopyRequested,
      });
    }
    const localized = applyLocalizedCopy(
      args.plan,
      generated,
      languageCode,
      protectedTerms,
      spokenCopyRequested
    );
    if (!localized) {
      return recoverCopywriterFailure({
        textMode,
        plan: args.plan,
        recentPublications: args.recentPublications || [],
        keepSpokenCopy: spokenCopyRequested,
      });
    }
    return textMode === "none"
      ? removeAiMediaFallbackCopy(localized, { keepSpokenCopy: true })
      : localized;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "ai_media_visible_copy_unavailable"
    ) {
      throw error;
    }
    return recoverCopywriterFailure({
      textMode,
      plan: args.plan,
      recentPublications: args.recentPublications || [],
      keepSpokenCopy: spokenCopyRequested,
    });
  }
}
