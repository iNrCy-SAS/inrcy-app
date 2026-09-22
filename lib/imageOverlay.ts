/**
 * Optional text/link metadata attached to a publication image.
 *
 * The text is rendered into the exported image.  A URL is deliberately kept
 * as metadata as well: raster images cannot contain a clickable link, but the
 * iNrCy/Site web media card can expose that URL as a real anchor.
 */
export type ImageOverlayPosition = "top" | "center" | "bottom";
export type ImageOverlayStyle = "solid" | "glass";

export type ImageOverlay = {
  text?: string;
  linkUrl?: string;
  position?: ImageOverlayPosition;
  style?: ImageOverlayStyle;
};

function safeHttpUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function normalizeImageOverlay(value: unknown): ImageOverlay | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const text = String(raw.text || "").trim().slice(0, 180);
  const linkUrl = safeHttpUrl(raw.linkUrl);
  const position: ImageOverlayPosition =
    raw.position === "top" || raw.position === "bottom" ? raw.position : "center";
  const style: ImageOverlayStyle = raw.style === "glass" ? "glass" : "solid";
  if (!text && !linkUrl) return undefined;
  return { text: text || undefined, linkUrl, position, style };
}

export function hasImageOverlay(value: unknown): value is ImageOverlay {
  const normalized = normalizeImageOverlay(value);
  return Boolean(normalized?.text || normalized?.linkUrl);
}

export function getImageOverlayText(value: unknown) {
  return normalizeImageOverlay(value)?.text || "";
}

export function getImageOverlayLinkUrl(value: unknown) {
  return normalizeImageOverlay(value)?.linkUrl || "";
}
