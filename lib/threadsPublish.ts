import { createHash } from "node:crypto";
import { type ThreadsPublicationMode } from "./threadsPublicationPreferences.ts";
import { buildThreadsGraphUrl } from "./threadsGraphApi.ts";
import { isMetaAuthorizationError, isMetaRateLimitError } from "./metaGraphErrorClassification.ts";

// Meta's official collection: https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api
// Containers are distinct from published post IDs. Published posts cannot be
// edited through the documented API; deletion requires threads_delete.
export { THREADS_EDIT_UNSUPPORTED_MESSAGE } from "./inrsend/threadsCapabilities.ts";
export type ThreadsMediaItem = { type: "IMAGE" | "VIDEO"; url: string; altText?: string; sourceIdentity?: string };
export type ThreadsPublishCheckpoint = {
  version: 1;
  userId: string;
  requestFingerprint: string;
  createdAt: string;
  childContainerIds: string[];
  containerId: string | null;
  mediaType: "TEXT" | "IMAGE" | "VIDEO" | "CAROUSEL";
  publicationMode?: ThreadsPublicationMode;
  state: "created" | "processing" | "ready" | "publish_unknown" | "published" | "failed";
  postId: string | null;
};
export type ThreadsPublishResult =
  | { ok: true; postId: string; mediaType: ThreadsPublishCheckpoint["mediaType"]; publicationMode: ThreadsPublicationMode; checkpoint: ThreadsPublishCheckpoint }
  | { ok: false; error: string; code: string; retryable: boolean; requestMayHaveSucceeded?: boolean; authorizationError?: boolean; retryAfterMs?: number; checkpoint?: ThreadsPublishCheckpoint; diagnostics?: unknown };
