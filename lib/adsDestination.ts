export type AdsDestinationSource = "explicit" | "website" | "google_business" | "none";

type AdsDestinationCandidates = {
  explicitUrl?: unknown;
  profileWebsiteUrl?: unknown;
  connectedWebsiteUrl?: unknown;
  inrcyWebsiteUrl?: unknown;
  googleBusinessUrl?: unknown;
  googleBusinessConnected?: boolean;
};

export function verifiedAdsDestinationUrl(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 2_000) return "";
  // Business profiles can contain a bare domain, but do not rewrite an
  // explicitly configured HTTP or other protocol into a different endpoint.
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw)
    ? raw
    : /^(?:www\.)?[^\s/]+\.[^\s/]+(?:\/.*)?$/i.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

/** Only account-controlled destinations may enter an AI-generated campaign. */
export function resolveAdsCampaignDestination(candidates: AdsDestinationCandidates): {
  url: string;
  source: AdsDestinationSource;
} {
  const explicitUrl = verifiedAdsDestinationUrl(candidates.explicitUrl);
  if (explicitUrl) return { url: explicitUrl, source: "explicit" };

  for (const value of [
    candidates.profileWebsiteUrl,
    candidates.connectedWebsiteUrl,
    candidates.inrcyWebsiteUrl,
  ]) {
    const url = verifiedAdsDestinationUrl(value);
    if (url) return { url, source: "website" };
  }

  if (candidates.googleBusinessConnected) {
    const url = verifiedAdsDestinationUrl(candidates.googleBusinessUrl);
    if (url) return { url, source: "google_business" };
  }
  return { url: "", source: "none" };
}

export function adsDestinationReviewState(args: {
  assisted: boolean;
  fieldVisible: boolean;
  websiteRequired: boolean;
  destinationUrl: string;
  confirmedUrl: string;
}) {
  const destinationUrl = args.destinationUrl.trim();
  const required = args.assisted && args.fieldVisible && (args.websiteRequired || Boolean(destinationUrl));
  // A user-entered URL must include HTTPS in the field itself; only trusted
  // profile domains are automatically upgraded when building an AI plan.
  const valid = destinationUrl.startsWith("https://") && Boolean(verifiedAdsDestinationUrl(destinationUrl));
  const confirmed = required && valid && args.confirmedUrl === destinationUrl;
  return { required, valid, confirmed, canContinue: !required || confirmed };
}
