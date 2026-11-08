import "server-only";
import { setTimeout as delay } from "node:timers/promises";

import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { inspectAiMediaCharacterVoiceWav } from "@/lib/aiMediaCharacterVoiceAudio";
import { isOwnedAiMediaCharacterVoicePath } from "./aiMediaCharacterVoices.ts";
import { safeAiVideoProviderErrorMetadata, safeAiVideoProviderFailureDiagnostics, type AiVideoProviderFailurePhase } from "./aiMediaSensitiveText.ts";
import type { AiMediaNarration } from "@/lib/aiMediaNarration";
import type { GeneratedAiNarrationAudio } from "@/lib/aiMediaNarrationAudio";
import type { PreparedAiMediaNarrationVoice } from "@/lib/aiMediaNarrationVoicePreflight";

// Official schema: text <= 300 characters, custom audio + its spoken language.
// https://fal.ai/models/fal-ai/chatterbox/text-to-speech/multilingual/api
const MODEL = "fal-ai/chatterbox/text-to-speech/multilingual";
const QUEUE_ORIGIN = "https://queue.fal.run";
const ENDPOINT = `${QUEUE_ORIGIN}/${MODEL}`;
const QUEUE_REQUEST_PATH = "/fal-ai/chatterbox/requests/";
const MAX_TEXT_CHARACTERS = 300;
const MAX_SCRIPT_CHARACTERS = 1_200;
const MAX_AUDIO_SEGMENTS = 10;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const SUBMIT_TIMEOUT_MS = 30_000;
const QUEUE_READ_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 1_000;
export const AI_MEDIA_CLONED_NARRATION_TIMEOUT_MS = 240_000;
// Official price: $0.025 / 1,000 characters = 25 micro USD / character.
const COST_MICRO_USD_PER_CHARACTER = 25;
const LANGUAGES: Readonly<Record<string, string>> = Object.freeze({
  en: "english", ar: "arabic", da: "danish", de: "german", el: "greek",
  es: "spanish", fi: "finnish", fr: "french", he: "hebrew", hi: "hindi",
  it: "italian", ja: "japanese", ko: "korean", ms: "malay", nl: "dutch",
  no: "norwegian", pl: "polish", pt: "portuguese", ru: "russian", sv: "swedish",
  sw: "swahili", tr: "turkish", zh: "chinese",
});

/** No truncation: every spoken word is retained, even for a long single token. */
export function splitAiMediaClonedNarrationScript(script: string): string[] {
  const text = script.replace(/\s+/gu, " ").trim();
  const characters = Array.from(text);
  if (!characters.length || characters.length > MAX_SCRIPT_CHARACTERS || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) {
    throw new Error("ai_media_voice_clone_script_invalid");
  }
  const chunks: string[] = [];
  let remaining = characters;
  while (remaining.length > MAX_TEXT_CHARACTERS) {
    const candidate = remaining.slice(0, MAX_TEXT_CHARACTERS).join("");
    // Prefer a sentence boundary; otherwise the last whole word. Do not send
    // a tiny chunk just because a punctuation mark appears at the beginning.
    const sentences = [...candidate.matchAll(/[.!?。！？;]\s+/gu)];
    const sentence = sentences.at(-1);
    const sentenceEnd = sentence ? Array.from(candidate.slice(0, sentence.index! + sentence[0].length)).length : 0;
    const wordEnd = candidate.lastIndexOf(" ");
    const end = sentenceEnd >= 120 ? sentenceEnd
      : wordEnd >= 0 && Array.from(candidate.slice(0, wordEnd + 1)).length >= 120 ? Array.from(candidate.slice(0, wordEnd + 1)).length
        : MAX_TEXT_CHARACTERS;
    chunks.push(remaining.slice(0, end).join("").trim());
    remaining = remaining.slice(end);
    while (remaining[0] === " ") remaining = remaining.slice(1);
  }
  if (remaining.length) chunks.push(remaining.join("").trim());
  return chunks;
}

export function isAiMediaVoiceCloneConfigured() {
  return Boolean(String(process.env.FAL_KEY || "").trim());
}

export function supportsAiMediaClonedNarrationLanguage(language: string) {
  return Object.hasOwn(LANGUAGES, language.toLowerCase().split(/[-_]/u)[0]);
}

async function readBoundedResponse(response: Response, maximum: number): Promise<Buffer> {
  const stated = Number(response.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > maximum) {
    await response.body?.cancel();
    throw new Error("ai_media_voice_clone_response_too_large");
  }
  if (!response.body) throw new Error("ai_media_voice_clone_response_empty");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) throw new Error("ai_media_voice_clone_response_too_large");
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!size) throw new Error("ai_media_voice_clone_response_empty");
  return Buffer.concat(chunks, size);
}

function outputAudioUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_048) throw new Error("ai_media_voice_clone_output_invalid");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("ai_media_voice_clone_output_invalid"); }
  // Only download the provider's media CDN. Never send its API key here and
  // never follow redirects into an arbitrary host, private address or scheme.
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(url.hostname === "fal.media" || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.fal\.media$/u.test(url.hostname))) {
    throw new Error("ai_media_voice_clone_output_invalid");
  }
  return url.href;
}

function queueRequestUrls(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("ai_media_voice_clone_queue_invalid");
  const request = value as Record<string, unknown>;
  const id = request.request_id;
  if (typeof id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(id)) {
    throw new Error("ai_media_voice_clone_queue_invalid");
  }
  const validate = (value: unknown, suffix: string) => {
    if (typeof value !== "string" || value.length > 2_048) throw new Error("ai_media_voice_clone_queue_invalid");
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("ai_media_voice_clone_queue_invalid"); }
    // Returned URLs carry our API key, unlike the audio CDN download below.
    // Require the same provider, model app and acknowledged request ID.
    if (url.origin !== QUEUE_ORIGIN || url.username || url.password || url.search || url.hash ||
        url.pathname !== `${QUEUE_REQUEST_PATH}${id}${suffix}`) throw new Error("ai_media_voice_clone_queue_invalid");
    return url.href;
  };
  return { id, status: validate(request.status_url, "/status"), result: validate(request.response_url, "") };
}

async function readJsonResponse(response: Response) {
  const bytes = await readBoundedResponse(response, MAX_RESPONSE_BYTES);
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error("ai_media_voice_clone_output_invalid"); }
}

type WavParts = { format: Buffer; data: Buffer; byteRate: number };

function readWav(buffer: Buffer): WavParts {
  if (buffer.length < 44 || buffer.length > MAX_AUDIO_BYTES ||
      buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("ai_media_voice_clone_audio_invalid");
  }
  let format: Buffer | undefined;
  const samples: Buffer[] = [];
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > buffer.length) throw new Error("ai_media_voice_clone_audio_invalid");
    if (id === "fmt ") {
      if (format || size < 16 || size > 64) throw new Error("ai_media_voice_clone_audio_invalid");
      format = buffer.subarray(offset + 8, end);
    }
    if (id === "data") samples.push(buffer.subarray(offset + 8, end));
    offset = end + size % 2;
  }
  if (!format || !samples.length) throw new Error("ai_media_voice_clone_audio_invalid");
  const codec = format.readUInt16LE(0);
  const channels = format.readUInt16LE(2);
  const sampleRate = format.readUInt32LE(4);
  const byteRate = format.readUInt32LE(8);
  const alignment = format.readUInt16LE(12);
  const bits = format.readUInt16LE(14);
  const data = Buffer.concat(samples);
  if (![1, 3].includes(codec) || ![1, 2].includes(channels) ||
      sampleRate < 8_000 || sampleRate > 96_000 ||
      !(codec === 3 ? bits === 32 : [8, 16, 24, 32].includes(bits)) ||
      alignment !== channels * bits / 8 || byteRate !== sampleRate * alignment ||
      !data.length || data.length % alignment || data.length / byteRate > 120) {
    throw new Error("ai_media_voice_clone_audio_invalid");
  }
  return { format, data, byteRate };
}

/** Join compatible WAV samples, not complete RIFF containers, in script order. */
export function joinAiMediaClonedNarrationWav(buffers: readonly Buffer[]): Buffer {
  if (!buffers.length || buffers.length > MAX_AUDIO_SEGMENTS) throw new Error("ai_media_voice_clone_audio_invalid");
  const parts = buffers.map(readWav);
  if (parts.some((part) => !part.format.equals(parts[0].format))) throw new Error("ai_media_voice_clone_audio_format_mismatch");
  const data = Buffer.concat(parts.map((part) => part.data));
  const format = parts[0].format;
  const padding = data.length % 2;
  const totalSize = 12 + 8 + format.length + format.length % 2 + 8 + data.length + padding;
  if (totalSize > MAX_AUDIO_BYTES || data.length / parts[0].byteRate > 120) throw new Error("ai_media_voice_clone_audio_too_large");
  const result = Buffer.alloc(totalSize);
  result.write("RIFF", 0); result.writeUInt32LE(totalSize - 8, 4); result.write("WAVE", 8);
  result.write("fmt ", 12); result.writeUInt32LE(format.length, 16); format.copy(result, 20);
  const dataOffset = 20 + format.length + format.length % 2;
  result.write("data", dataOffset); result.writeUInt32LE(data.length, dataOffset + 4); data.copy(result, dataOffset + 8);
  return result;
}

