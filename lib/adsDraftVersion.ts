import { parseAdsCampaignInput } from "./adsValidation.ts";

function canonical(value: unknown): unknown { return Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value; }
export const adsDraftContentKey = (value: unknown) => JSON.stringify(canonical(value));
export function adsDraftBaselineKey(value: unknown): string | null {
  const parsed = parseAdsCampaignInput(value, { purpose: "draft" });
  return parsed.draft ? adsDraftContentKey(parsed.draft) : null;
}
export async function adsDraftBaselineHash(key: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
