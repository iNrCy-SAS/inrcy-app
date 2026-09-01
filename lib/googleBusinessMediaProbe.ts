import {
  GOOGLE_BUSINESS_IMAGE_OFFICIAL_MAX_BYTES,
  GOOGLE_BUSINESS_IMAGE_MIN_BYTES,
  GOOGLE_BUSINESS_VIDEO_MAX_BYTES,
} from "./googleBusinessMediaPolicy.ts";
import { shouldUseRangeGetForStorageDeliveryUrl } from "./storageUrlSanitization.ts";

export type GoogleBusinessMediaKind = "image" | "video";

export type GoogleBusinessMediaProbeResult = {
  ok: boolean;
  url: string;
  kind: GoogleBusinessMediaKind;
  status: number | null;
  contentType: string;
  contentLength: number | null;
  reason:
    | "ok"
    | "url_invalid"
    | "http_error"
    | "content_type_invalid"
    | "size_unknown"
    | "range_not_supported"
    | "range_invalid"
    | "file_too_small"
    | "file_too_large"
    | "network_error";
};

export type GoogleBusinessMediaProbeDiagnostic = {
  index: number;
  reason: GoogleBusinessMediaProbeResult["reason"];
  status: number | null;
  contentType: string | null;
  contentLength: number | null;
};

function googleBusinessProviderErrorText(error: unknown) {
  if (error instanceof Error) return String(error.message || "").toLowerCase();
  if (typeof error === "string") return error.toLowerCase();
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const record = error as Record<string, unknown>;
    return String(
      record.message || record.error || record.error_description || "",
    ).toLowerCase();
  }
  return String(error || "").toLowerCase();
}

export function isGoogleBusinessMediaProviderError(error: unknown) {
  const message = googleBusinessProviderErrorText(error);
  if (!message) return false;
  if (
    [
      "mediaitem",
      "sourceurl",
      "source url",
      "invalid image",
      "unsupported image",
      "invalid media",
      "unsupported media",
      "content-type",
      "content type",
    ].some((needle) => message.includes(needle))
  ) {
    return true;
  }
  const namesMedia = ["image", "images", "photo", "media"].some((needle) =>
    message.includes(needle),
  );
  const describesRetrievalFailure = [
    "fetch",
    "download",
    "unreachable",
    "not accessible",
    "could not retrieve",
    "url",
  ].some((needle) => message.includes(needle));
  return namesMedia && describesRetrievalFailure;
}

export function toGoogleBusinessMediaProbeDiagnostics(
  results: readonly GoogleBusinessMediaProbeResult[],
): GoogleBusinessMediaProbeDiagnostic[] {
  return results.map((result, index) => ({
    index: index + 1,
    reason: result.reason,
    status: result.status,
    contentType: result.contentType || null,
    contentLength: result.contentLength,
  }));
}

export function describeGoogleBusinessMediaProbeFailure(
  result: GoogleBusinessMediaProbeResult,
) {
  const mediaLabel = result.kind === "video" ? "La vidéo" : "L’image";
  const sizeLabel = result.contentLength
    ? ` (${Math.max(1, Math.round(result.contentLength / 1024))} Ko)`
    : "";
  switch (result.reason) {
    case "url_invalid":
      return `${mediaLabel} n’a pas d’URL HTTPS publique valide.`;
    case "http_error":
      return `${mediaLabel} n’est pas accessible publiquement${result.status ? ` (HTTP ${result.status})` : ""}.`;
    case "content_type_invalid":
      return `${mediaLabel} est servie avec un type invalide${result.contentType ? ` (${result.contentType})` : ""} au lieu d’un média Google Business compatible.`;
    case "size_unknown":
      return `${mediaLabel} ne fournit pas une taille vérifiable à Google Business.`;
    case "range_not_supported":
    case "range_invalid":
      return `${mediaLabel} ne permet pas à Google Business de lire correctement le fichier à distance.`;
    case "file_too_small":
      return `${mediaLabel} est trop petite${sizeLabel} : Google Business exige au moins 10 Ko.`;
    case "file_too_large":
      return result.kind === "video"
        ? `${mediaLabel} est trop volumineuse${sizeLabel} : Google Business accepte 75 Mo maximum.`
        : `${mediaLabel} est trop volumineuse${sizeLabel} : Google Business accepte 5 Mo maximum.`;
    case "network_error":
      return `${mediaLabel} n’a pas pu être vérifiée à distance (réseau ou délai dépassé).`;
    default:
      return `${mediaLabel} n’a pas pu être validée pour Google Business.`;
  }
}

