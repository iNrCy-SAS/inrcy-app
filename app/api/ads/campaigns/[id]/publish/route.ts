import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, listAdsAccounts, listMetaPages, readAdsIntegration, requirePremiumAdsUser } from "@/lib/adsServer";
import { GoogleAdsLocationResolutionError, publishGoogleAdsCampaign, resolveGoogleTargetLocations, type GoogleTargetLocation } from "@/lib/adsGooglePublish";
import { MetaAdsPublishError, publishMetaAdsCampaign } from "@/lib/adsMetaPublish";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit } from "@/lib/rateLimit";
import { isAdsProvider, parseAdsCampaignInput } from "@/lib/adsValidation";
import { hasAdsPublishConfirmation, isAdsPublishModeEnabled, parseAdsPublishMode, unsupportedAdsConnectorReason } from "@/lib/adsPublishMode";
import { GoogleAdsApiError } from "@/lib/adsGoogleApiError";

export const runtime = "nodejs";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const body = await request.json().catch(() => null) as { confirmation?: unknown; mode?: unknown } | null;
  const mode = parseAdsPublishMode(body?.mode);
  const pausedDemo = mode === "demo_paused";
  if (!isAdsPublishModeEnabled(mode, process.env)) {
    return NextResponse.json({ error: pausedDemo ? "Le mode démo en pause est verrouillé. Activez-le uniquement dans un environnement de démonstration contrôlé." : "La publication réelle est verrouillée tant que les accès publicitaires ne sont pas validés et testés." }, { status: 423 });
  }
  if (!hasAdsPublishConfirmation(mode, body?.confirmation)) {
    return NextResponse.json({ error: pausedDemo ? "Confirmez explicitement la création d’une démo entièrement en pause." : "Confirmez explicitement la publication et la dépense publicitaire." }, { status: 400 });
  }
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Identifiant de campagne invalide." }, { status: 400 });
  }
  const limited = await enforceRateLimit({ name: pausedDemo ? "ads_demo_paused" : "ads_publish", identifier: user.authUserId, limit: pausedDemo ? 4 : 8, window: "1 h" });
  if (limited) return limited;

  const { data: stored, error: readError } = await supabaseAdmin.from("ads_campaigns")
    .select("id,user_id,provider,ad_account_id,currency,daily_budget_cents,draft,status,provider_resources,published_at,updated_at")
    .eq("id", id).eq("user_id", user.activeUserId).maybeSingle();
  if (readError) return NextResponse.json({ error: "Impossible de relire la campagne." }, { status: 503 });
  if (!stored || stored.status !== "draft" || stored.published_at !== null
    || !stored.provider_resources || typeof stored.provider_resources !== "object" || Array.isArray(stored.provider_resources)
    || Object.keys(stored.provider_resources).length > 0) {
    return NextResponse.json({ error: "Cette campagne n’est plus un brouillon publiable. Vérifiez son statut avant toute nouvelle tentative." }, { status: 409 });
  }
  const { draft, error: validationError } = parseAdsCampaignInput(stored.draft, { purpose: "publish" });
  if (!draft || draft.provider !== stored.provider || draft.adAccountId !== stored.ad_account_id || Math.round(draft.dailyBudgetEuros * 100) !== stored.daily_budget_cents) {
    return NextResponse.json({ error: validationError || "Le brouillon a changé et doit être enregistré à nouveau." }, { status: 400 });
  }
  if (!isAdsProvider(draft.provider)) {
    return NextResponse.json({ error: "La connexion et la publication de ce canal ne sont pas encore disponibles." }, { status: 423 });
  }
  const unsupportedReason = unsupportedAdsConnectorReason(draft);
  if (unsupportedReason) {
    return NextResponse.json({ code: "ADS_CONNECTOR_UNSUPPORTED_CONFIGURATION", error: unsupportedReason }, { status: 422 });
  }

  let googleLoginCustomerId: string | undefined;
  let preparedGoogleTargetLocations: GoogleTargetLocation[] | undefined;
  try {
    const connection = await readAdsIntegration(user.activeUserId, draft.provider);
    if (connection?.status !== "connected" || connection.resource_id !== draft.adAccountId) {
      return NextResponse.json({ error: "Ce compte annonceur n’est plus celui associé à votre canal publicitaire. Vérifiez l’association avant de créer la campagne." }, { status: 409 });
    }
    const accounts = await listAdsAccounts(user.activeUserId, draft.provider);
    const selectedAccount = accounts.find((account) => account.id === draft.adAccountId && account.currency === "EUR");
    if (!selectedAccount) {
      return NextResponse.json({ error: "Le compte publicitaire EUR sélectionné n’est plus accessible." }, { status: 403 });
    }
    googleLoginCustomerId = selectedAccount.loginCustomerId;
    if (draft.provider === "google") {
      // Resolve before claiming the local draft: invalid/ambiguous zones must
      // remain editable, and no Google mutation has started at this point.
      preparedGoogleTargetLocations = await resolveGoogleTargetLocations(
        user.activeUserId, draft.adAccountId, draft.targetLocations, googleLoginCustomerId,
      );
    }
    if (draft.provider === "meta") {
      const pages = await listMetaPages(user.activeUserId);
      if (!pages.some((page) => page.id === draft.pageId)) {
        return NextResponse.json({ error: "La Page Facebook sélectionnée n’est plus accessible." }, { status: 403 });
      }
    }
  } catch (error) {
    if (error instanceof GoogleAdsLocationResolutionError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: 422 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "La connexion publicitaire est indisponible." }, { status: 502 });
  }

  // The database re-checks owner, state and remote resources in the same UPDATE.
  const { data: claimed, error: claimError } = await supabaseAdmin.rpc("inrcy_claim_ads_draft_for_publish", {
    p_user_id: user.activeUserId,
    p_campaign_id: id,
    p_expected_updated_at: stored.updated_at,
  });
  if (claimError) {
    return NextResponse.json({ error: "La vérification du brouillon avant publication est indisponible." }, { status: 503 });
  }
  if (!claimed) {
    return NextResponse.json({ error: "La publication a déjà été lancée. Vérifiez le statut avant de réessayer." }, { status: 409 });
  }

  let progress: Record<string, unknown> = {};
  let metaProviderMutationStarted = false;
  const persistProgress = async (resources: Record<string, unknown>) => {
    // Keep newly created provider IDs even if the database write fails or times out.
    // The recovery path can then record them under needs_review instead of {}.
    progress = resources;
    const { data, error } = await supabaseAdmin.from("ads_campaigns").update({
      provider_resources: resources,
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("user_id", user.activeUserId).eq("status", "publishing")
      .select("id").maybeSingle();
    if (error || !data) throw new Error("Impossible d’enregistrer les identifiants de la plateforme publicitaire.");
  };

  try {
    const resources = draft.provider === "meta"
      ? await publishMetaAdsCampaign(user.activeUserId, draft, persistProgress, {
        activate: !pausedDemo,
        onProviderMutationStart: () => { metaProviderMutationStarted = true; },
      })
      : await publishGoogleAdsCampaign(user.activeUserId, draft, persistProgress, googleLoginCustomerId, { activate: !pausedDemo, preparedTargetLocations: preparedGoogleTargetLocations });
    const completedResources = pausedDemo
      ? { ...resources, demoPaused: true, demoCreatedAt: new Date().toISOString() }
      : resources;
    const { data: completed, error: finalError } = await supabaseAdmin.from("ads_campaigns").update({
      status: pausedDemo ? "demo_paused" : "active",
      provider_resources: completedResources,
      published_at: pausedDemo ? null : new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("user_id", user.activeUserId).eq("status", "publishing")
      .select("id,status,provider_resources").maybeSingle();
    if (finalError || !completed) {
      throw new Error(pausedDemo ? "La démo a pu être créée en pause, mais son statut local n’a pas pu être confirmé. Vérifiez la plateforme avant toute nouvelle tentative." : "La campagne peut être active, mais son statut local n’a pas pu être confirmé. Vérifiez la plateforme avant toute nouvelle tentative.");
    }
    return NextResponse.json({ campaign: completed, mode });
  } catch (error) {
    const message = error instanceof Error ? error.message : "La plateforme publicitaire a refusé la campagne.";
    const resources = error instanceof MetaAdsPublishError ? error.progress : progress;
    // A Google 400 on the first atomic mutate cannot leave provider objects
    // behind. Return the local row to draft so the precise validation error can
    // be fixed and retried without stranding it in needs_review.
    const googleRejectedBeforeCreate = draft.provider === "google" && error instanceof GoogleAdsApiError
      && error.status === 400 && Object.keys(resources).length === 0;
    // Meta performs account, Page, Instagram, URL, media download and image
    // dimension checks before this boundary. Those failures are safe to fix
    // and retry. Once a Graph mutation may have started, keep needs_review
    // even when a network failure returned no ID: retrying could duplicate a
    // remotely-created campaign whose response was lost.
    const metaRejectedBeforeCreate = draft.provider === "meta" && !metaProviderMutationStarted
      && Object.keys(resources).length === 0;
    const rejectedBeforeCreate = googleRejectedBeforeCreate || metaRejectedBeforeCreate;
    await supabaseAdmin.from("ads_campaigns").update({
      status: rejectedBeforeCreate ? "draft" : "needs_review",
      provider_resources: rejectedBeforeCreate ? {} : resources,
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("user_id", user.activeUserId).eq("status", "publishing");
    return NextResponse.json({ error: rejectedBeforeCreate ? `${message} Le brouillon iNrCy peut être corrigé puis renvoyé.` : `${message} Vérifiez la campagne directement sur ${draft.provider === "meta" ? "Meta Ads Manager" : "Google Ads"} ; ne relancez pas sans contrôle pour éviter un doublon.` }, { status: rejectedBeforeCreate ? 422 : 502 });
  }
}
