/** Contrat public de suivi : aucun texte de document ou secret de verrou. */
export type BusinessDnaManualAnalysisJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  result: Record<string, unknown>;
};

export function parseBusinessDnaManualAnalysisJob(value: unknown): BusinessDnaManualAnalysisJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const job = value as Record<string, unknown>;
  if (typeof job.id !== "string" || !["queued", "running", "succeeded", "failed"].includes(String(job.status))) return null;
  return {
    id: job.id,
    status: job.status as BusinessDnaManualAnalysisJob["status"],
    createdAt: typeof job.createdAt === "string" ? job.createdAt : "",
    startedAt: typeof job.startedAt === "string" ? job.startedAt : null,
    completedAt: typeof job.completedAt === "string" ? job.completedAt : null,
    error: typeof job.error === "string" ? job.error : null,
    result: job.result && typeof job.result === "object" && !Array.isArray(job.result)
      ? job.result as Record<string, unknown> : {},
  };
}

export function isBusinessDnaManualAnalysisPending(job: BusinessDnaManualAnalysisJob | null) {
  return job?.status === "queued" || job?.status === "running";
}
