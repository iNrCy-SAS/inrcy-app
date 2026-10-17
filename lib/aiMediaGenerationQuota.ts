import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  AI_MEDIA_EDITIONS,
  AI_MEDIA_KINDS,
  AI_MEDIA_MONTHLY_LIMITS,
  AI_MEDIA_ROLLOVER_CAPS,
  AI_MEDIA_SURFACES,
  AI_MEDIA_LEGACY_CREDIT_FACTORS,
  createAiMediaRequestFingerprint,
  getAiMediaMonthlyLimit,
  getAiMediaRolloverCap,
  hasAiMediaStudioAccess,
  normalizeAiMediaEdition,
  stableAiMediaRequestPayload,
  type AiMediaEdition,
  type AiMediaKind,
  type AiMediaPlanLimits,
  type AiMediaSurface,
} from "@/lib/aiMediaGenerationQuotaPolicy";

export {
  AI_MEDIA_EDITIONS,
  AI_MEDIA_KINDS,
  AI_MEDIA_MONTHLY_LIMITS,
  AI_MEDIA_ROLLOVER_CAPS,
  AI_MEDIA_SURFACES,
  createAiMediaRequestFingerprint,
  getAiMediaMonthlyLimit,
  getAiMediaRolloverCap,
  hasAiMediaStudioAccess,
  normalizeAiMediaEdition,
  stableAiMediaRequestPayload,
};
export type { AiMediaEdition, AiMediaKind, AiMediaPlanLimits, AiMediaSurface };

export type AiMediaGenerationJobStatus =
  | "reserved"
  | "processing"
  | "completed"
  | "failed"
  | "expired";

export type AiMediaGenerationReservationOutcome =
  | "reserved"
  | "replayed"
  | "quota_reached"
  | "premium_required";

export type AiMediaQuotaCounter = {
  unit: "item" | "second" | "credit";
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  includedRemaining?: number;
  includedLimit?: number;
  includedUsed?: number;
  includedReserved?: number;
  purchasedRemaining?: number;
  purchasedReserved?: number;
  purchasedDebt?: number;
  purchasedHeld?: number;
  purchasedSuspendedDeficit?: number;
};

export type AiMediaQuotaSnapshot = {
  accountId: string;
  edition: AiMediaEdition;
  periodStart: string;
  resetAt: string;
  studioEnabled: boolean;
  /** False when the unified-wallet migration is unavailable; paid calls must stop. */
  creditsReady: boolean;
  credits: AiMediaQuotaCounter & { unit: "credit"; periodStart: string; resetAt: string };
  image: AiMediaQuotaCounter;
  video: AiMediaQuotaCounter;
};

export type AiMediaGenerationReservation = {
  outcome: AiMediaGenerationReservationOutcome;
  jobId: string | null;
  status: AiMediaGenerationJobStatus | null;
  replayed: boolean;
  expiresAt: string | null;
  quotaAmount: number;
  quota: AiMediaQuotaCounter & { periodStart: string; resetAt: string };
};

export type AiMediaGenerationTransition = {
  jobId: string;
  status: AiMediaGenerationJobStatus;
  mediaKind: AiMediaKind;
  mediaId: string | null;
  quotaAmount: number;
  quota: AiMediaQuotaCounter & { periodStart: string; resetAt: string };
};

export type AiMediaQuotaRpcClient = Pick<typeof supabaseAdmin, "rpc">;
export type AiMediaQuotaMetadata = Record<string, unknown>;

type QuotaRpcRow = {
  account_id?: unknown;
  edition?: unknown;
  studio_enabled?: unknown;
  media_kind?: unknown;
  quota_unit?: unknown;
  quota_amount?: unknown;
  limit_count?: unknown;
  used_count?: unknown;
  reserved_count?: unknown;
  remaining_count?: unknown;
  period_start?: unknown;
  reset_at?: unknown;
  included_remaining_count?: unknown;
  included_limit_count?: unknown;
  included_used_count?: unknown;
  included_reserved_count?: unknown;
  purchased_remaining_count?: unknown;
  purchased_reserved_count?: unknown;
  purchased_debt_count?: unknown;
  purchased_held_count?: unknown;
  purchased_suspended_deficit_count?: unknown;
  wallet_ready?: unknown;
};

