import { inflateRawSync, inflateSync } from "node:zlib";

const DEFAULT_MAX_CHARS = 2_200;
const PDF_MAX_DECOMPRESSED_STREAM_BYTES = 2 * 1024 * 1024;
const PDF_MAX_STREAMS = 64;

type PdfStringToken = {
  end: number;
  value: string;
};

function normalizePdfText(value: string, maxChars: number) {
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

function decodePdfLiteral(raw: string) {
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      out += character;
      continue;
    }

    const next = raw[index + 1];
    if (!next) continue;
    index += 1;
    if (next === "\r" || next === "\n") {
      if (next === "\r" && raw[index + 1] === "\n") index += 1;
    } else if (next === "n") out += "\n";
    else if (next === "r") out += "\n";
    else if (next === "t") out += "\t";
    else if (next === "b" || next === "f") out += " ";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (/[0-7]/.test(next)) {
      let octal = next;
      for (let count = 0; count < 2 && /[0-7]/.test(raw[index + 1] || ""); count += 1) {
        octal += raw[index + 1];
        index += 1;
      }
      out += String.fromCharCode(parseInt(octal, 8));
    } else {
      out += next;
    }
  }
  return out;
}

function decodePdfHex(raw: string) {
  let hex = raw.replace(/\s+/g, "");
  if (hex.length < 2 || !/^[0-9a-f]+$/i.test(hex)) return "";
  if (hex.length % 2 !== 0) hex += "0";
  const bytes = Buffer.from(hex, "hex");
  if (!bytes.length) return "";

  const hasUtf16Marker = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
  const sample = bytes.subarray(0, Math.min(bytes.length, 24));
  const hasUtf16Pattern = sample.length >= 4 && sample.filter((_byte, index) => index % 2 === 0 && sample[index] === 0).length >= 2;
  if (hasUtf16Marker || hasUtf16Pattern) {
    const start = hasUtf16Marker ? 2 : 0;
    let out = "";
    for (let index = start; index + 1 < bytes.length; index += 2) {
      out += String.fromCharCode((bytes[index] << 8) + bytes[index + 1]);
    }
    return out;
  }

  return bytes.toString("latin1");
}

function readLiteralToken(source: string, start: number): PdfStringToken | null {
  let depth = 1;
  let raw = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      raw += character;
      if (index + 1 < source.length) {
        raw += source[index + 1];
        index += 1;
        if (raw.endsWith("\\\r") && source[index + 1] === "\n") {
          raw += source[index + 1];
          index += 1;
        }
      }
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return { end: index + 1, value: decodePdfLiteral(raw) };
    }
    raw += character;
  }
  return null;
}

function readHexToken(source: string, start: number): PdfStringToken | null {
  const end = source.indexOf(">", start + 1);
  if (end < 0) return null;
  return { end: end + 1, value: decodePdfHex(source.slice(start + 1, end)) };
}

function isPdfDelimiter(character: string) {
  return /[\s()[\]{}<>/%]/.test(character);
}

