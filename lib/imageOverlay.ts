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
  /** Position horizontale du centre du bloc, en pourcentage du canevas. */
  x?: number;
  /** Position verticale du centre du bloc, en pourcentage du canevas. */
  y?: number;
  /** Largeur du bloc, en pourcentage du canevas. */
  width?: number;
  /** Hauteur du bloc, en pourcentage du canevas. */
  height?: number;
  /** Compatibilité avec les anciennes retouches à trois positions. */
  position?: ImageOverlayPosition;
  style?: ImageOverlayStyle;
};

function clampPercentage(value: number) {
  return Math.min(100, Math.max(0, value));
}

function clampOverlayWidth(value: number) {
  return Math.min(96, Math.max(16, value));
}

function clampOverlayHeight(value: number) {
  return Math.min(92, Math.max(8, value));
}

function legacyPositionY(position: ImageOverlayPosition) {
  if (position === "top") return 12;
  if (position === "bottom") return 88;
  return 50;
}

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
  const rawX = typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : null;
  const rawY = typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : null;
  const rawWidth =
    typeof raw.width === "number" && Number.isFinite(raw.width)
      ? raw.width
      : null;
  const rawHeight =
    typeof raw.height === "number" && Number.isFinite(raw.height)
      ? raw.height
      : null;
  const hasFreePosition = rawX !== null || rawY !== null;
  return {
    text: text || undefined,
    linkUrl,
    position,
    style,
    ...(hasFreePosition
      ? {
          x: clampPercentage(rawX ?? 50),
          y: clampPercentage(rawY ?? legacyPositionY(position)),
        }
      : {}),
    ...(rawWidth !== null ? { width: clampOverlayWidth(rawWidth) } : {}),
    ...(rawHeight !== null ? { height: clampOverlayHeight(rawHeight) } : {}),
  };
}

/**
 * Donne une position libre au nouveau Studio tout en conservant les anciennes
 * valeurs top/center/bottom déjà enregistrées dans Booster.
 */
export function resolveImageOverlayCoordinates(value: unknown) {
  const overlay = normalizeImageOverlay(value);
  const position = overlay?.position || "center";
  return {
    x: overlay?.x ?? 50,
    y: overlay?.y ?? legacyPositionY(position),
  };
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
