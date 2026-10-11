import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";

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

function encodedPdfFixture(encoded: string | Buffer, filters: string) {
  const data = Buffer.from(encoded, "latin1");
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${data.length} /Filter ${filters} >>\nstream\n`),
    data,
    Buffer.from("endstream\nendobj\n%%EOF"),
  ]);
}

test("un PDF ASCII85 puis Flate reste lisible sans saut de ligne avant endstream", () => {
  // Fixture indépendante : Python base64.a85encode(zlib.compress(b"BT /F1 12 Tf ... Tj ET")).
  const encoded = "Garg^;:'MC<%p.,#Y@tAE61m.btZG5;$_,\\;fE.gp@P^G<@CVd.g?W_,ml*#$9=O=H)V-bR<aWLRL13@$EbNPGM3_l~>";
  const fixture = encodedPdfFixture(encoded, "[/ASCII85Decode /FlateDecode]");
  assert.equal(extractPdfTextForAi(fixture), "Document PDF ASCII85 sans saut de ligne final");
  assert.equal(extractPdfTextForAi(fixture, 12), "Document PDF");
});

test("ASCII85 accepte z, les espaces et le dernier groupe partiel", () => {
  // Python base64.a85encode(b"\\0\\0\\0\\0BT (Lecture) Tj ET") : z puis un groupe final incomplet.
  const fixture = encodedPdfFixture("z6<#'U9P%^U\nF`M%B+B3(u78s~>", "/A85");
  assert.equal(extractPdfTextForAi(fixture), "Lecture");
});

test("les flux encodés invalides ou trop grands ne produisent aucun faux extrait", () => {
  for (const invalid of ["!z~>", "!~>", "uuuuu~>", "v~>", "z"]) {
    assert.equal(extractPdfTextForAi(encodedPdfFixture(invalid, "/ASCII85Decode")), "");
  }
  const tooLarge = deflateSync(Buffer.from("BT (Faux extrait) Tj ET " + " ".repeat(2 * 1024 * 1024)));
  assert.equal(extractPdfTextForAi(encodedPdfFixture(tooLarge, "/FlateDecode")), "");
  assert.equal(extractPdfTextForAi(encodedPdfFixture("BT (Faux extrait) Tj ET", "/DCTDecode")), "");
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
