"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MediaLibraryPickerItem } from "@/app/dashboard/_components/MediaLibraryPickerModal";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";

export type MediaGenerationKind = "image" | "video";
export type MediaGenerationSource = "booster" | "studio";
export type MediaGenerationSubjectSource = "publication" | "profile" | "custom";

export type MediaGenerationQuotaCounter = {
  limit: number | null;
  used: number;
  reserved: number;
  remaining: number | null;
};

export type MediaGenerationQuota = {
  accountId: string | null;
  edition: string | null;
  periodStart: string | null;
  resetAt: string | null;
  studioEnabled: boolean;
  image: MediaGenerationQuotaCounter;
  video: MediaGenerationQuotaCounter;
};

export type MediaGenerationSoundtrack = {
  id: string;
  name: string;
};

export type MediaGenerationResult = {
  item: MediaLibraryPickerItem;
  quota: MediaGenerationQuota;
  soundtrack: MediaGenerationSoundtrack | null;
  /**
   * A draft is private and temporary. It only becomes a regular library item
   * after the explicit accept call succeeds.
   */
  draft: boolean;
};

export type MediaGenerationRequest = {
  kind: MediaGenerationKind;
  subjectSource: MediaGenerationSubjectSource;
  idea: string;
  withText?: boolean;
  withMusic?: boolean;
  source: MediaGenerationSource;
};

type MediaGenerationStatus = "idle" | "loading-quota" | "generating" | "success" | "error";

export class MediaGenerationAccountChangedError extends Error {
  readonly code = "MEDIA_GENERATION_ACCOUNT_CHANGED";

  constructor() {
    super("The active establishment changed during media generation.");
    this.name = "MediaGenerationAccountChangedError";
  }
}

const EMPTY_COUNTER: MediaGenerationQuotaCounter = {
  limit: null,
  used: 0,
  reserved: 0,
  remaining: null,
};

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeCounter(value: unknown): MediaGenerationQuotaCounter {
  if (!value || typeof value !== "object") return { ...EMPTY_COUNTER };
  const source = value as Record<string, unknown>;
  const limit = finiteNumber(source.limit ?? source.monthlyLimit ?? source.monthly_limit);
  const used = finiteNumber(source.used ?? source.count ?? source.consumed) ?? 0;
  const reserved = finiteNumber(source.reserved ?? source.pending) ?? 0;
  const reportedRemaining = finiteNumber(source.remaining);
  const remaining = reportedRemaining ?? (limit === null ? null : Math.max(0, limit - used - reserved));
  return { limit, used, reserved, remaining };
}

function normalizeQuota(value: unknown): MediaGenerationQuota {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    accountId: typeof source.accountId === "string" ? source.accountId : null,
    edition: typeof source.edition === "string" ? source.edition : null,
    periodStart: typeof source.periodStart === "string" ? source.periodStart : null,
    resetAt: typeof source.resetAt === "string" ? source.resetAt : null,
    studioEnabled: source.studioEnabled !== false,
    image: normalizeCounter(source.image ?? source.images),
    video: normalizeCounter(source.video ?? source.videos),
  };
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const source = payload as Record<string, unknown>;
  for (const candidate of [source.userMessage, source.user_message, source.message, source.error]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

function readErrorCode(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const source = payload as Record<string, unknown>;
  const candidate = source.code ?? source.error_code;
  return typeof candidate === "string" ? candidate.trim() : "";
}

function shouldKeepGenerationRequestId(status: number, code: string) {
  return (
    (status === 409 && code === "AI_MEDIA_GENERATION_IN_PROGRESS") ||
    code === "AI_MEDIA_FINALIZATION_PENDING"
  );
}

function buildGenerationAttemptKey(
  request: MediaGenerationRequest,
  idea: string,
) {
  return JSON.stringify({
    kind: request.kind,
    subjectSource: request.subjectSource,
    idea,
    withText: request.kind === "image" && Boolean(request.withText),
    withMusic: request.kind === "video" && Boolean(request.withMusic),
    source: request.source,
  });
}

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

async function readJson(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  return response.text().then((text) => text ? { message: text } : null).catch(() => null);
}

function mediaDraftEndpoint(mediaId: string) {
  return `/api/media-generation/drafts/${encodeURIComponent(mediaId)}`;
}

/**
 * Best-effort safe for page teardown thanks to keepalive. The server contract
 * is idempotent, and a draft which was already promoted must never be deleted.
 */
export async function discardMediaGenerationDraft(mediaId: string) {
  const normalizedId = String(mediaId || "").trim();
  if (!normalizedId) return;

  const response = await fetch(mediaDraftEndpoint(normalizedId), {
    method: "DELETE",
    credentials: "include",
    cache: "no-store",
    keepalive: true,
  });
  const payload = await readJson(response);
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(
      readErrorMessage(payload, "Le brouillon temporaire n’a pas pu être supprimé."),
    );
  }
}

