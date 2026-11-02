import { getMediaLibraryOptimizationJobType, getMediaLibraryOptimizationRequirements, normalizeMediaLibraryOptimizationTarget } from "./mediaLibraryOptimizationPolicy.ts";

type Media = { id: string; media_type: "image" | "video"; is_active?: boolean; size_bytes: number; original_file_name?: string; mime_type?: string;
  optimization?: { id: string; status: string; result?: { outputMediaId?: string }; error_message?: string };
  media_metadata?: { library_optimization?: { source_media_id?: string; job_id?: string; target_bytes?: number } } };
type Ports = { fetch: typeof fetch; wait: (milliseconds: number) => Promise<void>; now: () => number };
const defaults: Ports = { fetch: (...args) => fetch(...args), wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), now: () => Date.now() };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** Same owned queue/worker/item endpoints as the native optimizer. One explicit
 * request creates/reuses its native job; no auto-requeue, delete or replacement. */
export async function runInrAssistantNativeMediaOptimization(input: { mediaId: string; targetBytes?: number; isCurrent: () => boolean }, ports: Ports = defaults) {
  const guard = () => { if (!input.isCurrent()) throw new Error("Le média ou le compte a changé. Le suivi a été arrêté."); };
  const read = async (id: string): Promise<Media> => {
    guard();
    const response = await ports.fetch(`/api/media-library/items?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const body = await response.json().catch(() => null); guard();
    const item = body?.items?.find((item: Media) => item.id === id);
    if (!response.ok || !item || !["image", "video"].includes(item.media_type) || item.is_active === false) throw new Error("Le média exact n’est plus accessible dans Mes médias.");
    return item;
  };
  if (!UUID.test(input.mediaId)) throw new Error("Média invalide.");
  const source = await read(input.mediaId);
  const targetBytes = normalizeMediaLibraryOptimizationTarget({ mediaType: source.media_type, targetBytes: input.targetBytes });
  const requirements = getMediaLibraryOptimizationRequirements({ mediaType: source.media_type, sizeBytes: source.size_bytes, targetBytes, name: source.original_file_name, mimeType: source.mime_type });
  if (!requirements.needsOptimization) throw new Error("Ce média respecte déjà cette limite ; aucune copie supplémentaire n’a été créée.");
  guard();
  const queued = await ports.fetch("/api/media-library/optimization", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mediaId: source.id, targetBytes }), signal: AbortSignal.timeout(15_000) });
  const payload = await queued.json().catch(() => null); guard();
  const job = payload?.job;
  if (!queued.ok || !job || typeof job.id !== "string" || job.media_id !== source.id) throw new Error("La demande d’optimisation n’a pas pu être vérifiée. Aucun nouvel essai automatique n’a été lancé.");
  let status = String(job.status || ""), outputId = String(job.result?.outputMediaId || "");
  if (status !== "succeeded") {
    guard();
    // The native durable worker owns retries and completion. Losing this HTTP
    // response is not permission to send a second queue request.
    void ports.fetch("/api/media-library/optimization/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mediaId: source.id, jobType: getMediaLibraryOptimizationJobType(source.media_type) }), signal: AbortSignal.timeout(9 * 60_000) }).catch(() => undefined);
    const started = ports.now();
    while (ports.now() - started < 8 * 60_000) {
      await ports.wait(1_500); guard();
      const refreshed = await read(source.id), observed = refreshed.optimization;
      if (!observed || observed.id !== job.id) throw new Error("La tâche suivie a changé ; sa réussite ne peut pas être attribuée à cette demande.");
      status = observed.status;
      if (status === "succeeded") { outputId = String(observed.result?.outputMediaId || ""); break; }
      if (status === "failed" || status === "cancelled") throw new Error("L’optimisation native n’a pas abouti. L’original est conservé.");
    }
  }
  if (status !== "succeeded" || !UUID.test(outputId) || outputId === source.id) throw new Error("L’optimisation peut encore être en cours. Sa copie n’est pas encore vérifiée ; aucun nouvel essai automatique n’a été lancé.");
  const output = await read(outputId), proof = output.media_metadata?.library_optimization;
  if (output.media_type !== source.media_type || !Number.isSafeInteger(Number(output.size_bytes)) || Number(output.size_bytes) <= 0 || Number(output.size_bytes) > targetBytes
    || proof?.source_media_id !== source.id || proof.job_id !== job.id || Number(proof.target_bytes) !== targetBytes) throw new Error("La copie retournée ne correspond pas exactement au média et à la tâche demandés.");
  guard();
  return { sourceId: source.id, outputId, targetBytes };
}
