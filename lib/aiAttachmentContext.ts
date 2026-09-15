import "server-only";
import { inflateRawSync, inflateSync } from "zlib";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import type { AiPreferredEngine } from "@/lib/aiEnginePreference";
import type { MailAttachmentRef } from "@/lib/mailAttachmentRefs";

const DEFAULT_MAX_FILES = 4;
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_CHARS = 6500;
const DEFAULT_MAX_CHARS_PER_FILE = 2200;

type BuildAttachmentAiContextOptions = {
  userId?: string | null;
  engine: AiPreferredEngine;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalChars?: number;
  maxCharsPerFile?: number;
};

export type AttachmentExtract = {
  name: string;
  mimeType: string;
  size: number | null;
  status: "analysed" | "metadata_only" | "ignored" | "error";
  text: string;
  note?: string;
};

const DEFAULT_MAX_VISUAL_FILES = 2;
const DEFAULT_MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type VisualAttachmentSummary = {
  summary: string;
  note?: string;
};

function clean(value: unknown, max = 600) {
  return String(value ?? "").trim().slice(0, max);
}

function formatBytes(value: number | null | undefined) {
  if (!value || value <= 0) return "taille inconnue";
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}

function isSafeStorageRef(ref: MailAttachmentRef) {
  const bucket = clean(ref.bucket, 120);
  const path = clean(ref.path, 1000);
  if (!bucket || !path) return false;
  if (!/^[a-zA-Z0-9._-]+$/.test(bucket)) return false;
  if (path.startsWith("/") || path.includes("..") || /[\u0000-\u001f]/.test(path)) return false;
  return true;
}

function normalizeExtractedText(value: string, maxChars = DEFAULT_MAX_CHARS_PER_FILE) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars)
    .trim();
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function decodePdfLiteral(raw: string) {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (!next) continue;
    i += 1;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\n";
    else if (next === "t") out += "\t";
    else if (next === "b" || next === "f") out += " ";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (/[0-7]/.test(next)) {
      let oct = next;
      for (let j = 0; j < 2 && /[0-7]/.test(raw[i + 1] || ""); j += 1) {
        oct += raw[i + 1];
        i += 1;
      }
      out += String.fromCharCode(parseInt(oct, 8));
    } else {
      out += next;
    }
  }
  return out;
}

function decodePdfHex(hexRaw: string) {
  const hex = hexRaw.replace(/\s+/g, "");
  if (hex.length < 4 || hex.length % 2 !== 0) return "";
  const bytes = Buffer.from(hex, "hex");
  if (!bytes.length) return "";

  const hasUtf16Marker = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
  const hasManyNulls = bytes.slice(0, Math.min(bytes.length, 24)).some((b, index) => index % 2 === 0 && b === 0);
  if (hasUtf16Marker || hasManyNulls) {
    const start = hasUtf16Marker ? 2 : 0;
    let out = "";
    for (let i = start; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) + bytes[i + 1]);
    }
    return out;
  }

  return bytes.toString("utf8");
}

function extractPdfStrings(pdfSource: string) {
  const snippets: string[] = [];
  const literalRe = /\((?:\\.|[^\\)]){2,}\)/g;
  for (const match of pdfSource.matchAll(literalRe)) {
    const decoded = decodePdfLiteral(match[0].slice(1, -1));
    if (/[A-Za-zÀ-ÿ0-9]/.test(decoded)) snippets.push(decoded);
  }

  const hexRe = /<([0-9A-Fa-f\s]{6,})>/g;
  for (const match of pdfSource.matchAll(hexRe)) {
    const decoded = decodePdfHex(match[1] || "");
    if (/[A-Za-zÀ-ÿ0-9]/.test(decoded)) snippets.push(decoded);
  }

  const seen = new Set<string>();
  const unique = snippets
    .map((v) => v.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((v) => v.length >= 3 && /[A-Za-zÀ-ÿ]/.test(v))
    .filter((v) => {
      const key = v.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return unique.join("\n");
}

function extractPdfText(buffer: Buffer) {
  const source = buffer.toString("latin1");
  const pieces: string[] = [extractPdfStrings(source)];

  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of source.matchAll(streamRe)) {
    const streamRaw = match[1] || "";
    if (!streamRaw) continue;
    const matchIndex = typeof match.index === "number" ? match.index : 0;
    const before = source.slice(Math.max(0, matchIndex - 420), matchIndex);
    const streamBuffer = Buffer.from(streamRaw, "latin1");
    const candidates: Buffer[] = [];

    if (/FlateDecode/i.test(before)) {
      try { candidates.push(inflateSync(streamBuffer)); } catch {}
      try { candidates.push(inflateRawSync(streamBuffer)); } catch {}
    } else {
      candidates.push(streamBuffer);
    }

    for (const candidate of candidates) {
      const text = extractPdfStrings(candidate.toString("latin1"));
      if (text) pieces.push(text);
    }
  }

  return normalizeExtractedText(pieces.filter(Boolean).join("\n"));
}

function extractZipEntry(buffer: Buffer, wanted: Set<string>) {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) break;

    const name = buffer.slice(nameStart, nameStart + fileNameLength).toString("utf8");
    if (wanted.has(name)) {
      const data = buffer.slice(dataStart, dataEnd);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      return null;
    }

    offset = dataEnd;
  }
  return null;
}

