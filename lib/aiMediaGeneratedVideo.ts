import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { LoadedAiMediaSoundtrack } from "@/lib/aiMediaGenerationSoundtracks";
import type { AiMediaVideoDuration } from "@/lib/aiMediaGenerationContracts";
import type { GeneratedAiNarrationAudio } from "@/lib/aiMediaNarrationAudio";
import type { NormalizedAiVideo } from "@/lib/aiMediaNormalizer";
import {
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
} from "@/lib/mediaVideoNormalizer";

const execFileAsync = promisify(execFile);
const MAX_GOOGLE_BUSINESS_VIDEO_BYTES = 74 * 1024 * 1024;
const NARRATION_END_GUARD_SECONDS = 1;
const NARRATION_TIMING_MARGIN_SECONDS = 0.2;

function compactError(error: unknown) {
  const source = error as { stderr?: unknown; message?: unknown } | null;
  return String(source?.stderr || source?.message || error || "ffmpeg_failed")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
}

function parseMediaDurationSeconds(stderr: string) {
  const match = stderr.match(
    /Duration:\s*(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/i,
  );
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function probeNarrationDurationSeconds(args: {
  ffmpegPath: string;
  inputPath: string;
  signal?: AbortSignal;
}) {
  let stderr = "";
  try {
    const result = await execFileAsync(
      args.ffmpegPath,
      [
        "-hide_banner",
        "-nostdin",
        "-i",
        args.inputPath,
        "-map",
        "0:a:0",
        "-t",
        "0.05",
        "-f",
        "null",
        "-",
      ],
      {
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        signal: args.signal,
      },
    );
    stderr = String(result.stderr || "");
  } catch (error) {
    stderr = String((error as { stderr?: unknown })?.stderr || "");
  }
  const durationSeconds = parseMediaDurationSeconds(stderr);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("ai_narration_duration_unavailable");
  }
  return durationSeconds;
}

function narrationTempoFilters(args: {
  narrationDurationSeconds: number;
  targetVoiceSeconds: number;
}) {
  let tempo = args.narrationDurationSeconds / args.targetVoiceSeconds;
  if (!Number.isFinite(tempo) || tempo <= 1) return [];
  const filters: string[] = [];
  while (tempo > 2) {
    filters.push("atempo=2");
    tempo /= 2;
  }
  filters.push(`atempo=${tempo.toFixed(6)}`);
  return filters;
}

function buildFilter(args: {
  clipDurations: readonly number[];
  width: number;
  height: number;
  durationSeconds: number;
  hasNativeAudio: boolean;
  soundtrackInputIndex: number | null;
  narrationInputIndex: number | null;
  narrationDurationSeconds: number | null;
}) {
  const filters: string[] = [];
  for (let index = 0; index < args.clipDurations.length; index += 1) {
    const clipSeconds = args.clipDurations[index];
    const overlayIndex = args.clipDurations.length + index;
    filters.push(
      `[${index}:v]scale=${args.width}:${args.height}:force_original_aspect_ratio=increase,crop=${args.width}:${args.height},fps=30,setsar=1,format=yuv420p[base${index}]`,
      `[base${index}][${overlayIndex}:v]overlay=0:0:shortest=1,tpad=stop_mode=clone:stop_duration=${clipSeconds},trim=duration=${clipSeconds},setpts=PTS-STARTPTS[v${index}]`,
    );
    if (args.hasNativeAudio) {
      filters.push(
        `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad=pad_dur=${clipSeconds},atrim=duration=${clipSeconds},asetpts=PTS-STARTPTS[a${index}]`,
      );
    }
  }

  filters.push(
    `${Array.from({ length: args.clipDurations.length }, (_, index) => `[v${index}]`).join("")}concat=n=${args.clipDurations.length}:v=1:a=0,trim=duration=${args.durationSeconds},setpts=PTS-STARTPTS[video]`,
  );

  if (args.hasNativeAudio) {
    filters.push(
      `${Array.from({ length: args.clipDurations.length }, (_, index) => `[a${index}]`).join("")}concat=n=${args.clipDurations.length}:v=0:a=1,atrim=duration=${args.durationSeconds},asetpts=PTS-STARTPTS,volume=${args.narrationInputIndex === null ? "0.42" : "0.14"}[native]`,
    );
  }
  if (args.soundtrackInputIndex !== null) {
    const fadeOutStart = Math.max(0, args.durationSeconds - 1.1);
    filters.push(
      `[${args.soundtrackInputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=duration=${args.durationSeconds},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOutStart}:d=1.1,volume=${args.narrationInputIndex === null ? "0.16" : "0.08"}[music]`,
    );
  }
  if (args.narrationInputIndex !== null) {
    if (args.narrationDurationSeconds === null) {
      throw new Error("ai_narration_duration_unavailable");
    }
    const maximumVoiceSeconds = Math.max(
      0.5,
      args.durationSeconds - NARRATION_END_GUARD_SECONDS,
    );
    const targetVoiceSeconds = Math.max(
      0.4,
      maximumVoiceSeconds - NARRATION_TIMING_MARGIN_SECONDS,
    );
    const tempoFilters = narrationTempoFilters({
      narrationDurationSeconds: args.narrationDurationSeconds,
      targetVoiceSeconds,
    });
    const voiceFilters = [
      "aresample=48000",
      "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
      "asetpts=PTS-STARTPTS",
      "afade=t=in:st=0:d=0.08",
      ...tempoFilters,
      `atrim=duration=${maximumVoiceSeconds}`,
      `apad=pad_dur=${args.durationSeconds}`,
      `atrim=duration=${args.durationSeconds}`,
      "volume=1.0",
    ];
    filters.push(
      `[${args.narrationInputIndex}:a]${voiceFilters.join(",")}[voice]`,
    );
  }

  const audioTracks = [
    args.hasNativeAudio ? "[native]" : "",
    args.soundtrackInputIndex !== null ? "[music]" : "",
    args.narrationInputIndex !== null ? "[voice]" : "",
  ].filter(Boolean);
  if (audioTracks.length > 1) {
    filters.push(
      `${audioTracks.join("")}amix=inputs=${audioTracks.length}:duration=longest:dropout_transition=0:normalize=0,atrim=duration=${args.durationSeconds}[audio]`,
    );
  } else if (audioTracks.length === 1) {
    filters.push(`${audioTracks[0]}anull[audio]`);
  }

  return filters.join(";");
}

/**
 * Assemble uniquement de vrais clips IA animés. Les images de la Médiathèque
 * ne servent jamais de faux plans vidéo. Les calques PNG garantissent ensuite
 * le logo et les textes exacts sans demander au modèle de les redessiner.
 */
export async function composeOriginalAiVideo(args: {
  clips: Array<{ buffer: Buffer; durationSeconds: 4 | 6 | 8 }>;
  overlays: Buffer[];
  width: number;
  height: number;
  durationSeconds: AiMediaVideoDuration;
  soundtrack?: LoadedAiMediaSoundtrack | null;
  narration?: GeneratedAiNarrationAudio | null;
  signal?: AbortSignal;
}): Promise<NormalizedAiVideo> {
  args.signal?.throwIfAborted();
  const clipDurationTotal = args.clips.reduce(
    (total, clip) => total + clip.durationSeconds,
    0,
  );
  if (
    args.overlays.length !== args.clips.length ||
    clipDurationTotal !== args.durationSeconds ||
    args.clips.length < 1 ||
    args.clips.length > 4
  ) {
    throw new Error("ai_original_video_clip_count_invalid");
  }

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "inrcy-ai-video-"));
  const outputPath = path.join(temporaryDirectory, "inrcy-original-video.mp4");
  try {
    args.signal?.throwIfAborted();
    const clipPaths = await Promise.all(args.clips.map(async (clip, index) => {
      const clipPath = path.join(temporaryDirectory, `clip-${String(index).padStart(2, "0")}.mp4`);
      await writeFile(clipPath, clip.buffer);
      return clipPath;
    }));
    const overlayPaths = await Promise.all(args.overlays.map(async (buffer, index) => {
      const overlayPath = path.join(temporaryDirectory, `overlay-${String(index).padStart(2, "0")}.png`);
      await writeFile(overlayPath, buffer);
      return overlayPath;
    }));
    const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
    const probes = await Promise.all(clipPaths.map((inputPath) =>
      probeVideoSource({ ffmpegPath, inputPath, timeoutMs: 60_000 }),
    ));
    args.signal?.throwIfAborted();
    if (probes.some((probe, index) =>
      probe.durationSeconds < args.clips[index].durationSeconds - 0.35 ||
      probe.orientedWidth < 320 ||
      probe.orientedHeight < 320
    )) {
      throw new Error("ai_original_video_clip_contract_failed");
    }
    const hasNativeAudio = probes.every((probe) => probe.hasAudio);

    const command = ["-hide_banner", "-nostdin", "-y"];
    for (const clipPath of clipPaths) command.push("-i", clipPath);
    for (const overlayPath of overlayPaths) {
      command.push("-loop", "1", "-framerate", "30", "-i", overlayPath);
    }
    const soundtrackInputIndex = args.soundtrack ? clipPaths.length + overlayPaths.length : null;
    if (args.soundtrack) command.push("-stream_loop", "-1", "-i", args.soundtrack.absolutePath);
    const narrationInputIndex = args.narration
      ? clipPaths.length + overlayPaths.length + (args.soundtrack ? 1 : 0)
      : null;
    let narrationDurationSeconds: number | null = null;
    if (args.narration) {
      const narrationPath = path.join(
        temporaryDirectory,
        `narration.${args.narration.extension}`,
      );
      await writeFile(narrationPath, args.narration.buffer);
      narrationDurationSeconds = await probeNarrationDurationSeconds({
        ffmpegPath,
        inputPath: narrationPath,
        signal: args.signal,
      });
      command.push("-i", narrationPath);
    }

    command.push(
      "-filter_complex",
      buildFilter({
        clipDurations: args.clips.map((clip) => clip.durationSeconds),
        width: args.width,
        height: args.height,
        durationSeconds: args.durationSeconds,
        hasNativeAudio,
        soundtrackInputIndex,
        narrationInputIndex,
        narrationDurationSeconds,
      }),
      "-map",
      "[video]",
    );
    const hasOutputAudio =
      hasNativeAudio || soundtrackInputIndex !== null || narrationInputIndex !== null;
    if (hasOutputAudio) command.push("-map", "[audio]");
    command.push(
      "-t",
      String(args.durationSeconds),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-maxrate",
      "4.5M",
      "-bufsize",
      "9M",
      "-profile:v",
      "high",
      "-level",
      "4.1",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
    );
    if (hasOutputAudio) {
      command.push("-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2");
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
      outputPath,
    );

    try {
      await execFileAsync(ffmpegPath, command, {
        timeout: 300_000,
        maxBuffer: 12 * 1024 * 1024,
        windowsHide: true,
        signal: args.signal,
      });
    } catch (error) {
      throw new Error(`ai_original_video_render_failed:${compactError(error)}`);
    }

    const [metadata, outputStats] = await Promise.all([
      probeVideoSource({ ffmpegPath, inputPath: outputPath, timeoutMs: 60_000 }),
      stat(outputPath),
    ]);
    args.signal?.throwIfAborted();
    const mp4Container = metadata.containerFormats.some((format) =>
      ["mp4", "mov"].includes(String(format || "").toLowerCase()),
    );
    const h264Video = ["h264", "avc1"].includes(
      String(metadata.videoCodec || "").toLowerCase(),
    );
    const yuv420Video = String(metadata.pixelFormat || "")
      .toLowerCase()
      .startsWith("yuv420");
    const stableFrameRate =
      metadata.frameRate >= 29 && metadata.frameRate <= 31;
    const compatibleAudio = hasOutputAudio
      ? metadata.hasAudio &&
        ["aac", "mp4a"].includes(String(metadata.audioCodec || "").toLowerCase())
      : !metadata.hasAudio;
    if (
      metadata.orientedWidth !== args.width ||
      metadata.orientedHeight !== args.height ||
      Math.abs(metadata.durationSeconds - args.durationSeconds) > 0.35 ||
      !mp4Container ||
      !h264Video ||
      !yuv420Video ||
      !stableFrameRate ||
      !compatibleAudio ||
      outputStats.size <= 0 ||
      outputStats.size > MAX_GOOGLE_BUSINESS_VIDEO_BYTES
    ) {
      throw new Error("ai_original_video_output_contract_failed");
    }

    return {
      kind: "video",
      buffer: await readFile(outputPath),
      mimeType: "video/mp4",
      extension: "mp4",
      width: args.width,
      height: args.height,
      durationSeconds: args.durationSeconds,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
