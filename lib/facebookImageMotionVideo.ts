import "server-only";

import { createInstagramImageMotionVideo } from "@/lib/instagramImageMotionVideo";

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
  signal?: AbortSignal;
}) {
  return createInstagramImageMotionVideo(args);
}
