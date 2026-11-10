import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { probeVideoSource, resolveVideoNormalizationFfmpegPath } from "./mediaVideoNormalizer.ts";

const run = promisify(execFile);
export const ASSISTANT_VIDEO_FRAME_COUNT = 3;
export const ASSISTANT_VIDEO_AUDIO_SECONDS = 300;
export const ASSISTANT_VIDEO_FRAME_MAX_BYTES = 110_000;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

/** The signed, persisted MIME must agree with a finite container signature.
 * Renaming a playlist cannot reach FFmpeg's format autodetection. MOV files
 * predating ftyp may start with a bounded QuickTime atom instead. */
function videoInputOptions(buffer: Buffer, mimeType: string): string[] {
  const mime = typeof mimeType === "string" ? mimeType.split(";")[0].trim().toLowerCase() : "";
  if (buffer.length < 8) throw new Error("assistant_video_format_invalid");
  if (mime === "video/webm" && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return ["-protocol_whitelist", "file,pipe", "-f", "matroska"];
  }
  if (mime !== "video/mp4" && mime !== "video/quicktime") throw new Error("assistant_video_format_invalid");
  const atom = buffer.toString("ascii", 4, 8), size32 = buffer.readUInt32BE(0);
  if (size32 === 1 && buffer.length < 16) throw new Error("assistant_video_format_invalid");
  const atomSize = size32 === 0 ? buffer.length : size32 === 1 ? Number(buffer.readBigUInt64BE(8)) : size32;
  const headerSize = size32 === 1 ? 16 : 8;
  if (!Number.isSafeInteger(atomSize) || atomSize < headerSize || atomSize > buffer.length ||
    !(atom === "ftyp" && atomSize >= headerSize + 8 || mime === "video/quicktime" && ["moov", "mdat", "wide", "free", "skip"].includes(atom))) throw new Error("assistant_video_format_invalid");
  // Explicitly disable MOV aliases/external tracks as well as network access.
  return ["-protocol_whitelist", "file,pipe", "-f", "mov", "-enable_drefs", "0", "-use_absolute_path", "0"];
}

/** Samples span the measured clip; they never imply a continuous-motion read. */
export function assistantVideoSampleTimes(durationSeconds: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86_400) throw new Error("assistant_video_duration_invalid");
  const end = Math.max(0, durationSeconds - Math.min(0.15, durationSeconds / 10));
  return [...new Set([0, durationSeconds / 2, end].map(time => Math.round(time * 1000) / 1000))];
}

export type AssistantVideoFrames = {
  durationSeconds: number;
  frames: Array<{ image: string; timeSeconds: number }>;
  hasAudio: boolean;
  audio?: File;
  audioDurationSeconds: number;
};

/** Only bytes already read from a signed private attachment enter FFmpeg.
 * Fixed local paths, no playlist/URL input, no shell interpolation. */
export async function prepareAssistantVideoAnalysis(args: { buffer: Buffer; mimeType: string; signal?: AbortSignal }): Promise<AssistantVideoFrames> {
  if (!args.buffer.length || args.buffer.length > MAX_VIDEO_BYTES) throw new Error("assistant_video_size_invalid");
  args.signal?.throwIfAborted();
  const inputOptions = videoInputOptions(args.buffer, args.mimeType);
  const folder = await mkdtemp(join(tmpdir(), "inrcy-assistant-video-"));
  try {
    const input = join(folder, "source.video");
    await writeFile(input, args.buffer);
    const ffmpeg = await resolveVideoNormalizationFfmpegPath();
    const probe = await probeVideoSource({ ffmpegPath: ffmpeg, inputPath: input, timeoutMs: 8_000,
      inputOptions, signal: args.signal });
    const times = assistantVideoSampleTimes(probe.durationSeconds);
    const frames = await Promise.all(times.map(async (timeSeconds, index) => {
      const output = join(folder, `frame-${index}.jpg`);
      try {
        await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", timeSeconds.toFixed(3),
          ...inputOptions, "-i", input, "-map", "0:v:0", "-frames:v", "1", "-an", "-sn", "-dn",
          "-vf", "scale=768:768:force_original_aspect_ratio=decrease,setsar=1", "-q:v", "5", output],
        { timeout: 10_000, maxBuffer: 256_000, windowsHide: true, signal: args.signal });
        if ((await stat(output)).size > 1_000_000) return null;
        const image = await sharp(await readFile(output), { limitInputPixels: 40_000_000 })
          .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 58 }).toBuffer();
        if (!image.length || image.length > ASSISTANT_VIDEO_FRAME_MAX_BYTES || image[0] !== 0xff || image[1] !== 0xd8) return null;
        return { image: image.toString("base64"), timeSeconds };
      } catch { return null; }
    }));
    let audio: File | undefined;
    const audioDurationSeconds = probe.hasAudio ? Math.min(probe.durationSeconds, ASSISTANT_VIDEO_AUDIO_SECONDS) : 0;
    if (probe.hasAudio && !args.signal?.aborted) {
      try {
        const output = join(folder, "speech.mp3");
        await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...inputOptions, "-i", input,
          "-map", "0:a:0", "-vn", "-sn", "-dn", "-t", String(audioDurationSeconds), "-ac", "1", "-ar", "16000", "-b:a", "48k", output],
        { timeout: 15_000, maxBuffer: 256_000, windowsHide: true, signal: args.signal });
        const size = (await stat(output)).size;
        if (size >= 900 && size <= 3 * 1024 * 1024) audio = new File([new Uint8Array(await readFile(output))], "assistant-video-speech.mp3", { type: "audio/mpeg" });
      } catch { /* The measured, validated video still has usable partial metadata. */ }
    }
    return { durationSeconds: probe.durationSeconds, frames: frames.filter((frame): frame is NonNullable<typeof frame> => frame !== null), hasAudio: probe.hasAudio, audio, audioDurationSeconds };
  } catch (error) {
    args.signal?.throwIfAborted();
    throw new Error("assistant_video_unreadable", { cause: error });
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}
