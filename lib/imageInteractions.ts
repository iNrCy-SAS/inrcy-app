import {
  MAX_IMAGE_OVERLAY_ITEMS,
  getImageOverlayItems,
  getImageOverlayLinkHotspots,
  getImageOverlayLinkUrl,
  type ImageOverlay,
  type ImageOverlayItem,
  type ImageOverlayLinkHotspot,
} from "./imageOverlay.ts";
import type { ImageCanvasLayout } from "./imageTransformGeometry.ts";

/** Web interactions for text already baked into the source file. Never render
 * these items as an image overlay: doing so would draw the text a second time. */
export type ImageInteractions = {
  version: 1;
  items: ImageOverlayItem[];
};

export type ImageInteractionOverlay = ImageOverlay & ImageInteractions;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function imageInteractionsFromOverlay(value: unknown): ImageInteractions | undefined {
  const items = getImageOverlayItems(value).flatMap((item) => {
    const linkUrl = getImageOverlayLinkUrl(item);
    return item.text && linkUrl ? [{ ...item, linkUrl }] : [];
  });
  return items.length ? { version: 1, items } : undefined;
}

function finiteGeometryValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

/** Interaction geometry may legitimately become thinner than the editor's
 * minimum block size after a crop. Keep those clipped values exact instead of
 * running them back through the visual overlay size clamps. */
function normalizeInteractionItem(value: unknown): ImageOverlayItem | undefined {
  const source = record(value);
  const normalized = getImageOverlayItems({ items: [source] })[0];
  if (!normalized?.text) return undefined;
  const linkUrl = getImageOverlayLinkUrl(normalized);
  if (!linkUrl) return undefined;

  const x = finiteGeometryValue(source.x);
  const y = finiteGeometryValue(source.y);
  const width = finiteGeometryValue(source.width);
  const height = finiteGeometryValue(source.height);
  const hasCompleteGeometry =
    x !== null && y !== null && width !== null && height !== null;
  if (hasCompleteGeometry && (width <= 0 || height <= 0)) return undefined;

  return {
    ...normalized,
    linkUrl,
    ...(hasCompleteGeometry
      ? {
          x: clampPercent(x),
          y: clampPercent(y),
          width: Math.min(100, width),
          height: Math.min(100, height),
        }
      : {}),
  };
}

export function normalizeImageInteractions(value: unknown): ImageInteractions | undefined {
  const raw = record(value);
  if (raw.version !== 1 || !Array.isArray(raw.items)) return undefined;
  const items = raw.items
    .slice(0, MAX_IMAGE_OVERLAY_ITEMS)
    .map(normalizeInteractionItem)
    .filter((item): item is ImageOverlayItem => Boolean(item));
  return items.length ? { version: 1, items } : undefined;
}

const GEOMETRY_EPSILON = 1e-9;

/**
 * Move source-relative clickable rectangles into the pixels of a rendered
 * publication canvas. Partial rectangles are clipped; rectangles completely
 * removed by a cover crop or an offset are discarded.
 *
 * This only changes interaction metadata. It deliberately never creates a
 * visual overlay, because Studio already baked the text into the source file.
 */
export function transformImageInteractionsForLayout(
  value: unknown,
  layout: Pick<
    ImageCanvasLayout,
    "canvasWidth" | "canvasHeight" | "drawWidth" | "drawHeight" | "drawX" | "drawY"
  >,
): ImageInteractions | undefined {
  const interactions = normalizeImageInteractions(value);
  if (!interactions) return undefined;

  const canvasWidth = Number(layout.canvasWidth);
  const canvasHeight = Number(layout.canvasHeight);
  const drawWidth = Number(layout.drawWidth);
  const drawHeight = Number(layout.drawHeight);
  const drawX = Number(layout.drawX);
  const drawY = Number(layout.drawY);
  if (
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    !Number.isFinite(drawWidth) ||
    !Number.isFinite(drawHeight) ||
    !Number.isFinite(drawX) ||
    !Number.isFinite(drawY) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0 ||
    drawWidth <= 0 ||
    drawHeight <= 0
  ) {
    return interactions;
  }

  const identity =
    Math.abs(drawX) <= GEOMETRY_EPSILON &&
    Math.abs(drawY) <= GEOMETRY_EPSILON &&
    Math.abs(drawWidth - canvasWidth) <= GEOMETRY_EPSILON &&
    Math.abs(drawHeight - canvasHeight) <= GEOMETRY_EPSILON;
  if (identity) return interactions;

  const items = interactions.items.flatMap((item) => {
    if (
      typeof item.x !== "number" ||
      typeof item.y !== "number" ||
      typeof item.width !== "number" ||
      typeof item.height !== "number"
    ) {
      // Historic interactions intentionally keep their whole-image fallback.
      return [item];
    }

    const left = drawX + ((item.x - item.width / 2) / 100) * drawWidth;
    const top = drawY + ((item.y - item.height / 2) / 100) * drawHeight;
    const right = drawX + ((item.x + item.width / 2) / 100) * drawWidth;
    const bottom = drawY + ((item.y + item.height / 2) / 100) * drawHeight;
    const clippedLeft = Math.max(0, Math.min(canvasWidth, left));
    const clippedTop = Math.max(0, Math.min(canvasHeight, top));
    const clippedRight = Math.max(0, Math.min(canvasWidth, right));
    const clippedBottom = Math.max(0, Math.min(canvasHeight, bottom));
    if (
      clippedRight - clippedLeft <= GEOMETRY_EPSILON ||
      clippedBottom - clippedTop <= GEOMETRY_EPSILON
    ) {
      return [];
    }

    return [{
      ...item,
      x: (((clippedLeft + clippedRight) / 2) / canvasWidth) * 100,
      y: (((clippedTop + clippedBottom) / 2) / canvasHeight) * 100,
      width: ((clippedRight - clippedLeft) / canvasWidth) * 100,
      height: ((clippedBottom - clippedTop) / canvasHeight) * 100,
    }];
  });

  return items.length ? { version: 1, items } : undefined;
}

