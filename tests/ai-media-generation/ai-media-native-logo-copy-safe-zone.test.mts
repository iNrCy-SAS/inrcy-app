import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";
import * as videoLayout from "../../lib/aiMediaVideoLayout.ts";
import * as textIntegrity from "../../lib/aiMediaTextIntegrity.ts";
import * as ctaPhoneNumbers from "../../lib/ctaPhoneNumbers.ts";
import type * as renderer from "../../lib/aiMediaBrandRenderer.ts";

type ImageArgs = Parameters<typeof renderer.composeAiMediaBrandedImage>[0];
const capturedText: string[] = [];
const recordingSharp = Object.assign((input: Parameters<typeof sharp>[0], options?: Parameters<typeof sharp>[1]) => {
  const text = (input as { text?: { text?: string } } | undefined)?.text?.text;
  if (text) capturedText.push(text.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  return sharp(input, options);
}, sharp);
const source = readFileSync(new URL("../../lib/aiMediaBrandRenderer.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const runtime = { exports: {} as typeof renderer };
const nativeRequire = createRequire(import.meta.url);
const dependencies = new Map<string, unknown>([
  ["server-only", {}], ["sharp", recordingSharp], ["@/lib/aiMediaVideoLayout", videoLayout], ["@/lib/aiMediaTextIntegrity", textIntegrity],
]);
new Function("module", "exports", "require", javascript)(runtime, runtime.exports, (id: string) => {
  if (dependencies.has(id)) return dependencies.get(id);
  if (id.startsWith("node:")) return nativeRequire(id);
  throw new Error(`unexpected_dependency:${id}`);
});

const formats = [
  { name: "landscape", width: 1200, height: 675 }, { name: "square", width: 1080, height: 1080 },
  { name: "portrait", width: 1080, height: 1350 }, { name: "story", width: 1080, height: 1920 },
] as const;

async function fixture(width: number, height: number) {
  const left = Math.round(width * 0.7), top = Math.round(height * 0.1);
  const logo = await sharp({ create: { width: 180, height: 60, channels: 3, background: "#ed1f8a" } }).png().toBuffer();
  const input = await sharp({ create: { width, height, channels: 3, background: "#eeeeee" } })
    .composite([{ input: logo, left, top }]).png().toBuffer();
  return { input, region: { left: left + 10, top: top + 10, width: 150, height: 35 } };
}

function args(input: Buffer, width: number, height: number, overrides: Partial<ImageArgs> = {}): ImageArgs {
  return { input, width, height, logo: null, requireLogo: false, logoMode: "none", colors: ["#112233", "#445566", "#778899"],
    companyName: "Atelier Test", visualStyle: "clean", withText: true, nativeLogoTextSafeZone: true, imagePurpose: "simple",
    scene: { eyebrow: "Atelier Test", title: "Une offre artisanale", body: "Un travail soigne et local", spokenLine: "", spokenReply: "", visualBrief: "", layout: "editorial" },
    copy: { headline: "Une offre artisanale", subline: "Un travail soigne et local", cta: "Contactez notre equipe" }, ...overrides };
}

async function mean(input: Buffer, region: { left: number; top: number; width: number; height: number }) {
  const cropped = await sharp(input).extract(region).png().toBuffer();
  return (await sharp(cropped).stats()).channels.slice(0, 3).map(channel => channel.mean);
}

test("native image exact copy rasterizes all 600 characters and keeps the logo half unshaded", async () => {
  const exactText = `${"Notre atelier imagine des creations utiles et soignees pour chaque client. ".repeat(12).slice(0, 599)}X`;
  assert.equal(exactText.length, 600);
  for (const { name, width, height } of formats) {
    const { input, region } = await fixture(width, height);
    capturedText.length = 0;
    const output = await runtime.exports.composeAiMediaBrandedImage(args(input, width, height, { exactText, contactPhone: "01 23 45 67 89" }));
    const lines = capturedText.filter(text => text !== "ATELIER TEST" && !text.startsWith("Tél."));
    assert.equal(lines.join(" ").replace(/\s+/g, " ").trim(), exactText, name);
    const before = await mean(input, region), after = await mean(output, region);
    after.forEach((channel, index) => assert.ok(Math.abs(channel - before[index]) < 4, `${name}: ${before} -> ${after}`));
    assert.ok(capturedText.some(text => text.includes("01 23 45 67 89")), name);
  }
});

test("native contact copy stays inside the same half, including square images", async () => {
  const contactSource = readFileSync(new URL("../../lib/aiMediaImageContactComposer.ts", import.meta.url), "utf8");
  const contactJavascript = ts.transpileModule(contactSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const contact = { exports: {} as typeof import("../../lib/aiMediaImageContactComposer.ts") };
  new Function("module", "exports", "require", contactJavascript)(contact, contact.exports, (id: string) => {
    if (id === "./ctaPhoneNumbers.ts") return ctaPhoneNumbers;
    if (dependencies.has(id)) return dependencies.get(id);
    throw new Error(`unexpected_dependency:${id}`);
  });
  for (const { name, width, height } of formats) {
    const { input } = await fixture(width, height);
    const portrait = height > width * 1.12;
    const region = { left: portrait ? Math.round(width * 0.7) + 10 : Math.round(width * 0.51), top: Math.round(height * 0.1) + 10, width: 10, height: 30 };
    const before = await mean(input, region);
    const output = await contact.exports.composeAiMediaContactImage({ input, width, height, headline: "Une offre artisanale", phone: "01 23 45 67 89", officialLogo: null, logoMode: "none", nativeLogoTextSafeZone: true });
    const after = await mean(output, region);
    after.forEach((channel, index) => assert.ok(Math.abs(channel - before[index]) < 4, `${name}: ${before} -> ${after}`));
  }
});

test("native scene and commercial image templates confine every layer to the promised copy half", async () => {
  for (const { name, width, height } of formats) {
    const { input, region } = await fixture(width, height);
    const before = await mean(input, region);
    for (const imagePurpose of ["simple", "flyer", "product_sheet", "poster", "banner", "infographic"] as const) {
      capturedText.length = 0;
      const output = await runtime.exports.composeAiMediaBrandedImage(args(input, width, height, { imagePurpose }));
      const after = await mean(output, region);
      after.forEach((channel, index) => assert.ok(Math.abs(channel - before[index]) < 4, `${name}/${imagePurpose}: ${before} -> ${after}`));
      assert.ok(capturedText.join(" ").includes("Une offre artisanale"), `${name}/${imagePurpose}`);
    }
  }
});

test("the native image flag leaves legacy image and video overlays unchanged by default", async () => {
  const { input, region } = await fixture(1200, 675);
  const exactText = "Une copie exacte sans changement du rendu existant.";
  const legacy = args(input, 1200, 675, { exactText, nativeLogoTextSafeZone: undefined });
  const first = await runtime.exports.composeAiMediaBrandedImage(legacy);
  const second = await runtime.exports.composeAiMediaBrandedImage({ ...legacy, nativeLogoTextSafeZone: false });
  assert.deepEqual(first, second);
  const before = await mean(input, region), after = await mean(first, region);
  assert.ok(before[0] - after[0] > 100, "The fixture reproduces the historical full-panel shading");
  const video = await runtime.exports.renderAiMediaVideoOverlay(legacy);
  assert.deepEqual(video, await runtime.exports.renderAiMediaVideoOverlay({ ...legacy, nativeLogoTextSafeZone: false }));
});
