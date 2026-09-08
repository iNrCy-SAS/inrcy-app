import { asRecord, asString } from "./tsSafe.ts";
import {
  X_POST_MAX_IMAGES,
  getXPostUrl,
  validateXPostText,
  validateXUrlFreeText,
} from "./xChannel.ts";

const X_API_ORIGIN = "https://api.x.com";
const X_MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;
const X_IMAGE_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
const X_GIF_SOURCE_MAX_BYTES = 15 * 1024 * 1024;
const X_VIDEO_SOURCE_MAX_BYTES = 75 * 1024 * 1024;
const X_VIDEO_MAX_DURATION_SECONDS = 140;
const X_VIDEO_PROCESSING_MAX_MS = 120_000;
const X_APPEND_RETRY_DELAYS_MS = [250, 750] as const;

export type XFetch = typeof fetch;

export class XPublishError extends Error {
  code: string;
  status: number | null;
  retryable: boolean;
  deliveryUnknown: boolean;

  constructor(
    message: string,
    options: {
      code: string;
      status?: number | null;
      retryable?: boolean;
      deliveryUnknown?: boolean;
    },
  ) {
    super(message);
    this.name = "XPublishError";
    this.code = options.code;
    this.status = options.status ?? null;
    this.retryable = options.retryable === true;
    this.deliveryUnknown = options.deliveryUnknown === true;
  }
}

function readXError(payload: unknown, fallback: string) {
  const rec = asRecord(payload);
  const firstError = Array.isArray(rec.errors) ? asRecord(rec.errors[0]) : {};
  return (
    asString(rec.detail) ||
    asString(rec.title) ||
    asString(rec.error_description) ||
    asString(rec.error) ||
    asString(firstError.detail) ||
    asString(firstError.title) ||
    fallback
  );
}

function httpXError(status: number, payload: unknown, operation: "upload" | "create" | "delete") {
  // X ne fournit pas de clé d'idempotence à POST /2/tweets. Après un timeout
  // HTTP ou un 5xx, le fournisseur peut avoir créé le Post avant de perdre la
  // réponse : une nouvelle tentative automatique risquerait un doublon visible.
  const deliveryUnknown = operation === "create" && (status === 408 || status >= 500);
  const retryable = !deliveryUnknown && (status === 429 || status >= 500);
  const code = status === 401
    ? "x_auth_invalid"
    : status === 403
      ? "x_permission_denied"
      : status === 429
        ? "x_rate_limited"
        : `x_${operation}_failed`;
  return new XPublishError(
    readXError(payload, `X a refusé l'opération (${status}).`),
    { code, status, retryable, deliveryUnknown },
  );
}

async function readXResponsePayload(response: Response) {
  return await response.json().catch(() => ({}));
}

async function requestXMediaStep(params: {
  accessToken: string;
  url: string;
  method?: "GET" | "POST";
  body?: BodyInit;
  headers?: Record<string, string>;
  fetchImpl: XFetch;
}) {
  let response: Response;
  try {
    response = await params.fetchImpl(params.url, {
      method: params.method || "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        ...(params.headers || {}),
      },
      ...(params.body === undefined ? {} : { body: params.body }),
      cache: "no-store",
    });
  } catch (error) {
    throw new XPublishError(
      error instanceof Error ? error.message : "Téléversement du média X indisponible.",
      { code: "x_media_transport_failed", retryable: true },
    );
  }
  const payload = await readXResponsePayload(response);
  if (!response.ok) throw httpXError(response.status, payload, "upload");
  return payload;
}

function getXMediaData(payload: unknown) {
  return asRecord(asRecord(payload).data);
}

function getXMediaId(payload: unknown) {
  const data = getXMediaData(payload);
  const mediaId =
    (typeof data.id === "string" ? data.id : "") ||
    (typeof data.media_id_string === "string" ? data.media_id_string : "");
  // media_key (par exemple `13_123...`) n'est pas un media_id et ne peut pas
  // être transmis dans media.media_ids lors de la création du Post.
  return /^\d{1,19}$/.test(mediaId) ? mediaId : "";
}

function getXProcessingInfo(payload: unknown) {
  return asRecord(getXMediaData(payload).processing_info);
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
  const merged = new Uint8Array(left.byteLength + right.byteLength);
  merged.set(left, 0);
  merged.set(right, left.byteLength);
  return merged;
}

