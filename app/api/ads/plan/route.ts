import { NextResponse } from "next/server";

import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import {
  isUsableAdsCampaignPlan,
  normalizeAdsCampaignPlan,
} from "@/lib/adsCampaignPlan";
import { resolveAdsCampaignStrategistModel } from "@/lib/adsCampaignIntelligence";
import { isAdsChannelId } from "@/lib/adsValidation";
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

type ContextQueryResult<T> = {
  data: T | null;
  error: unknown | null;
};

type MemoryContextRecord = { memory?: unknown };
type BusinessContextRecord = {
  company_legal_name?: unknown;
  company_name?: unknown;
  business_name?: unknown;
  [key: string]: unknown;
};
type ProfessionalContextRecord = { company_legal_name?: unknown };
type CampaignHistoryContextRecord = { name?: unknown; provider?: unknown };
type PublicationHistoryContextRecord = {
  title?: unknown;
  content?: unknown;
  cta?: unknown;
  idea?: unknown;
};

function contextErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "unknown";
  return clean((error as { code?: unknown }).code, 80) || "unknown";
}

/**
 * Le plan reste utile si une source d'enrichissement (mémoire, historique) est
 * momentanément indisponible. Chaque lecture reste faite avec le client RLS de
 * l'utilisateur : ce garde-fou ne contourne donc jamais les autorisations.
 */
async function readContextSource<T>(
  source: string,
  query: () => PromiseLike<ContextQueryResult<T>>,
): Promise<ContextQueryResult<T>> {
  try {
    const result = await query();
    if (result.error) {
      console.warn("[ads.plan] optional context source unavailable", {
        source,
        code: contextErrorCode(result.error),
      });
    }
    return result;
  } catch (error) {
    console.warn("[ads.plan] optional context source unavailable", {
      source,
      code: contextErrorCode(error),
    });
    return { data: null, error };
  }
}

