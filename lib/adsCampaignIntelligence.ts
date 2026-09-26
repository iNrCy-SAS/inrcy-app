/**
 * Ads is the one AI workflow where a weak shortcut costs the professional real
 * media spend. Keep its strategist explicit and independently configurable
 * from the everyday editorial model used elsewhere in iNrCy.
 */
export const DEFAULT_ADS_CAMPAIGN_STRATEGIST_MODEL = "openai/gpt-6-astra";

export function resolveAdsCampaignStrategistModel() {
  const configured = String(process.env.AI_GATEWAY_ADS_CAMPAIGN_MODEL || "").trim();
  if (!configured) return DEFAULT_ADS_CAMPAIGN_STRATEGIST_MODEL;

  // Let an administrator use the concise OpenAI model name without creating a
  // second, surprising configuration convention. The gateway allowlist still
  // validates the resulting identifier before any request is made.
  return configured.includes("/") ? configured : `openai/${configured}`;
}
