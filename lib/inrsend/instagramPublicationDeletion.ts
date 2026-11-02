import { createHash } from "crypto";
import { resolveInstagramAuthMode, buildInstagramGraphUrl, type InstagramAuthMode } from "@/lib/instagramAuthMode";
import { tryDecryptToken } from "@/lib/oauthCrypto";
import { log } from "@/lib/observability/logger";

type JsonRecord = Record<string, unknown>;
function asRecord(v: unknown): JsonRecord {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : {};
}

type InstagramDeleteTokenCandidate = {
  source: string;
  token: string;
  preview: string;
};

type InstagramDeleteAttempt = {
  source: string;
  token_preview: string;
  requested_external_id?: string;
  delete_target_id?: string;
  delete_target_media_type?: string | null;
  verified?: boolean;
  verify_http_status?: number | null;
  verify_error?: ReturnType<typeof extractGraphErrorMeta> | null;
  delete_http_status?: number | null;
  delete_error?: ReturnType<typeof extractGraphErrorMeta> | null;
  success: boolean;
};

export type InstagramDeleteResult = {
  ok: boolean;
  external_id: string;
  delete_target_id?: string;
  delete_target_media_type?: string | null;
  carousel_parent_protected?: boolean;
  verified: boolean;
  attempts: InstagramDeleteAttempt[];
  error?: string | null;
};