function planSystemPrompt(provider: string) {
  return `Tu es le stratège senior d’iNr’ADS. Tu prépares un PLAN DE CAMPAGNE en français pour ${provider}.

Tu aides un professionnel qui ne maîtrise pas la publicité. Toutes les valeurs seront contrôlées, corrigées et validées humainement avant une éventuelle diffusion. Tu ne déclenches jamais une publication et tu ne prétends jamais qu’une campagne est approuvée ou diffusée.

Utilise seulement les faits fournis. N’invente jamais de certification, prix, promotion, résultat, disponibilité, zone ou promesse commerciale. Si une donnée n’est pas connue, laisse le champ prudent ou vide plutôt que de l’inventer.

Avant de répondre, mène silencieusement une analyse complète :
1. compréhension de l’activité, de l’offre et de la différence réelle du professionnel ;
2. adéquation entre objectif, action de conversion, destination et friction potentielle ;
3. intention de recherche ou d’audience, zones, langues et exclusions utiles ;
4. cohérence entre le type de campagne, le format média, les messages et l’appel à l’action ;
5. respect des contraintes éditoriales, vocabulaire interdit et preuves réellement disponibles ;
6. qualité finale de la structure : le professionnel doit pouvoir relire et comprendre chaque décision sans jargon.
Si le contexte contient un objectif d’analyse explicite, traite-le comme une direction prioritaire : vérifie sa cohérence avec l’activité, puis construis la campagne la plus adaptée à cet objectif. Si l’analyse est libre, déduis l’angle le plus utile à partir de l’iNrADN sans demander au professionnel de reformuler les informations déjà connues.
Ne révèle pas ce raisonnement intermédiaire : retourne uniquement le JSON demandé. Préfère une campagne focalisée, mesurable et réaliste à une proposition qui essaie de tout faire.

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
Le champ rationale explique en deux phrases maximum la logique proposée, sans jargon inutile. Il doit faire le lien entre le besoin du professionnel, l’intention du client et le levier choisi.`;
}

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const provider = isAdsChannelId(body.provider) ? body.provider : null;
  const intent = clean(body.intent, 1_200);
  const analysisMode = body.analysisMode === "goal" ? "goal" as const : "open" as const;
  const analysisObjective = clean(body.analysisObjective, 1_200);
  const destinationUrl = clean(body.destinationUrl, 2_000);
  if (!provider) return NextResponse.json({ error: "Choisissez d’abord un canal publicitaire." }, { status: 400 });
  if (analysisMode === "goal" && !analysisObjective) {
    return NextResponse.json({ error: "Décrivez l’objectif que vous souhaitez confier à iNrCy." }, { status: 400 });
  }

  const limited = await enforceRateLimit({ name: "ads_plan", identifier: user.authUserId, limit: 24, window: "1 d" });
  if (limited) return limited;

  const [memoryResult, businessResult, profileResult, historyResult, publicationHistoryResult] = await Promise.all([
    readContextSource("ai_memory", () => user.supabase
      .from("business_ai_memories")
      .select("memory")
      .eq("account_id", user.activeUserId)
      .maybeSingle() as PromiseLike<ContextQueryResult<MemoryContextRecord>>),
    readContextSource("business_profile", () => user.supabase
      .from("business_profiles")
      .select("*")
      .eq("user_id", user.activeUserId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle() as PromiseLike<ContextQueryResult<BusinessContextRecord>>),
    readContextSource("professional_profile", () => user.supabase
      .from("profiles")
      .select("company_legal_name")
      .eq("user_id", user.activeUserId)
      .maybeSingle() as PromiseLike<ContextQueryResult<ProfessionalContextRecord>>),
    readContextSource("campaign_history", () => user.supabase
      .from("ads_campaigns")
      .select("name,provider,created_at")
      .eq("user_id", user.activeUserId)
      .order("created_at", { ascending: false })
      .limit(8) as PromiseLike<ContextQueryResult<CampaignHistoryContextRecord[]>>),
    readContextSource("publication_history", () =>
      user.supabase
        .from("publications")
        .select("title,content,cta,idea,created_at")
        .eq("user_id", user.activeUserId)
        .order("created_at", { ascending: false })
        .limit(6) as PromiseLike<ContextQueryResult<PublicationHistoryContextRecord[]>>),
  ]);

  const hasReadableProfessionalProfile = Boolean(profileResult.data || businessResult.data);
  if (!hasReadableProfessionalProfile && (businessResult.error || profileResult.error)) {
    return NextResponse.json({
      error: "Les informations de votre profil sont momentanément indisponibles. Réessayez dans un instant.",
      code: "ADS_PROFILE_CONTEXT_UNAVAILABLE",
    }, { status: 503 });
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
    idea: analysisObjective || intent,
    theme: `Campagne ${provider}`,
  });
  const context = {
    companyName,
    sector: profile.business.sectorLabel,
    profession: profile.business.professionLabel,
    description: clean(profile.business.description || memory.detailedDescription, 1_000),
    localContext: {
      city: clean(profile.business.city, 100),
      postalCode: clean(profile.business.postalCode, 24),
      openingHours: clean(profile.business.openingHours, 600),
      website: clean(
        businessResult.data?.website
          ?? businessResult.data?.website_url
          ?? businessResult.data?.site_url,
        2_000,
      ),
    },
    services: compactList(profile.business.services.length ? profile.business.services : memory.specialties, 12, 120),
    zones: compactList(profile.business.interventionZones, 12, 120),
    audiences: compactList(profile.business.customerTypologies.length ? profile.business.customerTypologies : memory.targetAudiences, 12, 160),
    strengths: compactList([...profile.business.strengths, ...memory.differentiators], 12, 160),
    customerNeeds: compactList(memory.customerNeeds, 12, 160),
    values: compactList(memory.values, 10, 120),
    brandPersonality: compactList(memory.brandPersonality, 10, 120),
    commitments: compactList(memory.commitments, 10, 160),
    preferredVocabulary: compactList(memory.preferredVocabulary, 16, 100),
    restrictions: compactList(memory.forbiddenVocabulary, 12, 120),
    offers: clean(memory.offersAndArguments || memory.keyArguments, 1_200),
    proofPointsAndObjections: clean(memory.proofsAndObjections, 1_600),
    objectionResponses: clean(memory.objectionResponses, 1_200),
    editorialStrategy: clean(memory.editorialStrategy, 1_000),
    campaignCalendar: clean(memory.campaignCalendar, 800),
    communicationPreferences: {
      language: profile.preferences.language,
      tone: profile.preferences.tone,
      style: profile.preferences.communicationStyle,
      creativity: profile.preferences.creativity,
      voice: profile.preferences.voice,
      addressMode: profile.preferences.addressMode,
      commercialLevel: profile.preferences.commercialLevel,
      preferredAngle: profile.preferences.preferredAngle,
      preferredCallToAction: profile.preferences.preferredCta,
      customInstructions: clean(profile.preferences.customInstructions, 1_400),
      forbiddenInstructions: clean(profile.preferences.forbiddenInstructions, 1_000),
      likedExample: clean(profile.preferences.likedExample, 800),
      likedExample2: clean(profile.preferences.likedExample2, 800),
    },
    referenceDocuments: memory.referenceDocuments
      .filter((document) => document.status === "analysed")
      .map((document) => ({
        name: clean(document.name, 180),
        note: clean(document.note, 280),
        excerpt: clean(document.extractedText, 900),
      }))
      .filter((document) => document.note || document.excerpt)
      .slice(0, 3),
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
    analysisDirection: analysisMode === "goal"
      ? { mode: "objectif précis", objective: analysisObjective }
      : { mode: "analyse libre", instruction: "Identifier l’angle de campagne le plus pertinent à partir de l’iNrADN." },
    professionalIntent: analysisObjective || intent,
    preferredDestinationUrl: destinationUrl,
  };
  const hasBusinessSignal = Boolean(
    context.companyName || context.description || context.services.length || context.zones.length || context.audiences.length || analysisObjective || intent,
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
      model: resolveAdsCampaignStrategistModel(),
      system: planSystemPrompt(provider),
      input: `DONNÉES FIABLES DE L’ENTREPRISE :\n${JSON.stringify(context)}`,
      maxOutputTokens: 2_600,
      timeoutMs: 55_000,
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
        ...(context.referenceDocuments.length ? ["documents de référence"] : []),
        ...(context.history.length ? ["historique iNr’ADS"] : []),
        ...(context.recentPublications.length ? ["historique éditorial"] : []),
        ...(analysisObjective ? ["objectif choisi"] : intent ? ["votre priorité"] : []),
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await rollbackAiCredits(reservation);
    return NextResponse.json({ error: "La génération iNrCy n’a pas pu aboutir. Réessayez dans un instant ou choisissez le parcours manuel." }, { status: 502 });
  }
}
