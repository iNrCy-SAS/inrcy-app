import { execFile } from "node:child_process";
import { access, chmod, copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStaticPath from "ffmpeg-static";
import {
  VIDEO_AUDIO_TRACK_MAX_BYTES,
  VIDEO_CANONICAL_AUDIO_BITRATE_KBPS,
  VIDEO_CANONICAL_MAX_BYTES,
  VIDEO_CANONICAL_MAX_SIDE,
  VIDEO_FRAME_MAX_BYTES,
  VIDEO_FRAME_MAX_SIDE,
  VIDEO_THUMBNAIL_MAX_SIDE,
  buildVideoFrameCaptureTimes,
  fitVideoWithinMaxSide,
  getOrientedVideoDimensions,
  getVideoNormalizationPurpose,
  getVideoTargetBitrateKbps,
  type VideoNormalizationPurpose,
  type VideoNormalizationVariantKey,
} from "./mediaVideoNormalizationPolicy.ts";
import { parseFfmpegVideoStreamMetadata } from "./mediaVideoProbeMetadata.ts";

const execFileAsync = promisify(execFile);
const FFMPEG_PROBE_TIMEOUT_MS = 30_000;
const FFMPEG_CANONICAL_TIMEOUT_MS = 15 * 60_000;
const FFMPEG_DERIVATIVE_TIMEOUT_MS = 75_000;

const BOOSTER_VIDEO_DERIVATIVE_KEYS = new Set<VideoNormalizationVariantKey>([
  "canonical",
  "thumbnail",
  "frame_01",
  "frame_02",
  "frame_03",
  "audio_track",
]);

export type VideoSourceProbe = {
  probeProvenance: "server_ffmpeg";
  width: number;
  height: number;
  orientedWidth: number;
  orientedHeight: number;
  durationSeconds: number;
  rotationDegrees: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string;
  frameRate: number;
  pixelFormat: string;
  containerFormats: string[];
};

export type VideoNormalizationProgress = {
  progress: number;
  stage: string;
};

export type NormalizedVideoVariant = {
  key: VideoNormalizationVariantKey;
  purpose: VideoNormalizationPurpose;
  available: boolean;
  filePath: string | null;
  mimeType: "video/mp4" | "image/jpeg" | "audio/mpeg";
  extension: "mp4" | "jpg" | "mp3";
  width: number | null;
  height: number | null;
  durationSeconds: number;
  sizeBytes: number;
  transformSpec: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type NormalizedVideoBundle = {
  source: VideoSourceProbe;
  warnings: string[];
  variants: Partial<
    Record<VideoNormalizationVariantKey, NormalizedVideoVariant>
  >;
};

function compactError(error: unknown) {
  const record = error as { stderr?: unknown; message?: unknown } | null;
  return String(record?.stderr || record?.message || error || "Erreur FFmpeg")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
}

function getBundledFfmpegCandidate() {
  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return path.join(process.cwd(), "node_modules", "ffmpeg-static", binaryName);
}

function getFfmpegCandidates() {
  return Array.from(
    new Set(
      [
        process.env.FFMPEG_PATH,
        ffmpegStaticPath,
        getBundledFfmpegCandidate(),
        "ffmpeg",
      ]
        .map((candidate) => String(candidate || "").trim())
        .filter(Boolean),
    ),
  );
}

async function makeExecutableIfNeeded(candidate: string) {
  if (!candidate || candidate === "ffmpeg" || process.platform === "win32") {
    return;
  }
  try {
    await access(candidate);
    await chmod(candidate, 0o755);
  } catch {
    // Le contrôle -version ci-dessous retournera une erreur exploitable.
  }
}

export async function resolveVideoNormalizationFfmpegPath() {
  const errors: string[] = [];
  for (const candidate of getFfmpegCandidates()) {
    try {
      await makeExecutableIfNeeded(candidate);
      await execFileAsync(candidate, ["-version"], {
        timeout: 8_000,
        maxBuffer: 1024 * 1024,
      });
      return candidate;
    } catch (error) {
      errors.push(`${candidate}: ${compactError(error).slice(0, 300)}`);
    }
  }
  throw new Error(`ffmpeg_unavailable:${errors.join(" | ").slice(0, 1_500)}`);
}

function parseDurationSeconds(stderr: string) {
  const match = stderr.match(
    /Duration:\s*(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/i,
  );
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function parseRotationDegrees(stderr: string) {
  const sideData = stderr.match(
    /rotation of\s+(-?\d+(?:\.\d+)?)\s+degrees/i,
  );
  if (sideData) return Math.round(Number(sideData[1]) || 0);
  const metadata = stderr.match(/rotate\s*:\s*(-?\d+(?:\.\d+)?)/i);
  return metadata ? Math.round(Number(metadata[1]) || 0) : 0;
}

function parseContainerFormats(stderr: string) {
  const match = stderr.match(/Input #0,\s*([^,\n]+(?:,[^,\n]+)*?),\s*from\s/i);
  return String(match?.[1] || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function parseAudioCodec(stderr: string) {
  const line = stderr
    .split(/\r?\n/)
    .find((entry) => /Stream .*Audio:/i.test(entry));
  return String(line?.match(/Audio:\s*([^,\s]+)/i)?.[1] || "unknown")
    .toLowerCase();
}

export async function probeVideoSource(params: {
  ffmpegPath: string;
  inputPath: string;
  fallbackWidth?: number | null;
  fallbackHeight?: number | null;
  fallbackDurationSeconds?: number | null;
  timeoutMs?: number;
  inputOptions?: readonly string[];
}): Promise<VideoSourceProbe> {
  let stderr = "";
  try {
    const result = await execFileAsync(
      params.ffmpegPath,
      [
        "-hide_banner",
        "-nostdin",
        ...(params.inputOptions || []),
        "-i",
        params.inputPath,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
      ],
      {
        timeout: Math.max(
          1_000,
          Number(params.timeoutMs || FFMPEG_PROBE_TIMEOUT_MS),
        ),
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    stderr = String(result.stderr || "");
  } catch (error) {
    const record = error as { stderr?: unknown };
    stderr = String(record?.stderr || "");
    if (!/Stream .*Video:/i.test(stderr)) {
      throw new Error(`video_probe_failed:${compactError(error)}`);
    }
  }

  const stream = parseFfmpegVideoStreamMetadata(stderr);
  const width = stream.width || Math.max(0, Number(params.fallbackWidth || 0));
  const height =
    stream.height || Math.max(0, Number(params.fallbackHeight || 0));
  if (!width || !height) throw new Error("video_dimensions_unavailable");

  const rotationDegrees = parseRotationDegrees(stderr);
  const oriented = getOrientedVideoDimensions({
    width,
    height,
    rotationDegrees,
  });
  const probedDuration = parseDurationSeconds(stderr);
  const fallbackDuration = Math.max(
    0,
    Number(params.fallbackDurationSeconds || 0),
  );
  const durationSeconds = probedDuration || fallbackDuration;
  if (!durationSeconds) throw new Error("video_duration_unavailable");

  const hasAudio = /Stream .*Audio:/i.test(stderr);
  return {
    probeProvenance: "server_ffmpeg",
    width,
    height,
    orientedWidth: oriented.width,
    orientedHeight: oriented.height,
    durationSeconds,
    rotationDegrees,
    hasAudio,
    videoCodec: stream.codec,
    audioCodec: hasAudio ? parseAudioCodec(stderr) : "none",
    frameRate: stream.frameRate,
    pixelFormat: stream.pixelFormat,
    containerFormats: parseContainerFormats(stderr),
  };
}

function buildScaleFilter(maxSide: number) {
  return [
    `scale='min(${maxSide},iw)':'min(${maxSide},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    "setsar=1",
  ].join(",");
}

async function outputSize(filePath: string) {
  return Number((await stat(filePath)).size || 0);
}

type CanonicalPreparation = {
  sizeBytes: number;
  mode: "stream_copy" | "video_copy_audio_transcode" | "full_transcode";
  bitrateKbps: number | null;
  attempts: number;
  probe: VideoSourceProbe;
};

function normalizedRotation(value: number) {
  return ((Math.round(Number(value || 0)) % 360) + 360) % 360;
}

function isH264Codec(value: string) {
  const codec = String(value || "").toLowerCase();
  return codec === "h264" || codec === "avc" || codec === "avc1";
}

function isAacCodec(value: string) {
  const codec = String(value || "").toLowerCase();
  return codec.startsWith("aac") || codec.startsWith("mp4a");
}

function canCopyCanonicalVideo(params: {
  source: VideoSourceProbe;
  sourceSizeBytes: number;
}) {
  return (
    isH264Codec(params.source.videoCodec) &&
    String(params.source.pixelFormat || "").toLowerCase().startsWith("yuv420") &&
    params.source.frameRate > 0 &&
    params.source.frameRate <= 60 &&
    normalizedRotation(params.source.rotationDegrees) === 0 &&
    Math.max(params.source.orientedWidth, params.source.orientedHeight) <=
      VIDEO_CANONICAL_MAX_SIDE &&
    params.sourceSizeBytes > 0 &&
    params.sourceSizeBytes <= VIDEO_CANONICAL_MAX_BYTES
  );
}

async function verifyCanonicalOutput(params: {
  ffmpegPath: string;
  outputPath: string;
  expectedAudio: boolean;
}) {
  const sizeBytes = await outputSize(params.outputPath);
  if (!sizeBytes) throw new Error("video_canonical_empty");
  if (sizeBytes > VIDEO_CANONICAL_MAX_BYTES) {
    throw new Error(`video_canonical_too_large:${sizeBytes}`);
  }
  const probe = await probeVideoSource({
    ffmpegPath: params.ffmpegPath,
    inputPath: params.outputPath,
  });
  if (
    !isH264Codec(probe.videoCodec) ||
    !String(probe.pixelFormat || "").toLowerCase().startsWith("yuv420") ||
    probe.frameRate <= 0 ||
    probe.frameRate > 60 ||
    (params.expectedAudio && (!probe.hasAudio || !isAacCodec(probe.audioCodec)))
  ) {
    throw new Error(
      `video_canonical_incompatible:${probe.videoCodec}:${probe.audioCodec}:${probe.pixelFormat}:${probe.frameRate}`,
    );
  }
  return { sizeBytes, probe };
}

async function remuxCanonical(params: {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  source: VideoSourceProbe;
}) {
  const copyAudio = !params.source.hasAudio || isAacCodec(params.source.audioCodec);
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-i",
    params.inputPath,
    "-map",
    "0:v:0",
  ];
  if (params.source.hasAudio) args.push("-map", "0:a:0?");
  args.push("-c:v", "copy");
  if (params.source.hasAudio) {
    args.push(
      "-c:a",
      copyAudio ? "copy" : "aac",
      ...(copyAudio
        ? []
        : ["-b:a", `${VIDEO_CANONICAL_AUDIO_BITRATE_KBPS}k`, "-ac", "2"]),
    );
  } else {
    args.push("-an");
  }
  args.push(
    "-movflags",
    "+faststart",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-metadata:s:v:0",
    "rotate=0",
    "-avoid_negative_ts",
    "make_zero",
    params.outputPath,
  );
  await execFileAsync(params.ffmpegPath, args, {
    timeout: Math.min(120_000, FFMPEG_CANONICAL_TIMEOUT_MS),
    maxBuffer: 8 * 1024 * 1024,
  });
  const verified = await verifyCanonicalOutput({
    ffmpegPath: params.ffmpegPath,
    outputPath: params.outputPath,
    expectedAudio: params.source.hasAudio,
  });
  return {
    ...verified,
    mode: copyAudio
      ? ("stream_copy" as const)
      : ("video_copy_audio_transcode" as const),
    bitrateKbps: null,
    attempts: 1,
  };
}

async function transcodeCanonical(params: {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  source: VideoSourceProbe;
}) {
  let bitrateKbps = getVideoTargetBitrateKbps({
    durationSeconds: params.source.durationSeconds,
    maxBytes: VIDEO_CANONICAL_MAX_BYTES,
    audioBitrateKbps: params.source.hasAudio
      ? VIDEO_CANONICAL_AUDIO_BITRATE_KBPS
      : 0,
    minVideoKbps: 96,
    maxVideoKbps: 8_000,
  });
  // Phone videos can average 30 fps while advertising a 120 fps container
  // timebase. FFmpeg's implicit CFR selection can otherwise duplicate frames
  // to 120 fps and make our own H.264 fallback fail its publication check.
  const outputFrameRate = Number.isFinite(params.source.frameRate) &&
    params.source.frameRate > 0
    ? Math.min(params.source.frameRate, 60)
    : 30;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const filters = [
      buildScaleFilter(VIDEO_CANONICAL_MAX_SIDE),
      `fps=${outputFrameRate}`,
    ];
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-i",
      params.inputPath,
      "-map",
      "0:v:0",
    ];
    if (params.source.hasAudio) args.push("-map", "0:a:0?");
    args.push(
      "-vf",
      filters.join(","),
      "-fps_mode",
      "cfr",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-threads",
      "0",
      "-b:v",
      `${bitrateKbps}k`,
      "-maxrate",
      `${Math.max(bitrateKbps, Math.round(bitrateKbps * 1.2))}k`,
      "-bufsize",
      `${Math.max(512, bitrateKbps * 2)}k`,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
      "-metadata:s:v:0",
      "rotate=0",
      "-max_muxing_queue_size",
      "2048",
    );
    if (params.source.hasAudio) {
      args.push(
        "-c:a",
        "aac",
        "-b:a",
        `${VIDEO_CANONICAL_AUDIO_BITRATE_KBPS}k`,
        "-ac",
        "2",
      );
    } else {
      args.push("-an");
    }
    args.push(params.outputPath);

    await execFileAsync(params.ffmpegPath, args, {
      timeout: FFMPEG_CANONICAL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    const sizeBytes = await outputSize(params.outputPath);
    if (sizeBytes > 0 && sizeBytes <= VIDEO_CANONICAL_MAX_BYTES) {
      const verified = await verifyCanonicalOutput({
        ffmpegPath: params.ffmpegPath,
        outputPath: params.outputPath,
        expectedAudio: params.source.hasAudio,
      });
      return {
        ...verified,
        mode: "full_transcode" as const,
        bitrateKbps,
        attempts: attempt,
      };
    }
    bitrateKbps = Math.max(64, Math.floor(bitrateKbps * 0.7));
  }
  throw new Error("video_canonical_size_limit_unreachable");
}

async function prepareCanonical(params: {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  source: VideoSourceProbe;
  sourceSizeBytes: number;
  warnings: string[];
}): Promise<CanonicalPreparation> {
  if (canCopyCanonicalVideo(params)) {
    try {
      return await remuxCanonical(params);
    } catch (error) {
      params.warnings.push(`canonical_fast_path_failed:${compactError(error)}`);
    }
  }
  return await transcodeCanonical(params);
}

async function extractFrame(params: {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  timestampSeconds: number;
  maxSide: number;
  quality: number;
}) {
  await execFileAsync(
    params.ffmpegPath,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-ss",
      String(Math.max(0, params.timestampSeconds)),
      "-i",
      params.inputPath,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      buildScaleFilter(params.maxSide),
      "-q:v",
      String(params.quality),
      "-an",
      params.outputPath,
    ],
    { timeout: FFMPEG_DERIVATIVE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
  );
  const sizeBytes = await outputSize(params.outputPath);
  if (!sizeBytes) throw new Error("video_frame_empty");
  if (sizeBytes > VIDEO_FRAME_MAX_BYTES) {
    throw new Error(`video_frame_too_large:${sizeBytes}`);
  }
  return sizeBytes;
}

async function extractAudioTrack(params: {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
}) {
  await execFileAsync(
    params.ffmpegPath,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-i",
      params.inputPath,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "64k",
      params.outputPath,
    ],
    { timeout: FFMPEG_DERIVATIVE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
  );
  const sizeBytes = await outputSize(params.outputPath);
  if (!sizeBytes) throw new Error("video_audio_empty");
  if (sizeBytes > VIDEO_AUDIO_TRACK_MAX_BYTES) {
    throw new Error(`video_audio_too_large:${sizeBytes}`);
  }
  return sizeBytes;
}

function buildVariant(params: {
  key: VideoNormalizationVariantKey;
  available?: boolean;
  filePath?: string | null;
  mimeType: NormalizedVideoVariant["mimeType"];
  extension: NormalizedVideoVariant["extension"];
  width?: number | null;
  height?: number | null;
  durationSeconds: number;
  sizeBytes?: number;
  transformSpec: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): NormalizedVideoVariant {
  return {
    key: params.key,
    purpose: getVideoNormalizationPurpose(params.key),
    available: params.available !== false,
    filePath: params.filePath || null,
    mimeType: params.mimeType,
    extension: params.extension,
    width: params.width ?? null,
    height: params.height ?? null,
    durationSeconds: params.durationSeconds,
    sizeBytes: Math.max(0, Number(params.sizeBytes || 0)),
    transformSpec: params.transformSpec,
    metadata: params.metadata,
  };
}

export async function normalizeVideoSource(params: {
  inputPath: string;
  outputDirectory: string;
  fallbackWidth?: number | null;
  fallbackHeight?: number | null;
  fallbackDurationSeconds?: number | null;
  keys?: readonly VideoNormalizationVariantKey[];
  onProgress?: (update: VideoNormalizationProgress) => void;
}): Promise<NormalizedVideoBundle> {
  await mkdir(params.outputDirectory, { recursive: true });
  let lastProgress = 0;
  const emitProgress = (progress: number, stage: string) => {
    const safe = Math.max(lastProgress, Math.min(100, Math.round(progress)));
    if (safe === lastProgress && safe !== 100) return;
    lastProgress = safe;
    params.onProgress?.({ progress: safe, stage });
  };

  const rawKeys = params.keys || [
    "thumbnail",
    "frame_01",
    "frame_02",
    "frame_03",
    "audio_track",
  ];
  const requestedKeys = new Set(
    rawKeys.filter((key) => BOOSTER_VIDEO_DERIVATIVE_KEYS.has(key)),
  );
  const warnings = rawKeys
    .filter((key) => !BOOSTER_VIDEO_DERIVATIVE_KEYS.has(key))
    .map((key) => `obsolete_video_output_ignored:${key}`);

  const requestedFrameIndexes = [0, 1, 2].filter((index) =>
    requestedKeys.has(`frame_0${index + 1}` as VideoNormalizationVariantKey),
  );
  const needsCanonical = requestedKeys.has("canonical");
  const needsThumbnail = requestedKeys.has("thumbnail");
  const needsAudio = requestedKeys.has("audio_track");

  emitProgress(1, "Initialisation de FFmpeg");
  const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
  const sourceSizeBytes = await outputSize(params.inputPath);
  const source = await probeVideoSource({
    ffmpegPath,
    inputPath: params.inputPath,
    fallbackWidth: params.fallbackWidth,
    fallbackHeight: params.fallbackHeight,
    fallbackDurationSeconds: params.fallbackDurationSeconds,
  });
  emitProgress(10, "Analyse du média");

  const audioPath = path.join(params.outputDirectory, "audio-track.mp3");
  const canonicalPath = path.join(params.outputDirectory, "canonical.mp4");
  const framePaths = [1, 2, 3].map((index) =>
    path.join(
      params.outputDirectory,
      `frame-${String(index).padStart(2, "0")}.jpg`,
    ),
  );
  const thumbnailPath = path.join(params.outputDirectory, "thumbnail.jpg");
  const captureTimes = buildVideoFrameCaptureTimes(source.durationSeconds);
  const totalTasks = Math.max(
    1,
    (needsCanonical ? 1 : 0) +
      requestedFrameIndexes.length +
      (needsThumbnail ? 1 : 0) +
      (needsAudio && source.hasAudio ? 1 : 0),
  );
  let completedTasks = 0;
  const completeTask = (stage: string) => {
    completedTasks += 1;
    emitProgress(10 + (completedTasks / totalTasks) * 84, stage);
  };

  let canonicalPreparation: CanonicalPreparation | null = null;
  if (needsCanonical) {
    emitProgress(11, "Conversion automatique en MP4 H.264/AAC");
    canonicalPreparation = await prepareCanonical({
      ffmpegPath,
      inputPath: params.inputPath,
      outputPath: canonicalPath,
      source,
      sourceSizeBytes,
      warnings,
    });
    completeTask("VidÃ©o MP4 H.264/AAC prÃªte");
  }

  const frameSizes = [0, 0, 0];
  const frameAvailable = [false, false, false];
  for (const index of requestedFrameIndexes) {
    try {
      frameSizes[index] = await extractFrame({
        ffmpegPath,
        inputPath: params.inputPath,
        outputPath: framePaths[index],
        timestampSeconds: captureTimes[index],
        maxSide: VIDEO_FRAME_MAX_SIDE,
        quality: 4,
      });
      frameAvailable[index] = true;
    } catch (error) {
      if (index === 0 && captureTimes[index] > 0) {
        try {
          frameSizes[index] = await extractFrame({
            ffmpegPath,
            inputPath: params.inputPath,
            outputPath: framePaths[index],
            timestampSeconds: 0,
            maxSide: VIDEO_FRAME_MAX_SIDE,
            quality: 4,
          });
          frameAvailable[index] = true;
        } catch (fallbackError) {
          warnings.push(
            `frame_${index + 1}_unavailable:${compactError(fallbackError)}`,
          );
        }
      } else {
        warnings.push(`frame_${index + 1}_unavailable:${compactError(error)}`);
      }
    }
    completeTask(`Capture vidéo ${index + 1}/3`);
  }

  let thumbnailSize = 0;
  let thumbnailAvailable = false;
  let thumbnailFallbackFromFrame = false;
  if (needsThumbnail) {
    try {
      thumbnailSize = await extractFrame({
        ffmpegPath,
        inputPath: params.inputPath,
        outputPath: thumbnailPath,
        timestampSeconds: captureTimes[0],
        maxSide: VIDEO_THUMBNAIL_MAX_SIDE,
        quality: 5,
      });
      thumbnailAvailable = true;
    } catch (error) {
      const firstAvailableIndex = frameAvailable.findIndex(Boolean);
      if (firstAvailableIndex >= 0) {
        await copyFile(framePaths[firstAvailableIndex], thumbnailPath);
        thumbnailSize = await outputSize(thumbnailPath);
        thumbnailAvailable = thumbnailSize > 0;
        thumbnailFallbackFromFrame = thumbnailAvailable;
      }
      if (!thumbnailAvailable) {
        warnings.push(`thumbnail_unavailable:${compactError(error)}`);
      }
    }
    completeTask("Miniature du média prête");
  }

  let audioSizeBytes = 0;
  let audioAvailable = needsAudio && source.hasAudio;
  if (needsAudio && source.hasAudio) {
    try {
      audioSizeBytes = await extractAudioTrack({
        ffmpegPath,
        inputPath: params.inputPath,
        outputPath: audioPath,
      });
    } catch (error) {
      audioAvailable = false;
      warnings.push(`audio_track_unavailable:${compactError(error)}`);
    }
    completeTask(
      audioAvailable
        ? "Piste audio extraite"
        : "Piste audio indisponible, traitement poursuivi",
    );
  }

  if (
    requestedFrameIndexes.length > 0 &&
    !requestedFrameIndexes.some((index) => frameAvailable[index])
  ) {
    throw new Error(
      "video_frames_unavailable:aucune capture exploitable n'a pu être produite",
    );
  }

  const frameDimensions = fitVideoWithinMaxSide({
    width: source.orientedWidth,
    height: source.orientedHeight,
    maxSide: VIDEO_FRAME_MAX_SIDE,
  });
  const thumbnailDimensions = thumbnailFallbackFromFrame
    ? frameDimensions
    : fitVideoWithinMaxSide({
        width: source.orientedWidth,
        height: source.orientedHeight,
        maxSide: VIDEO_THUMBNAIL_MAX_SIDE,
      });
  const sourceMetadata = {
    source_width: source.width,
    source_height: source.height,
    oriented_width: source.orientedWidth,
    oriented_height: source.orientedHeight,
    rotation_degrees: source.rotationDegrees,
    duration_seconds: source.durationSeconds,
    source_video_codec: source.videoCodec,
    source_audio_codec: source.audioCodec,
    source_frame_rate: source.frameRate,
    source_pixel_format: source.pixelFormat,
    source_container_formats: source.containerFormats,
    source_has_audio: source.hasAudio,
    source_size_bytes: sourceSizeBytes,
  };
  const variants: Partial<
    Record<VideoNormalizationVariantKey, NormalizedVideoVariant>
  > = {};

  if (needsCanonical && canonicalPreparation) {
    variants.canonical = buildVariant({
      key: "canonical",
      filePath: canonicalPath,
      mimeType: "video/mp4",
      extension: "mp4",
      width: canonicalPreparation.probe.orientedWidth,
      height: canonicalPreparation.probe.orientedHeight,
      durationSeconds: canonicalPreparation.probe.durationSeconds,
      sizeBytes: canonicalPreparation.sizeBytes,
      transformSpec: {
        operation: "video_canonical",
        output: "mp4",
        video_codec: "h264",
        audio_codec: source.hasAudio ? "aac" : "none",
        pixel_format: "yuv420p",
        max_side: VIDEO_CANONICAL_MAX_SIDE,
        max_bytes: VIDEO_CANONICAL_MAX_BYTES,
        mode: canonicalPreparation.mode,
      },
      metadata: {
        ...sourceMetadata,
        output_video_codec: canonicalPreparation.probe.videoCodec,
        output_audio_codec: canonicalPreparation.probe.audioCodec,
        output_frame_rate: canonicalPreparation.probe.frameRate,
        output_pixel_format: canonicalPreparation.probe.pixelFormat,
        output_container_format: "mp4",
        output_size_bytes: canonicalPreparation.sizeBytes,
        conversion_mode: canonicalPreparation.mode,
        target_video_bitrate_kbps: canonicalPreparation.bitrateKbps,
        encoding_attempts: canonicalPreparation.attempts,
      },
    });
  }

  if (needsThumbnail) {
    variants.thumbnail = buildVariant({
      key: "thumbnail",
      available: thumbnailAvailable,
      filePath: thumbnailAvailable ? thumbnailPath : null,
      mimeType: "image/jpeg",
      extension: "jpg",
      width: thumbnailAvailable ? thumbnailDimensions.width : null,
      height: thumbnailAvailable ? thumbnailDimensions.height : null,
      durationSeconds: source.durationSeconds,
      sizeBytes: thumbnailSize,
      transformSpec: {
        operation: "video_thumbnail",
        output: "jpeg",
        max_side: VIDEO_THUMBNAIL_MAX_SIDE,
        crop: false,
        capture_seconds: captureTimes[0],
        fallback_from_frame: thumbnailFallbackFromFrame,
      },
      metadata: {
        ...sourceMetadata,
        capture_seconds: captureTimes[0],
        fallback_from_frame: thumbnailFallbackFromFrame,
      },
    });
  }

  for (const index of requestedFrameIndexes) {
    const key = `frame_0${index + 1}` as VideoNormalizationVariantKey;
    variants[key] = buildVariant({
      key,
      available: frameAvailable[index],
      filePath: frameAvailable[index] ? framePaths[index] : null,
      mimeType: "image/jpeg",
      extension: "jpg",
      width: frameAvailable[index] ? frameDimensions.width : null,
      height: frameAvailable[index] ? frameDimensions.height : null,
      durationSeconds: source.durationSeconds,
      sizeBytes: frameSizes[index],
      transformSpec: {
        operation: "video_frame",
        output: "jpeg",
        max_side: VIDEO_FRAME_MAX_SIDE,
        crop: false,
        capture_seconds: captureTimes[index],
      },
      metadata: {
        ...sourceMetadata,
        frame_index: index + 1,
        capture_seconds: captureTimes[index],
      },
    });
  }

  if (needsAudio) {
    variants.audio_track = buildVariant({
      key: "audio_track",
      available: audioAvailable,
      filePath: audioAvailable ? audioPath : null,
      mimeType: "audio/mpeg",
      extension: "mp3",
      width: null,
      height: null,
      durationSeconds: source.durationSeconds,
      sizeBytes: audioSizeBytes,
      transformSpec: {
        operation: "video_audio_track",
        output: "mp3",
        audio_codec: "mp3",
        sample_rate_hz: 16000,
        channels: 1,
        bitrate_kbps: 64,
        available: audioAvailable,
      },
      metadata: {
        ...sourceMetadata,
        available: audioAvailable,
        reason: source.hasAudio
          ? audioAvailable
            ? null
            : "extraction_failed"
          : "source_without_audio",
      },
    });
  }

  emitProgress(100, "Préparation des médias terminée");
  return { source, warnings, variants };
}
