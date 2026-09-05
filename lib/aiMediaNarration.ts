import "server-only";

import { createHash } from "node:crypto";

import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import type { AiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";
import { buildAiMediaBusinessDnaPayload } from "@/lib/aiMediaBusinessDna";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import { hasAiLanguageMismatch } from "@/lib/aiLanguageValidation";
import { buildAiMediaNarrationFallback } from "@/lib/aiMediaLanguage";

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
  8: { min: 13, target: 16, max: 19 },
  16: { min: 27, target: 32, max: 37 },
  24: { min: 41, target: 47, max: 52 },
} as const;

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

function clean(value: unknown, max = 620) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/^[\s"'«»*-]+|[\s"'«»*-]+$/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[#*_`<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function words(value: string) {
  return clean(value).split(/\s+/u).filter(Boolean);
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

function limitSpeech(value: string, maximum: number, language: string) {
  if (language === "zh" || language === "th") {
    const charactersPerUnit = language === "zh" ? 2.35 : 4.3;
    const characters = Array.from(clean(value));
    const maximumCharacters = Math.max(12, Math.floor(maximum * charactersPerUnit));
    if (characters.length <= maximumCharacters) return clean(value);
    return `${characters.slice(0, maximumCharacters).join("").replace(/[，、；：,.!?。！？]+$/u, "")}。`;
  }
  const items = words(value);
  if (items.length <= maximum) return clean(value);
  return `${items.slice(0, maximum).join(" ").replace(/[,;:]$/, "")}.`;
}

function safeFallback(args: {
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  plan: AiMediaCreativePlan;
}) {
  const business = args.profile.business;
  const duration = args.request.durationSeconds || 8;
  const language = args.profile.preferences.language || "fr";
  const company = clean(business.companyName || args.plan.companyName, 80);
  const location = clean(business.city || business.interventionZones[0], 80);
  const localized = buildAiMediaNarrationFallback({
    language,
    company,
    location,
  });
  return limitSpeech(localized, WORD_TARGETS[duration].max, language);
}

function validGeneratedScript(
  value: string,
  duration: 8 | 16 | 24,
  language: string,
) {
  const count = speechUnitCount(value, language);
  const target = WORD_TARGETS[duration];
  return (
    count >= target.min &&
    count <= target.max + 4 &&
    !/[+·|]/.test(value) &&
    !/(voici|script|narration|voix off)\s*:/i.test(value) &&
    !hasAiLanguageMismatch(language, value)
  );
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
}): Promise<AiMediaNarration | null> {
  if (args.request.kind !== "video" || !args.request.withNarration) return null;

  const duration = args.request.durationSeconds || 8;
  const target = WORD_TARGETS[duration];
  const languageCode = args.profile.preferences.language || "fr";
  const language = LANGUAGE_NAMES[languageCode] || LANGUAGE_NAMES.fr;
  let script = "";
  let source: AiMediaNarration["source"] = "safe_fallback";

  try {
    const generated = await aiGenerateJSON<{ script?: unknown }>({
      feature: "media.video",
      accountId: args.accountId,
      model: String(process.env.AI_MEDIA_COPY_MODEL || "openai/gpt-4o-mini").trim(),
      system: [
        "Tu es le concepteur-rédacteur et scénariste voix off du studio iNrCy.",
        `Rédige uniquement le texte oral d'une vidéo professionnelle de ${duration} secondes, en ${language}.`,
        `Vise exactement ${target.target} mots et reste impérativement entre ${target.min} et ${target.max} mots.`,
        "Construis un mini-récit fluide : une idée d'ouverture, un bénéfice concret lié au vrai métier, puis une conclusion naturelle.",
        "Le sujet est une intention à interpréter, jamais une phrase à recopier ni une instruction à réciter.",
        "La consigne ponctuelle oriente la création mais ne doit jamais être récitée, citée ou présentée comme une instruction.",
        "Utilise uniquement les faits fournis. N'invente aucun prix, résultat, certification, promotion, délai, adresse ou témoignage.",
        "Aucune liste, addition de mots-clés, hashtag, emoji, titre, label, URL ou indication de mise en scène.",
        "Le résultat doit être immédiatement prononçable, humain, crédible et cohérent avec toutes les scènes.",
      ].join(" "),
      input: JSON.stringify({
        idee_du_professionnel: args.request.idea || null,
        consigne_ponctuelle: args.request.aiInstruction || null,
        adn_de_l_entreprise: buildAiMediaBusinessDnaPayload(args.profile),
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
      }),
      responseSchema: NARRATION_SCHEMA,
      maxOutputTokens: 128,
      temperature: args.request.creativity === "bold" ? 0.75 : 0.35,
      retries: 0,
      timeoutMs: 20_000,
    });
    const candidate = clean(generated.script);
    if (validGeneratedScript(candidate, duration, languageCode)) {
      script = limitSpeech(candidate, target.max, languageCode);
      source = "ai";
    }
  } catch {
    // Le secours déterministe ci-dessous empêche une petite panne éditoriale
    // de lancer une coûteuse génération vidéo sans narration exploitable.
  }

  if (!script) script = safeFallback(args);
  return {
    script,
    language: languageCode,
    wordCount: speechUnitCount(script, languageCode),
    source,
    sha256: createHash("sha256").update(script).digest("hex"),
  };
}