function extractDocxText(buffer: Buffer) {
  const xml = extractZipEntry(buffer, new Set(["word/document.xml"]));
  if (!xml) return "";
  const value = xml.toString("utf8")
    .replace(/<w:tab\s*\/?>(?:<\/w:tab>)?/gi, " ")
    .replace(/<w:br\s*\/?>(?:<\/w:br>)?/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return normalizeExtractedText(decodeXmlEntities(value));
}


function isImageAttachment(name: string, mimeType: string) {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  return lowerMime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lowerName);
}

function isVideoAttachment(name: string, mimeType: string) {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  return lowerMime.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(lowerName);
}

function bufferToDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType || "application/octet-stream"};base64,${buffer.toString("base64")}`;
}

async function summarizeImageWithVision(
  name: string,
  mimeType: string,
  buffer: Buffer,
  engine: AiPreferredEngine,
  accountId?: string | null,
): Promise<VisualAttachmentSummary | null> {
  if (buffer.length > DEFAULT_MAX_IMAGE_BYTES) {
    return { summary: "", note: "image trop volumineuse pour analyse visuelle IA" };
  }

  try {
    const result = await aiGenerateJSON<{ summary?: unknown; visible_text?: unknown }>({
      feature: "mails.attachment-image",
      accountId: accountId || undefined,
      engine,
      system: `Tu analyses une pièce jointe visuelle pour aider iNrCy à rédiger un email professionnel.
Réponds uniquement en JSON valide : {"summary":"...","visible_text":"..."}.
Décris brièvement ce que montre l'image, les éléments importants pour un email commercial ou informatif, et le texte lisible s'il y en a.
Reste factuel. N'invente rien.`,
      input: `Pièce jointe image : ${name} (${mimeType}). Résume les informations utiles pour rédiger un email.`,
      images: [{ dataUrl: bufferToDataUrl(buffer, mimeType), detail: "low" }],
      maxOutputTokens: 500,
      temperature: 0.2,
    });

    const summary = clean(result.summary, 1200);
    const visibleText = clean(result.visible_text, 800);
    const merged = [summary, visibleText ? `Texte visible : ${visibleText}` : ""].filter(Boolean).join("\n").trim();
    if (!merged) return null;
    return { summary: normalizeExtractedText(merged, DEFAULT_MAX_CHARS_PER_FILE) };
  } catch (error) {
    console.error("Attachment image vision analysis failed", { name, error });
    return { summary: "", note: "analyse visuelle indisponible" };
  }
}

