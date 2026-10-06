import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { checkLinkedInAdsPublication } from "@/lib/adsLinkedInPublisherServer";
import { LinkedInAdsConnectionError } from "@/lib/adsLinkedInServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit } from "@/lib/rateLimit";
import { parseAdsCampaignInput } from "@/lib/adsValidation";
import { log } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ id: string }> };

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Checks the saved draft using publication's live evidence without creating or updating resources. */
export async function GET(request: Request, { params }: RouteContext) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser("linkedin");
  if (errorResponse || !user) return errorResponse;
  const { id } = await params;
  const mode = new URL(request.url).searchParams.get("mode") || "live";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || (mode !== "live" && mode !== "paused")) {
    return response({ error: "Paramètres de contrôle de campagne invalides." }, 400);
  }
  const limited = await enforceRateLimit({
    name: "ads_linkedin_publication_preflight", identifier: user.activeUserId,
    limit: 12, fallbackLimit: 6, window: "5 m", code: "linkedin_ads_publication_preflight_rate_limit",
  });
  if (limited) return limited;
  const { data: stored, error: readError } = await supabaseAdmin.from("ads_campaigns")
    .select("id,user_id,provider,ad_account_id,currency,daily_budget_cents,draft,status,provider_resources,published_at")
    .eq("id", id).eq("user_id", user.activeUserId).maybeSingle();
  if (readError) return response({ error: "Impossible de relire la campagne." }, 503);
  if (!stored || stored.user_id !== user.activeUserId) return response({ error: "Campagne introuvable." }, 404);
  if (stored.provider !== "linkedin") return response({ error: "Ce contrôle est réservé aux campagnes LinkedIn." }, 400);
  if (stored.status !== "draft" || stored.published_at !== null
    || !stored.provider_resources || typeof stored.provider_resources !== "object" || Array.isArray(stored.provider_resources)
    || Object.keys(stored.provider_resources).length > 0) {
    return response({ error: "Cette campagne n’est plus un brouillon à vérifier. Actualisez son statut." }, 409);
  }
  const { draft, error: validationError } = parseAdsCampaignInput(stored.draft, { purpose: "publish" });
  if (!draft || draft.provider !== "linkedin" || draft.adAccountId !== stored.ad_account_id
    || draft.accountCurrency !== stored.currency || Math.round(draft.dailyBudgetEuros * 100) !== stored.daily_budget_cents) {
    return response({ error: validationError || "Le brouillon a changé et doit être enregistré à nouveau." }, 400);
  }
  try {
    const result = await checkLinkedInAdsPublication(user.activeUserId, draft, { activate: mode === "live" });
    return response({ ready: result.ready, verifiedGeoCount: result.verifiedGeoCount });
  } catch (error) {
    const known = error instanceof LinkedInAdsConnectionError ? error : null;
    const code = known?.code || "publication_preflight_failed";
    const status = known?.status || 503;
    log.warn("linkedin_ads_publication_preflight_failed", { provider: "linkedin", code, status_code: status });
    return response({ ready: false, code, error: known?.message || "La vérification LinkedIn avant publication est indisponible." }, status);
  }
}
