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
import type {
  AiVideoProvider,
  AiVideoProviderClip,
  AiVideoProviderGenerationArgs,
  AiVideoProviderResult,
} from "@/lib/aiVideoProviderTypes";

const PROVIDER_ID = "google-gemini";
const DEFAULT_MODEL_ID = "veo-3.1-fast-generate-preview";
const DEFAULT_COST_MICRO_USD_PER_SECOND = 100_000;
// Google annonce une latence pouvant atteindre six minutes en période de
// pointe. La marge d'une minute couvre le téléchargement du clip sans couper
// une opération Veo encore valide.
const DEFAULT_TIMEOUT_MS = 420_000;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_SUBMIT_ATTEMPTS = 5;
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

function modelId() {
  const value = String(
    process.env.AI_MEDIA_VEO_MODEL || DEFAULT_MODEL_ID
  ).trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,100}$/i.test(value)) {
    throw new Error("ai_video_veo_model_invalid");
  }
  return value;
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

function statusFromError(error: unknown) {
  if (!error || typeof error !== "object") return 0;
  const value = Number(
    (error as { status?: unknown; code?: unknown }).status ||
      (error as { status?: unknown; code?: unknown }).code ||
      0
  );
  if (Number.isFinite(value) && value >= 100 && value <= 599) return value;
  const match = String((error as { message?: unknown }).message || "").match(
    /\b(429|500|502|503|504)\b/
  );
  return match ? Number(match[1]) : 0;
}

