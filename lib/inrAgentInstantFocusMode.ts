export type InrAgentInstantFocusMode = "saved_idea" | "business_dna";

/** A manual lightning generation draws equally between a free ADN topic and an available idea. */
export function chooseInrAgentInstantFocusMode(
  availableIdeaCount: number,
  randomDraw: number,
): InrAgentInstantFocusMode {
  if (availableIdeaCount <= 0) return "business_dna";
  return randomDraw === 0 ? "saved_idea" : "business_dna";
}
