export const SIGNUP_ATTRIBUTION_METADATA_KEY = "inrcy_signup_attribution";

export type SignupAttributionSnapshot = {
  version: 1;
  formSource: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  placement: string;
  siteSourceName: string;
  landingPageUrl: string;
  eventSourceUrl: string;
  referrerUrl: string;
  eventId: string;
  capturedAt: string;
  marketingConsent: boolean;
};

export type MetaBrowserMatch = {
  fbp: string;
  fbc: string;
  clientUserAgent: string;
};

type LooseRecord = Record<string, unknown>;

type SignupRecordLike = LooseRecord & {
  raw_user_meta_data?: unknown;
  user_metadata?: unknown;
  metadata?: unknown;
};

function asRecord(value: unknown): LooseRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as LooseRecord;
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function firstText(maxLength: number, ...values: unknown[]) {
  for (const value of values) {
    const text = clean(value, maxLength);
    if (text) return text;
  }
  return "";
}

function cleanHttpUrl(value: unknown) {
  const candidate = clean(value, 2048);
  if (!candidate) return "";

  try {
    const url = new URL(candidate);
    if (!(["http:", "https:"] as const).includes(url.protocol as "http:" | "https:")) {
      return "";
    }
    url.hash = "";
    for (const key of ["fbclid", "gclid", "msclkid", "_fbc", "_fbp"]) {
      url.searchParams.delete(key);
    }
    return url.toString().slice(0, 2048);
  } catch {
    return "";
  }
}

function cleanEventId(value: unknown) {
  return clean(value, 128).replace(/[^a-zA-Z0-9._:-]/g, "");
}

