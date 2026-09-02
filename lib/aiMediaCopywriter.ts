import "server-only";

import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import type { AiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";

const HEADLINE_SCHEMA = {
  name: "inrcy_media_headline",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string", minLength: 3, maxLength: 58 },
    },
    required: ["headline"],
  },
} as const;

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

function applyHeadline(plan: AiMediaCreativePlan, headline: string) {
  return {
    ...plan,
    headline,
    scenes: plan.scenes.map((scene, index) =>
      index === 0 ? { ...scene, title: headline } : scene,
    ),
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
  if (!args.request.withText || !args.request.textKeywords.length) return args.plan;

  const business = args.profile.business;
  try {
    const generated = await aiGenerateJSON<{ headline?: unknown }>({
      feature: args.request.kind === "video" ? "media.video" : "media.image",
      accountId: args.accountId,
      model: String(process.env.AI_MEDIA_COPY_MODEL || "openai/gpt-4o-mini").trim(),
      system: [
        "Tu es le directeur éditorial français du studio média iNrCy.",
        "Rédige UNE accroche publicitaire courte, naturelle, idiomatique et crédible.",
        "Les mots-clés sont des idées sémantiques à intégrer intelligemment dans le sens d'une phrase : ne les additionne jamais, ne les liste jamais et n'utilise jamais +, ·, / ou des hashtags.",
        "L'idée du professionnel sert d'inspiration et ne doit pas être recopiée mot pour mot.",
        "Maximum 58 caractères. Aucun guillemet, emoji ou promesse inventée.",
      ].join(" "),
      input: JSON.stringify({
        idee: args.request.idea || null,
        mots_a_evoquer: args.request.textKeywords,
        entreprise: business.companyName || null,
        metier: business.professionLabel || business.sectorLabel || null,
        prestations: business.services.slice(0, 6),
        forces: business.strengths.slice(0, 4),
        clientele: business.customerTypologies.slice(0, 4),
        type_de_contenu: args.request.typology,
        accroche_de_secours: args.plan.headline,
      }),
      responseSchema: HEADLINE_SCHEMA,
      maxOutputTokens: 128,
      temperature: args.request.creativity === "bold" ? 0.85 : 0.45,
      retries: 0,
      timeoutMs: 18_000,
    });
    const headline = compactHeadline(generated.headline);
    if (!isNaturalHeadline(headline, args.request.textKeywords)) return args.plan;
    return applyHeadline(args.plan, headline);
  } catch {
    return args.plan;
  }
}