type ReservationRpcRow = QuotaRpcRow & {
  outcome?: unknown;
  job_id?: unknown;
  job_status?: unknown;
  is_replay?: unknown;
  reservation_expires_at?: unknown;
};

type TransitionRpcRow = QuotaRpcRow & {
  job_id?: unknown;
  job_status?: unknown;
  media_id?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Editorial IDs are stable SHA-256 keys stored as PostgreSQL UUIDs. They do
// not carry RFC version/variant bits; changing them would duplicate slots.
const EDITORIAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

const KNOWN_JOB_STATUSES = new Set<AiMediaGenerationJobStatus>([
  "reserved",
  "processing",
  "completed",
  "failed",
  "expired",
]);

const KNOWN_RESERVATION_OUTCOMES = new Set<AiMediaGenerationReservationOutcome>([
  "reserved",
  "replayed",
  "quota_reached",
  "premium_required",
]);

export class AiMediaGenerationQuotaError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "AiMediaGenerationQuotaError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function inputError(code: string, message: string): never {
  throw new AiMediaGenerationQuotaError(code, message, 400);
}

function assertUuid(value: string, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!UUID_PATTERN.test(normalized)) inputError("ai_media_invalid_id", `${label} invalide.`);
  return normalized;
}

function assertEditorialActionId(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!EDITORIAL_UUID_PATTERN.test(normalized)) inputError("ai_media_invalid_id", "automaticEditorialActionId invalide.");
  // The private RPC still verifies owner, executing state and editorial scope.
  return normalized;
}

function normalizeKind(value: AiMediaKind): AiMediaKind {
  if (!(AI_MEDIA_KINDS as readonly string[]).includes(value)) {
    inputError("ai_media_invalid_kind", "Type de media IA invalide.");
  }
  return value;
}

function normalizeSurface(value: AiMediaSurface): AiMediaSurface {
  if (!(AI_MEDIA_SURFACES as readonly string[]).includes(value)) {
    inputError("ai_media_invalid_surface", "Surface de generation IA invalide.");
  }
  return value;
}

function normalizeMetadata(value: AiMediaQuotaMetadata | undefined): AiMediaQuotaMetadata {
  if (typeof value === "undefined") return {};
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    inputError("ai_media_invalid_metadata", "Les metadonnees de generation doivent etre un objet.");
  }
  return value;
}

function numberValue(value: unknown, label: string, signed = false): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || (!signed && parsed < 0)) {
    throw new AiMediaGenerationQuotaError(
      "ai_media_invalid_rpc_response",
      `Reponse de quota invalide (${label}).`,
      503,
    );
  }
  return parsed;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AiMediaGenerationQuotaError(
      "ai_media_invalid_rpc_response",
      `Reponse de quota invalide (${label}).`,
      503,
    );
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rowsFromRpc<T>(data: unknown, rpcName: string): T[] {
  const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  if (rows.length === 0) {
    throw new AiMediaGenerationQuotaError(
      "ai_media_empty_rpc_response",
      `Le controle de quota (${rpcName}) n'a retourne aucun resultat.`,
      503,
    );
  }
  return rows as T[];
}

