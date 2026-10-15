import { getImageOverlayItems } from "./imageOverlay.ts";
import { imageOverlayFontFamily, resolveImageOverlayTextLayout } from "./imageOverlayLayout.ts";

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

// The server has no browser canvas. Conservative advance estimates plus SVG
// textLength keep every glyph inside its box even when a font is substituted.
function estimateAdvance(text: string, size: number) {
  return Array.from(text).reduce((total, character) => total + (
    /\s/.test(character) ? 0.35 : /[ilI.,'!|:;]/.test(character) ? 0.35 : /[MW@#%]/.test(character) ? 1 : /[A-Z]/.test(character) ? 0.75 : /[a-z0-9]/.test(character) ? 0.6 : 1
  ) * size, 0);
}

export function buildImageOverlaySvg(value: unknown, width: number, height: number) {
  if (width <= 0 || height <= 0) return null;
  const items = getImageOverlayItems(value).filter((item) => item.text);
  if (!items.length) return null;
  const fragments = items.map((overlay) => {
    const layout = resolveImageOverlayTextLayout(width, height, overlay, (text, font) => estimateAdvance(text, Number(font.match(/([\d.]+)px/)?.[1] || 46)));
    const { x, y, width: panelWidth, height: panelHeight, fontSize, lineHeight } = layout;
    const tspans = layout.lines.map((line, index) => {
      const lineWidth = Math.min(panelWidth - fontSize * 1.44, estimateAdvance(line, fontSize));
      return `<tspan x="${x + panelWidth / 2}" y="${layout.firstLineY + lineHeight * index}"${lineWidth > 0 ? ` textLength="${lineWidth}" lengthAdjust="spacingAndGlyphs"` : ""}>${escapeXml(line)}</tspan>`;
    }).join("");
    const fill = overlay.style === "glass" ? "rgba(255,255,255,0.20)" : "rgba(6,10,20,0.78)";
    return `<g><rect x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" rx="${layout.radius}" fill="${fill}" stroke="${layout.borderWidth ? overlay.borderColor || "#38bdf8" : "none"}" stroke-width="${layout.borderWidth}"/><text xml:space="preserve" fill="${overlay.color || "#ffffff"}" font-family="${imageOverlayFontFamily(overlay.fontFamily)}" font-size="${fontSize}px" font-weight="${overlay.bold === false ? 400 : 800}" font-style="${overlay.italic ? "italic" : "normal"}" text-decoration="${overlay.underline ? "underline" : "none"}" text-anchor="middle" dominant-baseline="central">${tspans}</text></g>`;
  });
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${fragments.join("")}</svg>`);
}
