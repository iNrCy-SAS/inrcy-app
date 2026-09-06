import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { GoogleGenAI } from "@google/genai";

import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import {
  auditAiMediaNativeDialogueClips,
  tokenizeAiMediaNativeDialogue,
  type AiMediaNativeDialogueQaClip,
  type AiMediaNativeDialogueQaResult,
  type AiMediaNativeDialogueTranscript,
} from "@/lib/aiMediaNativeDialogueQa";
import { resolveVideoNormalizationFfmpegPath } from "@/lib/mediaVideoNormalizer";

const execFileAsync = promisify(execFile);
const DEFAULT_MODEL = "gemini-2.5-flash-lite";
// Ce contrôle intervient après le rendu Google : il doit rester assez court
// pour sécuriser la parole sans transformer une vidéo saine en attente longue.
// Les clips sont transcrits en parallèle, donc ce plafond vaut pour le film
// entier et non pour chaque acte additionné.
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_COST_MICRO_USD = 1_000;
const MAX_SOURCE_BYTES = 80 * 1024 * 1024;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

function compact(value: unknown, max = 500) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function positiveInt(value: unknown, fallback: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(maximum, parsed)
    : fallback;
}

function safeIdentifier(value: unknown, fallback: string) {
  const normalized = String(value ?? "").trim();
  return /^[a-z0-9][a-z0-9._-]{1,100}$/i.test(normalized)
    ? normalized
    : fallback;
}

function apiKey() {
  const value = String(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
  ).trim();
  if (!value) throw new Error("ai_media_dialogue_qa_credentials_missing");
  return value;
}

function statusFromError(error: unknown) {
  const record = error && typeof error === "object"
    ? error as { status?: unknown; code?: unknown; message?: unknown }
    : null;
  const explicit = Number(record?.status || record?.code || 0);
  if (Number.isFinite(explicit) && explicit >= 100 && explicit <= 599) return explicit;
  const match = String(record?.message || error || "").match(/\b(429|500|502|503|504)\b/);
  return match ? Number(match[1]) : 0;
}

function parseTranscript(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("ai_media_dialogue_qa_empty_response");
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(unfenced) as { transcript?: unknown };
    if (typeof parsed.transcript !== "string") {
      throw new Error("ai_media_dialogue_qa_invalid_response");
    }
    return parsed.transcript.trim();
  } catch (error) {
    if (error instanceof Error && error.message === "ai_media_dialogue_qa_invalid_response") {
      throw error;
    }
    throw new Error("ai_media_dialogue_qa_invalid_response");
  }
}

function safeExtension(mediaType: unknown) {
  const normalized = String(mediaType || "").toLowerCase();
  if (normalized.includes("webm")) return ".webm";
  if (normalized.includes("quicktime") || normalized.includes("mov")) return ".mov";
  return ".mp4";
}

