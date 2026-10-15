export type AiJsonObject = Record<string, unknown>;

export type AiJsonResponseNormalizer = (value: AiJsonObject) => unknown;

export class AiJsonResponseNormalizationError extends Error {
  readonly code = "ai_gateway_invalid_output";
  readonly validationReason?: "script_empty" | "script_character_budget" | "script_speech_budget" | "dialogue_empty" | "dialogue_budget";

  constructor(reason: "normalizer_failed" | "not_an_object", validationReason?: AiJsonResponseNormalizationError["validationReason"]) {
    super(
      reason === "normalizer_failed"
        ? `Service IA : la normalisation de la sortie JSON a échoué.${validationReason ? ` [${validationReason}]` : ""}`
        : "Service IA : la normalisation de la sortie JSON n'a pas produit un objet.",
    );
    this.name = "AiJsonResponseNormalizationError";
    this.validationReason = validationReason;
  }
}

function isJsonObject(value: unknown): value is AiJsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Applique une normalisation métier bornée à un objet JSON déjà parsé.
 *
 * Le résultat reste volontairement non validé ici : le client Gateway doit
 * toujours exécuter ensuite la validation canonique contre le JSON Schema.
 * Aucun contenu fournisseur n'est inclus dans les erreurs afin de ne pas
 * exposer de données métier dans les logs.
 */
export function normalizeAiJsonResponseBeforeValidation(
  value: AiJsonObject,
  normalizer?: AiJsonResponseNormalizer,
): AiJsonObject {
  if (!normalizer) return value;

  let normalized: unknown;
  try {
    normalized = normalizer(value);
  } catch (error) {
    // Strict allowlist: report a business validation category, never the draft,
    // exception text, or user data. Gateway retries retain their existing code.
    const reasons: Record<string, AiJsonResponseNormalizationError["validationReason"]> = {
      ai_media_narration_script_empty: "script_empty",
      ai_media_narration_character_budget: "script_character_budget",
      ai_media_narration_speech_budget: "script_speech_budget",
      ai_media_dialogue_empty: "dialogue_empty",
      ai_media_dialogue_budget: "dialogue_budget",
    };
    const reason = error instanceof Error && Object.hasOwn(reasons, error.message) ? reasons[error.message] : undefined;
    throw new AiJsonResponseNormalizationError("normalizer_failed", reason);
  }

  if (!isJsonObject(normalized)) {
    throw new AiJsonResponseNormalizationError("not_an_object");
  }
  return normalized;
}
