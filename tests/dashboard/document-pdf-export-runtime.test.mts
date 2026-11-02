import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { jsPDF } from "jspdf";
import ts from "typescript";

const source = readFileSync(new URL("../../app/dashboard/_documents/documentPdfExport.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const styles = {
  documentPrintPages: "print-pages", documentPrintPage: "print-page", pdfExportStaging: "staging",
  noPrint: "no-print", printHidden: "print-hidden", printHiddenCell: "print-hidden-cell", printOnly: "print-only",
};

// A small valid PNG exercises the real jsPDF image reader and output, without a browser or network.
function png(width: number, height: number) {
  const chunk = (name: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
    prefix.writeUInt32BE(data.length); suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([prefix, body, suffix]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4), 255);
  for (let row = 0; row < height; row++) rows[row * (1 + width * 4)] = 0;
  return "data:image/png;base64," + Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

function fixture(options: { pages?: number; failAt?: number; imageHeight?: number; emptyPrintRoot?: boolean } = {}) {
  const hidden = [{ style: { display: "inline-flex" } }, { style: { display: "" } }];
  const printOnly = [{ style: { display: "none" } }];
  const printedPages = Array.from({ length: options.pages || 0 }, (_, index) => ({ index }));
  const removedAttributes: string[] = [];
  const clone = { className: "print-pages", querySelectorAll: () => printedPages, removeAttribute: (name: string) => removedAttributes.push(name) };
  const printRoot = options.pages || options.emptyPrintRoot ? { cloneNode: () => clone } : null;
  const preview = {
    className: "preview theme",
    querySelector: () => printRoot,
    querySelectorAll: (selector: string) => selector === ".print-only" ? printOnly : hidden,
  };
  let appended = 0, removed = 0, waited = 0;
  const staging = { className: "", child: null as unknown, appendChild(child: unknown) { this.child = child; }, remove() { removed++; } };
  const captures: Array<{ element: unknown; options: Record<string, unknown>; hiddenDisplay: string[]; printDisplay: string[] }> = [];
  const pdfs: jsPDF[] = [];
  const mod = { exports: {} as { exportDocumentPreviewPdf(el: HTMLElement, css: Record<string, string>, wait: () => Promise<void>): Promise<Blob> } };
  const mockRequire = (name: string) => {
    if (name === "html2canvas") return async (element: unknown, captureOptions: Record<string, unknown>) => {
      captures.push({ element, options: captureOptions, hiddenDisplay: hidden.map(node => node.style.display), printDisplay: printOnly.map(node => node.style.display) });
      if (captures.length === options.failAt) throw new Error("capture failed");
      return { toDataURL: () => png(10, options.imageHeight || 10) };
    };
    if (name === "jspdf") return { jsPDF: function (orientation: "p", unit: "mm", format: "a4") {
      const pdf = new jsPDF(orientation, unit, format); pdfs.push(pdf); return pdf;
    } };
    throw new Error("Unexpected dependency " + name);
  };
  const document = { createElement: () => staging, body: { appendChild() { appended++; } } };
  new Function("require", "module", "exports", "document", compiled)(mockRequire, mod, mod.exports, document);
  return {
    run: () => mod.exports.exportDocumentPreviewPdf(preview as unknown as HTMLElement, styles, async () => { waited++; }),
    captures, pdfs, hidden, printOnly, clone, staging, removedAttributes, printedPages,
    counts: () => ({ appended, removed, waited }),
  };
}

for (const pages of [1, 3]) {
  test(`document PDF exports ${pages} explicit A4 print page(s) using the real PDF writer`, async () => {
    const f = fixture({ pages });
    const blob = await f.run();
    assert.match(await blob.text(), /^%PDF-/);
    assert.equal(f.pdfs[0].getNumberOfPages(), pages);
    assert.deepEqual(f.captures.map(capture => capture.element), f.printedPages);
    for (const capture of f.captures) assert.deepEqual(capture.options, {
      scale: 2, useCORS: true, backgroundColor: "#ffffff", windowWidth: 794, windowHeight: 1123,
    });
    assert.equal(f.clone.className, "print-pages preview theme");
    assert.deepEqual(f.removedAttributes, ["aria-hidden"]);
    assert.equal(f.staging.className, "staging");
    assert.equal(f.staging.child, f.clone);
    assert.deepEqual(f.counts(), { appended: 1, removed: 1, waited: 1 });
  });
}

test("failed print-page capture always removes its staging element", async () => {
  const f = fixture({ pages: 3, failAt: 2 });
  await assert.rejects(f.run(), /capture failed/);
  assert.equal(f.captures.length, 2);
  assert.deepEqual(f.counts(), { appended: 1, removed: 1, waited: 1 });
});

test("legacy preview capture paginates a tall image and restores all temporary display changes", async () => {
  const f = fixture({ imageHeight: 40 });
  const blob = await f.run();
  assert.match(await blob.text(), /^%PDF-/);
  assert.equal(f.pdfs[0].getNumberOfPages(), 3);
  assert.deepEqual(f.captures[0].options, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
  assert.deepEqual(f.captures[0].hiddenDisplay, ["none", "none"]);
  assert.deepEqual(f.captures[0].printDisplay, ["block"]);
  assert.deepEqual(f.hidden.map(node => node.style.display), ["inline-flex", ""]);
  assert.deepEqual(f.printOnly.map(node => node.style.display), ["none"]);
  assert.deepEqual(f.counts(), { appended: 0, removed: 0, waited: 0 });
});

test("failed legacy capture restores styles and propagates the original failure", async () => {
  const f = fixture({ failAt: 1 });
  await assert.rejects(f.run(), /capture failed/);
  assert.deepEqual(f.hidden.map(node => node.style.display), ["inline-flex", ""]);
  assert.deepEqual(f.printOnly.map(node => node.style.display), ["none"]);
});

test("an empty explicit print container is removed before falling back to preview capture", async () => {
  const f = fixture({ emptyPrintRoot: true });
  const blob = await f.run();
  assert.match(await blob.text(), /^%PDF-/);
  assert.equal(f.captures.length, 1);
  assert.deepEqual(f.counts(), { appended: 1, removed: 1, waited: 1 });
});

for (const page of ["factures", "devis"]) {
  const pageSource = readFileSync(new URL(`../../app/dashboard/${page}/new/page.tsx`, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(page, pageSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "buildPdfBlob") declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(declaration?.initializer);
  const wrapper = ts.transpileModule("return " + declaration.initializer.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  test(`${page}: the actual export wrapper exits editing, waits for the updated DOM and passes the current preview`, async () => {
    const events: string[] = [];
    const currentPreview = {};
    const previewRef: { current: unknown } = { current: null };
    const expected = new Blob(["pdf"]);
    const waitForDomUpdate = async () => { events.push("wait"); previewRef.current = currentPreview; };
    const exportPdf = async (element: unknown, css: unknown, wait: unknown) => {
      events.push("export"); assert.equal(element, currentPreview); assert.equal(css, styles); assert.equal(wait, waitForDomUpdate); return expected;
    };
    const build = new Function("window", "document", "setIsEditingProvider", "waitForDomUpdate", "previewRef", "styles", "exportDocumentPreviewPdf", wrapper)(
      {}, {}, (editing: boolean) => { assert.equal(editing, false); events.push("exit-editing"); }, waitForDomUpdate, previewRef, styles, exportPdf,
    ) as () => Promise<Blob | null>;
    assert.equal(await build(), expected);
    assert.deepEqual(events, ["exit-editing", "wait", "export"]);
  });

  test(`${page}: the actual export wrapper returns null without a browser or preview`, async () => {
    let exports = 0, waits = 0;
    const create = (window: unknown, document: unknown) => new Function("window", "document", "setIsEditingProvider", "waitForDomUpdate", "previewRef", "styles", "exportDocumentPreviewPdf", wrapper)(
      window, document, () => {}, async () => { waits++; }, { current: null }, styles, () => { exports++; },
    ) as () => Promise<Blob | null>;
    assert.equal(await create(undefined, undefined)(), null);
    assert.equal(waits, 0);
    assert.equal(await create({}, {})(), null);
    assert.equal(waits, 1);
    assert.equal(exports, 0);
  });
}

for (const page of ["factures", "devis"]) {
  test(`${page}: PDF revision includes the live client exchange preferences and UI locale`, () => {
    const source = readFileSync(new URL(`../../app/dashboard/${page}/new/page.tsx`, import.meta.url), "utf8");
    const parsed = ts.createSourceFile(page, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useInrAssistantDocumentPreview") calls.push(node); ts.forEachChild(node, visit); };
    visit(parsed); assert.equal(calls.length, 1);
    const snapshot = calls[0].arguments[2]; assert.ok(ts.isObjectLiteralExpression(snapshot));
    const fields = snapshot.properties.map(property => property.name?.getText(parsed));
    assert.ok(fields.includes("clientExchangePreferences")); assert.ok(fields.includes("documentUiLocale"));
    assert.match(source, /const documentUiLocale = useLocale\(\)/);
  });
}
