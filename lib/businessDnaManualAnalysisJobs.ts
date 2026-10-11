import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { asRecord, asString } from "@/lib/tsSafe";
import { BusinessDnaAnalysisQuotaError } from "@/lib/businessDnaAnalysisQuota";
import type { BusinessDnaManualAnalysisJob } from "./businessDnaManualAnalysisJob";

type JobRow = Record<string, unknown>;
const TABLE = "business_dna_manual_analysis_jobs";
const readString = (value: unknown) => asString(value) || "";

export function publicBusinessDnaManualAnalysisJob(value: unknown): BusinessDnaManualAnalysisJob | null {
  const job = asRecord(value);
  if (!readString(job.id)) return null;
  return {
    id: readString(job.id),
    status: job.status as BusinessDnaManualAnalysisJob["status"],
    createdAt: readString(job.created_at),
    startedAt: readString(job.started_at) || null,
    completedAt: readString(job.completed_at) || null,
    error: readString(job.error_message) || null,
    result: asRecord(job.result),
  };
}

export async function getBusinessDnaManualAnalysisJob(accountId: string, jobId?: string): Promise<JobRow | null> {
  let query = supabaseAdmin.from(TABLE).select("*").eq("account_id", accountId);
  if (jobId) query = query.eq("id", jobId);
  const { data, error } = await query.maybeSingle();
  // Lecture compatible pendant un déploiement progressif ; le lancement,
  // lui, échoue explicitement tant que sa migration n'est pas disponible.
  if (error && /42P01|PGRST205/.test(String(error.code))) return null;
  if (error) throw error;
  return data;
}

export async function startBusinessDnaManualAnalysisJob(args: {
  accountId: string; actorAuthUserId: string; edition: "standard" | "admin";
}) {
  const { data, error } = await supabaseAdmin.rpc("start_business_dna_manual_analysis_job", {
    p_account_id: args.accountId, p_actor_auth_user_id: args.actorAuthUserId, p_edition: args.edition,
  });
  if (error) throw error;
  const row = asRecord(Array.isArray(data) ? data[0] : data);
  const quotaRow = asRecord(row.quota);
  const quota = {
    limit: Number(quotaRow.limit_count), used: Number(quotaRow.used_count),
    remaining: Number(quotaRow.remaining_count), resetAt: readString(quotaRow.reset_at),
  };
  if (![quota.limit, quota.used, quota.remaining].every(Number.isFinite) || !quota.resetAt) {
    throw new BusinessDnaAnalysisQuotaError("business_dna_quota_invalid_response", "Le quota d’analyse est momentanément indisponible.");
  }
  return { outcome: readString(row.outcome), job: asRecord(row.job), quota };
}

export async function assertBusinessDnaManualAnalysisJobRunning(accountId: string, jobId: string, lockToken: string) {
  const job = await getBusinessDnaManualAnalysisJob(accountId, jobId);
  if (!job || job.status !== "running" || job.lock_token !== lockToken || Date.parse(readString(job.expires_at)) <= Date.now()) {
    throw new Error("L’analyse n’est plus active. Relancez-la depuis iNrADN.");
  }
}

async function completeJob(jobId: string, lockToken: string | null, status: "succeeded" | "failed", result: Record<string, unknown>, message: string | null) {
  const { data, error } = await supabaseAdmin.rpc("complete_business_dna_manual_analysis_job", {
    p_job_id: jobId, p_lock_token: lockToken, p_status: status, p_result: result, p_error_message: message,
  });
  if (error) throw error;
  if (data !== "completed" && data !== "already_completed") throw new Error("La finalisation de l’analyse n’a pas pu être confirmée.");
}

/** Exécution protégée par un verrou SQL, indépendante du navigateur. Pas de
 * relance IA automatique d'une tâche démarrée : un crash restitue son quota. */
export async function runBusinessDnaManualAnalysisJob(
  jobId: string,
  analyze: (args: { accountId: string; actorAuthUserId: string; jobId: string; lockToken: string }) => Promise<Response>,
) {
  let lockToken: string | null = null;
  try {
    const { data, error } = await supabaseAdmin.rpc("claim_business_dna_manual_analysis_job", { p_job_id: jobId });
    if (error) throw error;
    if (!data) return false;
    const job = asRecord(data);
    lockToken = readString(job.lock_token);
    const response = await analyze({
      accountId: readString(job.account_id), actorAuthUserId: readString(job.actor_auth_user_id), jobId, lockToken,
    });
    const payload = asRecord(await response.json());
    const success = response.ok && payload.ok === true && payload.persisted === true;
    const result = {
      analyzedAt: readString(payload.analyzedAt),
      sources: Array.isArray(payload.sources) ? payload.sources : [],
      applied: asRecord(payload.applied),
    };
    await completeJob(jobId, lockToken, success ? "succeeded" : "failed", result,
      success ? null : readString(payload.user_message) || "L’analyse n’a pas pu aboutir. Votre quota a été restitué ; vous pouvez réessayer.");
    return true;
  } catch (error) {
    console.error("[business-dna-manual] background analysis failed", {
      jobId, message: error instanceof Error ? error.message : "Erreur de traitement",
    });
    await completeJob(jobId, lockToken, "failed", {}, "L’analyse n’a pas pu aboutir. Votre quota a été restitué ; vous pouvez réessayer.")
      .catch((completionError: unknown) => console.error("[business-dna-manual] completion deferred", { jobId, error: completionError }));
    return false;
  }
}

export async function getQueuedBusinessDnaManualAnalysisJobs() {
  const { error } = await supabaseAdmin.rpc("expire_business_dna_manual_analysis_jobs", { p_limit: 10 });
  if (error) throw error;
  const { data, error: queryError } = await supabaseAdmin.from(TABLE)
    .select("id,account_id").eq("status", "queued").order("created_at", { ascending: true }).limit(1);
  if (queryError) throw queryError;
  return data || [];
}
