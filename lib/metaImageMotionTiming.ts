/** Default timing for videos composed from Meta publication photos only. */
export const META_IMAGE_DURATION_SECONDS = 4;
export const META_REEL_IMAGE_DURATION_SECONDS = 3;
export const META_IMAGE_SOUNDTRACK_ASSET_SECONDS = 24;

export function getMetaImageMotionDuration(imageCount: number, placement: "reel" | "story"): number {
  if (!Number.isInteger(imageCount) || imageCount < 0 || imageCount > 5 || !["reel", "story"].includes(placement)) throw new Error("meta_image_motion_timing_invalid");
  if (imageCount === 0) return 0;
  return placement === "story" ? META_IMAGE_DURATION_SECONDS : imageCount * META_REEL_IMAGE_DURATION_SECONDS;
}
