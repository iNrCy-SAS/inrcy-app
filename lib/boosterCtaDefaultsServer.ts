import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAiChannelCtaMap } from "@/lib/aiChannelCtaPreferences";
import {
  normalizeBoosterAiLanguage,
  normalizeBoosterPreferredCta,
  type BoosterCtaDefaults,
} from "@/lib/boosterCtaPreferences";
import { asRecord, asString } from "@/lib/tsSafe";

export async function loadBoosterCtaDefaults(args: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<BoosterCtaDefaults> {
  const [profileRes, proCfgRes, businessRes] = await Promise.all([
    args.supabase
      .from("profiles")
      .select("phone")
      .eq("user_id", args.userId)
      .maybeSingle(),
    args.supabase
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", args.userId)
      .maybeSingle(),
    args.supabase
      .from("business_profiles")
      .select("preferred_cta,ai_language,ai_channel_ctas,updated_at")
      .eq("user_id", args.userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const profile = asRecord(profileRes.data);
  const proSettings = asRecord(asRecord(proCfgRes.data).settings);
  const businessProfile = asRecord(businessRes.data);
  const siteWeb = asRecord(proSettings.site_web);
  const youtubeDefaults = asRecord(asRecord(proSettings.youtube_shorts).defaults);
  const siteWebUrl = (asString(siteWeb.url) || "").trim();
  const preferredWebsiteUrl = siteWebUrl;
  const phone = (asString(profile.phone) || "").trim();

  return {
    preferredWebsiteUrl,
    preferredWebsiteLabel: siteWebUrl ? "Site web connecté" : "",
    siteWebUrl,
    phone,
    preferredCta: normalizeBoosterPreferredCta(
      asString(businessProfile.preferred_cta) || "devis",
    ),
    aiLanguage: normalizeBoosterAiLanguage(businessProfile.ai_language),
    channelCtas: resolveAiChannelCtaMap(businessProfile.ai_channel_ctas, { preferredWebsiteUrl, siteWebUrl, phone }),
    youtubeAutoHashtags: youtubeDefaults.autoHashtags !== false,
  };
}
