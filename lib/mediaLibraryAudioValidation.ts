import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveVideoNormalizationFfmpegPath } from "@/lib/mediaVideoNormalizer";
import { MEDIA_LIBRARY_AUDIO_MAX_BYTES, MEDIA_LIBRARY_AUDIO_MAX_DURATION_SECONDS, type MediaLibraryAudioMimeType } from "./mediaLibraryAudio.ts";

const run = promisify(execFile);

export function detectMediaLibraryAudioBytes(buffer: Buffer): MediaLibraryAudioMimeType | null {
  if (buffer.length >= 44 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") return "audio/wav";
  if (buffer.length >= 4 && (buffer.toString("ascii", 0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))) return "audio/mpeg";
  return null;
}

/** Decode only bounded local MP3/WAV audio to measure the real sample duration. */
export async function validateMediaLibraryAudioBuffer(args: { buffer: Buffer; mimeType: MediaLibraryAudioMimeType; signal?: AbortSignal }) {
  if (!args.buffer.length || args.buffer.length > MEDIA_LIBRARY_AUDIO_MAX_BYTES) throw new Error("media_library_audio_size_invalid");
  if (detectMediaLibraryAudioBytes(args.buffer) !== args.mimeType) throw new Error("media_library_audio_format_invalid");
  args.signal?.throwIfAborted();
  const folder = await mkdtemp(join(tmpdir(), "inrcy-library-audio-"));
  try {
    const source = join(folder, "source.audio");
    await writeFile(source, args.buffer);
    const ffmpeg = await resolveVideoNormalizationFfmpegPath();
    let pcm: Buffer;
    try {
      const result = await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-f", args.mimeType === "audio/wav" ? "wav" : "mp3", "-i", source,
        "-map", "0:a:0", "-vn", "-sn", "-dn", "-t", String(MEDIA_LIBRARY_AUDIO_MAX_DURATION_SECONDS + 1), "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"],
      { encoding: "buffer", timeout: 20_000, maxBuffer: 5 * 1024 * 1024, windowsHide: true, signal: args.signal });
      pcm = result.stdout;
    } catch {
      args.signal?.throwIfAborted();
      throw new Error("media_library_audio_unreadable");
    }
    const durationSeconds = pcm.byteLength / 16_000;
    if (!durationSeconds || durationSeconds > MEDIA_LIBRARY_AUDIO_MAX_DURATION_SECONDS) throw new Error("media_library_audio_duration_invalid");
    return { mimeType: args.mimeType, durationSeconds: Math.round(durationSeconds * 1000) / 1000 };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
