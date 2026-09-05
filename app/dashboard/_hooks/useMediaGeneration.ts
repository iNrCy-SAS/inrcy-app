"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MediaLibraryPickerItem } from "@/app/dashboard/_components/MediaLibraryPickerModal";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";

export type MediaGenerationKind = "image" | "video";
export type MediaGenerationSource = "booster" | "studio";
export type MediaGenerationSubjectSource = "publication" | "profile" | "custom";
export type MediaGenerationFormat =
  | "square"
  | "portrait"
  | "story"
  | "landscape";
export type MediaGenerationTypology =
  | "company"
  | "service"
  | "advice"
  | "showcase"
  | "offer"
  | "event"
  | "behind_scenes"
  | "recruitment";
export type MediaGenerationVisualStyle =
  | "brand"
  | "clean"
  | "premium"
  | "warm"
  | "dynamic"
  | "expert"
  | "local"
  | "colorful";
export type MediaGenerationImageStyle =
  | "photo"
  | "illustration"
  | "three_d"
  | "graphic";
export type MediaGenerationShotType = "auto" | "close" | "medium" | "wide";
export type MediaGenerationPeopleMode = "auto" | "none" | "solo" | "team";
export type MediaGenerationCreativity = "faithful" | "bold";
export type MediaGenerationLogoMode = "discreet" | "visible" | "none";
export type MediaGenerationVideoDuration = 8 | 16 | 24;
export type MediaGenerationVideoEngine = "omni" | "veo";
export type MediaGenerationTeamVideoMode = "cinematic" | "montage";
export type MediaGenerationTeamVideoSpeechMode = "voiceover" | "characters";
export type MediaGenerationNarrationVoice = "female" | "male";
export type MediaGenerationIdentityMode =
  | "auto"
  | "professional"
  | "brand_avatar"
  | "reference_team";
/** @deprecated Alias conservé pour les anciens écrans vidéo. */
export type MediaGenerationVideoCharacterMode = MediaGenerationIdentityMode;
export type MediaGenerationVideoEngineResult =
  | "omni"
  | "veo"
  | "omni_veo_fallback";
export type MediaGenerationInspirationImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
  name: string;
};

export type MediaGenerationQuotaCounter = {
  limit: number | null;
  used: number;
  reserved: number;
  remaining: number | null;
};

export type MediaGenerationQuota = {
  accountId: string | null;
  edition: string | null;
  unlimited: boolean;
  periodStart: string | null;
  resetAt: string | null;
  studioEnabled: boolean;
  videoLongFormPremiumRequired: boolean;
  videoMaxDurationSeconds: MediaGenerationVideoDuration;
  videoAllowedDurationsSeconds: MediaGenerationVideoDuration[];
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
  videoEngineResult: MediaGenerationVideoEngineResult | null;
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
  aiInstruction?: string;
  withText?: boolean;
  textKeywords: string[];
  withMusic?: boolean;
  withNarration?: boolean;
  narrationVoice?: MediaGenerationNarrationVoice;
  format: MediaGenerationFormat;
  typology: MediaGenerationTypology;
  visualStyle: MediaGenerationVisualStyle;
  imageStyle: MediaGenerationImageStyle;
  shotType: MediaGenerationShotType;
  peopleMode: MediaGenerationPeopleMode;
  creativity: MediaGenerationCreativity;
  useBrandColors: boolean;
  logoMode: MediaGenerationLogoMode;
  videoEngine?: MediaGenerationVideoEngine;
  teamVideoMode?: MediaGenerationTeamVideoMode;
  teamVideoSpeechMode?: MediaGenerationTeamVideoSpeechMode;
  /** Consentement ponctuel Veo : il ne doit jamais être mémorisé. */
  teamVideoVeoConsent?: boolean;
  identityMode?: MediaGenerationIdentityMode;
  videoCharacterMode?: MediaGenerationVideoCharacterMode;
  identityConsent?: boolean;
  identityReferenceSetId?: string;
  durationSeconds?: MediaGenerationVideoDuration;
  inspirationImages?: MediaGenerationInspirationImage[];
  source: MediaGenerationSource;
};

type MediaGenerationStatus =
  | "idle"
  | "loading-quota"
  | "generating"
  | "success"
  | "error";

