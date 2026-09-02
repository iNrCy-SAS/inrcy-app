import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  AI_MEDIA_EDITIONS,
  AI_MEDIA_KINDS,
  AI_MEDIA_MONTHLY_LIMITS,
  AI_MEDIA_SURFACES,
  createAiMediaRequestFingerprint,
  getAiMediaMonthlyLimit,
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
  AI_MEDIA_SURFACES,
  createAiMediaRequestFingerprint,
  getAiMediaMonthlyLimit,
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
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
};

export type AiMediaQuotaSnapshot = {
  accountId: string;
  edition: AiMediaEdition;
  periodStart: string;
  resetAt: string;
  studioEnabled: boolean;
  image: AiMediaQuotaCounter;
  video: AiMediaQuotaCounter;
};

export type AiMediaGenerationReservation = {
  outcome: AiMediaGenerationReservationOutcome;
  jobId: string | null;
  status: AiMediaGenerationJobStatus | null;
  replayed: boolean;
  expiresAt: string | null;
  quota: AiMediaQuotaCounter & { periodStart: string; resetAt: string };
};

export type AiMediaGenerationTransition = {
  jobId: string;
  status: AiMediaGenerationJobStatus;
  mediaKind: AiMediaKind;
  mediaId: string | null;
  quota: AiMediaQuotaCounter & { periodStart: string; resetAt: string };
};

export type AiMediaQuotaRpcClient = Pick<typeof supabaseAdmin, "rpc">;
export type AiMediaQuotaMetadata = Record<string, unknown>;

type QuotaRpcRow = {
  account_id?: unknown;
  edition?: unknown;
  studio_enabled?: unknown;
  media_kind?: unknown;
  limit_count?: unknown;
  used_count?: unknown;
  reserved_count?: unknown;
  remaining_count?: unknown;
  period_start?: unknown;
  reset_at?: unknown;
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

function numberValue(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
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
  return {
    limit: numberValue(row.limit_count, "limit_count"),
    used: numberValue(row.used_count, "used_count"),
    reserved: numberValue(row.reserved_count, "reserved_count"),
    remaining: numberValue(row.remaining_count, "remaining_count"),
    periodStart: stringValue(row.period_start, "period_start"),
    resetAt: stringValue(row.reset_at, "reset_at"),
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
  const rows = await callRpc<QuotaRpcRow>(params.supabase ?? supabaseAdmin, "get_ai_media_generation_quota", {
    p_account_id: accountId,
    p_actor_auth_user_id: actorAuthUserId,
    p_edition: edition,
  });

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
    image: {
      limit: image.limit,
      used: image.used,
      reserved: image.reserved,
      remaining: image.remaining,
    },
    video: {
      limit: video.limit,
      used: video.used,
      reserved: video.reserved,
      remaining: video.remaining,
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
  metadata?: AiMediaQuotaMetadata;
}): Promise<AiMediaGenerationReservation> {
  const accountId = assertUuid(params.accountId, "accountId");
  const actorAuthUserId = assertUuid(params.actorAuthUserId, "actorAuthUserId");
  const requestKey = String(params.requestKey ?? "").trim();
  const requestFingerprint = String(params.requestFingerprint ?? "").trim().toLowerCase();
  const mediaKind = normalizeKind(params.mediaKind);
  const surface = normalizeSurface(params.surface);
  const edition = normalizeAiMediaEdition(params.edition);
  const reservationTtlSeconds = params.reservationTtlSeconds ?? (mediaKind === "video" ? 3600 : 900);

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
    (!Number.isInteger(params.limitOverride) || params.limitOverride < 0 || params.limitOverride > 10000)
  ) {
    inputError("ai_media_invalid_limit", "Le plafond media IA est invalide.");
  }

  const [row] = await callRpc<ReservationRpcRow>(params.supabase ?? supabaseAdmin, "reserve_ai_media_generation", {
    p_account_id: accountId,
    p_actor_auth_user_id: actorAuthUserId,
    p_request_key: requestKey,
    p_request_fingerprint: requestFingerprint,
    p_media_kind: mediaKind,
    p_surface: surface,
    p_edition: edition,
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
    quota: quotaFromRow(row),
  };
}

export async function completeAiMediaGeneration(params: {
  supabase?: AiMediaQuotaRpcClient;
  accountId: string;
  jobId: string;
  mediaId: string;
  metadata?: AiMediaQuotaMetadata;
}): Promise<AiMediaGenerationTransition> {
  const [row] = await callRpc<TransitionRpcRow>(params.supabase ?? supabaseAdmin, "complete_ai_media_generation", {
    p_account_id: assertUuid(params.accountId, "accountId"),
    p_job_id: assertUuid(params.jobId, "jobId"),
    p_media_id: assertUuid(params.mediaId, "mediaId"),
    p_metadata: normalizeMetadata(params.metadata),
  });
  return transitionFromRow(row);
}

export async function failAiMediaGeneration(params: {
  supabase?: AiMediaQuotaRpcClient;
  accountId: string;
  jobId: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: AiMediaQuotaMetadata;
}): Promise<AiMediaGenerationTransition> {
  const [row] = await callRpc<TransitionRpcRow>(params.supabase ?? supabaseAdmin, "fail_ai_media_generation", {
    p_account_id: assertUuid(params.accountId, "accountId"),
    p_job_id: assertUuid(params.jobId, "jobId"),
    p_error_code: params.errorCode?.trim().slice(0, 120) || null,
    p_error_message: params.errorMessage?.trim().slice(0, 2000) || null,
    p_metadata: normalizeMetadata(params.metadata),
  });
  return transitionFromRow(row);
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
  const { data, error } = await (params?.supabase ?? supabaseAdmin).rpc(
    "expire_ai_media_generation_reservations",
    { p_batch_size: batchSize },
  );
  if (error) rpcError("expire_ai_media_generation_reservations", error);
  return numberValue(data, "expired_count");
}
