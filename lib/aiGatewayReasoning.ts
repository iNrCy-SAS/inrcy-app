/**
 * Different iNrCy workflows have intentionally different reasoning budgets.
 * Short editorial JSON must not spend its whole output allowance reasoning,
 * whereas a campaign plan benefits from a careful strategic pass before the
 * professional commits any advertising budget.
 */
export function resolveAiMediaEditorialReasoning(feature: string, model: string) {
  const id = model.trim().replace(/^openai\//, "");

  if (feature === "ads.generate" && /^gpt-6-(?:astra|sol|luna)$/.test(id)) {
    return { effort: "high" as const };
  }

  const shortEditorialFeatures = ["media.image", "media.video", "agent.stats-report"];
  const publicationFeatures = ["booster.publish", "agent.publish"];
  // The live Gateway catalog advertises low/high for this exact fallback.
  // Its default reasoning exhausted editorial JSON budgets in production,
  // including small publication batches. Keep the existing output/cost caps.
  if (model.trim() === "google/gemini-3-flash"
    && [...shortEditorialFeatures, ...publicationFeatures].includes(feature)) {
    return { effort: "low" as const };
  }
  if (!shortEditorialFeatures.includes(feature)) return undefined;
  if (!/^gpt-5\.6(?:-(?:luna|terra|sol))?$/.test(id)) return undefined;
  return { effort: "none" as const };
}
