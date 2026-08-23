import { buildMetaGraphUrl } from "@/lib/metaGraphApi";
import {
  isMetaAuthorizationError,
  isMetaRateLimitError,
} from "@/lib/metaGraphErrorClassification";

type PublishOk = {
  ok: true;
  /** Published Instagram media id. For carousels, this is the parent media id. */
  mediaId: string;
  mediaType: "IMAGE" | "CAROUSEL_ALBUM" | "VIDEO" | "REELS";
  parentMediaId?: string | null;
  childContainerIds?: string[];
  childMediaIds?: string[];
  diagnostics?: {
    containerId?: string;
    childContainerIds?: string[];
    childMediaIds?: string[];
    detailsResponse?: any;
    createResponse?: any;
    childCreateResponses?: any[];
    statusChecks?: any[];
    childStatusChecks?: Array<{ containerId: string; checks: any[] }>;
    publishResponse?: any;
  };
};

type PublishKo = {
  ok: false;
  error: string;
  code?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  diagnostics?: any;
};

export type InstagramPublishResult = PublishOk | PublishKo;

export type InstagramTokenCandidate = {
  source: string;
  accessToken: string;
};

type InstagramPublishAttempt = {
  source: string;
  ok: boolean;
  error?: string | null;
  graphErrors?: Array<{
    message: string | null;
    code: number | null;
    subcode: number | null;
    type: string | null;
    fbtrace_id: string | null;
  }>;
};

