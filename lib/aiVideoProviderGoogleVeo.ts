import "server-only";

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GoogleGenAI,
  VideoGenerationReferenceType,
  type GenerateVideosOperation,
  type Video,
} from "@google/genai";

import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { getAiMediaVideoSegmentDurations } from "@/lib/aiMediaVideoTimeline";
import {
  DEFAULT_VEO_MODEL,
  classifyVeoFailure,
  nextVeoInspirationMode,
  resolveVeoModelCandidates,
  selectVeoInspirationMode,
} from "@/lib/aiVideoReliability";
import type {
  AiVideoProvider,
  AiVideoProviderClip,
  AiVideoProviderGenerationArgs,
  AiVideoProviderResult,
} from "@/lib/aiVideoProviderTypes";

const PROVIDER_ID = "google-gemini";
const DEFAULT_FAST_COST_MICRO_USD_PER_SECOND = 100_000;
const DEFAULT_LITE_COST_MICRO_USD_PER_SECOND = 50_000;
const DEFAULT_STANDARD_COST_MICRO_USD_PER_SECOND = 400_000;
// Google annonce une latence pouvant atteindre six minutes en période de
// pointe. La marge d'une minute couvre le téléchargement du clip sans couper
// une opération Veo encore valide.
const DEFAULT_TIMEOUT_MS = 420_000;
// Un contrôle toutes les 2,5 s récupère le résultat terminé jusqu'à 2,5 s
// plus tôt, tout en restant assez espacé pour les opérations longues.
const DEFAULT_POLL_MS = 2_500;
const DEFAULT_SUBMIT_ATTEMPTS = 4;
const DEFAULT_DOWNLOAD_ATTEMPTS = 3;
// Le modèle exposé à cette clé annonce une limite d'entrée de 480 tokens.
// 1 400 caractères laisse une marge pour la tokenisation des accents et évite
// qu'un profil très rempli invalide toute la génération.
const MAX_VEO_PROMPT_CHARS = 1_400;
// Deux plans simultanés offrent un bon compromis sur les nouveaux projets
// Google : la génération reste parallèle sans saturer les faibles quotas RPM.
// Les projets dont le plafond AI Studio le permet peuvent monter à 4 par env.
const DEFAULT_CONCURRENCY = 2;
const MAX_CLIP_BYTES = 128 * 1024 * 1024;
const MINOR_SUBJECT_PATTERN =
  /\b(enfants?|bébés?|bebes?|adolescents?|mineurs?|garçons?|garcons?|filles?|children?|child|kids?|bab(?:y|ies)|toddlers?|teen(?:ager)?s?|minors?)\b/gi;

function positiveInt(value: unknown, fallback: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(maximum, parsed)
    : fallback;
}

function costMicroUsdPerSecond(model: string) {
  const normalized = model.toLocaleLowerCase();
  if (normalized.includes("-lite-")) {
    return positiveInt(
      process.env.AI_MEDIA_VEO_LITE_COST_MICRO_USD_PER_SECOND,
      DEFAULT_LITE_COST_MICRO_USD_PER_SECOND,
      1_000_000,
    );
  }
  if (normalized.includes("-fast-")) {
    return positiveInt(
      process.env.AI_MEDIA_VEO_FAST_COST_MICRO_USD_PER_SECOND ||
        process.env.AI_MEDIA_VEO_COST_MICRO_USD_PER_SECOND,
      DEFAULT_FAST_COST_MICRO_USD_PER_SECOND,
      1_000_000,
    );
  }
  return positiveInt(
    process.env.AI_MEDIA_VEO_STANDARD_COST_MICRO_USD_PER_SECOND,
    DEFAULT_STANDARD_COST_MICRO_USD_PER_SECOND,
    1_000_000,
  );
}

function compact(value: unknown, max = 400) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function apiKey() {
  const value = String(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || ""
  ).trim();
  if (!value) throw new Error("ai_video_veo_credentials_missing");
  return value;
}

