import "server-only";

import { randomUUID } from "node:crypto";

import {
  sendMetaConversion,
  type MetaCapiResult,
  type MetaConversionEventName,
} from "@/lib/metaConversionsApi";
import {
  createMetaBrowserMatch,
  createSignupAttributionSnapshot,
} from "@/lib/signupAttribution";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const OUTBOX_TABLE = "meta_conversion_events";
const CLAIM_RPC = "claim_meta_conversion_events";
const LOCK_TTL_SECONDS = 120;
const DEFAULT_MAX_ATTEMPTS = 10;

type MetaConversionEventRow = {
  id: string;
  user_id: string;
  event_name: MetaConversionEventName;
  event_id: string;
  source: string;
  source_event_id: string | null;
  occurred_at: string;
  value_cents: number | null;
  currency: string | null;
  status: "pending" | "processing" | "retry_wait" | "sent" | "skipped" | "dead";
  attempt_count: number;
  max_attempts: number;
  lock_token: string | null;
};

type SignupAttributionRow = {
  form_source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  placement: string | null;
  site_source_name: string | null;
  landing_page_url: string | null;
  event_source_url: string | null;
  referrer_url: string | null;
  event_id: string;
  attribution_captured_at: string | null;
  marketing_consent: boolean;
  meta_fbp: string | null;
  meta_fbc: string | null;
  meta_client_user_agent: string | null;
  meta_match_expires_at: string | null;
};

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  admin_email: string | null;
  contact_email: string | null;
};

export type MetaConversionBatchResult = {
  ok: boolean;
  claimed: number;
  sent: number;
  skipped: number;
  retrying: number;
  dead: number;
  uncertain: number;
};

export type EnqueueMetaConversionInput = {
  userId: string;
  eventName: Exclude<MetaConversionEventName, "Lead">;
  occurredAt?: string | Date;
  source: string;
  sourceEventId?: string | null;
  valueCents?: number | null;
  currency?: string | null;
};

function clean(value: unknown, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function eventSlug(eventName: MetaConversionEventName) {
  if (eventName === "CompleteRegistration") return "complete-registration";
  return eventName.toLowerCase();
}

export function buildMetaConversionEventId(
  eventName: MetaConversionEventName,
  userId: string,
  leadEventId?: string | null,
) {
  if (eventName === "Lead") {
    const browserEventId = clean(leadEventId, 128).replace(/[^a-zA-Z0-9._:-]/g, "");
    if (browserEventId) return browserEventId;
  }
  return `inrcy-${eventSlug(eventName)}-${clean(userId, 64)}`.slice(0, 128);
}

function normalizedCurrency(value: unknown) {
  const currency = clean(value || "EUR", 3).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "EUR";
}

function safeOccurredAt(value?: string | Date) {
  const candidate = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isFinite(candidate.getTime()) ? candidate.toISOString() : new Date().toISOString();
}

function retryAt(attemptCount: number) {
  const delayMinutes = Math.min(360, Math.max(1, 2 ** Math.max(0, attemptCount - 1)));
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

function errorCode(error: unknown) {
  const message = clean(error instanceof Error ? error.message : error || "meta_conversion_failed", 120);
  return (message.split(":")[0] || "meta_conversion_failed")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 100);
}

function appOrigin() {
  const raw = clean(
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://app.inrcy.com",
    500,
  ).replace(/\/$/, "");
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://app.inrcy.com";
  }
}

function eventSourceUrl(row: MetaConversionEventRow, attribution: SignupAttributionRow) {
  if (row.event_name === "Lead") {
    return attribution.event_source_url || attribution.landing_page_url || "https://inrcy.com/inscription";
  }
  if (row.event_name === "CompleteRegistration") {
    return `${appOrigin()}/auth/finish-invite`;
  }
  return `${appOrigin()}/dashboard?panel=abonnement`;
}

