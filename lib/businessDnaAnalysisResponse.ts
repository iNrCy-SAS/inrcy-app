/**
 * Vocabulary suggestions are advisory lists already capped at 16 by aiMemory.
 * Prompt-only providers can repeat or overproduce these lists. Bound them before
 * strict schema validation so a valid analysis is not discarded for list size.
 * Missing fields, invalid types, long items and unknown keys remain untouched:
 * the canonical schema must still reject malformed provider output.
 */
export function normalizeBusinessDnaAnalysisResponse(output: Record<string, unknown>) {
  const rawMemory = output.memory;
  if (!rawMemory || typeof rawMemory !== "object" || Array.isArray(rawMemory)) return output;
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
  return { ...output, memory };
}