// L'API Veo ne diffuse pas de pourcentage de rendu. Ces jalons suivent les
// étapes réelles du pipeline iNrCy (profil, marque, scénario, rendu) puis la
// réponse serveur déclenche une rampe distincte 99 -> 100 -> aperçu.
const COMPLETION_RAMP_MIN_MS = 300;
const COMPLETION_RAMP_MAX_MS = 700;
const COMPLETION_99_HOLD_MS = 120;
const COMPLETION_100_HOLD_MS = 250;
const DRAFT_ACCEPT_RETRY_DELAYS_MS = [0, 450, 1_200] as const;

function interpolateProgress(
  elapsedSeconds: number,
  startSeconds: number,
  endSeconds: number,
  startProgress: number,
  endProgress: number
) {
  const ratio = Math.max(
    0,
    Math.min(1, (elapsedSeconds - startSeconds) / (endSeconds - startSeconds))
  );
  return Math.round(
    startProgress + (endProgress - startProgress) * ratio
  );
}

function estimateGenerationProgress(
  elapsedSeconds: number,
  kind: MediaGenerationKind
) {
  const profileEnd = kind === "video" ? 3 : 2.5;
  const brandEnd = kind === "video" ? 7 : 6;
  const creationEnd = kind === "video" ? 15 : 12;

  if (elapsedSeconds < profileEnd) {
    return interpolateProgress(elapsedSeconds, 0, profileEnd, 4, 17);
  }
  if (elapsedSeconds < brandEnd) {
    return interpolateProgress(
      elapsedSeconds,
      profileEnd,
      brandEnd,
      18,
      41
    );
  }
  if (elapsedSeconds < creationEnd) {
    return interpolateProgress(
      elapsedSeconds,
      brandEnd,
      creationEnd,
      42,
      71
    );
  }

  const renderSeconds = elapsedSeconds - creationEnd;
  const renderTimeConstant = kind === "video" ? 55 : 35;
  return Math.min(
    94,
    Math.round(72 + 22 * (1 - Math.exp(-renderSeconds / renderTimeConstant)))
  );
}

function animateProgressToCompletion(args: {
  from: number;
  onProgress: (value: number) => void;
  isActive: () => boolean;
}) {
  const startProgress = Math.max(4, Math.min(98, args.from));
  const rampDuration = Math.min(
    COMPLETION_RAMP_MAX_MS,
    Math.max(COMPLETION_RAMP_MIN_MS, (99 - startProgress) * 18)
  );

  return new Promise<void>((resolve) => {
    const startedAt = window.performance.now();
    const finishAtOneHundred = () => {
      if (!args.isActive()) {
        resolve();
        return;
      }
      args.onProgress(100);
      window.setTimeout(resolve, COMPLETION_100_HOLD_MS);
    };
    const tick = (now: number) => {
      if (!args.isActive()) {
        resolve();
        return;
      }
      const ratio = Math.min(1, (now - startedAt) / rampDuration);
      const next = Math.min(
        99,
        Math.floor(startProgress + (99 - startProgress) * ratio)
      );
      args.onProgress(next);
      if (ratio < 1) {
        window.requestAnimationFrame(tick);
        return;
      }
      args.onProgress(99);
      window.setTimeout(finishAtOneHundred, COMPLETION_99_HOLD_MS);
    };
    window.requestAnimationFrame(tick);
  });
}

export class MediaGenerationAccountChangedError extends Error {
  readonly code = "MEDIA_GENERATION_ACCOUNT_CHANGED";

  constructor() {
    super("The active establishment changed during media generation.");
    this.name = "MediaGenerationAccountChangedError";
  }
}

export class MediaGenerationCancelledError extends Error {
  readonly code = "MEDIA_GENERATION_CANCELLED";

  constructor() {
    super("La génération a été arrêtée.");
    this.name = "MediaGenerationCancelledError";
  }
}

const EMPTY_COUNTER: MediaGenerationQuotaCounter = {
  limit: null,
  used: 0,
  reserved: 0,
  remaining: null,
};

