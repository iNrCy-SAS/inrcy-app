import {
  AI_MEDIA_VIDEO_MODELS,
  getAiMediaVideoNativeDurations,
  type AiMediaImageEngine,
  type AiMediaVideoEngine,
  type AiMediaVideoSceneMode,
} from "./aiMediaModelCatalog.ts";
import {
  estimateAiMediaVideoSupplierCostMicroUsd,
  quoteAiMediaCredits,
} from "./aiMediaCreditsPricing.ts";

export type AiMediaModelRecommendationInput = {
  kind: "image" | "video";
  operation?: "generate" | "modify";
  format?: unknown;
  brief?: string;
  durationSeconds?: number | null;
  sceneMode?: AiMediaVideoSceneMode;
  withNarration?: boolean;
  teamVideoSpeechMode?: "characters" | "voiceover";
  language?: string;
  inspirationImagesCount?: number;
  inputMode?: "legacy" | "essential";
  identityMode?: string;
};

export type AiMediaModelRecommendationReason =
  | "french-speech"
  | "economy"
  | "photo-animation"
  | "continuous-long"
  | "precise-image"
  | "image-creation";

export type AiMediaModelRecommendation = Readonly<{
  engine: AiMediaVideoEngine | AiMediaImageEngine;
  reason: AiMediaModelRecommendationReason;
}>;

const normalizedText = (value: string) => value.normalize("NFD")
  .replace(/\p{M}/gu, "").toLowerCase();

function wantsFrenchSpeech(input: AiMediaModelRecommendationInput, brief: string): boolean {
  const explicitFrench = /\b(?:francais|french)\b/u.test(brief);
  const otherSpokenLanguage = /\b(?:en anglais|in english|en espagnol|in spanish|en allemand|in german)\b/u.test(brief);
  const french = explicitFrench || (!otherSpokenLanguage && /^(?:fr(?:$|[-_])|francais$|french$)/iu.test(input.language ?? "fr"));
  const speechBrief = brief.replace(/\b(?:sans|aucune?|no|without)\s+(?:voix(?:\s+off)?|voice(?:\s+over)?|dialogues?|narration)(?:\s+(?:ni|and|or)\s+(?:voix(?:\s+off)?|voice(?:\s+over)?|dialogues?|narration))*\b/gu, "");
  const speech = input.withNarration === true || input.teamVideoSpeechMode === "characters" ||
    /\b(?:voix|voice(?:over)?|dialogues?|narration|parl(?:e(?:r|z|nt)?|ant)|dit|dire|says?|speaks?|spoken)\b/u.test(speechBrief);
  return french && speech;
}

/** A deterministic suggestion only. The selected model and duration remain the user's choice. */
export function recommendAiMediaModel(input: AiMediaModelRecommendationInput): AiMediaModelRecommendation | null {
  const references = input.inspirationImagesCount ?? 0;
  if (!Number.isSafeInteger(references) || references < 0 || references > 5) return null;
  const brief = normalizedText(input.brief ?? "");
  if (input.kind === "image") {
    const compatible = (engine: AiMediaImageEngine) => {
      try { quoteAiMediaCredits({ ...input, imageEngine: engine }); return true; }
      catch { return false; }
    };
    const positiveBrief = brief.replace(/\b(?:sans|aucun|no|without)\s+(?:texte|text|logo)(?:\s+(?:ni|and|or)\s+(?:texte|text|logo))*\b/gu, "");
    const precise = /\b(?:text(?:e)?|typograph(?:ie|y)|orthographe|flyer|affiche|poster|banniere|banner|infograph(?:ie|ic)|fiche produit|logo|lettrage|inscription|ecri(?:t|re)|titres?|slogan|prix|tarifs?)\b/u.test(positiveBrief);
    if (precise && compatible("openai")) return { engine: "openai", reason: "precise-image" };
    if (/\b(?:economique|budget|low cost|cheap|moins cher)\b/u.test(brief) && compatible("grok")) {
      return { engine: "grok", reason: "economy" };
    }
    if (references > 0 && /\b(?:produit|product|packshot|marque|brand|couleurs?)\b/u.test(brief) && compatible("flux")) {
      return { engine: "flux", reason: "image-creation" };
    }
    if (/\b(?:illustration|graphique|graphic|icone|icon)\b/u.test(brief) && compatible("recraft")) {
      return { engine: "recraft", reason: "image-creation" };
    }
    return compatible("gemini") ? { engine: "gemini", reason: "image-creation" } : null;
  }
  if (input.kind !== "video") return null;
  const duration = input.durationSeconds ?? 8;
  const sceneMode = input.sceneMode ?? "single";
  if (!Number.isSafeInteger(duration) || duration < 4 || duration > 30 ||
    (sceneMode !== "single" && sceneMode !== "multi")) return null;

  // The same pure quote validates native durations and references, including
  // essential/team first-frame composition. A suggestion cannot bypass it.
  const compatible = AI_MEDIA_VIDEO_MODELS.flatMap((model) => {
    // Wan Flash's native prompt limit is enforced at request validation too.
    if (model.id === "wan-flash" && (input.brief?.length ?? 0) > 1_500) return [];
    try {
      const quoteInput = {
        ...input,
        durationSeconds: duration,
        sceneMode,
        videoEngine: model.id,
        videoResolution: model.defaultResolution,
      };
      quoteAiMediaCredits(quoteInput);
      return [{ model, supplierCost: estimateAiMediaVideoSupplierCostMicroUsd(quoteInput) }];
    } catch { return []; }
  });
  const find = (engine: AiMediaVideoEngine) => compatible.find((candidate) => candidate.model.id === engine);
  if (wantsFrenchSpeech(input, brief) && find("minimax-h3")) {
    return { engine: "minimax-h3", reason: "french-speech" };
  }
  const continuous = find("wan3");
  if (sceneMode === "single" && duration >= 16 && continuous &&
    getAiMediaVideoNativeDurations("wan3", continuous.model.defaultResolution).includes(duration)) {
    return { engine: "wan3", reason: "continuous-long" };
  }
  if (references > 0 && find("wan-flash")) {
    return { engine: "wan-flash", reason: "photo-animation" };
  }
  // Rates come from the public catalogue, not an unsupported quality ranking.
  const economy = compatible.sort((first, second) => first.supplierCost - second.supplierCost)[0];
  return economy ? { engine: economy.model.id, reason: "economy" } : null;
}