function rpcError(rpcName: string, error: unknown): never {
  const candidate = error as { message?: unknown; details?: unknown; code?: unknown } | null;
  const raw = [candidate?.message, candidate?.details, candidate?.code]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  const known: Array<[string, string, number, string]> = [
    ["AI_MEDIA_AUTOMATIC_CREDIT_CONTEXT_DENIED", "ai_media_automatic_credit_context_denied", 403, "L’avance de crédits est réservée aux préparations automatiques iNr’Agent."],
    ["AI_MEDIA_ACCOUNT_ACCESS_DENIED", "ai_media_account_access_denied", 403, "Cet etablissement n'est pas accessible."],
    ["AI_MEDIA_IDEMPOTENCY_CONFLICT", "ai_media_idempotency_conflict", 409, "Cette demande existe deja avec un contenu different."],
    ["AI_MEDIA_JOB_NOT_FOUND", "ai_media_job_not_found", 404, "La generation media est introuvable."],
    ["AI_MEDIA_COMPLETION_CONFLICT", "ai_media_completion_conflict", 409, "Cette generation est deja rattachee a un autre media."],
    ["AI_MEDIA_OUTPUT_SCOPE_MISMATCH", "ai_media_output_scope_mismatch", 409, "Le media final n'appartient pas a l'etablissement actif."],
    ["AI_MEDIA_JOB_TERMINAL", "ai_media_job_terminal", 409, "Cette generation est deja terminee."],
    ["AI_MEDIA_RESERVATION_INVARIANT_BROKEN", "ai_media_quota_invariant", 503, "La reservation de quota est incoherente."],
  ];

  const match = known.find(([sqlCode]) => raw.includes(sqlCode));
  if (match) {
    throw new AiMediaGenerationQuotaError(match[1], match[3], match[2], { cause: error });
  }

  throw new AiMediaGenerationQuotaError(
    "ai_media_quota_unavailable",
    `Le controle de quota media IA est indisponible (${rpcName}).`,
    503,
    { cause: error },
  );
}

async function callRpc<T>(
  client: AiMediaQuotaRpcClient,
  rpcName: string,
  args: Record<string, unknown>,
): Promise<T[]> {
  const { data, error } = await client.rpc(rpcName, args);
  if (error) rpcError(rpcName, error);
  return rowsFromRpc<T>(data, rpcName);
}

function quotaFromRow(row: QuotaRpcRow): AiMediaQuotaCounter & { periodStart: string; resetAt: string } {
  const inferredUnit = row.media_kind === "video" ? "second" : "item";
  const unit = row.quota_unit ?? inferredUnit;
  if (unit !== "item" && unit !== "second" && unit !== "credit") {
    throw new AiMediaGenerationQuotaError(
      "ai_media_invalid_rpc_response",
      "Unité de quota média IA invalide.",
      503,
    );
  }
  return {
    unit,
    limit: numberValue(row.limit_count, "limit_count"),
    used: numberValue(row.used_count, "used_count"),
    reserved: numberValue(row.reserved_count, "reserved_count"),
    remaining: numberValue(row.remaining_count, "remaining_count", unit === "credit"),
    periodStart: stringValue(row.period_start, "period_start"),
    resetAt: stringValue(row.reset_at, "reset_at"),
  };
}

function isMissingQuotaRpc(error: unknown, rpcName: string): boolean {
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  const message = [candidate?.message, candidate?.details].filter((value) => typeof value === "string").join(" ");
  return (candidate?.code === "PGRST202" || candidate?.code === "42883") && message.includes(rpcName);
}

/** Compatibility only: these equivalents share one wallet and cannot be added. */
function equivalentCounter(credits: AiMediaQuotaCounter, kind: AiMediaKind): AiMediaQuotaCounter {
  const factor = AI_MEDIA_LEGACY_CREDIT_FACTORS[kind];
  const result: AiMediaQuotaCounter = {
    unit: kind === "image" ? "item" : "second",
    limit: Math.floor(credits.limit / factor),
    used: Math.floor(credits.used / factor),
    reserved: Math.floor(credits.reserved / factor),
    remaining: Math.max(0, Math.floor(credits.remaining / factor)),
  };
  for (const key of ["includedRemaining", "includedLimit", "includedUsed", "includedReserved", "purchasedRemaining", "purchasedReserved", "purchasedDebt", "purchasedHeld", "purchasedSuspendedDeficit"] as const) {
    if (typeof credits[key] === "number") result[key] = Math.max(0, Math.floor(credits[key]! / factor));
  }
  return result;
}