function isExplicitlyRetryable(error: unknown) {
  const status = statusFromError(error);
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function retryDelayMs(error: unknown, attempt: number) {
  const message = compact(
    error && typeof error === "object"
      ? (error as { message?: unknown }).message
      : error,
    1_000
  );
  const explicitSeconds = message.match(
    /(?:retry(?:Delay)?|retry\s+in)[^0-9]{0,24}(\d+(?:\.\d+)?)\s*s/i
  );
  if (explicitSeconds) {
    return Math.min(
      60_000,
      Math.max(2_000, Number(explicitSeconds[1]) * 1_000)
    );
  }
  const schedule = [5_000, 15_000, 35_000, 60_000] as const;
  return schedule[Math.min(attempt, schedule.length - 1)];
}

function providerError(operation: GenerateVideosOperation) {
  const details = operation.error
    ? compact(JSON.stringify(operation.error), 600)
    : "unknown";
  if (/safety|rai|responsible/i.test(details)) {
    return safetyFilteredError(details);
  }
  return new Error(`ai_video_veo_operation_failed:${details}`);
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

function safetyFallbackPrompt(prompt: string) {
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

function scenePrompt(
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
  const primarySubject =
    exactIdea || adultSafePromptText(args.profession || args.plan.companyName, 120);
  const visualEvidence = subjectVisualEvidence(primarySubject);
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
      "Digital subject: show relevant devices and app UI with unlabeled shapes, icons and images only.",
      "No readable text, letters, numbers, captions, signs, logos, watermarks, fake writing, posters, slides or borders.",
      "No dialogue, voice-over, lyrics or music; iNrCy adds exact branding, copy and audio.",
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
  for (let attempt = 0; attempt < DEFAULT_SUBMIT_ATTEMPTS; attempt += 1) {
    try {
      return await args.ai.models.generateVideos({
        model: args.model,
        source: {
          prompt: args.prompt,
          ...(args.inspirationImages?.length === 1
            ? {
                image: {
                  imageBytes: args.inspirationImages[0].data,
                  mimeType: args.inspirationImages[0].mimeType,
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
          // Google limite Veo 3/3.1 a allow_adult dans l'UE, y compris
          // lorsqu'un plan text-to-video suit un premier plan inspire d'une
          // image. L'envoyer sur chaque clip evite un changement implicite de
          // politique au milieu du montage.
          personGeneration: "allow_adult",
          ...(args.inspirationImages && args.inspirationImages.length > 1
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
    } catch (error) {
      lastError = error;
      if (
        attempt >= DEFAULT_SUBMIT_ATTEMPTS - 1 ||
        !isExplicitlyRetryable(error)
      ) {
        throw error;
      }
      await delay(retryDelayMs(error, attempt), args.signal);
    }
  }
  throw lastError;
}

async function downloadVideo(args: {
  ai: GoogleGenAI;
  video: Video;
  signal: AbortSignal;
}) {
  const mediaType = compact(args.video.mimeType, 80) || "video/mp4";
  if (args.video.videoBytes) {
    const buffer = Buffer.from(args.video.videoBytes, "base64");
    if (!buffer.length) throw new Error("ai_video_veo_clip_empty");
    if (buffer.length > MAX_CLIP_BYTES)
      throw new Error("ai_video_veo_clip_too_large");
    return { buffer, mediaType };
  }

  const directory = await mkdtemp(join(tmpdir(), "inrcy-veo-"));
  const outputPath = join(directory, "clip.mp4");
  try {
    await args.ai.files.download({
      file: args.video,
      downloadPath: outputPath,
      config: { abortSignal: args.signal },
    });
    const info = await stat(outputPath);
    if (!info.size) throw new Error("ai_video_veo_clip_empty");
    if (info.size > MAX_CLIP_BYTES)
      throw new Error("ai_video_veo_clip_too_large");
    return { buffer: await readFile(outputPath), mediaType };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined
    );
  }
}

async function generateClip(args: {
  ai: GoogleGenAI;
  model: string;
  prompt: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: "16:9" | "9:16";
  inspirationImages?: AiVideoProviderGenerationArgs["request"]["inspirationImages"];
  timeoutMs: number;
  pollMs: number;
  onBillable: () => void;
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
    const attempts = [
      {
        prompt: args.prompt,
        inspirationImages: args.inspirationImages || [],
      },
      {
        prompt: safetyFallbackPrompt(args.prompt),
        inspirationImages: [],
      },
    ];
    let lastError: unknown = null;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      try {
        let operation = await submitOperation({
          ...args,
          prompt: attempt.prompt,
          inspirationImages: attempt.inspirationImages,
          signal: controller.signal,
        });
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
            if (!isExplicitlyRetryable(error)) throw error;
            await delay(Math.min(args.pollMs, 3_000), controller.signal);
          }
        }
        if (operation.error) throw providerError(operation);
        const response = operation.response;
        if (response?.raiMediaFilteredCount) {
          throw safetyFilteredError(response.raiMediaFilteredReasons);
        }
        const video = response?.generatedVideos?.[0]?.video;
        if (!video) throw new Error("ai_video_veo_video_missing");
        // Google indique que les rendus bloques par ses filtres ne sont pas
        // factures. On comptabilise uniquement un clip effectivement produit.
        args.onBillable();
        const downloaded = await downloadVideo({
          ai: args.ai,
          video,
          signal: controller.signal,
        });
        return {
          ...downloaded,
          durationSeconds: args.durationSeconds,
          requestId,
        };
      } catch (error) {
        lastError = error;
        const canRetryAfterSafety =
          attemptIndex === 0 && isSafetyFiltered(error);
        if (!canRetryAfterSafety) throw error;
      }
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
    const model = modelId();
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
    const costPerSecond = positiveInt(
      process.env.AI_MEDIA_VEO_COST_MICRO_USD_PER_SECOND,
      DEFAULT_COST_MICRO_USD_PER_SECOND,
      1_000_000
    );
    const requestedDurations = getAiMediaVideoSegmentDurations(
      args.request.durationSeconds || 20
    );
    // Google impose 8 secondes sur un appel utilisant 2 ou 3 images de
    // reference. Le composeur coupe ensuite proprement l'excedent eventuel
    // afin de conserver exactement la duree commerciale choisie.
    const durations: Array<4 | 6 | 8> = requestedDurations.map(
      (duration, index) =>
        args.request.inspirationImages.length > 1 && index === 0
          ? 8
          : duration,
    );
    if (args.plan.scenes.length !== durations.length) {
      throw new Error("ai_video_veo_scene_count_invalid");
    }
    const estimatedCostMicroUsd =
      durations.reduce((total, duration) => total + duration, 0) *
      costPerSecond;
    const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
      estimatedInputTokens: 0,
      reservedOutputTokens: 0,
      estimatedCostMicroUsd,
    });
    let billableSeconds = 0;
    try {
      const clips = new Array<AiVideoProviderClip | undefined>(
        durations.length
      );
      let cursor = 0;
      let stopped = false;
      let firstError: unknown = null;
      const worker = async () => {
        while (!stopped && cursor < durations.length) {
          throwIfAborted(args.signal);
          const index = cursor;
          cursor += 1;
          const durationSeconds = durations[index];
          try {
            clips[index] = await generateClip({
              ai,
              model,
              prompt: scenePrompt(args, index, durationSeconds),
              durationSeconds,
              aspectRatio: aspectRatio(args.request.format),
              inspirationImages:
                index === 0 ? args.request.inspirationImages : [],
              timeoutMs,
              pollMs,
              signal: args.signal,
              onBillable: () => {
                billableSeconds += durationSeconds;
              },
            });
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
      await commitAiGatewayAccountAttempt({
        reservation,
        feature: "media.video",
        model,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        actualCostMicroUsd: estimatedCostMicroUsd,
      });
      return {
        provider: PROVIDER_ID,
        model,
        clips: clips as AiVideoProviderClip[],
        estimatedCostMicroUsd,
        warnings: [],
      };
    } catch (error) {
      if (billableSeconds > 0) {
        await commitAiGatewayAccountAttempt({
          reservation,
          feature: "media.video",
          model,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          actualCostMicroUsd: billableSeconds * costPerSecond,
        }).catch(() => undefined);
      } else {
        await rollbackAiGatewayAccountAttempt(reservation).catch(
          () => undefined
        );
      }
      await recordAiGatewayAccountFailure({
        accountId: args.accountId,
        feature: "media.video",
        model,
      }).catch(() => undefined);
      throw error;
    }
  },
};
