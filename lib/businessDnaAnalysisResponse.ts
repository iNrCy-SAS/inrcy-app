export const BUSINESS_DNA_SOURCE_QUOTE_MAX_LENGTH = 160;

/**
 * Vocabulary suggestions are advisory lists already capped at 16 by aiMemory.
 * Prompt-only providers can repeat or overproduce these lists. Bound them before
 * strict schema validation so a valid analysis is not discarded for list size.
 * An oversized profession quote also discards only that advisory evidence.
 * Strict validation still catches malformed fields and factual schema errors.
 */
export function normalizeBusinessDnaAnalysisResponse(output: Record<string, unknown>) {
  let normalized = output;
  const rawSuggestion = output.professionSuggestion;
  if (rawSuggestion && typeof rawSuggestion === "object" && !Array.isArray(rawSuggestion)) {
    const suggestion = rawSuggestion as Record<string, unknown>;
    if (typeof suggestion.sourceQuote === "string" && suggestion.sourceQuote.length > BUSINESS_DNA_SOURCE_QUOTE_MAX_LENGTH &&
      (suggestion.confidence === "high" || suggestion.confidence === "uncertain")) {
      // A shortened citation could omit the words that support the profession.
      normalized = { ...output, professionSuggestion: { ...suggestion, sourceQuote: "", confidence: "uncertain" } };
    }
  }

  const rawMemory = output.memory;
  if (!rawMemory || typeof rawMemory !== "object" || Array.isArray(rawMemory)) return normalized;
  const memory = { ...rawMemory } as Record<string, unknown>;
  for (const field of ["preferredVocabulary", "forbiddenVocabulary"] as const) {
    const values = memory[field];
    if (!Array.isArray(values) || !values.every((value) => typeof value === "string" && value.length <= 140)) continue;
    const seen = new Set<string>();
    memory[field] = values.filter((value) => {
      const key = value.trim().toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 16);
  }
  return { ...normalized, memory };
}