export function describeGoogleBusinessMediaProbeFailures(
  results: readonly GoogleBusinessMediaProbeResult[],
) {
  const rejected = results.filter((result) => !result.ok);
  if (!rejected.length) return "";
  return rejected
    .map(
      (result, index) =>
        `Média ${index + 1} : ${describeGoogleBusinessMediaProbeFailure(result)}`,
    )
    .join(" ");
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function normalizedContentType(value: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .split(";")[0]
    ?.trim();
}

export function parseGoogleBusinessMediaContentLength(response: Response) {
  const contentRange = String(response.headers.get("content-range") || "");
  const rangeMatch = /\/(\d+)\s*$/.exec(contentRange);
  const rangedTotal = Number(rangeMatch?.[1] || 0);
  if (Number.isFinite(rangedTotal) && rangedTotal > 0) return rangedTotal;

  const raw = response.headers.get("content-length");
  const value = Number(raw || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function validateHeaders(params: {
  url: string;
  kind: GoogleBusinessMediaKind;
  response: Response;
  method: "HEAD" | "GET";
}): GoogleBusinessMediaProbeResult {
  const { url, kind, response, method } = params;
  const contentType = normalizedContentType(response.headers.get("content-type"));
  const contentLength = parseGoogleBusinessMediaContentLength(response);
  const typeOk =
    kind === "image"
      ? contentType === "image/jpeg" || contentType === "image/png"
      : contentType === "video/mp4" || contentType === "application/mp4";

  if (!typeOk) {
    return {
      ok: false,
      url,
      kind,
      status: response.status,
      contentType,
      contentLength,
      reason: "content_type_invalid",
    };
  }

  if (kind === "video" && contentLength === null) {
    return {
      ok: false,
      url,
      kind,
      status: response.status,
      contentType,
      contentLength,
      reason: "size_unknown",
    };
  }

  if (kind === "video" && method === "GET") {
    if (response.status !== 206) {
      return {
        ok: false,
        url,
        kind,
        status: response.status,
        contentType,
        contentLength,
        reason: "range_not_supported",
      };
    }
    const contentRange = String(response.headers.get("content-range") || "").trim();
    const rangeLength = Number(response.headers.get("content-length") || 0);
    const range = /^bytes\s+0-0\/(\d+)$/i.exec(contentRange);
    if (
      !range ||
      rangeLength !== 1 ||
      Number(range[1]) !== contentLength
    ) {
      return {
        ok: false,
        url,
        kind,
        status: response.status,
        contentType,
        contentLength,
        reason: "range_invalid",
      };
    }
  }

  if (
    kind === "image" &&
    contentLength !== null &&
    contentLength < GOOGLE_BUSINESS_IMAGE_MIN_BYTES
  ) {
    return {
      ok: false,
      url,
      kind,
      status: response.status,
      contentType,
      contentLength,
      reason: "file_too_small",
    };
  }

  const maxBytes =
    kind === "image"
      ? GOOGLE_BUSINESS_IMAGE_OFFICIAL_MAX_BYTES
      : GOOGLE_BUSINESS_VIDEO_MAX_BYTES;
  if (contentLength !== null && contentLength > maxBytes) {
    return {
      ok: false,
      url,
      kind,
      status: response.status,
      contentType,
      contentLength,
      reason: "file_too_large",
    };
  }

  return {
    ok: true,
    url,
    kind,
    status: response.status,
    contentType,
    contentLength,
    reason: "ok",
  };
}

async function fetchHeaders(
  url: string,
  kind: GoogleBusinessMediaKind,
  method: "HEAD" | "GET",
  fetchImpl: typeof fetch,
): Promise<GoogleBusinessMediaProbeResult> {
  const controller = new AbortController();
  // Keep the provider dispatch inside a predictable budget. HEAD and the
  // one-byte GET fallback together must not consume most of the API route.
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetchImpl(url, {
      method,
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        url,
        kind,
        status: response.status,
        contentType: normalizedContentType(response.headers.get("content-type")),
        contentLength: parseGoogleBusinessMediaContentLength(response),
        reason: "http_error",
      };
    }
    const result = validateHeaders({ url, kind, response, method });
    await response.body?.cancel().catch(() => undefined);
    return result;
  } catch {
    return {
      ok: false,
      url,
      kind,
      status: null,
      contentType: "",
      contentLength: null,
      reason: "network_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeGoogleBusinessMediaUrl(params: {
  url: string;
  kind: GoogleBusinessMediaKind;
  attempts?: number;
  fetchImpl?: typeof fetch;
}): Promise<GoogleBusinessMediaProbeResult> {
  const url = String(params.url || "").trim();
  if (!/^https:\/\//i.test(url)) {
    return {
      ok: false,
      url,
      kind: params.kind,
      status: null,
      contentType: "",
      contentLength: null,
      reason: "url_invalid",
    };
  }

  const attempts = Math.max(1, Math.min(2, Math.round(params.attempts || 1)));
  const rangeGetOnly = shouldUseRangeGetForStorageDeliveryUrl(url);
  let lastResult: GoogleBusinessMediaProbeResult | null = null;
  for (let index = 0; index < attempts; index += 1) {
    let head: GoogleBusinessMediaProbeResult | null = null;
    if (!rangeGetOnly) {
      head = await fetchHeaders(
        url,
        params.kind,
        "HEAD",
        params.fetchImpl || fetch,
      );
      if (head.ok) return head;
      // A known out-of-bounds length cannot be repaired by a second request.
      // Avoid even the one-byte fallback for a source already rejected by the
      // shared 75,000,000-byte Booster ceiling.
      if (head.reason === "file_too_large" || head.reason === "file_too_small") {
        return head;
      }
    }

    const get = await fetchHeaders(
      url,
      params.kind,
      "GET",
      params.fetchImpl || fetch,
    );
    if (get.ok) return get;
    lastResult = get.reason === "network_error" && head ? head : get;

    if (index < attempts - 1) {
      await sleep(index === 0 ? 300 : 800);
    }
  }

  return (
    lastResult || {
      ok: false,
      url,
      kind: params.kind,
      status: null,
      contentType: "",
      contentLength: null,
      reason: "network_error",
    }
  );
}

export async function filterGoogleBusinessMediaUrls(params: {
  urls: readonly string[];
  kind: GoogleBusinessMediaKind;
}) {
  const uniqueUrls = Array.from(
    new Set(params.urls.map((url) => String(url || "").trim()).filter(Boolean)),
  );
  const probes = await Promise.all(
    uniqueUrls.map((url) =>
      probeGoogleBusinessMediaUrl({ url, kind: params.kind }),
    ),
  );
  return {
    acceptedUrls: probes.filter((probe) => probe.ok).map((probe) => probe.url),
    rejected: probes.filter((probe) => !probe.ok),
    probes,
  };
}
