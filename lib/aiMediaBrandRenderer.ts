import "server-only";

import path from "node:path";
import sharp from "sharp";

import type { AiMediaCreativeScene } from "@/lib/aiMediaCreativePlan";
import type {
  AiMediaImagePurpose,
  AiMediaLogoMode,
  AiMediaVisualStyle,
} from "@/lib/aiMediaGenerationContracts";
import {
  AI_MEDIA_VISIBLE_BODY_MAX_CHARACTERS,
  AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS,
  acceptCompleteAiMediaVisibleCopy,
} from "@/lib/aiMediaTextIntegrity";
import {
  resolveAiMediaVideoCopyPlacement,
  resolveAiMediaVideoOverlayLayout,
} from "@/lib/aiMediaVideoLayout";

type RenderBaseArgs = {
  width: number;
  height: number;
  logo: Buffer | null;
  colors: [string, string, string];
  companyName: string;
  visualStyle: AiMediaVisualStyle;
  logoMode: AiMediaLogoMode;
  imagePurpose?: AiMediaImagePurpose;
};

export type AiMediaImageCompositionCopy = {
  headline: string;
  subline: string;
  cta: string;
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
  "Geist-Regular.ttf"
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
  return (
    String(value || "")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      // Geist couvre les alphabets latins utilisés par l'application. Les emoji
      // et pictogrammes couleur, eux, seraient à nouveau rendus en carrés.
      .replace(
        /[^\p{Script=Latin}\p{M}\p{N}\s.,;:!?…'’"“”()&+#\-–—/%€@·•]/gu,
        " "
      )
      .replace(/\s+/g, " ")
      .trim()
  );
}

type WrappedOverlayText = {
  lines: string[];
};

function wrapNormalizedOverlayText(
  normalized: string,
  maxCharacters: number
): WrappedOverlayText {
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
  }
  if (current) lines.push(current);
  return { lines };
}

function wrapCompleteOverlayText(
  value: string,
  maxCharacters: number,
  maxLines: number,
  maximum: number
) {
  const validated = acceptCompleteAiMediaVisibleCopy(value, maximum);
  const normalized = safeOverlayText(validated);
  const lineLimit = Math.max(1, Math.round(maxLines));
  if (!normalized) return [];

  // Widen only as much as needed to keep every word in the available lines.
  // Rasterization then scales the complete line to its box; no suffix is lost.
  for (
    let measure = Math.max(1, Math.round(maxCharacters));
    measure <= normalized.length;
    measure += 1
  ) {
    const wrapped = wrapNormalizedOverlayText(normalized, measure).lines;
    if (wrapped.length <= lineLimit) return wrapped;
  }
  return [normalized];
}

export function wrapAiMediaOverlayText(
  value: string,
  maxCharacters: number,
  maxLines: number
) {
  return wrapCompleteOverlayText(
    value,
    maxCharacters,
    maxLines,
    AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS
  );
}

export function wrapAiMediaOverlayBodyText(
  value: string,
  maxCharacters: number,
  maxLines: number
) {
  return wrapCompleteOverlayText(
    value,
    maxCharacters,
    maxLines,
    AI_MEDIA_VISIBLE_BODY_MAX_CHARACTERS
  );
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
      text: `<span foreground="${args.color}" weight="${
        args.fontWeight
      }">${escapeXml(text)}</span>`,
      font: `Geist ${args.fontSize}`,
      fontfile: OVERLAY_FONT_FILE,
      rgba: true,
      dpi: 72,
      wrap: "none",
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  const input =
    rendered.info.width > args.maxWidth
      ? await sharp(rendered.data)
          .resize({
            width: args.maxWidth,
            fit: "inside",
            withoutEnlargement: true,
          })
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
  if (style === "premium" || style === "expert") return 0.78;
  if (style === "colorful" || style === "dynamic") return 0.68;
  return 0.72;
}