type Dependencies = { fetchImpl?: typeof fetch; now?: () => Date };
type PublishParams = {
  userId: string;
  accessToken: string;
  text: string;
  media?: ThreadsMediaItem[];
  publicationMode?: ThreadsPublicationMode;
  expiresAt?: string | null;
  checkpoint?: unknown;
  onCheckpoint?: (checkpoint: ThreadsPublishCheckpoint) => Promise<void>;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const clean = (value: unknown) => String(value || "").trim();
const now = (deps: Dependencies) => deps.now?.() || new Date();

/** Durable server-owned storage identity; URL-only media keeps strict URL matching. */
export function buildThreadsMediaSourceIdentity(params: { bucket?: unknown; storagePath?: unknown }): string | undefined {
  const bucket = clean(params.bucket) || "booster";
  const path = clean(params.storagePath).replace(/^\/+/, "");
  if (!path || path.length > 1500 || !/^[a-zA-Z0-9._-]{1,100}$/.test(bucket) || path.includes("\\") || path.includes("\0") || path.split("/").some((part) => part === "." || part === "..")) return undefined;
  return `storage:${JSON.stringify([bucket, path])}`;
}

export function parseThreadsPublishCheckpoint(value: unknown): ThreadsPublishCheckpoint | null {
  const row = record(value);
  if (row.version !== 1 || !clean(row.userId) || !/^[a-f0-9]{64}$/.test(clean(row.requestFingerprint)) ||
    !Number.isFinite(Date.parse(clean(row.createdAt))) || !Array.isArray(row.childContainerIds) ||
    row.childContainerIds.some((id) => !/^\d+$/.test(clean(id))) || row.childContainerIds.length > 20 ||
    !["TEXT", "IMAGE", "VIDEO", "CAROUSEL"].includes(clean(row.mediaType)) ||
    (row.publicationMode !== undefined && !["classic", "ghost"].includes(clean(row.publicationMode))) ||
    (row.publicationMode === "ghost" && (row.mediaType !== "TEXT" || row.childContainerIds.length > 0)) ||
    !["created", "processing", "ready", "publish_unknown", "published", "failed"].includes(clean(row.state)) ||
    (row.containerId !== null && !/^\d+$/.test(clean(row.containerId))) ||
    (row.postId !== null && !/^\d+$/.test(clean(row.postId))) || (row.state === "published" && !row.postId)) return null;
  return row as unknown as ThreadsPublishCheckpoint;
}

async function request(path: string, accessToken: string, fields: Record<string, string>, method: "GET" | "POST" | "DELETE", deps: Dependencies) {
  const query = new URLSearchParams(fields);
  const url = buildThreadsGraphUrl(path) + (method === "GET" && query.size ? `?${query}` : "");
  const response = await (deps.fetchImpl || fetch)(url, {
    method, cache: "no-store", signal: AbortSignal.timeout(method === "GET" ? 15_000 : 45_000),
    headers: { Authorization: `Bearer ${accessToken}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    ...(method === "POST" ? { body: query.toString() } : {}),
  });
  const body = record(await response.json().catch(() => ({})));
  return { response, body };
}

function graphFailure(response: Response, body: Record<string, unknown>, checkpoint?: ThreadsPublishCheckpoint): Extract<ThreadsPublishResult, { ok: false }> {
  const error = record(body.error);
  const authorizationError = isMetaAuthorizationError({ ...error, httpStatus: response.status });
  const rateLimited = isMetaRateLimitError({ ...error, httpStatus: response.status });
  return { ok: false, error: authorizationError ? "La connexion Threads a expiré. Reconnectez votre compte dans Canaux." : clean(error.message) || "Threads n’a pas pu finaliser la publication.",
    code: authorizationError ? "threads_reconnect_required" : rateLimited ? "threads_rate_limited" : "threads_api_error",
    retryable: rateLimited || response.status >= 500, authorizationError,
    ...(rateLimited ? { retryAfterMs: Math.max(60_000, Number(response.headers.get("retry-after") || 0) * 1_000) } : {}),
    ...(checkpoint ? { checkpoint } : {}), diagnostics: { httpStatus: response.status, error }, };
}

export async function threadsPublish(params: PublishParams, deps: Dependencies = {}): Promise<ThreadsPublishResult> {
  const userId = clean(params.userId), accessToken = clean(params.accessToken), text = clean(params.text);
  const media = (params.media || []).map((item) => ({ ...item, url: clean(item.url) }));
  const publicationMode = params.publicationMode ?? "classic";
  if (!["classic", "ghost"].includes(publicationMode)) return { ok: false, error: "Le format Threads demandé est invalide.", code: "threads_invalid_input", retryable: false };
  // Meta only supports text for Ghost Posts. Never silently discard selected media.
  if (publicationMode === "ghost" && media.length) return { ok: false, error: "Les Ghost Posts Threads acceptent uniquement du texte, sans image ni vidéo.", code: "threads_ghost_media_unsupported", retryable: false };
  const invalid = !userId || !accessToken || (!text && !media.length) || Array.from(text).length > 500 || media.length > 20 || media.some((item) => !["IMAGE", "VIDEO"].includes(item.type) || !/^https:\/\//i.test(item.url));
  if (invalid) return { ok: false, error: "Publication Threads invalide (texte de 500 caractères maximum, médias HTTPS, 20 médias maximum).", code: "threads_invalid_input", retryable: false };
  if (params.expiresAt && Date.parse(params.expiresAt) <= now(deps).getTime()) return { ok: false, error: "La connexion Threads a expiré. Reconnectez votre compte.", code: "threads_reconnect_required", retryable: false, authorizationError: true };
  const mediaType = media.length > 1 ? "CAROUSEL" : media[0]?.type || "TEXT";
  // Signed delivery URLs can rotate between polls. The same stored object
  // remains the same request; another object, media order or text never does.
  const fingerprintMedia = media.map(({ sourceIdentity, ...item }) => ({ ...item, url: clean(sourceIdentity) || item.url }));
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ userId, text, media: fingerprintMedia, ...(publicationMode === "ghost" ? { publicationMode } : {}) })).digest("hex");
  let checkpoint = parseThreadsPublishCheckpoint(params.checkpoint);
  if (params.checkpoint && (!checkpoint || checkpoint.userId !== userId || checkpoint.requestFingerprint !== requestFingerprint || (checkpoint.publicationMode ?? "classic") !== publicationMode)) return { ok: false, error: "La reprise Threads ne correspond pas à cette publication.", code: "threads_checkpoint_invalid", retryable: false };
  checkpoint ||= { version: 1, userId, requestFingerprint, createdAt: now(deps).toISOString(), childContainerIds: [], containerId: null, mediaType, publicationMode, state: "created", postId: null };
  if (checkpoint.state === "published" && checkpoint.postId) return { ok: true, postId: checkpoint.postId, mediaType: checkpoint.mediaType, publicationMode, checkpoint };
  if (checkpoint.state === "publish_unknown") return { ok: false, error: "Threads a reçu une tentative de publication dont le résultat doit être vérifié avant tout nouvel essai.", code: "threads_publish_ambiguous", retryable: false, requestMayHaveSucceeded: true, checkpoint };
  if (checkpoint.state === "failed" || now(deps).getTime() - Date.parse(checkpoint.createdAt) >= 24 * 60 * 60_000) return { ok: false, error: "Le conteneur Threads a expiré ou a échoué. Créez une nouvelle publication.", code: "threads_container_expired", retryable: false, checkpoint };
  const persist = async (patch: Partial<ThreadsPublishCheckpoint>) => { checkpoint = { ...checkpoint!, ...patch }; await params.onCheckpoint?.(checkpoint); };
  const fail = (error: unknown, stage: "create" | "poll" | "publish"): ThreadsPublishResult => ({ ok: false, error: error instanceof Error ? error.message : "Threads est temporairement indisponible.", code: `threads_${stage}_${stage === "poll" ? "unavailable" : "ambiguous"}`, retryable: stage === "poll", requestMayHaveSucceeded: stage !== "poll", checkpoint: checkpoint! });
  const create = async (fields: Record<string, string>) => request(`${encodeURIComponent(userId)}/threads`, accessToken, fields, "POST", deps);
  try {
    if (!checkpoint.containerId) {
      if (mediaType === "CAROUSEL") {
        for (let index = checkpoint.childContainerIds.length; index < media.length; index++) {
          const item = media[index];
          const created = await create({ media_type: item.type, [item.type === "IMAGE" ? "image_url" : "video_url"]: item.url, is_carousel_item: "true", ...(item.altText ? { alt_text: item.altText } : {}) });
          if (!created.response.ok) return graphFailure(created.response, created.body, checkpoint);
          const id = clean(created.body.id);
          if (!/^\d+$/.test(id)) return fail(new Error("Threads n’a pas renvoyé l’identifiant du média préparé."), "create");
          await persist({ childContainerIds: [...checkpoint.childContainerIds, id] });
        }
        // Children must be ready before their parent can be created.
        for (const child of checkpoint.childContainerIds) {
          const status = await request(child, accessToken, { fields: "id,status,error_message" }, "GET", deps);
          if (!status.response.ok) return graphFailure(status.response, status.body, checkpoint);
          if (["ERROR", "EXPIRED"].includes(clean(status.body.status))) { await persist({ state: "failed" }); return { ok: false, error: clean(status.body.error_message) || "Un média du carrousel Threads a échoué.", code: "threads_container_failed", retryable: false, checkpoint }; }
          if (clean(status.body.status) !== "FINISHED") { await persist({ state: "processing" }); return { ok: false, error: "Threads prépare les médias.", code: "threads_processing", retryable: true, retryAfterMs: 60_000, checkpoint }; }
        }
      }
      const fields: Record<string, string> = { media_type: mediaType, ...(text ? { text } : {}), ...(publicationMode === "ghost" ? { is_ghost_post: "true" } : {}) };
      if (mediaType === "CAROUSEL") fields.children = checkpoint.childContainerIds.join(",");
      else if (media[0]) { fields[media[0].type === "IMAGE" ? "image_url" : "video_url"] = media[0].url; if (media[0].altText) fields.alt_text = media[0].altText; }
      const created = await create(fields);
      if (!created.response.ok) return graphFailure(created.response, created.body, checkpoint);
      const containerId = clean(created.body.id);
      if (!/^\d+$/.test(containerId)) return fail(new Error("Threads n’a pas renvoyé l’identifiant du conteneur."), "create");
      await persist({ containerId, state: "created" });
    }
  } catch (error) { return fail(error, "create"); }
  try {
    const status = await request(checkpoint.containerId!, accessToken, { fields: "id,status,error_message" }, "GET", deps);
    if (!status.response.ok) return graphFailure(status.response, status.body, checkpoint);
    const state = clean(status.body.status);
    if (["ERROR", "EXPIRED"].includes(state)) { await persist({ state: "failed" }); return { ok: false, error: clean(status.body.error_message) || "Le conteneur Threads a échoué ou expiré.", code: "threads_container_failed", retryable: false, checkpoint }; }
    if (state === "PUBLISHED") return { ok: false, error: "Ce conteneur Threads a déjà été publié. Vérifiez son résultat avant de réessayer.", code: "threads_publish_ambiguous", retryable: false, requestMayHaveSucceeded: true, checkpoint };
    if (state !== "FINISHED") { await persist({ state: "processing" }); return { ok: false, error: "Threads prépare la publication.", code: "threads_processing", retryable: true, retryAfterMs: 60_000, checkpoint }; }
    await persist({ state: "ready" });
  } catch (error) { return fail(error, "poll"); }
  try {
    // Persist intent before the remote mutation. A crashed/ambiguous publish
    // must never create another post on an automatic retry.
    await persist({ state: "publish_unknown" });
    const published = await request(`${encodeURIComponent(userId)}/threads_publish`, accessToken, { creation_id: checkpoint.containerId! }, "POST", deps);
    if (!published.response.ok) {
      const failure = graphFailure(published.response, published.body, checkpoint);
      if (published.response.status < 500) { await persist({ state: "ready" }); return { ...failure, checkpoint }; }
      return { ...failure, retryable: false, code: "threads_publish_ambiguous", requestMayHaveSucceeded: true };
    }
    const postId = clean(published.body.id);
    if (!/^\d+$/.test(postId)) return fail(new Error("Threads n’a pas renvoyé l’identifiant de la publication."), "publish");
    await persist({ postId, state: "published" });
    return { ok: true, postId, mediaType, publicationMode, checkpoint };
  } catch (error) { return fail(error, "publish"); }
}

export async function threadsDeletePost(params: { postId: string; accessToken: string }, deps: Dependencies = {}) {
  if (!/^\d+$/.test(clean(params.postId)) || !clean(params.accessToken)) throw new Error("Publication ou connexion Threads introuvable.");
  const deleted = await request(params.postId, params.accessToken, {}, "DELETE", deps);
  if (!deleted.response.ok || deleted.body.success !== true) throw new Error(graphFailure(deleted.response, deleted.body).error);
  return { ok: true as const, postId: params.postId };
}
