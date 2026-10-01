const OPENAI_MODELS_WITHOUT_TEMPERATURE = [
  /^gpt-5\.6(?:$|-)/i,
];

function normalizeModelId(model: string): string {
  return String(model || "").trim().replace(/^openai\//i, "");
}

/**
 * Some OpenAI model families reject the `temperature` field entirely. Keep
 * this compatibility check next to the shared transport so every workflow
 * (including iNrADN document analysis and provider fallbacks) benefits from
 * the same safe request shape.
 */
export function supportsExplicitTemperature(model: string): boolean {
  const normalized = normalizeModelId(model);
  return !OPENAI_MODELS_WITHOUT_TEMPERATURE.some((pattern) => pattern.test(normalized));
}

export function resolveModelTemperature(
  model: string,
  temperature: number | undefined,
): number | undefined {
  if (temperature === undefined) return undefined;
  return supportsExplicitTemperature(model) ? temperature : undefined;
}