async function extractLogicalClipAudio(args: {
  clip: AiMediaNativeDialogueQaClip;
  sourcePath: string;
  outputPath: string;
  ffmpegPath: string;
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  const sourceStartSeconds = Math.max(0, Number(args.clip.sourceStartSeconds || 0));
  await execFileAsync(
    args.ffmpegPath,
    [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-ss",
      String(sourceStartSeconds),
      "-i",
      args.sourcePath,
      "-t",
      String(args.clip.durationSeconds),
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      args.outputPath,
    ],
    {
      timeout: args.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      ...(args.signal ? { signal: args.signal } : {}),
    },
  );
  const audio = await readFile(args.outputPath);
  if (audio.length < 400) throw new Error("ai_media_dialogue_qa_audio_missing");
  if (audio.length > MAX_AUDIO_BYTES) throw new Error("ai_media_dialogue_qa_audio_too_large");
  return audio;
}

function usageOf(interaction: Awaited<ReturnType<GoogleGenAI["interactions"]["create"]>>) {
  if (!("usage" in interaction)) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  const usage = interaction.usage;
  return {
    inputTokens: Math.max(0, Number(usage?.total_input_tokens || 0)),
    outputTokens: Math.max(0, Number(usage?.total_output_tokens || 0)),
    totalTokens: Math.max(0, Number(usage?.total_tokens || 0)),
  };
}

async function transcribeAudioWithGoogle(args: {
  accountId: string;
  audio: Buffer;
  language: string;
  signal?: AbortSignal;
  model: string;
  timeoutMs: number;
  costMicroUsd: number;
}): Promise<AiMediaNativeDialogueTranscript> {
  args.signal?.throwIfAborted();
  const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
    estimatedInputTokens: 640,
    reservedOutputTokens: 128,
    estimatedCostMicroUsd: args.costMicroUsd,
  });
  const ai = new GoogleGenAI({ apiKey: apiKey() });
  try {
    const interaction = await ai.interactions.create(
      {
        model: args.model,
        input: [
          {
            type: "audio",
            data: args.audio.toString("base64"),
            mime_type: "audio/mpeg",
          },
          {
            type: "text",
            text: [
              "Transcris strictement les paroles intelligibles prononcées par un personnage dans cet extrait.",
              `Langue attendue : ${compact(args.language, 20) || "fr"}.`,
              "N'invente, ne corrige, ne complète et ne résume aucun mot.",
              "Conserve les répétitions, hésitations et phrases coupées telles qu'elles sont réellement entendues.",
              "Ignore la musique, les bruitages et les sons sans parole.",
              "S'il n'y a aucune parole intelligible, renvoie une chaîne vide.",
            ].join("\n"),
          },
        ],
        store: false,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { transcript: { type: "string" } },
            required: ["transcript"],
          },
        },
        generation_config: { max_output_tokens: 160 },
      },
      {
        timeout: args.timeoutMs,
        // Un échec du contrôle déclenche déjà le repli voix off/silence. Une
        // seconde tentative réseau retarderait la livraison sans améliorer la
        // sécurité du média remis au professionnel.
        maxRetries: 0,
        ...(args.signal ? { fetchOptions: { signal: args.signal } } : {}),
      },
    );
    args.signal?.throwIfAborted();
    const transcript = parseTranscript(interaction.output_text);
    await commitAiGatewayAccountAttempt({
      reservation,
      feature: "media.video",
      model: args.model,
      usage: usageOf(interaction),
      actualCostMicroUsd: args.costMicroUsd,
    });
    return { text: transcript, model: args.model };
  } catch (error) {
    await rollbackAiGatewayAccountAttempt(reservation).catch(() => undefined);
    if (args.signal?.aborted) throw error;
    await recordAiGatewayAccountFailure({
      accountId: args.accountId,
      feature: "media.video",
      model: args.model,
      status: statusFromError(error),
    }).catch(() => undefined);
    throw new Error(`ai_media_dialogue_qa_transcription_failed:${compact(error, 300)}`);
  }
}

/**
 * Contrôle sémantique post-génération des dialogues natifs.
 *
 * - extrait chaque tranche logique de 8 s, même lorsque plusieurs tranches
 *   pointent vers le même MP4 cumulatif Omni via `sourceStartSeconds` ;
 * - envoie uniquement l'audio temporaire à Gemini ;
 * - ne journalise, ne retourne et ne persiste jamais le transcript brut ;
 * - retourne exclusivement `passed`, `rejected` ou `unavailable` et des
 *   métriques non textuelles que l'appelant peut utiliser pour son fallback.
 */
