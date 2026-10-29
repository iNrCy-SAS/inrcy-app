import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";
import * as videoLayout from "../../lib/aiMediaVideoLayout.ts";
import * as textIntegrity from "../../lib/aiMediaTextIntegrity.ts";
import type { composeAiMediaBrandedImage, renderAiMediaVideoOverlay } from "../../lib/aiMediaBrandRenderer.ts";

type ImageArgs = Parameters<typeof composeAiMediaBrandedImage>[0];
const source = readFileSync(new URL("../../lib/aiMediaBrandRenderer.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const nativeRequire = createRequire(import.meta.url);
const runtime = { exports: {} as { composeAiMediaBrandedImage: typeof composeAiMediaBrandedImage; renderAiMediaVideoOverlay: typeof renderAiMediaVideoOverlay } };
const dependencies = new Map<string, unknown>([
  ["server-only", {}], ["sharp", sharp], ["@/lib/aiMediaVideoLayout", videoLayout], ["@/lib/aiMediaTextIntegrity", textIntegrity],
]);
new Function("module", "exports", "require", javascript)(runtime, runtime.exports, (id: string) => {
  if (dependencies.has(id)) return dependencies.get(id);
  if (id.startsWith("node:")) return nativeRequire(id);
  throw new Error(`unexpected_dependency:${id}`);
});

async function logo(width = 120, height = 30) {
  return sharp({ create: { width, height, channels: 4, background: "#ed1f8a" } }).png().toBuffer();
}

async function solid(width = 1000, height = 800, color = "#17263e") {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

function args(input: Buffer, logoBuffer: Buffer, overrides: Partial<ImageArgs> = {}): ImageArgs {
  return { input, width: 1000, height: 800, logo: logoBuffer, requireLogo: true, logoMode: "visible", colors: ["#ed1f8a", "#1b68d8", "#ffffff"],
    companyName: "Synthetic logo fixture", visualStyle: "clean", withText: false,
    scene: { eyebrow: "", title: "", body: "", spokenLine: "", spokenReply: "", visualBrief: "", layout: "editorial" }, ...overrides };
}

async function coloredLogoBounds(input: Buffer) {
  const { data, info } = await sharp(input).toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * 3;
    if (data[offset] > 170 && data[offset + 1] < 75 && data[offset + 2] > 90 && data[offset + 2] < 200) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); count++;
    }
  }
  return { minX, minY, maxX, maxY, count, width: maxX - minX + 1, height: maxY - minY + 1 };
}

test("image logo is readable by default, including a small source file, while video remains discreet", async () => {
  const imageArgs = args(await solid(), await logo());
  const image = await runtime.exports.composeAiMediaBrandedImage(imageArgs);
  const imageBounds = await coloredLogoBounds(image);
  assert.ok(imageBounds.width >= 260 && imageBounds.height >= 60, JSON.stringify(imageBounds));
  assert.ok(imageBounds.width <= 275 && imageBounds.height <= 180);
  assert.ok(imageBounds.minX >= 35 && imageBounds.minY >= 30);
  assert.ok(imageBounds.maxX < 965 && imageBounds.maxY < 770);
  const video = await runtime.exports.renderAiMediaVideoOverlay(imageArgs);
  const videoBounds = await coloredLogoBounds(video);
  assert.ok(videoBounds.minX >= 830 && videoBounds.minY >= 30, JSON.stringify(videoBounds));
  assert.ok(videoBounds.width <= 120 && videoBounds.height <= 30, "the video logo must not be enlarged by the image policy");
  assert.ok(imageBounds.count > videoBounds.count * 3);
});

async function detailedBackground(quiet: "top-left" | "bottom-right") {
  const width = 1000, height = 800;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const isQuiet = quiet === "top-left" ? x < 380 && y < 250 : x > 620 && y > 550;
    const value = isQuiet ? 210 : (Math.floor(x / 9) + Math.floor(y / 9)) % 2 ? 240 : 10;
    const offset = (y * width + x) * 3;
    pixels[offset] = value; pixels[offset + 1] = value; pixels[offset + 2] = value;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

test("placement follows quiet image regions instead of always using the upper right", async () => {
  const actualLogo = await logo(600, 140);
  for (const quiet of ["top-left", "bottom-right"] as const) {
    const output = await runtime.exports.composeAiMediaBrandedImage(args(await detailedBackground(quiet), actualLogo));
    const bounds = await coloredLogoBounds(output);
    assert.ok(bounds.count > 10_000);
    if (quiet === "top-left") assert.ok(bounds.maxX < 380 && bounds.maxY < 250, JSON.stringify(bounds));
    else assert.ok(bounds.minX > 620 && bounds.minY > 550, JSON.stringify(bounds));
  }
});

test("explicit position and size override background preference without cropping the logo", async () => {
  const common = args(await detailedBackground("top-left"), await logo(600, 140), { logoPlacement: { horizontal: "right", vertical: "bottom", size: "small" } });
  const small = await coloredLogoBounds(await runtime.exports.composeAiMediaBrandedImage(common));
  const large = await coloredLogoBounds(await runtime.exports.composeAiMediaBrandedImage({ ...common, logoPlacement: { horizontal: "right", vertical: "bottom", size: "large" } }));
  assert.ok(small.minX > 800 && small.minY > 680, JSON.stringify(small));
  assert.ok(large.minX > 550 && large.minY > 630, JSON.stringify(large));
  assert.ok(large.count > small.count * 5);
  for (const bounds of [small, large]) assert.ok(bounds.maxX < 965 && bounds.maxY < 770);
});

test("an unavoidable matching background receives an alpha halo, not a solid branding badge", async () => {
  const whiteMark = await sharp({ create: { width: 160, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 120, height: 40, channels: 4, background: "#ffffff" } }).png().toBuffer(), left: 20, top: 20 }]).png().toBuffer();
  const output = await runtime.exports.composeAiMediaBrandedImage(args(await solid(1000, 800, "#ffffff"), whiteMark, { logoPlacement: { horizontal: "left", vertical: "top" } }));
  const { data } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [...data.subarray((y * 1000 + x) * 3, (y * 1000 + x) * 3 + 3)];
  assert.ok(pixel(100, 65).every(value => value > 245), "the actual white logo is retained");
  assert.ok(pixel(44, 65).every(value => value < 230), "a contrasting narrow edge separates the white logo");
  assert.ok(pixel(400, 200).every(value => value > 245), "the rest of the photo stays untouched");
});