function purchasedQuotaFromRow(row: QuotaRpcRow): Partial<AiMediaQuotaCounter> {
  if (typeof row.purchased_remaining_count === "undefined") return {};
  return {
    includedRemaining: numberValue(row.included_remaining_count, "included_remaining_count", row.quota_unit === "credit"),
    includedLimit: numberValue(row.included_limit_count, "included_limit_count"),
    includedUsed: numberValue(row.included_used_count, "included_used_count"),
    includedReserved: numberValue(row.included_reserved_count, "included_reserved_count"),
    purchasedRemaining: numberValue(row.purchased_remaining_count, "purchased_remaining_count"),
    purchasedReserved: numberValue(row.purchased_reserved_count, "purchased_reserved_count"),
    purchasedDebt: numberValue(row.purchased_debt_count, "purchased_debt_count"),
    purchasedHeld: numberValue(row.purchased_held_count ?? 0, "purchased_held_count"),
    purchasedSuspendedDeficit: numberValue(row.purchased_suspended_deficit_count ?? 0, "purchased_suspended_deficit_count"),
  };
}

function jobStatus(value: unknown, nullable: true): AiMediaGenerationJobStatus | null;
function jobStatus(value: unknown, nullable?: false): AiMediaGenerationJobStatus;
function jobStatus(value: unknown, nullable = false): AiMediaGenerationJobStatus | null {
  if (nullable && (value === null || typeof value === "undefined")) return null;
  if (typeof value !== "string" || !KNOWN_JOB_STATUSES.has(value as AiMediaGenerationJobStatus)) {
    throw new AiMediaGenerationQuotaError(
      "ai_media_invalid_rpc_response",
      "Statut de generation media IA invalide.",
      503,
    );
  }
  return value as AiMediaGenerationJobStatus;
}

export async function getAiMediaQuotaSnapshot(params: {
  supabase?: AiMediaQuotaRpcClient;
  accountId: string;
  actorAuthUserId: string;
  edition: AiMediaEdition;
}): Promise<AiMediaQuotaSnapshot> {
  const accountId = assertUuid(params.accountId, "accountId");
  const actorAuthUserId = assertUuid(params.actorAuthUserId, "actorAuthUserId");
  const edition = normalizeAiMediaEdition(params.edition);
  const client = params.supabase ?? supabaseAdmin;
  const rpcArgs = {
    p_account_id: accountId,
    p_actor_auth_user_id: actorAuthUserId,
    p_edition: edition,
  };
  const unified = await client.rpc("get_ai_media_generation_quota_v4", rpcArgs);
  if (!unified.error) {
    const [row] = rowsFromRpc<QuotaRpcRow>(unified.data, "get_ai_media_generation_quota_v4");
    const parsed = quotaFromRow(row);
    if (parsed.unit !== "credit" || row.wallet_ready !== true) {
      throw new AiMediaGenerationQuotaError("ai_media_credit_wallet_unavailable", "Le portefeuille de crédits médias n'est pas prêt.", 503);
    }
    const credits: AiMediaQuotaCounter & { unit: "credit"; periodStart: string; resetAt: string } = { ...parsed, ...purchasedQuotaFromRow(row), unit: "credit" };
    return {
      accountId, edition, periodStart: parsed.periodStart, resetAt: parsed.resetAt,
      studioEnabled: row.studio_enabled === true, creditsReady: true, credits,
      image: equivalentCounter(credits, "image"), video: equivalentCounter(credits, "video"),
    };
  }
  if (!isMissingQuotaRpc(unified.error, "get_ai_media_generation_quota_v4")) rpcError("get_ai_media_generation_quota_v4", unified.error);
  const rows = await callRpc<QuotaRpcRow>(client, "get_ai_media_generation_quota_v3", rpcArgs);

  const imageRow = rows.find((row) => row.media_kind === "image");
  const videoRow = rows.find((row) => row.media_kind === "video");
  if (!imageRow || !videoRow) {
    throw new AiMediaGenerationQuotaError(
      "ai_media_invalid_rpc_response",
      "Le controle de quota n'a pas retourne les deux types de medias.",
      503,
    );
  }

  const image = quotaFromRow(imageRow);
  const video = quotaFromRow(videoRow);
  if (image.periodStart !== video.periodStart || image.resetAt !== video.resetAt) {
    throw new AiMediaGenerationQuotaError(
      "ai_media_invalid_rpc_response",
      "Les periodes de quota media IA sont incoherentes.",
      503,
    );
  }

  return {
    accountId,
    edition,
    periodStart: image.periodStart,
    resetAt: image.resetAt,
    studioEnabled: imageRow.studio_enabled === true && videoRow.studio_enabled === true,
    creditsReady: false,
    credits: {
      unit: "credit", limit: 0, used: 0, reserved: 0, remaining: 0, periodStart: image.periodStart, resetAt: image.resetAt,
      includedRemaining: 0, includedLimit: 0, includedUsed: 0, includedReserved: 0,
      purchasedRemaining: 0, purchasedReserved: 0, purchasedDebt: 0,
      purchasedHeld: 0, purchasedSuspendedDeficit: 0,
    },
    image: {
      unit: image.unit,
      limit: image.limit,
      used: image.used,
      reserved: image.reserved,
      remaining: image.remaining,
      ...purchasedQuotaFromRow(imageRow),
    },
    video: {
      unit: video.unit,
      limit: video.limit,
      used: video.used,
      reserved: video.reserved,
      remaining: video.remaining,
      ...purchasedQuotaFromRow(videoRow),
    },
  };
}

