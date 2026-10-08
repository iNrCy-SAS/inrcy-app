import "server-only";
import { TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT } from "./adsTikTokResources.ts";
import { preparedAdsInstant } from "./adsPreparedCampaignSettings.ts";
import type { TikTokTrafficCapabilityEvidence, TikTokTrafficCapabilityScope } from "./adsTikTokCampaignPreparationServer.ts";

export const TIKTOK_NATIVE_EVIDENCE_ENV = "TIKTOK_ADS_NATIVE_CAPABILITY_EVIDENCE";
/** The native binding snapshot is fresh; the independently dated operator authority lasts at most a day. */
export const TIKTOK_NATIVE_EVIDENCE_MAX_AGE_MS = 5 * 60_000;
export const TIKTOK_NATIVE_AUTHORITY_MAX_AGE_MS = 24 * 60 * 60_000;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
const flags = ["manualTrafficV13", "nativeWriteAccess", "videoUpload", "imageUpload", "mediaRead", "objectRead"] as const;

/** Server configuration is an explicit attestation after native access has been checked, not a way
 * to infer permission from account GET, an OAuth token, generic flags or client JSON. No environment
 * value is configured by this module. A privileged native verifier can replace this source later.
 */
export async function readTikTokConfiguredCapabilityEvidence(scope: TikTokTrafficCapabilityScope, now: number,
  environment: Record<string, string | undefined> = process.env): Promise<TikTokTrafficCapabilityEvidence | null> {
  const raw = environment[TIKTOK_NATIVE_EVIDENCE_ENV];
  if (!raw || raw.length > 24_000) return null;
  let values: unknown;
  try { values = JSON.parse(raw); } catch { return null; }
  const records = Array.isArray(values) ? values : [values];
  if (!records.length || records.length > 10) return null;
  const matches: TikTokTrafficCapabilityEvidence[] = [];
  for (const value of records) {
    const row = object(value), binding = object(row?.scope), source = object(row?.source);
    if (!row || !binding || !source || !exactKeys(row, ["scope", "source", ...flags, "minimumLifetimeBudgetEuros", "budgetCalendar", "scheduleTimeBasis", "scheduleOffsetMinutes", "allowedNonSparkIdentityTypes", "callToActions", "verifiedAt", "validUntil"])
      || !exactKeys(binding, ["appId", "advertiserId", "integrationFingerprint", "context"])
      || binding.appId !== scope.appId || binding.advertiserId !== scope.advertiserId || binding.integrationFingerprint !== scope.integrationFingerprint
      || !/^[0-9a-f]{64}$/.test(String(binding.integrationFingerprint)) || JSON.stringify(binding.context) !== JSON.stringify(TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT)
      || !exactKeys(source, ["kind", "reference"]) || source.kind !== "operator_verified_native_access" || typeof source.reference !== "string") continue;
    try {
      const reference = new URL(source.reference);
      if (reference.protocol !== "https:" || reference.username || reference.password || reference.port || reference.hash
        || !["business-api.tiktok.com", "ads.tiktok.com"].includes(reference.hostname) || source.reference.length > 500) continue;
    } catch { continue; }
    const created = preparedAdsInstant(row.verifiedAt), expires = preparedAdsInstant(row.validUntil);
    if (!created || !expires || Date.parse(created) > now || Date.parse(created) < now - TIKTOK_NATIVE_AUTHORITY_MAX_AGE_MS
      || Date.parse(expires) <= now || Date.parse(expires) > Date.parse(created) + TIKTOK_NATIVE_AUTHORITY_MAX_AGE_MS
      || flags.some((flag) => !["verified", "unverified"].includes(String(row[flag])))
      || !Array.isArray(row.allowedNonSparkIdentityTypes) || row.allowedNonSparkIdentityTypes.length > 3
      || row.allowedNonSparkIdentityTypes.some((type) => !["TT_USER", "BC_AUTH_TT", "CUSTOMIZED_USER"].includes(String(type)))
      || new Set(row.allowedNonSparkIdentityTypes).size !== row.allowedNonSparkIdentityTypes.length
      || !Array.isArray(row.callToActions) || row.callToActions.length > 50 || row.callToActions.some((cta) => typeof cta !== "string" || !/^[A-Z][A-Z_]{1,50}$/.test(cta))
      || new Set(row.callToActions).size !== row.callToActions.length) continue;
    if (row.minimumLifetimeBudgetEuros !== null && (typeof row.minimumLifetimeBudgetEuros !== "number" || !Number.isFinite(row.minimumLifetimeBudgetEuros) || row.minimumLifetimeBudgetEuros <= 0
      || Math.abs(row.minimumLifetimeBudgetEuros * 100 - Math.round(row.minimumLifetimeBudgetEuros * 100)) > 0.000001)) continue;
    const calendar = object(row.budgetCalendar);
    if (row.budgetCalendar !== null && (!calendar || !exactKeys(calendar, ["startAt", "endAt"]) || !preparedAdsInstant(calendar.startAt) || !preparedAdsInstant(calendar.endAt))) continue;
    if (![null, "utc", "advertiser"].includes(row.scheduleTimeBasis as null | string)
      || (row.scheduleOffsetMinutes !== null && (typeof row.scheduleOffsetMinutes !== "number" || !Number.isInteger(row.scheduleOffsetMinutes) || row.scheduleOffsetMinutes < -720 || row.scheduleOffsetMinutes > 840))) continue;
    matches.push({ scope: structuredClone(scope), ...Object.fromEntries(flags.map((flag) => [flag, row[flag]])),
      minimumLifetimeBudgetEuros: row.minimumLifetimeBudgetEuros, budgetCalendar: calendar ? { startAt: calendar.startAt, endAt: calendar.endAt } : null,
      scheduleTimeBasis: row.scheduleTimeBasis, scheduleOffsetMinutes: row.scheduleOffsetMinutes, allowedNonSparkIdentityTypes: [...row.allowedNonSparkIdentityTypes],
      callToActions: [...row.callToActions], verifiedAt: new Date(now).toISOString(), validUntil: new Date(Math.min(now + TIKTOK_NATIVE_EVIDENCE_MAX_AGE_MS, Date.parse(expires))).toISOString(),
      authority: { verifiedAt: created, validUntil: expires, source: { kind: source.kind, reference: source.reference } } } as TikTokTrafficCapabilityEvidence);
  }
  // Two matching attestations are ambiguous; no newest/first/default grant is guessed.
  return matches.length === 1 ? matches[0] : null;
}
