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

  if (feature !== "media.image" && feature !== "media.video") return undefined;
  if (!/^gpt-5\.6(?:-(?:luna|terra|sol))?$/.test(id)) return undefined;
  return { effort: "none" as const };
}