function usefulPdfText(value: string) {
  return value
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextOperators(content: string, maxChars: number) {
  const snippets: string[] = [];
  let capturedChars = 0;
  let inTextObject = false;
  let arrayStrings: string[] | null = null;
  let completedArray: string[] | null = null;
  let scalarStrings: string[] = [];

  const emit = (values: string[]) => {
    if (!inTextObject || capturedChars >= maxChars) return;
    const text = usefulPdfText(values.join(""));
    if (text.length < 2 || !/[A-Za-zÀ-ÿ0-9]/.test(text)) return;
    snippets.push(text);
    capturedChars += text.length + 1;
  };

  const resetOperands = () => {
    scalarStrings = [];
    completedArray = null;
  };

  for (let index = 0; index < content.length && capturedChars < maxChars; ) {
    const character = content[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "%") {
      const lineEnd = content.slice(index).search(/[\r\n]/);
      index = lineEnd < 0 ? content.length : index + lineEnd + 1;
      continue;
    }
    if (character === "(") {
      const token = readLiteralToken(content, index);
      if (!token) break;
      if (arrayStrings) arrayStrings.push(token.value);
      else scalarStrings.push(token.value);
      index = token.end;
      continue;
    }
    if (character === "<" && content[index + 1] !== "<") {
      const token = readHexToken(content, index);
      if (!token) break;
      if (arrayStrings) arrayStrings.push(token.value);
      else scalarStrings.push(token.value);
      index = token.end;
      continue;
    }
    if (character === "[") {
      arrayStrings = [];
      completedArray = null;
      index += 1;
      continue;
    }
    if (character === "]") {
      completedArray = arrayStrings;
      arrayStrings = null;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      emit(scalarStrings.slice(-1));
      resetOperands();
      index += 1;
      continue;
    }
    if (character === "/") {
      index += 1;
      while (index < content.length && !isPdfDelimiter(content[index])) index += 1;
      continue;
    }
    if (character === "<" && content[index + 1] === "<") {
      index += 2;
      continue;
    }
    if (character === ">" && content[index + 1] === ">") {
      index += 2;
      continue;
    }

    let end = index + 1;
    while (end < content.length && !isPdfDelimiter(content[end])) end += 1;
    const token = content.slice(index, end);
    if (token === "BT") {
      inTextObject = true;
      resetOperands();
    } else if (token === "ET") {
      inTextObject = false;
      resetOperands();
    } else if (token === "Tj") {
      emit(scalarStrings.slice(-1));
      resetOperands();
    } else if (token === "TJ") {
      emit(completedArray || []);
      resetOperands();
    } else if (/^[A-Za-z*]+$/.test(token)) {
      resetOperands();
    }
    index = end;
  }

  return snippets.join("\n");
}

function isFlateEncoded(dictionarySource: string) {
  return /\/Filter\s*(?:\/FlateDecode|\[[^\]]*\/FlateDecode)/i.test(dictionarySource);
}

/**
 * Extracts only text-showing operators from bounded PDF content streams.
 * This deliberately does not attempt OCR: an image-only/scanned PDF returns
 * an empty string so callers can fail closed with an explicit message.
 */
export function extractPdfTextForAi(buffer: Buffer, maxChars = DEFAULT_MAX_CHARS) {
  const safeMaxChars = Math.max(1, Math.min(Math.trunc(maxChars) || DEFAULT_MAX_CHARS, 20_000));
  const source = buffer.toString("latin1");
  const snippets: string[] = [];
  const seen = new Set<string>();
  let remainingChars = safeMaxChars;
  let streamCount = 0;

  const streamPattern = /stream(?:\r\n|\r|\n)([\s\S]*?)(?:\r\n|\r|\n)endstream/g;
  for (const match of source.matchAll(streamPattern)) {
    if (remainingChars <= 0 || streamCount >= PDF_MAX_STREAMS) break;
    streamCount += 1;
    const raw = match[1] || "";
    if (!raw) continue;

    const matchIndex = typeof match.index === "number" ? match.index : 0;
    const dictionarySource = source.slice(Math.max(0, matchIndex - 2_048), matchIndex);
    const streamBuffer = Buffer.from(raw, "latin1");
    const candidates: Buffer[] = [];

    if (isFlateEncoded(dictionarySource)) {
      try {
        candidates.push(inflateSync(streamBuffer, { maxOutputLength: PDF_MAX_DECOMPRESSED_STREAM_BYTES }));
      } catch {}
      if (!candidates.length) {
        try {
          candidates.push(inflateRawSync(streamBuffer, { maxOutputLength: PDF_MAX_DECOMPRESSED_STREAM_BYTES }));
        } catch {}
      }
    } else {
      candidates.push(streamBuffer);
    }

    for (const candidate of candidates) {
      const extracted = extractTextOperators(candidate.toString("latin1"), remainingChars);
      for (const piece of extracted.split("\n")) {
        const normalized = usefulPdfText(piece);
        const key = normalized.toLocaleLowerCase("fr");
        if (!normalized || seen.has(key)) continue;
        seen.add(key);
        snippets.push(normalized);
        remainingChars = Math.max(0, remainingChars - normalized.length - 1);
        if (remainingChars <= 0) break;
      }
      if (remainingChars <= 0) break;
    }
  }

  return normalizePdfText(snippets.join("\n"), safeMaxChars);
}