export async function auditAiMediaNativeDialogueWithGoogle(args: {
  accountId: string;
  clips: AiMediaNativeDialogueQaClip[];
  language?: string;
  signal?: AbortSignal;
}): Promise<AiMediaNativeDialogueQaResult> {
  const startedAt = Date.now();
  const model = safeIdentifier(process.env.AI_MEDIA_DIALOGUE_QA_MODEL, DEFAULT_MODEL);
  const timeoutMs = positiveInt(
    process.env.AI_MEDIA_DIALOGUE_QA_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    12_000,
  );
  // Un budget unique couvre extraction + transcription. Sans cela, deux
  // timeouts successifs de 8 s pouvaient retarder le repli de près de 16 s.
  const deadlineAt = Date.now() + timeoutMs;
  const deadlineSignal = AbortSignal.timeout(timeoutMs);
  const qaSignal = args.signal
    ? AbortSignal.any([args.signal, deadlineSignal])
    : deadlineSignal;
  const remainingTimeoutMs = () => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new Error("ai_media_dialogue_qa_deadline");
    return Math.max(1, remaining);
  };
  const costMicroUsd = positiveInt(
    process.env.AI_MEDIA_DIALOGUE_QA_COST_MICRO_USD,
    DEFAULT_COST_MICRO_USD,
    100_000,
  );
  let directory = "";
  try {
    directory = await mkdtemp(path.join(tmpdir(), "inrcy-dialogue-qa-"));
    qaSignal.throwIfAborted();
    const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
    const sourcePathByBuffer = new Map<Buffer, Promise<string>>();
    const extractedAudio = await Promise.all(args.clips.map(async (clip, index) => {
      try {
        if (!clip.buffer.length || clip.buffer.length > MAX_SOURCE_BYTES) {
          throw new Error("ai_media_dialogue_qa_source_invalid");
        }
        let sourcePathPromise = sourcePathByBuffer.get(clip.buffer);
        if (!sourcePathPromise) {
          const sourcePath = path.join(directory, `source-${index}${safeExtension(clip.mediaType)}`);
          sourcePathPromise = writeFile(sourcePath, clip.buffer).then(() => sourcePath);
          sourcePathByBuffer.set(clip.buffer, sourcePathPromise);
        }
        const sourcePath = await sourcePathPromise;
        const outputPath = path.join(directory, `audio-${index}.mp3`);
        return await extractLogicalClipAudio({
          clip,
          sourcePath,
          outputPath,
          ffmpegPath,
          timeoutMs: remainingTimeoutMs(),
          signal: qaSignal,
        });
      } catch (error) {
        if (qaSignal.aborted) throw error;
        return null;
      }
    }));
    const audioByClip = new Map(
      args.clips.map((clip, index) => [clip, extractedAudio[index]] as const),
    );

    return await auditAiMediaNativeDialogueClips({
      clips: args.clips,
      language: args.language,
      signal: qaSignal,
      transcribe: async (clip, options) => {
        const audio = audioByClip.get(clip);
        if (!audio) throw new Error("ai_media_dialogue_qa_audio_missing");
        return await transcribeAudioWithGoogle({
          accountId: args.accountId,
          audio,
          language: options.language,
          signal: options.signal,
          model,
          timeoutMs: remainingTimeoutMs(),
          costMicroUsd,
        });
      },
    });
  } catch (error) {
    if (args.signal?.aborted) throw error;
    // Une panne FFmpeg/Google ne doit jamais être confondue avec une vidéo
    // conforme. L'appelant reçoit explicitement `unavailable` et choisit son
    // repli contrôlé (nouvelle tentative, voix off ou vidéo silencieuse).
    return {
      version: 1,
      status: "unavailable",
      clips: args.clips.map((clip) => ({
        sceneIndex: clip.sceneIndex,
        status: "unavailable" as const,
        issues: ["transcription_unavailable" as const],
        metrics: {
          expectedTokenCount: tokenizeAiMediaNativeDialogue(clip.expectedLine).length,
          detectedTokenCount: 0,
          expectedCoverage: 0,
          bestWindowSimilarity: 0,
          extraTokenCount: 0,
          repeatCount: 0,
        },
      })),
      elapsedMs: Date.now() - startedAt,
      model,
    };
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
