import "server-only";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

import { loadAiMediaSoundtrack } from "@/lib/aiMediaGenerationSoundtracks";
import {
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
} from "@/lib/mediaVideoNormalizer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { toExactStorageArrayBuffer } from "@/lib/supabaseStorageBinary";
import type { PersistedVideoAttachment } from "@/app/api/booster/publish-now/publishNow.foundations";

const execFileAsync = promisify(execFile);
const OUTPUT_WIDTH = 1_080;
const OUTPUT_HEIGHT = 1_920;
const OUTPUT_DURATION_SECONDS = 8;
const OUTPUT_FPS = 30;
const TRANSITION_SECONDS = 0.35;
const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;
const PIPELINE_VERSION = "instagram-image-motion-v1";

type InstagramImageMotionPlacement = "reel" | "story";

function safeSegment(value: string, fallback: string) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return cleaned || fallback;
}

function publicBoosterUrl(storagePath: string) {
  return (
    supabaseAdmin.storage.from("booster").getPublicUrl(storagePath).data
      .publicUrl || ""
  );
}

function buildAttachment(args: {
  storagePath: string;
  size: number;
  placement: InstagramImageMotionPlacement;
  soundtrackId: string;
  sourceCount: number;
}): PersistedVideoAttachment {
  const publicUrl = publicBoosterUrl(args.storagePath);
  if (!publicUrl) throw new Error("instagram_image_motion_public_url_missing");
  return {
    name:
      args.placement === "story"
        ? "Story iNrCy.mp4"
        : "Reel iNrCy.mp4",
    type: "video/mp4",
    size: args.size,
    duration: OUTPUT_DURATION_SECONDS,
    url: publicUrl,
    publicUrl,
    storagePath: args.storagePath,
    bucket: "booster",
    thumbnailUrl: null,
    thumbnailStoragePath: null,
    thumbnailBucket: null,
    sourceMetadata: {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      duration: OUTPUT_DURATION_SECONDS,
      orientation: "vertical",
      videoCodec: "h264",
      audioCodec: "aac",
      frameRate: OUTPUT_FPS,
      hasAudio: true,
      containerFormats: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
      pixelFormat: "yuv420p",
      compatibilityProof: "server_ffmpeg",
      source: PIPELINE_VERSION,
      sourceImageCount: args.sourceCount,
      soundtrackId: args.soundtrackId,
    },
  };
}

async function readCachedAttachment(args: {
  storagePath: string;
  placement: InstagramImageMotionPlacement;
  soundtrackId: string;
  sourceCount: number;
}) {
  const cached = await supabaseAdmin.storage
    .from("booster")
    .download(args.storagePath);
  if (cached.error || !cached.data || cached.data.size < 1_000) return null;
  return buildAttachment({ ...args, size: cached.data.size });
}

async function downloadSourceImage(storagePath: string) {
  const result = await supabaseAdmin.storage
    .from("booster")
    .download(storagePath);
  if (result.error || !result.data) {
    throw new Error(
      result.error?.message || "instagram_image_motion_source_unavailable",
    );
  }
  if (
    result.data.size < 32 ||
    result.data.size > MAX_SOURCE_IMAGE_BYTES ||
    !String(result.data.type || "").toLowerCase().startsWith("image/")
  ) {
    throw new Error("instagram_image_motion_source_invalid");
  }
  return Buffer.from(await result.data.arrayBuffer());
}

async function composeVerticalFrame(source: Buffer) {
  const metadata = await sharp(source, { failOn: "error" }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("instagram_image_motion_dimensions_missing");
  }

  const background = await sharp(source, { failOn: "error" })
    .rotate()
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: "cover" })
    .blur(28)
    .modulate({ brightness: 0.58, saturation: 0.82 })
    .jpeg({ quality: 88, chromaSubsampling: "4:2:0" })
    .toBuffer();
  const foreground = await sharp(source, { failOn: "error" })
    .rotate()
    .resize(1_000, 1_800, {
      fit: "inside",
      withoutEnlargement: false,
    })
    .jpeg({ quality: 92, chromaSubsampling: "4:2:0" })
    .toBuffer();

  return sharp(background)
    .composite([{ input: foreground, gravity: "center" }])
    .jpeg({ quality: 91, chromaSubsampling: "4:2:0" })
    .toBuffer();
}

function buildMotionFilter(imageCount: number) {
  const clipDuration =
    (OUTPUT_DURATION_SECONDS + TRANSITION_SECONDS * (imageCount - 1)) /
    imageCount;
  const filters: string[] = [];

  for (let index = 0; index < imageCount; index += 1) {
    const zoomStep = index % 2 === 0 ? "0.00016" : "0.00012";
    filters.push(
      `[${index}:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},zoompan=z='min(zoom+${zoomStep},1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:fps=${OUTPUT_FPS},trim=duration=${clipDuration.toFixed(4)},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v${index}]`,
    );
  }

  let videoLabel = "[v0]";
  for (let index = 1; index < imageCount; index += 1) {
    const nextLabel = `[vx${index}]`;
    const offset = index * (clipDuration - TRANSITION_SECONDS);
    filters.push(
      `${videoLabel}[v${index}]xfade=transition=fade:duration=${TRANSITION_SECONDS}:offset=${offset.toFixed(4)}${nextLabel}`,
    );
    videoLabel = nextLabel;
  }
  filters.push(
    `${videoLabel}trim=duration=${OUTPUT_DURATION_SECONDS},setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.22,fade=t=out:st=7.55:d=0.45[vout]`,
  );
  filters.push(
    `[${imageCount}:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=duration=${OUTPUT_DURATION_SECONDS},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.3,afade=t=out:st=7.2:d=0.8,volume=0.22[aout]`,
  );
  return { filter: filters.join(";"), clipDuration };
}

