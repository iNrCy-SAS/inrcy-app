import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

import sharp from "sharp";
import ts from "typescript";

import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";
import {
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
} from "../../lib/mediaVideoNormalizer.ts";

type RuntimeModule = {
  createReferenceTeamMontage: (args: {
    references: readonly Buffer[];
    width: number;
    height: number;
    brandColors?: readonly string[];
    officialLogo?: Buffer | null;
  }) => Promise<Buffer>;
  prepareReferenceTeamCompositionForAnimation: (
    input: Buffer,
  ) => Promise<{ mimeType: string; data: string }>;
  createReferenceTeamFallbackVideo: (args: {
    montage: Buffer;
    width: number;
    height: number;
    durationSeconds: 8 | 16 | 24;
    signal?: AbortSignal;
  }) => Promise<{
    provider: string;
    model: string;
    clips: Array<{ buffer: Buffer; durationSeconds: number }>;
    warnings: string[];
  }>;
};

const requireFromTest = createRequire(import.meta.url);

function loadRuntime(): RuntimeModule {
  const source = readFileSync(
    new URL("../../lib/aiMediaReferenceTeam.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
  const localRequire = (specifier: string) => {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/aiMediaVideoTimeline") {
      return { getAiMediaVideoSegmentDurations };
    }
    if (specifier === "@/lib/mediaVideoNormalizer") {
      return { probeVideoSource, resolveVideoNormalizationFfmpegPath };
    }
    return requireFromTest(specifier);
  };
  const execute = new Function("module", "exports", "require", output);
  execute(moduleRecord, moduleRecord.exports, localRequire);
  return moduleRecord.exports as RuntimeModule;
}

async function syntheticPortrait(
  color: { r: number; g: number; b: number },
  accent: { r: number; g: number; b: number },
) {
  const face = Buffer.from(
    `<svg width="420" height="560" viewBox="0 0 420 560" xmlns="http://www.w3.org/2000/svg">
      <rect width="420" height="560" fill="rgb(${color.r},${color.g},${color.b})"/>
      <circle cx="210" cy="220" r="115" fill="rgb(${accent.r},${accent.g},${accent.b})"/>
      <circle cx="170" cy="205" r="12" fill="#111827"/><circle cx="250" cy="205" r="12" fill="#111827"/>
      <path d="M155 270 Q210 315 265 270" fill="none" stroke="#111827" stroke-width="12"/>
    </svg>`,
  );
  return await sharp(face).webp({ quality: 95 }).toBuffer();
}

test("le montage équipe conserve dynamiquement 2 puis 3 références distinctes", async () => {
  const runtime = loadRuntime();
  const references = await Promise.all([
    syntheticPortrait({ r: 185, g: 28, b: 28 }, { r: 254, g: 202, b: 202 }),
    syntheticPortrait({ r: 21, g: 128, b: 61 }, { r: 187, g: 247, b: 208 }),
    syntheticPortrait({ r: 29, g: 78, b: 216 }, { r: 191, g: 219, b: 254 }),
  ]);

  for (const count of [2, 3] as const) {
    const montage = await runtime.createReferenceTeamMontage({
      references: references.slice(0, count),
      width: 720,
      height: 720,
      brandColors: ["#082f49", "#6d28d9", "#db2777"],
    });
    const metadata = await sharp(montage).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 720);
    assert.equal(metadata.height, 720);
    assert.ok(montage.byteLength > 4_000);
  }

  await assert.rejects(
    () =>
      runtime.createReferenceTeamMontage({
        references: references.slice(0, 1),
        width: 720,
        height: 720,
      }),
    /ai_reference_team_count_invalid/,
  );
});

test("la composition équipe est réassainie avant animation", async () => {
  const runtime = loadRuntime();
  const source = await sharp({
    create: {
      width: 1_600,
      height: 900,
      channels: 3,
      background: { r: 60, g: 80, b: 120 },
    },
  })
    .jpeg({ quality: 90 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const prepared = await runtime.prepareReferenceTeamCompositionForAnimation(
    source,
  );
  const buffer = Buffer.from(prepared.data, "base64");
  const metadata = await sharp(buffer).metadata();
  assert.equal(prepared.mimeType, "image/webp");
  assert.equal(metadata.format, "webp");
  assert.ok((metadata.width || 0) <= 1_280);
  assert.ok((metadata.height || 0) <= 1_280);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
});

test("le dernier recours équipe produit réellement un MP4 H264 exploitable", async () => {
  const runtime = loadRuntime();
  const references = await Promise.all([
    syntheticPortrait({ r: 185, g: 28, b: 28 }, { r: 254, g: 202, b: 202 }),
    syntheticPortrait({ r: 21, g: 128, b: 61 }, { r: 187, g: 247, b: 208 }),
  ]);
  const montage = await runtime.createReferenceTeamMontage({
    references,
    width: 320,
    height: 320,
  });
  const result = await runtime.createReferenceTeamFallbackVideo({
    montage,
    width: 320,
    height: 320,
    durationSeconds: 8,
  });
  assert.equal(result.provider, "inrcy-reference-team-local");
  assert.equal(result.clips.length, 1);
  assert.equal(result.clips[0]?.durationSeconds, 8);
  assert.ok((result.clips[0]?.buffer.indexOf(Buffer.from("ftyp")) || 0) >= 4);
  assert.deepEqual(result.warnings, [
    "identity_team_exact_photo_motion_fallback",
  ]);
});