function finiteNumber(value: unknown): number | null {
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeCounter(value: unknown): MediaGenerationQuotaCounter {
  if (!value || typeof value !== "object") return { ...EMPTY_COUNTER };
  const source = value as Record<string, unknown>;
  const limit = finiteNumber(
    source.limit ?? source.monthlyLimit ?? source.monthly_limit
  );
  const used =
    finiteNumber(source.used ?? source.count ?? source.consumed) ?? 0;
  const reserved = finiteNumber(source.reserved ?? source.pending) ?? 0;
  const reportedRemaining = finiteNumber(source.remaining);
  const remaining =
    reportedRemaining ??
    (limit === null ? null : Math.max(0, limit - used - reserved));
  return { limit, used, reserved, remaining };
}

function normalizeQuota(value: unknown): MediaGenerationQuota {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const videoLongFormPremiumRequired =
    source.videoLongFormPremiumRequired === true ||
    source.video_long_form_premium_required === true ||
    source.videoPremiumRequired === true ||
    source.video_premium_required === true;
  const reportedVideoMaxDuration = Number(
    source.videoMaxDurationSeconds ?? source.video_max_duration_seconds,
  );
  const videoMaxDurationSeconds = ([8, 16, 24] as const).includes(
    reportedVideoMaxDuration as MediaGenerationVideoDuration,
  )
    ? (reportedVideoMaxDuration as MediaGenerationVideoDuration)
    : videoLongFormPremiumRequired
      ? 8
      : 24;
  const videoAllowedDurationsSeconds = ([8, 16, 24] as const).filter(
    (duration) => duration <= videoMaxDurationSeconds,
  );
  return {
    accountId: typeof source.accountId === "string" ? source.accountId : null,
    edition: typeof source.edition === "string" ? source.edition : null,
    unlimited: source.unlimited === true,
    periodStart:
      typeof source.periodStart === "string" ? source.periodStart : null,
    resetAt: typeof source.resetAt === "string" ? source.resetAt : null,
    studioEnabled: source.studioEnabled !== false,
    videoLongFormPremiumRequired,
    videoMaxDurationSeconds,
    videoAllowedDurationsSeconds,
    image: normalizeCounter(source.image ?? source.images),
    video: normalizeCounter(source.video ?? source.videos),
  };
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const source = payload as Record<string, unknown>;
  for (const candidate of [
    source.userMessage,
    source.user_message,
    source.message,
    source.error,
  ]) {
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim();
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
  idea: string
) {
  return JSON.stringify({
    kind: request.kind,
    subjectSource: request.subjectSource,
    idea,
    aiInstruction: String(request.aiInstruction || "").trim(),
    withText: Boolean(request.withText),
    textKeywords: request.withText ? request.textKeywords : [],
    withMusic: request.kind === "video" && Boolean(request.withMusic),
    withNarration: request.kind === "video" && Boolean(request.withNarration),
    narrationVoice:
      request.kind === "video" && request.withNarration
        ? request.narrationVoice || "female"
        : null,
    format: request.format,
    typology: request.typology,
    visualStyle: request.visualStyle,
    imageStyle: request.imageStyle,
    shotType: request.shotType,
    peopleMode: request.peopleMode,
    creativity: request.creativity,
    useBrandColors: request.useBrandColors,
    logoMode: request.logoMode,
    videoEngine:
      request.kind === "video" ? request.videoEngine || "omni" : null,
    teamVideoMode:
      request.kind === "video" &&
      (request.identityMode || request.videoCharacterMode) === "reference_team"
        ? request.teamVideoMode || "montage"
        : null,
    teamVideoSpeechMode:
      request.kind === "video" &&
      (request.identityMode || request.videoCharacterMode) === "reference_team" &&
      request.teamVideoMode === "cinematic"
        ? request.teamVideoSpeechMode || "voiceover"
        : null,
    teamVideoVeoConsent:
      request.kind === "video" &&
      (request.identityMode || request.videoCharacterMode) === "reference_team" &&
      request.teamVideoMode === "cinematic" &&
      Boolean(request.teamVideoVeoConsent),
    identityMode:
      request.peopleMode !== "none"
        ? request.identityMode || request.videoCharacterMode || "auto"
        : "auto",
    identityConsent:
      request.peopleMode !== "none" && Boolean(request.identityConsent),
    identityReferenceSetId:
      request.peopleMode !== "none" && request.inspirationImages?.length
        ? request.identityReferenceSetId || ""
        : "",
    durationSeconds:
      request.kind === "video" ? request.durationSeconds || 16 : null,
    inspirationImages:
      request.peopleMode !== "none"
        ? (request.inspirationImages || []).map((image) => ({
            mimeType: image.mimeType,
            length: image.data.length,
          }))
        : [],
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
  return response
    .text()
    .then((text) => (text ? { message: text } : null))
    .catch(() => null);
}

function waitForDraftAcceptanceRetry(delayMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
}

function isRetryableDraftAcceptanceStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
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
      readErrorMessage(
        payload,
        "Le brouillon temporaire n’a pas pu être supprimé."
      )
    );
  }
}

export default function useMediaGeneration() {
  const [quota, setQuota] = useState<MediaGenerationQuota | null>(null);
  const [status, setStatus] = useState<MediaGenerationStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MediaGenerationResult | null>(null);
  const [cancellable, setCancellable] = useState(false);
  const [originChangedNotice, setOriginChangedNotice] = useState(false);
  const quotaRef = useRef<MediaGenerationQuota | null>(null);
  const resultRef = useRef<MediaGenerationResult | null>(null);
  const progressRef = useRef(0);
  const generationKindRef = useRef<MediaGenerationKind>("image");
  const completionStartedRef = useRef(false);
  const accountEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const pendingGenerationAttemptRef = useRef<{
    key: string;
    requestId: string;
  } | null>(null);
  const generationAbortRef = useRef<{
    controller: AbortController;
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
      generationAbortRef.current?.controller.abort();
      generationAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status !== "generating") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (completionStartedRef.current) return current;
        const elapsedSeconds = (Date.now() - startedAt) / 1_000;
        const estimated = estimateGenerationProgress(
          elapsedSeconds,
          generationKindRef.current
        );
        // Math.max est volontairement à l'extérieur : une ancienne pulsation
        // ne peut jamais faire redescendre 100 % vers le plafond d'attente.
        const next = Math.max(current, Math.min(94, estimated));
        progressRef.current = next;
        return next;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [status]);

  const loadQuota = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const requestEpoch = accountEpochRef.current;
      const requestKey = {};
      const currentRequest = quotaRequestRef.current;
      if (!force && currentRequest?.epoch === requestEpoch) {
        return currentRequest.promise;
      }

      const request = (async () => {
        if (mountedRef.current) {
          setStatus((current) =>
            current === "generating" ? current : "loading-quota"
          );
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
            throw new Error(
              readErrorMessage(
                payload,
                "Impossible de charger le quota de génération."
              )
            );
          }
          const normalized = normalizeQuota(
            payload && typeof payload === "object" && "quota" in payload
              ? (payload as { quota?: unknown }).quota
              : payload
          );
          if (mountedRef.current && requestEpoch === accountEpochRef.current) {
            quotaRef.current = normalized;
            setQuota(normalized);
            setStatus((current) =>
              current === "generating" ? current : "idle"
            );
          }
          return normalized;
        } catch (caught) {
          if (mountedRef.current && requestEpoch === accountEpochRef.current) {
            setError(
              caught instanceof Error
                ? caught.message
                : "Impossible de charger le quota de génération."
            );
            setStatus((current) =>
              current === "generating" ? current : "error"
            );
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
    },
    []
  );

  useEffect(() => {
    const handleActiveAccountChange = () => {
      generationAbortRef.current?.controller.abort();
      generationAbortRef.current = null;
      const previousResult = resultRef.current;
      if (previousResult?.draft) {
        // The endpoint is idempotent. If the account switch already reached
        // the server, the 24 h cleanup remains the final safety net.
        void discardMediaGenerationDraft(previousResult.item.id).catch(
          () => undefined
        );
      }
      accountEpochRef.current += 1;
      quotaRef.current = null;
      resultRef.current = null;
      pendingGenerationAttemptRef.current = null;
      setQuota(null);
      setResult(null);
      setError("");
      setOriginChangedNotice(false);
      setCancellable(false);
      completionStartedRef.current = false;
      progressRef.current = 0;
      setProgress(0);
      setStatus("loading-quota");
      void loadQuota({ force: true });
    };

    window.addEventListener(
      ACTIVE_INRCY_ACCOUNT_EVENT,
      handleActiveAccountChange
    );
    return () =>
      window.removeEventListener(
        ACTIVE_INRCY_ACCOUNT_EVENT,
        handleActiveAccountChange
      );
  }, [loadQuota]);

  const generate = useCallback(
    async (request: MediaGenerationRequest) => {
      const idea = String(request.idea || "").trim();
      if (request.subjectSource !== "profile" && !idea) {
        throw new Error(
          "Ajoutez une idée ou un contenu avant de générer le média."
        );
      }
      const attemptKey = buildGenerationAttemptKey(request, idea);
      const previousAttempt = pendingGenerationAttemptRef.current;
      const requestId =
        previousAttempt?.key === attemptKey
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
      generationAbortRef.current?.controller.abort();
      const controller = new AbortController();
      const activeGeneration = { controller, requestId };
      generationAbortRef.current = activeGeneration;
      generationKindRef.current = request.kind;
      completionStartedRef.current = false;
      progressRef.current = 4;
      setStatus("generating");
      setProgress(4);
      setError("");
      setResult(null);
      setOriginChangedNotice(false);
      setCancellable(true);

      try {
        const response = await fetch("/api/media-generation/generate", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contractVersion: 4,
            requestId,
            kind: request.kind,
            subjectSource: request.subjectSource,
            idea,
            aiInstruction: String(request.aiInstruction || "").trim(),
            withText: Boolean(request.withText),
            textKeywords: request.withText ? request.textKeywords : [],
            withMusic:
              request.kind === "video" ? Boolean(request.withMusic) : undefined,
            withNarration:
              request.kind === "video"
                ? Boolean(request.withNarration)
                : undefined,
            narrationVoice:
              request.kind === "video" && request.withNarration
                ? request.narrationVoice || "female"
                : undefined,
            format: request.format,
            typology: request.typology,
            visualStyle: request.visualStyle,
            imageStyle: request.imageStyle,
            shotType: request.shotType,
            peopleMode: request.peopleMode,
            creativity: request.creativity,
            useBrandColors: request.useBrandColors,
            logoMode: request.logoMode,
            videoEngine:
              request.kind === "video"
                ? request.videoEngine || "omni"
                : undefined,
            teamVideoMode:
              request.kind === "video" &&
              (request.identityMode || request.videoCharacterMode) === "reference_team"
                ? request.teamVideoMode || "montage"
                : undefined,
            teamVideoSpeechMode:
              request.kind === "video" &&
              (request.identityMode || request.videoCharacterMode) === "reference_team" &&
              request.teamVideoMode === "cinematic"
                ? request.teamVideoSpeechMode || "voiceover"
                : undefined,
            teamVideoVeoConsent:
              request.kind === "video" &&
              (request.identityMode || request.videoCharacterMode) === "reference_team" &&
              request.teamVideoMode === "cinematic"
                ? Boolean(request.teamVideoVeoConsent)
                : undefined,
            identityMode:
              request.peopleMode !== "none"
                ? request.identityMode || request.videoCharacterMode || "auto"
                : "auto",
            // Alias envoyé pendant la transition pour les serveurs vidéo plus anciens.
            videoCharacterMode:
              request.kind === "video"
                ? request.identityMode || request.videoCharacterMode || "auto"
                : undefined,
            identityConsent:
              request.peopleMode !== "none"
                ? Boolean(request.identityConsent)
                : undefined,
            identityReferenceSetId:
              request.peopleMode !== "none" && request.inspirationImages?.length
                ? request.identityReferenceSetId
                : undefined,
            durationSeconds:
              request.kind === "video"
                ? request.durationSeconds || 16
                : undefined,
            inspirationImages:
              request.peopleMode !== "none"
                ? (request.inspirationImages || []).map((image) => ({
                    mimeType: image.mimeType,
                    data: image.data,
                  }))
                : undefined,
            source: request.source,
          }),
        });
        if (generationAbortRef.current === activeGeneration) {
          setCancellable(false);
        }
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
          throw new Error(
            readErrorMessage(payload, "La génération du média a échoué.")
          );
        }
        // Une réponse 2xx tronquée reste incertaine : le serveur a pu enregistrer
        // le média. Conserver l'id permet au retry de rejouer le job au lieu de
        // payer une seconde génération.
        if (!payload || typeof payload !== "object") {
          throw new Error(
            "La réponse de génération est incomplète. Réessayez."
          );
        }
        const data = payload as Record<string, unknown>;
        if (data.ok !== true || !data.item || typeof data.item !== "object") {
          throw new Error(
            readErrorMessage(payload, "Le média généré est incomplet.")
          );
        }
        if (!mountedRef.current || requestEpoch !== accountEpochRef.current) {
          if (mountedRef.current) {
            setOriginChangedNotice(true);
            void loadQuota({ force: true });
          }
          throw new MediaGenerationAccountChangedError();
        }
        clearCurrentAttempt();
        const hasReturnedQuota = Boolean(
          data.quota && typeof data.quota === "object"
        );
        const normalizedQuota = hasReturnedQuota
          ? normalizeQuota(data.quota)
          : quotaRef.current || normalizeQuota(null);
        const soundtrackSource =
          data.soundtrack && typeof data.soundtrack === "object"
            ? (data.soundtrack as Record<string, unknown>)
            : null;
        const soundtrack =
          soundtrackSource && typeof soundtrackSource.id === "string"
            ? {
                id: soundtrackSource.id,
                name:
                  typeof soundtrackSource.name === "string"
                    ? soundtrackSource.name
                    : soundtrackSource.id,
              }
            : null;
        const rawVideoEngineResult = data.videoEngineResult;
        const videoEngineResult: MediaGenerationVideoEngineResult | null =
          rawVideoEngineResult === "omni" ||
          rawVideoEngineResult === "veo" ||
          rawVideoEngineResult === "omni_veo_fallback"
            ? rawVideoEngineResult
            : null;
        const nextResult: MediaGenerationResult = {
          item: data.item as MediaLibraryPickerItem,
          quota: normalizedQuota,
          soundtrack,
          videoEngineResult,
          draft: data.draft !== false,
        };
        if (mountedRef.current) {
          completionStartedRef.current = true;
          if (hasReturnedQuota) {
            quotaRef.current = normalizedQuota;
            setQuota(normalizedQuota);
          }
          await animateProgressToCompletion({
            from: progressRef.current,
            isActive: () =>
              mountedRef.current &&
              requestEpoch === accountEpochRef.current &&
              generationAbortRef.current === activeGeneration &&
              !controller.signal.aborted,
            onProgress: (value) => {
              progressRef.current = Math.max(progressRef.current, value);
              setProgress((current) => Math.max(current, value));
            },
          });
        }
        if (!mountedRef.current || requestEpoch !== accountEpochRef.current) {
          throw new MediaGenerationAccountChangedError();
        }
        if (
          controller.signal.aborted ||
          generationAbortRef.current !== activeGeneration
        ) {
          throw new MediaGenerationCancelledError();
        }
        if (mountedRef.current) {
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
          caught instanceof MediaGenerationCancelledError ||
          controller.signal.aborted ||
          (caught instanceof DOMException && caught.name === "AbortError")
        ) {
          if (mountedRef.current && requestEpoch === accountEpochRef.current) {
            completionStartedRef.current = false;
            progressRef.current = 0;
            setCancellable(false);
            setError("");
            setStatus("idle");
            setProgress(0);
          }
          throw new MediaGenerationCancelledError();
        }
        if (!mountedRef.current || requestEpoch !== accountEpochRef.current) {
          throw new MediaGenerationAccountChangedError();
        }
        const message =
          caught instanceof Error
            ? caught.message
            : "La génération du média a échoué.";
        if (mountedRef.current) {
          completionStartedRef.current = false;
          setError(message);
          progressRef.current = 0;
          setStatus("error");
          setProgress(0);
        }
        throw caught instanceof Error ? caught : new Error(message);
      } finally {
        if (generationAbortRef.current === activeGeneration) {
          generationAbortRef.current = null;
          if (mountedRef.current) setCancellable(false);
        }
      }
    },
    [loadQuota]
  );

  const cancelGeneration = useCallback(() => {
    const active = generationAbortRef.current;
    if (!active) return false;
    generationAbortRef.current = null;
    active.controller.abort();
    completionStartedRef.current = false;
    progressRef.current = 0;
    if (mountedRef.current) {
      setCancellable(false);
      setError("");
      setStatus("idle");
      setProgress(0);
    }
    return true;
  }, []);

  const acceptDraft = useCallback(
    async (candidate?: MediaGenerationResult | null) => {
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
      let acceptedItem: MediaLibraryPickerItem | null = null;
      let lastAcceptanceError = new Error(
        "Le média n’a pas pu être enregistré. Réessayez : le même média sera conservé."
      );

      // POST est idempotent côté serveur. Une réponse perdue après la promotion
      // du brouillon peut donc être rejouée sans créer de fichier ni consommer
      // un second quota.
      for (
        let attempt = 0;
        attempt < DRAFT_ACCEPT_RETRY_DELAYS_MS.length;
        attempt += 1
      ) {
        const delayMs = DRAFT_ACCEPT_RETRY_DELAYS_MS[attempt];
        if (delayMs > 0) await waitForDraftAcceptanceRetry(delayMs);
        if (!mountedRef.current || requestEpoch !== accountEpochRef.current) {
          throw new MediaGenerationAccountChangedError();
        }

        let retryableFailure = true;
        try {
          const response = await fetch(
            `${mediaDraftEndpoint(requested.item.id)}/accept`,
            {
              method: "POST",
              credentials: "include",
              cache: "no-store",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ contractVersion: 2 }),
            }
          );
          const payload = await readJson(response);
          const data =
            payload && typeof payload === "object"
              ? (payload as Record<string, unknown>)
              : null;

          if (
            response.ok &&
            data?.ok === true &&
            data.item &&
            typeof data.item === "object"
          ) {
            acceptedItem = data.item as MediaLibraryPickerItem;
            break;
          }

          lastAcceptanceError = new Error(
            readErrorMessage(
              payload,
              response.ok
                ? "La réponse de validation du média est incomplète."
                : "Le média n’a pas pu être enregistré."
            )
          );
          if (!response.ok && !isRetryableDraftAcceptanceStatus(response.status)) {
            retryableFailure = false;
          }
        } catch (caught) {
          if (caught instanceof MediaGenerationAccountChangedError) throw caught;
          lastAcceptanceError =
            caught instanceof Error ? caught : lastAcceptanceError;
        }
        const isLastAttempt =
          attempt === DRAFT_ACCEPT_RETRY_DELAYS_MS.length - 1;
        if (!retryableFailure || isLastAttempt) throw lastAcceptanceError;
      }

      if (!acceptedItem) throw lastAcceptanceError;
      if (!mountedRef.current || requestEpoch !== accountEpochRef.current) {
        throw new MediaGenerationAccountChangedError();
      }

      const acceptedResult: MediaGenerationResult = {
        ...requested,
        item: acceptedItem,
        draft: false,
      };
      resultRef.current = acceptedResult;
      setResult(acceptedResult);
      return acceptedResult;
    },
    []
  );

  const discardDraft = useCallback(
    async (candidate?: MediaGenerationResult | null) => {
      const requested = candidate || resultRef.current;
      if (!requested || !requested.draft) return;

      await discardMediaGenerationDraft(requested.item.id);
      if (resultRef.current?.item.id === requested.item.id) {
        resultRef.current = null;
        setResult(null);
        completionStartedRef.current = false;
        progressRef.current = 0;
        setProgress(0);
        setError("");
        setStatus("idle");
      }
    },
    []
  );

  const reset = useCallback(() => {
    generationAbortRef.current?.controller.abort();
    generationAbortRef.current = null;
    pendingGenerationAttemptRef.current = null;
    resultRef.current = null;
    completionStartedRef.current = false;
    progressRef.current = 0;
    setStatus("idle");
    setProgress(0);
    setError("");
    setResult(null);
    setOriginChangedNotice(false);
    setCancellable(false);
  }, []);

  return {
    quota,
    status,
    progress,
    error,
    result,
    originChangedNotice,
    cancellable,
    busy: status === "generating",
    quotaLoading: status === "loading-quota",
    loadQuota,
    generate,
    cancelGeneration,
    acceptDraft,
    discardDraft,
    reset,
  };
}
