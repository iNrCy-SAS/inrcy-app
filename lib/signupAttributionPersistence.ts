import "server-only";

import type { MetaCapiResult } from "@/lib/metaConversionsApi";
import type { SignupAttributionSnapshot } from "@/lib/signupAttribution";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function persistSignupAttribution(input: {
  userId: string;
  attribution: SignupAttributionSnapshot;
  capi: MetaCapiResult;
}) {
  const { attribution, capi } = input;
  const nowIso = new Date().toISOString();
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
        capi_status: capi.status,
        capi_events_received: capi.eventsReceived,
        capi_fbtrace_id: capi.fbtraceId || null,
        capi_error: capi.error || null,
        capi_test_event_code_used: capi.testEventCodeUsed,
        updated_at: nowIso,
      },
      { onConflict: "user_id" },
    );

  if (error) throw new Error(error.message);
}
