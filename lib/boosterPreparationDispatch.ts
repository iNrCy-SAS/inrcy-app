import "server-only";

import { BOOSTER_ASYNC_JOB_EVENT_TYPE } from "@/lib/boosterAsyncPublication";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type JsonRecord = Record<string, unknown>;

type PreparationDispatchResolution =
  | { ok: true; body: JsonRecord }
  | { ok: false; status: number; code: string; error: string };

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function buildBoosterPreparationDispatchReference(params: {
  publicationId: string;
  attempt: number;
}) {
  return {
    _asyncPreparationDispatch: true,
    _asyncPreparationReference: true,
    _asyncPublicationId: params.publicationId,
    _asyncParentEventId: params.publicationId,
    _asyncPreparationAttempt: Math.max(1, Math.round(params.attempt || 1)),
  };
}

/**
 * Resolves the durable parent inside the worker instead of transporting the
 * full image/video preparation payload through another Vercel request. This
 * keeps retries well below the platform body limit, including for jobs that
 * were already queued before the fix was deployed.
 */
export async function resolveBoosterPreparationDispatchReference(params: {
  userId: string;
  publicationId: string;
  body: JsonRecord;
}): Promise<PreparationDispatchResolution> {
  if (params.body._asyncPreparationReference !== true) {
    return { ok: true, body: params.body };
  }

  const { data, error } = await supabaseAdmin
    .from("app_events")
    .select("payload")
    .eq("id", params.publicationId)
    .eq("user_id", params.userId)
    .eq("type", BOOSTER_ASYNC_JOB_EVENT_TYPE)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 503,
      code: "async_preparation_reference_unavailable",
      error: "La préparation enregistrée ne peut pas encore être relue.",
    };
  }

  const preparationRequest = asRecord(asRecord(data?.payload).preparationRequest);
  if (!Object.keys(preparationRequest).length) {
    return {
      ok: false,
      status: 409,
      code: "async_preparation_reference_missing",
      error: "La préparation enregistrée est absente ou déjà terminée.",
    };
  }

  const requestedAttempt = Math.max(
    1,
    Math.round(Number(params.body._asyncPreparationAttempt || 1)),
  );
  return {
    ok: true,
    body: {
      ...preparationRequest,
      _asyncPreparationDispatch: true,
      _asyncPreparationReference: true,
      _asyncPublicationId: params.publicationId,
      _asyncParentEventId: params.publicationId,
      _asyncPreparationAttempt: requestedAttempt,
    },
  };
}