/** Synthesize new words with an explicitly consented real voice, never replay the source clip. */
export async function generateAiMediaClonedNarrationAudio(args: {
  accountId: string;
  narration: AiMediaNarration;
  reference: PreparedAiMediaNarrationVoice;
  narrationVoiceConsent: boolean;
  narrationVoiceGender: "auto" | "female" | "male";
  durationSeconds: number;
  signal?: AbortSignal;
}): Promise<GeneratedAiNarrationAudio> {
  args.signal?.throwIfAborted();
  if (args.narrationVoiceConsent !== true) throw new Error("ai_media_voice_clone_consent_required");
  if (args.reference.accountId !== args.accountId || !isOwnedAiMediaCharacterVoicePath(args.accountId, args.reference.path)) {
    throw new Error("ai_media_voice_clone_reference_invalid");
  }
  const actual = inspectAiMediaCharacterVoiceWav(args.reference.buffer);
  if (actual.durationSeconds < 5 || actual.durationSeconds > 10) throw new Error("ai_media_voice_clone_reference_duration_invalid");
  const language = LANGUAGES[args.narration.language.toLowerCase().split(/[-_]/u)[0]];
  if (!language) throw new Error("ai_media_voice_clone_language_unsupported");
  if (!Number.isFinite(args.durationSeconds) || args.durationSeconds < 1 || args.durationSeconds > 30) {
    throw new Error("ai_media_voice_clone_video_duration_invalid");
  }
  const texts = splitAiMediaClonedNarrationScript(args.narration.script);
  const key = String(process.env.FAL_KEY || "").trim();
  if (!key) throw new Error("ai_media_voice_clone_credentials_missing");
  const signal = AbortSignal.any([...(args.signal ? [args.signal] : []), AbortSignal.timeout(AI_MEDIA_CLONED_NARRATION_TIMEOUT_MS)]);
  const voice = `data:audio/wav;base64,${args.reference.buffer.toString("base64")}`;
  const output: Buffer[] = [];
  for (const text of texts) {
    signal.throwIfAborted();
    const estimatedCostMicroUsd = Array.from(text).length * COST_MICRO_USD_PER_CHARACTER;
    const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
      feature: "media.video", estimatedInputTokens: 0, reservedOutputTokens: 0, estimatedCostMicroUsd,
    });
    let attempted = false;
    let definitelyRejected = false;
    let accounted = false;
    let status = 0;
    const startedAt = Date.now();
    let phase: AiVideoProviderFailurePhase = "provider_submission";
    let requestSignal: AbortSignal | undefined;
    let downloadSignal: AbortSignal | undefined;
    try {
      signal.throwIfAborted();
      attempted = true;
      // One POST only: retrying after a connection timeout could bill twice.
      // No provider voice profile is created. The original stays in our private store.
      requestSignal = AbortSignal.any([signal, AbortSignal.timeout(SUBMIT_TIMEOUT_MS)]);
      const response = await fetch(ENDPOINT, {
        method: "POST", cache: "no-store", credentials: "omit", redirect: "error",
        signal: requestSignal,
        headers: {
          Authorization: `Key ${key}`, "Content-Type": "application/json",
          "X-Fal-Store-IO": "0", "X-Fal-No-Retry": "1",
          "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: 3_600 }),
          "x-app-fal-disable-fallback": "true",
        },
        body: JSON.stringify({ text, voice, custom_audio_language: language, enable_safety_checker: true,
          exaggeration: 0.5, cfg_scale: 0.5, temperature: 0.5 }),
      });
      status = response.status;
      definitelyRejected = status >= 400 && status < 500;
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`ai_media_voice_clone_provider_http_${status}`);
      }
      const request = queueRequestUrls(await readJsonResponse(response));
      // Queue acknowledgement is not a completed synthesis. GET failures after
      // acknowledgement cannot prove rejection, so they never release its cost.
      definitelyRejected = false;
      const readQueue = async (url: string) => {
        for (let attempt = 0; ; attempt += 1) {
          signal.throwIfAborted();
          requestSignal = AbortSignal.any([signal, AbortSignal.timeout(QUEUE_READ_TIMEOUT_MS)]);
          try {
            const response = await fetch(url, { method: "GET", cache: "no-store", credentials: "omit", redirect: "error",
              signal: requestSignal, headers: { Authorization: `Key ${key}` } });
            status = response.status;
            if (!response.ok) {
              await response.body?.cancel();
              if (attempt < 2 && (status === 429 || status >= 500)) {
                await delay(POLL_INTERVAL_MS, undefined, { signal });
                continue;
              }
              throw new Error(`ai_media_voice_clone_provider_http_${status}`);
            }
            return await readJsonResponse(response);
          } catch (error) {
            signal.throwIfAborted();
            // Retrying a GET only observes the existing request. Never repeat
            // submission, including when its acceptance was not received.
            if (attempt < 2 && (requestSignal.aborted || error instanceof TypeError)) {
              await delay(POLL_INTERVAL_MS, undefined, { signal });
              continue;
            }
            throw error;
          }
        }
      };
      let completedWithError = false;
      for (;;) {
        const state = await readQueue(request.status);
        if (!state || typeof state !== "object") throw new Error("ai_media_voice_clone_queue_invalid");
        const entry = state as Record<string, unknown>;
        if (entry.request_id !== undefined && entry.request_id !== request.id) throw new Error("ai_media_voice_clone_queue_invalid");
        if (entry.status === "COMPLETED") {
          completedWithError = entry.error != null || entry.error_type != null;
          break;
        }
        if (entry.status !== "IN_QUEUE" && entry.status !== "IN_PROGRESS") throw new Error("ai_media_voice_clone_queue_invalid");
        await delay(POLL_INTERVAL_MS, undefined, { signal });
      }
      phase = "output_validation";
      const result = await readQueue(request.result);
      if (completedWithError) throw new Error("ai_media_voice_clone_provider_failed");
      // A successful synthesis is billable even if validation or its download
      // later fails. Do not erase that cost or re-synthesize it.
      phase = "cost_commit";
      accounted = true;
      await commitAiGatewayAccountAttempt({ reservation, feature: "media.video", model: MODEL,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, actualCostMicroUsd: estimatedCostMicroUsd });
      phase = "output_validation";
      const audio = result && typeof result === "object" && "audio" in result ? result.audio : null;
      const url = outputAudioUrl(audio && typeof audio === "object" && "url" in audio ? audio.url : null);
      phase = "asset_download";
      downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      const download = await fetch(url, { method: "GET", cache: "no-store", credentials: "omit", redirect: "error",
        signal: downloadSignal });
      if (!download.ok) { await download.body?.cancel(); throw new Error("ai_media_voice_clone_audio_download_failed"); }
      const buffer = await readBoundedResponse(download, MAX_AUDIO_BYTES);
      phase = "output_validation";
      readWav(buffer);
      output.push(buffer);
    } catch (error) {
      if (!accounted) {
        if (attempted && !definitelyRejected) {
          // Ambiguous transport/provider failure: keep the conservative cost,
          // without retrying a synthesis which may already have been produced.
          await commitAiGatewayAccountAttempt({ reservation, feature: "media.video", model: MODEL,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, actualCostMicroUsd: estimatedCostMicroUsd }).catch(() => undefined);
        } else await rollbackAiGatewayAccountAttempt(reservation).catch(() => undefined);
      }
      await recordAiGatewayAccountFailure({ accountId: args.accountId, feature: "media.video", model: MODEL, status }).catch(() => undefined);
      args.signal?.throwIfAborted();
      // Do not persist a fetch error/cause that could contain the key, vocal,
      // signed download URL or original HTTP body.
      const activeSignal = phase === "asset_download" ? downloadSignal : requestSignal;
      const timedOut = signal.aborted || activeSignal?.aborted === true;
      const safe = error instanceof Error && /^ai_media_voice_clone_[a-z0-9_]+$/u.test(error.message)
        ? error.message : timedOut ? "ai_media_voice_clone_timeout" : "ai_media_voice_clone_unavailable";
      // Persist machine categories only. Never retain a private fetch exception.
      throw Object.assign(new Error(safe), { diagnostics: safeAiVideoProviderFailureDiagnostics({
        ...safeAiVideoProviderErrorMetadata(error), phase,
        ...(status >= 400 && status <= 599 ? { providerHttpStatus: status } : {}),
        elapsedMs: Math.max(0, Date.now() - startedAt),
        callerAborted: args.signal?.aborted === true,
        providerAborted: timedOut, deadlineExceeded: timedOut,
      }) });
    }
  }
  return { buffer: joinAiMediaClonedNarrationWav(output), mimeType: "audio/wav", extension: "wav", model: MODEL, voice: "provided" };
}
