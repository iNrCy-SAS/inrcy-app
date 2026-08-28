import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { asRecord, asString } from "@/lib/tsSafe";

const VALID_PREFERRED_CTAS = new Set([
  "none",
  "site",
  "devis",
  "appeler",
  "message",
  "custom",
]);

function normalizePreferredCta(value: unknown) {
  const raw = String(value || "").trim();
  return VALID_PREFERRED_CTAS.has(raw) ? raw : "devis";
}

const VALID_AI_LANGUAGES = new Set(["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"]);

function normalizeAiLanguage(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  return VALID_AI_LANGUAGES.has(raw) ? raw : "fr";
}


export async function GET() {
  try {
    const { supabase, user, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const [profileRes, inrcyCfgRes, proCfgRes, businessRes] = await Promise.all([
      supabase.from("profiles").select("phone").eq("user_id", activeUserId).maybeSingle(),
      supabase.from("inrcy_site_configs").select("site_url").eq("user_id", activeUserId).maybeSingle(),
      supabase.from("pro_tools_configs").select("settings").eq("user_id", activeUserId).maybeSingle(),
      supabase
        .from("business_profiles")
        .select("preferred_cta,ai_language,updated_at")
        .eq("user_id", activeUserId)
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
    const preferredWebsiteLabel = siteWebUrl ? "Site web connecté" : inrcySiteUrl ? "Site iNrCy" : "";
    const phone = (asString(profile.phone) || "").trim();
    const rawPreferredCta = (asString(businessProfile.preferred_cta) || "devis").trim();
    const preferredCta = normalizePreferredCta(rawPreferredCta);
    const aiLanguage = normalizeAiLanguage(businessProfile.ai_language);

    return NextResponse.json({
      preferredWebsiteUrl,
      preferredWebsiteLabel,
      siteWebUrl,
      inrcySiteUrl,
      phone,
      preferredCta,
      aiLanguage,
    });
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
}
