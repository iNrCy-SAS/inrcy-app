export type AiJsonObject = Record<string, unknown>;

export type AiJsonResponseNormalizer = (value: AiJsonObject) => unknown;

export class AiJsonResponseNormalizationError extends Error {
  readonly code = "ai_gateway_invalid_output";

  constructor(reason: "normalizer_failed" | "not_an_object") {
    super(
      reason === "normalizer_failed"
        ? "Service IA : la normalisation de la sortie JSON a échoué."
        : "Service IA : la normalisation de la sortie JSON n'a pas produit un objet.",
    );
    this.name = "AiJsonResponseNormalizationError";
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
  } catch {
    throw new AiJsonResponseNormalizationError("normalizer_failed");
  }

  if (!isJsonObject(normalized)) {
    throw new AiJsonResponseNormalizationError("not_an_object");
  }
  return normalized;
}
