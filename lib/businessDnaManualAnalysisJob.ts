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

/** Un formulaire ouvert avant la fin de l'analyse ne renvoie que les champs
 * réellement édités. Une sauvegarde au départ de la page ne peut ainsi pas
 * écraser des enrichissements serveur avec une ancienne copie complète. */
export function buildBusinessDnaWorkspaceSavePatch(previousValue: unknown, nextValue: unknown) {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const previous = record(previousValue);
  const next = record(nextValue);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (key === "schemaVersion" || key === "referenceDocuments" || JSON.stringify(previous[key]) === JSON.stringify(value)) continue;
    patch[key] = key === "richText"
      ? buildBusinessDnaWorkspaceSavePatch(previous[key], value) : value;
  }
  return patch;
}