export async function reserveAiMediaGeneration(params: {
  supabase?: AiMediaQuotaRpcClient;
  accountId: string;
  actorAuthUserId: string;
  requestKey: string;
  requestFingerprint: string;
  mediaKind: AiMediaKind;
  surface: AiMediaSurface;
  edition: AiMediaEdition;
  reservationTtlSeconds?: number;
  limitOverride?: number;
  /** Legacy item/second amount, or the immutable server quote when unit is credit. */
  quotaAmount?: number;
  quotaUnit?: "item" | "second" | "credit";
  metadata?: AiMediaQuotaMetadata;
  /** Only trusted automatic preparation may pass a claimed editorial slot. */
  automaticEditorialActionId?: string;
}): Promise<AiMediaGenerationReservation> {
  const accountId = assertUuid(params.accountId, "accountId");
  const actorAuthUserId = assertUuid(params.actorAuthUserId, "actorAuthUserId");
  const requestKey = String(params.requestKey ?? "").trim();
  const requestFingerprint = String(params.requestFingerprint ?? "").trim().toLowerCase();
  const mediaKind = normalizeKind(params.mediaKind);
  const surface = normalizeSurface(params.surface);
  const edition = normalizeAiMediaEdition(params.edition);
  const reservationTtlSeconds = params.reservationTtlSeconds ?? (mediaKind === "video" ? 3600 : 900);
  const quotaAmount = params.quotaAmount ?? (mediaKind === "video" ? 8 : 1);
  const quotaUnit = params.quotaUnit ?? (mediaKind === "video" ? "second" : "item");

  if (requestKey.length < 8 || requestKey.length > 180) {
    inputError("ai_media_invalid_request_key", "La cle de requete doit contenir entre 8 et 180 caracteres.");
  }
  if (!FINGERPRINT_PATTERN.test(requestFingerprint)) {
    inputError("ai_media_invalid_fingerprint", "L'empreinte de requete doit etre un SHA-256 hexadecimal.");
  }
  if (!Number.isInteger(reservationTtlSeconds) || reservationTtlSeconds < 60 || reservationTtlSeconds > 86400) {
    inputError("ai_media_invalid_ttl", "La duree de reservation doit etre comprise entre 60 secondes et 24 heures.");
  }
  if (
    typeof params.limitOverride !== "undefined" &&
    (!Number.isInteger(params.limitOverride) || params.limitOverride < (quotaUnit === "credit" ? 1 : 0) || params.limitOverride > (quotaUnit === "credit" ? 1_000_000 : 10000))
  ) {
    inputError("ai_media_invalid_limit", "Le plafond media IA est invalide.");
  }
  if (
    (quotaUnit === "credit" && (!Number.isSafeInteger(quotaAmount) || quotaAmount <= 0 || quotaAmount > 1_000_000)) ||
    (quotaUnit !== "credit" && mediaKind === "image" && (quotaUnit !== "item" || quotaAmount !== 1)) ||
    (quotaUnit !== "credit" && mediaKind === "video" && (quotaUnit !== "second" || !([8, 16, 24] as const).includes(quotaAmount as 8 | 16 | 24)))
  ) {
    inputError(
      "ai_media_invalid_quota_amount",
      quotaUnit === "credit" ? "Une génération doit réserver un nombre positif de crédits." : mediaKind === "video"
        ? "Une vidéo doit réserver 8, 16 ou 24 secondes."
        : "Une image doit réserver exactement une unité.",
    );
  }

  const automaticEditorialActionId = params.automaticEditorialActionId ? assertEditorialActionId(params.automaticEditorialActionId) : null;
  if (automaticEditorialActionId && (quotaUnit !== "credit" || surface !== "booster")) inputError("ai_media_invalid_automatic_credit_context", "L’avance de crédits est réservée aux préparations automatiques iNr’Agent.");
  const [row] = await callRpc<ReservationRpcRow>(params.supabase ?? supabaseAdmin, automaticEditorialActionId ? "reserve_inr_agent_media_generation_v1" : quotaUnit === "credit" ? "reserve_ai_media_generation_v3" : "reserve_ai_media_generation_v2", {
    ...(automaticEditorialActionId ? { p_editorial_action_id: automaticEditorialActionId } : {}),
    p_account_id: accountId,
    p_actor_auth_user_id: actorAuthUserId,
    p_request_key: requestKey,
    p_request_fingerprint: requestFingerprint,
    p_media_kind: mediaKind,
    p_surface: surface,
    p_edition: edition,
    p_quota_amount: quotaAmount,
    p_reservation_ttl_seconds: reservationTtlSeconds,
    p_limit_override: params.limitOverride ?? null,
    p_metadata: normalizeMetadata(params.metadata),
  });

  const outcome = stringValue(row.outcome, "outcome") as AiMediaGenerationReservationOutcome;
  if (!KNOWN_RESERVATION_OUTCOMES.has(outcome)) {
    throw new AiMediaGenerationQuotaError(
      "ai_media_invalid_rpc_response",
      "Resultat de reservation media IA invalide.",
      503,
    );
  }

  const jobId = nullableString(row.job_id);
  if ((outcome === "reserved" || outcome === "replayed") && !jobId) {
    throw new AiMediaGenerationQuotaError(
      "ai_media_invalid_rpc_response",
      "La reservation media IA ne contient aucun identifiant de generation.",
      503,
    );
  }

  return {
    outcome,
    jobId,
    status: jobStatus(row.job_status, true),
    replayed: row.is_replay === true,
    expiresAt: nullableString(row.reservation_expires_at),
    quotaAmount: numberValue(row.quota_amount ?? quotaAmount, "quota_amount"),
    quota: quotaFromRow(row),
  };
}

