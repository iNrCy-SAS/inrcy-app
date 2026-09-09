import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import sharp from "sharp";
import ts from "typescript";

import {
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
} from "../../lib/mediaVideoNormalizer.ts";
import * as videoLayout from "../../lib/aiMediaVideoLayout.ts";

const execFileAsync = promisify(execFile);
const requireFromTest = createRequire(import.meta.url);

type ComposerModule = {
  composeOriginalAiVideo: (args: {
    clips: Array<{
      buffer: Buffer;
      durationSeconds: 4 | 6 | 8;
      sourceStartSeconds?: number;
    }>;
    overlays: Buffer[];
    width: number;
    height: number;
    durationSeconds: 8 | 16 | 24;
    nativeAudioMode?: "ambience" | "dialogue" | "mute";
    captionLayout?: "overlay" | "caption-band";
  }) => Promise<{ buffer: Buffer }>;
};

type BrandRendererModule = {
  wrapAiMediaOverlayText: (
    value: string,
    maxCharacters: number,
    maxLines: number,
  ) => string[];
  wrapAiMediaOverlayBodyText: (
    value: string,
    maxCharacters: number,
    maxLines: number,
  ) => string[];
  renderAiMediaVideoOverlay: (args: {
    width: number;
    height: number;
    logo: Buffer | null;
    colors: [string, string, string];
    companyName: string;
    visualStyle: "clean";
    logoMode: "discreet" | "visible" | "none";
    scene: {
      eyebrow: string;
      title: string;
      body: string;
      layout: "editorial";
    };
    withText: boolean;
    captionLayout?: "overlay" | "caption-band";
  }) => Promise<Buffer>;
};

test("l’accroche utilise entièrement sa dernière ligne avant de l’abréger", () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts",
  );
  assert.deepEqual(
    runtime.wrapAiMediaOverlayText(
      "Face à une demande urgente, un artisan passe à l’action",
      24,
      3,
    ),
    ["Face à une demande", "urgente, un artisan", "passe à l’action"],
  );
});

test("un texte secondaire trop long conserve une phrase entière ou disparaît", () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts",
  );
  assert.deepEqual(
    runtime.wrapAiMediaOverlayBodyText(
      "Une solution simple et rapide. Elle centralise toutes vos publications sur chaque canal.",
      24,
      2,
    ),
    ["Une solution simple et", "rapide."],
  );
  assert.deepEqual(
    runtime.wrapAiMediaOverlayBodyText(
      "On peut prendre rendez-vous et parler de votre communication digitale avec notre équipe",
      24,
      2,
    ),
    [],
  );
  assert.deepEqual(
    runtime.wrapAiMediaOverlayBodyText(
      "On peut prendre rendez-vous et parler de",
      43,
      2,
    ),
    [],
  );
});

test("une accroche raccourcie ne finit jamais par des points de suspension ni un mot pendant", () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts",
  );
  const lines = runtime.wrapAiMediaOverlayText(
    "Développez votre visibilité avec une communication pensée pour votre entreprise et",
    24,
    2,
  );
  const visible = lines.join(" ");
  assert.doesNotMatch(visible, /(?:…|\.{3})$/);
  assert.doesNotMatch(visible, /\b(?:avec|de|des|du|et|pour|sur|un|une)$/i);
});

function transpileRuntimeModule<T>(relativePath: string): T {
  const source = readFileSync(
    new URL(relativePath, import.meta.url),
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
    if (specifier === "@/lib/mediaVideoNormalizer") {
      return { probeVideoSource, resolveVideoNormalizationFfmpegPath };
    }
    if (specifier === "@/lib/aiMediaVideoLayout") return videoLayout;
    return requireFromTest(specifier);
  };
  const execute = new Function("module", "exports", "require", output);
  execute(moduleRecord, moduleRecord.exports, localRequire);
  return moduleRecord.exports as T;
}

