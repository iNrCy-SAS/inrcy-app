import {
  getImageOverlayLinkHotspots,
  type ImageOverlayLinkHotspot,
} from "./imageOverlay.ts";
import {
  getMediaImageInteractions,
  normalizeImageInteractions,
} from "./imageInteractions.ts";
import {
  getCtaMode,
  isBoosterCtaModeSupportedForChannel,
  type BoosterChannelKey,
  type BoosterPostLike,
} from "./boosterCta.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanLabel(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

/**
 * Finds the first safe destination attached to text already baked into one of
 * the publication images. A social provider can expose only one destination,
 * while the iNrCy web renderer keeps every individual hotspot.
 */
export function getPrimaryImageInteractionLink(
  images: readonly unknown[],
): ImageOverlayLinkHotspot | null {
  for (const candidate of images) {
    const image = record(candidate);
    const channelOverlayLink = getImageOverlayLinkHotspots(
      record(image.transform).overlay,
    )[0];
    if (channelOverlayLink) return channelOverlayLink;

    const interactions =
      normalizeImageInteractions(record(image.imageMeta).interactions) ||
      getMediaImageInteractions(image);
    if (!interactions) continue;
    const firstLink = getImageOverlayLinkHotspots({
      items: interactions.items,
    })[0];
    if (firstLink) return firstLink;
  }
  return null;
}

/**
 * Converts an explicit Studio text-link into the provider's one native link
 * when the provider supports it. Existing publication CTAs always win.
 *
 * iNrCy/Site web are intentionally excluded: they render every positioned
 * hotspot instead of collapsing several links into one. Unsupported networks
 * remain unchanged so the UI never pretends that raster pixels are clickable.
 */
export function applyImageInteractionCtaFallback<T extends BoosterPostLike>(
  channel: BoosterChannelKey,
  post: T,
  link: ImageOverlayLinkHotspot | null | undefined,
): T {
  if (!link?.url) return post;
  const hasExplicitCta =
    getCtaMode(post) !== "none" ||
    Boolean(String(post.cta || "").trim()) ||
    Boolean(String(post.ctaUrl || "").trim()) ||
    Boolean(String(post.ctaPhone || "").trim());
  if (hasExplicitCta) return post;

  if (
    channel === "inrcy_site" ||
    channel === "site_web" ||
    // YouTube deliberately renders external URLs in Shorts descriptions as
    // non-clickable. Keep the URL metadata, but never advertise it as a CTA.
    channel === "youtube_shorts" ||
    !isBoosterCtaModeSupportedForChannel(channel, "custom")
  ) {
    return post;
  }

  return {
    ...post,
    ctaMode: "custom",
    cta: cleanLabel(link.label) || "En savoir plus",
    ctaUrl: link.url,
    ctaPhone: "",
  };
}
