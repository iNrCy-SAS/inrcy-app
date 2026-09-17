import {
  PARTIAL_IMAGES_WARNING_CODE,
  getImagePublicationWarning,
} from "./multiImagePublicationWarning.ts";

export const INSTAGRAM_PARTIAL_IMAGES_WARNING_CODE =
  PARTIAL_IMAGES_WARNING_CODE;

export type InstagramPartialImagesWarning = {
  code: typeof INSTAGRAM_PARTIAL_IMAGES_WARNING_CODE;
  kind: "media_degraded";
  message: string;
  expectedCount: number;
  publishedCount: number;
};

export function getInstagramPartialImagesWarning(params: {
  expectedCount: number;
  publishedCount: number;
}): InstagramPartialImagesWarning | null {
  const warning = getImagePublicationWarning({
    channelLabel: "Instagram",
    expectedCount: params.expectedCount,
    publishedCount: params.publishedCount,
  });
  if (!warning || warning.publishedCount === 0) return null;
  return warning as InstagramPartialImagesWarning;
}
