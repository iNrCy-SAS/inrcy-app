import "server-only";

import { createHash } from "node:crypto";

import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import type { AiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";
import { buildAiMediaBusinessDnaPayload } from "@/lib/aiMediaBusinessDna";
import { isAiMediaTechnicalCopyAllowed } from "./aiMediaTechnicalText.ts";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import { getAiEngineOption } from "@/lib/aiEnginePreference";
import { hasAiLanguageMismatch } from "@/lib/aiLanguageValidation";
import {
  completeAiMediaSpeechSentence,
  hasCompleteAiMediaSpeechEnding,
  hasNaturalAiMediaSpeechFlow,
} from "@/lib/aiMediaDialogue";

const NARRATION_SCHEMA = {
  name: "inrcy_media_narration",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      script: { type: "string", minLength: 12, maxLength: 620 },
    },
    required: ["script"],
  },
} as const;

const WORD_TARGETS = {
  // Au débit conversationnel demandé de 120–140 mots/minute, les plafonds
  // réservent une seconde finale. Le montage vérifie toujours la durée réelle :
  // un texte court reste permis, mais n'est plus la cible par défaut.
  8: { min: 8, target: 13, max: 14 },
  16: { min: 20, target: 27, max: 30 },
  24: { min: 31, target: 41, max: 44 },
} as const;

type NarrationWordTarget = { min: number; target: number; max: number };

function resolveNarrationWordTarget(
  duration: 8 | 16 | 24,
  maximumSpeechUnits?: number,
): NarrationWordTarget {
  const baseline = WORD_TARGETS[duration];
  if (!Number.isFinite(maximumSpeechUnits)) return baseline;
  // Le préflight audio peut demander une réécriture plus concise, mais jamais
  // un fragment inférieur au minimum éditorial naturel de la durée choisie.
  const maximum = Math.max(
    baseline.min,
    Math.min(baseline.max, Math.floor(Number(maximumSpeechUnits))),
  );
  return {
    min: baseline.min,
    target: Math.min(baseline.target, maximum),
    max: maximum,
  };
}

const LANGUAGE_NAMES: Record<string, string> = {
  fr: "français naturel de France",
  en: "natural British English",
  es: "español natural",
  it: "italiano naturale",
  de: "natürliches Deutsch",
  nl: "natuurlijk Nederlands",
  pt: "português natural",
  th: "ภาษาไทยที่เป็นธรรมชาติ",
  zh: "自然中文",
};

export type AiMediaNarration = {
  script: string;
  language: string;
  wordCount: number;
  source: "ai" | "safe_fallback";
  sha256: string;
};

type RecentNarrationContext = {
  title?: string | null;
  content?: string | null;
  idea?: string | null;
};

function comparisonText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericNarration(value: unknown) {
  const normalized = comparisonText(value);
  return [
    /votre projet (?:entre de bonnes mains|prend vie)/,
    /donne vie a vos projets/,
    /notre expertise (?:a votre service|des aujourd hui)/,
    /une solution (?:claire fiable|adaptee a vos besoins)/,
    /parlons ensemble de votre projet/,
  ].some((pattern) => pattern.test(normalized));
}

function repeatsRecentNarration(
  value: unknown,
  recentPublications: readonly RecentNarrationContext[]
) {
  const candidate = comparisonText(value);
  if (candidate.length < 20) return false;
  const candidateTokens = candidate.split(/\s+/u).filter(Boolean);
  const candidateSet = new Set(candidateTokens);
  return recentPublications.slice(0, 20).some((publication) => {
    const recent = comparisonText(
      `${publication.title || ""} ${publication.idea || ""} ${
        publication.content || ""
      }`
    );
    if (recent.includes(candidate)) return true;
    const recentSet = new Set(recent.split(/\s+/u).filter(Boolean));
    const sharedTokenCount = Array.from(candidateSet).filter((token) =>
      recentSet.has(token),
    ).length;
    const lexicalSimilarity =
      candidateSet.size > 0 ? sharedTokenCount / candidateSet.size : 0;
    return candidateTokens.length >= 7 && lexicalSimilarity >= 0.82;
  });
}

