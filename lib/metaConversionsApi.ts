import "server-only";

import { createHash } from "node:crypto";

import { buildMetaGraphUrl } from "@/lib/metaGraphApi";
import type {
  MetaBrowserMatch,
  SignupAttributionSnapshot,
} from "@/lib/signupAttribution";

export type MetaCapiResult = {
  status: "sent" | "failed" | "skipped";
  eventsReceived: number | null;
  fbtraceId: string;
  error: string;
  testEventCodeUsed: boolean;
};

type MetaLeadInput = {
  userId: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  attribution: SignupAttributionSnapshot;
  browserMatch: MetaBrowserMatch;
};

function clean(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeEmail(value: unknown) {
  return clean(value, 320).toLowerCase();
}

function normalizePhone(value: unknown) {
  let digits = clean(value, 80).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("0")) digits = `33${digits.slice(1)}`;
  return digits;
}

function normalizeName(value: unknown) {
  return clean(value, 120)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function hashMetaUserValue(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashedArray(value: string) {
  return value ? [hashMetaUserValue(value)] : undefined;
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return fallback;
  return clean((error as { message?: unknown }).message, 500) || fallback;
}

function buildCustomData(attribution: SignupAttributionSnapshot) {
  const values: Record<string, string | number> = {
    content_name: "Inscription iNrCy",
    content_category: "Essai gratuit 21 jours",
    lead_type: "trial_signup",
    currency: "EUR",
    value: 0,
  };

  const optionalValues: Record<string, string> = {
    utm_source: attribution.utmSource,
    utm_medium: attribution.utmMedium,
    utm_campaign: attribution.utmCampaign,
    utm_content: attribution.utmContent,
    utm_term: attribution.utmTerm,
    campaign_id: attribution.campaignId,
    adset_id: attribution.adsetId,
    ad_id: attribution.adId,
    placement: attribution.placement,
    site_source_name: attribution.siteSourceName,
  };

  for (const [key, value] of Object.entries(optionalValues)) {
    if (value) values[key] = value;
  }
  return values;
}

export async function sendMetaLeadConversion(input: MetaLeadInput): Promise<MetaCapiResult> {
  const pixelId = clean(process.env.META_PIXEL_ID, 80);
  const accessToken = clean(process.env.META_CONVERSIONS_API_ACCESS_TOKEN, 4096);
  const testEventCode = clean(process.env.META_CAPI_TEST_EVENT_CODE, 120);

  const skipped = (error: string): MetaCapiResult => ({
    status: "skipped",
    eventsReceived: null,
    fbtraceId: "",
    error,
    testEventCodeUsed: Boolean(testEventCode),
  });

  if (!input.attribution.marketingConsent) {
    return skipped("marketing_consent_missing");
  }
  if (!pixelId || !accessToken) {
    return skipped("meta_capi_not_configured");
  }
  if (!input.attribution.eventId) {
    return skipped("event_id_missing");
  }

  const userData: Record<string, string | string[]> = {};
  const email = hashedArray(normalizeEmail(input.email));
  const phone = hashedArray(normalizePhone(input.phone));
  const firstName = hashedArray(normalizeName(input.firstName));
  const lastName = hashedArray(normalizeName(input.lastName));
  const externalId = hashedArray(clean(input.userId, 128).toLowerCase());

  if (email) userData.em = email;
  if (phone) userData.ph = phone;
  if (firstName) userData.fn = firstName;
  if (lastName) userData.ln = lastName;
  if (externalId) userData.external_id = externalId;
  if (input.browserMatch.fbp) userData.fbp = input.browserMatch.fbp;
  if (input.browserMatch.fbc) userData.fbc = input.browserMatch.fbc;
  if (input.browserMatch.clientUserAgent) {
    userData.client_user_agent = input.browserMatch.clientUserAgent;
  }

  const requestBody: Record<string, unknown> = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.attribution.eventId,
        action_source: "website",
        event_source_url:
          input.attribution.eventSourceUrl || input.attribution.landingPageUrl || "https://inrcy.com/inscription",
        user_data: userData,
        custom_data: buildCustomData(input.attribution),
      },
    ],
  };
  if (testEventCode) requestBody.test_event_code = testEventCode;

  try {
    const response = await fetch(buildMetaGraphUrl(`${encodeURIComponent(pixelId)}/events`), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    const responsePayload = await response.json().catch(() => ({})) as {
      events_received?: unknown;
      fbtrace_id?: unknown;
    };

    if (!response.ok) {
      return {
        status: "failed",
        eventsReceived: null,
        fbtraceId: clean(responsePayload.fbtrace_id, 255),
        error: readErrorMessage(responsePayload, `meta_http_${response.status}`),
        testEventCodeUsed: Boolean(testEventCode),
      };
    }

    const eventsReceived = Number(responsePayload.events_received);
    return {
      status: "sent",
      eventsReceived: Number.isFinite(eventsReceived) ? eventsReceived : null,
      fbtraceId: clean(responsePayload.fbtrace_id, 255),
      error: "",
      testEventCodeUsed: Boolean(testEventCode),
    };
  } catch (error: unknown) {
    return {
      status: "failed",
      eventsReceived: null,
      fbtraceId: "",
      error: clean(error instanceof Error ? error.message : "meta_request_failed", 500),
      testEventCodeUsed: Boolean(testEventCode),
    };
  }
}