async function appendXMediaChunk(params: {
  accessToken: string;
  mediaId: string;
  segmentIndex: number;
  bytes: Uint8Array;
  mimeType: string;
  fileExtension: "gif" | "mp4";
  fetchImpl: XFetch;
}) {
  for (let attempt = 0; ; attempt += 1) {
    const form = new FormData();
    form.set("segment_index", String(params.segmentIndex));
    const ownedBytes = Uint8Array.from(params.bytes);
    form.set(
      "media",
      new Blob([ownedBytes.buffer], { type: params.mimeType }),
      `segment-${params.segmentIndex}.${params.fileExtension}`,
    );
    try {
      await requestXMediaStep({
        accessToken: params.accessToken,
        url: `${X_API_ORIGIN}/2/media/upload/${encodeURIComponent(params.mediaId)}/append`,
        body: form,
        fetchImpl: params.fetchImpl,
      });
      return;
    } catch (error) {
      const xError = error instanceof XPublishError ? error : null;
      const retryDelay = X_APPEND_RETRY_DELAYS_MS[attempt];
      // X documente explicitement la reprise d'un segment échoué. Réenvoyer le
      // même segment_index est sûr et n'entraîne jamais une seconde publication.
      const safelyRetryableSegment =
        xError?.code === "x_media_transport_failed" ||
        (typeof xError?.status === "number" && xError.status >= 500);
      if (!safelyRetryableSegment || retryDelay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}

async function uploadXChunkedBytes(params: {
  accessToken: string;
  bytes: Uint8Array;
  mimeType: "image/gif";
  mediaCategory: "tweet_gif";
  fileExtension: "gif";
  fetchImpl: XFetch;
  maxProcessingWaitMs?: number;
}) {
  const initPayload = await requestXMediaStep({
    accessToken: params.accessToken,
    url: `${X_API_ORIGIN}/2/media/upload/initialize`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: params.mimeType,
      total_bytes: params.bytes.byteLength,
      media_category: params.mediaCategory,
    }),
    fetchImpl: params.fetchImpl,
  });
  const mediaId = getXMediaId(initPayload);
  if (!mediaId) {
    throw new XPublishError("X n'a pas initialisé le téléversement du média.", {
      code: "x_media_id_missing",
    });
  }

  let segmentIndex = 0;
  for (let offset = 0; offset < params.bytes.byteLength; offset += X_MEDIA_CHUNK_BYTES) {
    await appendXMediaChunk({
      accessToken: params.accessToken,
      mediaId,
      segmentIndex,
      bytes: params.bytes.slice(offset, offset + X_MEDIA_CHUNK_BYTES),
      mimeType: params.mimeType,
      fileExtension: params.fileExtension,
      fetchImpl: params.fetchImpl,
    });
    segmentIndex += 1;
  }

  const finalizePayload = await requestXMediaStep({
    accessToken: params.accessToken,
    url: `${X_API_ORIGIN}/2/media/upload/${encodeURIComponent(mediaId)}/finalize`,
    fetchImpl: params.fetchImpl,
  });
  await waitForXMediaProcessing({
    accessToken: params.accessToken,
    mediaId,
    initialPayload: finalizePayload,
    fetchImpl: params.fetchImpl,
    maxWaitMs: params.maxProcessingWaitMs,
  });
  return {
    mediaId,
    mediaKey: asString(getXMediaData(finalizePayload).media_key) || null,
    expiresAfterSeconds:
      Number(getXMediaData(finalizePayload).expires_after_secs || 0) || null,
  };
}

async function waitForXMediaProcessing(params: {
  accessToken: string;
  mediaId: string;
  initialPayload: unknown;
  fetchImpl: XFetch;
  maxWaitMs?: number;
}) {
  let processing = getXProcessingInfo(params.initialPayload);
  if (!asString(processing.state)) return;
  const deadline = Date.now() + Math.max(1_000, params.maxWaitMs || X_VIDEO_PROCESSING_MAX_MS);

  while (true) {
    const state = (asString(processing.state) || "").toLowerCase();
    if (state === "succeeded") return;
    if (state === "failed") {
      const error = asRecord(processing.error);
      throw new XPublishError(
        asString(error.message) || asString(error.name) || "X n'a pas pu traiter le média.",
        { code: "x_media_processing_failed", retryable: false },
      );
    }
    if (Date.now() >= deadline) {
      throw new XPublishError(
        "Le média est toujours en cours de traitement par X. Réessayez dans quelques instants.",
        { code: "x_media_processing_timeout", retryable: true },
      );
    }

    const requestedDelay = Number(processing.check_after_secs || 1);
    const delayMs = Math.min(
      5_000,
      Math.max(500, Number.isFinite(requestedDelay) ? requestedDelay * 1_000 : 1_000),
      Math.max(0, deadline - Date.now()),
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const statusUrl = new URL(`${X_API_ORIGIN}/2/media/upload`);
    statusUrl.searchParams.set("command", "STATUS");
    statusUrl.searchParams.set("media_id", params.mediaId);
    const statusPayload = await requestXMediaStep({
      accessToken: params.accessToken,
      url: statusUrl.toString(),
      method: "GET",
      fetchImpl: params.fetchImpl,
    });
    processing = getXProcessingInfo(statusPayload);
    if (!asString(processing.state)) return;
  }
}

export async function uploadXImage(params: {
  accessToken: string;
  bytes: Uint8Array;
  mimeType: string;
  animatedGif?: boolean;
  fetchImpl?: XFetch;
  maxProcessingWaitMs?: number;
}) {
  const fetchImpl = params.fetchImpl || fetch;
  const mimeType = String(params.mimeType || "").trim().toLowerCase();
  const isGif = mimeType === "image/gif";
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!allowed.has(mimeType)) {
    throw new XPublishError("Format d'image non pris en charge par X.", {
      code: "x_image_format_invalid",
    });
  }
  if (params.animatedGif === true && !isGif) {
    throw new XPublishError("Le média signalé comme GIF doit être au format image/gif.", {
      code: "x_image_format_invalid",
    });
  }
  const maxBytes = isGif ? X_GIF_SOURCE_MAX_BYTES : X_IMAGE_SOURCE_MAX_BYTES;
  if (!params.bytes.byteLength || params.bytes.byteLength > maxBytes) {
    throw new XPublishError(
      isGif ? "Le GIF dépasse la limite X de 15 Mo." : "L'image dépasse la limite X de 5 Mo.",
      { code: "x_image_size_invalid" },
    );
  }

  // Le simple upload v2 est réservé aux images. Un GIF animé doit emprunter
  // le chemin asynchrone INIT / APPEND / FINALIZE / STATUS avec tweet_gif.
  if (isGif) {
    return await uploadXChunkedBytes({
      accessToken: params.accessToken,
      bytes: params.bytes,
      mimeType: "image/gif",
      mediaCategory: "tweet_gif",
      fileExtension: "gif",
      fetchImpl,
      maxProcessingWaitMs: params.maxProcessingWaitMs,
    });
  }

  let response: Response;
  try {
    response = await fetchImpl(`${X_API_ORIGIN}/2/media/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        media: Buffer.from(params.bytes).toString("base64"),
        media_category: "tweet_image",
        media_type: mimeType,
      }),
      cache: "no-store",
    });
  } catch (error) {
    throw new XPublishError(
      error instanceof Error ? error.message : "Téléversement X indisponible.",
      { code: "x_media_transport_failed", retryable: true },
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpXError(response.status, payload, "upload");
  const data = getXMediaData(payload);
  const mediaId = getXMediaId(payload);
  if (!mediaId) {
    throw new XPublishError("X n'a pas renvoyé l'identifiant du média.", {
      code: "x_media_id_missing",
      retryable: false,
    });
  }
  await waitForXMediaProcessing({
    accessToken: params.accessToken,
    mediaId,
    initialPayload: payload,
    fetchImpl,
    maxWaitMs: params.maxProcessingWaitMs,
  });
  return {
    mediaId,
    mediaKey: asString(data.media_key) || null,
    expiresAfterSeconds: Number(data.expires_after_secs || 0) || null,
  };
}

/**
 * Upload vidéo X v2 sans charger tout le MP4 en mémoire. La source préparée
 * par iNrCy est lue en flux puis envoyée en segments de 4 Mo.
 */
export async function uploadXVideoFromUrl(params: {
  accessToken: string;
  sourceUrl: string;
  totalBytes: number;
  mimeType?: string | null;
  durationSeconds?: number | null;
  fetchImpl?: XFetch;
  maxProcessingWaitMs?: number;
}) {
  const fetchImpl = params.fetchImpl || fetch;
  const sourceUrl = String(params.sourceUrl || "").trim();
  if (!/^https?:\/\//i.test(sourceUrl)) {
    throw new XPublishError("La source vidéo X est invalide.", {
      code: "x_video_source_invalid",
    });
  }
  const totalBytes = Math.trunc(Number(params.totalBytes || 0));
  if (totalBytes <= 0 || totalBytes > X_VIDEO_SOURCE_MAX_BYTES) {
    throw new XPublishError("La vidéo X doit être comprise dans la limite iNrCy de 75 Mo.", {
      code: "x_video_size_invalid",
    });
  }
  const mimeType = String(params.mimeType || "video/mp4")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (mimeType !== "video/mp4") {
    throw new XPublishError("La vidéo X doit être au format MP4.", {
      code: "x_video_format_invalid",
    });
  }
  const duration = Number(params.durationSeconds || 0);
  if (Number.isFinite(duration) && duration > 0 && duration < 0.5) {
    throw new XPublishError("La vidéo X doit durer au moins 0,5 seconde.", {
      code: "x_video_duration_invalid",
    });
  }
  if (Number.isFinite(duration) && duration > X_VIDEO_MAX_DURATION_SECONDS) {
    throw new XPublishError(
      `La vidéo X ne doit pas dépasser ${X_VIDEO_MAX_DURATION_SECONDS} secondes.`,
      { code: "x_video_duration_invalid" },
    );
  }

  const initPayload = await requestXMediaStep({
    accessToken: params.accessToken,
    url: `${X_API_ORIGIN}/2/media/upload/initialize`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: mimeType,
      total_bytes: totalBytes,
      media_category: "tweet_video",
    }),
    fetchImpl,
  });
  const mediaId = getXMediaId(initPayload);
  if (!mediaId) {
    throw new XPublishError("X n'a pas initialisé le téléversement vidéo.", {
      code: "x_media_id_missing",
    });
  }

  let sourceResponse: Response;
  try {
    sourceResponse = await fetchImpl(sourceUrl, { cache: "no-store" });
  } catch (error) {
    throw new XPublishError(
      error instanceof Error ? error.message : "La vidéo préparée est indisponible.",
      { code: "x_video_source_unavailable", retryable: true },
    );
  }
  if (!sourceResponse.ok || !sourceResponse.body) {
    throw new XPublishError(
      `La vidéo préparée est indisponible${sourceResponse.status ? ` (${sourceResponse.status})` : ""}.`,
      { code: "x_video_source_unavailable", retryable: true },
    );
  }

  const reader = sourceResponse.body.getReader();
  let buffered = new Uint8Array(0);
  let uploadedBytes = 0;
  let segmentIndex = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (value?.byteLength) buffered = concatBytes(buffered, value);
    if (uploadedBytes + buffered.byteLength > totalBytes) {
      await reader.cancel().catch(() => undefined);
      throw new XPublishError(
        "La vidéo X téléchargée ne correspond pas à la taille préparée. Aucun post n'a été créé.",
        { code: "x_video_source_size_mismatch", retryable: true },
      );
    }
    while (buffered.byteLength >= X_MEDIA_CHUNK_BYTES) {
      const chunk = buffered.slice(0, X_MEDIA_CHUNK_BYTES);
      buffered = buffered.slice(X_MEDIA_CHUNK_BYTES);
      await appendXMediaChunk({
        accessToken: params.accessToken,
        mediaId,
        segmentIndex,
        bytes: chunk,
        mimeType,
        fileExtension: "mp4",
        fetchImpl,
      });
      uploadedBytes += chunk.byteLength;
      segmentIndex += 1;
    }
    if (done) break;
    if (uploadedBytes + buffered.byteLength > X_VIDEO_SOURCE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new XPublishError("La vidéo X dépasse la limite iNrCy de 75 Mo.", {
        code: "x_video_size_invalid",
      });
    }
  }
  if (buffered.byteLength) {
    await appendXMediaChunk({
      accessToken: params.accessToken,
      mediaId,
      segmentIndex,
      bytes: buffered,
      mimeType,
      fileExtension: "mp4",
      fetchImpl,
    });
    uploadedBytes += buffered.byteLength;
  }
  if (uploadedBytes !== totalBytes) {
    throw new XPublishError(
      "La vidéo X téléchargée est incomplète. Aucun post n'a été créé.",
      { code: "x_video_source_size_mismatch", retryable: true },
    );
  }

  const finalizePayload = await requestXMediaStep({
    accessToken: params.accessToken,
    url: `${X_API_ORIGIN}/2/media/upload/${encodeURIComponent(mediaId)}/finalize`,
    fetchImpl,
  });
  await waitForXMediaProcessing({
    accessToken: params.accessToken,
    mediaId,
    initialPayload: finalizePayload,
    fetchImpl,
    maxWaitMs: params.maxProcessingWaitMs,
  });
  return {
    mediaId,
    mediaKey: asString(getXMediaData(finalizePayload).media_key) || null,
    uploadedBytes,
  };
}

export async function createXPost(params: {
  accessToken: string;
  username?: string | null;
  text?: string | null;
  mediaIds?: string[];
  madeWithAi?: boolean;
  fetchImpl?: XFetch;
}) {
  const mediaIds = [...new Set((params.mediaIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (mediaIds.some((mediaId) => !/^\d{1,19}$/.test(mediaId))) {
    throw new XPublishError("Identifiant de média X invalide.", {
      code: "x_media_id_invalid",
    });
  }
  if (mediaIds.length > X_POST_MAX_IMAGES) {
    throw new XPublishError(`X accepte au maximum ${X_POST_MAX_IMAGES} photos.`, {
      code: "x_media_count_invalid",
    });
  }
  const text = String(params.text || "").trim();
  if (text) {
    // Dernière barrière avant POST /2/tweets. Elle reste volontairement
    // explicite ici même si validateXPostText applique déjà la même politique :
    // une régression du compteur ou d'un composeur ne doit jamais laisser une
    // URL atteindre l'API facturée de X.
    const urlValidation = validateXUrlFreeText(text);
    if (!urlValidation.valid) {
      throw new XPublishError(urlValidation.error, {
        code: urlValidation.code,
        retryable: false,
      });
    }
    const validation = validateXPostText(text);
    if (!validation.valid) {
      throw new XPublishError(validation.error || "Le texte X est invalide.", {
        code: validation.code || "x_text_invalid",
      });
    }
  } else if (!mediaIds.length) {
    throw new XPublishError("Ajoutez un texte ou un média pour X.", {
      code: "x_content_required",
    });
  }

  const body: Record<string, unknown> = {};
  if (text) body.text = text;
  if (mediaIds.length) body.media = { media_ids: mediaIds };
  if (params.madeWithAi === true && mediaIds.length) body.made_with_ai = true;

  let response: Response;
  try {
    response = await (params.fetchImpl || fetch)(`${X_API_ORIGIN}/2/tweets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    // Le serveur X a peut-être créé le post avant la coupure réseau. Ne jamais
    // retenter automatiquement : un doublon serait visible et facturé.
    throw new XPublishError(
      error instanceof Error ? error.message : "Statut de publication X inconnu.",
      {
        code: "provider_status_unknown",
        retryable: false,
        deliveryUnknown: true,
      },
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpXError(response.status, payload, "create");
  const data = asRecord(asRecord(payload).data);
  const postId = typeof data.id === "string" && /^\d{1,19}$/.test(data.id)
    ? data.id
    : "";
  if (!postId) {
    throw new XPublishError("X a répondu sans identifiant de publication.", {
      code: "provider_status_unknown",
      retryable: false,
      deliveryUnknown: true,
    });
  }
  return {
    postId,
    text: asString(data.text) || text,
    url: getXPostUrl(params.username, postId),
    raw: payload,
  };
}

export async function deleteXPost(params: {
  accessToken: string;
  postId: string;
  fetchImpl?: XFetch;
}) {
  const postId = String(params.postId || "").trim();
  if (!/^\d{1,24}$/.test(postId)) {
    throw new XPublishError("Identifiant de publication X invalide.", {
      code: "x_post_id_invalid",
    });
  }
  let response: Response;
  try {
    response = await (params.fetchImpl || fetch)(`${X_API_ORIGIN}/2/tweets/${postId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${params.accessToken}` },
      cache: "no-store",
    });
  } catch (error) {
    throw new XPublishError(
      error instanceof Error ? error.message : "Suppression X indisponible.",
      { code: "x_delete_transport_failed", retryable: true },
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpXError(response.status, payload, "delete");
  const deleted = asRecord(asRecord(payload).data).deleted === true;
  if (!deleted) {
    throw new XPublishError("X n'a pas confirmé la suppression.", {
      code: "x_delete_unconfirmed",
    });
  }
  return { deleted: true as const, raw: payload };
}