async function updateLeadStatus(row: MetaConversionEventRow, result: MetaCapiResult, status: string) {
  if (row.event_name !== "Lead") return;
  const { error } = await supabaseAdmin
    .from("signup_attributions")
    .update({
      capi_status: status,
      capi_events_received: result.eventsReceived,
      capi_fbtrace_id: result.fbtraceId || null,
      capi_error: result.error || null,
      capi_test_event_code_used: result.testEventCodeUsed,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", row.user_id);
  if (error) throw new Error(`meta_lead_status_failed:${error.message}`);
}

async function loadAttribution(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("signup_attributions")
    .select(
      "form_source,utm_source,utm_medium,utm_campaign,utm_content,utm_term,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,placement,site_source_name,landing_page_url,event_source_url,referrer_url,event_id,attribution_captured_at,marketing_consent,meta_fbp,meta_fbc,meta_client_user_agent,meta_match_expires_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`meta_attribution_read_failed:${error.message}`);
  return data as SignupAttributionRow | null;
}

async function loadIdentity(userId: string) {
  const [authResult, profileResult] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin
      .from("profiles")
      .select("first_name,last_name,phone,admin_email,contact_email")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (authResult.error) {
    throw new Error(`meta_auth_user_read_failed:${authResult.error.message}`);
  }
  if (profileResult.error) {
    throw new Error(`meta_profile_read_failed:${profileResult.error.message}`);
  }

  const user = authResult.data.user;
  if (!user) throw new Error("meta_auth_user_missing");
  const profile = profileResult.data as ProfileRow | null;
  const metadata = record(user.user_metadata);
  return {
    email: clean(user.email || profile?.admin_email || profile?.contact_email, 320),
    phone: clean(profile?.phone || metadata.phone, 80),
    firstName: clean(profile?.first_name || metadata.first_name || metadata.firstname, 120),
    lastName: clean(profile?.last_name || metadata.last_name || metadata.lastname, 120),
  };
}

function skippedResult(reason: string): MetaCapiResult {
  return {
    status: "skipped",
    eventsReceived: null,
    fbtraceId: "",
    error: reason,
    testEventCodeUsed: Boolean(clean(process.env.META_CAPI_TEST_EVENT_CODE, 120)),
  };
}

async function conversionResult(row: MetaConversionEventRow): Promise<MetaCapiResult> {
  const attributionRow = await loadAttribution(row.user_id);
  if (!attributionRow) return skippedResult("signup_attribution_missing");
  if (!attributionRow.marketing_consent) return skippedResult("marketing_consent_missing");

  const identity = await loadIdentity(row.user_id);
  const matchExpiryMs = new Date(attributionRow.meta_match_expires_at || "").getTime();
  const browserMatchValid = Number.isFinite(matchExpiryMs) && matchExpiryMs > Date.now();
  const attribution = createSignupAttributionSnapshot({
    formSource: attributionRow.form_source,
    utmSource: attributionRow.utm_source,
    utmMedium: attributionRow.utm_medium,
    utmCampaign: attributionRow.utm_campaign,
    utmContent: attributionRow.utm_content,
    utmTerm: attributionRow.utm_term,
    campaignId: attributionRow.campaign_id,
    campaignName: attributionRow.campaign_name,
    adsetId: attributionRow.adset_id,
    adsetName: attributionRow.adset_name,
    adId: attributionRow.ad_id,
    adName: attributionRow.ad_name,
    placement: attributionRow.placement,
    siteSourceName: attributionRow.site_source_name,
    landingPageUrl: attributionRow.landing_page_url,
    eventSourceUrl: attributionRow.event_source_url,
    referrerUrl: attributionRow.referrer_url,
    eventId: attributionRow.event_id,
    capturedAt: attributionRow.attribution_captured_at,
    marketingConsent: attributionRow.marketing_consent,
  });
  const browserMatch = createMetaBrowserMatch({
    fbp: browserMatchValid ? attributionRow.meta_fbp : "",
    fbc: browserMatchValid ? attributionRow.meta_fbc : "",
    clientUserAgent: browserMatchValid ? attributionRow.meta_client_user_agent : "",
  });

  return sendMetaConversion({
    eventName: row.event_name,
    eventId: row.event_id,
    occurredAt: row.occurred_at,
    userId: row.user_id,
    ...identity,
    attribution,
    browserMatch,
    eventSourceUrl: eventSourceUrl(row, attributionRow),
    valueCents: row.value_cents,
    currency: row.currency,
  });
}

async function persistOutcome(row: MetaConversionEventRow, result: MetaCapiResult) {
  if (!row.lock_token) throw new Error("meta_conversion_lock_missing");
  const nowIso = new Date().toISOString();
  const exhausted = row.attempt_count >= row.max_attempts;
  const nextStatus = result.status === "sent"
    ? "sent"
    : result.status === "skipped"
      ? "skipped"
      : exhausted
        ? "dead"
        : "retry_wait";
  const { data, error } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .update({
      status: nextStatus,
      next_attempt_at: nextStatus === "retry_wait" ? retryAt(row.attempt_count) : null,
      lock_token: null,
      locked_at: null,
      lock_expires_at: null,
      sent_at: nextStatus === "sent" ? nowIso : null,
      events_received: result.eventsReceived,
      fbtrace_id: result.fbtraceId || null,
      test_event_code_used: result.testEventCodeUsed,
      last_error_code: result.error ? errorCode(result.error) : null,
      last_error_message: result.error ? clean(result.error, 1000) : null,
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .eq("status", "processing")
    .eq("lock_token", row.lock_token)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`meta_conversion_state_failed:${error.message}`);
  if (!data) throw new Error("meta_conversion_lock_lost");

  await updateLeadStatus(row, result, nextStatus).catch((leadStatusError: unknown) => {
    console.error("[meta-conversions][lead-status]", errorCode(leadStatusError));
  });
  return nextStatus;
}

async function deliverClaimedEvent(row: MetaConversionEventRow) {
  let result: MetaCapiResult;
  try {
    result = await conversionResult(row);
  } catch (error) {
    result = {
      status: "failed",
      eventsReceived: null,
      fbtraceId: "",
      error: clean(error instanceof Error ? error.message : "meta_conversion_failed", 1000),
      testEventCodeUsed: Boolean(clean(process.env.META_CAPI_TEST_EVENT_CODE, 120)),
    };
  }
  return persistOutcome(row, result);
}

async function purgeExpiredBrowserMatchData() {
  const { error } = await supabaseAdmin
    .from("signup_attributions")
    .update({
      meta_fbp: null,
      meta_fbc: null,
      meta_client_user_agent: null,
      meta_match_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .not("meta_match_expires_at", "is", null)
    .lte("meta_match_expires_at", new Date().toISOString());
  if (error) throw new Error(`meta_match_cleanup_failed:${error.message}`);
}

export async function enqueueMetaConversionEvent(input: EnqueueMetaConversionInput) {
  const eventId = buildMetaConversionEventId(input.eventName, input.userId);
  const value = Number(input.valueCents);
  const { error } = await supabaseAdmin
    .from(OUTBOX_TABLE)
    .upsert(
      {
        user_id: input.userId,
        event_name: input.eventName,
        event_id: eventId,
        source: clean(input.source, 120),
        source_event_id: clean(input.sourceEventId, 255) || null,
        occurred_at: safeOccurredAt(input.occurredAt),
        value_cents: Number.isFinite(value) && value >= 0 ? Math.round(value) : null,
        currency: normalizedCurrency(input.currency),
        status: "pending",
        max_attempts: DEFAULT_MAX_ATTEMPTS,
        next_attempt_at: new Date().toISOString(),
      },
      { onConflict: "user_id,event_name", ignoreDuplicates: true },
    );
  if (error) throw new Error(`meta_conversion_enqueue_failed:${error.message}`);
  return { queued: true as const, eventId };
}

export async function processMetaConversionEvents(options?: {
  eventId?: string;
  limit?: number;
}): Promise<MetaConversionBatchResult> {
  await purgeExpiredBrowserMatchData().catch((error: unknown) => {
    console.error("[meta-conversions][match-cleanup]", errorCode(error));
  });
  const limit = Math.min(25, Math.max(1, Math.floor(options?.limit || 10)));
  const result: MetaConversionBatchResult = {
    ok: true,
    claimed: 0,
    sent: 0,
    skipped: 0,
    retrying: 0,
    dead: 0,
    uncertain: 0,
  };

  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await supabaseAdmin.rpc(CLAIM_RPC, {
      p_limit: 1,
      p_lock_token: randomUUID(),
      p_event_id: clean(options?.eventId, 128) || null,
      p_lease_seconds: LOCK_TTL_SECONDS,
    });
    if (error) throw new Error(`meta_conversion_claim_failed:${error.message}`);
    const row = (Array.isArray(data) ? data[0] : null) as MetaConversionEventRow | null;
    if (!row) break;
    result.claimed += 1;
    try {
      const outcome = await deliverClaimedEvent(row);
      if (outcome === "sent") result.sent += 1;
      else if (outcome === "skipped") result.skipped += 1;
      else if (outcome === "retry_wait") result.retrying += 1;
      else result.dead += 1;
    } catch (error) {
      result.uncertain += 1;
      console.error("[meta-conversions][state-uncertain]", {
        eventId: row.event_id,
        code: errorCode(error),
      });
    }
  }

  result.ok = result.retrying === 0 && result.dead === 0 && result.uncertain === 0;
  return result;
}
