import { inflateRawSync } from "node:zlib";

const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 16 * 1024 * 1024;
type ZipEntry = { offset: number; compressed: number; size: number; method: number };

// Read only the XML needed by the AI; no archive entry is written to disk.
function officeArchive(buffer: Buffer) {
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65_557); index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50 && index + 22 + buffer.readUInt16LE(index + 20) === buffer.length) { end = index; break; }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error("Archive Office invalide.");
  const count = buffer.readUInt16LE(end + 10);
  const directory = buffer.readUInt32LE(end + 16);
  if (count > 5_000 || directory >= end) throw new Error("Document Office trop complexe.");
  const entries = new Map<string, ZipEntry>();
  let cursor = directory;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Archive Office invalide.");
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const next = cursor + 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
    if (flags & 1 || next > end) throw new Error("Document protégé ou invalide.");
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (entries.has(name)) throw new Error("Archive Office ambiguë.");
    entries.set(name, { offset: buffer.readUInt32LE(cursor + 42), compressed, size, method });
    cursor = next;
  }
  return {
    names: Array.from(entries.keys()),
    read(name: string, maxBytes = MAX_XML_BYTES) {
      const entry = entries.get(name);
      if (!entry) return "";
      if (entry.size > maxBytes || expanded + entry.size > MAX_TOTAL_XML_BYTES || entry.offset + 30 > directory || buffer.readUInt32LE(entry.offset) !== 0x04034b50) throw new Error("Document Office trop complexe.");
      const start = entry.offset + 30 + buffer.readUInt16LE(entry.offset + 26) + buffer.readUInt16LE(entry.offset + 28);
      if (start + entry.compressed > directory || ![0, 8].includes(entry.method)) throw new Error("Archive Office invalide.");
      const bytes = buffer.subarray(start, start + entry.compressed);
      const xml = entry.method === 0 ? bytes : inflateRawSync(bytes, { maxOutputLength: maxBytes });
      if (xml.length !== entry.size || xml.length > maxBytes || expanded + xml.length > MAX_TOTAL_XML_BYTES) throw new Error("Document Office trop complexe.");
      expanded += xml.length;
      return xml.toString("utf8");
    },
  };
}
function xmlText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
    const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
    if (named[entity]) return named[entity];
    const hexadecimal = entity[2]?.toLowerCase() === "x";
    const code = parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  }).replace(/[\t ]+/g, " ").trim();
}
export function decodeAiDocumentText(buffer: Buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return new TextDecoder("windows-1252").decode(buffer); }
}
export function extractOfficeDocumentText(buffer: Buffer, name: string, maxChars: number): string | Promise<string> {
  const zip = officeArchive(buffer);
  if (name.toLowerCase().endsWith(".docx")) {
    const xml = zip.read("word/document.xml");
    return xmlText(xml.replace(/<w:tab\b[^>]*\/>/g, "\t").replace(/<w:br\b[^>]*\/>|<\/w:p>|<\/w:tr>/g, "\n")).slice(0, maxChars);
  }
  return extractSpreadsheetText(buffer, zip, maxChars);
}

async function extractSpreadsheetText(buffer: Buffer, zip: ReturnType<typeof officeArchive>, maxChars: number) {
  if (!zip.names.includes("xl/workbook.xml")) return "";
  // Validate actual expansion before the existing spreadsheet reader parses
  // formatting, dates, shared strings and cached (never executed) formulas.
  for (const name of zip.names) zip.read(name, name.endsWith(".xml") ? MAX_XML_BYTES : 8 * 1024 * 1024);
  const XLSX = await import("./vendor/xlsx.mjs");
  const workbook = XLSX.read(buffer, { type: "buffer", sheetRows: 1_000, cellFormula: false, cellHTML: false, bookVBA: false });
  const names = workbook.SheetNames.slice(0, 12);
  const perSheetBudget = Math.max(100, Math.floor(maxChars / Math.max(1, names.length)));
  const result: string[] = [];
  for (const name of names) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, blankrows: false, defval: "", range: "A1:AX1000" }) as unknown[][];
    let text = "Feuille : " + name + "\n";
    for (const row of rows) {
      if (text.length >= perSheetBudget) break;
      const cells = row.slice(0, 50).map(value => String(value ?? "").slice(0, 1_000));
      while (cells.length && !cells.at(-1)?.trim()) cells.pop();
      if (cells.length) text += cells.join(" | ") + "\n";
    }
    result.push(text.slice(0, perSheetBudget));
  }
  return result.join("\n").slice(0, maxChars);
}
