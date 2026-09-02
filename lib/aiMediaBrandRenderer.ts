import "server-only";

import path from "node:path";
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

// Sharp/Pango cannot rely on the fonts installed by a serverless host. Vercel
// was therefore replacing every caption character with the missing-glyph box.
// Next ships Geist with the application; the route trace below explicitly
// retains it and every text layer supplies the file directly to Pango.
const OVERLAY_FONT_FILE = path.join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "compiled",
  "@vercel",
  "og",
  "Geist-Regular.ttf",
);

function escapeXml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeOverlayText(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    // Geist couvre les alphabets latins utilisés par l'application. Les emoji
    // et pictogrammes couleur, eux, seraient à nouveau rendus en carrés.
    .replace(/[^\p{Script=Latin}\p{M}\p{N}\s.,;:!?…'’"“”()&+#\-–—/%€@·•]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(value: string, maxCharacters: number, maxLines: number) {
  const normalized = safeOverlayText(value);
  const words = normalized.split(/\s+/).filter(Boolean);
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
  if (consumed < normalized.length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:!?…]+$/g, "")}…`;
  }
  return lines;
}

async function rasterTextLayer(args: {
  text: string;
  fontSize: number;
  fontWeight: 500 | 700 | 800;
  color: string;
  left: number;
  top: number;
  maxWidth: number;
}) {
  const text = safeOverlayText(args.text);
  if (!text) return null;
  const rendered = await sharp({
    text: {
      text: `<span foreground="${args.color}" weight="${args.fontWeight}">${escapeXml(text)}</span>`,
      font: `Geist ${args.fontSize}`,
      fontfile: OVERLAY_FONT_FILE,
      rgba: true,
      dpi: 72,
      wrap: "none",
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  const input = rendered.info.width > args.maxWidth
    ? await sharp(rendered.data)
        .resize({ width: args.maxWidth, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer()
    : rendered.data;
  return {
    input,
    left: Math.max(0, Math.round(args.left)),
    top: Math.max(0, Math.round(args.top)),
  };
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
}) {
  const x = Math.round(args.width * 0.055);
  const y = Math.round(args.height * 0.045);
  const radius = Math.round(args.plateHeight * 0.27);
  return Buffer.from(`
    <svg width="${args.width}" height="${args.height}" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="shadow"><feDropShadow dx="0" dy="7" stdDeviation="12" flood-opacity="0.24"/></filter></defs>
      <rect x="${x}" y="${y}" width="${args.plateWidth}" height="${args.plateHeight}" rx="${radius}" fill="#ffffff" fill-opacity="0.94" filter="url(#shadow)"/>
    </svg>
  `);
}

function sceneCopyBackdropSvg(args: RenderBaseArgs & { scene: AiMediaCreativeScene }) {
  const margin = Math.round(args.width * 0.065);
  const titleSize = Math.max(48, Math.min(94, Math.round(args.width * 0.065)));
  const bodySize = Math.max(25, Math.min(40, Math.round(args.width * 0.028)));
  const eyebrowSize = Math.max(20, Math.min(31, Math.round(args.width * 0.022)));
  const statement = args.scene.layout === "statement" || args.scene.layout === "cta";
  const shadeOpacity = statement ? 0.86 : styleOverlayOpacity(args.visualStyle);
  const titleLines = wrapText(args.scene.title, args.width > args.height ? 37 : 24, 3);
  const bodyLines = wrapText(args.scene.body, args.width > args.height ? 64 : 43, 2);
  const titleLineHeight = Math.round(titleSize * 1.05);
  const bodyLineHeight = Math.round(bodySize * 1.25);
  const safeBottom = args.height - margin - 22;
  const bodyY = safeBottom - Math.max(0, bodyLines.length - 1) * bodyLineHeight;
  const titleLastBaseline = bodyY - Math.round(bodySize * 1.55);
  const startY = titleLastBaseline - titleSize - Math.max(0, titleLines.length - 1) * titleLineHeight;
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
    </svg>
  `);
}

async function renderSceneCopyOverlay(
  args: RenderBaseArgs & { scene: AiMediaCreativeScene },
) {
  const margin = Math.round(args.width * 0.065);
  const maxWidth = args.width - margin * 2;
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
  const textLayers = await Promise.all([
    rasterTextLayer({
      text: args.scene.eyebrow.toLocaleUpperCase(),
      fontSize: eyebrowSize,
      fontWeight: 700,
      color: "#d5deed",
      left: margin,
      top: startY - eyebrowSize * 1.3,
      maxWidth,
    }),
    ...titleLines.map((line, index) =>
      rasterTextLayer({
        text: line,
        fontSize: titleSize,
        fontWeight: 800,
        color: "#ffffff",
        left: margin,
        top: startY + index * titleLineHeight,
        maxWidth,
      }),
    ),
    ...bodyLines.map((line, index) =>
      rasterTextLayer({
        text: line,
        fontSize: bodySize,
        fontWeight: 500,
        color: "#dbe3f0",
        left: margin,
        top: bodyY - bodySize + index * bodyLineHeight,
        maxWidth,
      }),
    ),
  ]);
  const transparent = await sharp({
    create: {
      width: args.width,
      height: args.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
  return await sharp(transparent)
    .composite([
      { input: sceneCopyBackdropSvg(args), top: 0, left: 0 },
      ...textLayers.filter((layer): layer is NonNullable<typeof layer> => Boolean(layer)),
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function buildBrandOverlays(args: RenderBaseArgs & {
  copyOverlay: Buffer;
}) {
  const overlays: Array<{ input: Buffer; top?: number; left?: number }> = [
    { input: args.copyOverlay, top: 0, left: 0 },
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
  });
  overlays.push({ input: plate, top: 0, left: 0 });
  if (preparedLogo) {
    overlays.push({
      input: preparedLogo.buffer,
      left: x + Math.round((plateWidth - preparedLogo.width) / 2),
      top: y + Math.round((plateHeight - preparedLogo.height) / 2),
    });
  } else {
    const companyName = await rasterTextLayer({
      text: args.companyName,
      fontSize: Math.max(22, Math.round(args.height * 0.024)),
      fontWeight: 700,
      color: "#101827",
      left: x + Math.round(plateHeight * 0.32),
      top: y + Math.round(plateHeight * 0.28),
      maxWidth: Math.max(1, plateWidth - Math.round(plateHeight * 0.52)),
    });
    if (companyName) overlays.push(companyName);
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
    copyOverlay: args.withText
      ? await renderSceneCopyOverlay(args)
      : transparent,
  });
  return await sharp(transparent)
    .composite(overlays)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
