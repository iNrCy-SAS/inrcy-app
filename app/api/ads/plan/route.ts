import { NextResponse } from "next/server";

import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import {
  isUsableAdsCampaignPlan,
  normalizeAdsCampaignPlan,
} from "@/lib/adsCampaignPlan";
import { isAdsChannelId } from "@/lib/adsValidation";
import { DEFAULT_AI_PREFERRED_ENGINE } from "@/lib/aiEnginePreference";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import { buildNormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { EMPTY_AI_MEMORY, normalizeAiMemory } from "@/lib/aiMemory";
import { reserveAiCredits, commitAiCredits, rollbackAiCredits, type AiCreditReservation } from "@/lib/aiUsageQuota";
import { resolveProfessionalCompanyNameFromProfile } from "@/lib/professionalBusinessIdentity";
import { enforceRateLimit } from "@/lib/rateLimit";

export const maxDuration = 60;

function clean(value: unknown, max: number) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function compactList(value: readonly string[] | undefined, maxItems: number, maxLength: number) {
  return (value || []).map((item) => clean(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function planSystemPrompt(provider: string) {
  return `Tu es le stratège senior d’iNr’ADS. Tu prépares un PLAN DE CAMPAGNE en français pour ${provider}.

Tu aides un professionnel qui ne maîtrise pas la publicité. Toutes les valeurs seront contrôlées, corrigées et validées humainement avant une éventuelle diffusion. Tu ne déclenches jamais une publication et tu ne prétends jamais qu’une campagne est approuvée ou diffusée.

Utilise seulement les faits fournis. N’invente jamais de certification, prix, promotion, résultat, disponibilité, zone ou promesse commerciale. Si une donnée n’est pas connue, laisse le champ prudent ou vide plutôt que de l’inventer.

Retourne un objet JSON avec exactement ces clés :
brand, name, campaignType, objective, conversionGoal, conversionLocation, bidStrategy, offer, destinationUrl, urlExpansion, urlExclusions, targetLocations, targetAudiences, languages, googleSearchPartners, googleDisplayExpansion, metaAudienceExpansion, metaPlacements, trackingParameters, primaryText, imageUrl, creativeUrl, creativeType, mediaStrategy, mediaBrief, callToAction, headlines, descriptions, keywords, negativeKeywords, rationale.

Valeurs autorisées :
- campaignType : search | performance_max | display | video | demand_gen | shopping | meta_sales | meta_leads | meta_traffic | meta_awareness | generic
- objective : leads | sales | website_traffic | awareness | engagement | app_promotion
- conversionGoal : quote_request | lead_form | phone_call | website_visit | purchase | message | store_visit | custom
- conversionLocation : website | instant_form | messaging | phone | store
- bidStrategy : maximize_conversions | maximize_clicks | maximize_value | target_cpa | target_roas | manual_review
- mediaStrategy : search_text | image | video | mixed | product_feed
- creativeType : image | video
- metaPlacements : tableau parmi facebook_feed | instagram_feed | stories | reels | messenger

L’historique éditorial sert à éviter de répéter un angle déjà beaucoup employé : il ne constitue jamais une preuve commerciale ni une information à inventer.
Pour Google Search : propose entre 5 et 12 mots-clés d’intention, 3 à 8 titres (30 caractères maximum) et 2 à 4 descriptions (90 caractères maximum). Ajoute des mots-clés négatifs seulement s’ils sont justifiés par le contexte.
Pour Google Search : choisis les langues utiles, précise si les partenaires du Réseau de Recherche sont pertinents et n’active l’exploration Display que si elle est cohérente. Pour Performance Max : les mots-clés deviennent des thèmes de recherche, les audiences sont des signaux, et mediaBrief détaille les actifs utiles. Pour Display, Vidéo et Demand Gen, mets l’accent sur les médias requis.
Pour Meta : privilégie une proposition simple avec texte, audience, zones, objectif, appel à l’action, lieu de conversion, expansion d’audience et placements. Ne sélectionne que des placements cohérents avec le média proposé.
Le champ rationale explique en deux phrases maximum la logique proposée, sans jargon inutile.`;
}

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const provider = isAdsChannelId(body.provider) ? body.provider : null;
  const intent = clean(body.intent, 1_200);
  const destinationUrl = clean(body.destinationUrl, 2_000);
  if (!provider) return NextResponse.json({ error: "Choisissez d’abord un canal publicitaire." }, { status: 400 });

  const limited = await enforceRateLimit({ name: "ads_plan", identifier: user.authUserId, limit: 24, window: "1 d" });
  if (limited) return limited;

  const [memoryResult, businessResult, profileResult, historyResult, publicationHistoryResult] = await Promise.all([
    user.supabase
      .from("business_ai_memories")
      .select("memory")
      .eq("account_id", user.activeUserId)
      .maybeSingle(),
    user.supabase
      .from("business_profiles")
      .select("*")
      .eq("user_id", user.activeUserId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    user.supabase
      .from("profiles")
      .select("company_legal_name")
      .eq("user_id", user.activeUserId)
      .maybeSingle(),
    user.supabase
      .from("ads_campaigns")
      .select("name,provider,created_at")
      .eq("user_id", user.activeUserId)
      .order("created_at", { ascending: false })
      .limit(8),
    Promise.resolve(
      user.supabase
        .from("publications")
        .select("title,content,cta,idea,created_at")
        .eq("user_id", user.activeUserId)
        .order("created_at", { ascending: false })
        .limit(6),
    ).catch(() => ({ data: [], error: null })),
  ]);

  if (businessResult.error || profileResult.error || memoryResult.error || historyResult.error) {
    return NextResponse.json({ error: "L’analyse iNrCy ne peut pas lire les données de l’entreprise pour le moment." }, { status: 503 });
  }

  const companyName = resolveProfessionalCompanyNameFromProfile(
    profileResult.data?.company_legal_name,
    businessResult.data?.company_legal_name,
    businessResult.data?.company_name,
    businessResult.data?.business_name,
  );
  const memory = normalizeAiMemory(memoryResult.data?.memory || EMPTY_AI_MEMORY, { includePremium: true });
  const profile = buildNormalizedAiGenerationProfile({
    profile: profileResult.data,
    business: businessResult.data,
    idea: intent,
    theme: `Campagne ${provider}`,
  });
  const context = {
    companyName,
    sector: profile.business.sectorLabel,
    profession: profile.business.professionLabel,
    description: clean(profile.business.description || memory.detailedDescription, 1_000),
    services: compactList(profile.business.services.length ? profile.business.services : memory.specialties, 12, 120),
    zones: compactList(profile.business.interventionZones, 12, 120),
    audiences: compactList(profile.business.customerTypologies.length ? profile.business.customerTypologies : memory.targetAudiences, 12, 160),
    strengths: compactList([...profile.business.strengths, ...memory.differentiators], 12, 160),
    offers: clean(memory.offersAndArguments || memory.keyArguments, 1_200),
    restrictions: compactList(memory.forbiddenVocabulary, 12, 120),
    history: (historyResult.data || []).map((item: { name?: unknown; provider?: unknown }) => ({
      name: clean(item.name, 100),
      provider: clean(item.provider, 40),
    })),
    recentPublications: (publicationHistoryResult.data || []).map((item: {
      title?: unknown;
      content?: unknown;
      cta?: unknown;
      idea?: unknown;
    }) => ({
      title: clean(item.title, 120),
      content: clean(item.content, 360),
      callToAction: clean(item.cta, 100),
      idea: clean(item.idea, 160),
    })),
    professionalIntent: intent,
    preferredDestinationUrl: destinationUrl,
  };
  const hasBusinessSignal = Boolean(
    context.companyName || context.description || context.services.length || context.zones.length || context.audiences.length || intent,
  );
  if (!hasBusinessSignal) {
    return NextResponse.json({ error: "Ajoutez quelques informations dans iNrADN ou une intention de campagne pour qu’iNrCy prépare une proposition fiable." }, { status: 422 });
  }

  let reservation: AiCreditReservation | null = null;
  try {
    const quota = await reserveAiCredits({ supabase: user.supabase, userId: user.activeUserId, action: "ads", credits: 1 });
    if (quota.errorResponse) return quota.errorResponse;
    reservation = quota.reservation;
    const rawPlan = await aiGenerateJSON<Record<string, unknown>>({
      feature: "ads.generate",
      accountId: user.activeUserId,
      engine: DEFAULT_AI_PREFERRED_ENGINE,
      system: planSystemPrompt(provider),
      input: `DONNÉES FIABLES DE L’ENTREPRISE :\n${JSON.stringify(context)}`,
      maxOutputTokens: 1_800,
      temperature: 0.45,
    });
    const plan = normalizeAdsCampaignPlan(rawPlan, {
      provider,
      companyName,
      destinationUrl,
      locations: context.zones,
      audiences: context.audiences,
      services: context.services,
    });
    if (!isUsableAdsCampaignPlan(plan)) {
      await rollbackAiCredits(reservation);
      return NextResponse.json({ error: "La proposition iNrCy est incomplète. Réessayez ou choisissez le parcours manuel." }, { status: 502 });
    }
    await commitAiCredits(reservation);
    return NextResponse.json({
      plan,
      creditsUsed: 1,
      requiresHumanReview: true,
      sources: [
        "iNrADN",
        ...(context.history.length ? ["historique iNr’ADS"] : []),
        ...(intent ? ["votre priorité"] : []),
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await rollbackAiCredits(reservation);
    return NextResponse.json({ error: "La génération iNrCy n’a pas pu aboutir. Réessayez dans un instant ou choisissez le parcours manuel." }, { status: 502 });
  }
}