function clean(value: unknown, max = 620) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/^[\s"'«»*-]+|[\s"'«»*-]+$/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/#(?![\da-f]{3}(?:[\da-f]{3})?\b)|[*_`<>]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function words(value: string) {
  return clean(value).split(/\s+/u).filter(Boolean);
}

const NARRATION_GROUNDING_STOP_WORDS = new Set([
  "avec", "dans", "pour", "sans", "sous", "votre", "notre", "leurs",
  "cette", "elles", "nous", "vous", "mais", "plus", "tout", "tous",
  "that", "this", "your", "with", "from", "into", "des", "une",
  "les", "and", "the", "you", "our", "are", "est", "sur", "aux", "par",
]);

function narrationGroundingTokens(value: unknown) {
  return new Set(
    comparisonText(value)
      .split(/\s+/u)
      .filter(
        (token) =>
          token.length >= 4 && !NARRATION_GROUNDING_STOP_WORDS.has(token),
      ),
  );
}

/**
 * Une belle phrase hors sujet reste un échec. La narration doit reprendre au
 * moins un élément lexical précis du brief, du plan ou de l'ADN transmis.
 */
function isNarrationGrounded(args: {
  value: unknown;
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  plan: AiMediaCreativePlan;
}) {
  const candidateTokens = narrationGroundingTokens(args.value);
  if (!candidateTokens.size) return false;
  // Un autre service de l'ADN ne peut pas remplacer le sujet demandé. Pour
  // les langues traduites, le plan localisé reste la référence lexicale.
  const centralIdea = args.profile.preferences.language === "fr"
    ? narrationGroundingTokens(args.request.idea)
    : new Set<string>();
  if (centralIdea.size) {
    return Array.from(candidateTokens).some((token) => centralIdea.has(token));
  }
  const sourceTokens = narrationGroundingTokens(
    [
      args.request.idea,
      args.request.aiInstruction,
      args.plan.headline,
      args.plan.subline,
      args.plan.cta,
      ...args.plan.scenes.flatMap((scene) => [
        scene.title,
        scene.body,
        scene.visualBrief,
      ]),
      args.profile.business.companyName,
      args.profile.business.professionLabel,
      ...args.profile.business.services,
      ...args.profile.business.strengths,
    ]
      .filter(Boolean)
      .join(" "),
  );
  return Array.from(candidateTokens).some((token) => sourceTokens.has(token));
}

