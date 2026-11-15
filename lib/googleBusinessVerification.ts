export type GmbVerificationStatus = "verified" | "pending" | "required" | "restricted" | "unknown";

type JsonRecord = Record<string, unknown>;
const isObject = (value: unknown): value is JsonRecord => Boolean(value && typeof value === "object" && !Array.isArray(value));
const verificationActions = ["waitForVoiceOfMerchant", "verify", "resolveOwnershipConflict", "complyWithGuidelines"] as const;

/** Google verification is separate from OAuth and from choosing a location.
 * The VoiceOfMerchant action objects can be empty; their presence is meaningful.
 * https://developers.google.com/my-business/reference/verifications/rest/v1/locations/getVoiceOfMerchantState
 */
export function parseGmbVerification(payload: unknown): GmbVerificationStatus {
  if (!isObject(payload)) return "unknown";
  if (Object.hasOwn(payload, "hasVoiceOfMerchant") && payload.hasVoiceOfMerchant === true) return "verified";
  // Google defines a mutually exclusive action. Contradictory or malformed
  // responses do not justify telling the professional a validation is pending.
  const actions = verificationActions.filter(action => Object.hasOwn(payload, action));
  if (actions.length !== 1) return "unknown";
  const action = actions[0];
  const details = payload[action];
  if (!isObject(details)) return "unknown";
  if (action === "waitForVoiceOfMerchant") return "pending";
  if (action === "resolveOwnershipConflict" || action === "complyWithGuidelines") return "restricted";
  if (details.hasPendingVerification === true) return "pending";
  // Protobuf JSON may omit a false default. An empty verify object therefore
  // asks the merchant to start verification, rather than proving a review.
  if (!Object.hasOwn(details, "hasPendingVerification") || details.hasPendingVerification === false) return "required";
  return "unknown";
}

/** Read-only, best-effort enrichment. A failed verification lookup must never
 * invalidate the Google grant, clear the selected location or require OAuth.
 */
export async function readGmbVerification(
  accessToken: string,
  locationName: string,
  fetcher: typeof fetch = fetch,
): Promise<GmbVerificationStatus> {
  if (typeof accessToken !== "string" || !accessToken.trim()
    || typeof locationName !== "string" || !/^locations\/[a-zA-Z0-9_-]+$/.test(locationName)) return "unknown";
  try {
    const response = await fetcher(`https://mybusinessverifications.googleapis.com/v1/${locationName}/VoiceOfMerchantState`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return "unknown";
    return parseGmbVerification(await response.json());
  } catch {
    // API not enabled, permissions, quota, transport errors and timeouts are
    // inconclusive about Google's business validation, not OAuth failures.
    return "unknown";
  }
}