function isNearWhiteCanvasPixel(
  data: Buffer,
  offset: number,
  minimumChannel = 208,
  maximumChroma = 48
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
    if (alpha >= 224 && isNearWhiteCanvasPixel(decoded.data, offset, 234, 24)) {
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
      alpha * (1 - luminanceStrength * neutralityStrength)
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
  logoMode: AiMediaLogoMode
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

function resolveSceneCopyLayout(
  args: RenderBaseArgs & { scene: AiMediaCreativeScene }
) {
  const layout = resolveAiMediaVideoOverlayLayout(args);
  const titleLines = wrapAiMediaOverlayText(
    args.scene.title,
    layout.copy.titleMaxCharacters,
    layout.copy.titleMaxLines
  );
  const bodyLines = wrapAiMediaOverlayBodyText(
    args.scene.body,
    layout.copy.bodyMaxCharacters,
    layout.copy.bodyMaxLines
  );
  const placement = resolveAiMediaVideoCopyPlacement({
    layout,
    titleLineCount: titleLines.length,
    bodyLineCount: bodyLines.length,
  });
  return { layout, placement, titleLines, bodyLines };
}

type ResolvedSceneCopyLayout = ReturnType<typeof resolveSceneCopyLayout>;

function sceneCopyBackdropSvg(
  args: RenderBaseArgs & { scene: AiMediaCreativeScene },
  resolved: ResolvedSceneCopyLayout
) {
  const { layout, placement } = resolved;
  const statement =
    args.scene.layout === "statement" || args.scene.layout === "cta";
  const shadeOpacity = statement ? 0.78 : styleOverlayOpacity(args.visualStyle);
  return Buffer.from(`
    <svg width="${args.width}" height="${
    args.height
  }" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#020617" stop-opacity="0"/>
          <stop offset="${
            placement.gradientStartPercent
          }%" stop-color="#020617" stop-opacity="0"/>
          <stop offset="${
            placement.gradientMiddlePercent
          }%" stop-color="#020617" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#020617" stop-opacity="${shadeOpacity}"/>
        </linearGradient>
        <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="${args.colors[0]}"/>
          <stop offset="0.5" stop-color="${args.colors[1]}"/>
          <stop offset="1" stop-color="${args.colors[2]}"/>
        </linearGradient>
      </defs>
      <rect width="${args.width}" height="${args.height}" fill="url(#shade)"/>
      <rect x="${layout.copy.left}" y="${placement.accentTop}" width="${
    layout.copy.accentWidth
  }" height="${layout.copy.accentHeight}" rx="${Math.ceil(
    layout.copy.accentHeight / 2
  )}" fill="url(#brand)"/>
    </svg>
  `);
}

async function renderSceneCopyOverlay(
  args: RenderBaseArgs & { scene: AiMediaCreativeScene }
) {
  const resolved = resolveSceneCopyLayout(args);
  const { layout, placement, titleLines, bodyLines } = resolved;
  const transparent = await sharp({
    create: {
      width: args.width,
      height: args.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const hasVisibleCopy = [
    args.scene.eyebrow,
    ...titleLines,
    ...bodyLines,
  ].some((value) => String(value || "").trim().length > 0);
  if (!hasVisibleCopy) return transparent;
  const textLayers = await Promise.all([
    rasterTextLayer({
      text: args.scene.eyebrow.toLocaleUpperCase(),
      fontSize: layout.copy.eyebrowSize,
      fontWeight: 700,
      color: "#d5deed",
      left: layout.copy.left,
      top: placement.eyebrowTop,
      maxWidth: layout.copy.maxWidth,
    }),
    ...titleLines.map((line, index) =>
      rasterTextLayer({
        text: line,
        fontSize: layout.copy.titleSize,
        fontWeight: 800,
        color: "#ffffff",
        left: layout.copy.left,
        top: placement.titleFirstTop + index * layout.copy.titleLineHeight,
        maxWidth: layout.copy.maxWidth,
      })
    ),
    ...bodyLines.map((line, index) =>
      rasterTextLayer({
        text: line,
        fontSize: layout.copy.bodySize,
        fontWeight: 500,
        color: "#dbe3f0",
        left: layout.copy.left,
        top: placement.bodyFirstTop + index * layout.copy.bodyLineHeight,
        maxWidth: layout.copy.maxWidth,
      })
    ),
  ]);
  return await sharp(transparent)
    .composite([
      { input: sceneCopyBackdropSvg(args, resolved), top: 0, left: 0 },
      ...textLayers.filter((layer): layer is NonNullable<typeof layer> =>
        Boolean(layer)
      ),
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function splitFlyerOffers(value: string) {
  const normalized = safeOverlayText(value);
  if (!normalized) return [];
  const sections = normalized
    .split(/\s+(?:·|•|\|)\s+/u)
    .map((section) => section.trim())
    .filter(Boolean);
  if (sections.length <= 2) return sections;
  return [sections[0], sections.slice(1).join(" · ")].filter(
    (section): section is string => Boolean(section)
  );
}

type FlyerLayout = ReturnType<typeof resolveFlyerLayout>;

function resolveFlyerLayout(args: {
  width: number;
  height: number;
  titleLineCount: number;
  offerCount: number;
}) {
  const minimumSide = Math.min(args.width, args.height);
  const portrait = args.height > args.width * 1.12;
  const margin = Math.max(18, Math.round(minimumSide * 0.055));
  const panelLeft = margin;
  const panelTop = Math.max(margin, Math.round(args.height * 0.13));
  const panelWidth = args.width - margin * 2;
  const panelHeight = args.height - panelTop - margin;
  const padding = Math.max(18, Math.round(minimumSide * 0.045));
  const innerLeft = panelLeft + padding;
  const innerWidth = panelWidth - padding * 2;
  const eyebrowSize = Math.max(13, Math.round(minimumSide * 0.022));
  const titleSize = Math.max(26, Math.round(minimumSide * 0.06));
  const titleLineHeight = Math.round(titleSize * 1.1);
  const eyebrowTop = panelTop + padding;
  const titleFirstTop = eyebrowTop + Math.round(eyebrowSize * 1.75);
  const gap = Math.max(12, Math.round(minimumSide * 0.022));
  const cardsTop =
    titleFirstTop +
    Math.max(1, args.titleLineCount) * titleLineHeight +
    gap;
  const ctaHeight = Math.max(38, Math.round(minimumSide * 0.075));
  const ctaTop = panelTop + panelHeight - padding - ctaHeight;
  const cardsBottom = ctaTop - gap;
  const cardsHeight = Math.max(
    Math.round(minimumSide * 0.14),
    cardsBottom - cardsTop
  );
  const stacked = portrait && args.offerCount > 1;
  const cardGap = gap;
  const cardCount = Math.max(1, Math.min(2, args.offerCount || 1));
  const cardWidth = stacked
    ? innerWidth
    : Math.floor((innerWidth - cardGap * (cardCount - 1)) / cardCount);
  const cardHeight = stacked
    ? Math.floor((cardsHeight - cardGap * (cardCount - 1)) / cardCount)
    : cardsHeight;
  const cards = Array.from({ length: cardCount }, (_, index) => ({
    left: stacked ? innerLeft : innerLeft + index * (cardWidth + cardGap),
    top: stacked ? cardsTop + index * (cardHeight + cardGap) : cardsTop,
    width: cardWidth,
    height: cardHeight,
  }));
  const ctaWidth = Math.min(
    innerWidth,
    Math.max(Math.round(innerWidth * 0.38), Math.round(minimumSide * 0.32))
  );
  return {
    margin,
    panelLeft,
    panelTop,
    panelWidth,
    panelHeight,
    padding,
    innerLeft,
    innerWidth,
    eyebrowSize,
    eyebrowTop,
    titleSize,
    titleLineHeight,
    titleFirstTop,
    gap,
    cards,
    ctaHeight,
    ctaTop,
    ctaWidth,
    ctaLeft: innerLeft,
    offerFontSize: Math.max(20, Math.round(minimumSide * (portrait ? 0.038 : 0.044))),
    ctaFontSize: Math.max(16, Math.round(minimumSide * 0.027)),
  };
}

function flyerBackdropSvg(
  args: RenderBaseArgs,
  layout: FlyerLayout
) {
  const cardShapes = layout.cards
    .map(
      (card, index) => `
        <rect x="${card.left}" y="${card.top}" width="${card.width}" height="${card.height}"
          rx="${Math.round(layout.gap * 0.9)}" fill="#0b1426" fill-opacity="0.9"
          stroke="${args.colors[index % args.colors.length]}" stroke-width="${Math.max(
            2,
            Math.round(layout.margin * 0.07)
          )}"/>
        <rect x="${card.left}" y="${card.top}" width="${Math.max(
          6,
          Math.round(layout.margin * 0.18)
        )}" height="${card.height}" rx="${Math.max(
          3,
          Math.round(layout.margin * 0.09)
        )}" fill="${args.colors[index % args.colors.length]}"/>
      `
    )
    .join("");
  return Buffer.from(`
    <svg width="${args.width}" height="${args.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pageShade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#020617" stop-opacity="0.64"/>
          <stop offset="1" stop-color="#020617" stop-opacity="0.82"/>
        </linearGradient>
        <linearGradient id="brandLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="${args.colors[0]}"/>
          <stop offset="0.5" stop-color="${args.colors[1]}"/>
          <stop offset="1" stop-color="${args.colors[2]}"/>
        </linearGradient>
      </defs>
      <rect width="${args.width}" height="${args.height}" fill="url(#pageShade)"/>
      <rect x="${layout.panelLeft}" y="${layout.panelTop}" width="${layout.panelWidth}"
        height="${layout.panelHeight}" rx="${Math.round(layout.margin * 0.75)}"
        fill="#071225" fill-opacity="0.88" stroke="#ffffff" stroke-opacity="0.16"/>
      <rect x="${layout.innerLeft}" y="${layout.panelTop + layout.padding * 0.55}"
        width="${Math.max(50, Math.round(layout.innerWidth * 0.15))}" height="${Math.max(
          5,
          Math.round(layout.margin * 0.12)
        )}" rx="4" fill="url(#brandLine)"/>
      ${cardShapes}
      <rect x="${layout.ctaLeft}" y="${layout.ctaTop}" width="${layout.ctaWidth}"
        height="${layout.ctaHeight}" rx="${Math.round(layout.ctaHeight / 2)}"
        fill="url(#brandLine)"/>
    </svg>
  `);
}

/**
 * Un flyer ne peut pas être une photographie avec une légende générique.
 * Cette composition déterministe construit la hiérarchie commerciale après
 * le fournisseur : titre, offres, CTA, couleurs et logo restent ainsi exacts.
 */
export async function renderAiMediaFlyerOverlay(
  args: RenderBaseArgs & {
    scene: AiMediaCreativeScene;
    withText: boolean;
    copy?: AiMediaImageCompositionCopy;
  }
) {
  const transparent = await sharp({
    create: {
      width: args.width,
      height: args.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  if (!args.withText) {
    const overlays = await buildBrandOverlays({
      ...args,
      copyOverlay: transparent,
    });
    return await sharp(transparent).composite(overlays).png().toBuffer();
  }

  const headline = args.copy?.headline || args.scene.title;
  const subline = args.copy?.subline || args.scene.body;
  const cta = args.copy?.cta || "";
  const offers = splitFlyerOffers(subline);
  const titleLines = wrapAiMediaOverlayText(
    headline,
    args.height > args.width * 1.12 ? 24 : 38,
    2
  );
  const layout = resolveFlyerLayout({
    width: args.width,
    height: args.height,
    titleLineCount: titleLines.length,
    offerCount: offers.length,
  });
  const flyerLayers = await Promise.all([
    rasterTextLayer({
      text: (args.scene.eyebrow || args.companyName).toLocaleUpperCase(),
      fontSize: layout.eyebrowSize,
      fontWeight: 700,
      color: "#dbeafe",
      left: layout.innerLeft,
      top: layout.eyebrowTop,
      maxWidth: layout.innerWidth,
    }),
    ...titleLines.map((line, index) =>
      rasterTextLayer({
        text: line,
        fontSize: layout.titleSize,
        fontWeight: 800,
        color: "#ffffff",
        left: layout.innerLeft,
        top: layout.titleFirstTop + index * layout.titleLineHeight,
        maxWidth: layout.innerWidth,
      })
    ),
    ...layout.cards.map((card, index) =>
      rasterTextLayer({
        text: offers[index] || subline,
        fontSize: layout.offerFontSize,
        fontWeight: 700,
        color: "#ffffff",
        left: card.left + layout.gap * 1.35,
        top:
          card.top +
          Math.max(layout.gap, Math.round((card.height - layout.offerFontSize) / 2)),
        maxWidth: card.width - layout.gap * 2.1,
      })
    ),
    rasterTextLayer({
      text: cta,
      fontSize: layout.ctaFontSize,
      fontWeight: 800,
      color: "#ffffff",
      left: layout.ctaLeft + layout.gap,
      top:
        layout.ctaTop +
        Math.max(4, Math.round((layout.ctaHeight - layout.ctaFontSize) / 2)),
      maxWidth: layout.ctaWidth - layout.gap * 2,
    }),
  ]);
  const copyOverlay = await sharp(transparent)
    .composite([
      { input: flyerBackdropSvg(args, layout), left: 0, top: 0 },
      ...flyerLayers.filter((layer): layer is NonNullable<typeof layer> =>
        Boolean(layer)
      ),
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const overlays = await buildBrandOverlays({ ...args, copyOverlay });
  return await sharp(transparent)
    .composite(overlays)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function buildBrandOverlays(
  args: RenderBaseArgs & {
    copyOverlay: Buffer;
  }
) {
  const overlays: Array<{ input: Buffer; top?: number; left?: number }> = [
    { input: args.copyOverlay, top: 0, left: 0 },
  ];
  if (args.logoMode === "none") return overlays;

  const preparedLogo = await prepareLogo(
    args.logo,
    args.width,
    args.height,
    args.logoMode
  );
  if (!preparedLogo) return overlays;

  // La copie éditoriale occupe la zone basse. Le logo reste donc dans le
  // coin supérieur droit, à taille discrète et avec une marge sûre de 4,5 %.
  // Il est posé directement avec son alpha : aucune pastille blanche n'est
  // ajoutée et le sujet central demeure dégagé.
  const { logo: logoLayout } = resolveAiMediaVideoOverlayLayout(args);
  overlays.push({
    input: preparedLogo.buffer,
    left: Math.max(0, args.width - logoLayout.marginX - preparedLogo.width),
    top: logoLayout.marginY,
  });
  return overlays;
}

/**
 * Calque PNG exact appliqué après la génération vidéo : l'IA ne dessine
 * jamais le logo ni les textes de marque. Cela évite les pseudo-logos et
 * garantit un habillage net, identique sur tous les fournisseurs vidéo.
 */
export async function renderAiMediaVideoOverlay(
  args: RenderBaseArgs & {
    scene: AiMediaCreativeScene;
    withText: boolean;
  }
) {
  const transparent = await sharp({
    create: {
      width: args.width,
      height: args.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
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

/**
 * Compose les éléments lisibles d'une image après la génération du fond.
 * Le fournisseur d'images ne dessine ainsi aucune lettre : iNrCy maîtrise
 * exactement les mots, les retours à la ligne, les marges et le logo.
 */
export async function composeAiMediaBrandedImage(
  args: RenderBaseArgs & {
    input: Buffer;
    scene: AiMediaCreativeScene;
    withText: boolean;
    copy?: AiMediaImageCompositionCopy;
  }
) {
  const overlay =
    args.imagePurpose === "flyer"
      ? await renderAiMediaFlyerOverlay(args)
      : await renderAiMediaVideoOverlay(args);
  return await sharp(args.input, {
    failOn: "error",
    limitInputPixels: 50_000_000,
    pages: 1,
  })
    .rotate()
    .resize(args.width, args.height, {
      fit: "cover",
      position: "centre",
    })
    .composite([{ input: overlay, left: 0, top: 0 }])
    .toColourspace("srgb")
    .jpeg({
      quality: 90,
      mozjpeg: true,
      progressive: true,
      chromaSubsampling: "4:2:0",
      optimiseCoding: true,
      optimiseScans: true,
    })
    .toBuffer();
}
