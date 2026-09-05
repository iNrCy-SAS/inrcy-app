import "server-only";

import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import type { AiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";
import { buildAiMediaBusinessDnaPayload } from "@/lib/aiMediaBusinessDna";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import { hasAiLanguageMismatch } from "@/lib/aiLanguageValidation";
import {
  buildAiLanguageInstruction,
  getAiLanguageLabel,
} from "@/lib/aiWritingProfile";

const MEDIA_COPY_SCHEMA = {
  name: "inrcy_media_visible_copy",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string", minLength: 3, maxLength: 58 },
      cta: { type: "string", minLength: 2, maxLength: 58 },
      scenes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            eyebrow: { type: "string", minLength: 1, maxLength: 38 },
            title: { type: "string", minLength: 2, maxLength: 86 },
            body: { type: "string", minLength: 0, maxLength: 150 },
          },
          required: ["eyebrow", "title", "body"],
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
  }>;
};

function compactHeadline(value: unknown) {
  const normalized = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/^[\s"'«»]+|[\s"'«»]+$/g, "")
    .replace(/[+·|/]+/g, " ")
    .replace(/[#*_`<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= 58) return normalized;
  const words = normalized.slice(0, 59).replace(/\s+\S*$/, "").trim();
  return `${words || normalized.slice(0, 57).trim()}…`;
}

function compactCopy(value: unknown, maximum: number) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/^[\s"'«»]+|[\s"'«»]+$/g, "")
    .replace(/[#*_`<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function isNaturalHeadline(value: string, keywords: readonly string[]) {
  if (value.length < 3 || /[+·|]/.test(value)) return false;
  if (keywords.length > 1 && value.split(/\s+/).length < 4) return false;
  const rawList = keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return value.toLocaleLowerCase() !== rawList;
}

function applyLocalizedCopy(
  plan: AiMediaCreativePlan,
  generated: GeneratedMediaCopy,
  language: NormalizedAiGenerationProfile["preferences"]["language"],
) {
  const headline = compactHeadline(generated.headline);
  const cta = compactCopy(generated.cta, 58);
  if (!headline || !cta) return plan;

  const generatedScenes = Array.isArray(generated.scenes) ? generated.scenes : [];
  const scenes = plan.scenes.map((scene, index) => {
    const candidate = generatedScenes[index];
    if (!candidate) {
      return index === 0 ? { ...scene, title: headline } : scene;
    }
    return {
      ...scene,
      eyebrow: compactCopy(candidate.eyebrow, 38) || scene.eyebrow,
      title:
        index === 0
          ? headline
          : compactCopy(candidate.title, 86) || scene.title,
      body: compactCopy(candidate.body, 150),
    };
  });
  const visibleCopy = [
    headline,
    cta,
    ...scenes.flatMap((scene) => [scene.eyebrow, scene.title, scene.body]),
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
  if (!args.request.withText) return args.plan;

  const languageCode = args.profile.preferences.language;
  // Le plan français est déjà publiable sans appel supplémentaire. Une saisie
  // de mots-clés, toute langue étrangère ou le mode ADN passe par le copywriter
  // afin que le texte visible exploite réellement le contexte professionnel.
  if (
    languageCode === "fr" &&
    !args.request.textKeywords.length &&
    !args.request.aiInstruction &&
    args.request.subjectSource !== "profile"
  ) {
    return args.plan;
  }

  try {
    const generated = await aiGenerateJSON<GeneratedMediaCopy>({
      feature: args.request.kind === "video" ? "media.video" : "media.image",
      accountId: args.accountId,
      model: String(process.env.AI_MEDIA_COPY_MODEL || "openai/gpt-4o-mini").trim(),
      system: [
        "Tu es le directeur éditorial multilingue du studio média iNrCy.",
        buildAiLanguageInstruction(args.profile),
        `Tous les textes réellement visibles dans le média doivent être en ${getAiLanguageLabel(args.profile)} : headline, cta, eyebrow, title et body de chaque scène.`,
        "Adapte ou traduis les informations utiles de l’ADN de l’entreprise dans cette langue sans traduire les noms propres, marques ou villes.",
        "Retourne exactement le même nombre de scènes et conserve leur ordre.",
        "Rédige une accroche publicitaire courte, naturelle, idiomatique et crédible.",
        "Les mots-clés sont des idées sémantiques à intégrer intelligemment dans le sens d'une phrase : ne les additionne jamais, ne les liste jamais et n'utilise jamais +, ·, / ou des hashtags.",
        "L'idée du professionnel sert d'inspiration et ne doit pas être recopiée mot pour mot.",
        "La consigne ponctuelle sert uniquement à orienter cette génération. Applique son intention lorsqu'elle est compatible avec l'ADN et la sécurité, sans jamais la citer ni la recopier.",
        "L'accroche contient au maximum 58 caractères. Aucun guillemet, emoji ou promesse inventée.",
        "Utilise uniquement les faits fournis et n'ajoute ni prix, promotion, certification, adresse, délai ni résultat garanti.",
      ].join(" "),
      input: JSON.stringify({
        langue_cible: getAiLanguageLabel(args.profile),
        idee: args.request.idea || null,
        consigne_ponctuelle: args.request.aiInstruction || null,
        mots_a_evoquer: args.request.textKeywords,
        adn_de_l_entreprise: buildAiMediaBusinessDnaPayload(args.profile),
        type_de_contenu: args.request.typology,
        copie_visible_de_secours: {
          headline: args.plan.headline,
          cta: args.plan.cta,
          scenes: args.plan.scenes.map((scene) => ({
            eyebrow: scene.eyebrow,
            title: scene.title,
            body: scene.body,
          })),
        },
      }),
      responseSchema: MEDIA_COPY_SCHEMA,
      maxOutputTokens: 512,
      temperature: args.request.creativity === "bold" ? 0.85 : 0.45,
      retries: 0,
      timeoutMs: 18_000,
    });
    const headline = compactHeadline(generated.headline);
    if (!isNaturalHeadline(headline, args.request.textKeywords)) return args.plan;
    return applyLocalizedCopy(args.plan, generated, languageCode);
  } catch {
    return args.plan;
  }
}