function stripNarrationDirectivePrefix(value: unknown, language: string) {
  if (String(value ?? "").trim().length > 620) return "";
  const candidate = clean(value, 620);
  if (language !== "fr") return candidate;
  const stripped = candidate.replace(
    /^(?:(?:explique|indique|dis|précise|annonce|montre|présente|fais comprendre)(?:z|r)?)(?:\s+clairement)?\s+(?:que|qu['’])\s+/iu,
    "",
  );
  return stripped
    ? `${stripped.charAt(0).toLocaleUpperCase()}${stripped.slice(1)}`
    : candidate;
}

function speechUnitCount(value: string, language: string) {
  if (language === "zh") {
    return Math.ceil((value.match(/\p{Script=Han}/gu)?.length || 0) / 2);
  }
  if (language === "th") {
    return Math.ceil((value.match(/\p{Script=Thai}/gu)?.length || 0) / 4);
  }
  return words(value).length;
}

function requestedNarrationInvitation(request: AiMediaGenerationRequest, language: string) {
  if (language !== "fr") return null;
  const brief = [request.idea, request.aiInstruction].filter(Boolean).join(". ");
  const match = brief.match(/(?:\b(?:voix(?:\s+off)?|narration|narrateur|narratrice)[^.!?\n]{0,90}?\binvit(?:e|er|ez|ant)|(?:^|[.!?]\s*)invit(?:e|er|ez))\b[^.!?\n]{0,30}?\sà\s+([^.!?\n]+)/iu);
  if (!match) return null;
  if (/\b(?:pas|jamais)\s+invit|\binvit\w*\s+(?:pas|jamais)\b/iu.test(match[0])) return null;
  const action = clean(match[1]);
  const spoken = /^venir\s+/iu.test(action)
    ? action.replace(/^venir\s+/iu, "Venez ")
    : `Nous vous invitons à ${action}`;
  const verb = comparisonText(action).split(/\s+/u).find((word) =>
    !["venir", "vous", "nous", "le", "la", "les", "en", "y"].includes(word),
  );
  return { spoken, verbStem: verb?.replace(/(?:er|ir|re)$/u, "") || "" };
}

function respectsNarrationInvitation(value: string, request: AiMediaGenerationRequest, language: string) {
  const invitation = requestedNarrationInvitation(request, language);
  if (!invitation) return true;
  const normalized = comparisonText(value);
  return /\b(?:venez|invit\w*|[a-z]{3,}ez)\b/u.test(normalized)
    && (!invitation.verbStem || normalized.split(/\s+/u).some((word) => word.startsWith(invitation.verbStem)));
}

function invitationWithFact(fact: string, invitation: string) {
  // Un contexte déjà prononcé (« pour votre petit déjeuner ») ne doit pas
  // être répété dans l'invitation (« au petit déjeuner »).
  let ending = invitation;
  const context = invitation.match(/\s(?:au|aux|à|pour|dans|en)\s+([^,;:]+)$/iu);
  if (context) {
    const tokens = [...narrationGroundingTokens(context[1])];
    const factTokens = narrationGroundingTokens(fact);
    if (tokens.length >= 2 && tokens.every((token) => factTokens.has(token))) {
      ending = invitation.slice(0, context.index);
    }
  }
  return `${fact.replace(/[.!?]+$/u, "")} : ${ending.charAt(0).toLocaleLowerCase()}${ending.slice(1)}.`;
}

function narrationDiagnostic(args: {
  request: AiMediaGenerationRequest;
  attempt: number;
  stage: "draft_rejected" | "generation_error" | "safe_fallback";
  reasons: string[];
  candidate?: string;
  error?: unknown;
}) {
  const error = args.error && typeof args.error === "object" ? args.error as { status?: unknown; name?: unknown } : null;
  // Aucun prompt, brouillon, message d'erreur fournisseur ou identifiant libre
  // n'est journalisé : ils peuvent contenir des données métier ou des secrets.
  console.warn("[ai-media] narration quality", JSON.stringify({
    requestHash: createHash("sha256").update(args.request.requestId).digest("hex").slice(0, 16),
    duration: args.request.durationSeconds || 8,
    attempt: args.attempt,
    stage: args.stage,
    reasons: args.reasons,
    ...(args.candidate !== undefined ? {
      candidateChars: args.candidate.length,
      candidateWords: words(args.candidate).length,
      candidateSha256: createHash("sha256").update(args.candidate).digest("hex"),
    } : {}),
    ...(typeof error?.status === "number" ? { status: error.status } : {}),
    ...(args.error ? { errorKind: error?.name === "AbortError" ? "aborted" : error?.name === "TimeoutError" ? "timeout" : "generation_failed" } : {}),
  }));
}

function respectsNarrationSentenceContract(
  value: string,
  duration: 8 | 16 | 24,
) {
  const sentenceCount =
    value
      .match(/[^.!?。！？]+[.!?。！？]+/gu)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean).length || 0;
  const maximumSentences = duration === 8 ? 1 : duration === 16 ? 2 : 3;
  return sentenceCount >= 1 && sentenceCount <= maximumSentences;
}

function safeFallback(args: {
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  plan: AiMediaCreativePlan;
  recentPublications: readonly RecentNarrationContext[];
  maximumSpeechUnits?: number;
}) {
  const business = args.profile.business;
  const duration = args.request.durationSeconds || 8;
  const language = args.profile.preferences.language || "fr";
  const target = resolveNarrationWordTarget(
    duration,
    args.maximumSpeechUnits,
  );
  const rawFacts = [
    args.request.idea,
    args.request.aiInstruction,
    args.plan.cta,
    ...args.plan.scenes.flatMap((scene) => [
      scene.spokenLine,
      scene.body,
      scene.title,
    ]),
    args.plan.headline,
    business.companyName || args.plan.companyName,
    ...business.services,
    ...business.strengths,
    business.professionLabel,
    business.city || business.interventionZones[0],
  ];
  const facts = Array.from(
    new Set(
      rawFacts
        .map((value) => stripNarrationDirectivePrefix(value, language))
        .filter(Boolean)
        .filter((value) => isAiMediaTechnicalCopyAllowed(value, args.request))
    )
  );
  if (!facts.length) return "";
  const invitation = requestedNarrationInvitation(args.request, language);

  // L'ordre varie avec la requête, tout en restant stable lors d'un retry.
  const seed = createHash("sha256")
    .update(args.request.requestId)
    .digest()
    .readUInt32BE(0);
  const initialOffset = seed % facts.length;
  for (let attempt = 0; attempt < facts.length; attempt += 1) {
    const offset = (initialOffset + attempt) % facts.length;
    const orderedFacts = [...facts.slice(offset), ...facts.slice(0, offset)];
    const candidates = invitation
      ? [...orderedFacts.filter((fact) => respectsNarrationInvitation(fact, args.request, language)),
        ...orderedFacts.filter((fact) => hasNaturalAiMediaSpeechFlow(fact, language)
          && !respectsNarrationInvitation(fact, args.request, language))
          .map((fact) => invitationWithFact(fact, invitation.spoken))]
      : orderedFacts;
    if (invitation && duration > 8) {
      const wholeFacts = orderedFacts.filter((fact) =>
        speechUnitCount(fact, language) >= 4 &&
        hasNaturalAiMediaSpeechFlow(fact, language) &&
        isNarrationGrounded({ ...args, value: fact }) &&
        !respectsNarrationInvitation(fact, args.request, language),
      );
      // À 16/24 s, relier deux faits complets puis UNE invitation évite
      // d'inviter deux fois ou de rejeter chaque courte réplique isolément.
      for (let index = 0; index < wholeFacts.length; index += 1) {
        let joined = completeAiMediaSpeechSentence(wholeFacts[index], language);
        for (let next = index + 1; next < wholeFacts.length && next < index + 3; next += 1) {
          joined = `${joined} ${completeAiMediaSpeechSentence(wholeFacts[next], language)}`;
          candidates.push(invitationWithFact(joined, invitation.spoken));
        }
      }
    }
    // Choisir une phrase proche de la durée prévue plutôt que le premier
    // fragment admissible ; l'ordre reste stable pour les candidats ex aequo.
    candidates.sort((left, right) => Math.abs(speechUnitCount(left, language) - target.target)
      - Math.abs(speechUnitCount(right, language) - target.target));

    // Une seule proposition déjà rédigée vaut toujours mieux qu'un collage de
    // libellés. C'est notamment le cas du brief libre fourni par l'utilisateur.
    for (const fact of candidates) {
      const sentence = completeAiMediaSpeechSentence(fact, language);
      const count = speechUnitCount(sentence, language);
      if (
        count >= target.min &&
        count <= target.max &&
        hasNaturalAiMediaSpeechFlow(sentence, language) &&
        respectsNarrationSentenceContract(sentence, duration) &&
        validGeneratedScript(sentence, duration, language, target) &&
        respectsNarrationInvitation(sentence, args.request, language) &&
        isNarrationGrounded({ ...args, value: sentence }) &&
        !isGenericNarration(sentence) &&
        !repeatsRecentNarration(sentence, args.recentPublications)
      ) {
        return sentence;
      }
    }

    let script = "";
    for (const fact of candidates) {
      const sentence = completeAiMediaSpeechSentence(fact, language);
      if (
        !sentence ||
        speechUnitCount(sentence, language) < 4 ||
        !hasNaturalAiMediaSpeechFlow(sentence, language)
      ) {
        continue;
      }
      const candidate = [script, sentence].filter(Boolean).join(" ");
      if (speechUnitCount(candidate, language) > target.max) continue;
      script = candidate;
      if (speechUnitCount(script, language) >= target.min) break;
    }
    if (
      speechUnitCount(script, language) >= target.min &&
      hasNaturalAiMediaSpeechFlow(script, language) &&
      respectsNarrationSentenceContract(script, duration) &&
      validGeneratedScript(script, duration, language, target) &&
      respectsNarrationInvitation(script, args.request, language) &&
      isNarrationGrounded({ ...args, value: script }) &&
      !isGenericNarration(script) &&
      !repeatsRecentNarration(script, args.recentPublications)
    ) {
      return script;
    }
  }
  return "";
}

function generatedScriptRejectionReasons(
  value: string,
  duration: 8 | 16 | 24,
  language: string,
  target = resolveNarrationWordTarget(duration),
) {
  const count = speechUnitCount(value, language);
  return [
    (count < target.min || count > target.max) && "word_budget",
    (/[+·|]/.test(value) || /(voici|script|narration|voix off)\s*:/i.test(value)) && "list_or_label",
    !hasCompleteAiMediaSpeechEnding(value, language) && "incomplete_ending",
    !hasNaturalAiMediaSpeechFlow(value, language) && "fragment_or_list",
    !respectsNarrationSentenceContract(value, duration) && "sentence_count",
    hasAiLanguageMismatch(language, value) && "language_mismatch",
  ].filter((reason): reason is string => Boolean(reason));
}

function validGeneratedScript(
  value: string,
  duration: 8 | 16 | 24,
  language: string,
  target = resolveNarrationWordTarget(duration),
) {
  return generatedScriptRejectionReasons(value, duration, language, target)
    .length === 0;
}

/**
 * Écrit une voix off courte à partir des seules informations vérifiées de
 * l'ADN de l'entreprise. Le sujet donne la direction éditoriale ; il n'est jamais récité
 * comme une consigne. Le secours local reste utilisable si le copywriter est
 * momentanément indisponible, avant tout appel vidéo coûteux.
 */
export async function writeAiMediaNarration(args: {
  accountId: string;
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  plan: AiMediaCreativePlan;
  recentPublications?: readonly RecentNarrationContext[];
  /** Réécriture plus concise demandée après mesure réelle de la piste TTS. */
  maximumSpeechUnits?: number;
}): Promise<AiMediaNarration | null> {
  if (args.request.kind !== "video" || !args.request.withNarration) return null;

  const duration = args.request.durationSeconds || 8;
  const target = resolveNarrationWordTarget(
    duration,
    args.maximumSpeechUnits,
  );
  const languageCode = args.profile.preferences.language || "fr";
  const language = LANGUAGE_NAMES[languageCode] || LANGUAGE_NAMES.fr;
  const sentenceContract =
    duration === 8
      ? "une seule phrase continue, ou exceptionnellement deux propositions étroitement liées"
      : duration === 16
      ? "deux phrases fluides qui forment un même discours"
      : "deux ou trois phrases fluides qui forment un même discours";
  let script = "";
  let source: AiMediaNarration["source"] = "safe_fallback";
  let rejectedDraft = "";
  let rejectedReasons: string[] = [];

  // Le clic utilisateur reste unique. Jusqu'à trois passes éditoriales très
  // peu coûteuses ont lieu AVANT l'appel vidéo : un brouillon refusé n'est
  // jamais envoyé au moteur ni exposé à l'utilisateur.
  for (let qualityAttempt = 0; qualityAttempt < 3 && !script; qualityAttempt += 1) {
    try {
      const generated = await aiGenerateJSON<{ script?: unknown }>({
        feature: "media.video",
        accountId: args.accountId,
        model: String(
          process.env.AI_MEDIA_COPY_MODEL || getAiEngineOption("openai").model
        ).trim(),
        system: [
          "Tu es le concepteur-rédacteur et scénariste voix off du studio iNrCy.",
          `Rédige uniquement le texte oral d'une vidéo professionnelle de ${duration} secondes, en ${language}.`,
          `Vise exactement ${target.target} mots et reste impérativement entre ${target.min} et ${target.max} mots.`,
          `Structure obligatoire : ${sentenceContract}.`,
          "Ce budget est volontairement court : privilégie une seule idée mémorable et des respirations naturelles plutôt qu'une accumulation d'informations.",
          duration === 8
            ? "Une seule idée orale suffit : nomme le produit ou le geste central et l'intention orale demandée. N'accumule pas ouverture, bénéfice et conclusion dans cette courte phrase."
            : "Construis un récit fluide avec des faits concrets du sujet, puis la conclusion ou l'invitation demandée.",
          "Produis une formulation singulière pour cette requête : ne recycle ni accroche, ni structure, ni vocabulaire d'une publication récente. L'identifiant de variation est un sel créatif opaque et ne doit jamais être prononcé.",
          "Interdiction des phrases passe-partout sur un vague projet, une expertise non précisée ou une solution générique. Chaque phrase doit nommer un fait, un geste, un produit, un lieu, un service ou un résultat réellement fourni.",
          "Le sujet du professionnel est le SUJET CENTRAL OBLIGATOIRE : n'en change ni les faits ni le sens et ne le remplace pas par un autre service. La voix n'est pas une audiodescription exhaustive : les scènes montrent les personnes, lieux et actions ; sélectionne seulement les faits nécessaires au message oral pour tenir le budget de mots.",
          "La consigne ponctuelle est PRIORITAIRE : respecte tous ses éléments narratifs utiles, même absents de l'ADN, sans jamais la réciter, la citer ou la présenter comme une instruction. Ne neutralise un fragment que pour la sécurité, les droits, une impossibilité technique ou un fait commercial non vérifié.",
          "Si le brief demande une invitation ou un appel à agir dans la voix, prononce réellement cette invitation : une simple description du produit ne suffit pas.",
          "Utilise uniquement les faits fournis. N'invente aucun prix, résultat, certification, promotion, délai, adresse ou témoignage.",
          "Aucune liste, addition de mots-clés, suite de fragments nominaux, hashtag, emoji, titre, label, URL ou indication de mise en scène.",
          "Chaque phrase contient un sujet, un verbe et un sens complet. Relie naturellement les idées avec des transitions ; ne prononce jamais des mots isolés séparés par des pauses.",
          "Les intentions de scène, couleurs et cadrages sont des directives visuelles : ne réciter aucun code couleur ni préfixe technique, sauf texte littéral explicitement demandé.",
          "Termine par une phrase complète et ponctuée. Ne commence jamais une dernière proposition que la limite de mots t'empêcherait de finir.",
          "Le résultat doit être immédiatement prononçable, humain, crédible et cohérent avec toutes les scènes.",
          qualityAttempt > 0
            ? "Le brouillon précédent a échoué au contrôle qualité. Réécris-le entièrement : ne le raccourcis pas mécaniquement et n'en conserve aucune suite de mots."
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        input: JSON.stringify({
          idee_du_professionnel: args.request.idea || null,
          consigne_ponctuelle: args.request.aiInstruction || null,
          adn_de_l_entreprise: args.request.subjectSource === "custom"
            ? null
            : buildAiMediaBusinessDnaPayload(args.profile),
          type_de_contenu: args.request.typology,
          ton: args.profile.preferences.tone,
          style: args.profile.preferences.communicationStyle,
          vouvoiement: args.profile.preferences.addressMode,
          accroche: args.plan.headline,
          conclusion: args.plan.cta,
          scenes: args.plan.scenes.map((scene) => ({
            titre: scene.title,
            intention: scene.visualBrief,
          })),
          publications_recentes_a_ne_pas_reprendre: (
            args.recentPublications || []
          )
            .slice(0, 12)
            .map((publication) => ({
              titre: clean(publication.title, 120),
              idee: clean(publication.idea, 180),
              contenu: clean(publication.content, 240),
            })),
          brouillon_rejete_a_ne_pas_reprendre: rejectedDraft || null,
          motifs_du_rejet: rejectedReasons,
          budget_oral: { minimum: target.min, cible: target.target, maximum: target.max },
          invitation_orale_prioritaire: requestedNarrationInvitation(args.request, languageCode)?.spoken || null,
          tentative_de_revision: qualityAttempt + 1,
          identifiant_de_variation: args.request.requestId,
        }),
        responseSchema: NARRATION_SCHEMA,
        // Le budget inclut l'enveloppe JSON et les tokens non visibles.
        maxOutputTokens: 512,
        temperature:
          (args.request.creativity === "bold" ? 0.75 : 0.35) +
          qualityAttempt * 0.08,
        retries: 0,
        timeoutMs: 20_000,
      });
      // Le modèle est normalement borné par le schéma ; ce contrôle protège
      // aussi les réponses malformées sans jamais couper leur dernier mot.
      const candidate = String(generated.script ?? "").trim().length <= 620
        ? clean(generated.script)
        : "";
      const rejectionReasons = [
        !isAiMediaTechnicalCopyAllowed(generated.script, args.request) && "technical_copy",
        ...generatedScriptRejectionReasons(
          candidate,
          duration,
          languageCode,
          target,
        ),
        !respectsNarrationInvitation(candidate, args.request, languageCode) && "requested_invitation_missing",
        !isNarrationGrounded({
          value: candidate,
          request: args.request,
          profile: args.profile,
          plan: args.plan,
        }) && "off_brief",
        isGenericNarration(candidate) && "generic_copy",
        repeatsRecentNarration(candidate, args.recentPublications || []) && "recent_duplicate",
      ].filter((reason): reason is string => Boolean(reason));
      if (!rejectionReasons.length) {
        script = completeAiMediaSpeechSentence(candidate, languageCode);
        source = "ai";
      } else {
        narrationDiagnostic({ request: args.request, attempt: qualityAttempt + 1, stage: "draft_rejected", reasons: rejectionReasons, candidate });
        rejectedDraft = candidate;
        rejectedReasons = rejectionReasons;
      }
    } catch (error) {
      narrationDiagnostic({ request: args.request, attempt: qualityAttempt + 1, stage: "generation_error", reasons: ["generation_failed"], error });
      // Une passe rédactionnelle indisponible ne déclenche jamais une vidéo
      // muette : les autres passes puis le secours cohérent prennent le relais.
    }
  }

  if (!script) {
    script = safeFallback({
      ...args,
      recentPublications: args.recentPublications || [],
    });
    narrationDiagnostic({ request: args.request, attempt: 3, stage: "safe_fallback", reasons: [script ? "grounded_local_copy" : "no_valid_local_copy"], candidate: script });
  }
  if (!script) return null;
  return {
    script,
    language: languageCode,
    wordCount: speechUnitCount(script, languageCode),
    source,
    sha256: createHash("sha256").update(script).digest("hex"),
  };
}
