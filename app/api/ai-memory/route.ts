import { NextResponse } from "next/server";

import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import {
  EMPTY_AI_BUSINESS_KNOWLEDGE,
  EMPTY_AI_MEMORY,
  getAiWorkspaceCompletionScore,
  mergeAiBusinessKnowledgeUpdate,
  mergeAiMemoryUpdate,
  mergeAiMemoryPremiumFields,
  normalizeAiBusinessKnowledge,
  normalizeAiMemory,
  type AiMemory,
} from "@/lib/aiMemory";
import { decodeBusinessSector } from "@/lib/activitySectors";
import {
  findJobValueByLabel,
  getServicesForSectorAndJob,
  isValidJobForSector,
} from "@/lib/activityCatalog";
import { buildNormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { invalidateBoosterGenerationContext } from "@/lib/boosterGenerationContext";
import { hasPremiumDashboardAccess } from "@/lib/dashboardEdition";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { requireUser } from "@/lib/requireUser";
import {
  decodeBusinessWeeklySchedule,
  encodeBusinessWeeklySchedule,
  formatBusinessWeeklySchedule,
} from "@/lib/businessWeeklySchedule";

export const maxDuration = 30;

const MAX_REQUEST_CHARS = 70_000;

function migrationRequiredResponse(error: unknown) {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message || "")
    : String(error || "");
  if (!/business_ai_memories|ai_web_length|ai_social_length/i.test(message)) return null;

  return NextResponse.json(
    {
      error: "L’ADN de l’entreprise doit d’abord être activé dans Supabase.",
      user_message: "L’ADN de l’entreprise doit d’abord être activé dans Supabase.",
      error_code: "ai_memory_migration_required",
    },
    { status: 503 },
  );
}

function buildBusinessKnowledge(business: Record<string, unknown> | null | undefined, memory: AiMemory) {
  if (!business) {
    return normalizeAiBusinessKnowledge({
      ...EMPTY_AI_BUSINESS_KNOWLEDGE,
      description: memory.detailedDescription,
      strengths: memory.differentiators,
    });
  }

  const professionalProfile = buildNormalizedAiGenerationProfile({ business });
  const decodedSector = decodeBusinessSector(String(business.sector || ""));
  const jobValue = isValidJobForSector(decodedSector.sectorCategory, decodedSector.profession)
    ? decodedSector.profession
    : findJobValueByLabel(decodedSector.sectorCategory, decodedSector.profession);
  const defaultServices = jobValue
    ? getServicesForSectorAndJob(decodedSector.sectorCategory, jobValue)
    : [];

  return normalizeAiBusinessKnowledge({
    description:
      business.business_description ||
      business.activity_description ||
      memory.detailedDescription,
    services: professionalProfile.business.services.length
      ? professionalProfile.business.services
      : defaultServices,
    interventionZones: professionalProfile.business.interventionZones,
    weeklySchedule: decodeBusinessWeeklySchedule(
      business.opening_days,
      business.opening_hours,
    ),
    strengths: [
      ...professionalProfile.business.strengths,
      ...memory.differentiators,
    ],
    customerTypes: professionalProfile.business.customerTypologies,
  });
}

