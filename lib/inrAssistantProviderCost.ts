/** Read only the all-inclusive USD amount attested by AI Gateway.
 * Missing or malformed amounts stay unknown; they must never become free AI. */
export function getInrAssistantProviderCost(providerMetadata: unknown): number | undefined {
  if (!providerMetadata || typeof providerMetadata !== "object" || Array.isArray(providerMetadata)
    || !Object.hasOwn(providerMetadata, "gateway")) return undefined;
  const gateway = (providerMetadata as Record<string, unknown>).gateway;
  if (!gateway || typeof gateway !== "object" || Array.isArray(gateway) || !Object.hasOwn(gateway, "gatewayCost")) return undefined;
  const amount = (gateway as Record<string, unknown>).gatewayCost;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount) || amount < 0) return undefined;
    const microUsd = Math.ceil(amount * 1_000_000);
    return Number.isSafeInteger(microUsd) ? Math.max(0, microUsd) : undefined;
  }
  if (typeof amount !== "string" || amount.length > 100 || !/^\d+(?:\.\d+)?$/.test(amount)) return undefined;
  // Convert decimal strings exactly, including sub-microdollar charges. Number()
  // could round a long decimal down before the required upward rounding.
  const [dollars, decimals = ""] = amount.split(".");
  const microUsd = BigInt(dollars) * BigInt(1_000_000) + BigInt(decimals.slice(0, 6).padEnd(6, "0"))
    + (/[1-9]/.test(decimals.slice(6)) ? BigInt(1) : BigInt(0));
  return microUsd <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(microUsd) : undefined;
}
