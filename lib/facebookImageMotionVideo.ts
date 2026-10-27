import "server-only";

import { createInstagramImageMotionVideo } from "@/lib/instagramImageMotionVideo";
import type { LoadedAiMediaSoundtrack } from "@/lib/aiMediaGenerationSoundtracks";

/**
 * Facebook Reel/Story shares Meta's 9:16 H.264/AAC contract with Instagram.
 * Reusing the certified motion pipeline keeps the same safe framing, music,
 * duration and deterministic retry behaviour on both channels.
 */
export async function createFacebookImageMotionVideo(args: {
  accountId: string;
  publicationId: string;
  imageStoragePaths: readonly string[];
  placement: "reel" | "story";
  soundtrackPrompt: string;
  soundtrackId?: string | null;
  loadedSoundtrack?: LoadedAiMediaSoundtrack;
  preserveComposition?: boolean;
  signal?: AbortSignal;
}) {
  return createInstagramImageMotionVideo(args);
}
