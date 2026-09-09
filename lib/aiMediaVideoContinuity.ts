import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { resolveVideoNormalizationFfmpegPath } from "./mediaVideoNormalizer.ts";

const execFileAsync = promisify(execFile);
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

export type AiMediaVideoContinuityFrame = {
  data: string;
  mimeType: "image/jpeg";
};

/**
 * A real generated frame, not the original inspiration image, anchors the next
 * act. Image-to-video keeps exact 8 s segments without replaying a cumulative
 * video or relying on an experimental stateful continuation route.
 */
export async function extractAiMediaVideoContinuityFrame(args: {
  buffer: Buffer;
  durationSeconds: number;
  sourceStartSeconds?: number;
  signal?: AbortSignal;
}): Promise<AiMediaVideoContinuityFrame> {
  args.signal?.throwIfAborted();
  const sourceStart = args.sourceStartSeconds ?? 0;
  if (
    !args.buffer.length || args.buffer.length > MAX_SOURCE_BYTES ||
    !Number.isFinite(args.durationSeconds) || args.durationSeconds <= 0 ||
    !Number.isFinite(sourceStart) || sourceStart < 0
  ) {
    throw new Error("ai_video_continuity_source_invalid");
  }
  const directory = await mkdtemp(join(tmpdir(), "inrcy-video-continuity-"));
  try {
    const sourcePath = join(directory, "clip.mp4");
    const framePath = join(directory, "last-frame.jpg");
    await writeFile(sourcePath, args.buffer);
    const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
    args.signal?.throwIfAborted();
    // Decode only the last second of the logical act. `update` overwrites this
    // private output with each decoded frame, leaving the actual final frame
    // (also works for VFR and clips a few milliseconds shorter than requested).
    const tailStart = sourceStart + Math.max(0, args.durationSeconds - 1);
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-ss", tailStart.toFixed(6), "-i", sourcePath,
      "-t", Math.min(1, args.durationSeconds).toFixed(6),
      "-map", "0:v:0", "-an",
      "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease,setsar=1",
      "-q:v", "2", "-update", "1", framePath,
    ], { timeout: 12_000, maxBuffer: 1024 * 1024, windowsHide: true, signal: args.signal });
    const size = (await stat(framePath)).size;
    if (!size || size > MAX_FRAME_BYTES) {
      throw new Error("ai_video_continuity_frame_invalid");
    }
    const frame = await readFile(framePath);
    if (frame[0] !== 0xff || frame[1] !== 0xd8) {
      throw new Error("ai_video_continuity_frame_invalid");
    }
    return { data: frame.toString("base64"), mimeType: "image/jpeg" };
  } catch (error) {
    args.signal?.throwIfAborted();
    // No raw paths, frames or FFmpeg stderr in provider/account diagnostics.
    throw new Error("ai_video_continuity_frame_unavailable", { cause: error });
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