/**
 * Combines links baked by Studio with links added later by a channel adapter.
 *
 * Each source is normalized independently, then duplicates are removed before
 * applying Studio's maximum. This order matters: normalizing one concatenated
 * array would slice it first and could silently discard a unique adapter link
 * that follows duplicate Studio metadata.
 */
export function mergeImageInteractionOverlays(
  ...values: readonly unknown[]
): ImageInteractionOverlay | undefined {
  const items: ImageOverlayItem[] = [];
  const ids = new Set<string>();
  const fingerprints = new Set<string>();

  for (const value of values) {
    const exactInteractions = normalizeImageInteractions(value);
    const candidates = exactInteractions?.items || getImageOverlayItems(value);
    for (const item of candidates) {
      const hotspot = getImageInteractionLinkHotspots({
        version: 1,
        items: [item],
      })[0];
      if (!hotspot) continue;

      const id = String(item.id || "").trim();
      const geometry = hotspot.geometry;
      const fingerprint = JSON.stringify([
        hotspot.url,
        hotspot.label,
        geometry?.x ?? null,
        geometry?.y ?? null,
        geometry?.width ?? null,
        geometry?.height ?? null,
      ]);
      if ((id && ids.has(id)) || fingerprints.has(fingerprint)) continue;

      if (id) ids.add(id);
      fingerprints.add(fingerprint);
      items.push(item);
      if (items.length >= MAX_IMAGE_OVERLAY_ITEMS) break;
    }
    if (items.length >= MAX_IMAGE_OVERLAY_ITEMS) break;
  }

  return items.length ? { version: 1, ...items[0], items } : undefined;
}

/**
 * Reads link hitboxes from the interaction contract without applying the
 * editor's visual minimum block size a second time. This is essential after a
 * crop: a partially visible CTA may legitimately occupy less than 16 x 8 %.
 */
export function getImageInteractionLinkHotspots(
  value: unknown,
): ImageOverlayLinkHotspot[] {
  const interactions = normalizeImageInteractions(value);
  if (!interactions) return getImageOverlayLinkHotspots(value);

  return interactions.items.flatMap((item) => {
    const label = String(item.text || "").trim();
    const url = label ? getImageOverlayLinkUrl(item) : "";
    if (!url) return [];

    const hasPreciseGeometry =
      typeof item.x === "number" &&
      Number.isFinite(item.x) &&
      typeof item.y === "number" &&
      Number.isFinite(item.y) &&
      typeof item.width === "number" &&
      Number.isFinite(item.width) &&
      typeof item.height === "number" &&
      Number.isFinite(item.height);

    return [{
      url,
      label,
      ...(hasPreciseGeometry
        ? {
            geometry: {
              x: item.x as number,
              y: item.y as number,
              width: item.width as number,
              height: item.height as number,
            },
          }
        : {}),
    }];
  });
}

/** Accept current handoffs and saved library records, including historic Studio
 * retouches whose original overlay is metadata (the source is already baked). */
export function getMediaImageInteractions(value: unknown): ImageInteractions | undefined {
  const item = record(value);
  const metadata = record(item.media_metadata);
  return normalizeImageInteractions(item.image_interactions)
    || normalizeImageInteractions(metadata.image_interactions)
    || (metadata.studio_action === "retouch"
      ? imageInteractionsFromOverlay(record(metadata.transform).overlay)
      : undefined);
}

export function withMediaImageInteractions<T extends object>(meta: T, item: unknown): T & { interactions?: ImageInteractions } {
  const interactions = getMediaImageInteractions(item);
  return interactions ? { ...meta, interactions } : { ...meta };
}

/** Keep holes: removing an entry would attach image 2's links to image 1. */
export function buildSiteImageInteractionMetadata(
  images: readonly unknown[],
  imageKeys: readonly unknown[],
  imageCount: number,
) {
  return Array.from({ length: imageCount }, (_, index) => {
    const imageKey = String(imageKeys[index] || record(images[index]).imageKey || "").trim();
    const image = record(imageKey
      ? images.find((candidate) => String(record(candidate).imageKey || "").trim() === imageKey)
      : images[index]);
    const interactions = normalizeImageInteractions(record(image.imageMeta).interactions)
      || getMediaImageInteractions(image);
    return interactions ? { imageKey: imageKey || null, interactions } : null;
  });
}