test("le compositeur remplit réellement un carré depuis un plan Veo 16:9", async () => {
  const runtime = transpileRuntimeModule<ComposerModule>(
    "../../lib/aiMediaGeneratedVideo.ts",
  );
  const directory = await mkdtemp(path.join(tmpdir(), "inrcy-cover-test-"));
  const sourcePath = path.join(directory, "source-16x9.mp4");
  const outputPath = path.join(directory, "output-square.mp4");
  const framePath = path.join(directory, "frame.png");
  const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0xed2945:s=640x360:r=30:d=8",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-an",
        sourcePath,
      ],
      { timeout: 45_000, windowsHide: true },
    );
    const transparentOverlay = await sharp({
      create: {
        width: 320,
        height: 320,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const composed = await runtime.composeOriginalAiVideo({
      clips: [
        {
          buffer: await readFile(sourcePath),
          durationSeconds: 8,
        },
      ],
      overlays: [transparentOverlay],
      width: 320,
      height: 320,
      durationSeconds: 8,
      nativeAudioMode: "mute",
    });
    await writeFile(outputPath, composed.buffer);
    await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-ss",
        "2",
        "-i",
        outputPath,
        "-frames:v",
        "1",
        framePath,
      ],
      { timeout: 30_000, windowsHide: true },
    );
    const frame = sharp(framePath);
    const metadata = await frame.metadata();
    assert.equal(metadata.width, 320);
    assert.equal(metadata.height, 320);
    for (const top of [0, 140, 300]) {
      const stats = await frame
        .clone()
        .extract({ left: 0, top, width: 320, height: 20 })
        .stats();
      assert.ok(stats.channels[0]!.mean > 180, `rouge visible à y=${top}`);
      assert.ok(stats.channels[1]!.mean < 90, `aucune bande grise/noire à y=${top}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("la bande vidéo réserve la même géométrie paire au texte et au plan", () => {
  for (const [width, height] of [[1080, 1080], [1080, 1920], [1920, 1080], [1080, 1350], [320, 320]]) {
    const { content, caption } = videoLayout.resolveAiMediaVideoLayout({ width: width!, height: height!, captionLayout: "caption-band" });
    assert.equal(content.height + caption.height, height);
    assert.equal(content.height, caption.top);
    assert.equal(content.height % 2, 0);
    assert.equal(caption.height % 2, 0);
    assert.ok(caption.height >= 64);
    assert.ok(caption.height <= height! * 0.32);
    assert.equal(videoLayout.resolveAiMediaVideoLayout({ width: width!, height: height! }).caption.height, 0);
  }
});

test("tout l’habillage reste sous le plan même avec un titre long et un logo", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>("../../lib/aiMediaBrandRenderer.ts");
  const logo = await sharp({ create: { width: 100, height: 220, channels: 4, background: "#db2777" } }).png().toBuffer();
  for (const [width, height] of [[1080, 1080], [1080, 1920], [1920, 1080], [320, 320]]) {
    const { caption } = videoLayout.resolveAiMediaVideoLayout({ width: width!, height: height!, captionLayout: "caption-band" });
    const overlay = await runtime.renderAiMediaVideoOverlay({
      width: width!, height: height!, logo, colors: ["#0ea5e9", "#8b5cf6", "#db2777"], companyName: "Entreprise test", visualStyle: "clean", logoMode: "visible", withText: true, captionLayout: "caption-band",
      scene: { eyebrow: "Votre communication", title: "Découvrez l’évolution de l’outil Booster et publiez vos stories plus facilement", body: "Votre visibilité progresse.", layout: "editorial" },
    });
    const { data, info } = await sharp(overlay).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, width);
    assert.equal(info.height, height);
    let captionWhitePixels = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const offset = (y * info.width + x) * 4;
        if (y < caption.top) assert.equal(data[offset + 3], 0, `plan intact à ${width}x${height} / ${x},${y}`);
        else {
          assert.equal(data[offset + 3], 255, "bande entièrement opaque");
          if (data[offset]! > 170 && data[offset + 1]! > 170 && data[offset + 2]! > 170) captionWhitePixels += 1;
        }
      }
    }
    assert.ok(captionWhitePixels > width! / 4, `titre réellement rasterisé dans la bande ${width}x${height}: ${captionWhitePixels} pixels blancs`);
  }
});

test("le mode sans texte ignore la bande et conserve le calque transparent", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>("../../lib/aiMediaBrandRenderer.ts");
  const overlay = await runtime.renderAiMediaVideoOverlay({
    width: 320, height: 320, logo: null, colors: ["#0ea5e9", "#8b5cf6", "#db2777"], companyName: "Test", visualStyle: "clean", logoMode: "none", withText: false, captionLayout: "caption-band",
    scene: { eyebrow: "Repère", title: "Titre", body: "Corps", layout: "editorial" },
  });
  const alpha = await sharp(overlay).extractChannel(3).stats();
  assert.equal(alpha.channels[0]!.max, 0);
});

test("la composition avec bande conserve les quatre bords du plan source", async () => {
  const runtime = transpileRuntimeModule<ComposerModule>("../../lib/aiMediaGeneratedVideo.ts");
  const directory = await mkdtemp(path.join(tmpdir(), "inrcy-caption-contain-test-"));
  const sourcePath = path.join(directory, "source.mp4");
  const outputPath = path.join(directory, "output.mp4");
  const framePath = path.join(directory, "frame.png");
  const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", "color=c=0xed2945:s=640x360:r=30:d=8",
      "-vf", "drawbox=x=0:y=0:w=35:h=ih:color=0x00ff00:t=fill,drawbox=x=iw-35:y=0:w=35:h=ih:color=0x0000ff:t=fill,drawbox=x=35:y=0:w=iw-70:h=30:color=0xffff00:t=fill,drawbox=x=35:y=ih-30:w=iw-70:h=30:color=0xff00ff:t=fill",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", sourcePath,
    ], { timeout: 45_000, windowsHide: true });
    const overlay = await sharp({ create: { width: 320, height: 320, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const composed = await runtime.composeOriginalAiVideo({ clips: [{ buffer: await readFile(sourcePath), durationSeconds: 8 }], overlays: [overlay], width: 320, height: 320, durationSeconds: 8, nativeAudioMode: "mute", captionLayout: "caption-band" });
    await writeFile(outputPath, composed.buffer);
    await execFileAsync(ffmpegPath, ["-hide_banner", "-nostdin", "-y", "-ss", "2", "-i", outputPath, "-frames:v", "1", framePath], { timeout: 30_000, windowsHide: true });
    const { content } = videoLayout.resolveAiMediaVideoLayout({ width: 320, height: 320, captionLayout: "caption-band" });
    const imageTop = (content.height - 180) / 2;
    const pixelAt = async (left: number, top: number) => {
      const { data } = await sharp(framePath).extract({ left, top, width: 4, height: 4 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return [data[0]!, data[1]!, data[2]!];
    };
    const left = await pixelAt(4, imageTop + 70);
    const right = await pixelAt(310, imageTop + 70);
    const top = await pixelAt(150, imageTop + 4);
    const bottom = await pixelAt(150, imageTop + 170);
    assert.ok(left[1]! > 170 && left[0]! < 80, "bord gauche vert conservé");
    assert.ok(right[2]! > 170 && right[0]! < 80, "bord droit bleu conservé");
    assert.ok(top[0]! > 170 && top[1]! > 170, "bord supérieur jaune conservé");
    assert.ok(bottom[0]! > 170 && bottom[2]! > 170, "bord inférieur magenta conservé");
    const captionPixel = await pixelAt(150, content.height + 20);
    assert.ok(Math.max(...captionPixel) < 40, "aucun pixel source dans la bande réservée");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("le logo transparent reste discret, sans pastille blanche et en zone sûre", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts",
  );
  const logo = await sharp({
    create: {
      width: 300,
      height: 120,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="300" height="120" xmlns="http://www.w3.org/2000/svg"><rect x="35" y="35" width="230" height="50" rx="18" fill="#db2777"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  const overlay = await runtime.renderAiMediaVideoOverlay({
    width: 1080,
    height: 1080,
    logo,
    colors: ["#0ea5e9", "#8b5cf6", "#db2777"],
    companyName: "Entreprise test",
    visualStyle: "clean",
    logoMode: "discreet",
    scene: {
      eyebrow: "Repère",
      title: "Titre",
      body: "Corps",
      layout: "editorial",
    },
    withText: false,
  });
  const { data, info } = await sharp(overlay)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let maxX = -1;
  let minY = info.height;
  let maxY = -1;
  let whiteOpaquePixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 4;
      const alpha = data[offset + 3]!;
      if (alpha <= 12) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (
        alpha > 220 &&
        data[offset]! > 240 &&
        data[offset + 1]! > 240 &&
        data[offset + 2]! > 240
      ) {
        whiteOpaquePixels += 1;
      }
    }
  }
  assert.ok(maxX >= minX && maxY >= minY, "logo visible");
  assert.ok(maxX - minX + 1 <= Math.ceil(1080 * 0.12));
  assert.ok(maxY - minY + 1 <= Math.ceil(1080 * 0.048));
  assert.ok(minX >= Math.floor(1080 * 0.8), "logo dans le coin droit");
  assert.ok(minY >= Math.floor(1080 * 0.04), "marge haute sûre");
  assert.equal(whiteOpaquePixels, 0, "aucun fond blanc ajouté");
});

test("un canvas blanc est détouré sans effacer un vrai logo blanc transparent", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts",
  );
  const scene = {
    eyebrow: "Repère",
    title: "Titre",
    body: "Corps",
    layout: "editorial" as const,
  };
  const render = (logo: Buffer) =>
    runtime.renderAiMediaVideoOverlay({
      width: 1080,
      height: 1080,
      logo,
      colors: ["#0ea5e9", "#8b5cf6", "#db2777"],
      companyName: "Entreprise test",
      visualStyle: "clean",
      logoMode: "discreet",
      scene,
      withText: false,
    });

  // Un JPEG quasi blanc reproduit les logos historiques sans canal alpha et
  // vérifie aussi que les artefacts de compression sont correctement fondus.
  const whiteCanvasLogo = await sharp({
    create: {
      width: 420,
      height: 160,
      channels: 3,
      background: { r: 252, g: 251, b: 249 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="420" height="160" xmlns="http://www.w3.org/2000/svg"><circle cx="118" cy="80" r="42" fill="#0ea5e9"/><rect x="175" y="45" width="185" height="70" rx="22" fill="#db2777"/></svg>',
        ),
      },
    ])
    .jpeg({ quality: 91, chromaSubsampling: "4:2:0" })
    .toBuffer();
  const detached = await sharp(await render(whiteCanvasLogo))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let detachedWhitePixels = 0;
  let detachedColorPixels = 0;
  for (let offset = 0; offset < detached.data.length; offset += 4) {
    const red = detached.data[offset] || 0;
    const green = detached.data[offset + 1] || 0;
    const blue = detached.data[offset + 2] || 0;
    const alpha = detached.data[offset + 3] || 0;
    if (alpha > 220 && red > 238 && green > 238 && blue > 238) {
      detachedWhitePixels += 1;
    }
    if (
      alpha > 180 &&
      ((blue > 130 && green > 80 && red < 80) ||
        (red > 150 && blue > 80 && green < 110))
    ) {
      detachedColorPixels += 1;
    }
  }
  assert.ok(detachedColorPixels > 400, "éléments colorés conservés");
  assert.equal(detachedWhitePixels, 0, "canvas blanc réellement transparent");

  const transparentWhiteLogo = await sharp({
    create: {
      width: 320,
      height: 130,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="320" height="130" xmlns="http://www.w3.org/2000/svg"><rect x="45" y="35" width="230" height="60" rx="20" fill="#ffffff"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  const preserved = await sharp(await render(transparentWhiteLogo))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let preservedWhitePixels = 0;
  for (let offset = 0; offset < preserved.data.length; offset += 4) {
    if (
      preserved.data[offset + 3]! > 220 &&
      preserved.data[offset]! > 245 &&
      preserved.data[offset + 1]! > 245 &&
      preserved.data[offset + 2]! > 245
    ) {
      preservedWhitePixels += 1;
    }
  }
  assert.ok(
    preservedWhitePixels > 400,
    "les éléments blancs sur transparence ne sont jamais supprimés",
  );
});
