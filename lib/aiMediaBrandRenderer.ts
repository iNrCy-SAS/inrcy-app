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

export function wrapAiMediaOverlayText(
  value: string,
  maxCharacters: number,
  maxLines: number,
) {
  const normalized = safeOverlayText(value);
  const words = normalized.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let consumedWords = 0;
  for (const word of words) {
    if (lines.length >= maxLines) break;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || !current) {
      current = candidate;
      consumedWords += 1;
      continue;
    }
    lines.push(current);
    if (lines.length >= maxLines) break;
    current = word;
    consumedWords += 1;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (consumedWords < words.length && lines.length) {
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

function isNearWhiteCanvasPixel(
  data: Buffer,
  offset: number,
  minimumChannel = 208,
  maximumChroma = 48,
) {
  const red = data[offset] || 0;
  const green = data[offset + 1] || 0;
  const blue = data[offset + 2] || 0;
  const alpha = data[offset + 3] || 0;
  const minimum = Math.min(red, green, blue);
  const chroma = Math.max(red, green, blue) - minimum;
  return alpha >= 16 && minimum >= minimumChannel && chroma <= maximumChroma;
}

/**
 * Les anciens logos JPEG/PNG ont parfois été enregistrés sur un rectangle
 * blanc. On ne le détoure que lorsque le bord de l'image prouve qu'il s'agit
 * bien d'un canvas blanc opaque. Un logo blanc dont le bord est transparent
 * ne déclenche donc jamais ce traitement.
 */
async function removeOpaqueNearWhiteEdgeCanvas(input: Buffer) {
  const decoded = await sharp(input, {
    failOn: "none",
    pages: 1,
    limitInputPixels: 16_000_000,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (width < 3 || height < 3 || channels !== 4) return input;

  const border = new Set<number>();
  for (let x = 0; x < width; x += 1) {
    border.add(x);
    border.add((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    border.add(y * width);
    border.add(y * width + width - 1);
  }
  let opaqueWhiteBorderPixels = 0;
  for (const index of border) {
    const offset = index * 4;
    const alpha = decoded.data[offset + 3] || 0;
    if (
      alpha >= 224 &&
      isNearWhiteCanvasPixel(decoded.data, offset, 234, 24)
    ) {
      opaqueWhiteBorderPixels += 1;
    }
  }
  if (opaqueWhiteBorderPixels / border.size < 0.68) return input;

  const visited = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let head = 0;
  let tail = 0;
  const enqueue = (index: number) => {
    if (visited[index]) return;
    if (!isNearWhiteCanvasPixel(decoded.data, index * 4)) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (const index of border) enqueue(index);

  while (head < tail) {
    const index = queue[head] || 0;
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    const offset = index * 4;
    const red = decoded.data[offset] || 0;
    const green = decoded.data[offset + 1] || 0;
    const blue = decoded.data[offset + 2] || 0;
    const alpha = decoded.data[offset + 3] || 0;
    const minimum = Math.min(red, green, blue);
    const chroma = Math.max(red, green, blue) - minimum;
    // Le coeur blanc devient transparent ; la frange quasi blanche garde une
    // fraction d'alpha pour un contour antialiasé sans halo dur.
    const luminanceStrength = Math.max(0, Math.min(1, (minimum - 208) / 38));
    const neutralityStrength = Math.max(0, Math.min(1, 1 - chroma / 48));
    decoded.data[offset + 3] = Math.round(
      alpha * (1 - luminanceStrength * neutralityStrength),
    );
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  return await sharp(decoded.data, {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
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
    const orientedLogo = await sharp(logo, {
      failOn: "none",
      pages: 1,
      density: 220,
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({
        width: 1_600,
        height: 1_600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    const transparentLogo = await removeOpaqueNearWhiteEdgeCanvas(orientedLogo);
    const rendered = await sharp(transparentLogo, {
      failOn: "none",
      pages: 1,
      limitInputPixels: 16_000_000,
    })
      // Ne jamais fabriquer de fond : un logo PNG/WebP transparent reste
      // transparent jusque dans le calque vidéo final. On retire uniquement
      // les marges alpha réellement vides, sans effacer les éléments blancs
      // qui peuvent faire partie du logo officiel.
      .trim({
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        threshold: 8,
      })
      .resize({
        width: Math.round(width * (visible ? 0.16 : 0.12)),
        height: Math.round(height * (visible ? 0.06 : 0.048)),
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

function sceneCopyBackdropSvg(args: RenderBaseArgs & { scene: AiMediaCreativeScene }) {
  const margin = Math.round(args.width * 0.065);
  const titleSize = Math.max(48, Math.min(94, Math.round(args.width * 0.065)));
  const bodySize = Math.max(25, Math.min(40, Math.round(args.width * 0.028)));
  const eyebrowSize = Math.max(20, Math.min(31, Math.round(args.width * 0.022)));
  const statement = args.scene.layout === "statement" || args.scene.layout === "cta";
  const shadeOpacity = statement ? 0.86 : styleOverlayOpacity(args.visualStyle);
  const titleLines = wrapAiMediaOverlayText(
    args.scene.title,
    args.width > args.height ? 37 : 24,
    3,
  );
  const bodyLines = wrapAiMediaOverlayText(
    args.scene.body,
    args.width > args.height ? 64 : 43,
    2,
  );
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
  const titleLines = wrapAiMediaOverlayText(
    args.scene.title,
    args.width > args.height ? 37 : 24,
    3,
  );
  const bodyLines = wrapAiMediaOverlayText(
    args.scene.body,
    args.width > args.height ? 64 : 43,
    2,
  );
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
  if (!preparedLogo) return overlays;

  // La copie éditoriale occupe la zone basse. Le logo reste donc dans le
  // coin supérieur droit, à taille discrète et avec une marge sûre de 4,5 %.
  // Il est posé directement avec son alpha : aucune pastille blanche n'est
  // ajoutée et le sujet central demeure dégagé.
  const safeMarginX = Math.max(18, Math.round(args.width * 0.045));
  const safeMarginY = Math.max(18, Math.round(args.height * 0.045));
  overlays.push({
    input: preparedLogo.buffer,
    left: Math.max(0, args.width - safeMarginX - preparedLogo.width),
    top: safeMarginY,
  });
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
