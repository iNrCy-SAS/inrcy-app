/**
 * Optional text/link metadata attached to a publication image.
 *
 * The text is rendered into the exported image.  A URL is deliberately kept
 * as metadata as well: raster images cannot contain a clickable link, but the
 * iNrCy/Site web media card can expose that URL as a real anchor.
 */
export type ImageOverlayPosition = "top" | "center" | "bottom";
export type ImageOverlayStyle = "solid" | "glass";
export type ImageOverlayFontFamily = "inter" | "arial" | "georgia" | "verdana";

export type ImageOverlayItem = {
  id?: string;
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
  fontFamily?: ImageOverlayFontFamily;
  /** Taille de police exprimée en pourcentage de la largeur du canevas. */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  /** Épaisseur de la bordure du bloc, en pixels de référence (0 = aucune). */
  borderWidth?: number;
  borderColor?: string;
};

export type ImageOverlay = ImageOverlayItem & {
  /** Plusieurs blocs indépendants, tout en conservant le premier à la racine. */
  items?: ImageOverlayItem[];
};

export type ImageOverlayLinkHotspot = {
  url: string;
  label: string;
  /**
   * Les anciennes retouches ne stockaient pas toujours les quatre valeurs de
   * géométrie. Dans ce cas, le rendu web conserve le lien historique sur toute
   * l'image au lieu d'inventer une zone qui ne correspondrait pas au visuel.
   */
  geometry?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export const MAX_IMAGE_OVERLAY_ITEMS = 6;

function clampPercentage(value: number) {
  return Math.min(100, Math.max(0, value));
}

function clampOverlayWidth(value: number) {
  return Math.min(96, Math.max(16, value));
}

function clampOverlayHeight(value: number) {
  return Math.min(92, Math.max(8, value));
}

function clampFontSize(value: number) {
  return Math.min(10, Math.max(1.5, value));
}

function clampBorderWidth(value: number) {
  return Math.min(8, Math.max(0, Math.round(value)));
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

function httpUrlDraft(value: unknown) {
  const raw = String(value || "").trim().slice(0, 2048);
  if (!raw) return undefined;
  const explicitProtocol = raw.match(/^([a-z][a-z0-9+.-]*):/i)?.[1];
  if (
    explicitProtocol &&
    explicitProtocol.toLowerCase() !== "http" &&
    explicitProtocol.toLowerCase() !== "https"
  ) {
    return undefined;
  }
  return raw;
}

function normalizeImageOverlayItem(value: unknown): ImageOverlayItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const rawText = String(raw.text || "").slice(0, 180);
  const text = rawText.trim() ? rawText : "";
  const linkUrl = httpUrlDraft(raw.linkUrl);
  const id = String(raw.id || "").trim().slice(0, 80) || undefined;
  const position: ImageOverlayPosition =
    raw.position === "top" || raw.position === "bottom" ? raw.position : "center";
  const style: ImageOverlayStyle = raw.style === "glass" ? "glass" : "solid";
  // Un bloc identifié peut rester momentanément vide pendant l'édition :
  // supprimer la sélection au clavier ne doit pas supprimer le bloc avant que
  // l'utilisateur ait pu saisir son nouveau texte.
  if (!text && !linkUrl && !id) return undefined;
  const fontFamily: ImageOverlayFontFamily =
    raw.fontFamily === "arial" ||
    raw.fontFamily === "georgia" ||
    raw.fontFamily === "verdana"
      ? raw.fontFamily
      : "inter";
  const rawFontSize =
    typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)
      ? raw.fontSize
      : null;
  const color = /^#[0-9a-f]{6}$/i.test(String(raw.color || ""))
    ? String(raw.color)
    : undefined;
  const borderColor = /^#[0-9a-f]{6}$/i.test(String(raw.borderColor || ""))
    ? String(raw.borderColor)
    : undefined;
  const rawBorderWidth =
    typeof raw.borderWidth === "number" && Number.isFinite(raw.borderWidth)
      ? raw.borderWidth
      : null;
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
    id,
    text: text || undefined,
    linkUrl,
    position,
    style,
    fontFamily,
    ...(rawFontSize !== null ? { fontSize: clampFontSize(rawFontSize) } : {}),
    ...(typeof raw.bold === "boolean" ? { bold: raw.bold } : {}),
    ...(typeof raw.italic === "boolean" ? { italic: raw.italic } : {}),
    ...(typeof raw.underline === "boolean"
      ? { underline: raw.underline }
      : {}),
    ...(color ? { color } : {}),
    ...(rawBorderWidth !== null
      ? { borderWidth: clampBorderWidth(rawBorderWidth) }
      : {}),
    ...(borderColor ? { borderColor } : {}),
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

export function normalizeImageOverlay(value: unknown): ImageOverlay | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const items = Array.isArray(raw.items)
    ? raw.items
        .slice(0, MAX_IMAGE_OVERLAY_ITEMS)
        .map(normalizeImageOverlayItem)
        .filter((item): item is ImageOverlayItem => Boolean(item))
    : [];
  if (items.length) return { ...items[0], items };
  return normalizeImageOverlayItem(raw);
}

export function getImageOverlayItems(value: unknown): ImageOverlayItem[] {
  const normalized = normalizeImageOverlay(value);
  if (!normalized) return [];
  if (normalized.items?.length) return normalized.items;
  const { items: _items, ...single } = normalized;
  return [single];
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
  return getImageOverlayItems(value).some((item) => Boolean(item.text));
}

export function getImageOverlayText(value: unknown) {
  return getImageOverlayItems(value)[0]?.text || "";
}

export function getImageOverlayLinkUrl(value: unknown) {
  for (const item of getImageOverlayItems(value)) {
    if (!item.text) continue;
    const safeUrl = safeHttpUrl(item.linkUrl);
    if (safeUrl) return safeUrl;
  }
  return "";
}

export function getImageOverlayLinkHotspots(
  value: unknown,
): ImageOverlayLinkHotspot[] {
  return getImageOverlayItems(value).flatMap((item) => {
    const label = String(item.text || "").trim();
    const url = label ? safeHttpUrl(item.linkUrl) : undefined;
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

    return [
      {
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
      },
    ];
  });
}
