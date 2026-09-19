import "server-only";

import type {
  MetaBrowserMatch,
  SignupAttributionSnapshot,
} from "@/lib/signupAttribution";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function persistSignupAttribution(input: {
  userId: string;
  attribution: SignupAttributionSnapshot;
  browserMatch: MetaBrowserMatch;
}) {
  const { attribution, browserMatch } = input;
  const nowIso = new Date().toISOString();
  const matchExpiresAt = attribution.marketingConsent
    ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const { error } = await supabaseAdmin
    .from("signup_attributions")
    .upsert(
      {
        user_id: input.userId,
        form_source: attribution.formSource || null,
        utm_source: attribution.utmSource || null,
        utm_medium: attribution.utmMedium || null,
        utm_campaign: attribution.utmCampaign || null,
        utm_content: attribution.utmContent || null,
        utm_term: attribution.utmTerm || null,
        campaign_id: attribution.campaignId || null,
        campaign_name: attribution.campaignName || null,
        adset_id: attribution.adsetId || null,
        adset_name: attribution.adsetName || null,
        ad_id: attribution.adId || null,
        ad_name: attribution.adName || null,
        placement: attribution.placement || null,
        site_source_name: attribution.siteSourceName || null,
        landing_page_url: attribution.landingPageUrl || null,
        event_source_url: attribution.eventSourceUrl || null,
        referrer_url: attribution.referrerUrl || null,
        event_id: attribution.eventId,
        attribution_captured_at: attribution.capturedAt || null,
        marketing_consent: attribution.marketingConsent,
        meta_fbp: attribution.marketingConsent ? browserMatch.fbp || null : null,
        meta_fbc: attribution.marketingConsent ? browserMatch.fbc || null : null,
        meta_client_user_agent:
          attribution.marketingConsent ? browserMatch.clientUserAgent || null : null,
        meta_match_expires_at: matchExpiresAt,
        meta_consent_recorded_at: attribution.marketingConsent ? nowIso : null,
        meta_consent_source: attribution.marketingConsent ? "complianz_marketing" : null,
        capi_status: attribution.marketingConsent ? "pending" : "skipped",
        capi_events_received: null,
        capi_fbtrace_id: null,
        capi_error: attribution.marketingConsent ? null : "marketing_consent_missing",
        capi_test_event_code_used: false,
        updated_at: nowIso,
      },
      { onConflict: "user_id" },
    );

  if (error) throw new Error(error.message);
}
