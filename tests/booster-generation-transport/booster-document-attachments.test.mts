import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateBoosterDocumentSelection, normalizeBoosterDocumentReferences, BOOSTER_DOCUMENT_MAX_BYTES } from "../../lib/boosterDocumentAttachmentPolicy.ts";
import { decodeAiDocumentText, extractOfficeDocumentText } from "../../lib/aiOfficeDocumentText.ts";
import { getAiFeaturePolicy } from "../../lib/aiGatewayPolicy.ts";
import { buildBoosterGenerationRequest } from "../../lib/boosterGenerationTransportClient.ts";
import { readBoosterGenerationRequest } from "../../lib/boosterGenerationRequestTransport.ts";

function archive(files: Record<string, string>, descriptors = false) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name), raw = Buffer.from(content), data = deflateRawSync(raw);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(descriptors ? 8 : 0, 6); head.writeUInt16LE(8, 8);
    if (!descriptors) { head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); }
    head.writeUInt16LE(filename.length, 26);
    const tail = Buffer.alloc(descriptors ? 16 : 0);
    if (descriptors) { tail.writeUInt32LE(0x08074b50); tail.writeUInt32LE(data.length, 8); tail.writeUInt32LE(raw.length, 12); }
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(descriptors ? 8 : 0, 8); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(head, filename, data, tail); central.push(entry, filename); offset += head.length + filename.length + data.length + tail.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const formats = ["pdf", "docx", "xlsx", "csv", "txt"];
const documents = formats.map((format, index) => ({ name: `source.${format}`, type: "", size: 1024, bucket: "inrbox_attachments", path: `owner/booster-pdf-context/${index}-source.${format}` }));

test("five supported documents are allowed, and count, individual weight and combined weight are enforced", () => {
  assert.equal(validateBoosterDocumentSelection(documents), null);
  assert.match(validateBoosterDocumentSelection([...documents, documents[0]])!, /5 documents/);
  assert.match(validateBoosterDocumentSelection([{ ...documents[0], size: BOOSTER_DOCUMENT_MAX_BYTES + 1 }])!, /8 Mo/);
  assert.match(validateBoosterDocumentSelection(documents.slice(0, 3).map(file => ({ ...file, size: BOOSTER_DOCUMENT_MAX_BYTES })))!, /20 Mo/);
  assert.match(validateBoosterDocumentSelection([{ name: "source.exe", size: 1 }])!, /Formats acceptés/);
  assert.match(validateBoosterDocumentSelection([{ name: "old.doc", size: 1 }])!, /Formats acceptés/);
  assert.match(validateBoosterDocumentSelection([{ ...documents[0], size: 0 }])!, /vide/);
  assert.match(validateBoosterDocumentSelection([null as never])!, /invalide/);
});