function probeVideoDuration(filePath: string) {
  try {
    const result = spawnSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { encoding: "utf8", timeout: 10_000 });
    const value = Number(String(result.stdout || "").trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function extractVideoFrameDataUrls(buffer: Buffer, mimeType: string) {
  const dir = mkdtempSync(join(tmpdir(), "inrcy-attach-video-"));
  const ext = mimeType.includes("webm") ? ".webm" : mimeType.includes("quicktime") ? ".mov" : ".mp4";
  const videoPath = join(dir, `input${ext}`);
  writeFileSync(videoPath, buffer);
  const duration = probeVideoDuration(videoPath);
  const targets = duration && duration > 3 ? [0, duration / 2, Math.max(duration - 1, 0)] : [0, 1, 2];
  const frames: string[] = [];

  try {
    for (let i = 0; i < targets.length; i += 1) {
      const outPath = join(dir, `frame-${i}.jpg`);
      const ss = String(Math.max(0, Math.floor(targets[i] || 0)));
      const result = spawnSync("ffmpeg", [
        "-y",
        "-ss", ss,
        "-i", videoPath,
        "-frames:v", "1",
        "-vf", "scale='min(1280,iw)':-2",
        outPath,
      ], { encoding: "utf8", timeout: 25_000 });
      if (result.status === 0) {
        try {
          const jpg = readFileSync(outPath);
          frames.push(bufferToDataUrl(jpg, "image/jpeg"));
        } catch {}
      }
    }
    return { frames, duration };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function summarizeVideoWithVision(
  name: string,
  mimeType: string,
  buffer: Buffer,
  engine: AiPreferredEngine,
  accountId?: string | null,
): Promise<VisualAttachmentSummary | null> {
  if (buffer.length > DEFAULT_MAX_VIDEO_BYTES) {
    return { summary: "", note: "vidéo trop volumineuse pour analyse visuelle IA" };
  }

  try {
    const { frames, duration } = extractVideoFrameDataUrls(buffer, mimeType);
    if (!frames.length) return { summary: "", note: "aperçu vidéo indisponible" };
    const result = await aiGenerateJSON<{ summary?: unknown; visible_text?: unknown }>({
      feature: "mails.attachment-video",
      accountId: accountId || undefined,
      engine,
      system: `Tu analyses les images clés d'une vidéo jointe pour aider iNrCy à rédiger un email professionnel.
Réponds uniquement en JSON valide : {"summary":"...","visible_text":"..."}.
Décris brièvement le sujet visible, les éléments importants pour le message, et le texte lisible s'il apparaît à l'écran.
Reste factuel. N'invente rien.`,
      input: `Pièce jointe vidéo : ${name} (${mimeType}${duration ? `, durée ≈ ${Math.round(duration)} s` : ""}). Résume les informations utiles pour rédiger un email.`,
      images: frames.slice(0, 3).map((dataUrl) => ({ dataUrl, detail: "low" as const })),
      maxOutputTokens: 520,
      temperature: 0.2,
    });

    const summary = clean(result.summary, 1200);
    const visibleText = clean(result.visible_text, 800);
    const merged = [
      duration ? `Durée approximative : ${Math.round(duration)} s` : "",
      summary,
      visibleText ? `Texte visible : ${visibleText}` : "",
    ].filter(Boolean).join("\n").trim();
    if (!merged) return null;
    return { summary: normalizeExtractedText(merged, DEFAULT_MAX_CHARS_PER_FILE) };
  } catch (error) {
    console.error("Attachment video vision analysis failed", { name, error });
    return { summary: "", note: "analyse vidéo indisponible" };
  }
}

function canReadAsText(mimeType: string, name: string) {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  return (
    lowerMime.startsWith("text/") ||
    lowerMime.includes("json") ||
    lowerMime.includes("csv") ||
    lowerMime.includes("xml") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".html") ||
    lowerName.endsWith(".htm") ||
    lowerName.endsWith(".xml")
  );
}

function extractAttachmentText(buffer: Buffer, name: string, mimeType: string, maxCharsPerFile: number) {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  let text = "";

  if (lowerMime === "application/pdf" || lowerName.endsWith(".pdf")) {
    text = extractPdfText(buffer);
  } else if (lowerMime.includes("wordprocessingml.document") || lowerName.endsWith(".docx")) {
    text = extractDocxText(buffer);
  } else if (canReadAsText(mimeType, name)) {
    const raw = buffer.toString("utf8");
    text = lowerMime.includes("html") || lowerName.endsWith(".html") || lowerName.endsWith(".htm") ? stripHtml(raw) : raw;
  }

  return normalizeExtractedText(text, maxCharsPerFile);
}

async function analyseOneAttachment(
  supabase: any,
  ref: MailAttachmentRef,
  options: Required<Omit<BuildAttachmentAiContextOptions, "userId" | "engine">> & { userId: string | null; engine: AiPreferredEngine },
  visualState: { used: number },
): Promise<AttachmentExtract> {
  const name = clean(ref.name || ref.path.split("/").pop() || "piece-jointe", 160);
  const mimeType = clean(ref.type || "application/octet-stream", 120).toLowerCase();
  const declaredSize = typeof ref.size === "number" && Number.isFinite(ref.size) ? ref.size : null;

  if (!isSafeStorageRef(ref)) {
    return { name, mimeType, size: declaredSize, status: "ignored", text: "", note: "référence de fichier invalide" };
  }

  if (declaredSize && declaredSize > options.maxFileBytes) {
    return { name, mimeType, size: declaredSize, status: "metadata_only", text: "", note: "fichier trop volumineux pour analyse IA" };
  }

  try {
    const { data, error } = await supabase.storage.from(ref.bucket).download(ref.path);
    if (error || !data) {
      return { name, mimeType, size: declaredSize, status: "error", text: "", note: "fichier impossible à lire" };
    }

    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const actualSize = buffer.length || declaredSize;
    if (actualSize && actualSize > options.maxFileBytes) {
      return { name, mimeType: mimeType || data.type || "application/octet-stream", size: actualSize, status: "metadata_only", text: "", note: "fichier trop volumineux pour analyse IA" };
    }

    const resolvedMime = clean(mimeType || data.type || "application/octet-stream", 120).toLowerCase();
    const text = extractAttachmentText(buffer, name, resolvedMime, options.maxCharsPerFile);
    if (text) {
      return { name, mimeType: resolvedMime, size: actualSize, status: "analysed", text };
    }

    if (visualState.used < DEFAULT_MAX_VISUAL_FILES && isImageAttachment(name, resolvedMime)) {
      visualState.used += 1;
      const summary = await summarizeImageWithVision(name, resolvedMime, buffer, options.engine, options.userId);
      if (summary?.summary) {
        return { name, mimeType: resolvedMime, size: actualSize, status: "analysed", text: summary.summary, note: "analyse visuelle" };
      }
      if (summary?.note) {
        return { name, mimeType: resolvedMime, size: actualSize, status: "metadata_only", text: "", note: summary.note };
      }
    }

    if (visualState.used < DEFAULT_MAX_VISUAL_FILES && isVideoAttachment(name, resolvedMime)) {
      visualState.used += 1;
      const summary = await summarizeVideoWithVision(name, resolvedMime, buffer, options.engine, options.userId);
      if (summary?.summary) {
        return { name, mimeType: resolvedMime, size: actualSize, status: "analysed", text: summary.summary, note: "analyse vidéo" };
      }
      if (summary?.note) {
        return { name, mimeType: resolvedMime, size: actualSize, status: "metadata_only", text: "", note: summary.note };
      }
    }

    return { name, mimeType: resolvedMime, size: actualSize, status: "metadata_only", text: "", note: "texte non extractible ou format non textuel" };
  } catch (error) {
    console.error("Attachment AI analysis failed", { name, path: ref.path, error });
    return { name, mimeType, size: declaredSize, status: "error", text: "", note: "analyse indisponible" };
  }
}

/**
 * Analyse un document durable fourni dans iNrADN. Le fichier reste privé dans
 * Supabase Storage ; seul cet extrait borné est conservé dans la mémoire ADN
 * et transmis aux générateurs de contenus.
 */
export async function analyseAiMemoryReferenceDocument(
  supabase: any,
  ref: MailAttachmentRef,
  options: {
    userId: string;
    engine: AiPreferredEngine;
    maxFileBytes?: number;
    maxCharsPerFile?: number;
  },
): Promise<AttachmentExtract> {
  return await analyseOneAttachment(
    supabase,
    ref,
    {
      userId: options.userId,
      engine: options.engine,
      maxFiles: 1,
      maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      maxTotalChars: options.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE,
      maxCharsPerFile: options.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE,
    },
    { used: 0 },
  );
}

export async function buildMailAttachmentAiPromptSection(
  supabase: any,
  refs: MailAttachmentRef[],
  options: BuildAttachmentAiContextOptions,
) {
  const safeRefs = refs.filter(isSafeStorageRef).slice(0, options.maxFiles ?? DEFAULT_MAX_FILES);
  if (!safeRefs.length) return "";

  const resolvedOptions = {
    userId: options.userId || null,
    engine: options.engine,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalChars: options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS,
    maxCharsPerFile: options.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE,
  };

  const visualState = { used: 0 };
  const analyses = await Promise.all(safeRefs.map((ref) => analyseOneAttachment(supabase, ref, resolvedOptions, visualState)));
  let remainingChars = resolvedOptions.maxTotalChars;
  const lines: string[] = [
    "Pièces jointes fournies par le professionnel :",
    "- Utiliser ces informations si elles aident le mail.",
    "- Ne jamais inventer le contenu d'une pièce jointe non lisible.",
    "- Ne pas recopier l'extrait mot pour mot : s'en inspirer pour rédiger un mail clair.",
  ];

  analyses.forEach((item, index) => {
    lines.push(`\n${index + 1}. ${item.name} (${item.mimeType || "type inconnu"}, ${formatBytes(item.size)})`);
    if (item.status === "analysed" && item.text) {
      const excerpt = item.text.slice(0, Math.max(0, remainingChars)).trim();
      remainingChars -= excerpt.length;
      lines.push(`Extrait utile :\n${excerpt || "Extrait indisponible."}`);
    } else {
      lines.push(`Note : ${item.note || "contenu non analysé"}.`);
    }
  });

  return lines.join("\n").trim();
}