export async function GET() {
  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  const [edition, memoryResult, businessResult] = await Promise.all([
    getDashboardEditionForAccountId(activeUserId),
    supabase
      .from("business_ai_memories")
      .select("memory,completion_score,updated_at")
      .eq("account_id", activeUserId)
      .maybeSingle(),
    supabase
      .from("business_profiles")
      .select("*")
      .eq("user_id", activeUserId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (memoryResult.error) {
    return migrationRequiredResponse(memoryResult.error) ||
      jsonUserFacingError(memoryResult.error, { status: 500 });
  }
  if (businessResult.error) {
    return jsonUserFacingError(businessResult.error, { status: 500 });
  }

  const premiumEnabled = hasPremiumDashboardAccess(edition);
  const storedMemory = normalizeAiMemory(memoryResult.data?.memory || EMPTY_AI_MEMORY, {
    includePremium: premiumEnabled,
  });
  const professionalProfile = buildNormalizedAiGenerationProfile({
    business: businessResult.data,
  });
  const businessKnowledge = buildBusinessKnowledge(businessResult.data, storedMemory);
  const memory = normalizeAiMemory(
    {
      ...storedMemory,
      detailedDescription: businessKnowledge.description || storedMemory.detailedDescription,
      differentiators: businessKnowledge.strengths.length
        ? businessKnowledge.strengths
        : storedMemory.differentiators,
    },
    { includePremium: premiumEnabled },
  );

  return NextResponse.json(
    {
      ok: true,
      edition,
      premiumEnabled,
      memory,
      businessKnowledge,
      completionScore: getAiWorkspaceCompletionScore(memory, businessKnowledge, {
        includePremium: premiumEnabled,
      }),
      updatedAt: memoryResult.data?.updated_at || null,
      profileFoundation: {
        sector: professionalProfile.business.sectorLabel,
        profession: professionalProfile.business.professionLabel,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(req: Request) {
  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return NextResponse.json(
      { error: "L’ADN de l’entreprise est trop volumineux.", error_code: "ai_memory_too_large" },
      { status: 413 },
    );
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_REQUEST_CHARS) {
    return NextResponse.json(
      { error: "L’ADN de l’entreprise est trop volumineux.", error_code: "ai_memory_too_large" },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return NextResponse.json(
      { error: "Les informations de l’ADN de l’entreprise sont invalides.", error_code: "invalid_json" },
      { status: 400 },
    );
  }
  const input = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

  const edition = await getDashboardEditionForAccountId(activeUserId);
  const premiumEnabled = hasPremiumDashboardAccess(edition);
  const [currentMemoryResult, currentBusinessResult] = await Promise.all([
    supabase
      .from("business_ai_memories")
      .select("memory")
      .eq("account_id", activeUserId)
      .maybeSingle(),
    supabase
      .from("business_profiles")
      .select("*")
      .eq("user_id", activeUserId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (currentMemoryResult.error) {
    return migrationRequiredResponse(currentMemoryResult.error) ||
      jsonUserFacingError(currentMemoryResult.error, { status: 500 });
  }
  if (currentBusinessResult.error) {
    return jsonUserFacingError(currentBusinessResult.error, { status: 500 });
  }

  const hasBusinessKnowledge = Object.prototype.hasOwnProperty.call(input, "businessKnowledge");
  const hasVocabularyUpdate = Object.prototype.hasOwnProperty.call(input, "vocabulary");
  const vocabularyInput = hasVocabularyUpdate && input.vocabulary && typeof input.vocabulary === "object" && !Array.isArray(input.vocabulary)
    ? input.vocabulary as Record<string, unknown>
    : {};
  const currentMemory = normalizeAiMemory(currentMemoryResult.data?.memory, { includePremium: true });
  let memory = hasVocabularyUpdate
    ? mergeAiMemoryUpdate(currentMemory, vocabularyInput, { includePremium: true })
    : mergeAiMemoryUpdate(currentMemory, input.memory ?? input, { includePremium: true });
  const currentBusinessKnowledge = buildBusinessKnowledge(currentBusinessResult.data, currentMemory);
  const businessKnowledge = hasBusinessKnowledge
    ? mergeAiBusinessKnowledgeUpdate(currentBusinessKnowledge, input.businessKnowledge)
    : buildBusinessKnowledge(currentBusinessResult.data, memory);

  if (hasBusinessKnowledge) {
    // Une seule source visible : le texte et les forces édités dans l'espace ADN
    // alimentent aussi la mémoire compacte utilisée par les générateurs.
    memory = mergeAiMemoryUpdate(memory, {
      detailedDescription: businessKnowledge.description,
      differentiators: businessKnowledge.strengths,
    }, { includePremium: true });
  }

  if (!premiumEnabled) {
    // Un passage temporaire en Standard ne détruit jamais les informations
    // Premium déjà saisies. Elles sont conservées mais non lues par les IA.
    memory = mergeAiMemoryPremiumFields(memory, currentMemoryResult.data?.memory);
  }

  if (hasBusinessKnowledge) {
    const { error: businessError } = await supabase
      .from("business_profiles")
      .upsert(
        {
          user_id: activeUserId,
          business_description: businessKnowledge.description,
          services: businessKnowledge.services,
          intervention_zones: businessKnowledge.interventionZones,
          opening_days: encodeBusinessWeeklySchedule(businessKnowledge.weeklySchedule),
          opening_hours: formatBusinessWeeklySchedule(businessKnowledge.weeklySchedule),
          strengths: businessKnowledge.strengths,
          customer_typologies: businessKnowledge.customerTypes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (businessError) {
      return jsonUserFacingError(businessError, { status: 500 });
    }
  }

  const completionScore = getAiWorkspaceCompletionScore(memory, businessKnowledge, {
    includePremium: false,
  });
  const { data, error } = await supabase
    .from("business_ai_memories")
    .upsert(
      {
        account_id: activeUserId,
        schema_version: 1,
        memory,
        completion_score: completionScore,
      },
      { onConflict: "account_id" },
    )
    .select("memory,updated_at")
    .single();

  if (error) {
    return migrationRequiredResponse(error) || jsonUserFacingError(error, { status: 500 });
  }

  await invalidateBoosterGenerationContext(activeUserId, "professional");
  const visibleMemory = normalizeAiMemory(data?.memory, {
    includePremium: premiumEnabled,
  });

  return NextResponse.json(
    {
      ok: true,
      edition,
      premiumEnabled,
      memory: visibleMemory,
      businessKnowledge,
      completionScore: getAiWorkspaceCompletionScore(visibleMemory, businessKnowledge, {
        includePremium: premiumEnabled,
      }),
      updatedAt: data?.updated_at || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
