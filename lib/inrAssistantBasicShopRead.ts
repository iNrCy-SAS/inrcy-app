import { inrAssistantClauseIsAdvice, inrAssistantRequestClauses } from "./inrAssistantRequestClauses.ts";
export type InrAssistantBasicShopReadView = "inertia" | "shop_orders";
/** Routing only. Neither catalogue prices nor media credits are a UI balance. */
export function getInrAssistantBasicShopReadView(message: string): InrAssistantBasicShopReadView | null {
  for (const text of inrAssistantRequestClauses(message)) {
    const nominalOrders = /^(?:mes|nos)\s+commandes\s+(?:(?:de|des|de la)\s+)?(?:prestations|services|boutique)[ .!?]*$/.test(text);
    if (inrAssistantClauseIsAdvice(text) || /\b(?:si|if|demain|tomorrow|plus tard|not|never)\b|\bne\b.{0,50}\bpas\b|\bn['’]/.test(text) || !nominalOrders && !/\b(?:lis|lire|consulte\w*|affiche\w*|montre\w*|liste\w*|verifi\w*|combien|quels?|quelles?|read|show|list|balance|solde|historique)\b/.test(text)) continue;
    if (/\binertie\b|\b(?:solde|total|combien|unites?|historique|mes|nos)\s+(?:d['’ ]|en\s+)?ui\b/.test(text)) return "inertia";
    if (!/\b(?:recharge\w*|credits?|studio|media\w*)\b/.test(text) && /\bcommandes?\b/.test(text) && /\b(?:prestations?|services?|boutique)\b/.test(text)) return "shop_orders";
  }
  return null;
}
export function nativeInertiaNumber(value: unknown, nonnegative = false): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(numeric) && Math.abs(numeric) <= Number.MAX_SAFE_INTEGER && (!nonnegative || numeric >= 0) ? numeric : null;
}
export function nativeInertiaDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12 || Number(match[3]) < 1 || Number(match[3]) > new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
