import "server-only";

import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

import type { LoadedAiMediaSoundtrack } from "@/lib/aiMediaGenerationSoundtracks";
import {
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
} from "@/lib/mediaVideoNormalizer";

const execFileAsync = promisify(execFile);
const IMAGE_SIDE = 1024;
const VIDEO_SIDE = 1080;
const VIDEO_DURATION_SECONDS = 8;
// Keep the normalized file below the private media bucket's 100 MiB object cap.
const MAX_NORMALIZED_VIDEO_BYTES = 60 * 1024 * 1024;

export type NormalizedAiImage = {
  kind: "image";
  buffer: Buffer;
  mimeType: "image/jpeg";
  extension: "jpg";
  width: 1024;
  height: 1024;
  durationSeconds: null;
};

export type NormalizedAiVideo = {
  kind: "video";
  buffer: Buffer;
  mimeType: "video/mp4";
  extension: "mp4";
  width: 1080;
  height: 1080;
  durationSeconds: 8;
};

export type NormalizedAiMedia = NormalizedAiImage | NormalizedAiVideo;

function compactFfmpegError(error: unknown) {
  const record = error as { stderr?: unknown; message?: unknown } | null;
  return String(record?.stderr || record?.message || error || "ffmpeg_failed")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
}

export async function normalizeGeneratedAiImage(
  input: Buffer,
): Promise<NormalizedAiImage> {
  const rendered = await sharp(input, {
    failOn: "error",
    limitInputPixels: 40_000_000,
    pages: 1,
  })
    .rotate()
    .resize({
      width: IMAGE_SIDE,
      height: IMAGE_SIDE,
      fit: "cover",
      position: "attention",
      withoutEnlargement: false,
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toColourspace("srgb")
    .jpeg({
      quality: 88,
      mozjpeg: true,
      progressive: true,
      chromaSubsampling: "4:2:0",
      optimiseCoding: true,
      optimiseScans: true,
    })
    .toBuffer({ resolveWithObject: true });

  if (
    rendered.info.width !== IMAGE_SIDE ||
    rendered.info.height !== IMAGE_SIDE ||
    !rendered.data.byteLength
  ) {
    throw new Error("ai_image_normalization_invalid");
  }

  return {
    kind: "image",
    buffer: rendered.data,
    mimeType: "image/jpeg",
    extension: "jpg",
    width: IMAGE_SIDE,
    height: IMAGE_SIDE,
    durationSeconds: null,
  };
}

function videoFilter() {
  return [
    `trim=duration=${VIDEO_DURATION_SECONDS}`,
    "setpts=PTS-STARTPTS",
    "scale=1080:1080:force_original_aspect_ratio=decrease:flags=lanczos",
    "pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=black",
    "setsar=1",
    `tpad=stop_mode=clone:stop_duration=${VIDEO_DURATION_SECONDS}`,
    "fps=30",
    "format=yuv420p",
  ].join(",");
}

async function runVideoNormalization(args: {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  soundtrack?: LoadedAiMediaSoundtrack | null;
}) {
  const command = ["-hide_banner", "-nostdin", "-y", "-i", args.inputPath];
  if (args.soundtrack) {
    command.push("-stream_loop", "-1", "-i", args.soundtrack.absolutePath);
  }

  const videoChain = `[0:v:0]${videoFilter()}[video]`;
  const audioChain = args.soundtrack
    ? `;[1:a:0]atrim=duration=${VIDEO_DURATION_SECONDS},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.25,afade=t=out:st=${VIDEO_DURATION_SECONDS - 0.75}:d=0.75,volume=0.24[audio]`
    : "";
  command.push(
    "-filter_complex",
    `${videoChain}${audioChain}`,
    "-map",
    "[video]",
  );
  if (args.soundtrack) {
    command.push("-map", "[audio]");
  }
  command.push(
    "-t",
    String(VIDEO_DURATION_SECONDS),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
  );
  if (args.soundtrack) {
    command.push(
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
    );
  } else {
    command.push("-an");
  }
  command.push(
    "-movflags",
    "+faststart",
    "-map_metadata",
    "-1",
    "-metadata:s:v:0",
    "rotate=0",
    args.outputPath,
  );

  try {
    await execFileAsync(args.ffmpegPath, command, {
      timeout: 2 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`ai_video_normalization_failed:${compactFfmpegError(error)}`);
  }
}

export async function normalizeGeneratedAiVideo(args: {
  input: Buffer;
  soundtrack?: LoadedAiMediaSoundtrack | null;
}): Promise<NormalizedAiVideo> {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "inrcy-ai-video-"),
  );
  const inputPath = path.join(temporaryDirectory, "gateway-source.mp4");
  const outputPath = path.join(temporaryDirectory, "inrcy-square-8s.mp4");

  try {
    await writeFile(inputPath, args.input);
    const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
    await runVideoNormalization({
      ffmpegPath,
      inputPath,
      outputPath,
      soundtrack: args.soundtrack,
    });

    const [metadata, outputStats] = await Promise.all([
      probeVideoSource({
        ffmpegPath,
        inputPath: outputPath,
        timeoutMs: 45_000,
      }),
      stat(outputPath),
    ]);
    if (
      metadata.orientedWidth !== VIDEO_SIDE ||
      metadata.orientedHeight !== VIDEO_SIDE ||
      Math.abs(metadata.durationSeconds - VIDEO_DURATION_SECONDS) > 0.15 ||
      outputStats.size <= 0 ||
      outputStats.size > MAX_NORMALIZED_VIDEO_BYTES
    ) {
      throw new Error("ai_video_normalization_contract_failed");
    }
    const buffer = await readFile(outputPath);
    return {
      kind: "video",
      buffer,
      mimeType: "video/mp4",
      extension: "mp4",
      width: VIDEO_SIDE,
      height: VIDEO_SIDE,
      durationSeconds: VIDEO_DURATION_SECONDS,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}
