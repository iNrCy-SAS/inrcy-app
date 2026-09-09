import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { DashboardEdition } from "@/lib/dashboardEdition";

export type BusinessDnaAnalysisQuotaEdition = DashboardEdition | "admin";

export type BusinessDnaAnalysisQuota = {
  edition: BusinessDnaAnalysisQuotaEdition;
  limit: number;
  used: number;
  remaining: number;
  periodStart: string;
  resetAt: string;
};

export type BusinessDnaAnalysisQuotaConsumption = BusinessDnaAnalysisQuota & {
  outcome: "consumed" | "quota_reached";
};

type QuotaRow = {
  outcome?: unknown;
  edition?: unknown;
  limit_count?: unknown;
  used_count?: unknown;
  remaining_count?: unknown;
  period_start?: unknown;
  reset_at?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BusinessDnaAnalysisQuotaError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 503, options?: ErrorOptions) {
    super(message, options);
    this.name = "BusinessDnaAnalysisQuotaError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function assertUuid(value: string, label: string) {
  const normalized = String(value || "").trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new BusinessDnaAnalysisQuotaError(
      "business_dna_quota_invalid_id",
      `${label} invalide.`,
      400,
    );
  }
  return normalized;
}

function normalizeEdition(value: unknown): BusinessDnaAnalysisQuotaEdition {
  if (value === "standard" || value === "premium" || value === "founder" || value === "admin") return value;
  throw new BusinessDnaAnalysisQuotaError(
    "business_dna_quota_invalid_response",
    "L’édition du quota d’analyse est invalide.",
  );
}

function integer(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BusinessDnaAnalysisQuotaError(
      "business_dna_quota_invalid_response",
      `Le quota d’analyse est incohérent (${label}).`,
    );
  }
  return parsed;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) {
    throw new BusinessDnaAnalysisQuotaError(
      "business_dna_quota_invalid_response",
      `Le quota d’analyse est incomplet (${label}).`,
    );
  }
  return value;
}

function firstRow(data: unknown, rpcName: string): QuotaRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new BusinessDnaAnalysisQuotaError(
      "business_dna_quota_invalid_response",
      `Le contrôle de quota n’a renvoyé aucun résultat (${rpcName}).`,
    );
  }
  return row as QuotaRow;
}

function rpcFailure(rpcName: string, error: unknown): never {
  const candidate = error as { message?: unknown; details?: unknown; code?: unknown } | null;
  const raw = [candidate?.message, candidate?.details, candidate?.code]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (raw.includes("BUSINESS_DNA_ACCOUNT_ACCESS_DENIED")) {
    throw new BusinessDnaAnalysisQuotaError(
      "business_dna_account_access_denied",
      "Cet établissement n’est pas accessible.",
      403,
      { cause: error },
    );
  }
  if (raw.includes("BUSINESS_DNA_INVALID_EDITION")) {
    throw new BusinessDnaAnalysisQuotaError(
      "business_dna_quota_invalid_edition",
      "Cette édition de quota n’est pas encore disponible.",
      503,
      { cause: error },
    );
  }
  if (/business_dna_analysis_(?:monthly_usage|plan_limits)|get_business_dna_analysis_quota|consume_business_dna_analysis_quota/i.test(raw)) {
    throw new BusinessDnaAnalysisQuotaError(
      "business_dna_quota_migration_required",
      "Le quota d’analyse doit d’abord être activé dans Supabase.",
      503,
      { cause: error },
    );
  }
  throw new BusinessDnaAnalysisQuotaError(
    "business_dna_quota_unavailable",
    `Le contrôle du quota d’analyse est momentanément indisponible (${rpcName}).`,
    503,
    { cause: error },
  );
}

async function rpc(rpcName: string, args: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.rpc(rpcName, args);
  if (error) rpcFailure(rpcName, error);
  return firstRow(data, rpcName);
}

async function quotaRpc(
  rpcName: string,
  params: {
    accountId: string;
    actorAuthUserId: string;
    edition: BusinessDnaAnalysisQuotaEdition;
  },
) {
  try {
    return await rpc(rpcName, quotaArgs(params));
  } catch (error) {
    // Déploiement sans interruption : tant que la ligne `admin` n'a pas encore
    // été ajoutée par la migration, l'ancien plafond Founder (16) reste le
    // repli réservé à un acteur déjà vérifié comme Admin par la route serveur.
    if (
      params.edition === "admin" &&
      error instanceof BusinessDnaAnalysisQuotaError &&
      error.code === "business_dna_quota_invalid_edition"
    ) {
      return rpc(rpcName, quotaArgs({ ...params, edition: "founder" }));
    }
    throw error;
  }
}

function quotaFromRow(row: QuotaRow): BusinessDnaAnalysisQuota {
  return {
    edition: normalizeEdition(row.edition),
    limit: integer(row.limit_count, "limit_count"),
    used: integer(row.used_count, "used_count"),
    remaining: integer(row.remaining_count, "remaining_count"),
    periodStart: requiredString(row.period_start, "period_start"),
    resetAt: requiredString(row.reset_at, "reset_at"),
  };
}

function quotaArgs(params: {
  accountId: string;
  actorAuthUserId: string;
  edition: BusinessDnaAnalysisQuotaEdition;
}) {
  return {
    p_account_id: assertUuid(params.accountId, "accountId"),
    p_actor_auth_user_id: assertUuid(params.actorAuthUserId, "actorAuthUserId"),
    p_edition: params.edition,
  };
}

export async function getBusinessDnaAnalysisQuota(params: {
  accountId: string;
  actorAuthUserId: string;
  edition: BusinessDnaAnalysisQuotaEdition;
}) {
  return quotaFromRow(await quotaRpc("get_business_dna_analysis_quota", params));
}

export async function consumeBusinessDnaAnalysisQuota(params: {
  accountId: string;
  actorAuthUserId: string;
  edition: BusinessDnaAnalysisQuotaEdition;
}): Promise<BusinessDnaAnalysisQuotaConsumption> {
  const row = await quotaRpc("consume_business_dna_analysis_quota", params);
  const outcome = row.outcome;
  if (outcome !== "consumed" && outcome !== "quota_reached") {
    throw new BusinessDnaAnalysisQuotaError(
      "business_dna_quota_invalid_response",
      "Le résultat du quota d’analyse est invalide.",
    );
  }
  return { outcome, ...quotaFromRow(row) };
}

export async function refundBusinessDnaAnalysisQuota(params: {
  accountId: string;
  actorAuthUserId: string;
  edition: BusinessDnaAnalysisQuotaEdition;
}) {
  return quotaFromRow(await quotaRpc("refund_business_dna_analysis_quota", params));
}