function modelCandidates() {
  return resolveVeoModelCandidates({
    primary: process.env.AI_MEDIA_VEO_MODEL || DEFAULT_VEO_MODEL,
    fallbacks: process.env.AI_MEDIA_VEO_FALLBACK_MODELS,
  });
}

function modelId() {
  return modelCandidates()[0];
}

function aspectRatio(
  format: AiVideoProviderGenerationArgs["request"]["format"]
) {
  return format === "landscape" ? "16:9" : "9:16";
}

function generationCancelledError() {
  const error = new Error("ai_media_generation_cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw generationCancelledError();
}

function delay(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(generationCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isExplicitlyRetryable(error: unknown) {
  return classifyVeoFailure(error).retryable;
}

function retryDelayMs(error: unknown, attempt: number) {
  const message = classifyVeoFailure(error).details;
  const explicitSeconds = message.match(
    /(?:retry(?:Delay)?|retry\s+in)[^0-9]{0,24}(\d+(?:\.\d+)?)\s*s/i
  );
  if (explicitSeconds) {
    return Math.min(
      60_000,
      Math.max(2_000, Number(explicitSeconds[1]) * 1_000)
    );
  }
  const schedule = [1_000, 2_500, 6_000, 12_000] as const;
  const base = schedule[Math.min(attempt, schedule.length - 1)];
  // Jitter avoids several parallel clips retrying on the same millisecond.
  return Math.round(base * (0.85 + Math.random() * 0.3));
}

function normalizedProviderError(error: unknown) {
  const failure = classifyVeoFailure(error);
  const details = compact(failure.details, 700);
  if (failure.kind === "cancelled") return generationCancelledError();
  if (failure.kind === "safety") return safetyFilteredError(details);
  const codes: Partial<Record<typeof failure.kind, string>> = {
    invalid_argument: "ai_video_veo_configuration_rejected",
    rate_limited: "ai_video_veo_rate_limited",
    unavailable: "ai_video_veo_unavailable",
    timeout: "ai_video_veo_timeout",
    authentication: "ai_video_veo_credentials_rejected",
    permission: "ai_video_veo_permission_denied",
    not_found: "ai_video_veo_model_unavailable",
    network: "ai_video_veo_network_failed",
  };
  const code = codes[failure.kind] || "ai_video_veo_operation_failed";
  return new Error(details ? `${code}:${details}` : code);
}

function providerError(operation: GenerateVideosOperation) {
  const details = operation.error
    ? compact(JSON.stringify(operation.error), 600)
    : "unknown";
  if (/safety|rai|responsible/i.test(details)) {
    return safetyFilteredError(details);
  }
  return normalizedProviderError(operation.error || details);
}

function safetyFilteredError(reasons: unknown) {
  const values = Array.isArray(reasons) ? reasons : [reasons];
  const details = compact(
    values
      .map((reason) =>
        typeof reason === "string" ? reason : JSON.stringify(reason)
      )
      .filter(Boolean)
      .join(" | "),
    600
  );
  return new Error(
    details && details !== "undefined"
      ? `ai_video_veo_safety_filtered:${details}`
      : "ai_video_veo_safety_filtered"
  );
}

function isSafetyFiltered(error: unknown) {
  return compact(error instanceof Error ? error.message : error, 1_000).includes(
    "ai_video_veo_safety_filtered"
  );
}

function mentionsMinorAudience(value: unknown) {
  MINOR_SUBJECT_PATTERN.lastIndex = 0;
  return MINOR_SUBJECT_PATTERN.test(String(value ?? ""));
}

function adultSafePromptText(value: unknown, max: number) {
  MINOR_SUBJECT_PATTERN.lastIndex = 0;
  return compact(
    String(value ?? "").replace(MINOR_SUBJECT_PATTERN, "public familial"),
    max
  );
}

export function buildGoogleVideoSafetyFallbackPrompt(prompt: string) {
  const withoutReferenceInstructions = prompt
    .replace(
      /Animate the supplied initial image naturally\.[^.]*\.[^.]*\./i,
      "Create a fresh original scene faithful to the requested business subject and visual direction."
    )
    .replace(
      /Use every supplied asset reference[^.]*\.[^.]*\./i,
      "Create a fresh original scene faithful to the requested business subject and visual direction."
    );
  return compact(
    [
      "SAFETY RECOVERY: create a new scene without copying any recognizable real person's face or identity. Only unmistakably mature adults aged 25 or older may be visible.",
      withoutReferenceInstructions,
    ].join(" "),
    MAX_VEO_PROMPT_CHARS
  );
}

function promptForInspirationMode(
  prompt: string,
  mode: "references" | "source" | "none",
) {
  if (mode === "references") return prompt;
  if (mode === "source") {
    return prompt.replace(
      /Use every supplied asset reference[^.]*\.[^.]*\./i,
      "Animate the supplied initial image naturally. Preserve its principal subject, composition, colors and visual identity.",
    );
  }
  return prompt
    .replace(
      /Animate the supplied initial image naturally\.[^.]*\.[^.]*\./i,
      "Create a fresh original scene faithful to the exact business subject and visual direction.",
    )
    .replace(
      /Use every supplied asset reference[^.]*\.[^.]*\./i,
      "Create a fresh original scene faithful to the exact business subject and visual direction.",
    );
}

function subjectVisualEvidence(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
  const evidence: string[] = [];

  if (
    /\b(application|appli|app|mobile|smartphone|telephone|tablette)\b/.test(
      normalized
    )
  ) {
    evidence.push(
      "Keep a smartphone, tablet or laptop in the foreground and show a real person tapping, swiping or using the digital product"
    );
  }
  if (
    /\b(logiciel|plateforme|saas|dashboard|site web|site internet|numerique|digital)\b/.test(
      normalized
    )
  ) {
    evidence.push(
      "Make the software workflow visible through a clean unlabeled interface made only of cards, icons, images and motion"
    );
  }
  if (
    /\b(media|medias|image|images|video|videos|contenu|publication|communication|reseaux sociaux|ia|intelligence artificielle)\b/.test(
      normalized
    )
  ) {
    evidence.push(
      "Show visual content being created, previewed or published through recognizable photo and video thumbnails"
    );
  }
  if (
    /\b(maconnerie|macon|construction|batiment|chantier|renovation|brique|beton)\b/.test(
      normalized
    )
  ) {
    evidence.push(
      "Show an unmistakable masonry or construction site with the relevant craftsperson, tools and materials such as bricks, mortar, concrete or a trowel"
    );
  }
  if (
    /\b(cheval|chevaux|equitation|equestre|equine|ecurie|poney|poneys)\b/.test(
      normalized
    )
  ) {
    evidence.push(
      "Show real horses as central subjects in a credible stable, paddock or riding environment with the requested human action"
    );
  }

  return compact(
    evidence.length
      ? evidence.join(". ")
      : "Show tangible objects, gestures and actions explicitly connected to the primary subject",
    180
  );
}

function subjectDigitalDirection(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
  return /\b(application|appli|app|mobile|smartphone|telephone|tablette|logiciel|plateforme|saas|dashboard|site web|site internet|numerique|digital|reseaux sociaux)\b/.test(
    normalized,
  )
    ? "This is a digital subject: keep a relevant device in view and show a clean app or software workflow through unlabeled shapes, icons, images and motion"
    : "";
}

function subjectSafetyDirection(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();

  if (
    /\b(massage|massages|spa|bien[- ]etre|relaxation|soin du corps|soins du corps|therapie manuelle)\b/.test(
      normalized
    )
  ) {
    return "Professional wellness service only: show a clearly adult client modestly covered by towels or sheets, with only shoulders, upper back, hands or lower legs visible; the adult practitioner wears professional clothing; calm non-sexual care, no intimate body area";
  }
  if (
    /\b(esthetique|beaute|institut|visage|coiffure|barbier|onglerie|manucure|pedicure)\b/.test(
      normalized
    )
  ) {
    return "Professional beauty service only: clearly adult client and practitioner, normal salon clothing or modest treatment coverage, no intimate body area and no sexualized pose";
  }
  if (
    /\b(medecin|medical|sante|clinique|cabinet|kine|physiotherapie|osteopath|dentiste|infirmier)\b/.test(
      normalized
    )
  ) {
    return "Professional healthcare context only: clearly adult patient and qualified adult professional, modest clothing, non-graphic routine care, no injury detail, blood or invasive procedure";
  }
  return "";
}

function conciseVisualDirection(
  request: AiVideoProviderGenerationArgs["request"]
) {
  return compact(
    [
      `style ${request.visualStyle}`,
      `render ${request.imageStyle}`,
      `shot ${request.shotType}`,
      `people ${request.peopleMode}`,
      `creativity ${request.creativity}`,
    ].join("; "),
    140
  );
}

export function buildGoogleVideoScenePrompt(
  args: AiVideoProviderGenerationArgs,
  index: number,
  durationSeconds: 4 | 6 | 8
) {
  const scene = args.plan.scenes[index];
  const colors = args.brandColors.filter(Boolean).slice(0, 5).join(", ");
  const rawContext = [
    args.request.idea,
    args.creativeBrief,
    scene?.visualBrief,
    scene?.title,
    scene?.body,
  ]
    .filter(Boolean)
    .join(" ");
  const servesMinorAudience = mentionsMinorAudience(rawContext);
  const exactIdea = adultSafePromptText(args.request.idea, 180);
  const professionalActivity = adultSafePromptText(
    args.profession || args.plan.companyName,
    100,
  );
  const primarySubject = compact(
    exactIdea
      ? `${exactIdea}; professional activity: ${professionalActivity}`
      : professionalActivity,
    240,
  );
  const visualEvidence = subjectVisualEvidence(rawContext);
  const digitalDirection = subjectDigitalDirection(rawContext);
  const safetyDirection = subjectSafetyDirection(rawContext);
  const businessContext = adultSafePromptText(args.creativeBrief, 90);
  const sceneDirection = adultSafePromptText(
    [scene?.visualBrief, scene?.title, scene?.body].filter(Boolean).join(" "),
    160
  );
  const visualDirection = conciseVisualDirection(args.request);
  return compact(
    [
      `Create one original ${durationSeconds}-second cinematic business shot ${
        index + 1
      }/${args.plan.scenes.length}.`,
      `PRIMARY SUBJECT — visually unmistakable: ${primarySubject}.`,
      `REQUIRED VISUAL PROOF: ${visualEvidence}.`,
      sceneDirection ? `Shot action: ${sceneDirection}.` : "",
      args.request.inspirationImages.length && index === 0
        ? args.request.inspirationImages.length === 1
          ? "Animate the supplied initial image naturally. Preserve its principal subject, composition, colors and visual identity; do not replace it with an unrelated scene."
          : "Use every supplied asset reference to preserve the appearance of the referenced person, character, product or object. Keep the result coherent with the exact business subject."
        : "",
      "Keep every named trade, product, animal, object, action or place central; never switch category or use generic corporate imagery.",
      args.request.peopleMode === "none"
        ? "Do not show any person, human silhouette or face."
        : "Every visible person must be unmistakably adult and at least 25 years old; no younger-looking person may appear.",
      servesMinorAudience
        ? "This business serves a family audience. Represent that safely through the venue, equipment, animals, products and clearly adult staff only."
        : "",
      safetyDirection ? `PROFESSIONAL SAFETY FRAMING: ${safetyDirection}.` : "",
      digitalDirection ? `${digitalDirection}.` : "",
      "No readable text, letters, numbers, captions, signs, logos, watermarks, fake writing, posters, slides or borders.",
      "Natural location ambience only; no dialogue, voice-over, lyrics or music. iNrCy adds exact branding, copy and final audio.",
      businessContext ? `Verified business context: ${businessContext}.` : "",
      visualDirection ? `Visual direction: ${visualDirection}.` : "",
      colors
        ? `Use these brand colors subtly in lighting or decor: ${compact(
            colors,
            50
          )}.`
        : "Use a refined palette appropriate to the professional activity.",
      "Credible action, natural motion and anatomy, clean framing, consistent cast, light and color across shots.",
    ]
      .filter(Boolean)
      .join(" "),
    MAX_VEO_PROMPT_CHARS
  );
}

async function submitOperation(args: {
  ai: GoogleGenAI;
  model: string;
  prompt: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: "16:9" | "9:16";
  inspirationImages?: AiVideoProviderGenerationArgs["request"]["inspirationImages"];
  signal: AbortSignal;
}) {
  let lastError: unknown = null;
  let inspirationMode = selectVeoInspirationMode({
    model: args.model,
    durationSeconds: args.durationSeconds,
    imageCount: args.inspirationImages?.length || 0,
  });
  let transientAttempt = 0;
  const warnings: string[] = [];

  while (transientAttempt < DEFAULT_SUBMIT_ATTEMPTS) {
    try {
      const sourceImage =
        inspirationMode === "source" ? args.inspirationImages?.[0] : null;
      const operation = await args.ai.models.generateVideos({
        model: args.model,
        source: {
          prompt: promptForInspirationMode(args.prompt, inspirationMode),
          ...(sourceImage
            ? {
                image: {
                  imageBytes: sourceImage.data,
                  mimeType: sourceImage.mimeType,
                },
              }
            : {}),
        },
        // Gemini Developer API / Veo 3.1 Fast whitelist. Do not add generic
        // GenerateVideosConfig fields here unless the Veo model contract lists
        // them explicitly. Audio, one output and 720p are model defaults.
        config: {
          abortSignal: args.signal,
          durationSeconds: args.durationSeconds,
          aspectRatio: args.aspectRatio,
          // Intentionally omit personGeneration. Google currently rejects
          // allow_adult on some Veo 3/3.1 routes with INVALID_ARGUMENT.
          // Person safety remains enforced by the prompt and Google's filters.
          ...(inspirationMode === "references" && args.inspirationImages
            ? {
                referenceImages: args.inspirationImages.map((image) => ({
                  image: {
                    imageBytes: image.data,
                    mimeType: image.mimeType,
                  },
                  referenceType: VideoGenerationReferenceType.ASSET,
                })),
              }
            : {}),
        },
      });
      return { operation, warnings };
    } catch (error) {
      lastError = error;
      const failure = classifyVeoFailure(error);
      // Inspiration is optional. A parameter incompatibility is corrected
      // immediately and does not consume the transient retry budget.
      const nextMode = nextVeoInspirationMode(inspirationMode);
      if (failure.kind === "invalid_argument" && nextMode) {
        warnings.push(
          inspirationMode === "references"
            ? "veo_inspiration_references_downgraded"
            : "veo_inspiration_image_downgraded",
        );
        inspirationMode = nextMode;
        continue;
      }
      transientAttempt += 1;
      if (transientAttempt >= DEFAULT_SUBMIT_ATTEMPTS || !failure.retryable) {
        throw normalizedProviderError(error);
      }
      await delay(retryDelayMs(error, transientAttempt - 1), args.signal);
    }
  }
  throw normalizedProviderError(lastError);
}

function assertMp4Clip(buffer: Buffer) {
  if (!buffer.length) throw new Error("ai_video_veo_clip_empty");
  if (buffer.length > MAX_CLIP_BYTES) {
    throw new Error("ai_video_veo_clip_too_large");
  }
  const signatureOffset = buffer.indexOf(Buffer.from("ftyp"), 0);
  if (signatureOffset < 4 || signatureOffset > 24) {
    throw new Error("ai_video_veo_clip_not_mp4");
  }
}

async function downloadVideo(args: {
  ai: GoogleGenAI;
  video: Video;
  signal: AbortSignal;
}) {
  const mediaType = compact(args.video.mimeType, 80) || "video/mp4";
  let inlineError: unknown = null;
  if (args.video.videoBytes) {
    try {
      const buffer = Buffer.from(args.video.videoBytes, "base64");
      assertMp4Clip(buffer);
      return { buffer, mediaType };
    } catch (error) {
      inlineError = error;
      // Some responses expose both inline bytes and a downloadable URI. If
      // the inline payload is malformed, recover the same already-generated
      // (and potentially billed) video through its URI instead of creating a
      // second render.
      if (!args.video.uri) throw error;
    }
  }

  const directory = await mkdtemp(join(tmpdir(), "inrcy-veo-"));
  try {
    let lastError: unknown = inlineError;
    for (let attempt = 0; attempt < DEFAULT_DOWNLOAD_ATTEMPTS; attempt += 1) {
      const outputPath = join(directory, `clip-${attempt}.mp4`);
      try {
        await args.ai.files.download({
          file: args.video,
          downloadPath: outputPath,
          config: { abortSignal: args.signal },
        });
        const info = await stat(outputPath);
        if (!info.size) throw new Error("ai_video_veo_clip_empty");
        if (info.size > MAX_CLIP_BYTES) {
          throw new Error("ai_video_veo_clip_too_large");
        }
        const buffer = await readFile(outputPath);
        assertMp4Clip(buffer);
        return { buffer, mediaType: "video/mp4" };
      } catch (error) {
        lastError = error;
        const retryable =
          classifyVeoFailure(error).retryable ||
          /ai_video_veo_clip_(?:empty|not_mp4)/.test(
            compact(error instanceof Error ? error.message : error, 200),
          );
        if (attempt >= DEFAULT_DOWNLOAD_ATTEMPTS - 1 || !retryable) break;
        await delay(retryDelayMs(error, attempt), args.signal);
      }
    }
    const details = compact(classifyVeoFailure(lastError).details, 700);
    throw new Error(
      details
        ? `ai_video_veo_download_failed:${details}`
        : "ai_video_veo_download_failed",
    );
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined
    );
  }
}

async function generateClip(args: {
  ai: GoogleGenAI;
  models: string[];
  prompt: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: "16:9" | "9:16";
  inspirationImages?: AiVideoProviderGenerationArgs["request"]["inspirationImages"];
  timeoutMs: number;
  pollMs: number;
  onBillable: (model: string) => void;
  signal?: AbortSignal;
}): Promise<AiVideoProviderClip> {
  throwIfAborted(args.signal);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () =>
    controller.abort(generationCancelledError());
  args.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("ai_video_veo_timeout"));
  }, args.timeoutMs);
  try {
    let lastError: unknown = null;
    const accumulatedWarnings: string[] = [];

    for (let modelIndex = 0; modelIndex < args.models.length; modelIndex += 1) {
      const model = args.models[modelIndex];
      let billableOutputExists = false;
      const inspirationImages = args.inspirationImages || [];
      const contentAttempts = inspirationImages.length
        ? [
            { prompt: args.prompt, inspirationImages },
            { prompt: args.prompt, inspirationImages: [] },
            {
              prompt: buildGoogleVideoSafetyFallbackPrompt(args.prompt),
              inspirationImages: [],
            },
          ]
        : [
            { prompt: args.prompt, inspirationImages: [] },
            {
              prompt: buildGoogleVideoSafetyFallbackPrompt(args.prompt),
              inspirationImages: [],
            },
          ];

      for (
        let attemptIndex = 0;
        attemptIndex < contentAttempts.length;
        attemptIndex += 1
      ) {
        const attempt = contentAttempts[attemptIndex];
        try {
          const submitted = await submitOperation({
            ...args,
            model,
            prompt: attempt.prompt,
            inspirationImages: attempt.inspirationImages,
            signal: controller.signal,
          });
          accumulatedWarnings.push(...submitted.warnings);
          let operation = submitted.operation;
          const requestId = compact(operation.name, 220);
          if (!requestId) throw new Error("ai_video_veo_operation_id_missing");

          while (!operation.done) {
            await delay(args.pollMs, controller.signal);
            try {
              operation = await args.ai.operations.getVideosOperation({
                operation,
                config: { abortSignal: controller.signal },
              });
            } catch (error) {
              if (!isExplicitlyRetryable(error)) {
                throw normalizedProviderError(error);
              }
              await delay(retryDelayMs(error, 0), controller.signal);
            }
          }
          if (operation.error) throw providerError(operation);
          const response = operation.response;
          if (response?.raiMediaFilteredCount) {
            throw safetyFilteredError(response.raiMediaFilteredReasons);
          }
          const video = response?.generatedVideos?.[0]?.video;
          if (!video) throw new Error("ai_video_veo_video_missing");

          // From this point the provider can charge the clip. Never submit a
          // replacement model if its download fails: only retry the download.
          billableOutputExists = true;
          args.onBillable(model);
          const downloaded = await downloadVideo({
            ai: args.ai,
            video,
            signal: controller.signal,
          });
          return {
            ...downloaded,
            durationSeconds: args.durationSeconds,
            requestId,
            model,
            warnings: Array.from(new Set(accumulatedWarnings)),
          };
        } catch (error) {
          lastError = error;
          if (billableOutputExists) throw error;
          const failure = classifyVeoFailure(error);
          const canRetryWithoutInspiration =
            attempt.inspirationImages.length > 0 &&
            (failure.kind === "invalid_argument" ||
              failure.kind === "safety");
          if (canRetryWithoutInspiration) {
            accumulatedWarnings.push(
              failure.kind === "safety"
                ? "veo_inspiration_safety_downgraded"
                : "veo_async_inspiration_downgraded",
            );
            continue;
          }
          const nextAttempt = contentAttempts[attemptIndex + 1];
          const canRetryAfterSafety =
            isSafetyFiltered(error) &&
            nextAttempt?.prompt !== attempt.prompt;
          if (canRetryAfterSafety) {
            accumulatedWarnings.push("veo_safety_prompt_recovery");
            continue;
          }
          break;
        }
      }

      const failure = classifyVeoFailure(lastError);
      const missingNonBillableOutput = /ai_video_veo_(?:video|operation_id)_missing/.test(
        compact(lastError instanceof Error ? lastError.message : lastError, 400),
      );
      const canUseFallback =
        modelIndex < args.models.length - 1 &&
        !timedOut &&
        (failure.modelFallbackEligible || missingNonBillableOutput);
      if (!canUseFallback) throw lastError;
      accumulatedWarnings.push(
        `veo_model_fallback:${model}->${args.models[modelIndex + 1]}`,
      );
    }
    throw lastError;
  } catch (error) {
    if (timedOut) throw new Error("ai_video_veo_timeout");
    if (args.signal?.aborted || controller.signal.aborted) {
      throw generationCancelledError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    args.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export const googleVeoVideoProvider: AiVideoProvider = {
  id: PROVIDER_ID,
  get model() {
    return modelId();
  },
  async generate(args): Promise<AiVideoProviderResult> {
    throwIfAborted(args.signal);
    const ai = new GoogleGenAI({ apiKey: apiKey() });
    const models = modelCandidates();
    const primaryModel = models[0];
    const timeoutMs = positiveInt(
      process.env.AI_MEDIA_VIDEO_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      600_000
    );
    const pollMs = positiveInt(
      process.env.AI_MEDIA_VEO_POLL_MS,
      DEFAULT_POLL_MS,
      15_000
    );
    const configuredConcurrency = positiveInt(
      process.env.AI_MEDIA_VEO_CONCURRENCY,
      DEFAULT_CONCURRENCY,
      4
    );
    const requestedDurations = getAiMediaVideoSegmentDurations(
      args.request.durationSeconds || 16
    );
    // Preserve the exact commercial duration. Multiple reference images are
    // only sent for native 8s clips; 4s/6s clips animate the first image.
    const durations: Array<4 | 6 | 8> = [...requestedDurations];
    if (args.plan.scenes.length !== durations.length) {
      throw new Error("ai_video_veo_scene_count_invalid");
    }
    const totalDurationSeconds = durations.reduce(
      (total, duration) => total + duration,
      0,
    );
    // Reserve the most expensive configured candidate so a model fallback can
    // never make the actual charge exceed the economic guard reservation.
    const reservedCostPerSecond = Math.max(
      ...models.map((model) => costMicroUsdPerSecond(model)),
    );
    const estimatedCostMicroUsd =
      totalDurationSeconds * reservedCostPerSecond;
    const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
      estimatedInputTokens: 0,
      reservedOutputTokens: 0,
      estimatedCostMicroUsd,
    });
    let actualCostMicroUsd = 0;
    const billableModels = new Set<string>();
    try {
      const clips = new Array<AiVideoProviderClip | undefined>(
        durations.length
      );
      let cursor = 0;
      let stopped = false;
      let firstError: unknown = null;
      let preferredModel = primaryModel;
      const worker = async () => {
        while (!stopped && cursor < durations.length) {
          throwIfAborted(args.signal);
          const index = cursor;
          cursor += 1;
          const durationSeconds = durations[index];
          try {
            const orderedModels = Array.from(
              new Set([preferredModel, ...models]),
            );
            const clip = await generateClip({
              ai,
              models: orderedModels,
              prompt: buildGoogleVideoScenePrompt(args, index, durationSeconds),
              durationSeconds,
              aspectRatio: aspectRatio(args.request.format),
              inspirationImages:
                index === 0 ? args.request.inspirationImages : [],
              timeoutMs,
              pollMs,
              signal: args.signal,
              onBillable: (usedModel) => {
                actualCostMicroUsd +=
                  durationSeconds * costMicroUsdPerSecond(usedModel);
                billableModels.add(usedModel);
              },
            });
            clips[index] = clip;
            // Once a fallback proved healthy, later unscheduled clips start
            // there instead of repeating a known failing primary route.
            preferredModel = clip.model;
          } catch (error) {
            stopped = true;
            firstError ||= error;
          }
        }
      };
      const concurrency = Math.min(configuredConcurrency, durations.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      if (firstError) throw firstError;
      if (clips.some((clip) => !clip)) {
        throw new Error("ai_video_veo_clip_set_incomplete");
      }
      const completedClips = clips as AiVideoProviderClip[];
      const usedModels = Array.from(
        new Set(completedClips.map((clip) => clip.model)),
      );
      const accountingModel = usedModels.join("+") || primaryModel;
      await commitAiGatewayAccountAttempt({
        reservation,
        feature: "media.video",
        model: accountingModel,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        actualCostMicroUsd,
      });
      return {
        provider: PROVIDER_ID,
        model: accountingModel,
        clips: completedClips,
        estimatedCostMicroUsd: actualCostMicroUsd,
        warnings: Array.from(
          new Set(completedClips.flatMap((clip) => clip.warnings)),
        ),
      };
    } catch (error) {
      const accountingModel =
        Array.from(billableModels).join("+") || primaryModel;
      if (actualCostMicroUsd > 0) {
        await commitAiGatewayAccountAttempt({
          reservation,
          feature: "media.video",
          model: accountingModel,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          actualCostMicroUsd,
        }).catch(() => undefined);
      } else {
        await rollbackAiGatewayAccountAttempt(reservation).catch(
          () => undefined
        );
      }
      await recordAiGatewayAccountFailure({
        accountId: args.accountId,
        feature: "media.video",
        model: accountingModel,
      }).catch(() => undefined);
      throw error;
    }
  },
};
