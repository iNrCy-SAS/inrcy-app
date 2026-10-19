import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveVideoNormalizationFfmpegPath } from "@/lib/mediaVideoNormalizer";
import {
  AI_MEDIA_CHARACTER_VOICE_MAX_NORMALIZED_BYTES, AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS,
  AI_MEDIA_CHARACTER_VOICE_MIN_SECONDS, AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES,
} from "./aiMediaCharacterVoices.ts";

const run = promisify(execFile);

function voiceAudioDemuxer(buffer: Buffer) {
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") return "wav";
  if (buffer.toString("ascii", 0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return "mp3";
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "matroska";
  if (buffer.toString("ascii", 0, 4) === "OggS") return "ogg";
  if (buffer.toString("ascii", 4, 8) === "ftyp") return "mov";
  throw new Error("voice_audio_format_invalid");
}

/** Read only canonical mono PCM16 WAV written by this route, never trust a filename/MIME alone. */
export function inspectAiMediaCharacterVoiceWav(buffer: Buffer) {
  if (buffer.length < 44 || buffer.length > AI_MEDIA_CHARACTER_VOICE_MAX_NORMALIZED_BYTES + 6_400 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("voice_audio_invalid");
  let validFormat = false;
  let sampleBytes = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > buffer.length) throw new Error("voice_audio_invalid");
    const id = buffer.toString("ascii", offset, offset + 4);
    if (id === "fmt " && size >= 16) {
      validFormat = buffer.readUInt16LE(offset + 8) === 1 && buffer.readUInt16LE(offset + 10) === 1 &&
        buffer.readUInt32LE(offset + 12) === 16_000 && buffer.readUInt16LE(offset + 22) === 16;
    }
    if (id === "data") sampleBytes += size;
    offset = end + (size % 2);
  }
  const durationSeconds = sampleBytes / 32_000;
  if (!validFormat || !sampleBytes || sampleBytes % 2) throw new Error("voice_audio_invalid");
  if (durationSeconds < AI_MEDIA_CHARACTER_VOICE_MIN_SECONDS || durationSeconds > AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS) throw new Error("voice_audio_duration_invalid");
  return { durationSeconds, sampleBytes };
}

export async function normalizeAiMediaCharacterVoiceAudio(args: { buffer: Buffer; recording?: boolean; signal?: AbortSignal }) {
  if (!args.buffer.length || args.buffer.length > AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES) throw new Error("voice_audio_size_invalid");
  const demuxer = voiceAudioDemuxer(args.buffer);
  args.signal?.throwIfAborted();
  const folder = await mkdtemp(join(tmpdir(), "inrcy-character-voice-"));
  try {
    const source = join(folder, "source.audio");
    const target = join(folder, "voice.wav");
    await writeFile(source, args.buffer);
    const ffmpeg = await resolveVideoNormalizationFfmpegPath();
    try {
      await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-f", demuxer, "-i", source,
        "-map", "0:a:0", "-vn", "-sn", "-dn", "-t", args.recording ? "10" : "10.1", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-y", target],
      { timeout: 20_000, maxBuffer: 64 * 1024, windowsHide: true, signal: args.signal });
    } catch {
      args.signal?.throwIfAborted();
      throw new Error("voice_audio_invalid");
    }
    const buffer = await readFile(target);
    const inspected = inspectAiMediaCharacterVoiceWav(buffer);
    if (buffer.length > AI_MEDIA_CHARACTER_VOICE_MAX_NORMALIZED_BYTES) throw new Error("voice_audio_size_invalid");
    return { buffer, durationSeconds: inspected.durationSeconds, mimeType: "audio/wav" as const };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
