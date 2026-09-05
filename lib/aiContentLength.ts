import type { DashboardEdition } from "@/lib/dashboardEdition";

export const AI_CONTENT_LENGTH_VALUES = [
  "adapted",
  "short",
  "medium",
  "long",
  "deep",
] as const;

export type AiContentLength = (typeof AI_CONTENT_LENGTH_VALUES)[number];

const AI_CONTENT_LENGTH_SET = new Set<string>(AI_CONTENT_LENGTH_VALUES);

/**
 * Migration douce des anciennes valeurs. L'ancien mode `detailed` correspond
 * désormais à `long`; `deep` est le nouveau niveau Premium le plus développé.
 */
export function normalizeAiContentLength(
  value: unknown,
  fallback: AiContentLength = "medium",
): AiContentLength {
  const raw = String(value ?? "").trim().toLocaleLowerCase();
  if (AI_CONTENT_LENGTH_SET.has(raw)) return raw as AiContentLength;
  if (["auto", "automatic", "automatique", "adapte", "adapté"].includes(raw)) {
    return "adapted";
  }
  if (["court", "courte", "brief"].includes(raw)) return "short";
  if (["moyen", "moyenne", "balanced"].includes(raw)) return "medium";
  if (["detailed", "detaille", "détaillé", "developpe", "développé"].includes(raw)) {
    return "long";
  }
  if (["approfondi", "approfondie", "tres_detaille", "très détaillé", "very_detailed"].includes(raw)) {
    return "deep";
  }
  return fallback;
}

export function enforceAiContentLengthForEdition(
  value: unknown,
  edition: DashboardEdition | unknown,
  fallback: AiContentLength = "medium",
): AiContentLength {
  const normalized = normalizeAiContentLength(value, fallback);
  return normalized === "deep" && edition === "standard" ? "long" : normalized;
}