async function verifyInstagramMediaId(externalId: string, accessToken: string, authMode?: InstagramAuthMode) {
  const qs = new URLSearchParams({
    fields: "id,media_type,media_product_type,permalink,timestamp,username,children{id,media_type,permalink}",
    access_token: accessToken,
  });
  const res = await fetch(`${buildInstagramGraphUrl(encodeURIComponent(externalId), authMode)}?${qs.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function deleteInstagramMedia(externalId: string, accessToken: string, authMode?: InstagramAuthMode) {
  const qs = new URLSearchParams({ access_token: accessToken });
  const res = await fetch(`${buildInstagramGraphUrl(encodeURIComponent(externalId), authMode)}?${qs.toString()}`, {
    method: "DELETE",
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

function previewToken(token: string) {
  if (!token) return "absent";
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 10);
  return `tok_${digest}`;
}

export function buildInstagramDeleteTokenCandidates(entries: Array<{ sourceLabel: string; row: unknown }>): InstagramDeleteTokenCandidate[] {
  const candidates: InstagramDeleteTokenCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (source: string, raw: unknown) => {
    const token = tryDecryptToken(String(raw || "")) || "";
    if (!token || seen.has(token)) return;
    seen.add(token);
    candidates.push({ source, token, preview: previewToken(token) });
  };

  const directEntry = entries.find((entry) => entry.sourceLabel === "instagram" && resolveInstagramAuthMode(asRecord(entry.row).meta) === "instagram_login");
  if (directEntry) { pushCandidate("instagram.access_token_enc", asRecord(directEntry.row).access_token_enc); return candidates; }
  for (const entry of entries) {
    const row = asRecord(entry.row);
    const meta = asRecord(row.meta);
    pushCandidate(`${entry.sourceLabel}.access_token_enc`, row.access_token_enc);
    pushCandidate(`${entry.sourceLabel}.meta.standard_user_access_token_enc`, meta.standard_user_access_token_enc);
    pushCandidate(`${entry.sourceLabel}.meta.business_user_access_token_enc`, meta.business_user_access_token_enc);
    pushCandidate(`${entry.sourceLabel}.meta.user_access_token_enc`, meta.user_access_token_enc);
    pushCandidate(`${entry.sourceLabel}.meta.user_access_token`, meta.user_access_token);
  }

  return candidates;
}

function extractGraphErrorMeta(errorLike: unknown) {
  const err = asRecord(asRecord(errorLike).error);
  return {
    message: String(err.message ?? "").trim() || null,
    graph_code: typeof err.code === "number" ? err.code : Number(err.code || 0) || null,
    graph_subcode: typeof err.error_subcode === "number" ? err.error_subcode : Number(err.error_subcode || 0) || null,
    fbtrace_id: String(err.fbtrace_id ?? "").trim() || null,
  };
}

function isInstagramDeletePermissionError(error: unknown) {
  const candidate =
    error && typeof error === "object"
      ? (error as { message?: unknown; graph_code?: unknown; code?: unknown })
      : null;
  const graphCode = Number(candidate?.graph_code || candidate?.code || 0);
  const message = String(
    error instanceof Error ? error.message : candidate?.message || error || "",
  ).toLowerCase();
  return (
    graphCode === 10
    || message.includes("insufficient")
    || message.includes("permission")
    || message.includes("access this data")
    || message.includes("not authorized")
    || message.includes("not authorised")
    || message.includes("unsupported request")
    || message.includes("access token")
    || message.includes("oauth")
  );
}

function extractInstagramResultMeta(channelResult: JsonRecord, fallbackExternalId: string) {
  const diagnostics = asRecord(channelResult.diagnostics);
  const nestedDiagnostics = asRecord(diagnostics.diagnostics);
  const mediaType = String(channelResult.instagram_media_type ?? diagnostics.mediaType ?? nestedDiagnostics.mediaType ?? "").trim();
  const parentMediaId = String(
    channelResult.instagram_parent_media_id
    ?? diagnostics.parentMediaId
    ?? nestedDiagnostics.parentMediaId
    ?? (mediaType === "CAROUSEL_ALBUM" || mediaType === "CAROUSEL" ? channelResult.external_id : "")
    ?? ""
  ).trim();
  const rawChildren = channelResult.instagram_child_media_ids ?? diagnostics.childMediaIds ?? nestedDiagnostics.childMediaIds ?? diagnostics.childContainerIds ?? nestedDiagnostics.childContainerIds;
  const childIds = Array.isArray(rawChildren) ? rawChildren.map((value) => String(value || "").trim()).filter(Boolean) : [];
  return {
    mediaType: mediaType || null,
    parentMediaId: parentMediaId || fallbackExternalId || null,
    childIds,
  };
}

function resolveInstagramDeleteTarget(params: {
  requestedExternalId: string;
  channelResult?: JsonRecord | null;
}) {
  const requestedExternalId = String(params.requestedExternalId || "").trim();
  const channelResult = asRecord(params.channelResult);
  const meta = extractInstagramResultMeta(channelResult, requestedExternalId);
  const mediaType = String(meta.mediaType || "").toUpperCase();
  const childSet = new Set(meta.childIds);
  const isCarousel = mediaType === "CAROUSEL" || mediaType === "CAROUSEL_ALBUM";

  if (isCarousel && meta.parentMediaId) {
    return {
      requestedExternalId,
      deleteTargetId: meta.parentMediaId,
      deleteTargetMediaType: "CAROUSEL_ALBUM",
      carouselParentProtected: true,
    };
  }

  if (requestedExternalId && childSet.has(requestedExternalId) && meta.parentMediaId) {
    return {
      requestedExternalId,
      deleteTargetId: meta.parentMediaId,
      deleteTargetMediaType: "CAROUSEL_ALBUM",
      carouselParentProtected: true,
    };
  }

  return {
    requestedExternalId,
    deleteTargetId: requestedExternalId,
    deleteTargetMediaType: meta.mediaType,
    carouselParentProtected: false,
  };
}

export async function deleteInstagramMediaWithFallback(
  externalId: string,
  options: {
    igRow?: unknown;
    fbRow?: unknown;
    channelResult?: JsonRecord | null;
    allowLocalFallback?: boolean;
  } = {},
): Promise<InstagramDeleteResult> {
  const authMode = resolveInstagramAuthMode(asRecord(options.igRow).meta);
  const target = resolveInstagramDeleteTarget({ requestedExternalId: externalId, channelResult: options.channelResult });
  const emptyResult: InstagramDeleteResult = {
    ok: true,
    external_id: externalId,
    delete_target_id: target.deleteTargetId || externalId,
    delete_target_media_type: target.deleteTargetMediaType,
    carousel_parent_protected: target.carouselParentProtected,
    verified: false,
    attempts: [],
  };
  if (!externalId) return emptyResult;

  const candidates = buildInstagramDeleteTokenCandidates([
    { sourceLabel: "instagram", row: options.igRow },
    { sourceLabel: "facebook", row: options.fbRow },
  ]);

  if (!candidates.length) {
    const message = "Votre compte Instagram n’est pas encore correctement relié.";
    if (options.allowLocalFallback) {
      return {
        ok: false,
        external_id: externalId,
        delete_target_id: target.deleteTargetId || externalId,
        delete_target_media_type: target.deleteTargetMediaType,
        carousel_parent_protected: target.carouselParentProtected,
        verified: false,
        attempts: [],
        error: message,
      };
    }
    throw new Error(message);
  }

  const attempts: InstagramDeleteAttempt[] = [];
  let lastErrorMessage = "Suppression Instagram impossible.";

  for (const candidate of candidates) {
    const attempt: InstagramDeleteAttempt = {
      source: candidate.source,
      token_preview: candidate.preview,
      requested_external_id: externalId,
      delete_target_id: target.deleteTargetId || externalId,
      delete_target_media_type: target.deleteTargetMediaType,
      verified: false,
      verify_http_status: null,
      verify_error: null,
      delete_http_status: null,
      delete_error: null,
      success: false,
    };

    try {
      const verify = await verifyInstagramMediaId(target.deleteTargetId || externalId, candidate.token, authMode);
      attempt.verify_http_status = verify.res.status;
      if (!verify.res.ok) {
        attempt.verify_error = extractGraphErrorMeta(verify.json);
        lastErrorMessage = attempt.verify_error.message || `Vérification Instagram impossible (${verify.res.status})`;
        attempts.push(attempt);
        log.warn("instagram_delete_verify_failed", {
          route: "inrsend_instagram_delete",
          external_id: externalId,
          delete_target_id: target.deleteTargetId || externalId,
          delete_target_media_type: target.deleteTargetMediaType,
          carousel_parent_protected: target.carouselParentProtected,
          source: candidate.source,
          token_preview: candidate.preview,
          http_status: verify.res.status,
          graph_error: attempt.verify_error,
        });
        continue;
      }

      attempt.verified = true;
      const deleted = await deleteInstagramMedia(target.deleteTargetId || externalId, candidate.token, authMode);
      attempt.delete_http_status = deleted.res.status;

      if (deleted.res.ok && deleted.json?.success !== false) {
        attempt.success = true;
        attempts.push(attempt);
        log.info("instagram_delete_success", {
          route: "inrsend_instagram_delete",
          external_id: externalId,
          delete_target_id: target.deleteTargetId || externalId,
          delete_target_media_type: target.deleteTargetMediaType,
          carousel_parent_protected: target.carouselParentProtected,
          source: candidate.source,
          token_preview: candidate.preview,
          verify_http_status: attempt.verify_http_status,
          delete_http_status: attempt.delete_http_status,
        });
        return {
          ok: true,
          external_id: externalId,
          delete_target_id: target.deleteTargetId || externalId,
          delete_target_media_type: target.deleteTargetMediaType,
          carousel_parent_protected: target.carouselParentProtected,
          verified: true,
          attempts,
        };
      }

      attempt.delete_error = extractGraphErrorMeta(deleted.json);
      lastErrorMessage = attempt.delete_error.message || `Suppression Instagram impossible (${deleted.res.status})`;
      attempts.push(attempt);
      const deleteFailureContext = {
        route: "inrsend_instagram_delete",
        external_id: externalId,
        delete_target_id: target.deleteTargetId || externalId,
        delete_target_media_type: target.deleteTargetMediaType,
        carousel_parent_protected: target.carouselParentProtected,
        source: candidate.source,
        token_preview: candidate.preview,
        verify_http_status: attempt.verify_http_status,
        delete_http_status: attempt.delete_http_status,
        graph_error: attempt.delete_error,
      };
      if (isInstagramDeletePermissionError(attempt.delete_error)) {
        // Meta does not expose remote deletion for every media/token shape. The
        // caller deliberately removes the local delivery in that known case.
        log.info("instagram_delete_remote_unsupported", deleteFailureContext);
      } else {
        log.warn("instagram_delete_attempt_failed", deleteFailureContext);
      }
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : String(error || "Suppression Instagram impossible.");
      attempt.delete_error = { message: lastErrorMessage, graph_code: null, graph_subcode: null, fbtrace_id: null };
      attempts.push(attempt);
      log.warn("instagram_delete_attempt_exception", {
        route: "inrsend_instagram_delete",
        external_id: externalId,
        delete_target_id: target.deleteTargetId || externalId,
        delete_target_media_type: target.deleteTargetMediaType,
        carousel_parent_protected: target.carouselParentProtected,
        source: candidate.source,
        token_preview: candidate.preview,
        error: lastErrorMessage,
      });
    }
  }

  const result: InstagramDeleteResult = {
    ok: false,
    external_id: externalId,
    delete_target_id: target.deleteTargetId || externalId,
    delete_target_media_type: target.deleteTargetMediaType,
    carousel_parent_protected: target.carouselParentProtected,
    verified: attempts.some((attempt) => attempt.verified === true),
    attempts,
    error: lastErrorMessage,
  };

  const permissionDenied = attempts.some((attempt) =>
    isInstagramDeletePermissionError(attempt.delete_error),
  );
  if (options.allowLocalFallback || permissionDenied || isInstagramDeletePermissionError(lastErrorMessage)) return result;

  const error = new Error(lastErrorMessage) as Error & { instagramDeleteResult?: InstagramDeleteResult };
  error.instagramDeleteResult = result;
  throw error;
}
