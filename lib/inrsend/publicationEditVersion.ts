type Row = Record<string, unknown>;
export function normalizePublicationEditHashtag(input: string): string { return String(input || "").trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 40); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
/** Shared browser/server version of the exact iNrSend event observed before
 * editing. No provider read or remote compare-and-swap is implied. */
export async function publicationEditSourceVersion(accountId: string, publicationId: string, channel: string, rawEventPayload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical({ version: 1, accountId, publicationId, channel, payload: rawEventPayload })));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function parsePublicationEditPrecondition(value: unknown): { expectedState: string; operationKey: string } | null {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
  return typeof row.expectedState === "string" && /^[a-f0-9]{64}$/.test(row.expectedState) && typeof row.operationKey === "string" && /^[a-zA-Z0-9_-]{8,180}$/.test(row.operationKey)
    ? { expectedState: row.expectedState, operationKey: row.operationKey } : null;
}
