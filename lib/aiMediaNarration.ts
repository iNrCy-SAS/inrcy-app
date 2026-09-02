import "server-only";

import { createHash } from "node:crypto";

import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import type { AiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";

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
  10: { min: 17, target: 20, max: 24 },
  20: { min: 34, target: 40, max: 46 },
  30: { min: 51, target: 58, max: 64 },
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

function limitWords(value: string, maximum: number) {
  const items = words(value);
  if (items.length <= maximum) return clean(value);
  return `${items.slice(0, maximum).join(" ").replace(/[,;:]$/, "")}.`;
}

function sentence(value: unknown) {
  const normalized = clean(value, 180).replace(/[.!?]+$/g, "");
  return normalized ? `${normalized}.` : "";
}

function safeFallback(args: {
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  plan: AiMediaCreativePlan;
}) {
  const business = args.profile.business;
  const duration = args.request.durationSeconds || 10;
  const company = clean(business.companyName || args.plan.companyName, 80);
  const profession = clean(
    business.professionLabel || business.sectorLabel || "professionnel",
    100,
  );
  const service = clean(business.services[0] || args.plan.headline, 120);
  const strength = clean(
    business.strengths[0] || "une approche attentive et sur mesure",
    120,
  );
  const audience = clean(business.customerTypologies[0], 100);
  const location = clean(business.city || business.interventionZones[0], 80);
  const idea = clean(args.request.idea, 170);
  const lines = [
    sentence(
      idea
        ? `${company || profession} donne vie à votre projet autour de ${idea}`
        : `${company || profession} met ${service || "son savoir-faire"} au service de votre projet`,
    ),
    sentence(
      `${service || profession}, avec ${strength}`,
    ),
    audience
      ? sentence(`Une réponse concrète pensée pour ${audience}`)
      : sentence("Chaque besoin mérite une réponse claire et personnalisée"),
    location
      ? sentence(`Retrouvez cette expertise à ${location}`)
      : sentence(args.plan.cta || "Échangeons sur votre projet"),
  ].filter(Boolean);
  return limitWords(lines.join(" "), WORD_TARGETS[duration].max);
}

function validGeneratedScript(value: string, duration: 10 | 20 | 30) {
  const count = words(value).length;
  const target = WORD_TARGETS[duration];
  return (
    count >= target.min &&
    count <= target.max + 4 &&
    !/[+·|]/.test(value) &&
    !/(voici|script|narration|voix off)\s*:/i.test(value)
  );
}

/**
 * Écrit une voix off courte à partir des seules informations vérifiées du
 * profil. Le sujet donne la direction éditoriale ; il n'est jamais récité
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

  const duration = args.request.durationSeconds || 10;
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
        "Utilise uniquement les faits fournis. N'invente aucun prix, résultat, certification, promotion, délai, adresse ou témoignage.",
        "Aucune liste, addition de mots-clés, hashtag, emoji, titre, label, URL ou indication de mise en scène.",
        "Le résultat doit être immédiatement prononçable, humain, crédible et cohérent avec toutes les scènes.",
      ].join(" "),
      input: JSON.stringify({
        idee_du_professionnel: args.request.idea || null,
        entreprise: args.profile.business.companyName || null,
        metier:
          args.profile.business.professionLabel ||
          args.profile.business.sectorLabel ||
          null,
        presentation: args.profile.business.description || null,
        prestations: args.profile.business.services.slice(0, 6),
        forces: args.profile.business.strengths.slice(0, 4),
        clientele: args.profile.business.customerTypologies.slice(0, 4),
        ville: args.profile.business.city || null,
        zone: args.profile.business.interventionZones.slice(0, 3),
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
    if (validGeneratedScript(candidate, duration)) {
      script = limitWords(candidate, target.max);
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
    wordCount: words(script).length,
    source,
    sha256: createHash("sha256").update(script).digest("hex"),
  };
}

