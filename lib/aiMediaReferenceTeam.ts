import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

import type {
  AiMediaInspirationImage,
  AiMediaVideoDuration,
} from "@/lib/aiMediaGenerationContracts";
import { getAiMediaVideoSegmentDurations } from "@/lib/aiMediaVideoTimeline";
import type { AiVideoProviderResult } from "@/lib/aiVideoProviderTypes";
import {
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
} from "@/lib/mediaVideoNormalizer";

const execFileAsync = promisify(execFile);
const MAX_FALLBACK_CLIP_BYTES = 48 * 1024 * 1024;
type CompositeLayer = { input: Buffer; left: number; top: number };

function safeHex(value: unknown, fallback: string) {
  const candidate = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function roundedRectangle(width: number, height: number, radius: number) {
  return Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/></svg>`,
  );
}

async function renderReferenceCard(args: {
  input: Buffer;
  width: number;
  height: number;
  radius: number;
}) {
  // Ne jamais réutiliser le portrait comme fond flouté : un visage encore
  // reconnaissable pourrait apparaître deux fois. Le fond de carte est donc
  // purement graphique et le fichier autorisé n'est rendu qu'une seule fois.
  const cardBackground = Buffer.from(
    `<svg width="${args.width}" height="${args.height}" viewBox="0 0 ${args.width} ${args.height}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs>
      <rect width="${args.width}" height="${args.height}" fill="url(#card)"/>
    </svg>`,
  );
  const foreground = await sharp(args.input, {
    failOn: "error",
    limitInputPixels: 20_000_000,
    pages: 1,
  })
    .rotate()
    .resize(args.width, args.height, {
      fit: "contain",
      position: "centre",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const card = await sharp(cardBackground)
    .composite([{ input: foreground, blend: "over" }])
    .png()
    .toBuffer();
  return await sharp(card)
    .composite([
      {
        input: roundedRectangle(args.width, args.height, args.radius),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
}

/**
 * Composition locale de sécurité : chaque fichier reste une personne distincte
 * et apparaît exactement une fois. Le visage n'est ni synthétisé ni remplacé.
 * Les références sont déjà passées par `prepareAiMediaIdentityReferences` et
 * cette fonction ne les écrit que dans un répertoire temporaire pour FFmpeg.
 */
async function createReferenceMontage(args: {
  references: readonly Buffer[];
  width: number;
  height: number;
  brandColors?: readonly string[];
  officialLogo?: Buffer | null;
}): Promise<Buffer> {
  if (args.references.length < 1 || args.references.length > 3) {
    throw new Error("ai_reference_identity_count_invalid");
  }
  const width = Math.max(320, Math.min(2_048, Math.trunc(args.width)));
  const height = Math.max(320, Math.min(2_048, Math.trunc(args.height)));
  const colorA = safeHex(args.brandColors?.[0], "#0b2f52");
  const colorB = safeHex(args.brandColors?.[1], "#6d28d9");
  const colorC = safeHex(args.brandColors?.[2], "#db2777");
  const margin = Math.max(24, Math.round(width * 0.035));
  const gap = Math.max(14, Math.round(width * 0.018));
  const availableCardWidth = Math.floor(
    (width - margin * 2 - gap * (args.references.length - 1)) /
      args.references.length,
  );
  const cardWidth = args.references.length === 1
    ? Math.min(availableCardWidth, Math.round(width * 0.76))
    : availableCardWidth;
  const cardHeight = Math.min(
    height - margin * 2,
    Math.max(Math.round(height * 0.68), Math.round(cardWidth * 1.32)),
  );
  const cardTop = Math.round((height - cardHeight) / 2);
  const radius = Math.max(18, Math.round(Math.min(cardWidth, cardHeight) * 0.075));
  const background = Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colorA}"/><stop offset="0.52" stop-color="${colorB}"/><stop offset="1" stop-color="${colorC}"/></linearGradient>
        <radialGradient id="halo"><stop stop-color="#ffffff" stop-opacity=".22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.2)}" r="${Math.round(Math.min(width, height) * 0.38)}" fill="url(#halo)"/>
      <circle cx="${Math.round(width * 0.82)}" cy="${Math.round(height * 0.78)}" r="${Math.round(Math.min(width, height) * 0.42)}" fill="url(#halo)"/>
    </svg>`,
  );
  const cards = await Promise.all(
    args.references.map((input) =>
      renderReferenceCard({
        input,
        width: cardWidth,
        height: cardHeight,
        radius,
      }),
    ),
  );
  const rowWidth =
    cardWidth * args.references.length + gap * (args.references.length - 1);
  const rowLeft = Math.round((width - rowWidth) / 2);
  const composites: CompositeLayer[] = cards.map((input, index) => ({
    input,
    left: rowLeft + index * (cardWidth + gap),
    top: cardTop,
  }));
  if (args.officialLogo?.byteLength) {
    const logoMaxWidth = Math.max(72, Math.round(width * 0.12));
    const logoMaxHeight = Math.max(48, Math.round(height * 0.075));
    const logo = await sharp(args.officialLogo, {
      failOn: "error",
      limitInputPixels: 20_000_000,
      pages: 1,
    })
      .rotate()
      .resize({
        width: logoMaxWidth,
        height: logoMaxHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    const metadata = await sharp(logo).metadata();
    composites.push({
      input: logo,
      left: Math.max(margin, width - margin - (metadata.width || logoMaxWidth)),
      top: Math.max(margin, height - margin - (metadata.height || logoMaxHeight)),
    });
  }
  return await sharp(background)
    .composite(composites)
    .webp({ quality: 92, effort: 4 })
    .toBuffer();
}

export async function createReferenceTeamMontage(args: {
  references: readonly Buffer[];
  width: number;
  height: number;
  brandColors?: readonly string[];
  officialLogo?: Buffer | null;
}): Promise<Buffer> {
  if (args.references.length < 2 || args.references.length > 3) {
    throw new Error("ai_reference_team_count_invalid");
  }
  return await createReferenceMontage(args);
}

export async function createReferenceIdentityMontage(args: {
  references: readonly Buffer[];
  width: number;
  height: number;
  brandColors?: readonly string[];
  officialLogo?: Buffer | null;
}): Promise<Buffer> {
  return await createReferenceMontage(args);
}

function escapeXml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function compactLines(value: unknown, maxCharacters: number) {
  const words = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .split(" ")
    .filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines[lines.length - 1] || "";
    if (!current || `${current} ${word}`.length <= maxCharacters) {
      if (lines.length) lines[lines.length - 1] = `${current} ${word}`.trim();
      else lines.push(word);
    } else if (lines.length < 3) {
      lines.push(word);
    }
    if (lines.length === 3 && lines[2].length >= maxCharacters) break;
  }
  return lines.slice(0, 3);
}

/** Motion-graphic de marque sans aucune personne synthétique. */
export async function createBrandMotionFrame(args: {
  width: number;
  height: number;
  brandColors?: readonly string[];
  officialLogo?: Buffer | null;
  companyName?: string;
  headline?: string;
}): Promise<Buffer> {
  const width = Math.max(320, Math.min(2_048, Math.trunc(args.width)));
  const height = Math.max(320, Math.min(2_048, Math.trunc(args.height)));
  const colorA = safeHex(args.brandColors?.[0], "#073b5c");
  const colorB = safeHex(args.brandColors?.[1], "#5732b8");
  const colorC = safeHex(args.brandColors?.[2], "#d92e88");
  const headlineLines = compactLines(args.headline, width > height ? 34 : 24);
  const fontSize = Math.max(34, Math.round(Math.min(width, height) * 0.075));
  const lineHeight = Math.round(fontSize * 1.16);
  const textTop = Math.round(height * 0.47);
  const headlineSvg = headlineLines
    .map(
      (line, index) =>
        `<text x="${Math.round(width * 0.08)}" y="${textTop + index * lineHeight}" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="700" fill="#fff">${escapeXml(line)}</text>`,
    )
    .join("");
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colorA}"/><stop offset=".56" stop-color="${colorB}"/><stop offset="1" stop-color="${colorC}"/></linearGradient>
        <radialGradient id="g"><stop stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.22)}" r="${Math.round(Math.min(width, height) * 0.45)}" fill="url(#g)"/>
      <path d="M0 ${Math.round(height * 0.82)} C ${Math.round(width * 0.28)} ${Math.round(height * 0.62)}, ${Math.round(width * 0.64)} ${Math.round(height * 1.05)}, ${width} ${Math.round(height * 0.72)} L ${width} ${height} L0 ${height} Z" fill="#fff" opacity=".08"/>
      ${headlineSvg}
      ${args.companyName ? `<text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.88)}" font-family="Arial,Helvetica,sans-serif" font-size="${Math.max(22, Math.round(fontSize * 0.46))}" font-weight="600" fill="#fff" opacity=".84">${escapeXml(String(args.companyName).slice(0, 80))}</text>` : ""}
    </svg>`,
  );
  const composites: CompositeLayer[] = [];
  if (args.officialLogo?.byteLength) {
    try {
      const logo = await sharp(args.officialLogo, {
        failOn: "error",
        limitInputPixels: 20_000_000,
        pages: 1,
      })
        .rotate()
        .resize({
          width: Math.round(width * 0.2),
          height: Math.round(height * 0.16),
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      composites.push({ input: logo, left: Math.round(width * 0.08), top: Math.round(height * 0.1) });
    } catch {
      // Un logo ancien corrompu ne doit pas faire échouer le filet de sécurité.
    }
  }
  return await sharp(svg)
    .composite(composites)
    .webp({ quality: 92, effort: 4 })
    .toBuffer();
}

export async function prepareReferenceTeamCompositionForAnimation(
  image: Buffer,
): Promise<AiMediaInspirationImage> {
  const { data, info } = await sharp(image, {
    failOn: "error",
    limitInputPixels: 20_000_000,
    pages: 1,
    sequentialRead: true,
  })
    .rotate()
    .resize({
      width: 1_280,
      height: 1_280,
      fit: "inside",
      withoutEnlargement: true,
    })
    // Sharp supprime EXIF/IPTC/XMP/GPS tant que `withMetadata()` n'est pas
    // appelé. La composition éphémère transmise au moteur vidéo est donc
    // assainie exactement comme les références initiales.
    .webp({ quality: 92, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  if (
    !data.byteLength ||
    data.byteLength > 4 * 1024 * 1024 ||
    info.format !== "webp" ||
    info.width > 1_280 ||
    info.height > 1_280
  ) {
    throw new Error("ai_reference_team_precomposition_invalid");
  }
  return { mimeType: "image/webp", data: data.toString("base64") };
}

/**
 * Dernier filet de sécurité : transforme le montage fidèle en vrais clips MP4
 * par mouvement Ken Burns. Aucune personne artificielle n'est introduite.
 */
export async function createAiMediaFallbackVideo(args: {
  montage: Buffer;
  width: number;
  height: number;
  durationSeconds: AiMediaVideoDuration;
  signal?: AbortSignal;
}): Promise<AiVideoProviderResult> {
  args.signal?.throwIfAborted();
  const durations = getAiMediaVideoSegmentDurations(args.durationSeconds);
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "inrcy-media-fallback-"),
  );
  try {
    const imagePath = path.join(temporaryDirectory, "frame.webp");
    await writeFile(imagePath, args.montage);
    const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
    const clips: AiVideoProviderResult["clips"] = [];
    // Exécution séquentielle : sur les petites instances Vercel, trois FFmpeg
    // 1080p simultanés peuvent épuiser la mémoire et transformer le filet de
    // sécurité en nouvelle panne.
    for (const [index, durationSeconds] of durations.entries()) {
        args.signal?.throwIfAborted();
        const outputPath = path.join(temporaryDirectory, `motion-${index}.mp4`);
        const frameCount = durationSeconds * 30;
        const zoomStep = index % 2 === 0 ? "0.00032" : "0.00024";
        const command = [
          "-hide_banner",
          "-nostdin",
          "-y",
          "-loop",
          "1",
          "-framerate",
          "30",
          "-i",
          imagePath,
          "-vf",
          `scale=${args.width}:${args.height}:force_original_aspect_ratio=increase,crop=${args.width}:${args.height},zoompan=z='min(zoom+${zoomStep},1.075)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${args.width}x${args.height}:fps=30,format=yuv420p`,
          "-frames:v",
          String(frameCount),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "21",
          "-profile:v",
          "high",
          "-level",
          "4.1",
          "-pix_fmt",
          "yuv420p",
          "-r",
          "30",
          "-an",
          "-movflags",
          "+faststart",
          "-map_metadata",
          "-1",
          outputPath,
        ];
        await execFileAsync(ffmpegPath, command, {
          timeout: 180_000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          signal: args.signal,
        });
        const [buffer, metadata, outputStats] = await Promise.all([
          readFile(outputPath),
          probeVideoSource({
            ffmpegPath,
            inputPath: outputPath,
            timeoutMs: 45_000,
          }),
          stat(outputPath),
        ]);
        if (
          !buffer.byteLength ||
          outputStats.size > MAX_FALLBACK_CLIP_BYTES ||
          metadata.orientedWidth !== args.width ||
          metadata.orientedHeight !== args.height ||
          Math.abs(metadata.durationSeconds - durationSeconds) > 0.35 ||
          !["h264", "avc1"].includes(String(metadata.videoCodec).toLowerCase())
        ) {
          throw new Error("ai_reference_team_fallback_clip_invalid");
        }
        clips.push({
          buffer,
          mediaType: "video/mp4",
          durationSeconds,
          requestId: `local-media-fallback-${index + 1}`,
          model: "inrcy/local-motion-v1",
          warnings: ["provider_unavailable_local_motion_fallback"],
        });
    }
    args.signal?.throwIfAborted();
    return {
      provider: "inrcy-local-motion",
      model: "inrcy/local-motion-v1",
      clips,
      estimatedCostMicroUsd: 0,
      warnings: ["provider_unavailable_local_motion_fallback"],
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

export async function createReferenceTeamFallbackVideo(args: {
  montage: Buffer;
  width: number;
  height: number;
  durationSeconds: AiMediaVideoDuration;
  signal?: AbortSignal;
}): Promise<AiVideoProviderResult> {
  const result = await createAiMediaFallbackVideo(args);
  return {
    ...result,
    provider: "inrcy-reference-team-local",
    model: "inrcy/reference-team-motion-v1",
    clips: result.clips.map((clip, index) => ({
      ...clip,
      requestId: `local-reference-team-${index + 1}`,
      model: "inrcy/reference-team-motion-v1",
      warnings: ["identity_team_exact_photo_motion_fallback"],
    })),
    warnings: ["identity_team_exact_photo_motion_fallback"],
  };
}