function transitionFromRow(row: TransitionRpcRow): AiMediaGenerationTransition {
  const kind = String(row.media_kind ?? "") as AiMediaKind;
  if (!(AI_MEDIA_KINDS as readonly string[]).includes(kind)) {
    throw new AiMediaGenerationQuotaError(
      "ai_media_invalid_rpc_response",
      "Type de media IA invalide dans la reponse.",
      503,
    );
  }
  return {
    jobId: stringValue(row.job_id, "job_id"),
    status: jobStatus(row.job_status),
    mediaKind: kind,
    mediaId: nullableString(row.media_id),
    quotaAmount: numberValue(row.quota_amount ?? (kind === "video" ? 8 : 1), "quota_amount"),
    quota: quotaFromRow(row),
  };
}

export async function completeAiMediaGeneration(params: {
  supabase?: AiMediaQuotaRpcClient;
  accountId: string;
  jobId: string;
  mediaId: string;
  metadata?: AiMediaQuotaMetadata;
  /** Only explicit legacy requests may use v2 when the v3 dispatch RPC is absent. */
  quotaUnit?: "item" | "second" | "credit";
}): Promise<AiMediaGenerationTransition> {
  const args = {
    p_account_id: assertUuid(params.accountId, "accountId"),
    p_job_id: assertUuid(params.jobId, "jobId"),
    p_media_id: assertUuid(params.mediaId, "mediaId"),
    p_metadata: normalizeMetadata(params.metadata),
  };
  const [row] = await callTransitionRpc(params.supabase ?? supabaseAdmin, "complete", args, params.quotaUnit);
  return transitionFromRow(row);
}

