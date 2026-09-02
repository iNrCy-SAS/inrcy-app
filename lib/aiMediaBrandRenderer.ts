import "server-only";

import sharp from "sharp";

import type { AiMediaCreativeScene } from "@/lib/aiMediaCreativePlan";
import type {
  AiMediaLogoMode,
  AiMediaVisualStyle,
} from "@/lib/aiMediaGenerationContracts";

type RenderBaseArgs = {
  width: number;
  height: number;
  logo: Buffer | null;
  colors: [string, string, string];
  companyName: string;
  visualStyle: AiMediaVisualStyle;
  logoMode: AiMediaLogoMode;
};

function escapeXml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(value: string, maxCharacters: number, maxLines: number) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(" ").length;
  if (consumed < String(value || "").trim().length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:!?…]+$/g, "")}…`;
  }
  return lines;
}

function textTspans(lines: string[], x: number, startY: number, lineHeight: number) {
  return lines
    .map(
      (line, index) =>
        `<tspan x="${x}" y="${Math.round(startY + index * lineHeight)}">${escapeXml(line)}</tspan>`,
    )
    .join("");
}

function styleOverlayOpacity(style: AiMediaVisualStyle) {
  if (style === "clean") return 0.64;
  if (style === "premium" || style === "expert") return 0.84;
  if (style === "colorful" || style === "dynamic") return 0.7;
  return 0.76;
}

async function prepareLogo(
  logo: Buffer | null,
  width: number,
  height: number,
  logoMode: AiMediaLogoMode,
) {
  if (!logo) return null;
  const visible = logoMode === "visible";
  try {
    const rendered = await sharp(logo, {
      failOn: "none",
      pages: 1,
      density: 220,
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .trim({ background: "#ffffff", threshold: 10 })
      .resize({
        width: Math.round(width * (visible ? 0.26 : 0.17)),
        height: Math.round(height * (visible ? 0.095 : 0.062)),
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: rendered.data,
      width: rendered.info.width,
      height: rendered.info.height,
    };
  } catch {
    return null;
  }
}

function brandPlateSvg(args: {
  width: number;
  height: number;
  plateWidth: number;
  plateHeight: number;
  companyName: string;
  showCompanyName: boolean;
}) {
  const x = Math.round(args.width * 0.055);
  const y = Math.round(args.height * 0.045);
  const radius = Math.round(args.plateHeight * 0.27);
  const fontSize = Math.max(22, Math.round(args.height * 0.024));
  return Buffer.from(`
    <svg width="${args.width}" height="${args.height}" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="shadow"><feDropShadow dx="0" dy="7" stdDeviation="12" flood-opacity="0.24"/></filter></defs>
      <rect x="${x}" y="${y}" width="${args.plateWidth}" height="${args.plateHeight}" rx="${radius}" fill="#ffffff" fill-opacity="0.94" filter="url(#shadow)"/>
      ${
        args.showCompanyName
          ? `<text x="${x + Math.round(args.plateHeight * 0.32)}" y="${y + Math.round(args.plateHeight * 0.63)}" fill="#101827" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700">${escapeXml(args.companyName)}</text>`
          : ""
      }
    </svg>
  `);
}

function sceneCopySvg(args: RenderBaseArgs & { scene: AiMediaCreativeScene }) {
  const margin = Math.round(args.width * 0.065);
  const titleSize = Math.max(48, Math.min(94, Math.round(args.width * 0.065)));
  const bodySize = Math.max(25, Math.min(40, Math.round(args.width * 0.028)));
  const eyebrowSize = Math.max(20, Math.min(31, Math.round(args.width * 0.022)));
  const titleLines = wrapText(args.scene.title, args.width > args.height ? 37 : 24, 3);
  const bodyLines = wrapText(args.scene.body, args.width > args.height ? 64 : 43, 2);
  const titleLineHeight = Math.round(titleSize * 1.05);
  const bodyLineHeight = Math.round(bodySize * 1.25);
  const safeBottom = args.height - margin - 22;
  const bodyY = safeBottom - Math.max(0, bodyLines.length - 1) * bodyLineHeight;
  const titleLastBaseline = bodyY - Math.round(bodySize * 1.55);
  const startY = titleLastBaseline - titleSize - Math.max(0, titleLines.length - 1) * titleLineHeight;
  const statement = args.scene.layout === "statement" || args.scene.layout === "cta";
  const shadeOpacity = statement ? 0.86 : styleOverlayOpacity(args.visualStyle);
  return Buffer.from(`
    <svg width="${args.width}" height="${args.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#020617" stop-opacity="${statement ? 0.16 : 0}"/>
          <stop offset="0.48" stop-color="#020617" stop-opacity="0.13"/>
          <stop offset="1" stop-color="#020617" stop-opacity="${shadeOpacity}"/>
        </linearGradient>
        <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="${args.colors[0]}"/>
          <stop offset="0.5" stop-color="${args.colors[1]}"/>
          <stop offset="1" stop-color="${args.colors[2]}"/>
        </linearGradient>
      </defs>
      <rect width="${args.width}" height="${args.height}" fill="url(#shade)"/>
      <rect x="${margin}" y="${Math.round(startY - eyebrowSize * 1.55)}" width="${Math.round(args.width * 0.18)}" height="7" rx="4" fill="url(#brand)"/>
      <text x="${margin}" y="${Math.round(startY - eyebrowSize * 0.45)}" fill="#ffffff" fill-opacity="0.82" font-family="Arial, Helvetica, sans-serif" font-size="${eyebrowSize}" font-weight="700" letter-spacing="2">${escapeXml(args.scene.eyebrow.toLocaleUpperCase())}</text>
      <text fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="800" letter-spacing="-1">${textTspans(titleLines, margin, startY + titleSize, titleLineHeight)}</text>
      <text fill="#ffffff" fill-opacity="0.86" font-family="Arial, Helvetica, sans-serif" font-size="${bodySize}" font-weight="500">${textTspans(bodyLines, margin, bodyY, bodyLineHeight)}</text>
    </svg>
  `);
}

async function buildBrandOverlays(args: RenderBaseArgs & {
  copySvg: Buffer;
}) {
  const overlays: Array<{ input: Buffer; top?: number; left?: number }> = [
    { input: args.copySvg, top: 0, left: 0 },
  ];
  if (args.logoMode === "none") return overlays;

  const preparedLogo = await prepareLogo(
    args.logo,
    args.width,
    args.height,
    args.logoMode,
  );
  const logoPaddingX = Math.max(22, Math.round(args.width * 0.026));
  const logoPaddingY = Math.max(14, Math.round(args.height * 0.014));
  const plateHeight = preparedLogo
    ? Math.max(72, Math.min(Math.round(args.height * 0.13), preparedLogo.height + logoPaddingY * 2))
    : Math.max(72, Math.round(args.height * 0.075));
  const plateWidth = preparedLogo
    ? Math.max(
        Math.round(args.width * 0.14),
        Math.min(Math.round(args.width * 0.36), preparedLogo.width + logoPaddingX * 2),
      )
    : Math.min(Math.round(args.width * 0.48), Math.max(Math.round(args.width * 0.22), args.companyName.length * Math.round(args.height * 0.014)));
  const x = Math.round(args.width * 0.055);
  const y = Math.round(args.height * 0.045);
  const plate = brandPlateSvg({
    width: args.width,
    height: args.height,
    plateWidth,
    plateHeight,
    companyName: args.companyName,
    showCompanyName: !preparedLogo,
  });
  overlays.push({ input: plate, top: 0, left: 0 });
  if (preparedLogo) {
    overlays.push({
      input: preparedLogo.buffer,
      left: x + Math.round((plateWidth - preparedLogo.width) / 2),
      top: y + Math.round((plateHeight - preparedLogo.height) / 2),
    });
  }
  return overlays;
}

/**
 * Calque PNG exact appliqué après la génération vidéo : l'IA ne dessine
 * jamais le logo ni les textes de marque. Cela évite les pseudo-logos et
 * garantit un habillage net, identique sur tous les fournisseurs vidéo.
 */
export async function renderAiMediaVideoOverlay(args: RenderBaseArgs & {
  scene: AiMediaCreativeScene;
  withText: boolean;
}) {
  const transparent = await sharp({
    create: {
      width: args.width,
      height: args.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
  const overlays = await buildBrandOverlays({
    ...args,
    copySvg: args.withText
      ? sceneCopySvg(args)
      : transparent,
  });
  return await sharp(transparent)
    .composite(overlays)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
