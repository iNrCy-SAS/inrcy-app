import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsPilotOnlyResponse, adsRequestOriginAllowed, requirePremiumAdsUser, isAdsChannelUserAllowed, listAdsAccounts, readAdsIntegration } from "@/lib/adsServer";
import { checkMetaAdsPublication } from "@/lib/adsMetaPublish";
import { MetaAdsPreparationError } from "@/lib/adsMetaResourcesServer";
import { checkOpenaiAdsPublication } from "@/lib/adsOpenaiServer";
import { OpenaiAdsPublishError } from "@/lib/adsOpenaiConnector";
import { checkPinterestAdsPublication, PinterestAdsPreparationError } from "@/lib/adsPinterestCampaignPublish";
import { PinterestAdsConnectionError } from "@/lib/adsPinterestServer";
import { checkGoogleAdsPublication, GoogleAdsLocationResolutionError } from "@/lib/adsGooglePublish";
import { GoogleAdsApiError } from "@/lib/adsGoogleApiError";
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
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const { id } = await params;
  const mode = new URL(request.url).searchParams.get("mode") || "live";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || (mode !== "live" && mode !== "paused")) {
    return response({ error: "Paramètres de contrôle de campagne invalides." }, 400);
  }
  const limited = await enforceRateLimit({
    name: "ads_publication_preflight", identifier: user.activeUserId,
    limit: 12, fallbackLimit: 6, window: "5 m", code: "ads_publication_preflight_rate_limit",
  });
  if (limited) return limited;
  const { data: stored, error: readError } = await supabaseAdmin.from("ads_campaigns")
    .select("id,user_id,provider,ad_account_id,currency,daily_budget_cents,draft,status,provider_resources,published_at,updated_at")
    .eq("id", id).eq("user_id", user.activeUserId).maybeSingle();
  if (readError) return response({ error: "Impossible de relire la campagne." }, 503);
  if (!stored || stored.user_id !== user.activeUserId) return response({ error: "Campagne introuvable." }, 404);
  const preparedChannel = stored.provider === "tiktok" || stored.provider === "x";
  if (!["linkedin", "google", "pinterest", "meta", "openai", "tiktok", "x"].includes(stored.provider)) return response({ error: "Ce canal ne possède pas de contrôle préalable de publication." }, 400);
  if (!(await isAdsChannelUserAllowed(user.authUserId, user.activeUserId, stored.provider))) return adsPilotOnlyResponse();
  if (preparedChannel) {
    if (mode !== "paused") return response({ ready: false, publicationEnabled: false, error: "TikTok et X acceptent uniquement une création suspendue." }, 423);
    if (!["draft", "needs_review", "paused"].includes(stored.status)) return response({ ready: false, error: "Une création est déjà en cours. Son résultat doit être contrôlé avant toute reprise." }, 409);
    const { draft, error: validationError } = parseAdsCampaignInput(stored.draft, { purpose: "draft" });
    const helpers = await import("@/lib/adsTikTokCampaignStore");
    if (!draft || draft.provider !== stored.provider || !helpers.preparedAdsStoredAccountMatches(stored, draft.adAccountId)
      || draft.accountCurrency !== stored.currency || Math.round(draft.dailyBudgetEuros * 100) !== stored.daily_budget_cents) return response({ ready: false, error: validationError || "Le brouillon a changé et doit être enregistré à nouveau." }, 400);
    try {
      const store = helpers.createPreparedAdsCampaignStore({ owner: user.activeUserId, campaignId: id, provider: stored.provider === "tiktok" ? "tiktok" : "x", accountId: draft.adAccountId, draftSnapshot: stored.draft });
      await store.assertCampaignOwnership();
      if (!(await store.isAvailable())) {
        const preparation = helpers.preparedAdsStoreUnavailablePreparation(stored.provider === "tiktok" ? "tiktok" : "x", draft.adAccountId);
        return response({ ...preparation, consentKey: helpers.preparedAdsCampaignConsentKey(stored.provider === "tiktok" ? "tiktok" : "x", stored, preparation), draftFingerprint: helpers.preparedAdsCampaignDraftKey(stored.draft), updatedAt: stored.updated_at });
      }
      const progress = await store.loadCheckpoint();
      if (stored.status === "draft" && (stored.published_at !== null || !stored.provider_resources || typeof stored.provider_resources !== "object" || Array.isArray(stored.provider_resources) || Object.keys(stored.provider_resources).length)) return response({ ready: false, error: "Ce brouillon contient déjà des ressources et doit être contrôlé." }, 409);
      if (stored.status !== "draft" && !progress) return response({ ready: false, error: "Le journal de cette création doit être contrôlé." }, 409);
      const checked = draft.provider === "tiktok"
        ? await (await import("@/lib/adsTikTokCampaignPreparationServer")).checkTikTokAdsCampaignPreparation(user.activeUserId, draft, { resumed: Boolean(progress) })
        : await (await import("@/lib/adsXResourcesServer")).checkXAdsCampaignPreparation(user.activeUserId, { accountId: draft.adAccountId, selections: draft.xNativeSelections, draft }, { resumed: Boolean(progress) });
      await store.assertCampaignOwnership();
      const preparation = helpers.preparedAdsPreparationForCheckpoint(checked, progress);
      return response({ ...preparation, consentKey: helpers.preparedAdsCampaignConsentKey(draft.provider === "tiktok" ? "tiktok" : "x", stored, preparation), draftFingerprint: helpers.preparedAdsCampaignDraftKey(stored.draft), updatedAt: stored.updated_at });
    } catch { return response({ ready: false, publicationEnabled: false, code: "prepared_preflight_unavailable", error: "La préparation native doit être vérifiée à nouveau. Aucune campagne n’a été créée." }, 422); }
  }
  if (stored.status !== "draft" || stored.published_at !== null
    || !stored.provider_resources || typeof stored.provider_resources !== "object" || Array.isArray(stored.provider_resources)
    || Object.keys(stored.provider_resources).length > 0) {
    return response({ error: "Cette campagne n’est plus un brouillon à vérifier. Actualisez son statut." }, 409);
  }
  const { draft, error: validationError } = parseAdsCampaignInput(stored.draft, { purpose: "publish" });
  if (!draft || draft.provider !== stored.provider || draft.adAccountId !== stored.ad_account_id
    || draft.accountCurrency !== stored.currency || Math.round(draft.dailyBudgetEuros * 100) !== stored.daily_budget_cents) {
    return response({ error: validationError || "Le brouillon a changé et doit être enregistré à nouveau." }, 400);
  }
  try {
    if (draft.provider === "meta") {
      const result = await checkMetaAdsPublication(user.activeUserId, draft);
      return response({ ready: result.ready, selectedAccountId: result.selectedAccountId, selectedPageId: result.selectedPageId, verifiedLocationCount: result.verifiedLocationCount, verifiedLanguageCount: result.verifiedLanguageCount, resourcesKey: result.resourcesKey });
    }
    if (draft.provider === "openai") {
      const result = await checkOpenaiAdsPublication(user.activeUserId, draft);
      return response({ ready: result.ready, selectedAccountId: result.selectedAccountId, verifiedLocationCount: result.verifiedLocationCount, resourcesKey: result.resourcesKey });
    }
    if (draft.provider === "pinterest") {
      const result = await checkPinterestAdsPublication(user.activeUserId, draft);
      return response({ ready: result.ready, selectedAccountId: result.selectedAccountId, verifiedLocationCount: result.verifiedLocationCount, verifiedLanguageCount: result.verifiedLanguageCount, resourcesKey: result.resourcesKey });
    }
    if (draft.provider === "google") {
      const initial = await readAdsIntegration(user.activeUserId, "google");
      if (initial?.status !== "connected" || initial.resource_id !== draft.adAccountId) return response({ ready: false, error: "Le compte Google Ads associé a changé. Vérifiez sa connexion." }, 409);
      const accounts = await listAdsAccounts(user.activeUserId, "google");
      const current = await readAdsIntegration(user.activeUserId, "google");
      if (!current || current.id !== initial.id || current.provider_account_id !== initial.provider_account_id || current.status !== "connected" || current.resource_id !== initial.resource_id) return response({ ready: false, error: "Le compte Google Ads associé a changé. Relancez la vérification." }, 409);
      const selected = accounts.find((account) => account.provider === "google" && account.id === draft.adAccountId && account.currency === "EUR");
      if (!selected) return response({ ready: false, error: "Le compte Google Ads EUR associé n’est plus accessible." }, 403);
      const result = await checkGoogleAdsPublication(user.activeUserId, draft, selected.loginCustomerId);
      return response({ ready: result.ready, selectedAccountId: result.selectedAccountId, verifiedLocationCount: result.verifiedLocationCount });
    }
    const result = await checkLinkedInAdsPublication(user.activeUserId, draft, { activate: mode === "live" });
    return response({ ready: result.ready, verifiedGeoCount: result.verifiedGeoCount });
  } catch (error) {
    if (draft.provider === "meta") return response({ ready: false, code: "meta_preflight_invalid", error: error instanceof MetaAdsPreparationError ? error.message : "La vérification Meta est momentanément indisponible. Réessayez." }, error instanceof MetaAdsPreparationError ? error.status : 503);
    if (draft.provider === "openai") return response({ ready: false, code: error instanceof OpenaiAdsPublishError ? error.code : "openai_preflight_unavailable", error: error instanceof OpenaiAdsPublishError ? error.message : "La vérification ChatGPT Ads est momentanément indisponible. Réessayez." }, error instanceof OpenaiAdsPublishError ? 422 : 503);
    if (draft.provider === "pinterest") {
      const known = error instanceof PinterestAdsConnectionError ? error : null;
      return response({ ready: false, code: known?.code || "pinterest_preflight_invalid", error: known?.message || (error instanceof PinterestAdsPreparationError ? error.message : "La vérification Pinterest avant publication est momentanément indisponible. Réessayez.") }, known?.status || (error instanceof PinterestAdsPreparationError ? 422 : 503));
    }
    if (draft.provider === "google") {
      const api = error instanceof GoogleAdsApiError ? error : null;
      const geo = error instanceof GoogleAdsLocationResolutionError;
      const status = api ? api.status === 401 || api.status === 403 ? 403 : api.status === 429 ? 429 : 503 : geo ? 422 : 422;
      const code = geo ? "ADS_LOCATION_UNRESOLVED" : api ? "google_preflight_unavailable" : "google_preflight_invalid";
      log.warn("google_ads_publication_preflight_failed", { provider: "google", code, status_code: status });
      return response({ ready: false, code, error: api ? "Google Ads n’a pas permis de vérifier cette campagne. Vérifiez la connexion puis réessayez." : geo && error instanceof Error ? error.message : "Vérifiez les paramètres, le calendrier et les conversions Google Search avant publication." }, status);
    }
    const known = error instanceof LinkedInAdsConnectionError ? error : null;
    const code = known?.code || "publication_preflight_failed";
    const status = known?.status || 503;
    log.warn("linkedin_ads_publication_preflight_failed", { provider: "linkedin", code, status_code: status });
    return response({ ready: false, code, error: known?.message || "La vérification LinkedIn avant publication est indisponible." }, status);
  }
}
