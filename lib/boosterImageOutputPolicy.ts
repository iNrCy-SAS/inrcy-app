import type { BoosterImageChannel } from "@/lib/boosterImageDecision";

export const BOOSTER_ORIGINAL_ALPHA_PRESERVING_CHANNELS = Object.freeze([
  "site_web",
  "inr_search",
] satisfies BoosterImageChannel[]);

const ALPHA_PRESERVING_CHANNELS = new Set<BoosterImageChannel>(
  BOOSTER_ORIGINAL_ALPHA_PRESERVING_CHANNELS,
);

export function getBoosterOriginalPublicationExtension(params: {
  channel: BoosterImageChannel;
  sourceMime: string;
  sourceHasAlpha?: boolean;
}): "png" | "jpg" {
  const mime = String(params.sourceMime || "").toLowerCase();
  const alphaCapableSource =
    mime.includes("png") || mime.includes("webp") || mime.includes("avif");
  return ALPHA_PRESERVING_CHANNELS.has(params.channel) &&
    alphaCapableSource &&
    params.sourceHasAlpha !== false
    ? "png"
    : "jpg";
}

export function shouldPreserveBoosterOriginalAlpha(params: {
  channel: BoosterImageChannel;
  sourceMime: string;
  sourceHasAlpha?: boolean;
}) {
  return getBoosterOriginalPublicationExtension(params) === "png";
}