test("document references remain private to their owner and cannot repeat or escape the allowed folder", () => {
  const normalized = normalizeBoosterDocumentReferences(documents, "owner");
  assert.equal(normalized.length, 5);
  const longName = "a".repeat(200) + ".xlsx";
  const longReference = normalizeBoosterDocumentReferences([{ ...documents[2], name: longName }], "owner")[0];
  assert.equal(longReference.name.length, 160);
  assert.ok(longReference.name.endsWith(".xlsx"));
  assert.equal(normalized[2].type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.throws(() => normalizeBoosterDocumentReferences(documents, "other"), /référence/);
  assert.throws(() => normalizeBoosterDocumentReferences([documents[0], documents[0]], "owner"), /référence/);
  assert.throws(() => normalizeBoosterDocumentReferences([{ ...documents[0], path: "owner/booster-pdf-context/../other.pdf" }], "owner"), /référence/);
  assert.throws(() => normalizeBoosterDocumentReferences([...documents, documents[0]], "owner"), /5 documents/);
  assert.throws(() => normalizeBoosterDocumentReferences({ files: documents }, "owner"), /liste/);
});

test("Word text is extracted from real ZIP directory records including data descriptors", async () => {
  for (const descriptors of [false, true]) {
    const file = archive({ "word/document.xml": '<w:document><w:body><w:p><w:r><w:t>Offre &amp; services</w:t></w:r></w:p><w:p><w:r><w:t>Promotion locale</w:t></w:r></w:p></w:body></w:document>' }, descriptors);
    const text = await extractOfficeDocumentText(file, "brief.docx", 2000);
    assert.match(text, /Offre & services/);
    assert.match(text, /Promotion locale/);
    assert.ok(text.includes("\n"));
    assert.ok((await extractOfficeDocumentText(file, "brief.docx", 12)).length <= 12);
  }
});

test("Excel reads real exported sheets, dates and cached formula values without executing formulas", async () => {
  const XLSX = await import("../../lib/vendor/xlsx.mjs");
  const workbook = XLSX.utils.book_new();
  const products = XLSX.utils.aoa_to_sheet([["Produit", "Prix", "Date"], ["Café", 19.9, new Date(Date.UTC(2026, 9, 24))]]);
  products.C2.z = "yyyy-mm-dd";
  const offers = XLSX.utils.aoa_to_sheet([["Remise", 5]]);
  offers.B1.f = 'WEBSERVICE("https://example.invalid")';
  XLSX.utils.book_append_sheet(workbook, products, "Produits");
  XLSX.utils.book_append_sheet(workbook, offers, "Offres");
  const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", bookSST: true });
  const text = await extractOfficeDocumentText(file, "catalogue.xlsx", 6500);
  for (const value of ["Produits", "Offres", "Produit", "Café", "Prix", "19.9", "Remise", "5", "2026-10-24"]) assert.ok(text.includes(value), value);
  assert.doesNotMatch(text, /WEBSERVICE|example\.invalid/);
});

test("protected, malformed and overexpanded Office documents fail before unbounded extraction", async () => {
  assert.throws(() => extractOfficeDocumentText(Buffer.from("not a ZIP"), "fake.docx", 500));
  const oversized = archive({ "word/document.xml": "x".repeat(4 * 1024 * 1024 + 1) });
  assert.throws(() => extractOfficeDocumentText(oversized, "large.docx", 500), /complexe/);
  const encrypted = archive({ "word/document.xml": "texte" });
  const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); encrypted.writeUInt16LE(1, central + 8);
  assert.throws(() => extractOfficeDocumentText(encrypted, "encrypted.docx", 500), /protégé/);
  const spreadsheetBomb = archive({ "xl/workbook.xml": "<workbook/>", "unused.bin": "x".repeat(8 * 1024 * 1024 + 1) });
  await assert.rejects(async () => extractOfficeDocumentText(spreadsheetBomb, "large.xlsx", 500), /complexe/);
});

test("CSV and text preserve French accents from UTF-8, UTF-16 and Windows exports", () => {
  const text = "Produit;Prix\nCafé;19,90";
  assert.equal(decodeAiDocumentText(Buffer.from(text)), text);
  assert.equal(decodeAiDocumentText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")])), text);
  assert.equal(decodeAiDocumentText(Buffer.from([0x43, 0x61, 0x66, 0xe9])), "Café");
});

test("five document references survive both JSON and mixed image/video multipart transport", async () => {
  for (const mixed of [false, true]) {
    const image = { name: "photo.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,AA==" };
    const payload = { idea: "Offre locale", documentsForAI: normalizeBoosterDocumentReferences(documents, "owner"), ...(mixed ? { imagesForAI: [image], videoForAI: { visualFrames: [image] } } : {}) };
    const request = buildBoosterGenerationRequest(payload);
    const parsed = await readBoosterGenerationRequest(new Request("https://example.invalid/api/booster/generate", { method: "POST", ...request }));
    assert.deepEqual(parsed.body.documentsForAI, payload.documentsForAI);
    if (mixed) { assert.equal(parsed.body.imagesForAI?.length, 1); assert.equal(parsed.body.videoForAI?.visualFrames?.length, 1); }
  }
});

test("the AI route enforces the document policy and consumes both workspace families", () => {
  const route = readFileSync(new URL("../../app/api/booster/generate/route.ts", import.meta.url), "utf8");
  assert.match(route, /normalizeBoosterDocumentReferences\(body\.documentsForAI, userId\)/);
  assert.match(route, /documentBytes > BOOSTER_DOCUMENT_TOTAL_MAX_BYTES/);
  assert.match(route, /for \(const document of documentReferences\)/);
  assert.match(route, /allowMixedMedia: true/);
  assert.match(route, /AI_REFERENCE_MAX_COUNT/);
});


test("Booster gateway policies accept five photos and three video keyframes while Agent keeps its existing limit", () => {
  for (const feature of ["booster.publish", "booster.media-understanding"] as const) {
    assert.equal(getAiFeaturePolicy(feature).maxImages, 8);
  }
  for (const feature of ["agent.publish", "agent.media-understanding"] as const) {
    assert.equal(getAiFeaturePolicy(feature).maxImages, 5);
  }
});
