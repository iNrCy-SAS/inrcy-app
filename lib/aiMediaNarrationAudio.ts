import "server-only";

import { GoogleGenAI } from "@google/genai";

import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import type { AiMediaNarration } from "@/lib/aiMediaNarration";

const DEFAULT_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const DEFAULT_TTS_VOICE = "Kore";
const DEFAULT_TTS_COST_MICRO_USD = 15_000;
const DEFAULT_TTS_TIMEOUT_MS = 45_000;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

const LANGUAGE_CODES: Record<string, string> = {
  fr: "fr-FR",
  en: "en-GB",
  es: "es-ES",
  it: "it-IT",
  de: "de-DE",
  nl: "nl-NL",
  pt: "pt-PT",
  th: "th-TH",
  zh: "zh-CN",
};

export type GeneratedAiNarrationAudio = {
  buffer: Buffer;
  mimeType: string;
  extension: "wav" | "mp3" | "ogg" | "aac";
  model: string;
  voice: string;
};

function positiveInt(value: unknown, fallback: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(maximum, parsed)
    : fallback;
}

function compact(value: unknown, max = 500) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function apiKey() {
  const value = String(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
  ).trim();
  if (!value) throw new Error("ai_video_veo_credentials_missing");
  return value;
}

function safeIdentifier(value: unknown, fallback: string) {
  const normalized = String(value ?? "").trim();
  return /^[a-z0-9][a-z0-9._-]{1,100}$/i.test(normalized)
    ? normalized
    : fallback;
}

function statusFromError(error: unknown) {
  const source = error && typeof error === "object"
    ? (error as { status?: unknown; code?: unknown; message?: unknown })
    : null;
  const explicit = Number(source?.status || source?.code || 0);
  if (Number.isFinite(explicit) && explicit >= 100 && explicit <= 599) return explicit;
  const match = String(source?.message || error || "").match(/\b(429|500|502|503|504)\b/);
  return match ? Number(match[1]) : 0;
}

function retryable(error: unknown) {
  return [429, 500, 502, 503, 504].includes(statusFromError(error));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function hasWavHeader(buffer: Buffer) {
  return buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE";
}

function pcm16ToWav(buffer: Buffer, sampleRate: number, channels: number) {
  const header = Buffer.alloc(44);
  const safeChannels = channels === 2 ? 2 : 1;
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + buffer.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(safeChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * safeChannels * 2, 28);
  header.writeUInt16LE(safeChannels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(buffer.length, 40);
  return Buffer.concat([header, buffer]);
}

function normalizeAudio(args: {
  data: string;
  mimeType?: string;
  sampleRate?: number;
  channels?: number;
}) {
  const raw = Buffer.from(args.data, "base64");
  if (!raw.length) throw new Error("ai_media_narration_audio_empty");
  if (raw.length > MAX_AUDIO_BYTES) throw new Error("ai_media_narration_audio_too_large");
  const mimeType = compact(args.mimeType, 80).toLocaleLowerCase();
  if (hasWavHeader(raw)) {
    return { buffer: raw, mimeType: "audio/wav", extension: "wav" as const };
  }
  if (/mpeg|mp3/.test(mimeType)) {
    return { buffer: raw, mimeType: "audio/mpeg", extension: "mp3" as const };
  }
  if (/ogg|opus/.test(mimeType)) {
    return { buffer: raw, mimeType: "audio/ogg", extension: "ogg" as const };
  }
  if (/aac|m4a/.test(mimeType)) {
    return { buffer: raw, mimeType: "audio/aac", extension: "aac" as const };
  }
  // Les modèles TTS peuvent renvoyer du PCM 16 bits même lorsqu'un WAV a été
  // demandé. L'encapsulation locale évite un décodage ambigu dans FFmpeg.
  const wav = pcm16ToWav(
    raw,
    positiveInt(args.sampleRate, 24_000, 96_000),
    positiveInt(args.channels, 1, 2),
  );
  return { buffer: wav, mimeType: "audio/wav", extension: "wav" as const };
}

/**
 * Lit mot pour mot le script validé. Veo n'est jamais autorisé à inventer une
 * voix ou des lettres ; la narration contrôlée est une piste indépendante.
 */
export async function generateAiMediaNarrationAudio(args: {
  accountId: string;
  narration: AiMediaNarration;
  durationSeconds: 8 | 16 | 24;
}): Promise<GeneratedAiNarrationAudio> {
  const model = safeIdentifier(process.env.AI_MEDIA_TTS_MODEL, DEFAULT_TTS_MODEL);
  const voice = safeIdentifier(process.env.AI_MEDIA_TTS_VOICE, DEFAULT_TTS_VOICE);
  const costMicroUsd = positiveInt(
    process.env.AI_MEDIA_TTS_COST_MICRO_USD,
    DEFAULT_TTS_COST_MICRO_USD,
    1_000_000,
  );
  const timeoutMs = positiveInt(
    process.env.AI_MEDIA_TTS_TIMEOUT_MS,
    DEFAULT_TTS_TIMEOUT_MS,
    90_000,
  );
  const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
    estimatedInputTokens: 0,
    reservedOutputTokens: 0,
    estimatedCostMicroUsd: costMicroUsd,
  });
  const ai = new GoogleGenAI({ apiKey: apiKey() });
  const language = LANGUAGE_CODES[args.narration.language] || LANGUAGE_CODES.fr;

  try {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const interaction = await ai.interactions.create(
          {
            model,
            input: [
              "INSTRUCTION DE JEU — ne prononce pas cette ligne :",
              `Voix professionnelle, chaleureuse et naturelle. Langue ${language}. Débit fluide adapté à une vidéo de ${args.durationSeconds} secondes, sans chant ni emphase artificielle.`,
              "TRANSCRIPTION À LIRE MOT POUR MOT :",
              args.narration.script,
            ].join("\n"),
            store: false,
            response_format: {
              type: "audio",
            },
            generation_config: {
              speech_config: [{ voice, language }],
            },
          },
          { timeout: timeoutMs, maxRetries: 0 },
        );
        const audio = interaction.output_audio;
        if (!audio?.data) throw new Error("ai_media_narration_audio_empty");
        const normalized = normalizeAudio({
          data: audio.data,
          mimeType: audio.mime_type,
          sampleRate: audio.sample_rate,
          channels: audio.channels,
        });
        await commitAiGatewayAccountAttempt({
          reservation,
          feature: "media.video",
          model,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          actualCostMicroUsd: costMicroUsd,
        });
        return { ...normalized, model, voice };
      } catch (error) {
        lastError = error;
        if (attempt >= 2 || (!retryable(error) && !String(error).includes("audio_empty"))) {
          throw error;
        }
        await delay(attempt === 0 ? 1_500 : 4_000);
      }
    }
    throw lastError;
  } catch (error) {
    await rollbackAiGatewayAccountAttempt(reservation).catch(() => undefined);
    await recordAiGatewayAccountFailure({
      accountId: args.accountId,
      feature: "media.video",
      model,
      status: statusFromError(error),
    }).catch(() => undefined);
    throw new Error(`ai_media_narration_failed:${compact(error, 700)}`);
  }
}
