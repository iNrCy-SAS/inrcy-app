/** Short editorial JSON must not spend its entire output budget on reasoning.
 * Scoped to media copy and the explicitly supported GPT-5.6 family, including
 * the direct fallback; other engines and other product workflows stay intact.
 * https://developers.openai.com/api/docs/models/gpt-5.6-luna
 */
export function resolveAiMediaEditorialReasoning(feature: string, model: string) {
  if (feature !== "media.image" && feature !== "media.video") return undefined;
  const id = model.trim().replace(/^openai\//, "");
  if (!/^gpt-5\.6(?:-(?:luna|terra|sol))?$/.test(id)) return undefined;
  return { effort: "none" as const };
}
