import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";
import ts from "typescript";
import * as ctaPhones from "../../lib/ctaPhoneNumbers.ts";

import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";
import {
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
} from "../../lib/mediaVideoNormalizer.ts";

type RuntimeModule = {
  createBrandMotionFrame: (args: {width:number;height:number;phone:string;headline?:string}) => Promise<Buffer>;
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
    durationSeconds: number;
    videoEngine?: "wan3";
    signal?: AbortSignal;
  }) => Promise<{
    provider: string;
    model: string;
    clips: Array<{
      buffer: Buffer;
      durationSeconds: number;
      sourceStartSeconds?: number;
    }>;
    warnings: string[];
  }>;
};

const requireFromTest = createRequire(import.meta.url);

function loadRuntime(onSvg?: (svg:string)=>void): RuntimeModule {
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
    if (specifier === "./ctaPhoneNumbers.ts") return ctaPhones;
    if (specifier === "sharp") return (...args:Parameters<typeof sharp>)=>{
      if(Buffer.isBuffer(args[0])&&args[0].toString("utf8").startsWith("<svg"))onSvg?.(args[0].toString("utf8"));
      return sharp(...args);
    };
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

test("brand motion frame keeps both registered phones as readable separate lines",async()=>{
  const svgs:string[]=[];
  const runtime=loadRuntime(svg=>svgs.push(svg));
  for(const [width,height] of [[320,320],[1080,1080],[1080,1920],[1920,1080]]){
    const frame=await runtime.createBrandMotionFrame({width,height,phone:"+243981837026 / +8618666071730",headline:"Contactez-nous"});
    assert.equal((await sharp(frame).metadata()).width,width);
    const lines=[...svgs.at(-1)!.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>(TEL  [^<]+)<\/text>/g)];
    assert.deepEqual(lines.map(line=>line[4]),["TEL  +243981837026","TEL  +8618666071730"]);
    assert.ok(Number(lines[1][2])>Number(lines[0][2]));
    for(const line of lines)assert.ok(Number(line[1])+line[4].length*Number(line[3])*0.65<=width);
  }
});

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

test("le dernier recours 16 secondes garde un mouvement continu et expose deux tranches", async () => {
  const runtime = loadRuntime();
  const montage = await syntheticPortrait(
    { r: 24, g: 52, b: 92 },
    { r: 224, g: 231, b: 255 },
  );
  const result = await runtime.createReferenceTeamFallbackVideo({
    montage,
    width: 320,
    height: 320,
    durationSeconds: 16,
  });
  assert.equal(result.clips.length, 2);
  assert.deepEqual(
    result.clips.map((clip) => clip.durationSeconds),
    [8, 8],
  );
  assert.deepEqual(
    result.clips.map((clip) => clip.sourceStartSeconds),
    [0, 8],
  );
  assert.strictEqual(
    result.clips[0]?.buffer,
    result.clips[1]?.buffer,
    "les deux actes découpent le même MP4 continu",
  );
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "inrcy-continuation-fallback-test-"),
  );
  const temporaryPath = path.join(temporaryDirectory, "fallback.mp4");
  try {
    await writeFile(temporaryPath, result.clips[0]!.buffer);
    const metadata = await probeVideoSource({
      ffmpegPath: await resolveVideoNormalizationFfmpegPath(),
      inputPath: temporaryPath,
      timeoutMs: 45_000,
    });
    assert.ok(Math.abs(metadata.durationSeconds - 16) <= 0.35);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("un secours Wan natif de 16 secondes conserve un seul clip", async () => {
  const runtime = loadRuntime();
  const montage = await syntheticPortrait({ r: 24, g: 52, b: 92 }, { r: 224, g: 231, b: 255 });
  const result = await runtime.createReferenceTeamFallbackVideo({ montage, width: 320, height: 320, durationSeconds: 16, videoEngine: "wan3" });
  assert.equal(result.clips.length, 1);
  assert.equal(result.clips[0]?.durationSeconds, 16);
  assert.equal(result.clips[0]?.sourceStartSeconds, 0);
});
