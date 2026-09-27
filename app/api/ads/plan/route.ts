import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import {
  isReviewableAdsCampaignPlan,
  normalizeAdsCampaignPlan,
  plannedAdsChannelPlanPrompt,
  type AdsCampaignPlan,
} from "@/lib/adsCampaignPlan";
import { getPlannedAdsChannelCapability, isPlannedAdsChannel } from "@/lib/adsChannelCapabilities";
import {
  AdsCampaignModelChainError,
  adsPlanNeedsTrustedLocation,
  generateAdsCampaignWithFallback,
} from "@/lib/adsCampaignIntelligence";
import { isAdsChannelId, type AdsChannelId } from "@/lib/adsValidation";
import { aiGenerateJSON, getAiGenerationAttemptTrace } from "@/lib/aiGatewayClient";
import { createAiOperationBudget } from "@/lib/aiGatewayPolicy";
import { buildNormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { EMPTY_AI_MEMORY, normalizeAiMemory } from "@/lib/aiMemory";
import { reserveAiCredits, commitAiCredits, rollbackAiCredits, type AiCreditReservation } from "@/lib/aiUsageQuota";
import { resolveProfessionalCompanyNameFromProfile } from "@/lib/professionalBusinessIdentity";
import { enforceRateLimit } from "@/lib/rateLimit";
import { captureApiException } from "@/lib/observability/sentry";
import { getRequestId } from "@/lib/observability/request";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 120;

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

function planRequestId(request: Request) {
  const candidate = getRequestId(request) || "";
  return /^[A-Za-z0-9_-]{8,100}$/.test(candidate) ? candidate : randomUUID();
}

type PlanFailureCode =
  | "ADS_PROFILE_CONTEXT_UNAVAILABLE"
  | "ADS_PLAN_TIMEOUT"
  | "ADS_PLAN_ENGINE_RATE_LIMITED"
  | "ADS_PLAN_ENGINE_UNAVAILABLE"
  | "ADS_PLAN_RESPONSE_INCOMPLETE"
  | "ADS_PLAN_GENERATION_FAILED";

function generationFailureCode(error: unknown): PlanFailureCode {
  if (error instanceof AdsCampaignModelChainError) {
    if (error.lastAttemptIncomplete) return "ADS_PLAN_RESPONSE_INCOMPLETE";
    if (error.lastError) return generationFailureCode(error.lastError);
    if (error.hadIncompleteResponse) return "ADS_PLAN_RESPONSE_INCOMPLETE";
  }
  const code = error && typeof error === "object"
    ? (error as { code?: unknown }).code
    : undefined;
  const name = error instanceof Error ? error.name : "";
  if (code === "ai_operation_deadline_exceeded" || name === "AbortError" || name === "TimeoutError") return "ADS_PLAN_TIMEOUT";
  if (code === "ai_gateway_rate_limit") return "ADS_PLAN_ENGINE_RATE_LIMITED";
  if (code === "ai_gateway_auth" || code === "ai_gateway_unavailable") return "ADS_PLAN_ENGINE_UNAVAILABLE";
  return "ADS_PLAN_GENERATION_FAILED";
}

function publicPlanError(code: PlanFailureCode, message: string, status: number, requestId: string) {
  return NextResponse.json(
    { error: message, code, requestId },
    { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
  );
}

function planIsReadyForReview(plan: AdsCampaignPlan, provider: AdsChannelId) {
  return isReviewableAdsCampaignPlan(plan, provider);
}

function reportPlanFailure(args: {
  request: Request;
  requestId: string;
  provider: string;
  code: PlanFailureCode;
  stage: "context" | "generation" | "validation" | "credits";
  startedAt: number;
  error?: unknown;
}) {
  const { request, requestId, provider, code, stage, startedAt, error } = args;
  const attemptTrace = getAiGenerationAttemptTrace(
    error instanceof AdsCampaignModelChainError ? error.lastError : error,
  );
  const detail = {
    requestId,
    code,
    stage,
    provider,
    elapsedMs: Date.now() - startedAt,
    attemptedStages: attemptTrace?.stages || [],
    lastAttemptStage: attemptTrace?.lastStage || null,
  };
  console.error("[ads.plan] request failed", detail);
  // A fixed error code reaches Sentry, never a provider response, prompt or
  // professional profile. The request ID links this event to the server log.
  const diagnosticRequest = new Request(request.url, {
    method: request.method,
    headers: { "x-request-id": requestId },
  });
  captureApiException(diagnosticRequest, Object.assign(new Error(code), { code }), {
    area: "ads",
    operation: `POST /api/ads/plan:${stage}`,
    statusCode: code === "ADS_PLAN_TIMEOUT" ? 504 : code === "ADS_PROFILE_CONTEXT_UNAVAILABLE" ? 503 : 502,
    provider,
  });
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

function planSystemPrompt(provider: AdsChannelId) {
  if (isPlannedAdsChannel(provider)) return plannedAdsChannelPlanPrompt(provider);
  return `Tu es le stratège senior d’iNr’ADS. Tu prépares un PLAN DE CAMPAGNE en français pour ${provider}.

Tu aides un professionnel qui ne maîtrise pas la publicité. Toutes les valeurs seront contrôlées, corrigées et validées humainement avant une éventuelle diffusion. Tu ne déclenches jamais une publication et tu ne prétends jamais qu’une campagne est approuvée ou diffusée.

Utilise seulement les faits fournis. N’invente jamais de certification, prix, promotion, résultat, disponibilité, zone ou promesse commerciale. Si une donnée n’est pas connue, laisse le champ prudent ou vide plutôt que de l’inventer.

Avant de répondre, mène silencieusement une analyse complète :
1. compréhension de l’activité, de l’offre et de la différence réelle du professionnel ;
2. adéquation entre objectif, action de conversion, destination et friction potentielle ;
3. intention de recherche ou d’audience, zones, langues et exclusions utiles ;
4. cohérence entre le type de campagne, le format média, les messages et l’appel à l’action ;
5. respect des contraintes éditoriales, vocabulaire interdit et preuves réellement disponibles ;
6. plan de mesure réaliste : action observable, paramètres de suivi seulement si techniquement justifiés ;
7. budget et enchères : choisir une stratégie simple adaptée à la maturité des conversions. Sans historique chiffré fiable, ne crée ni CPA/ROAS cible, ni prévision de clics ou de ventes ;
8. qualité finale de la structure : chaque rubrique utile doit être remplie avec un choix précis et cohérent, que le professionnel peut relire sans jargon.
Si le contexte contient un objectif d’analyse explicite, traite-le comme une direction prioritaire : vérifie sa cohérence avec l’activité, puis construis la campagne la plus adaptée à cet objectif. Si l’analyse est libre, déduis l’angle le plus utile à partir de l’iNrADN sans demander au professionnel de reformuler les informations déjà connues.
Ne révèle pas ce raisonnement intermédiaire : retourne uniquement le JSON demandé. Préfère une campagne focalisée, mesurable et réaliste à une proposition qui essaie de tout faire. Ne laisse pas une rubrique vide quand une recommandation fondée sur le contexte est possible. Ne remplis jamais une rubrique avec une généralité interchangeable. Explique les choix dans rationale en langage professionnel, sans prétendre connaître des statistiques absentes.

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
Pour Google Search : propose 8 à 12 requêtes distinctes et concrètes avec intention commerciale, ancrées dans les services réellement proposés. Donne 8 à 12 titres variés (30 caractères maximum chacun) et 3 à 4 descriptions complémentaires (90 caractères maximum chacune). Varie service, bénéfice vérifiable, zone connue et appel à l’action sans répétition. Ajoute 3 à 8 mots-clés négatifs seulement quand l’exclusion est clairement justifiée ; sinon laisse la liste vide. Ne promets aucun résultat et n’invente pas un lieu.
Pour Google Search : garde mediaStrategy="search_text" et creativeType="image" : l’annonce est textuelle, complétée seulement par UN composant image, jamais par une vidéo. Remplis mediaBrief avec une scène photographique carrée 1:1 directement liée à l’offre réelle, aux recherches et à la page de destination, simple et lisible en petite taille, avec le sujet important dans les 80 % centraux. Ne demande aucun texte, prix, appel à l’action, logo, filigrane, collage ou bordure incrustés dans l’image ; n’invente ni produit, ni équipe, ni lieu, ni preuve. Laisse imageUrl et creativeUrl vides : le média n’existe pas encore à ce stade et sa diffusion dépendra de l’éligibilité et de la validation Google.
Pour Google Search : choisis les langues utiles, précise si les partenaires du Réseau de Recherche sont pertinents et n’active l’exploration Display que si elle est cohérente. Pour Performance Max : les mots-clés deviennent des thèmes de recherche, les audiences sont des signaux, et mediaBrief décrit les images, vidéos et textes à fournir, sans prétendre qu’ils existent déjà. Pour Display, Vidéo et Demand Gen, décris le média requis, son message et son usage dans mediaBrief. Pour Shopping, recommande un flux produit seulement si des produits sont attestés.
Pour Meta : rédige un primaryText concret, lisible et orienté vers l’action, avec une accroche propre à l’activité. Remplis audience, zones, objectif, appel à l’action, lieu de conversion, expansion d’audience et placements. Sélectionne seulement des placements cohérents avec le média proposé et décris le visuel à créer dans mediaBrief. Les textes ne doivent pas attribuer au lecteur une caractéristique personnelle sensible.
Le champ name doit permettre d’identifier l’offre, le canal et la zone si elle est connue. offer décrit le service vérifié, callToAction nomme une action réelle, mediaBrief indique le format, la scène et la preuve à montrer seulement si celle-ci est attestée. trackingParameters doit être une simple chaîne de paramètres UTM ou une chaîne vide, jamais un objet. destinationUrl et urlExclusions ne doivent contenir que des URL explicitement fournies. rationale explique en deux ou trois phrases le lien entre le besoin du professionnel, l’intention du client, le levier choisi et la mesure de conversion.`;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = planRequestId(request);
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
    readContextSource("campaign_history", () => supabaseAdmin
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
    reportPlanFailure({
      request, requestId, provider, code: "ADS_PROFILE_CONTEXT_UNAVAILABLE",
      stage: "context", startedAt,
    });
    return publicPlanError(
      "ADS_PROFILE_CONTEXT_UNAVAILABLE",
      "Les informations de votre profil sont momentanément indisponibles. Réessayez dans un instant.",
      503,
      requestId,
    );
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
  if (adsPlanNeedsTrustedLocation(provider, context.zones, context.localContext.city)) {
    return NextResponse.json({
      error: "Ajoutez une zone d’intervention ou une ville dans iNrADN avant l’analyse de ce canal.",
      code: "ADS_PLAN_LOCATION_REQUIRED",
      requestId,
    }, { status: 422, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
  }

  // The function limit also includes auth, profile reads and credit cleanup.
  // Keep time for rollback/commit and a JSON response after generation stops.
  const generationDeadlineAt = startedAt + maxDuration * 1_000 - 15_000;
  if (Date.now() >= generationDeadlineAt - 5_750) {
    reportPlanFailure({ request, requestId, provider, code: "ADS_PLAN_TIMEOUT", stage: "context", startedAt });
    return publicPlanError(
      "ADS_PLAN_TIMEOUT",
      "L’analyse a pris trop de temps. Réessayez dans un instant ou choisissez le parcours manuel.",
      504,
      requestId,
    );
  }

  let reservation: AiCreditReservation | null = null;
  let stage: "generation" | "validation" | "credits" = "credits";
  const attemptedStages: string[] = [];
  try {
    const quota = await reserveAiCredits({ supabase: user.supabase, userId: user.activeUserId, action: "ads", credits: 1 });
    if (quota.errorResponse) return quota.errorResponse;
    reservation = quota.reservation;
    stage = "generation";
    const budget = createAiOperationBudget("ads.generate");
    const result = await generateAdsCampaignWithFallback({
      generate: (model, index) => aiGenerateJSON<Record<string, unknown>>({
        feature: "ads.generate",
        accountId: user.activeUserId,
        budget,
        model: model,
        // Ads owns its explicit Claude → Mistral → Gemini chain, including
        // validation failures. Disable the generic transport/model fallback.
        allowProviderFallback: false,
        system: planSystemPrompt(provider),
        input: `DONNÉES FIABLES DE L’ENTREPRISE :\n${JSON.stringify(context)}`,
        maxOutputTokens: 8_000,
        timeoutMs: [50_000, 34_000, 23_000][index],
        deadlineAt: generationDeadlineAt,
        onStage: (attemptStage) => {
          attemptedStages.push(`${model}:${attemptStage}`);
          console.info("[ads.plan] generation stage started", { requestId, provider, model, attemptStage });
        },
      }),
      validate: (rawPlan) => {
        stage = "validation";
        if (provider === "meta" && !String(rawPlan.campaignType || "").startsWith("meta_")) {
          rawPlan.campaignType = "meta_leads";
        }
        if (provider === "google" && String(rawPlan.campaignType || "").startsWith("meta_")) {
          rawPlan.campaignType = "search";
        }
        if (isPlannedAdsChannel(provider)) rawPlan.campaignType = "generic";
        // A model cannot verify a URL or location. Retain only user context.
        rawPlan.destinationUrl = destinationUrl || context.localContext.website;
        rawPlan.urlExclusions = [];
        rawPlan.targetLocations = context.zones.length
          ? context.zones
          : context.localContext.city ? [context.localContext.city] : [];
        if (typeof rawPlan.trackingParameters !== "string") rawPlan.trackingParameters = "";
        const candidate = normalizeAdsCampaignPlan(rawPlan, {
          provider,
          companyName,
          destinationUrl: destinationUrl || context.localContext.website,
          locations: context.zones.length
            ? context.zones
            : context.localContext.city ? [context.localContext.city] : [],
          audiences: context.audiences,
          services: context.services,
        });
        if (!context.zones.length && !context.localContext.city) candidate.targetLocations = [];
        return planIsReadyForReview(candidate, provider) ? candidate : null;
      },
      onAttempt: (model, index) => {
        stage = "generation";
        console.info("[ads.plan] model attempt", { requestId, provider, model, attempt: index + 1 });
      },
      shouldRetry: (error) => {
        const code = error && typeof error === "object"
          ? (error as { code?: unknown }).code : undefined;
        // Quota, cost, auth and malformed requests are hard stops, not provider
        // outages. Trying another paid model cannot make them safe or valid.
        return ![
          "ai_operation_budget_exceeded",
          "ai_operation_deadline_exceeded",
          "ai_gateway_account_limit_reached",
          "ai_gateway_guard_unavailable",
          "ai_gateway_auth",
          "ai_gateway_invalid_request",
        ].includes(String(code || ""));
      },
    });
    const plan = result.plan;
    stage = "credits";
    await commitAiCredits(reservation);
    console.info("[ads.plan] request completed", {
      requestId, provider, elapsedMs: Date.now() - startedAt,
      model: result.model,
      campaignType: plan.campaignType,
      headlines: plan.headlines.length,
      descriptions: plan.descriptions.length,
      keywords: plan.keywords.length,
      attemptedStages,
    });
    return NextResponse.json({
      plan,
      requestId,
      creditsUsed: 1,
      requiresHumanReview: true,
      ...(isPlannedAdsChannel(provider) ? {
        draftOnly: true,
        publicationReady: getPlannedAdsChannelCapability(provider).publicationEnabled,
      } : {}),
      sources: [
        "iNrADN",
        ...(context.referenceDocuments.length ? ["documents de référence"] : []),
        ...(context.history.length ? ["historique iNr’ADS"] : []),
        ...(context.recentPublications.length ? ["historique éditorial"] : []),
        ...(analysisObjective ? ["objectif choisi"] : intent ? ["votre priorité"] : []),
      ],
    }, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
  } catch (error) {
    await rollbackAiCredits(reservation);
    const code = error instanceof AdsCampaignModelChainError || stage === "generation"
      ? generationFailureCode(error)
      : "ADS_PLAN_GENERATION_FAILED";
    reportPlanFailure({ request, requestId, provider, code, stage, startedAt, error });
    return publicPlanError(
      code,
      code === "ADS_PLAN_RESPONSE_INCOMPLETE"
        ? "La proposition iNrCy est incomplète après trois moteurs. Réessayez ou choisissez le parcours manuel."
        : "La génération iNrCy n’a pas pu aboutir. Réessayez dans un instant ou choisissez le parcours manuel.",
      code === "ADS_PLAN_TIMEOUT" ? 504 : code === "ADS_PLAN_ENGINE_UNAVAILABLE" ? 503 : 502,
      requestId,
    );
  }
}