function cleanIsoDate(value: unknown) {
  const candidate = clean(value, 40);
  if (!candidate) return "";
  const date = new Date(candidate);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function isTrue(value: unknown) {
  if (value === true) return true;
  const normalized = clean(value, 20).toLowerCase();
  return ["1", "true", "yes", "oui", "on", "allow", "accepted"].includes(normalized);
}

export function createSignupAttributionSnapshot(input: {
  formSource?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  utmContent?: unknown;
  utmTerm?: unknown;
  campaignId?: unknown;
  campaignName?: unknown;
  adsetId?: unknown;
  adsetName?: unknown;
  adId?: unknown;
  adName?: unknown;
  placement?: unknown;
  siteSourceName?: unknown;
  landingPageUrl?: unknown;
  eventSourceUrl?: unknown;
  referrerUrl?: unknown;
  eventId?: unknown;
  capturedAt?: unknown;
  marketingConsent?: unknown;
}): SignupAttributionSnapshot {
  return {
    version: 1,
    formSource: clean(input.formSource, 120),
    utmSource: clean(input.utmSource, 120),
    utmMedium: clean(input.utmMedium, 120),
    utmCampaign: clean(input.utmCampaign, 240),
    utmContent: clean(input.utmContent, 240),
    utmTerm: clean(input.utmTerm, 240),
    campaignId: clean(input.campaignId, 128),
    campaignName: clean(input.campaignName, 240),
    adsetId: clean(input.adsetId, 128),
    adsetName: clean(input.adsetName, 240),
    adId: clean(input.adId, 128),
    adName: clean(input.adName, 240),
    placement: clean(input.placement, 120),
    siteSourceName: clean(input.siteSourceName, 80),
    landingPageUrl: cleanHttpUrl(input.landingPageUrl),
    eventSourceUrl: cleanHttpUrl(input.eventSourceUrl),
    referrerUrl: cleanHttpUrl(input.referrerUrl),
    eventId: cleanEventId(input.eventId),
    capturedAt: cleanIsoDate(input.capturedAt),
    marketingConsent: isTrue(input.marketingConsent),
  };
}

export function createMetaBrowserMatch(input: {
  fbp?: unknown;
  fbc?: unknown;
  clientUserAgent?: unknown;
}): MetaBrowserMatch {
  return {
    fbp: clean(input.fbp, 255),
    fbc: clean(input.fbc, 255),
    clientUserAgent: clean(input.clientUserAgent, 500),
  };
}

export function readSignupAttributionSnapshot(recordValue: unknown): SignupAttributionSnapshot {
  const record = asRecord(recordValue) as SignupRecordLike;
  const metadata = {
    ...asRecord(record.metadata),
    ...asRecord(record.user_metadata),
    ...asRecord(record.raw_user_meta_data),
  };
  const snapshot = asRecord(metadata[SIGNUP_ATTRIBUTION_METADATA_KEY]);

  return createSignupAttributionSnapshot({
    formSource: firstText(120, snapshot.formSource, snapshot.form_source, metadata.source),
    utmSource: firstText(120, snapshot.utmSource, snapshot.utm_source, metadata.utm_source),
    utmMedium: firstText(120, snapshot.utmMedium, snapshot.utm_medium, metadata.utm_medium),
    utmCampaign: firstText(240, snapshot.utmCampaign, snapshot.utm_campaign, metadata.utm_campaign),
    utmContent: firstText(240, snapshot.utmContent, snapshot.utm_content, metadata.utm_content),
    utmTerm: firstText(240, snapshot.utmTerm, snapshot.utm_term, metadata.utm_term),
    campaignId: firstText(128, snapshot.campaignId, snapshot.campaign_id, metadata.campaign_id),
    campaignName: firstText(240, snapshot.campaignName, snapshot.campaign_name, metadata.campaign_name),
    adsetId: firstText(128, snapshot.adsetId, snapshot.adset_id, metadata.adset_id),
    adsetName: firstText(240, snapshot.adsetName, snapshot.adset_name, metadata.adset_name),
    adId: firstText(128, snapshot.adId, snapshot.ad_id, metadata.ad_id),
    adName: firstText(240, snapshot.adName, snapshot.ad_name, metadata.ad_name),
    placement: firstText(120, snapshot.placement, metadata.placement),
    siteSourceName: firstText(80, snapshot.siteSourceName, snapshot.site_source_name, metadata.site_source_name),
    landingPageUrl: firstText(2048, snapshot.landingPageUrl, snapshot.landing_page_url, metadata.landing_page_url),
    eventSourceUrl: firstText(2048, snapshot.eventSourceUrl, snapshot.event_source_url, metadata.event_source_url),
    referrerUrl: firstText(2048, snapshot.referrerUrl, snapshot.referrer_url, metadata.referrer_url),
    eventId: firstText(128, snapshot.eventId, snapshot.event_id, metadata.event_id),
    capturedAt: firstText(40, snapshot.capturedAt, snapshot.captured_at, metadata.captured_at),
    marketingConsent:
      snapshot.marketingConsent === true ||
      snapshot.marketing_consent === true ||
      metadata.marketing_consent === true,
  });
}

export function getSignupAttributionSourceLabel(attribution: SignupAttributionSnapshot) {
  const platformLabels: Record<string, string> = {
    fb: "Facebook",
    ig: "Instagram",
    an: "Audience Network",
    msg: "Messenger",
    threads: "Threads",
  };
  const rawSource = attribution.siteSourceName || attribution.utmSource;
  const platformKey = rawSource.toLowerCase();
  const source = platformLabels[platformKey] || rawSource;
  const medium = attribution.utmMedium;

  if (!source && !medium) return "Direct / non attribué";
  if (source && medium) return `${source} · ${medium}`;
  return source || medium;
}

export function getSignupCampaignLabel(attribution: SignupAttributionSnapshot) {
  return attribution.campaignName || attribution.utmCampaign || attribution.campaignId;
}

export function getSignupAdsetLabel(attribution: SignupAttributionSnapshot) {
  return attribution.adsetName || attribution.utmTerm || attribution.adsetId;
}

export function getSignupAdLabel(attribution: SignupAttributionSnapshot) {
  return attribution.adName || attribution.utmContent || attribution.adId;
}
