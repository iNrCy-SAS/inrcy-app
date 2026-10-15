import { resolveImageOverlayCoordinates, type ImageOverlayItem } from "./imageOverlay.ts";

export function imageOverlayFontFamily(value: ImageOverlayItem["fontFamily"]) {
  if (value === "arial") return "Arial, sans-serif";
  if (value === "georgia") return "Georgia, serif";
  if (value === "verdana") return "Verdana, sans-serif";
  return "Inter, Arial, sans-serif";
}

export function imageOverlayFont(overlay: ImageOverlayItem, size: number) {
  return `${overlay.italic ? "italic " : ""}${overlay.bold === false ? 400 : 800} ${size}px ${imageOverlayFontFamily(overlay.fontFamily)}`;
}

type TextMeasurer = (text: string, font: string) => number;

/** Layout at a stable reference width so resizing the preview cannot reflow text. */
export function resolveImageOverlayTextLayout(
  width: number,
  height: number,
  overlay: ImageOverlayItem,
  measure: TextMeasurer,
) {
  const scale = width / 1000;
  const referenceHeight = height / scale;
  const blockWidth = 1000 * (overlay.width ?? 68) / 100;
  const requestedFont = 1000 * (overlay.fontSize ?? 4.6) / 100;
  const requestedHeight = overlay.height ? referenceHeight * overlay.height / 100 : null;
  const maximumHeight = requestedHeight ?? referenceHeight;
  const wrap = (fontSize: number) => {
    const font = imageOverlayFont(overlay, fontSize);
    const maxTextWidth = Math.max(1, blockWidth - fontSize * 1.44);
    const lines: string[] = [];
    for (const paragraph of (overlay.text || "").split(/\r?\n/)) {
      let line = "";
      for (const character of paragraph) {
        const candidate = line + character;
        if (line && measure(candidate, font) > maxTextWidth) {
          lines.push(line);
          line = character;
        } else line = candidate;
      }
      lines.push(line);
    }
    return { lines, lineHeight: fontSize * 1.2, naturalHeight: (lines.length * 1.2 + 1) * fontSize };
  };
  let fontSize = requestedFont;
  let wrapped = wrap(fontSize);
  if (wrapped.naturalHeight > maximumHeight) {
    let low = 0;
    let high = requestedFont;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const candidate = (low + high) / 2;
      if (wrap(candidate).naturalHeight <= maximumHeight) low = candidate;
      else high = candidate;
    }
    fontSize = low;
    wrapped = wrap(fontSize);
  }
  const blockHeight = requestedHeight ?? wrapped.naturalHeight;
  const coordinates = resolveImageOverlayCoordinates(overlay);
  const x = Math.max(0, Math.min(1000 - blockWidth, 1000 * coordinates.x / 100 - blockWidth / 2));
  const y = Math.max(0, Math.min(referenceHeight - blockHeight, referenceHeight * coordinates.y / 100 - blockHeight / 2));
  return {
    x: x * scale,
    y: y * scale,
    width: blockWidth * scale,
    height: blockHeight * scale,
    fontSize: fontSize * scale,
    lineHeight: wrapped.lineHeight * scale,
    lines: wrapped.lines,
    firstLineY: (y + (blockHeight - wrapped.lines.length * wrapped.lineHeight) / 2 + wrapped.lineHeight / 2) * scale,
    radius: fontSize * 0.45 * scale,
    borderWidth: (overlay.borderWidth ?? 0) * scale,
  };
}
