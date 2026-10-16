import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";
import * as fullFrame from "../../lib/aiMediaFullFrame.ts";

const require = createRequire(import.meta.url);
function load<T>(name: string): T {
  const source = readFileSync(new URL(`../../lib/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const record = { exports: {} };
  new Function("module", "exports", "require", compiled)(record, record.exports, (id: string) => {
    if (id === "server-only") return {};
    if (id === "./aiMediaFullFrame.ts") return fullFrame;
    return require(id);
  });
  return record.exports as T;
}
const normalizer = load<typeof import("../../lib/aiMediaNormalizer.ts")>("aiMediaNormalizer");
const contact = load<typeof import("../../lib/aiMediaImageContactComposer.ts")>("aiMediaImageContactComposer");
const photo = (width: number, height: number) => sharp(Buffer.from(
  `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="#2266ac"/><stop offset="1" stop-color="#19ad72"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><rect x="${width * 0.4}" y="${height * 0.35}" width="${width * 0.2}" height="${height * 0.3}" fill="#dc2828"/></svg>`,
)).png().toBuffer();

async function detected(input: Buffer) {
  const raw = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return fullFrame.detectAiMediaUniformBorderCrop({ data: raw.data, ...raw.info });
}

test("the Cap Apprentis shape: a 4:5 file containing a 2:3 photo with white side bars becomes a full 4:5 image", async () => {
  const input = await sharp(await photo(450, 675)).extend({ left: 45, right: 45, top: 0, bottom: 0, background: "#fff" }).png().toBuffer();
  assert.deepEqual(await detected(input), { left: 45, top: 0, width: 450, height: 675 });
  const output = await normalizer.normalizeGeneratedAiImage(input, { width: 540, height: 675 });
  assert.deepEqual([output.width, output.height], [540, 675]);
  assert.equal(await detected(output.buffer), null);
  const sample = await sharp(output.buffer).raw().toBuffer({ resolveWithObject: true });
  for (const [x, y] of [[1, 1], [538, 1], [1, 673], [538, 673]]) {
    const offset = (y * 540 + x) * sample.info.channels;
    assert.ok(Math.min(...sample.data.subarray(offset, offset + 3)) < 220, "Every corner contains the picture, not a white canvas.");
    assert.ok(Math.max(...sample.data.subarray(offset, offset + 3)) > 40, "No black matte replaces the white one.");
  }
});

test("all output formats crop to fill instead of stretching the source or surrounding it with a blurred copy", async () => {
  const input = await photo(480, 720);
  for (const [width, height] of [[480, 480], [480, 600], [360, 640], [640, 360]]) {
    const output = await normalizer.normalizeGeneratedAiImage(input, { width, height });
    const actual = await sharp(output.buffer).resize(80, 80).removeAlpha().raw().toBuffer();
    // Render the expected geometry in a separate pass: Sharp applies one resize
    // per pipeline, so the contract reference must materialize the chosen crop.
    const reference = await sharp(await sharp(input).resize({ width, height, fit: "cover", position: "centre" }).png().toBuffer()).resize(80, 80).removeAlpha().raw().toBuffer();
    assert.equal(actual.length, reference.length);
    const error = actual.reduce((sum, value, index) => sum + Math.abs(value - reference[index]), 0) / actual.length;
    assert.ok(error < 3, `Output ${width}×${height} must preserve the full-frame crop geometry, error=${error}`);
  }
});

test("paired white/black bars are recognized in both orientations but blank graphics and studio backgrounds are preserved", async () => {
  for (const background of ["#ffffff", "#000000"]) {
    const vertical = await sharp(await photo(320, 400)).extend({ left: 32, right: 32, top: 0, bottom: 0, background }).png().toBuffer();
    assert.deepEqual(await detected(vertical), { left: 32, top: 0, width: 320, height: 400 });
    const horizontal = await sharp(await photo(400, 320)).extend({ left: 0, right: 0, top: 32, bottom: 32, background }).png().toBuffer();
    assert.deepEqual(await detected(horizontal), { left: 0, top: 32, width: 400, height: 320 });
    const studio = await sharp({ create: { width: 400, height: 400, channels: 3, background } })
      .composite([{ input: Buffer.from('<svg width="140" height="140"><circle cx="70" cy="70" r="65" fill="#dc2828"/></svg>'), left: 130, top: 130 }]).png().toBuffer();
    assert.equal(await detected(studio), null, "A product on white or a subject in darkness is not a rectangular matte.");
    const blank = await sharp({ create: { width: 400, height: 400, channels: 3, background } }).png().toBuffer();
    assert.equal(await detected(blank), null);
  }
  const asymmetric = await sharp(await photo(320, 400)).extend({ left: 40, right: 0, top: 0, bottom: 0, background: "#fff" }).png().toBuffer();
  assert.equal(await detected(asymmetric), null, "One-sided composition space must not be mistaken for paired provider bars.");
});

test("border detection follows EXIF orientation before cropping the chosen canvas", async () => {
  const padded = await sharp(await photo(320, 480)).extend({ left: 32, right: 32, top: 0, bottom: 0, background: "#fff" }).jpeg().toBuffer();
  const input = await sharp(padded).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const output = await normalizer.normalizeGeneratedAiImage(input, { width: 640, height: 360 });
  assert.deepEqual([output.width, output.height], [640, 360]);
  assert.equal(await detected(output.buffer), null);
  const top = await sharp(output.buffer).extract({ left: 0, top: 0, width: 640, height: 5 }).stats();
  assert.ok(top.channels[0].mean < 200 && top.channels[1].mean < 230, "The rotated white bars must not survive on the top edge.");
});

test("the contact compositor fills the base before drawing the specifically requested logo and exact text", async () => {
  const input = await photo(400, 600);
  const logo = await sharp({ create: { width: 70, height: 40, channels: 3, background: "#ff00ff" } }).png().toBuffer();
  const output = await contact.composeAiMediaContactImage({ input, width: 540, height: 675,
    headline: "Diagnostic et soin", phone: "01 23 45 67 89", officialLogo: logo, logoMode: "visible", brandColors: ["#123456", "#654321", "#336699"] });
  const metadata = await sharp(output).metadata();
  assert.deepEqual([metadata.width, metadata.height], [540, 675]);
  assert.equal(await detected(output), null);
  const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let logoPixels = 0;
  for (let index = 0; index < data.length; index += info.channels) if (data[index] > 200 && data[index + 1] < 70 && data[index + 2] > 200) logoPixels += 1;
  assert.ok(logoPixels > 1_000, "The requested official logo is added after the crop and remains visible.");
});

test("image modification retains its authoritative source canvas and existing graphic margins", async () => {
  const input = await sharp(await photo(320, 400)).extend({ left: 40, right: 40, top: 0, bottom: 0, background: "#fff" }).png().toBuffer();
  const output = await normalizer.normalizeGeneratedAiImage(input, { width: 400, height: 400, canvasMode: "source" });
  assert.deepEqual(await detected(output.buffer), { left: 40, top: 0, width: 320, height: 400 });
});

test("video border agreement rejects fades, changing geometry and a missing scan", () => {
  const crop = { left: 20, top: 0, width: 160, height: 200 };
  assert.deepEqual(fullFrame.agreeAiMediaFrameCrops([crop, crop, crop]), crop);
  assert.equal(fullFrame.agreeAiMediaFrameCrops([crop, null, crop]), null);
  assert.equal(fullFrame.agreeAiMediaFrameCrops([crop, crop, { ...crop, left: 30, width: 140 }]), null);
  assert.equal(fullFrame.agreeAiMediaFrameCrops([crop, crop]), null);
});
