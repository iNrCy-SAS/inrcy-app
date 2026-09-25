import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, listAdsAccounts, listMetaPages, requirePremiumAdsUser } from "@/lib/adsServer";
import { publishGoogleAdsCampaign } from "@/lib/adsGooglePublish";
import { MetaAdsPublishError, publishMetaAdsCampaign } from "@/lib/adsMetaPublish";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit } from "@/lib/rateLimit";
import { isAdsProvider, parseAdsCampaignInput } from "@/lib/adsValidation";
import { hasAdsPublishConfirmation, isAdsPublishModeEnabled, parseAdsPublishMode } from "@/lib/adsPublishMode";

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
    .select("id,user_id,provider,ad_account_id,currency,daily_budget_cents,draft,status,provider_resources")
    .eq("id", id).eq("user_id", user.activeUserId).maybeSingle();
  if (readError) return NextResponse.json({ error: "Impossible de relire la campagne." }, { status: 503 });
  if (!stored || stored.status !== "draft") {
    return NextResponse.json({ error: "Cette campagne n’est plus un brouillon publiable. Vérifiez son statut avant toute nouvelle tentative." }, { status: 409 });
  }
  const { draft, error: validationError } = parseAdsCampaignInput(stored.draft, { purpose: "publish" });
  if (!draft || draft.provider !== stored.provider || draft.adAccountId !== stored.ad_account_id || Math.round(draft.dailyBudgetEuros * 100) !== stored.daily_budget_cents) {
    return NextResponse.json({ error: validationError || "Le brouillon a changé et doit être enregistré à nouveau." }, { status: 400 });
  }
  if (!isAdsProvider(draft.provider)) {
    return NextResponse.json({ error: "La connexion et la publication de ce canal ne sont pas encore disponibles." }, { status: 423 });
  }

  let googleLoginCustomerId: string | undefined;
  try {
    const accounts = await listAdsAccounts(user.activeUserId, draft.provider);
    const selectedAccount = accounts.find((account) => account.id === draft.adAccountId && account.currency === "EUR");
    if (!selectedAccount) {
      return NextResponse.json({ error: "Le compte publicitaire EUR sélectionné n’est plus accessible." }, { status: 403 });
    }
    googleLoginCustomerId = selectedAccount.loginCustomerId;
    if (draft.provider === "meta") {
      const pages = await listMetaPages(user.activeUserId);
      if (!pages.some((page) => page.id === draft.pageId)) {
        return NextResponse.json({ error: "La Page Facebook sélectionnée n’est plus accessible." }, { status: 403 });
      }
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "La connexion publicitaire est indisponible." }, { status: 502 });
  }

  // Atomic state transition prevents duplicate paid campaigns or demo resources.
  const { data: claimed, error: claimError } = await supabaseAdmin.from("ads_campaigns")
    .update({ status: "publishing", last_error: null, updated_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", user.activeUserId).eq("status", "draft")
    .select("id").maybeSingle();
  if (claimError || !claimed) {
    return NextResponse.json({ error: "La publication a déjà été lancée. Vérifiez le statut avant de réessayer." }, { status: 409 });
  }

  let progress: Record<string, unknown> = {};
  const persistProgress = async (resources: Record<string, unknown>) => {
    const { error } = await supabaseAdmin.from("ads_campaigns").update({
      provider_resources: resources,
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("user_id", user.activeUserId).eq("status", "publishing");
    if (error) throw new Error("Impossible d’enregistrer les identifiants de la plateforme publicitaire.");
    progress = resources;
  };

  try {
    const resources = draft.provider === "meta"
      ? await publishMetaAdsCampaign(user.activeUserId, draft, persistProgress, { activate: !pausedDemo })
      : await publishGoogleAdsCampaign(user.activeUserId, draft, persistProgress, googleLoginCustomerId, { activate: !pausedDemo });
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
    await supabaseAdmin.from("ads_campaigns").update({
      status: "needs_review",
      provider_resources: resources,
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("user_id", user.activeUserId).eq("status", "publishing");
    return NextResponse.json({ error: `${message} Vérifiez la campagne directement sur ${draft.provider === "meta" ? "Meta Ads Manager" : "Google Ads"} ; ne relancez pas sans contrôle pour éviter un doublon.` }, { status: 502 });
  }
}