export async function failAiMediaGeneration(params: {
  supabase?: AiMediaQuotaRpcClient;
  accountId: string;
  jobId: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: AiMediaQuotaMetadata;
  quotaUnit?: "item" | "second" | "credit";
}): Promise<AiMediaGenerationTransition> {
  const args = {
    p_account_id: assertUuid(params.accountId, "accountId"),
    p_job_id: assertUuid(params.jobId, "jobId"),
    p_error_code: params.errorCode?.trim().slice(0, 120) || null,
    p_error_message: params.errorMessage?.trim().slice(0, 2000) || null,
    p_metadata: normalizeMetadata(params.metadata),
  };
  const [row] = await callTransitionRpc(params.supabase ?? supabaseAdmin, "fail", args, params.quotaUnit);
  return transitionFromRow(row);
}

async function callTransitionRpc(client: AiMediaQuotaRpcClient, transition: "complete" | "fail", args: Record<string, unknown>, quotaUnit?: "item" | "second" | "credit"): Promise<TransitionRpcRow[]> {
  const rpcName = `${transition}_ai_media_generation_v3`;
  const result = await client.rpc(rpcName, args);
  if (!result.error) return rowsFromRpc<TransitionRpcRow>(result.data, rpcName);
  if (quotaUnit && quotaUnit !== "credit" && isMissingQuotaRpc(result.error, rpcName)) {
    return callRpc<TransitionRpcRow>(client, `${transition}_ai_media_generation_v2`, args);
  }
  rpcError(rpcName, result.error);
}

export const commitAiMediaGeneration = completeAiMediaGeneration;
export const releaseAiMediaGeneration = failAiMediaGeneration;

export async function expireAiMediaGenerationReservations(params?: {
  supabase?: AiMediaQuotaRpcClient;
  batchSize?: number;
}): Promise<number> {
  const batchSize = params?.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    inputError("ai_media_invalid_batch_size", "La taille du lot d'expiration est invalide.");
  }
  const client = params?.supabase ?? supabaseAdmin;
  const credits = await client.rpc("expire_ai_media_credit_reservations", { p_batch_size: batchSize });
  if (credits.error && !isMissingQuotaRpc(credits.error, "expire_ai_media_credit_reservations")) rpcError("expire_ai_media_credit_reservations", credits.error);
  const { data, error } = await client.rpc(
    "expire_ai_media_generation_reservations",
    { p_batch_size: batchSize },
  );
  if (error) rpcError("expire_ai_media_generation_reservations", error);
  return numberValue(data, "expired_count") + (credits.error ? 0 : numberValue(credits.data, "expired_credit_count"));
}