export default function useMediaGeneration() {
  const [quota, setQuota] = useState<MediaGenerationQuota | null>(null);
  const [status, setStatus] = useState<MediaGenerationStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MediaGenerationResult | null>(null);
  const [originChangedNotice, setOriginChangedNotice] = useState(false);
  const quotaRef = useRef<MediaGenerationQuota | null>(null);
  const resultRef = useRef<MediaGenerationResult | null>(null);
  const accountEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const pendingGenerationAttemptRef = useRef<{
    key: string;
    requestId: string;
  } | null>(null);
  const quotaRequestRef = useRef<{
    epoch: number;
    key: object;
    promise: Promise<MediaGenerationQuota | null>;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (status !== "generating") return;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 99) return current;
        if (current < 18) return Math.min(18, current + 3);
        if (current < 58) return Math.min(58, current + 2);
        return Math.min(99, current + 1);
      });
    }, 650);
    return () => window.clearInterval(timer);
  }, [status]);

  const loadQuota = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    const requestEpoch = accountEpochRef.current;
    const requestKey = {};
    const currentRequest = quotaRequestRef.current;
    if (!force && currentRequest?.epoch === requestEpoch) {
      return currentRequest.promise;
    }

    const request = (async () => {
      if (mountedRef.current) {
        setStatus((current) => current === "generating" ? current : "loading-quota");
        setError("");
      }
      try {
        const response = await fetch("/api/media-generation/quota", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(readErrorMessage(payload, "Impossible de charger le quota de génération."));
        }
        const normalized = normalizeQuota(
          payload && typeof payload === "object" && "quota" in payload
            ? (payload as { quota?: unknown }).quota
            : payload,
        );
        if (
          mountedRef.current &&
          requestEpoch === accountEpochRef.current
        ) {
          quotaRef.current = normalized;
          setQuota(normalized);
          setStatus((current) => current === "generating" ? current : "idle");
        }
        return normalized;
      } catch (caught) {
        if (
          mountedRef.current &&
          requestEpoch === accountEpochRef.current
        ) {
          setError(caught instanceof Error ? caught.message : "Impossible de charger le quota de génération.");
          setStatus((current) => current === "generating" ? current : "error");
        }
        return null;
      } finally {
        if (quotaRequestRef.current?.key === requestKey) {
          quotaRequestRef.current = null;
        }
      }
    })();

    quotaRequestRef.current = {
      epoch: requestEpoch,
      key: requestKey,
      promise: request,
    };
    return request;
  }, []);

  useEffect(() => {
    const handleActiveAccountChange = () => {
      const previousResult = resultRef.current;
      if (previousResult?.draft) {
        // The endpoint is idempotent. If the account switch already reached
        // the server, the 24 h cleanup remains the final safety net.
        void discardMediaGenerationDraft(previousResult.item.id).catch(() => undefined);
      }
      accountEpochRef.current += 1;
      quotaRef.current = null;
      resultRef.current = null;
      pendingGenerationAttemptRef.current = null;
      setQuota(null);
      setResult(null);
      setError("");
      setOriginChangedNotice(false);
      setProgress(0);
      setStatus("loading-quota");
      void loadQuota({ force: true });
    };

    window.addEventListener(
      ACTIVE_INRCY_ACCOUNT_EVENT,
      handleActiveAccountChange,
    );
    return () => window.removeEventListener(
      ACTIVE_INRCY_ACCOUNT_EVENT,
      handleActiveAccountChange,
    );
  }, [loadQuota]);

  const generate = useCallback(async (request: MediaGenerationRequest) => {
    const idea = String(request.idea || "").trim();
    if (request.subjectSource !== "profile" && !idea) {
      throw new Error("Ajoutez une idée ou un contenu avant de générer le média.");
    }
    const attemptKey = buildGenerationAttemptKey(request, idea);
    const previousAttempt = pendingGenerationAttemptRef.current;
    const requestId = previousAttempt?.key === attemptKey
      ? previousAttempt.requestId
      : createRequestId();
    pendingGenerationAttemptRef.current = { key: attemptKey, requestId };
    const clearCurrentAttempt = () => {
      if (
        pendingGenerationAttemptRef.current?.key === attemptKey &&
        pendingGenerationAttemptRef.current.requestId === requestId
      ) {
        pendingGenerationAttemptRef.current = null;
      }
    };

    const requestEpoch = accountEpochRef.current;
    setStatus("generating");
    setProgress(4);
    setError("");
    setResult(null);
    setOriginChangedNotice(false);

    try {
      const response = await fetch("/api/media-generation/generate", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractVersion: 2,
          requestId,
          kind: request.kind,
          subjectSource: request.subjectSource,
          idea,
          withText: request.kind === "image" ? Boolean(request.withText) : undefined,
          withMusic: request.kind === "video" ? Boolean(request.withMusic) : undefined,
          source: request.source,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        if (response.status === 429) {
          const responseQuota =
            payload && typeof payload === "object" && "quota" in payload
              ? (payload as { quota?: unknown }).quota
              : null;
          if (
            responseQuota &&
            typeof responseQuota === "object" &&
            mountedRef.current &&
            requestEpoch === accountEpochRef.current
          ) {
            const normalizedQuota = normalizeQuota(responseQuota);
            quotaRef.current = normalizedQuota;
            setQuota(normalizedQuota);
          }
          // Confirm the authoritative counter even when an older server did
          // not include it in the 429 response.
          void loadQuota({ force: true });
        }
        const errorCode = readErrorCode(payload);
        if (!shouldKeepGenerationRequestId(response.status, errorCode)) {
          clearCurrentAttempt();
        }
        throw new Error(readErrorMessage(payload, "La génération du média a échoué."));
      }
      // Une réponse 2xx tronquée reste incertaine : le serveur a pu enregistrer
      // le média. Conserver l'id permet au retry de rejouer le job au lieu de
      // payer une seconde génération.
      if (!payload || typeof payload !== "object") {
        throw new Error("La réponse de génération est incomplète. Réessayez.");
      }
      const data = payload as Record<string, unknown>;
      if (data.ok !== true || !data.item || typeof data.item !== "object") {
        throw new Error(readErrorMessage(payload, "Le média généré est incomplet."));
      }
      if (
        !mountedRef.current ||
        requestEpoch !== accountEpochRef.current
      ) {
        if (mountedRef.current) {
          setOriginChangedNotice(true);
          void loadQuota({ force: true });
        }
        throw new MediaGenerationAccountChangedError();
      }
      clearCurrentAttempt();
      const hasReturnedQuota = Boolean(
        data.quota && typeof data.quota === "object",
      );
      const normalizedQuota = hasReturnedQuota
        ? normalizeQuota(data.quota)
        : quotaRef.current || normalizeQuota(null);
      const soundtrackSource = data.soundtrack && typeof data.soundtrack === "object"
        ? data.soundtrack as Record<string, unknown>
        : null;
      const soundtrack = soundtrackSource && typeof soundtrackSource.id === "string"
        ? {
            id: soundtrackSource.id,
            name: typeof soundtrackSource.name === "string" ? soundtrackSource.name : soundtrackSource.id,
          }
        : null;
      const nextResult: MediaGenerationResult = {
        item: data.item as MediaLibraryPickerItem,
        quota: normalizedQuota,
        soundtrack,
        draft: data.draft !== false,
      };
      if (mountedRef.current) {
        setProgress(100);
        if (hasReturnedQuota) {
          quotaRef.current = normalizedQuota;
          setQuota(normalizedQuota);
        }
        resultRef.current = nextResult;
        setResult(nextResult);
        setStatus("success");
      }
      if (!hasReturnedQuota) {
        void loadQuota({ force: true });
      }
      return nextResult;
    } catch (caught) {
      if (caught instanceof MediaGenerationAccountChangedError) throw caught;
      if (
        !mountedRef.current ||
        requestEpoch !== accountEpochRef.current
      ) {
        throw new MediaGenerationAccountChangedError();
      }
      const message = caught instanceof Error ? caught.message : "La génération du média a échoué.";
      if (mountedRef.current) {
        setError(message);
        setStatus("error");
        setProgress(0);
      }
      throw caught instanceof Error ? caught : new Error(message);
    }
  }, [loadQuota]);

  const acceptDraft = useCallback(async (
    candidate?: MediaGenerationResult | null,
  ) => {
    const requested = candidate || resultRef.current;
    if (!requested) {
      throw new Error("Aucun média temporaire à valider.");
    }

    const latest = resultRef.current;
    if (latest?.item.id === requested.item.id && !latest.draft) {
      return latest;
    }
    if (!requested.draft) return requested;

    const requestEpoch = accountEpochRef.current;
    const response = await fetch(
      `${mediaDraftEndpoint(requested.item.id)}/accept`,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contractVersion: 2 }),
      },
    );
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(
        readErrorMessage(payload, "Le média n’a pas pu être enregistré."),
      );
    }
    if (!payload || typeof payload !== "object") {
      throw new Error("La réponse de validation du média est incomplète.");
    }
    const data = payload as Record<string, unknown>;
    if (data.ok !== true || !data.item || typeof data.item !== "object") {
      throw new Error(
        readErrorMessage(payload, "Le média validé est incomplet."),
      );
    }
    if (
      !mountedRef.current ||
      requestEpoch !== accountEpochRef.current
    ) {
      throw new MediaGenerationAccountChangedError();
    }

    const acceptedResult: MediaGenerationResult = {
      ...requested,
      item: data.item as MediaLibraryPickerItem,
      draft: false,
    };
    resultRef.current = acceptedResult;
    setResult(acceptedResult);
    return acceptedResult;
  }, []);

  const discardDraft = useCallback(async (
    candidate?: MediaGenerationResult | null,
  ) => {
    const requested = candidate || resultRef.current;
    if (!requested || !requested.draft) return;

    await discardMediaGenerationDraft(requested.item.id);
    if (resultRef.current?.item.id === requested.item.id) {
      resultRef.current = null;
      setResult(null);
      setProgress(0);
      setError("");
      setStatus("idle");
    }
  }, []);

  const reset = useCallback(() => {
    pendingGenerationAttemptRef.current = null;
    resultRef.current = null;
    setStatus("idle");
    setProgress(0);
    setError("");
    setResult(null);
    setOriginChangedNotice(false);
  }, []);

  return {
    quota,
    status,
    progress,
    error,
    result,
    originChangedNotice,
    busy: status === "generating",
    quotaLoading: status === "loading-quota",
    loadQuota,
    generate,
    acceptDraft,
    discardDraft,
    reset,
  };
}
