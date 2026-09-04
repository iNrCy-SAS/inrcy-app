import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
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
  const [profileRes, inrcyCfgRes, proCfgRes, businessRes] = await Promise.all([
    args.supabase
      .from("profiles")
      .select("phone")
      .eq("user_id", args.userId)
      .maybeSingle(),
    args.supabase
      .from("inrcy_site_configs")
      .select("site_url")
      .eq("user_id", args.userId)
      .maybeSingle(),
    args.supabase
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", args.userId)
      .maybeSingle(),
    args.supabase
      .from("business_profiles")
      .select("preferred_cta,ai_language,updated_at")
      .eq("user_id", args.userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const profile = asRecord(profileRes.data);
  const inrcyCfg = asRecord(inrcyCfgRes.data);
  const proSettings = asRecord(asRecord(proCfgRes.data).settings);
  const businessProfile = asRecord(businessRes.data);
  const siteWeb = asRecord(proSettings.site_web);
  const siteWebUrl = (asString(siteWeb.url) || "").trim();
  const inrcySiteUrl = (asString(inrcyCfg.site_url) || "").trim();
  const preferredWebsiteUrl = siteWebUrl || inrcySiteUrl;

  return {
    preferredWebsiteUrl,
    preferredWebsiteLabel: siteWebUrl
      ? "Site web connecté"
      : inrcySiteUrl
        ? "Site iNrCy"
        : "",
    siteWebUrl,
    inrcySiteUrl,
    phone: (asString(profile.phone) || "").trim(),
    preferredCta: normalizeBoosterPreferredCta(
      asString(businessProfile.preferred_cta) || "devis",
    ),
    aiLanguage: normalizeBoosterAiLanguage(businessProfile.ai_language),
  };
}
