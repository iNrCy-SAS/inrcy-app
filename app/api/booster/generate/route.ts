import { after, NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import {
  commitAiCredits,
  computeBoosterAiCredits,
  reserveAiCredits,
  rollbackAiCredits,
  isAdminUserForAi,
  type AiCreditReservation,
} from "@/lib/aiUsageQuota";
import { withApi } from "@/lib/observability/withApi";
import { generateSharedBoosterPosts } from "@/lib/boosterPublishGeneration";
import { INR_MEDIA_VIDEO_SOURCE_MAX_BYTES } from "@/lib/mediaRules";
import {
  type BoosterChannels,
  type BoosterStyle,
  type BoosterTheme,
} from "@/lib/boosterPrompt";
import {
  normalizeAiPreferredEngine,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";
import { getBoosterGenerationContext } from "@/lib/boosterGenerationContext";
import { readBoosterGenerationRequest } from "@/lib/boosterGenerationRequestTransport";
import { loadPersistedInrAgentVideoForAi } from "@/lib/inrAgentVideoContextCache";
import {
  normalizeVideoAiContextReference,
  type VideoAiContextReference,
} from "@/lib/videoAiContextReference";
import { aiTranscribeMedia } from "@/lib/aiGatewayTranscription";
import {
  MediaWorkspaceConsumptionError,
  resolveWorkspaceAiConsumption,
  syncPublicationWorkspaceContext,
} from "@/lib/mediaWorkspaceConsumption";
import { isLegacyMediaTransportCutoverEnabled } from "@/lib/mediaPipelineLegacyCutoverPolicy";
import type { WorkspaceAiConsumptionDiagnostics } from "@/lib/workspaceAiMixedConsumption";
import { normalizeBoosterGenerationRequestId } from "@/lib/boosterGenerationRecovery";

export const maxDuration = 120;

const BOOSTER_GENERATION_BURST_LIMIT = 20;
const BOOSTER_GENERATION_SAFETY_BUDGET_MS = 105_000;
const BOOSTER_GENERATION_CLOSE_MARGIN_MS = 1_500;
// Le média est un enrichissement. Même une lecture Supabase dégradée ne
// peut consommer le budget réservé à la rédaction multicanale.
const BOOSTER_MEDIA_CONTEXT_SAFETY_BUDGET_MS = 7_500;

type Payload = {
  creationMode?: "ai" | "manual";
  generationRequestId?: string;
  generationDeadlineAt?: number;
  mediaWorkspaceId?: string;
  mediaPipelineCutoverV1?: boolean;
  mediaWorkspaceExpected?: boolean;
  useWorkspaceMediaForAI?: boolean;
  idea?: string;
  publicationInstruction?: string;
  theme?: BoosterTheme;
  style?: BoosterStyle;
  aiPreferredEngine?: AiPreferredEngine;
  channels?: BoosterChannels[];
  mediaType?: "images" | "video";
  useImagesForAI?: boolean;
  imageCount?: number;
  imagesForAI?: Array<{ name?: string; type?: string; dataUrl?: string }>;
  videoForAI?: {
    name?: string;
    type?: string;
    size?: number;
    duration?: number | null;
    source?: "browser_file" | "supabase_storage";
    storagePath?: string;
    publicUrl?: string;
    url?: string;
    visualFrames?: Array<{
      name?: string;
      type?: string;
      dataUrl?: string;
      frameTarget?: "start" | "middle" | "end";
      timeSeconds?: number;
    }>;
    audioTranscript?: string | null;
    rawAudioTranscript?: string | null;
    contextRef?: VideoAiContextReference | null;
    analysisPlan?: {
      visualFrames?: "pending" | "ready";
      audioTranscript?: "pending" | "ready" | "unavailable";
      frameTargets?: Array<"start" | "middle" | "end">;
    };
  } | null;
};

function generationDeadlineError() {
  return Object.assign(
    new Error(
      "La génération a dépassé son délai de sécurité. Merci de relancer.",
    ),
    { code: "ai_operation_deadline_exceeded", status: 504 },
  );
}

function assertGenerationBudget(deadlineAt: number, minimumRemainingMs = 250) {
  if (deadlineAt - Date.now() <= minimumRemainingMs) {
    throw generationDeadlineError();
  }
}

async function withinGenerationDeadline<T>(
  promise: Promise<T>,
  deadlineAt: number,
): Promise<T> {
  const remainingMs = deadlineAt - Date.now() - BOOSTER_GENERATION_CLOSE_MARGIN_MS;
  if (remainingMs <= 0) throw generationDeadlineError();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(generationDeadlineError()), remainingMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function mediaContextDeadlineError() {
  return Object.assign(new Error("Le contexte média a dépassé son budget."), {
    code: "workspace_media_context_deadline_exceeded",
  });
}

async function withinMediaContextBudget<T>(
  promise: Promise<T>,
  deadlineAt = Date.now() + BOOSTER_MEDIA_CONTEXT_SAFETY_BUDGET_MS,
): Promise<T> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw mediaContextDeadlineError();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(mediaContextDeadlineError()),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

type MediaAnalysisFallback = {
  used: true;
  code: string;
  message: string;
};

function buildMediaAnalysisFallback(
  code: unknown,
  family: "images" | "video" | "media",
): MediaAnalysisFallback {
  const normalizedCode = String(code || "media_analysis_unavailable")
    .trim()
    .slice(0, 160);
  const audioOnly = /audio|transcri/i.test(normalizedCode);
  return {
    used: true,
    code: normalizedCode || "media_analysis_unavailable",
    message: audioOnly
      ? "Analyse audio indisponible : contenus générés à partir de votre phrase et de votre profil."
      : family === "media"
        ? "Analyse du média indisponible : contenus générés à partir de votre phrase et de votre profil."
        : "Analyse visuelle indisponible : contenus générés à partir de votre phrase et de votre profil.",
  };
}

type BoosterAiImage = {
  dataUrl: string;
  detail: "low" | "high" | "auto";
};

type BoosterVideoContext = {
  mimeType: string;
  size: number | null;
  duration: number | null;
  source: "browser_file" | "supabase_storage";
  storagePath: string;
  publicUrl: string;
  frameCount: number;
  audioTranscript: string;
  analysisPlan: {
    visualFrames: "pending" | "ready";
    audioTranscript: "pending" | "ready" | "unavailable";
    frameTargets: Array<"start" | "middle" | "end">;
  };
};

type JsonRecord = Record<string, unknown>;

const allowedChannels: BoosterChannels[] = [
  "inrcy_site",
  "site_web",
  "inr_search",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
];
const allowedThemes: BoosterTheme[] = [
  "",
  "promotion",
  "information",
  "conseil",
  "avis_client",
  "realisation",
  "actualite",
  "autre",
];
const allowedStyles: BoosterStyle[] = ["sobre", "equilibre", "dynamique"];
const siteChannels = new Set<BoosterChannels>(["inrcy_site", "site_web", "inr_search"]);
const AI_IMAGE_MAX_COUNT = 5;
const AI_IMAGE_MAX_DATA_URL_LENGTH = 3_500_000;
const AI_IMAGE_MAX_TOTAL_DATA_URL_LENGTH = 10_000_000;
const AI_IMAGE_DATA_URL_RE =
  /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const BOOSTER_MAX_VIDEO_BYTES = INR_MEDIA_VIDEO_SOURCE_MAX_BYTES;
const BOOSTER_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
]);

function normalizeGenerationMediaType(value: unknown): "images" | "video" {
  return value === "video" ? "video" : "images";
}

function cleanVideoTranscript(value: unknown, maxLength = 1800) {
  return String(value || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, "")
    .slice(0, maxLength)
    .trim();
}
function sanitizeImagesForAI(body: Payload): BoosterAiImage[] {
  if (!body.useImagesForAI || !Array.isArray(body.imagesForAI)) return [];

  const images: BoosterAiImage[] = [];
  let totalLength = 0;

  for (const image of body.imagesForAI.slice(0, AI_IMAGE_MAX_COUNT)) {
    const dataUrl = String(image?.dataUrl || "").trim();
    if (
      !dataUrl ||
      dataUrl.length > AI_IMAGE_MAX_DATA_URL_LENGTH ||
      !AI_IMAGE_DATA_URL_RE.test(dataUrl)
    ) {
      continue;
    }

    totalLength += dataUrl.length;
    if (totalLength > AI_IMAGE_MAX_TOTAL_DATA_URL_LENGTH) break;

    images.push({ dataUrl, detail: "low" });
  }

  return images;
}

function sanitizeVideoFramesForAI(body: Payload): BoosterAiImage[] {
  if (normalizeGenerationMediaType(body.mediaType) !== "video") return [];
  const frames = Array.isArray(body.videoForAI?.visualFrames)
    ? body.videoForAI?.visualFrames
    : [];

  const images: BoosterAiImage[] = [];
  let totalLength = 0;

  for (const frame of frames.slice(0, 3)) {
    const dataUrl = String(frame?.dataUrl || "").trim();
    if (
      !dataUrl ||
      dataUrl.length > AI_IMAGE_MAX_DATA_URL_LENGTH ||
      !AI_IMAGE_DATA_URL_RE.test(dataUrl)
    ) {
      continue;
    }

    totalLength += dataUrl.length;
    if (totalLength > AI_IMAGE_MAX_TOTAL_DATA_URL_LENGTH) break;

    images.push({ dataUrl, detail: "low" });
  }

  return images;
}

function sanitizeVideoForAI(body: Payload): BoosterVideoContext | null {
  if (normalizeGenerationMediaType(body.mediaType) !== "video") return null;
  const video = body.videoForAI;
  if (!video || typeof video !== "object") return null;

  const mimeType = String(video.type || "")
    .toLowerCase()
    .trim();
  const size = Number(video.size || 0);
  const duration = Number(video.duration || 0);

  const source =
    video.source === "supabase_storage" ? "supabase_storage" : "browser_file";
  const frameTargets = Array.isArray(video.analysisPlan?.frameTargets)
    ? video.analysisPlan.frameTargets.filter(
        (target): target is "start" | "middle" | "end" =>
          target === "start" || target === "middle" || target === "end",
      )
    : [];

  const audioTranscript = cleanVideoTranscript(
    video.audioTranscript || video.rawAudioTranscript,
  );
  const requestedAudioStatus = video.analysisPlan?.audioTranscript;

  return {
    mimeType: BOOSTER_VIDEO_MIME_TYPES.has(mimeType) ? mimeType : "video/mp4",
    size:
      Number.isFinite(size) && size > 0 && size <= BOOSTER_MAX_VIDEO_BYTES
        ? size
        : null,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    source,
    storagePath: String(video.storagePath || "").trim(),
    publicUrl: String(video.publicUrl || video.url || "").trim(),
    frameCount: Array.isArray(video.visualFrames)
      ? video.visualFrames.length
      : 0,
    audioTranscript,
    analysisPlan: {
      visualFrames:
        Array.isArray(video.visualFrames) &&
        video.visualFrames.length > 0 &&
        video.analysisPlan?.visualFrames === "ready"
          ? "ready"
          : "pending",
      audioTranscript: audioTranscript
        ? "ready"
        : requestedAudioStatus === "unavailable"
          ? "unavailable"
          : "pending",
      frameTargets: frameTargets.length
        ? frameTargets
        : ["start", "middle", "end"],
    },
  };
}

function formatVideoDurationLabel(seconds: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) return `${rounded} seconde${rounded > 1 ? "s" : ""}`;
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

function buildVideoGenerationInstructions(
  video: BoosterVideoContext | null,
  standaloneImageCount = 0,
): string {
  if (!video) return "";

  const safeImageCount = Math.max(0, Math.min(5, standaloneImageCount));
  if (safeImageCount > 0) {
    const videoInstructions: string = buildVideoGenerationInstructions(video, 0).replace(
      /^- Ne pas parler de photo.*$/m,
      "- Les images originales et les captures vidéo décrivent le même sujet : croiser les indices cohérents, ignorer les éléments ambigus et ne rien inventer.",
    );
    return `Contexte média mixte : ${safeImageCount} image${safeImageCount > 1 ? "s" : ""} originale${safeImageCount > 1 ? "s" : ""} et 1 vidéo alimentent ensemble cette génération multicanale. Chaque canal doit conserver son propre texte optimisé.\n\n${videoInstructions}`;
  }

  const durationLabel = formatVideoDurationLabel(video.duration);
  const metadata = [
    durationLabel ? `durée approximative : ${durationLabel}` : "",
    video.mimeType
      ? `format : ${video.mimeType.replace("video/", "").toUpperCase()}`
      : "",
  ]
    .filter(Boolean)
    .join(" ; ");
  const frameContext =
    video.analysisPlan.visualFrames === "ready" && video.frameCount > 0
      ? `Des captures extraites de la vidéo sont jointes au prompt (début, milieu, fin quand possible). Utilise-les pour enrichir le contenu avec des détails visibles, sans changer le sujet principal donné par la phrase libre.`
      : `Aucune capture exploitable n'est disponible : rédiger principalement à partir de l'intention libre du pro, des informations de son profil et du canal demandé.`;
  const audioContext = video.audioTranscript
    ? `Transcription audio détectée dans la vidéo :
"""${video.audioTranscript}"""
Utilise cette transcription comme contexte prioritaire pour comprendre ce qui est dit, les mots métier, les noms, les offres ou les précisions commerciales. Ne la cite pas forcément mot pour mot, transforme-la en publication propre.`
    : video.analysisPlan.audioTranscript === "unavailable"
      ? `Aucune parole exploitable n'a été détectée ou la transcription audio vidéo est indisponible : rédiger sans bloquer la génération.`
      : `La transcription audio vidéo n'est pas disponible : rédiger sans attendre l'audio.`;

  return `Contexte média fourni : 1 vidéo est jointe à la publication${metadata ? ` (${metadata})` : ""}.

${audioContext}

Règles vidéo obligatoires :
- La génération est en mode vidéo : le texte doit être adapté à une publication vidéo.
- ${frameContext}
- La phrase libre reste le sujet principal. La transcription audio complète l'intention quand elle existe ; si elle contredit clairement la phrase libre, privilégier la phrase libre.
- Les captures vidéo servent à préciser l'ambiance, le geste métier, le résultat visible, le produit, le lieu apparent ou le contexte quand c'est cohérent.
- Adapter le texte à une publication vidéo : accroche plus vivante, phrases concrètes, CTA qui incite à découvrir la réalisation, le produit, le conseil ou le moment présenté.
- Ne jamais inventer ce qui se voit ou s'entend dans la vidéo : lieu, personne, marque, avant/après, résultat précis, prix, certification, date, avis client ou détail technique non fourni.
- Si une capture est floue, ambiguë ou peu utile, l'ignorer plutôt que d'inventer.
- Ne pas écrire "on voit dans la vidéo", "regardez cette vidéo" ou "comme montré" si l'intention libre ne le permet pas.
- Ne pas parler de photo, d'image, de carrousel ou de visuel statique.
- Pour Instagram et Facebook : ton plus direct, dynamique et immersif.
- Pour LinkedIn : transformer le support vidéo en preuve de méthode, sérieux ou expertise.
- Pour Google Business : rester sobre, factuel et local.
- Pour Site iNrCy / Site web : utiliser la vidéo comme preuve de terrain, sans affirmer de détails non fournis.`;
}

const handler = async (req: Request) => {
  const routeStartedAt = Date.now();
  const generationDeadlineAt =
    routeStartedAt + BOOSTER_GENERATION_SAFETY_BUDGET_MS;
  let quotaReservation: AiCreditReservation | null = null;
  let generationMs = 0;
  let mediaAnalysisFallback: MediaAnalysisFallback | null = null;
  let persistedVideoContextFallback: MediaAnalysisFallback | null = null;
  const timingContext: {
    userId?: string;
    engine?: AiPreferredEngine;
    selectedChannels?: number;
    mediaType?: string;
    imageCount?: number;
    videoFrameCount?: number;
    contextLoadMs?: number;
    professionalContextSource?: string;
    publicationsContextSource?: string;
    requestTransport?: "json" | "multipart";
    requestParseMs?: number;
    requestContentLength?: number;
    generationRequestId?: string;
    videoContextLoadMs?: number;
    videoContextReferenceSource?: "none" | "hit" | "invalid";
    mediaWorkspaceId?: string;
    mediaWorkspaceLoadMs?: number;
    mediaWorkspaceRevision?: number;
    mediaWorkspaceSource?:
      | "none"
      | "workspace"
      | "workspace_cutover_v1"
      | "workspace_verified_client_video_context"
      | "legacy_fallback";
    mediaWorkspaceFallbackCode?: string;
    mediaWorkspaceDiagnostics?: WorkspaceAiConsumptionDiagnostics;
  } = {};
  try {
    const { supabase, authUserId, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;
    const userId = activeUserId;
    timingContext.userId = userId;

    const isAdmin = await isAdminUserForAi(supabase, authUserId);

    if (!isAdmin) {
      const rl = await enforceRateLimit({
        name: "booster_generate",
        identifier: authUserId,
        limit: BOOSTER_GENERATION_BURST_LIMIT,
        window: "1 m",
        failClosed: true,
        code: "booster_generation_burst_limit",
      });
      if (rl) return rl;
    }

    const requestContentLength = Number(
      req.headers.get("content-length") || 0,
    );
    if (Number.isFinite(requestContentLength) && requestContentLength > 0) {
      timingContext.requestContentLength = requestContentLength;
    }
    const requestParseStartedAt = Date.now();
    const parsedRequest = await readBoosterGenerationRequest(req);
    const body = parsedRequest.body as Payload;
    const generationRequestId = normalizeBoosterGenerationRequestId(
      body.generationRequestId,
    );
    // Never clamp a server deadline with an absolute browser timestamp. The
    // client clock can drift and its media preparation happens before this
    // route starts. The browser keeps its own AbortController UX deadline;
    // every server-side operation shares this route-entry safety budget.
    assertGenerationBudget(generationDeadlineAt);
    timingContext.requestTransport = parsedRequest.transport;
    timingContext.requestParseMs = Date.now() - requestParseStartedAt;
    timingContext.generationRequestId = generationRequestId || undefined;
    if (body.creationMode === "manual") {
      return NextResponse.json(
        {
          code: "manual_generation_forbidden",
          error:
            "La génération IA est désactivée dans le parcours Créer manuellement.",
        },
        { status: 400 },
      );
    }
    const idea = (body?.idea || "").trim();
    const publicationInstruction = String(
      body?.publicationInstruction || "",
    )
      .replace(/\u0000/g, "")
      .trim()
      .slice(0, 4_000);
    if (!idea) {
      return NextResponse.json({ error: "Idée manquante." }, { status: 400 });
    }

    const theme = allowedThemes.includes(body?.theme as BoosterTheme)
      ? (body.theme as BoosterTheme)
      : "information";
    const style = allowedStyles.includes(body?.style as BoosterStyle)
      ? (body.style as BoosterStyle)
      : "equilibre";
    const aiPreferredEngine = body?.aiPreferredEngine
      ? normalizeAiPreferredEngine(body.aiPreferredEngine)
      : undefined;
    timingContext.engine = aiPreferredEngine;

    const channels = Array.from(
      new Set(
        (Array.isArray(body?.channels) ? body.channels : []).filter(
          (c): c is BoosterChannels =>
            allowedChannels.includes(c as BoosterChannels),
        ),
      ),
    );
    if (!channels.length) {
      return NextResponse.json({ error: "Canaux manquants." }, { status: 400 });
    }
    timingContext.selectedChannels = channels.length;

    let mediaType = normalizeGenerationMediaType(body.mediaType);
    const strictMediaCutover =
      body.mediaPipelineCutoverV1 === true &&
      isLegacyMediaTransportCutoverEnabled();
    let effectiveBody: Payload = strictMediaCutover
      ? {
          ...body,
          imagesForAI: [],
          imageCount: 0,
          useImagesForAI: false,
          // Pour une vidéo fraîchement envoyée, les captures JPEG peuvent déjà
          // être prêtes dans le navigateur. Elles complètent l'original conservé
          // dans le workspace, qui reste obligatoire et vérifié.
          videoForAI: mediaType === "video" ? body.videoForAI : null,
        }
      : body;
    const mediaWorkspaceId = String(body.mediaWorkspaceId || "").trim();
    const mediaWorkspaceExpected = body.mediaWorkspaceExpected === true;
    let useWorkspaceMediaForAI =
      body.useWorkspaceMediaForAI === true ||
      (body.useWorkspaceMediaForAI !== false && mediaWorkspaceExpected);
    if (
      strictMediaCutover &&
      mediaWorkspaceExpected &&
      (!useWorkspaceMediaForAI || !mediaWorkspaceId)
    ) {
      useWorkspaceMediaForAI = false;
      mediaAnalysisFallback = buildMediaAnalysisFallback(
        "media_workspace_required",
        "media",
      );
      console.warn("[booster-generate] workspace missing, text fallback", {
        mediaWorkspaceExpected,
        mediaType,
      });
    }
    timingContext.mediaWorkspaceId = mediaWorkspaceId || undefined;
    timingContext.mediaWorkspaceSource = "none";
    timingContext.videoContextReferenceSource = "none";
    // The historical cache and the current workspace share one media budget.
    // They can never consume 7.5 seconds each before the text generation.
    const mediaContextDeadlineAt =
      Date.now() + BOOSTER_MEDIA_CONTEXT_SAFETY_BUDGET_MS;
    if (mediaAnalysisFallback) {
      timingContext.mediaWorkspaceSource = "legacy_fallback";
      timingContext.mediaWorkspaceFallbackCode = mediaAnalysisFallback.code;
    }

    if (mediaType === "video" && !strictMediaCutover) {
      const contextRef = normalizeVideoAiContextReference(
        body.videoForAI?.contextRef,
      );
      if (contextRef) {
        const contextLoadStartedAt = Date.now();
        try {
          const persistedVideoContext = await withinMediaContextBudget(
            loadPersistedInrAgentVideoForAi({
              userId,
              reference: contextRef,
            }),
            mediaContextDeadlineAt,
          );
          timingContext.videoContextReferenceSource = persistedVideoContext
            ? "hit"
            : "invalid";

          if (persistedVideoContext) {
            const existingVideo = body.videoForAI || {};
            const existingFrames = Array.isArray(existingVideo.visualFrames)
              ? existingVideo.visualFrames
              : [];
            const persistedFrames = persistedVideoContext.frames.map(
              (frame, index) => ({
                name: `inragent-frame-${index + 1}.jpg`,
                type: "image/jpeg",
                dataUrl: frame.dataUrl,
                frameTarget: (["start", "middle", "end"] as const)[index],
              }),
            );
            const audioTranscript =
              cleanVideoTranscript(existingVideo.audioTranscript) ||
              persistedVideoContext.transcript;

            effectiveBody = {
              ...body,
              videoForAI: {
                ...existingVideo,
                contextRef,
                visualFrames: existingFrames.length
                  ? existingFrames
                  : persistedFrames,
                audioTranscript,
                rawAudioTranscript:
                  cleanVideoTranscript(existingVideo.rawAudioTranscript) ||
                  persistedVideoContext.rawTranscript ||
                  audioTranscript,
                analysisPlan: {
                  ...existingVideo.analysisPlan,
                  visualFrames:
                    existingFrames.length || persistedFrames.length
                      ? "ready"
                      : "pending",
                  audioTranscript: audioTranscript ? "ready" : "unavailable",
                  frameTargets: ["start", "middle", "end"],
                },
              },
            };
          }
        } catch (contextError) {
          const contextErrorCode = String(
            (contextError as { code?: unknown } | null)?.code ||
              "video_context_read_failed",
          );
          timingContext.videoContextReferenceSource = "invalid";
          persistedVideoContextFallback = buildMediaAnalysisFallback(
            contextErrorCode,
            "video",
          );
          console.warn("[booster-generate] persisted video context skipped", {
            code: contextErrorCode,
            message:
              contextError instanceof Error
                ? contextError.message
                : String(contextError || "Erreur inconnue"),
          });
        } finally {
          timingContext.videoContextLoadMs = Date.now() - contextLoadStartedAt;
        }
      }
    }

    if (mediaWorkspaceId && useWorkspaceMediaForAI) {
      const workspaceLoadStartedAt = Date.now();
      try {
        const workspaceMedia = await withinMediaContextBudget(
          resolveWorkspaceAiConsumption({
            accountId: userId,
            workspaceId: mediaWorkspaceId,
            preferredMediaType: mediaType,
            // Product contract: generation consumes images OR video. Mixed
            // image/video assignments are supported later by the publisher.
            allowMixedMedia: false,
            deadlineAt:
              generationDeadlineAt - BOOSTER_GENERATION_CLOSE_MARGIN_MS,
          }),
          mediaContextDeadlineAt,
        );
        timingContext.mediaWorkspaceLoadMs =
          Date.now() - workspaceLoadStartedAt;
        timingContext.mediaWorkspaceRevision =
          workspaceMedia.workspaceRevision;
        timingContext.mediaWorkspaceSource = strictMediaCutover
          ? "workspace_cutover_v1"
          : "workspace";
        timingContext.mediaWorkspaceDiagnostics = workspaceMedia.diagnostics;

        const workspaceHasImages = workspaceMedia.imagesForAI.length > 0;
        const workspaceHasVideo = Boolean(workspaceMedia.videoForAI);
        const workspaceHasUsableFamily =
          workspaceHasImages || workspaceHasVideo;
        let useVerifiedLocalVideoPreview = false;

        if (
          strictMediaCutover &&
          mediaWorkspaceExpected &&
          !workspaceHasUsableFamily
        ) {
          const expectedFamily =
            mediaType === "video" ? ("video" as const) : ("images" as const);
          const expectedDiagnostic =
            workspaceMedia.diagnostics[expectedFamily];
          const localVideo = effectiveBody.videoForAI;
          const localFrames = Array.isArray(localVideo?.visualFrames)
            ? localVideo.visualFrames
            : [];
          const localTranscript = cleanVideoTranscript(
            localVideo?.audioTranscript || localVideo?.rawAudioTranscript,
          );
          useVerifiedLocalVideoPreview =
            expectedFamily === "video" &&
            [
              "workspace_video_frames_pending",
              "workspace_video_frame_unavailable",
              "workspace_video_audio_unavailable",
              "workspace_variant_download_failed",
              "workspace_variant_binary_invalid",
              "workspace_ai_video_deadline_exceeded",
            ].includes(String(expectedDiagnostic.code || "")) &&
            (localFrames.length > 0 || Boolean(localTranscript));

          if (useVerifiedLocalVideoPreview) {
            timingContext.mediaWorkspaceSource =
              "workspace_verified_client_video_context";
          } else {
            const fallbackCode =
              expectedDiagnostic.code || "workspace_media_mismatch";
            mediaAnalysisFallback = buildMediaAnalysisFallback(
              fallbackCode,
              expectedFamily,
            );
            timingContext.mediaWorkspaceSource = "legacy_fallback";
            timingContext.mediaWorkspaceFallbackCode = fallbackCode;
          }
        }

        const degradedFamilies = (["images", "video"] as const).filter(
          (family) => {
            const state = workspaceMedia.diagnostics[family].state;
            return state === "partial" || state === "unavailable";
          },
        );
        if (degradedFamilies.length) {
          console.warn("[booster-generate] workspace AI family degraded", {
            workspaceId: mediaWorkspaceId,
            usableMediaType: workspaceMedia.mediaType,
            degradedFamilies,
            diagnostics: workspaceMedia.diagnostics,
          });
          const expectedFamily = mediaType === "video" ? "video" : "images";
          const expectedDiagnostic = workspaceMedia.diagnostics[expectedFamily];
          if (
            !mediaAnalysisFallback &&
            !useVerifiedLocalVideoPreview &&
            (expectedDiagnostic.state === "partial" ||
              expectedDiagnostic.state === "unavailable")
          ) {
            mediaAnalysisFallback = buildMediaAnalysisFallback(
              expectedDiagnostic.code || "workspace_media_analysis_partial",
              expectedFamily,
            );
          }
        }

        let workspaceVideoForBody:
          | NonNullable<Payload["videoForAI"]>
          | null = useVerifiedLocalVideoPreview
          ? effectiveBody.videoForAI || null
          : null;
        const workspaceVideo = workspaceMedia.videoForAI;
        if (workspaceVideo) {
          const existingVideo = effectiveBody.videoForAI || {};
          const existingVideoFrames = Array.isArray(existingVideo.visualFrames)
            ? existingVideo.visualFrames
            : [];
          let audioTranscript = cleanVideoTranscript(
            existingVideo.audioTranscript || existingVideo.rawAudioTranscript,
          );

          if (
            !audioTranscript &&
            workspaceVideo.audioTrackFile &&
            generationDeadlineAt - Date.now() > 4_000
          ) {
            const transcriptionStartedAt = Date.now();
            try {
              const transcriptionTimeoutMs = Math.max(
                1_000,
                Math.min(
                  5_000,
                  generationDeadlineAt -
                    Date.now() -
                    BOOSTER_GENERATION_CLOSE_MARGIN_MS,
                ),
              );
              const transcription = await aiTranscribeMedia({
                file: workspaceVideo.audioTrackFile,
                accountId: userId,
                mediaType:
                  workspaceVideo.audioTrackFile.type || "audio/mpeg",
                retries: 0,
                timeoutMs: transcriptionTimeoutMs,
                deadlineAt:
                  generationDeadlineAt -
                  BOOSTER_GENERATION_CLOSE_MARGIN_MS,
                signal: req.signal,
              });
              audioTranscript = cleanVideoTranscript(transcription.text);
              console.info("[booster-generate] audio transcription timing", {
                workspaceId: mediaWorkspaceId,
                success: true,
                model: transcription.model,
                durationMs: Date.now() - transcriptionStartedAt,
              });
            } catch (transcriptionError) {
              const transcriptionCode = String(
                transcriptionError &&
                  typeof transcriptionError === "object" &&
                  "code" in transcriptionError
                  ? (transcriptionError as { code?: unknown }).code || ""
                  : "",
              );
              const expectedUnavailable = [
                "ai_gateway_transcription_protocol_unsupported",
                "ai_operation_deadline_exceeded",
              ].includes(transcriptionCode);
              const logTranscription = expectedUnavailable
                ? console.info
                : console.warn;
              logTranscription(
                "[booster-generate] workspace audio transcription unavailable",
                {
                  workspaceId: mediaWorkspaceId,
                  code: transcriptionCode || "transcription_unavailable",
                  durationMs: Date.now() - transcriptionStartedAt,
                  message:
                    transcriptionError instanceof Error
                      ? transcriptionError.message
                      : String(
                          transcriptionError || "Erreur inconnue",
                        ),
                },
              );
            }
          }

          workspaceVideoForBody = {
            ...existingVideo,
            name: workspaceVideo.name,
            type: workspaceVideo.type,
            size: workspaceVideo.size,
            duration: workspaceVideo.duration,
            source: workspaceVideo.source,
            storagePath: workspaceVideo.storagePath,
            visualFrames: existingVideoFrames.length
              ? existingVideoFrames
              : workspaceVideo.visualFrames,
            audioTranscript,
            rawAudioTranscript: audioTranscript,
            analysisPlan: {
              visualFrames:
                existingVideoFrames.length ||
                workspaceVideo.visualFrames.length
                  ? "ready"
                  : "pending",
              audioTranscript: audioTranscript
                ? "ready"
                : workspaceVideo.audioAvailable
                  ? "pending"
                  : "unavailable",
              frameTargets: ["start", "middle", "end"],
            },
          };
        }

        if (workspaceHasImages || workspaceVideoForBody) {
          // The downstream generator still uses a dominant media profile, but
          // both independently resolved families feed its single channel batch.
          mediaType = workspaceVideoForBody ? "video" : "images";
          effectiveBody = {
            ...effectiveBody,
            mediaType,
            useImagesForAI: workspaceHasImages,
            imageCount: workspaceMedia.imagesForAI.length,
            imagesForAI: workspaceMedia.imagesForAI,
            videoForAI: workspaceVideoForBody,
          };
        } else {
          timingContext.mediaWorkspaceSource = "legacy_fallback";
          timingContext.mediaWorkspaceFallbackCode =
            workspaceMedia.diagnostics.images.code ||
            workspaceMedia.diagnostics.video.code ||
            "workspace_ai_media_unavailable";
          mediaAnalysisFallback ||= buildMediaAnalysisFallback(
            timingContext.mediaWorkspaceFallbackCode,
            mediaType === "video" ? "video" : "images",
          );
        }
      } catch (workspaceError) {
        timingContext.mediaWorkspaceLoadMs =
          Date.now() - workspaceLoadStartedAt;
        timingContext.mediaWorkspaceSource = "legacy_fallback";
        timingContext.mediaWorkspaceFallbackCode =
          workspaceError instanceof MediaWorkspaceConsumptionError
            ? workspaceError.code
            : "workspace_read_failed";
        const logWorkspaceFallback = timingContext.mediaWorkspaceFallbackCode === "workspace_media_not_ready"
          ? console.info
          : console.warn;
        logWorkspaceFallback("[booster-generate] workspace media fallback", {
          workspaceId: mediaWorkspaceId,
          code: timingContext.mediaWorkspaceFallbackCode,
          message:
            workspaceError instanceof Error
              ? workspaceError.message
              : String(workspaceError || "Erreur inconnue"),
        });
        mediaAnalysisFallback = buildMediaAnalysisFallback(
          timingContext.mediaWorkspaceFallbackCode,
          mediaType === "video" ? "video" : "images",
        );
        if (strictMediaCutover) {
          const fallbackCode = timingContext.mediaWorkspaceFallbackCode;
          const localVideo = effectiveBody.videoForAI;
          const localFrames = Array.isArray(localVideo?.visualFrames)
            ? localVideo.visualFrames
            : [];
          const localTranscript = cleanVideoTranscript(
            localVideo?.audioTranscript || localVideo?.rawAudioTranscript,
          );
          const canUseVerifiedLocalVideoPreview =
            mediaType === "video" &&
            [
              "workspace_video_frames_pending",
              "workspace_video_frame_unavailable",
              "workspace_video_audio_unavailable",
              "workspace_variant_download_failed",
              "workspace_variant_binary_invalid",
              "workspace_ai_video_deadline_exceeded",
            ].includes(String(fallbackCode || "")) &&
            (localFrames.length > 0 || Boolean(localTranscript));

          if (canUseVerifiedLocalVideoPreview) {
            timingContext.mediaWorkspaceSource =
              "workspace_verified_client_video_context";
            mediaAnalysisFallback = null;
          }
        }
      }
    }

    const imagesForAI = sanitizeImagesForAI({ ...effectiveBody, mediaType });
    const videoFrameImagesForAI = sanitizeVideoFramesForAI({
      ...effectiveBody,
      mediaType,
    });
    const videoForAI = sanitizeVideoForAI({ ...effectiveBody, mediaType });
    if (
      !mediaAnalysisFallback &&
      persistedVideoContextFallback &&
      mediaType === "video" &&
      videoFrameImagesForAI.length === 0 &&
      !videoForAI?.audioTranscript
    ) {
      mediaAnalysisFallback = persistedVideoContextFallback;
    }
    const mediaGenerationInstructions =
      buildVideoGenerationInstructions(videoForAI, imagesForAI.length);
    timingContext.mediaType = mediaType;
    timingContext.imageCount = imagesForAI.length;
    timingContext.videoFrameCount = videoFrameImagesForAI.length;

    const contextStartedAt = Date.now();
    const generationContextPromise = getBoosterGenerationContext({
      supabase,
      userId,
    });

    if (!isAdmin) {
      const quota = await reserveAiCredits({
        supabase,
        userId,
        action: "booster",
        credits: computeBoosterAiCredits({
          mediaType,
          imagesForAI,
          videoForAI,
        }),
      });
      if (quota.errorResponse) return quota.errorResponse;
      quotaReservation = quota.reservation;
    }

    const generationContext = await withinGenerationDeadline(
      generationContextPromise,
      generationDeadlineAt,
    );
    assertGenerationBudget(generationDeadlineAt, 2_000);
    timingContext.contextLoadMs = Date.now() - contextStartedAt;
    timingContext.professionalContextSource =
      generationContext.cacheSource.professional;
    timingContext.publicationsContextSource =
      generationContext.cacheSource.publications;

    const { profile, business, recentPublications } = generationContext;
    let generationResult: Awaited<ReturnType<typeof generateSharedBoosterPosts>> | null = null;
    const generationStartedAt = Date.now();
    try {
      generationResult = await generateSharedBoosterPosts({
        idea,
        publicationInstruction,
        theme,
        style,
        preferredEngine: aiPreferredEngine,
        channels,
        profile: (profile ?? null) as JsonRecord | null,
        business,
        recentPublications,
        imagesForAI:
          mediaType === "video"
            ? [...videoFrameImagesForAI, ...imagesForAI].slice(
                0,
                AI_IMAGE_MAX_COUNT,
              )
            : imagesForAI,
        mediaContext: mediaGenerationInstructions,
        mediaType,
        accountId: userId,
        deadlineAt:
          generationDeadlineAt - BOOSTER_GENERATION_CLOSE_MARGIN_MS,
      });
    } finally {
      generationMs = Date.now() - generationStartedAt;
    }

    if (!generationResult) {
      throw new Error("La génération IA n'a pas pu retourner de résultat.");
    }

    const { versions, recoveredChannels, aiFallback, performance } = generationResult;

    if (mediaWorkspaceId) {
      const generatedAt = new Date().toISOString();
      after(async () => {
        try {
          await withinMediaContextBudget(
            syncPublicationWorkspaceContext({
              accountId: userId,
              workspaceId: mediaWorkspaceId,
              operation: "generate",
              idea,
              theme,
              selectedChannels: channels,
              generatedContent: {
                postByChannel: versions,
                generatedAt,
                ...(generationRequestId
                  ? {
                      boosterGenerationReceipt: {
                        requestId: generationRequestId,
                        status: "ready",
                        generatedAt,
                        recoveredChannels,
                        ...(aiFallback ? { aiFallback } : {}),
                        ...(mediaAnalysisFallback
                          ? { mediaAnalysisFallback }
                          : {}),
                      },
                    }
                  : {}),
              },
              generationOptions: {
                style,
                publicationInstruction,
                aiPreferredEngine: aiPreferredEngine || null,
                mediaType,
              },
              ...((timingContext.mediaWorkspaceSource === "workspace" ||
              timingContext.mediaWorkspaceSource === "workspace_cutover_v1")
                ? { status: "ready" as const }
                : {}),
              metadata: {
                consumptionSource: timingContext.mediaWorkspaceSource,
                workspaceRevisionRead:
                  timingContext.mediaWorkspaceRevision || null,
              },
            }),
          );
        } catch (workspaceSyncError) {
          console.warn("[booster-generate] workspace context sync skipped", {
            workspaceId: mediaWorkspaceId,
            generationRequestId: generationRequestId || undefined,
            message:
              workspaceSyncError instanceof Error
                ? workspaceSyncError.message
                : String(workspaceSyncError || "Erreur inconnue"),
          });
        }
      });
    }

    await commitAiCredits(quotaReservation);
    console.info("[booster-generate] route timing", {
      ...timingContext,
      generationMs,
      totalMs: Date.now() - routeStartedAt,
      recoveredChannels: recoveredChannels.length,
      generationPerformance: performance,
      aiFallbackStage: aiFallback?.stage,
      aiFallbackModel: aiFallback?.finalModel,
      success: true,
    });
    return NextResponse.json({
      versions,
      recoveredChannels,
      ...(generationRequestId ? { generationRequestId } : {}),
      ...(aiFallback ? { aiFallback } : {}),
      ...(mediaAnalysisFallback ? { mediaAnalysisFallback } : {}),
    });
  } catch (e: unknown) {
    await rollbackAiCredits(quotaReservation);
    console.warn("[booster-generate] route timing", {
      ...timingContext,
      generationMs,
      totalMs: Date.now() - routeStartedAt,
      success: false,
      message: e instanceof Error ? e.message : String(e || "Erreur inconnue"),
    });
    return jsonUserFacingError(e, {
      status: 502,
      fallback: "La génération IA n'a pas pu aboutir. Merci de réessayer.",
    });
  }
};

export const POST = withApi(handler, { route: "/api/booster/generate" });
