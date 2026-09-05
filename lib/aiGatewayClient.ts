import "server-only";

import { fetchWithRetry } from "@/lib/observability/fetch";
import {
  cleanAiGatewayEnv,
  getAiGatewayCredential,
  normalizeAiGatewayBaseUrl,
  normalizeGatewayModelId,
} from "@/lib/aiGatewayConfig";
import {
  resolveAiEngineRequestRouting,
  type AiJsonMode,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";
import {
  AiOperationDeadlineExceededError,
  assertAllowedAiGatewayModel,
  getAiFeaturePolicy,
  reserveAiOperationBudget,
  type AiGenerationFeature,
  type AiOperationBudget,
} from "@/lib/aiGatewayPolicy";
import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
  type AiGatewayAccountAttemptReservation,
} from "@/lib/aiGatewayAccountGuard";
import {
  estimateAiGatewayCostMicroUsd,
  estimateInputTokensWithImages,
  resolveAiGatewayGuardPricing,
} from "@/lib/aiGatewayEconomics";
import {
  appendPromptOnlyJsonContract,
  extractAiGatewayResponseText,
  parseAiGatewayJsonObject,
} from "@/lib/aiGatewayResponse";
import { assertAiJsonMatchesSchema } from "@/lib/aiJsonSchemaValidation";
import { recordAiGatewayOperationCall } from "@/lib/aiGatewayOperationTelemetry";
import {
  attachAiGenerationFallbackInfo,
  buildAiGenerationFallbackInfo,
  getFallbackReason,
  getOpenAiDirectAccountingModel,
  getOpenAiDirectFallbackCredential,
  getOpenAiDirectFallbackModel,
  resolveGatewayFallbackRouting,
  type AiGenerationFallbackReason,
  type AiGenerationTransport,
} from "@/lib/aiGenerationFallback";

export type { AiGenerationFeature, AiOperationBudget } from "@/lib/aiGatewayPolicy";

export class AiGatewayHttpError extends Error {
  code: "ai_gateway_rate_limit" | "ai_gateway_auth" | "ai_gateway_unavailable" | "ai_gateway_invalid_request" | "ai_gateway_request_failed";
  status: number;
  retryAfterSeconds?: number;

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "AiGatewayHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.code = status === 429
      ? "ai_gateway_rate_limit"
      : status === 401 || status === 403
        ? "ai_gateway_auth"
        : status === 404 || status >= 500
          ? "ai_gateway_unavailable"
          : [400, 409, 422].includes(status)
            ? "ai_gateway_invalid_request"
            : "ai_gateway_request_failed";
  }
}


type AiResponseJSON = Record<string, unknown>;

