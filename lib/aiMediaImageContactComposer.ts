import "server-only";

import sharp from "sharp";

import type { AiMediaLogoMode } from "@/lib/aiMediaGenerationContracts";
import { dialCtaPhone, parseCtaPhoneNumbers } from "./ctaPhoneNumbers.ts";

type CompositeLayer = { input: Buffer; left: number; top: number };

function safeHex(value: unknown, fallback: string) {
  const candidate = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapWholeWords(value: unknown, maxCharacters: number) {
  const words = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1) || "";
    if (!current || `${current} ${word}`.length <= maxCharacters) {
      if (lines.length) lines[lines.length - 1] = `${current} ${word}`.trim();
      else lines.push(word);
    } else {
      lines.push(word);
    }
  }
  return lines;
}

/**
 * Ajoute localement l'accroche et le téléphone exacts sur un fond généré sans
 * texte. Le numéro ne quitte donc jamais iNrCy et le moteur ne peut ni
 * l'inventer ni altérer un nom propre présent dans l'accroche.
 */
export async function composeAiMediaContactImage(args: {
  input: Buffer;
  width: number;
  height: number;
  headline?: string;
  phone?: string;
  officialLogo?: Buffer | null;
  requireLogo?: boolean;
  logoMode: AiMediaLogoMode;
  brandColors?: readonly string[];
}) {
  const width = Math.max(320, Math.min(2_048, Math.trunc(args.width)));
  const height = Math.max(320, Math.min(2_048, Math.trunc(args.height)));
  const isTall = height / width >= 1.25;
  const margin = Math.round(width * 0.062);
  const panelWidth = isTall ? width : Math.round(width * 0.53);
  const panelTop = isTall ? Math.round(height * 0.5) : 0;
  const panelHeight = height - panelTop;
  const colorA = safeHex(args.brandColors?.[0], "#21b8ef");
  const colorB = safeHex(args.brandColors?.[1], "#8b5cf6");
  const colorC = safeHex(args.brandColors?.[2], "#e94aa5");
  const headline = String(args.headline ?? "").replace(/\s+/g, " ").trim();
  const phoneNumbers = parseCtaPhoneNumbers(args.phone);
  const headlineFont = Math.max(
    34,
    Math.round((isTall ? width : Math.min(width, height)) * (isTall ? 0.061 : 0.052)),
  );
  const headlineLines = wrapWholeWords(
    headline,
    isTall ? 24 : width > height ? 31 : 22,
  );
  const lineHeight = Math.round(headlineFont * 1.13);
  const headlineTop = isTall
    ? Math.round(height * 0.655)
    : Math.round(height * 0.3);
  const headlineSvg = headlineLines
    .map(
      (line, index) =>
        `<text x="${margin}" y="${headlineTop + index * lineHeight}" font-family="Arial,Helvetica,sans-serif" font-size="${headlineFont}" font-weight="700" letter-spacing="-.6" fill="#fff" stroke="#020617" stroke-opacity=".18" stroke-width="2" paint-order="stroke">${escapeXml(line)}</text>`,
    )
    .join("");

  const phoneAvailableWidth = Math.min(width - margin * 2, Math.max(240, panelWidth - margin * 2));
  const preferredPhoneFont = Math.max(24, Math.round(Math.min(width, height) * 0.029));
  // One complete number per line; never shrink two joined numbers into an
  // unreadable line or clip the second one outside the contact plate.
  const phoneLines = phoneNumbers.map(number => `TEL  ${(number.length + 4) * 14 * 0.65 + 14 * 3.2 > phoneAvailableWidth ? dialCtaPhone(number) : number}`);
  const phoneText = phoneLines.toSorted((a, b) => b.length - a.length)[0] || "";
  const fittedPhoneFont = phoneText
    ? Math.max(
        14,
        Math.min(
          preferredPhoneFont,
          Math.floor(phoneAvailableWidth / (phoneText.length * 0.65 + 3.2)),
        ),
      )
    : preferredPhoneFont;
  const phonePillWidth = phoneText
    ? Math.min(
        phoneAvailableWidth,
        Math.round(phoneText.length * fittedPhoneFont * 0.65 + fittedPhoneFont * 3.2),
      )
    : 0;
  const phoneRowHeight = Math.round(fittedPhoneFont * 2.05);
  const phoneLineHeight = Math.round(fittedPhoneFont * 1.3);
  const phonePillHeight = phoneRowHeight + Math.max(0, phoneLines.length - 1) * phoneLineHeight;
  const afterHeadline = headlineLines.length
    ? headlineTop + (headlineLines.length - 1) * lineHeight + Math.round(headlineFont * 0.75)
    : 0;
  const preferredPhoneTop = isTall
    ? Math.round(height * 0.85)
    : Math.round(height * 0.72);
  const phoneTop = phoneText
    ? Math.min(
        height - margin - phonePillHeight,
        Math.max(preferredPhoneTop, afterHeadline),
      )
    : 0;
  const phoneSvg = phoneText
    ? `<rect x="${margin}" y="${phoneTop}" width="${phonePillWidth}" height="${phonePillHeight}" rx="${Math.round(phoneRowHeight / 2)}" fill="#020617" fill-opacity=".76" stroke="#fff" stroke-opacity=".25"/>
       <circle cx="${margin + Math.round(phoneRowHeight * 0.52)}" cy="${phoneTop + Math.round(phoneRowHeight / 2)}" r="${Math.round(fittedPhoneFont * 0.48)}" fill="${colorA}"/>
       <path d="M ${margin + Math.round(phoneRowHeight * 0.38)} ${phoneTop + Math.round(phoneRowHeight * 0.39)} C ${margin + Math.round(phoneRowHeight * 0.43)} ${phoneTop + Math.round(phoneRowHeight * 0.63)}, ${margin + Math.round(phoneRowHeight * 0.58)} ${phoneTop + Math.round(phoneRowHeight * 0.7)}, ${margin + Math.round(phoneRowHeight * 0.66)} ${phoneTop + Math.round(phoneRowHeight * 0.61)}" fill="none" stroke="#fff" stroke-width="${Math.max(3, Math.round(fittedPhoneFont * 0.13))}" stroke-linecap="round"/>
       ${phoneLines.map((line, index) => `<text x="${margin + Math.round(phoneRowHeight * 0.96)}" y="${phoneTop + Math.round(phoneRowHeight * 0.66) + index * phoneLineHeight}" font-family="Arial,Helvetica,sans-serif" font-size="${fittedPhoneFont}" font-weight="700" letter-spacing=".4" fill="#fff">${escapeXml(line)}</text>`).join("")}`
    : "";

  const logoVisible = args.logoMode !== "none" && Boolean(args.officialLogo?.byteLength);
  if (args.requireLogo && !logoVisible) throw new Error("ai_media_required_logo_not_composed");
  const logoAreaWidth = Math.round(
    width * (args.logoMode === "visible" ? (isTall ? 0.27 : 0.22) : isTall ? 0.21 : 0.17),
  );
  const logoAreaHeight = Math.round(height * (isTall ? 0.075 : 0.12));
  const logoLeft = isTall
    ? width - margin - logoAreaWidth
    : margin;
  const logoTop = isTall ? Math.round(height * 0.055) : Math.round(height * 0.075);
  const logoPlate = logoVisible
    ? `<rect x="${logoLeft - Math.round(margin * 0.25)}" y="${logoTop - Math.round(margin * 0.18)}" width="${logoAreaWidth + Math.round(margin * 0.5)}" height="${logoAreaHeight + Math.round(margin * 0.36)}" rx="${Math.round(Math.min(width, height) * 0.018)}" fill="#fff" fill-opacity=".94"/>`
    : "";

  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="${isTall ? 0 : 1}" y2="${isTall ? 1 : 0}">
          <stop stop-color="#020617" stop-opacity="${isTall ? 0 : 0.9}"/>
          <stop offset=".72" stop-color="#0f172a" stop-opacity="${isTall ? 0.78 : 0.66}"/>
          <stop offset="1" stop-color="#020617" stop-opacity="${isTall ? 0.94 : 0}"/>
        </linearGradient>
        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${colorA}"/><stop offset=".5" stop-color="${colorB}"/><stop offset="1" stop-color="${colorC}"/></linearGradient>
      </defs>
      <rect x="0" y="${panelTop}" width="${panelWidth}" height="${panelHeight}" fill="url(#shade)"/>
      <rect x="${margin}" y="${headlineTop - Math.round(headlineFont * 1.08)}" width="${Math.round(Math.min(panelWidth - margin * 2, width * 0.15))}" height="${Math.max(5, Math.round(headlineFont * 0.09))}" rx="4" fill="url(#accent)"/>
      ${logoPlate}
      ${headlineSvg}
      ${phoneSvg}
    </svg>`,
  );

  const composites: CompositeLayer[] = [{ input: overlay, left: 0, top: 0 }];
  if (logoVisible && args.officialLogo) {
    try {
      const renderedLogo = await sharp(args.officialLogo, {
        failOn: "error",
        limitInputPixels: 20_000_000,
        pages: 1,
      })
        .rotate()
        .resize({
          width: logoAreaWidth,
          height: logoAreaHeight,
          fit: "inside",
          withoutEnlargement: false,
        })
        .png()
        .toBuffer({ resolveWithObject: true });
      composites.push({
        input: renderedLogo.data,
        left: logoLeft + Math.round((logoAreaWidth - renderedLogo.info.width) / 2),
        top: logoTop + Math.round((logoAreaHeight - renderedLogo.info.height) / 2),
      });
    } catch (error) {
      if (args.requireLogo) throw new Error("ai_media_required_logo_not_composed", { cause: error });
      // Un ancien logo illisible ne doit jamais annuler l'image ni le numéro.
    }
  }

  return await sharp(args.input, {
    failOn: "error",
    limitInputPixels: 50_000_000,
    pages: 1,
  })
    .rotate()
    .resize(width, height, {
      fit: "cover",
      position: "centre",
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .composite(composites)
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