/**
 * Convertit les images choisies pour Instagram en une vraie vidéo verticale.
 * Le chemin Storage est déterministe : une reprise réutilise le MP4 déjà
 * préparé au lieu de refaire FFmpeg ou de créer un second média.
 */
export async function createInstagramImageMotionVideo(args: {
  accountId: string;
  publicationId: string;
  imageStoragePaths: readonly string[];
  placement: InstagramImageMotionPlacement;
  soundtrackPrompt: string;
  signal?: AbortSignal;
}): Promise<PersistedVideoAttachment> {
  args.signal?.throwIfAborted();
  const imageStoragePaths = Array.from(
    new Set(
      args.imageStoragePaths
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 5);
  if (!imageStoragePaths.length) {
    throw new Error("instagram_image_motion_source_missing");
  }

  const soundtrack = await loadAiMediaSoundtrack(args.soundtrackPrompt);
  const signature = createHash("sha256")
    .update(
      JSON.stringify({
        version: PIPELINE_VERSION,
        accountId: args.accountId,
        publicationId: args.publicationId,
        placement: args.placement,
        imageStoragePaths,
        soundtrackSha256: soundtrack.sha256,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  const storagePath = `${safeSegment(args.accountId, "account")}/instagram-motion/${safeSegment(args.publicationId, "publication")}-${signature}.mp4`;
  const attachmentArgs = {
    storagePath,
    placement: args.placement,
    soundtrackId: soundtrack.id,
    sourceCount: imageStoragePaths.length,
  } as const;

  const cached = await readCachedAttachment(attachmentArgs);
  if (cached) return cached;

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "inrcy-instagram-motion-"),
  );
  try {
    const sources = await Promise.all(imageStoragePaths.map(downloadSourceImage));
    args.signal?.throwIfAborted();
    const frameBuffers = await Promise.all(sources.map(composeVerticalFrame));
    const framePaths = await Promise.all(
      frameBuffers.map(async (buffer, index) => {
        const framePath = path.join(temporaryDirectory, `frame-${index}.jpg`);
        await writeFile(framePath, buffer);
        return framePath;
      }),
    );
    const outputPath = path.join(temporaryDirectory, "instagram-motion.mp4");
    const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
    const { filter, clipDuration } = buildMotionFilter(framePaths.length);
    const command = ["-hide_banner", "-nostdin", "-y"];
    for (const framePath of framePaths) {
      command.push(
        "-loop",
        "1",
        "-framerate",
        String(OUTPUT_FPS),
        "-t",
        String(clipDuration + 0.5),
        "-i",
        framePath,
      );
    }
    command.push("-stream_loop", "-1", "-i", soundtrack.absolutePath);
    command.push(
      "-filter_complex",
      filter,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-t",
      String(OUTPUT_DURATION_SECONDS),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-maxrate",
      "3M",
      "-bufsize",
      "6M",
      "-profile:v",
      "high",
      "-level",
      "4.1",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(OUTPUT_FPS),
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      "-map_metadata",
      "-1",
      outputPath,
    );

    await execFileAsync(ffmpegPath, command, {
      timeout: 150_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      signal: args.signal,
    });
    const [buffer, outputStats, probe] = await Promise.all([
      readFile(outputPath),
      stat(outputPath),
      probeVideoSource({
        ffmpegPath,
        inputPath: outputPath,
        timeoutMs: 45_000,
      }),
    ]);
    if (
      !buffer.byteLength ||
      outputStats.size < 1_000 ||
      probe.orientedWidth !== OUTPUT_WIDTH ||
      probe.orientedHeight !== OUTPUT_HEIGHT ||
      Math.abs(probe.durationSeconds - OUTPUT_DURATION_SECONDS) > 0.35 ||
      !probe.hasAudio ||
      !["h264", "avc1"].includes(String(probe.videoCodec).toLowerCase())
    ) {
      throw new Error("instagram_image_motion_output_invalid");
    }

    const uploaded = await supabaseAdmin.storage
      .from("booster")
      .upload(storagePath, toExactStorageArrayBuffer(buffer), {
        contentType: "video/mp4",
        cacheControl: "31536000",
        upsert: false,
      });
    if (uploaded.error) {
      const wonRace = await readCachedAttachment(attachmentArgs);
      if (wonRace) return wonRace;
      throw new Error(uploaded.error.message);
    }
    return buildAttachment({ ...attachmentArgs, size: outputStats.size });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}
