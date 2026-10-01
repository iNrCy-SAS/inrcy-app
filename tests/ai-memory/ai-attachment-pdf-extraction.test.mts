import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { jsPDF } from "jspdf";

import { extractPdfTextForAi } from "../../lib/pdfTextExtraction.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function textPdfFixture(text: string) {
  const document = new jsPDF({ compress: true });
  document.text(text, 20, 20);
  return Buffer.from(document.output("arraybuffer"));
}

function scannedPdfFixture() {
  const document = new jsPDF({ compress: true });
  document.setProperties({ title: "Ce titre metadata ne doit pas devenir un extrait" });
  document.addImage(ONE_PIXEL_PNG, "PNG", 20, 20, 40, 40);
  return Buffer.from(document.output("arraybuffer"));
}

test("l'extracteur lit réellement le texte d'un PDF compressé et respecte la borne", () => {
  const fixture = textPdfFixture("Offre iNrCy extraction PDF comportementale 2026");
  assert.equal(fixture.subarray(0, 5).toString("ascii"), "%PDF-");

  const extracted = extractPdfTextForAi(fixture, 2_200);
  assert.match(extracted, /Offre iNrCy extraction PDF comportementale 2026/);

  const bounded = extractPdfTextForAi(fixture, 18);
  assert.ok(bounded.length > 0);
  assert.ok(bounded.length <= 18);
});

test("un PDF image-only ne transforme pas ses métadonnées en faux texte OCR", () => {
  const fixture = scannedPdfFixture();
  assert.equal(fixture.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(extractPdfTextForAi(fixture), "");
});

test("l'analyse borne le Blob avant arrayBuffer et explicite l'absence d'OCR", () => {
  const source = readFileSync(resolve(ROOT, "lib/aiAttachmentContext.ts"), "utf8");
  const sizeGuard = source.indexOf("downloadedSize > options.maxFileBytes");
  const materialisation = source.indexOf("await data.arrayBuffer()");

  assert.ok(sizeGuard >= 0);
  assert.ok(materialisation > sizeGuard);
  assert.match(source, /PDF sans texte extractible/);
  assert.match(source, /OCR non disponible/);
  assert.match(source, /if \(isPdf\)[\s\S]*status: "error"/);
});