export type AiJsonResponseSchema = {
  /** Stable schema name sent to the Responses API. */
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

type AiGenerateJsonBaseOptions = {
  feature: AiGenerationFeature;
  /** Établissement / compte actif iNrCy. Utilisé uniquement pour les garde-fous économiques. */
  accountId?: string;
  /** Budget partagé entre plusieurs sous-appels d'une même action utilisateur. */
  budget?: AiOperationBudget;
  system: string;
  input: string;
  images?: Array<{ dataUrl: string; detail?: "low" | "high" | "auto" }>;
  maxOutputTokens?: number;
  temperature?: number;
  retries?: number;
  timeoutMs?: number;
  /** Deadline absolue partagée par une action utilisateur et ses sous-appels. */
  deadlineAt?: number;
  /** Optional JSON Schema for reliable multi-provider structured output. */
  responseSchema?: AiJsonResponseSchema;
};

type AiGenerateJsonRouting =
  | { engine: AiPreferredEngine; model?: never }
  | { model: string; engine?: never };

export type AiGenerateJsonOptions = AiGenerateJsonBaseOptions & AiGenerateJsonRouting;

const warnedFallbackPricingModels = new Set<string>();

function warnIfFallbackGuardPricing(model: string) {
  const resolution = resolveAiGatewayGuardPricing(model);
  if (resolution.source !== "conservative_fallback" || warnedFallbackPricingModels.has(model)) return;
  warnedFallbackPricingModels.add(model);
  console.info("[ai-gateway] conservative guard pricing active", {
    model,
    pricingSource: resolution.source,
    message: "AI_GATEWAY_MODEL_PRICING_JSON absent/incomplet pour ce modèle ; iNrCy conserve un garde-fou monétaire conservateur.",
  });
}

function resolveHardDeadlineAt(opts: AiGenerateJsonOptions, policyMaxDurationMs: number): number {
  const candidates = [
    Number(opts.deadlineAt || 0),
    opts.budget ? opts.budget.startedAt + opts.budget.maxDurationMs : 0,
  ].filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.min(...candidates) : Date.now() + policyMaxDurationMs;
}

export { normalizeGatewayModelId } from "@/lib/aiGatewayConfig";

export function hasAiGenerationCredentials(): boolean {
  return Boolean(getAiGatewayCredential() || getOpenAiDirectFallbackCredential());
}

type ResolvedAiRequestRouting = {
  model: string;
  jsonMode: AiJsonMode;
};

function resolveRequestedRouting(
  opts: AiGenerateJsonOptions,
  hasImages: boolean,
): ResolvedAiRequestRouting {
  if ("model" in opts && cleanAiGatewayEnv(opts.model)) {
    return {
      model: cleanAiGatewayEnv(opts.model),
      jsonMode: "strict",
    };
  }

  if ("engine" in opts && opts.engine) {
    return resolveAiEngineRequestRouting(opts.engine, hasImages);
  }

  // Le type TypeScript empêche normalement ce cas. On garde un garde-fou runtime.
  return {
    model:
      (hasImages ? cleanAiGatewayEnv(process.env.AI_GATEWAY_VISION_MODEL) : "") ||
      cleanAiGatewayEnv(process.env.AI_GATEWAY_MODEL) ||
      "openai/gpt-4o-mini",
    jsonMode: "strict",
  };
}


function normalizeJsonSchemaName(value: unknown): string {
  const normalized = String(value || "inrcy_response")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
  return normalized || "inrcy_response";
}

function getOutputDiagnostics(json: any) {
  const output = Array.isArray(json?.output) ? json.output : [];
  return {
    responseStatus: typeof json?.status === "string" ? json.status : undefined,
    incompleteReason:
      typeof json?.incomplete_details?.reason === "string"
        ? json.incomplete_details.reason
        : undefined,
    outputItemTypes: output
      .map((item: any) => (typeof item?.type === "string" ? item.type : "unknown"))
      .slice(0, 12),
    contentPartTypes: output
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
      .map((part: any) => (typeof part?.type === "string" ? part.type : "unknown"))
      .slice(0, 20),
  };
}

function parseUsage(json: any) {
  const usage = json?.usage && typeof json.usage === "object" ? json.usage : {};
  const inputTokens = Math.max(0, Math.floor(Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0));
  const outputTokens = Math.max(0, Math.floor(Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0));
  const totalTokens = Math.max(
    0,
    Math.floor(Number(usage.total_tokens ?? inputTokens + outputTokens) || inputTokens + outputTokens),
  );
  return { inputTokens, outputTokens, totalTokens };
}

function validatePayloadAgainstPolicy(
  opts: AiGenerateJsonOptions,
  maxOutputTokens: number,
  effectiveSystemPrompt: string,
) {
  const policy = getAiFeaturePolicy(opts.feature);
  const systemChars = String(effectiveSystemPrompt || "").length;
  const inputCharsOnly = String(opts.input || "").length;
  const inputChars = systemChars + inputCharsOnly;
  if (inputChars > policy.maxInputChars) {
    console.error("[ai-gateway] input policy exceeded", {
      feature: opts.feature,
      accountId: opts.accountId || undefined,
      systemChars,
      inputChars: inputCharsOnly,
      totalChars: inputChars,
      maxInputChars: policy.maxInputChars,
    });
    throw new Error(
      `La demande IA est trop volumineuse pour cette action (${inputChars}/${policy.maxInputChars} caractères).`,
    );
  }

  const images = Array.isArray(opts.images) ? opts.images : [];
  if (images.length > policy.maxImages) {
    throw new Error(`Trop d'images ont été envoyées à l'IA pour cette action (maximum ${policy.maxImages}).`);
  }

  const imageDataChars = images.reduce((sum, image) => sum + String(image?.dataUrl || "").length, 0);
  if (imageDataChars > policy.maxImageDataChars) {
    throw new Error("Les médias envoyés à l'IA sont trop volumineux pour cette action.");
  }

}

type AiJsonExecutionTarget = {
  transport: AiGenerationTransport;
  stage: "primary" | "gateway_model" | "openai_direct";
  requestModel: string;
  accountingModel: string;
  jsonMode: AiJsonMode;
  credential: string;
  baseUrl: string;
  retries: number;
  timeoutMs: number;
  deadlineAt: number;
  engine?: AiPreferredEngine;
};

function buildEffectiveSystemPrompt(
  opts: AiGenerateJsonOptions,
  jsonMode: AiJsonMode,
): string {
  return jsonMode === "prompt-only"
    ? [
        appendPromptOnlyJsonContract(opts.system),
        opts.responseSchema
          ? `SCHÉMA JSON OBLIGATOIRE (respecte exactement cette structure) :\n${JSON.stringify(opts.responseSchema.schema)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    : opts.system;
}

function buildStructuredFormat(
  opts: AiGenerateJsonOptions,
  jsonMode: AiJsonMode,
) {
  return opts.responseSchema && jsonMode === "strict"
    ? {
        type: "json_schema",
        name: normalizeJsonSchemaName(opts.responseSchema.name),
        strict: opts.responseSchema.strict !== false,
        schema: opts.responseSchema.schema,
      }
    : jsonMode === "strict"
      ? { type: "json_object" }
      : undefined;
}

function resolveFallbackStageTimeoutMs(args: {
  hardDeadlineAt: number;
  requestedTimeoutMs: number;
  reserveForNextStagesMs: number;
  maxStageMs: number;
}) {
  const remaining = args.hardDeadlineAt - Date.now();
  if (remaining <= 5_750) throw new AiOperationDeadlineExceededError();
  const available = Math.max(5_000, remaining - Math.max(0, args.reserveForNextStagesMs));
  return Math.max(
    5_000,
    Math.min(args.requestedTimeoutMs, args.maxStageMs, available),
  );
}

function resolveNextStagesReserveMs(
  hardDeadlineAt: number,
  remainingStages: 0 | 1 | 2,
) {
  if (remainingStages <= 0) return 0;
  const remaining = Math.max(0, hardDeadlineAt - Date.now());

  // Réserve proportionnelle : les opérations courtes (ex. compréhension média)
  // gardent la majorité de leur temps pour le moteur choisi, tandis que les
  // opérations longues conservent assez de marge pour les deux secours.
  if (remainingStages === 2) {
    return Math.min(32_000, Math.max(8_000, Math.floor(remaining * 0.25)));
  }
  return Math.min(15_000, Math.max(5_000, Math.floor(remaining * 0.18)));
}

function hasTimeForFallback(deadlineAt: number, minimumMs = 5_750) {
  return deadlineAt - Date.now() > minimumMs;
}

function classifyAiAttemptFallback(error: unknown, hasImages: boolean) {
  const classification = getFallbackReason(error);
  if (classification.eligible) return classification;

  const record = error && typeof error === "object"
    ? (error as { code?: unknown; status?: unknown })
    : null;
  const code = String(record?.code || "");
  const status = Number(record?.status || 0);

  // Les fournisseurs multimodaux ne décrivent pas tous de la même manière une
  // incompatibilité vision + JSON Schema. Lorsqu'un autre moteur peut traiter
  // exactement les mêmes captures, on bascule au lieu de renvoyer un 502.
  if (
    hasImages &&
    (code === "ai_gateway_invalid_request" || [400, 409, 422].includes(status))
  ) {
    return {
      eligible: true,
      skipGatewayModelFallback: false,
      reason: "provider_incompatible" as const,
    };
  }

  return classification;
}

async function executeAiJsonAttempt<T extends AiResponseJSON>(args: {
  opts: AiGenerateJsonOptions;
  policyMaxOutputTokens: number;
  temperature?: number;
  hasImages: boolean;
  target: AiJsonExecutionTarget;
}): Promise<T> {
  const { opts, target, hasImages, temperature } = args;
  const effectiveSystemPrompt = buildEffectiveSystemPrompt(opts, target.jsonMode);
  const structuredFormat = buildStructuredFormat(opts, target.jsonMode);
  const userContent: Array<Record<string, unknown>> = [
    { type: "input_text", text: opts.input },
    ...((opts.images || []).map((image) => ({
      type: "input_image",
      image_url: image.dataUrl,
      detail: image.detail || "low",
    }))),
  ];

  const requestStartedAt = Date.now();
  const estimatedInputTokens = estimateInputTokensWithImages({
    textChars: String(effectiveSystemPrompt || "").length + String(opts.input || "").length,
    imageCount: opts.images?.length || 0,
    imageDetail: opts.images?.some((image) => image.detail === "high") ? "high" : "low",
  });
  warnIfFallbackGuardPricing(target.accountingModel);
  const estimatedCostMicroUsd = estimateAiGatewayCostMicroUsd(target.accountingModel, {
    inputTokens: estimatedInputTokens,
    outputTokens: args.policyMaxOutputTokens,
  });

  const attemptReservations = new Map<number, AiGatewayAccountAttemptReservation | null>();
  let successfulReservation: AiGatewayAccountAttemptReservation | null = null;
  let httpAttempts = 0;
  let res: Response;

  try {
    res = await fetchWithRetry(`${target.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${target.credential}`,
      },
      body: JSON.stringify({
        model: target.requestModel,
        max_output_tokens: args.policyMaxOutputTokens,
        ...(temperature === undefined ? {} : { temperature }),
        ...(target.transport === "openai_direct" ? { store: false } : {}),
        ...(structuredFormat
          ? {
              text: {
                format: structuredFormat,
              },
            }
          : {}),
        input: [
          { role: "system", content: [{ type: "input_text", text: effectiveSystemPrompt }] },
          { role: "user", content: userContent },
        ],
      }),
      retries: target.retries,
      timeoutMs: target.timeoutMs,
      deadlineAt: target.deadlineAt,
      // Un 404 indique généralement un modèle ou un endpoint indisponible :
      // basculer immédiatement vers le moteur de secours au lieu de perdre un essai.
      retryStatuses: [408, 500, 502, 503, 504],
      onAttempt: async (attempt) => {
        httpAttempts = Math.max(httpAttempts, attempt + 1);
        const reservation = await reserveAiGatewayAccountAttempt(opts.accountId, {
          estimatedInputTokens,
          reservedOutputTokens: args.policyMaxOutputTokens,
          estimatedCostMicroUsd,
        });
        attemptReservations.set(attempt, reservation);
      },
      onAttemptSettled: async ({ attempt, response }) => {
        const reservation = attemptReservations.get(attempt) || null;
        if (response?.ok) {
          successfulReservation = reservation;
          return;
        }
        await rollbackAiGatewayAccountAttempt(reservation).catch((error) => {
          console.warn("[ai-generation] attempt reservation rollback unavailable", {
            feature: opts.feature,
            model: target.accountingModel,
            transport: target.transport,
            stage: target.stage,
            attempt,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      },
    });
  } catch (error) {
    const failedDurationMs = Date.now() - requestStartedAt;
    await recordAiGatewayAccountFailure({
      accountId: opts.accountId,
      feature: opts.feature,
      model: target.accountingModel,
      status: 0,
    }).catch(() => undefined);
    recordAiGatewayOperationCall({
      feature: opts.feature,
      engine: target.engine,
      model: target.accountingModel,
      transport: target.transport,
      fallbackStage: target.stage,
      status: "failure",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reservedOutputTokens: args.policyMaxOutputTokens,
      costMicroUsd: 0,
      pricingSource: resolveAiGatewayGuardPricing(target.accountingModel).source,
      usageEstimated: false,
      durationMs: failedDurationMs,
      hasImages,
      httpAttempts,
    });
    console.error("[ai-generation] transport failed", {
      feature: opts.feature,
      model: target.accountingModel,
      engine: target.engine,
      transport: target.transport,
      stage: target.stage,
      accountId: opts.accountId || undefined,
      hasImages,
      httpAttempts,
      durationMs: failedDurationMs,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const retryAfterHeader = Number.parseInt(String(res.headers.get("Retry-After") || ""), 10);
    const retryAfterSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader
      : undefined;
    await recordAiGatewayAccountFailure({
      accountId: opts.accountId,
      feature: opts.feature,
      model: target.accountingModel,
      status: res.status,
    }).catch(() => undefined);
    const failedDurationMs = Date.now() - requestStartedAt;
    const safeDetail = String(text || res.statusText || "").trim().slice(0, 500);
    console.error("[ai-generation] request failed", {
      feature: opts.feature,
      model: target.accountingModel,
      engine: target.engine,
      transport: target.transport,
      stage: target.stage,
      accountId: opts.accountId || undefined,
      hasImages,
      structuredOutput: Boolean(structuredFormat),
      status: res.status,
      detail: safeDetail || undefined,
      durationMs: failedDurationMs,
    });
    recordAiGatewayOperationCall({
      feature: opts.feature,
      engine: target.engine,
      model: target.accountingModel,
      transport: target.transport,
      fallbackStage: target.stage,
      status: "failure",
      statusCode: res.status,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reservedOutputTokens: args.policyMaxOutputTokens,
      costMicroUsd: 0,
      pricingSource: resolveAiGatewayGuardPricing(target.accountingModel).source,
      usageEstimated: false,
      durationMs: failedDurationMs,
      hasImages,
      httpAttempts,
    });
    const sourceLabel = target.transport === "openai_direct" ? "OpenAI direct" : "AI Gateway";
    throw new AiGatewayHttpError(
      res.status,
      `${sourceLabel} error (${res.status}): ${safeDetail || "Erreur fournisseur"}`,
      retryAfterSeconds,
    );
  }

  let json: any;
  try {
    json = await res.json();
  } catch (error) {
    await commitAiGatewayAccountAttempt({
      reservation: successfulReservation,
      feature: opts.feature,
      model: target.accountingModel,
      usage: {
        inputTokens: estimatedInputTokens,
        outputTokens: args.policyMaxOutputTokens,
        totalTokens: estimatedInputTokens + args.policyMaxOutputTokens,
      },
    }).catch(() => undefined);
    throw error;
  }

  const usage = parseUsage(json);
  const usageForGuard = usage.totalTokens > 0
    ? usage
    : {
        inputTokens: estimatedInputTokens,
        outputTokens: args.policyMaxOutputTokens,
        totalTokens: estimatedInputTokens + args.policyMaxOutputTokens,
      };
  const contentText = extractAiGatewayResponseText(json);

  await commitAiGatewayAccountAttempt({
    reservation: successfulReservation,
    feature: opts.feature,
    model: target.accountingModel,
    usage: usageForGuard,
  }).catch((error) => {
    console.error("[ai-generation] atomic usage commit unavailable", {
      feature: opts.feature,
      model: target.accountingModel,
      transport: target.transport,
      stage: target.stage,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  const actualCostMicroUsd = estimateAiGatewayCostMicroUsd(target.accountingModel, usageForGuard);
  const pricingSource = resolveAiGatewayGuardPricing(target.accountingModel).source;
  recordAiGatewayOperationCall({
    feature: opts.feature,
    engine: target.engine,
    model: target.accountingModel,
    transport: target.transport,
    fallbackStage: target.stage,
    status: "success",
    inputTokens: usageForGuard.inputTokens,
    outputTokens: usageForGuard.outputTokens,
    totalTokens: usageForGuard.totalTokens,
    reservedOutputTokens: args.policyMaxOutputTokens,
    costMicroUsd: actualCostMicroUsd,
    pricingSource,
    usageEstimated: usage.totalTokens <= 0,
    durationMs: Date.now() - requestStartedAt,
    hasImages,
    httpAttempts,
  });

  console.info("[ai-generation] usage", {
    feature: opts.feature,
    model: target.accountingModel,
    engine: target.engine,
    transport: target.transport,
    stage: target.stage,
    accountId: opts.accountId || undefined,
    hasImages,
    structuredOutput: Boolean(structuredFormat),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    guardUsageEstimated: usage.totalTokens <= 0,
    durationMs: Date.now() - requestStartedAt,
  });

  if (!contentText) {
    const status = typeof json?.status === "string" ? ` (${json.status})` : "";
    console.error("[ai-generation] empty output", {
      feature: opts.feature,
      model: target.accountingModel,
      engine: target.engine,
      transport: target.transport,
      stage: target.stage,
      accountId: opts.accountId || undefined,
      hasImages,
      durationMs: Date.now() - requestStartedAt,
    });
    throw new Error(`Service IA : contenu de sortie manquant${status}`);
  }

  try {
    const parsed = parseAiGatewayJsonObject<T>(contentText);
    if (opts.responseSchema) {
      assertAiJsonMatchesSchema(parsed, opts.responseSchema.schema);
    }
    return parsed;
  } catch (error) {
    console.error("[ai-generation] invalid structured output", {
      feature: opts.feature,
      model: target.accountingModel,
      engine: target.engine,
      transport: target.transport,
      stage: target.stage,
      accountId: opts.accountId || undefined,
      structuredOutput: Boolean(structuredFormat),
      contentChars: contentText.length,
      ...getOutputDiagnostics(json),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Point d'entrée unique de génération IA iNrCy.
 *
 * Chaîne de sécurité bornée :
 * 1. moteur choisi par le professionnel via Vercel AI Gateway ;
 * 2. un seul modèle de secours via la Gateway ;
 * 3. OpenAI direct, une seule fois, uniquement si OPENAI_API_KEY est présente.
 *
 * Les quotas produit ne sont débités qu'une fois par action utilisateur, tandis
 * que les garde-fous économiques comptabilisent chaque véritable appel fournisseur.
 */
export async function aiGenerateJSON<T extends AiResponseJSON>(opts: AiGenerateJsonOptions): Promise<T> {
  const policy = getAiFeaturePolicy(opts.feature);
  const hasImages = Array.isArray(opts.images) && opts.images.length > 0;
  const primaryRouting = resolveRequestedRouting(opts, hasImages);
  const primaryModel = normalizeGatewayModelId(primaryRouting.model);
  const primaryEngine = "engine" in opts ? opts.engine : undefined;
  assertAllowedAiGatewayModel(primaryModel, process.env.AI_GATEWAY_ALLOWED_MODELS);

  const maxOutputTokens = Math.max(
    128,
    Math.min(policy.maxOutputTokens, opts.maxOutputTokens ?? 700),
  );
  const temperature = typeof opts.temperature === "number"
    ? Math.max(0, Math.min(2, opts.temperature))
    : undefined;
  const requestedTimeoutMs = Math.max(
    5_000,
    Math.min(policy.maxTimeoutMs, Math.floor(opts.timeoutMs ?? policy.maxTimeoutMs)),
  );
  const hardDeadlineAt = resolveHardDeadlineAt(opts, policy.defaultOperationMaxDurationMs);
  const primarySystemPrompt = buildEffectiveSystemPrompt(opts, primaryRouting.jsonMode);

  validatePayloadAgainstPolicy(opts, maxOutputTokens, primarySystemPrompt);
  // Un appel logique peut utiliser un transport de secours sans multiplier le quota
  // fonctionnel. La réserve d'opération reste donc unique ; les appels réels sont
  // comptabilisés séparément par aiGatewayAccountGuard.
  reserveAiOperationBudget(opts.budget, maxOutputTokens);

  const gatewayCredential = getAiGatewayCredential();
  const directCredential = getOpenAiDirectFallbackCredential();
  const gatewayBaseUrl = normalizeAiGatewayBaseUrl(process.env.AI_GATEWAY_BASE_URL);
  let lastError: unknown = gatewayCredential
    ? null
    : Object.assign(new Error("Configuration AI Gateway manquante."), {
        code: "ai_gateway_auth",
        status: 401,
      });
  let fallbackReason: AiGenerationFallbackReason = gatewayCredential
    ? "transport_error"
    : "gateway_credentials_missing";

  if (gatewayCredential) {
    const primaryTimeoutMs = resolveFallbackStageTimeoutMs({
      hardDeadlineAt,
      requestedTimeoutMs,
      reserveForNextStagesMs: resolveNextStagesReserveMs(
        hardDeadlineAt,
        directCredential ? 2 : 1,
      ),
      maxStageMs: requestedTimeoutMs,
    });

    try {
      // Une tentative par niveau : on préfère basculer vers un fournisseur différent
      // plutôt que de rejouer longuement le même modèle en panne.
      return await executeAiJsonAttempt<T>({
        opts,
        policyMaxOutputTokens: maxOutputTokens,
        temperature,
        hasImages,
        target: {
          transport: "vercel_ai_gateway",
          stage: "primary",
          requestModel: primaryModel,
          accountingModel: primaryModel,
          jsonMode: primaryRouting.jsonMode,
          credential: gatewayCredential,
          baseUrl: gatewayBaseUrl,
          retries: Math.max(0, Math.min(1, opts.retries ?? 0)),
          timeoutMs: primaryTimeoutMs,
          deadlineAt: hardDeadlineAt,
          engine: primaryEngine,
        },
      });
    } catch (error) {
      lastError = error;
      const classification = classifyAiAttemptFallback(error, hasImages);
      if (!classification.eligible) throw error;
      fallbackReason = classification.reason;

      const gatewayFallback = classification.skipGatewayModelFallback
        ? null
        : resolveGatewayFallbackRouting(primaryModel);

      if (gatewayFallback && hasTimeForFallback(hardDeadlineAt, directCredential ? 12_000 : 7_000)) {
        assertAllowedAiGatewayModel(
          gatewayFallback.model,
          process.env.AI_GATEWAY_ALLOWED_MODELS,
        );
        const gatewayFallbackTimeoutMs = resolveFallbackStageTimeoutMs({
          hardDeadlineAt,
          requestedTimeoutMs,
          reserveForNextStagesMs: resolveNextStagesReserveMs(
            hardDeadlineAt,
            directCredential ? 1 : 0,
          ),
          maxStageMs: 30_000,
        });

        console.warn("[ai-fallback] gateway model fallback", {
          feature: opts.feature,
          accountId: opts.accountId || undefined,
          primaryEngine,
          primaryModel,
          fallbackEngine: gatewayFallback.engine,
          fallbackModel: gatewayFallback.model,
          reason: fallbackReason,
        });

        try {
          const result = await executeAiJsonAttempt<T>({
            opts,
            policyMaxOutputTokens: maxOutputTokens,
            temperature,
            hasImages,
            target: {
              transport: "vercel_ai_gateway",
              stage: "gateway_model",
              requestModel: gatewayFallback.model,
              accountingModel: gatewayFallback.model,
              jsonMode: gatewayFallback.jsonMode,
              credential: gatewayCredential,
              baseUrl: gatewayBaseUrl,
              retries: 0,
              timeoutMs: gatewayFallbackTimeoutMs,
              deadlineAt: hardDeadlineAt,
              engine: gatewayFallback.engine,
            },
          });
          return attachAiGenerationFallbackInfo(
            result,
            buildAiGenerationFallbackInfo({
              stage: "gateway_model",
              reason: fallbackReason,
              primaryEngine,
              primaryModel,
              finalEngine: gatewayFallback.engine,
              finalModel: gatewayFallback.model,
              transport: "vercel_ai_gateway",
            }),
          );
        } catch (error) {
          lastError = error;
          const fallbackClassification = classifyAiAttemptFallback(error, hasImages);
          if (!fallbackClassification.eligible) throw error;
          fallbackReason = fallbackClassification.reason;
        }
      }
    }
  }

  if (directCredential && hasTimeForFallback(hardDeadlineAt)) {
    const directModel = getOpenAiDirectFallbackModel();
    const accountingModel = getOpenAiDirectAccountingModel();
    const directTimeoutMs = resolveFallbackStageTimeoutMs({
      hardDeadlineAt,
      requestedTimeoutMs,
      reserveForNextStagesMs: 0,
      maxStageMs: 28_000,
    });

    console.error("[ai-fallback] OpenAI direct emergency fallback", {
      feature: opts.feature,
      accountId: opts.accountId || undefined,
      primaryEngine,
      primaryModel,
      directModel,
      reason: fallbackReason,
    });

    const result = await executeAiJsonAttempt<T>({
      opts,
      policyMaxOutputTokens: maxOutputTokens,
      temperature,
      hasImages,
      target: {
        transport: "openai_direct",
        stage: "openai_direct",
        requestModel: directModel,
        accountingModel,
        jsonMode: "strict",
        credential: directCredential,
        baseUrl: "https://api.openai.com/v1",
        retries: 0,
        timeoutMs: directTimeoutMs,
        deadlineAt: hardDeadlineAt,
        engine: "openai",
      },
    });

    return attachAiGenerationFallbackInfo(
      result,
      buildAiGenerationFallbackInfo({
        stage: "openai_direct",
        reason: fallbackReason,
        primaryEngine,
        primaryModel,
        finalEngine: "openai",
        finalModel: accountingModel,
        transport: "openai_direct",
      }),
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("La génération IA n'a pas pu aboutir après les tentatives de secours.");
}