type WaitForContainerReadyResult =
  | { ok: true; checks: any[] }
  | { ok: false; error: string; checks: any[] };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function normalizeTokenCandidates(accessToken: string, tokenCandidates?: InstagramTokenCandidate[]): InstagramTokenCandidate[] {
  const seen = new Set<string>();
  const candidates: InstagramTokenCandidate[] = [];

  const push = (source: string, token: string) => {
    const clean = String(token || "").trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    candidates.push({ source: source || `token_${candidates.length + 1}`, accessToken: clean });
  };

  push("primary", accessToken);
  for (const candidate of tokenCandidates || []) {
    push(candidate.source, candidate.accessToken);
  }

  return candidates;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function extractGraphErrors(value: unknown, depth = 0): InstagramPublishAttempt["graphErrors"] {
  if (depth > 6 || !value || typeof value !== "object") return [];
  const rec = asRecord(value);
  const errors: NonNullable<InstagramPublishAttempt["graphErrors"]> = [];
  const err = asRecord(rec["error"]);
  if (Object.keys(err).length) {
    errors.push({
      message: String(err["message"] || "").trim() || null,
      code: typeof err["code"] === "number" ? err["code"] : Number(err["code"] || 0) || null,
      subcode: typeof err["error_subcode"] === "number" ? err["error_subcode"] : Number(err["error_subcode"] || 0) || null,
      type: String(err["type"] || "").trim() || null,
      fbtrace_id: String(err["fbtrace_id"] || "").trim() || null,
    });
  }

  for (const child of Object.values(rec)) {
    if (!child || typeof child !== "object") continue;
    if (Array.isArray(child)) {
      for (const item of child) errors.push(...(extractGraphErrors(item, depth + 1) || []));
    } else {
      errors.push(...(extractGraphErrors(child, depth + 1) || []));
    }
  }

  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.message}|${error.code}|${error.subcode}|${error.type}|${error.fbtrace_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isInstagramAuthorizationErrorResult(result: InstagramPublishResult): boolean {
  if (result.ok) return false;
  const graphErrors = extractGraphErrors(result.diagnostics) || [];
  return [
    { message: result.error },
    ...graphErrors.map((error) => ({
      message: error.message,
      type: error.type,
      code: error.code,
      subcode: error.subcode,
    })),
  ].some(isMetaAuthorizationError);
}

export function isInstagramRateLimitErrorResult(result: InstagramPublishResult): boolean {
  if (result.ok) return false;
  if (result.code === "instagram_rate_limited") return true;
  const graphErrors = extractGraphErrors(result.diagnostics) || [];
  return [
    { message: result.error },
    ...graphErrors.map((error) => ({
      message: error.message,
      type: error.type,
      code: error.code,
      subcode: error.subcode,
    })),
  ].some(isMetaRateLimitError);
}

function withTokenFallbackDiagnostics<T extends InstagramPublishResult>(
  result: T,
  attempts: InstagramPublishAttempt[],
): T {
  if (result.ok) {
    return {
      ...result,
      diagnostics: {
        ...(result.diagnostics || {}),
        tokenFallbackAttempts: attempts,
      },
    } as T;
  }
  return {
    ...result,
    diagnostics: {
      ...(result.diagnostics || {}),
      tokenFallbackAttempts: attempts,
    },
  } as T;
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

function buildInstagramGraphFailure(params: {
  fallbackMessage: string;
  response: unknown;
  httpStatus?: number;
  diagnostics: unknown;
}): PublishKo {
  const response = asRecord(params.response);
  const graphError = asRecord(response["error"]);
  const failure: PublishKo = {
    ok: false,
    error:
      String(graphError["message"] || "").trim() || params.fallbackMessage,
    diagnostics: params.diagnostics,
  };
  const rateLimited = isMetaRateLimitError({
    message: graphError["message"],
    type: graphError["type"],
    code: graphError["code"],
    subcode: graphError["error_subcode"],
    httpStatus: params.httpStatus,
  });
  return rateLimited
    ? {
        ...failure,
        code: "instagram_rate_limited",
        retryable: true,
        retryAfterMs: 60_000,
      }
    : failure;
}

async function waitForContainerReady(params: {
  containerId: string;
  accessToken: string;
  maxAttempts?: number;
  initialDelayMs?: number;
}): Promise<WaitForContainerReadyResult> {
  const {
    containerId,
    accessToken,
    maxAttempts = 10,
    initialDelayMs = 1500,
  } = params;

  const checks: any[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(attempt === 1 ? initialDelayMs : initialDelayMs * attempt);

    const qs = new URLSearchParams({
      fields: "status,status_code",
      access_token: accessToken,
    });

    const url = `${buildMetaGraphUrl(encodeURIComponent(containerId))}?${qs.toString()}`;
    const { res, json } = await fetchJson(url, { method: "GET" });

    const row = {
      attempt,
      ok: res.ok,
      httpStatus: res.status,
      status: json?.status ?? null,
      status_code: json?.status_code ?? null,
      raw: json,
    };
    checks.push(row);

    if (!res.ok) {
      return {
        ok: false,
        error: json?.error?.message || "Impossible de vérifier le statut du container Instagram",
        checks,
      };
    }

    const statusCode = String(json?.status_code || "").toUpperCase();
    const status = String(json?.status || "").toUpperCase();

    if (statusCode === "FINISHED" || status === "FINISHED") {
      return { ok: true, checks };
    }

    if (statusCode === "ERROR" || status === "ERROR" || json?.error) {
      return {
        ok: false,
        error: json?.error?.message || "Le container Instagram est en erreur",
        checks,
      };
    }
  }

  return {
    ok: false,
    error: "Instagram met trop de temps à répondre. Merci de réessayer.",
    checks,
  };
}

async function createInstagramImageContainer(params: {
  igUserId: string;
  accessToken: string;
  imageUrl: string;
  caption?: string;
  isCarouselItem?: boolean;
}) {
  const createParams = new URLSearchParams({
    image_url: params.imageUrl,
    access_token: params.accessToken,
  });

  if (params.caption) createParams.set("caption", params.caption);
  if (params.isCarouselItem) createParams.set("is_carousel_item", "true");

  const createUrl = `${buildMetaGraphUrl(`${encodeURIComponent(params.igUserId)}/media`)}?${createParams.toString()}`;
  return fetchJson(createUrl, { method: "POST" });
}

async function publishInstagramContainer(params: {
  igUserId: string;
  accessToken: string;
  creationId: string;
}) {
  const publishParams = new URLSearchParams({
    creation_id: params.creationId,
    access_token: params.accessToken,
  });

  const publishUrl = `${buildMetaGraphUrl(`${encodeURIComponent(params.igUserId)}/media_publish`)}?${publishParams.toString()}`;
  return fetchJson(publishUrl, { method: "POST" });
}

async function getInstagramMediaDetails(params: {
  mediaId: string;
  accessToken: string;
}) {
  const qs = new URLSearchParams({
    fields: "id,media_type,media_product_type,permalink,children{id,media_type,permalink}",
    access_token: params.accessToken,
  });
  const url = `${buildMetaGraphUrl(encodeURIComponent(params.mediaId))}?${qs.toString()}`;
  return fetchJson(url, { method: "GET" });
}

/**
 * Publish a single-photo post to an Instagram Business/Creator account using Instagram Graph API.
 */
export async function instagramPublishPhoto(params: {
  igUserId: string;
  accessToken: string;
  caption: string;
  imageUrl: string;
}): Promise<InstagramPublishResult> {
  const { igUserId, accessToken, caption, imageUrl } = params;

  try {
    if (!igUserId) return { ok: false, error: "Certaines informations nécessaires à la publication Instagram sont manquantes." };
    if (!accessToken) return { ok: false, error: "La connexion Instagram a expiré. Merci de reconnecter votre compte." };
    if (!imageUrl) return { ok: false, error: "Ajoute au moins une image pour publier sur Instagram." };

    const { res: createRes, json: createJson } = await createInstagramImageContainer({
      igUserId,
      accessToken,
      caption,
      imageUrl,
    });

    if (!createRes.ok) {
      return {
        ok: false,
        error: createJson?.error?.message || "Impossible de préparer la publication Instagram.",
        diagnostics: { createResponse: createJson },
      };
    }

    const containerId = String(createJson?.id || "");
    if (!containerId) {
      return {
        ok: false,
        error: "Instagram media creation returned no id",
        diagnostics: { createResponse: createJson },
      };
    }

    const waitResult = await waitForContainerReady({
      containerId,
      accessToken,
      maxAttempts: 10,
      initialDelayMs: 1200,
    });

    if (!waitResult.ok) {
      return {
        ok: false,
        error: ("error" in waitResult ? waitResult.error : "Instagram met trop de temps à répondre."),
        diagnostics: {
          containerId,
          createResponse: createJson,
          statusChecks: waitResult.checks,
        },
      };
    }

    const { res: publishRes, json: publishJson } = await publishInstagramContainer({
      igUserId,
      accessToken,
      creationId: containerId,
    });

    if (!publishRes.ok) {
      return buildInstagramGraphFailure({
        fallbackMessage: "Impossible de publier sur Instagram pour le moment.",
        response: publishJson,
        httpStatus: publishRes.status,
        diagnostics: {
          containerId,
          createResponse: createJson,
          statusChecks: waitResult.checks,
          publishResponse: publishJson,
        },
      });
    }

    const mediaId = String(publishJson?.id || "");
    if (!mediaId) {
      return {
        ok: false,
        error: "La publication Instagram n’a pas pu être finalisée.",
        diagnostics: {
          containerId,
          createResponse: createJson,
          statusChecks: waitResult.checks,
          publishResponse: publishJson,
        },
      };
    }

    return {
      ok: true,
      mediaId,
      mediaType: "IMAGE",
      parentMediaId: mediaId,
      childContainerIds: [],
      childMediaIds: [],
      diagnostics: {
        containerId,
        createResponse: createJson,
        statusChecks: waitResult.checks,
        publishResponse: publishJson,
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Une erreur est survenue lors de la publication Instagram." };
  }
}


async function createInstagramVideoContainer(params: {
  igUserId: string;
  accessToken: string;
  videoUrl: string;
  caption?: string;
}) {
  const createParams = new URLSearchParams({
    media_type: "REELS",
    video_url: params.videoUrl,
    access_token: params.accessToken,
  });

  if (params.caption) createParams.set("caption", params.caption);
  createParams.set("share_to_feed", "true");

  const createUrl = `${buildMetaGraphUrl(`${encodeURIComponent(params.igUserId)}/media`)}?${createParams.toString()}`;
  return fetchJson(createUrl, { method: "POST" });
}

/**
 * Publish a short video as an Instagram Reel using Instagram Graph API.
 * The video URL must be public and reachable by Meta servers.
 */
export async function instagramPublishVideo(params: {
  igUserId: string;
  accessToken: string;
  caption: string;
  videoUrl: string;
}): Promise<InstagramPublishResult> {
  const { igUserId, accessToken, caption, videoUrl } = params;

  try {
    if (!igUserId) return { ok: false, error: "Certaines informations nécessaires à la publication Instagram sont manquantes." };
    if (!accessToken) return { ok: false, error: "La connexion Instagram a expiré. Merci de reconnecter votre compte." };
    if (!videoUrl?.trim()) return { ok: false, error: "Ajoutez une vidéo avant de publier sur Instagram." };

    const { res: createRes, json: createJson } = await createInstagramVideoContainer({
      igUserId,
      accessToken,
      caption,
      videoUrl,
    });

    if (!createRes.ok) {
      return {
        ok: false,
        error: createJson?.error?.message || "Impossible de préparer la vidéo Instagram.",
        diagnostics: { createResponse: createJson },
      };
    }

    const containerId = String(createJson?.id || "");
    if (!containerId) {
      return {
        ok: false,
        error: "Instagram video creation returned no id",
        diagnostics: { createResponse: createJson },
      };
    }

    const waitResult = await waitForContainerReady({
      containerId,
      accessToken,
      maxAttempts: 14,
      initialDelayMs: 1800,
    });

    if (!waitResult.ok) {
      return {
        ok: false,
        error: ("error" in waitResult ? waitResult.error : "Instagram met trop de temps à traiter la vidéo."),
        diagnostics: {
          containerId,
          createResponse: createJson,
          statusChecks: waitResult.checks,
        },
      };
    }

    const { res: publishRes, json: publishJson } = await publishInstagramContainer({
      igUserId,
      accessToken,
      creationId: containerId,
    });

    if (!publishRes.ok) {
      return buildInstagramGraphFailure({
        fallbackMessage: "Impossible de publier la vidéo Instagram pour le moment.",
        response: publishJson,
        httpStatus: publishRes.status,
        diagnostics: {
          containerId,
          createResponse: createJson,
          statusChecks: waitResult.checks,
          publishResponse: publishJson,
        },
      });
    }

    const mediaId = String(publishJson?.id || "");
    if (!mediaId) {
      return {
        ok: false,
        error: "La vidéo Instagram n’a pas pu être finalisée.",
        diagnostics: {
          containerId,
          createResponse: createJson,
          statusChecks: waitResult.checks,
          publishResponse: publishJson,
        },
      };
    }

    return {
      ok: true,
      mediaId,
      mediaType: "REELS",
      parentMediaId: mediaId,
      childContainerIds: [],
      childMediaIds: [],
      diagnostics: {
        containerId,
        createResponse: createJson,
        statusChecks: waitResult.checks,
        publishResponse: publishJson,
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Une erreur est survenue lors de la publication vidéo Instagram." };
  }
}

export async function instagramPublishCarousel(params: {
  igUserId: string;
  accessToken: string;
  caption: string;
  imageUrls: string[];
}): Promise<InstagramPublishResult> {
  const { igUserId, accessToken, caption } = params;
  const imageUrls = (params.imageUrls || []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 10);

  try {
    if (!igUserId) return { ok: false, error: "Certaines informations nécessaires à la publication Instagram sont manquantes." };
    if (!accessToken) return { ok: false, error: "La connexion Instagram a expiré. Merci de reconnecter votre compte." };
    if (imageUrls.length === 0) return { ok: false, error: "Ajoute au moins une image pour publier sur Instagram." };
    if (imageUrls.length === 1) {
      return instagramPublishPhoto({ igUserId, accessToken, caption, imageUrl: imageUrls[0] });
    }

    const childContainerIds: string[] = [];
    const childCreateResponses: any[] = [];
    const childStatusChecks: Array<{ containerId: string; checks: any[] }> = [];

    for (const imageUrl of imageUrls) {
      const { res: childRes, json: childJson } = await createInstagramImageContainer({
        igUserId,
        accessToken,
        imageUrl,
        isCarouselItem: true,
      });

      childCreateResponses.push(childJson);

      if (!childRes.ok) {
        return {
          ok: false,
          error: childJson?.error?.message || "Impossible de préparer le carrousel Instagram.",
          diagnostics: { childCreateResponses },
        };
      }

      const childId = String(childJson?.id || "");
      if (!childId) {
        return {
          ok: false,
          error: "Instagram carousel child creation returned no id",
          diagnostics: { childCreateResponses },
        };
      }

      childContainerIds.push(childId);
    }

    for (const containerId of childContainerIds) {
      const waitResult = await waitForContainerReady({
        containerId,
        accessToken,
        maxAttempts: 10,
        initialDelayMs: 1200,
      });

      childStatusChecks.push({ containerId, checks: waitResult.checks });
      if (!waitResult.ok) {
        return {
          ok: false,
          error: ("error" in waitResult ? waitResult.error : "Instagram met trop de temps à répondre."),
          diagnostics: { childContainerIds, childCreateResponses, childStatusChecks },
        };
      }
    }

    const createParams = new URLSearchParams({
      media_type: "CAROUSEL",
      children: childContainerIds.join(","),
      caption: caption || "",
      access_token: accessToken,
    });

    const createUrl = `${buildMetaGraphUrl(`${encodeURIComponent(igUserId)}/media`)}?${createParams.toString()}`;
    const { res: createRes, json: createJson } = await fetchJson(createUrl, { method: "POST" });

    if (!createRes.ok) {
      return {
        ok: false,
        error: createJson?.error?.message || "Impossible de créer le carrousel Instagram.",
        diagnostics: { childContainerIds, childCreateResponses, childStatusChecks, createResponse: createJson },
      };
    }

    const containerId = String(createJson?.id || "");
    if (!containerId) {
      return {
        ok: false,
        error: "Instagram carousel creation returned no id",
        diagnostics: { childContainerIds, childCreateResponses, childStatusChecks, createResponse: createJson },
      };
    }

    const waitResult = await waitForContainerReady({
      containerId,
      accessToken,
      maxAttempts: 10,
      initialDelayMs: 1200,
    });

    if (!waitResult.ok) {
      return {
        ok: false,
        error: ("error" in waitResult ? waitResult.error : "Instagram met trop de temps à répondre."),
        diagnostics: {
          containerId,
          childContainerIds,
          childCreateResponses,
          childStatusChecks,
          createResponse: createJson,
          statusChecks: waitResult.checks,
        },
      };
    }

    const { res: publishRes, json: publishJson } = await publishInstagramContainer({
      igUserId,
      accessToken,
      creationId: containerId,
    });

    if (!publishRes.ok) {
      return buildInstagramGraphFailure({
        fallbackMessage: "Impossible de publier le carrousel Instagram pour le moment.",
        response: publishJson,
        httpStatus: publishRes.status,
        diagnostics: {
          containerId,
          childContainerIds,
          childCreateResponses,
          childStatusChecks,
          createResponse: createJson,
          statusChecks: waitResult.checks,
          publishResponse: publishJson,
        },
      });
    }

    const mediaId = String(publishJson?.id || "");
    if (!mediaId) {
      return {
        ok: false,
        error: "La publication Instagram n’a pas pu être finalisée.",
        diagnostics: {
          containerId,
          childContainerIds,
          childCreateResponses,
          childStatusChecks,
          createResponse: createJson,
          statusChecks: waitResult.checks,
          publishResponse: publishJson,
        },
      };
    }

    const { res: detailsRes, json: detailsJson } = await getInstagramMediaDetails({ mediaId, accessToken });
    const childMediaIds = Array.isArray(detailsJson?.children?.data)
      ? detailsJson.children.data.map((child: any) => String(child?.id || "").trim()).filter(Boolean)
      : [];

    return {
      ok: true,
      mediaId,
      mediaType: "CAROUSEL_ALBUM",
      parentMediaId: mediaId,
      childContainerIds,
      childMediaIds,
      diagnostics: {
        containerId,
        childContainerIds,
        childMediaIds,
        detailsResponse: detailsRes.ok ? detailsJson : { ok: false, status: detailsRes.status, raw: detailsJson },
        childCreateResponses,
        childStatusChecks,
        createResponse: createJson,
        statusChecks: waitResult.checks,
        publishResponse: publishJson,
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Une erreur est survenue lors de la publication Instagram." };
  }
}


/**
 * Same Instagram publishing flow as instagramPublishPhoto, but retries with stored user/page tokens
 * when Meta returns an authorization/permission error. This prevents a stale or limited Page token
 * from blocking a valid Instagram connection.
 */
export async function instagramPublishPhotoWithTokenFallback(params: {
  igUserId: string;
  accessToken: string;
  tokenCandidates?: InstagramTokenCandidate[];
  caption: string;
  imageUrl: string;
}): Promise<InstagramPublishResult> {
  const candidates = normalizeTokenCandidates(params.accessToken, params.tokenCandidates);
  const attempts: InstagramPublishAttempt[] = [];
  let lastResult: InstagramPublishResult | null = null;

  for (const candidate of candidates) {
    const result = await instagramPublishPhoto({
      igUserId: params.igUserId,
      accessToken: candidate.accessToken,
      caption: params.caption,
      imageUrl: params.imageUrl,
    });

    attempts.push({
      source: candidate.source,
      ok: result.ok,
      error: result.ok ? null : result.error,
      graphErrors: result.ok ? [] : extractGraphErrors(result.diagnostics),
    });

    if (result.ok) return withTokenFallbackDiagnostics(result, attempts);
    lastResult = result;
    if (!isInstagramAuthorizationErrorResult(result)) break;
  }

  return withTokenFallbackDiagnostics(lastResult || { ok: false, error: "La connexion Instagram a expiré. Merci de reconnecter votre compte." }, attempts);
}

/**
 * Same Instagram carousel publishing flow, with authorization fallback across valid stored tokens.
 */
export async function instagramPublishCarouselWithTokenFallback(params: {
  igUserId: string;
  accessToken: string;
  tokenCandidates?: InstagramTokenCandidate[];
  caption: string;
  imageUrls: string[];
}): Promise<InstagramPublishResult> {
  const candidates = normalizeTokenCandidates(params.accessToken, params.tokenCandidates);
  const attempts: InstagramPublishAttempt[] = [];
  let lastResult: InstagramPublishResult | null = null;

  for (const candidate of candidates) {
    const result = await instagramPublishCarousel({
      igUserId: params.igUserId,
      accessToken: candidate.accessToken,
      caption: params.caption,
      imageUrls: params.imageUrls,
    });

    attempts.push({
      source: candidate.source,
      ok: result.ok,
      error: result.ok ? null : result.error,
      graphErrors: result.ok ? [] : extractGraphErrors(result.diagnostics),
    });

    if (result.ok) return withTokenFallbackDiagnostics(result, attempts);
    lastResult = result;
    if (!isInstagramAuthorizationErrorResult(result)) break;
  }

  return withTokenFallbackDiagnostics(lastResult || { ok: false, error: "La connexion Instagram a expiré. Merci de reconnecter votre compte." }, attempts);
}


/**
 * Same Instagram video publishing flow, with authorization fallback across valid stored tokens.
 */
export async function instagramPublishVideoWithTokenFallback(params: {
  igUserId: string;
  accessToken: string;
  tokenCandidates?: InstagramTokenCandidate[];
  caption: string;
  videoUrl: string;
}): Promise<InstagramPublishResult> {
  const candidates = normalizeTokenCandidates(params.accessToken, params.tokenCandidates);
  const attempts: InstagramPublishAttempt[] = [];
  let lastResult: InstagramPublishResult | null = null;

  for (const candidate of candidates) {
    const result = await instagramPublishVideo({
      igUserId: params.igUserId,
      accessToken: candidate.accessToken,
      caption: params.caption,
      videoUrl: params.videoUrl,
    });

    attempts.push({
      source: candidate.source,
      ok: result.ok,
      error: result.ok ? null : result.error,
      graphErrors: result.ok ? [] : extractGraphErrors(result.diagnostics),
    });

    if (result.ok) return withTokenFallbackDiagnostics(result, attempts);
    lastResult = result;
    if (!isInstagramAuthorizationErrorResult(result)) break;
  }

  return withTokenFallbackDiagnostics(lastResult || { ok: false, error: "La connexion Instagram a expiré. Merci de reconnecter votre compte." }, attempts);
}
