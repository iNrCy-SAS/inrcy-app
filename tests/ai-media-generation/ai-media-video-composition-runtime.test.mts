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
import * as textIntegrity from "../../lib/aiMediaTextIntegrity.ts";

const execFileAsync = promisify(execFile);
const requireFromTest = createRequire(import.meta.url);

type ComposerModule = {
  composeOriginalAiVideo: (args: {
    clips: Array<{
      buffer: Buffer;
      durationSeconds: number;
      sourceStartSeconds?: number;
    }>;
    overlays: Buffer[];
    width: number;
    height: number;
    durationSeconds: number;
    nativeAudioMode?: "ambience" | "dialogue" | "mute";
    narration?: {
      buffer: Buffer;
      mimeType: string;
      extension: "wav";
      model: string;
      voice: string;
    } | null;
    soundtrack?: { absolutePath: string } | null;
  }) => Promise<{ buffer: Buffer }>;
};

type BrandRendererModule = {
  resolveAiMediaCommercialCardCopy: (value: string) => {
    label: string; price: string; detail: string;
  };
  wrapAiMediaOverlayText: (
    value: string,
    maxCharacters: number,
    maxLines: number
  ) => string[];
  wrapAiMediaOverlayBodyText: (
    value: string,
    maxCharacters: number,
    maxLines: number
  ) => string[];
  wrapAiMediaExactOverlayText: (
    value: string,
    maxCharacters: number,
    maxLines: number
  ) => string[];
  renderAiMediaVideoOverlay: (args: {
    width: number;
    height: number;
    logo: Buffer | null;
    colors: [string, string, string];
    companyName: string;
    visualStyle: "clean";
    logoMode: "discreet" | "visible" | "none";
    logoPlacement?: { horizontal?: "left" | "center" | "right"; vertical?: "top" | "center" | "bottom"; size?: "small" | "large" };
    scene: {
      eyebrow: string;
      title: string;
      body: string;
      layout: "editorial";
    };
    withText: boolean;
    exactText?: string;
    contactPhone?: string;
  }) => Promise<Buffer>;
  composeAiMediaBrandedImage: (args: {
    input: Buffer;
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
    exactText?: string;
    contactPhone?: string;
    imagePurpose?:
      | "flyer"
      | "product_sheet"
      | "poster"
      | "banner"
      | "infographic";
    copy?: {
      headline: string;
      subline: string;
      cta: string;
    };
  }) => Promise<Buffer>;
};

test("l’accroche utilise entièrement sa dernière ligne avant de l’abréger", () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
  );
  assert.deepEqual(
    runtime.wrapAiMediaOverlayText(
      "Face à une demande urgente, un artisan passe à l’action",
      24,
      3
    ),
    ["Face à une demande", "urgente, un artisan", "passe à l’action"]
  );
});

test("un texte secondaire est rééquilibré en entier ou rejeté s’il est incomplet", () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
  );
  const completeBody =
    "Une solution simple et rapide pour centraliser toutes vos publications.";
  const completeBodyLines = runtime.wrapAiMediaOverlayBodyText(completeBody, 24, 2);
  assert.equal(completeBodyLines.join(" "), completeBody);
  assert.ok(completeBodyLines.length <= 2);
  assert.deepEqual(
    runtime.wrapAiMediaOverlayBodyText(
      "On peut prendre rendez-vous et parler de votre communication digitale avec notre équipe",
      24,
      2
    ),
    []
  );
  assert.deepEqual(
    runtime.wrapAiMediaOverlayBodyText(
      "On peut prendre rendez-vous et parler de",
      43,
      2
    ),
    []
  );
});

test("une accroche raccourcie ne finit jamais par des points de suspension ni un mot pendant", () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
  );
  const lines = runtime.wrapAiMediaOverlayText(
    "Développez votre visibilité avec une communication pensée pour votre entreprise et",
    24,
    2
  );
  assert.deepEqual(lines, []);
});

test("un fragment déjà tronqué par le copywriter n’est jamais gravé dans le média", () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
  );
  const visible = runtime
    .wrapAiMediaOverlayText(
      "BATICAD 3D : votre partenaire pour les démarches administr...",
      29,
      3
    )
    .join(" ");
  assert.equal(visible, "");
});

test("une accroche complète calibrée reste intégralement visible", () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
  );
  const headline = "Facilitez vos démarches administratives avec BATICAD 3D";
  assert.equal(
    runtime.wrapAiMediaOverlayText(headline, 29, 3).join(" "),
    headline
  );
});

test("le rendu image et vidéo conserve La Celle Dunoise sans supprimer le dernier mot", () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
  );
  const headline = "Permis de construire pour un bâtiment agricole à La Celle Dunoise";
  assert.equal(runtime.wrapAiMediaOverlayText(headline, 29, 3).join(" "), headline);
});

function transpileRuntimeModule<T>(relativePath: string): T {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
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
    if (specifier === "@/lib/aiMediaTextIntegrity") return textIntegrity;
    return requireFromTest(specifier);
  };
  const execute = new Function("module", "exports", "require", output);
  execute(moduleRecord, moduleRecord.exports, localRequire);
  return moduleRecord.exports as T;
}

test("le compositeur conserve les durées natives de 4, 5, 15 et 30 secondes, avec audio", async () => {
  const runtime = transpileRuntimeModule<ComposerModule>("../../lib/aiMediaGeneratedVideo.ts");
  const directory = await mkdtemp(path.join(tmpdir(), "inrcy-native-duration-test-"));
  const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
  const overlay = await sharp({ create: { width: 320, height: 320, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  try {
    for (const durationSeconds of [4, 5, 15, 30]) {
      const source = path.join(directory, `source-${durationSeconds}.mp4`);
      await execFileAsync(ffmpegPath, ["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", `testsrc2=s=320x320:r=30:d=${durationSeconds}`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${durationSeconds}`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source], { windowsHide: true, timeout: 45_000 });
      const output = await runtime.composeOriginalAiVideo({ clips: [{ buffer: await readFile(source), durationSeconds }], overlays: [overlay], width: 320, height: 320, durationSeconds, nativeAudioMode: "dialogue" });
      const file = path.join(directory, `result-${durationSeconds}.mp4`);
      await writeFile(file, output.buffer);
      const probe = await probeVideoSource({ ffmpegPath, inputPath: file, timeoutMs: 30_000 });
      assert.ok(Math.abs(probe.durationSeconds - durationSeconds) < 0.35);
      assert.equal(probe.hasAudio, true);
      assert.equal(probe.orientedWidth, 320);
    }
    const half = await readFile(path.join(directory, "source-15.mp4"));
    const joined = await runtime.composeOriginalAiVideo({
      clips: [{ buffer: half, durationSeconds: 15 }, { buffer: half, durationSeconds: 15 }],
      overlays: [overlay, overlay], width: 320, height: 320, durationSeconds: 30, nativeAudioMode: "dialogue",
    });
    const joinedPath = path.join(directory, "result-two-clips-30.mp4");
    await writeFile(joinedPath, joined.buffer);
    const joinedProbe = await probeVideoSource({ ffmpegPath, inputPath: joinedPath, timeoutMs: 30_000 });
    assert.ok(Math.abs(joinedProbe.durationSeconds - 30) < 0.35);
    assert.equal(joinedProbe.hasAudio, true, "l'audio natif survit à l'assemblage des deux clips");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function createAudioProbe(ffmpegPath: string, directory: string) {
  const sampleRate = 48_000;
  const toneAmplitude = (pcm: Buffer, frequency: number, startSeconds: number, seconds: number) => {
    const start = Math.round(startSeconds * sampleRate);
    const count = Math.round(seconds * sampleRate);
    assert.ok(pcm.length >= (start + count) * 2, "échantillon PCM complet");
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < count; index += 1) {
      const sample = pcm.readInt16LE((start + index) * 2) / 32_768;
      const phase = (2 * Math.PI * frequency * index) / sampleRate;
      real += sample * Math.cos(phase);
      imaginary += sample * Math.sin(phase);
    }
    return (2 * Math.hypot(real, imaginary)) / count;
  };
  const decodeAudio = async (inputPath: string, name: string) => {
    const decodedPath = path.join(directory, `${name}.pcm`);
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-nostdin", "-y", "-i", inputPath,
      "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(sampleRate),
      "-c:a", "pcm_s16le", "-f", "s16le", decodedPath,
    ], { windowsHide: true, timeout: 30_000 });
    return readFile(decodedPath);
  };
  return { sampleRate, toneAmplitude, decodeAudio };
}

test("une voix off séparée exclut réellement tout l’audio natif même demandé en ambiance", async (context) => {
  const runtime = transpileRuntimeModule<ComposerModule>("../../lib/aiMediaGeneratedVideo.ts");
  const directory = await mkdtemp(path.join(tmpdir(), "inrcy-exclusive-narration-test-"));
  const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
  const sourcePath = path.join(directory, "native-440hz.mp4");
  const narrationPath = path.join(directory, "narration-880hz.wav");
  const outputPath = path.join(directory, "composed.mp4");
  const { sampleRate, toneAmplitude, decodeAudio } = createAudioProbe(ffmpegPath, directory);
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-nostdin", "-y",
      "-f", "lavfi", "-i", "color=c=0x2563eb:s=320x320:r=30:d=4",
      "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=${sampleRate}:duration=4`,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest", sourcePath,
    ], { windowsHide: true, timeout: 45_000 });
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-nostdin", "-y",
      "-f", "lavfi", "-i", `sine=frequency=880:sample_rate=${sampleRate}:duration=2.5`,
      "-c:a", "pcm_s16le", narrationPath,
    ], { windowsHide: true, timeout: 30_000 });
    const overlay = await sharp({
      create: { width: 320, height: 320, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
    const composed = await runtime.composeOriginalAiVideo({
      clips: [{ buffer: await readFile(sourcePath), durationSeconds: 4 }],
      overlays: [overlay], width: 320, height: 320, durationSeconds: 4,
      // A provider can return speech inside its alleged ambience track.
      // Narration must override that request even when a caller forgets mute.
      nativeAudioMode: "ambience",
      narration: {
        buffer: await readFile(narrationPath), mimeType: "audio/wav", extension: "wav",
        model: "local-ffmpeg-fixture", voice: "local-880hz-fixture",
      },
    });
    await writeFile(outputPath, composed.buffer);
    const sourcePcm = await decodeAudio(sourcePath, "source-audio");
    const outputPcm = await decodeAudio(outputPath, "output-audio");
    const sourceNative = toneAmplitude(sourcePcm, 440, 0.25, 2);
    const outputVoice = toneAmplitude(outputPcm, 880, 0.25, 2);
    const outputNativeDuringVoice = toneAmplitude(outputPcm, 440, 0.25, 2);
    const outputNativeAfterVoice = toneAmplitude(outputPcm, 440, 2.9, 1);
    context.diagnostic(JSON.stringify({ sourceNative, outputVoice, outputNativeDuringVoice, outputNativeAfterVoice }));
    assert.ok(sourceNative > 0.05, "le clip source contient réellement le son natif de 440 Hz");
    assert.ok(outputVoice > 0.03, "la voix off de 880 Hz reste audible dans le MP4 final");
    assert.ok(outputNativeDuringVoice < 0.0005, "aucun son natif ne se superpose à la voix off");
    assert.ok(outputNativeAfterVoice < 0.0005, "le son natif ne revient pas après la voix off");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("le mode sans parole supprime l’audio natif et conserve uniquement la musique lorsqu’elle est demandée", async (context) => {
  const runtime = transpileRuntimeModule<ComposerModule>("../../lib/aiMediaGeneratedVideo.ts");
  const directory = await mkdtemp(path.join(tmpdir(), "inrcy-speechless-music-test-"));
  const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
  const sourcePath = path.join(directory, "native-440hz.mp4");
  const soundtrackPath = path.join(directory, "instrumental-880hz.wav");
  const { sampleRate, toneAmplitude, decodeAudio } = createAudioProbe(ffmpegPath, directory);
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-nostdin", "-y",
      "-f", "lavfi", "-i", "color=c=0x2563eb:s=320x320:r=30:d=4",
      "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=${sampleRate}:duration=4`,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest", sourcePath,
    ], { windowsHide: true, timeout: 45_000 });
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-nostdin", "-y",
      "-f", "lavfi", "-i", `sine=frequency=880:sample_rate=${sampleRate}:duration=4`,
      "-c:a", "pcm_s16le", soundtrackPath,
    ], { windowsHide: true, timeout: 30_000 });
    const sourcePcm = await decodeAudio(sourcePath, "source-audio");
    const sourceNative = toneAmplitude(sourcePcm, 440, 0.5, 2);
    assert.ok(sourceNative > 0.05, "le clip source contient réellement le son natif de 440 Hz");
    const overlay = await sharp({
      create: { width: 320, height: 320, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
    for (const withMusic of [false, true]) {
      const outputPath = path.join(directory, `composed-${withMusic ? "music" : "silent"}.mp4`);
      const composed = await runtime.composeOriginalAiVideo({
        clips: [{ buffer: await readFile(sourcePath), durationSeconds: 4 }],
        overlays: [overlay], width: 320, height: 320, durationSeconds: 4,
        nativeAudioMode: "mute", narration: null,
        soundtrack: withMusic ? { absolutePath: soundtrackPath } : null,
      });
      await writeFile(outputPath, composed.buffer);
      const probe = await probeVideoSource({ ffmpegPath, inputPath: outputPath, timeoutMs: 30_000 });
      assert.equal(probe.hasAudio, withMusic, "sans musique, le MP4 ne possède aucune piste audio");
      assert.ok(Math.abs(probe.durationSeconds - 4) < 0.35, "la vidéo garde sa durée complète");
      if (withMusic) {
        const outputPcm = await decodeAudio(outputPath, "output-music");
        const outputMusic = toneAmplitude(outputPcm, 880, 0.5, 2);
        const outputNative = toneAmplitude(outputPcm, 440, 0.5, 2);
        context.diagnostic(JSON.stringify({ sourceNative, outputMusic, outputNative }));
        assert.ok(outputMusic > 0.005, "la musique de 880 Hz reste audible dans le MP4 final");
        assert.ok(outputNative < 0.0005, "aucune parole native de 440 Hz ne se mélange à la musique");
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("le compositeur refuse explicitement trois clips ou une durée hors de 4 à 30 secondes avant tout décodage", async () => {
  const runtime = transpileRuntimeModule<ComposerModule>("../../lib/aiMediaGeneratedVideo.ts");
  const unused = Buffer.from("must-not-be-decoded");
  await assert.rejects(runtime.composeOriginalAiVideo({
    clips: Array.from({ length: 3 }, () => ({ buffer: unused, durationSeconds: 4 })),
    overlays: [unused, unused, unused], width: 320, height: 320, durationSeconds: 12,
  }), /ai_original_video_clip_count_invalid/);
  for (const durationSeconds of [1, 3, 31]) {
    await assert.rejects(runtime.composeOriginalAiVideo({
      clips: [{ buffer: unused, durationSeconds }], overlays: [unused],
      width: 320, height: 320, durationSeconds,
    }), /ai_original_video_clip_count_invalid/);
  }
  await assert.rejects(runtime.composeOriginalAiVideo({
    clips: [{ buffer: unused, durationSeconds: 3 }, { buffer: unused, durationSeconds: 3 }],
    overlays: [unused, unused], width: 320, height: 320, durationSeconds: 6,
  }), /ai_original_video_clip_count_invalid/);
});

test("le compositeur remplit réellement un carré depuis un plan Veo 16:9", async () => {
  const runtime = transpileRuntimeModule<ComposerModule>(
    "../../lib/aiMediaGeneratedVideo.ts"
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
      { timeout: 45_000, windowsHide: true }
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
      { timeout: 30_000, windowsHide: true }
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
      assert.ok(
        stats.channels[1]!.mean < 90,
        `aucune bande grise/noire à y=${top}`
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("le placement vidéo reste plein cadre et s’adapte à chaque ratio", () => {
  const cases = [
    { width: 1080, height: 1080, orientation: "square" },
    { width: 1080, height: 1920, orientation: "portrait" },
    { width: 1920, height: 1080, orientation: "landscape" },
    { width: 1080, height: 1350, orientation: "portrait" },
    { width: 320, height: 320, orientation: "square" },
  ] as const;

  assert.equal(videoLayout.AI_MEDIA_VIDEO_TEXT_LAYOUT, "adaptive-overlay");
  for (const item of cases) {
    const layout = videoLayout.resolveAiMediaVideoOverlayLayout(item);
    const placement = videoLayout.resolveAiMediaVideoCopyPlacement({
      layout,
      titleLineCount: layout.copy.titleMaxLines,
      bodyLineCount: layout.copy.bodyMaxLines,
    });
    assert.equal(layout.width, item.width);
    assert.equal(layout.height, item.height);
    assert.equal(layout.orientation, item.orientation);
    assert.ok(layout.copy.left >= 16);
    assert.ok(layout.copy.maxWidth > item.width * 0.5);
    assert.ok(layout.copy.left + layout.copy.maxWidth <= item.width);
    assert.ok(layout.copy.safeBottom < item.height);
    assert.ok(layout.copy.safeBottom > item.height * 0.75);
    assert.ok(placement.accentTop >= 0);
    assert.ok(placement.titleFirstTop > placement.accentTop);
    assert.ok(placement.bodyFirstTop <= layout.copy.safeBottom);
    assert.ok(layout.logo.marginX >= 16);
    assert.ok(layout.logo.marginY >= 16);
  }
});

test("le texte et le logo restent sur l’image sans bande opaque", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
  );
  const logo = await sharp({
    create: {
      width: 70,
      height: 28,
      channels: 4,
      background: "#db2777",
    },
  })
    .png()
    .toBuffer();

  for (const [width, height] of [
    [320, 320],
    [320, 568],
    [568, 320],
    [320, 400],
  ]) {
    const overlay = await runtime.renderAiMediaVideoOverlay({
      width: width!,
      height: height!,
      logo,
      colors: ["#0ea5e9", "#8b5cf6", "#db2777"],
      companyName: "Entreprise test",
      visualStyle: "clean",
      logoMode: "visible",
      withText: true,
      scene: {
        eyebrow: "Votre communication",
        title: "Publiez plus facilement avec un contenu clair et fidèle",
        body: "Votre visibilité progresse.",
        layout: "editorial",
      },
    });
    const { data, info } = await sharp(overlay)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, width);
    assert.equal(info.height, height);
    assert.equal(data[3], 0, "le haut gauche du plan reste intact");

    let lightTextPixels = 0;
    let maximumOpaqueRowCoverage = 0;
    for (let y = 0; y < info.height; y += 1) {
      let opaquePixels = 0;
      for (let x = 0; x < info.width; x += 1) {
        const offset = (y * info.width + x) * 4;
        const alpha = data[offset + 3]!;
        if (alpha >= 250) opaquePixels += 1;
        if (
          alpha > 180 &&
          data[offset]! > 170 &&
          data[offset + 1]! > 170 &&
          data[offset + 2]! > 170
        ) {
          lightTextPixels += 1;
        }
      }
      maximumOpaqueRowCoverage = Math.max(
        maximumOpaqueRowCoverage,
        opaquePixels / info.width
      );
    }
    assert.ok(
      maximumOpaqueRowCoverage < 0.5,
      `aucune ligne opaque pleine largeur à ${width}x${height}`
    );
    assert.ok(
      lightTextPixels > width! / 4,
      `texte réellement rasterisé sur l’image à ${width}x${height}`
    );

    const bottomAlpha = await sharp(overlay)
      .extract({ left: 0, top: height! - 1, width: width!, height: 1 })
      .extractChannel(3)
      .stats();
    assert.ok(
      bottomAlpha.channels[0]!.mean > 0,
      "dégradé de lisibilité présent"
    );
    assert.ok(
      bottomAlpha.channels[0]!.mean < 220,
      "fond inférieur jamais opaque"
    );
  }
});

test("les images reçoivent elles aussi leur texte exact après la génération", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
  );
  const base = await sharp({
    create: {
      width: 320,
      height: 320,
      channels: 3,
      background: "#2563eb",
    },
  })
    .jpeg()
    .toBuffer();
  const composed = await runtime.composeAiMediaBrandedImage({
    input: base,
    width: 320,
    height: 320,
    logo: null,
    colors: ["#0ea5e9", "#8b5cf6", "#db2777"],
    companyName: "BATICAD 3D",
    visualStyle: "clean",
    logoMode: "none",
    withText: true,
    scene: {
      eyebrow: "",
      title: "Facilitez vos démarches administratives",
      body: "",
      layout: "editorial",
    },
  });
  const metadata = await sharp(composed).metadata();
  const stats = await sharp(composed).stats();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 320);
  assert.ok(
    stats.channels.some((channel) => channel.stdev > 8),
    "le calque éditorial modifie réellement le fond généré"
  );
});

test("le mode texte exact conserve et rasterise les 600 caractères sur image et vidéo", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
  );
  const exactText = `${"mot ".repeat(149)}mots`;
  assert.equal(exactText.length, 600);
  const lines = runtime.wrapAiMediaExactOverlayText(exactText, 40, 20);
  assert.equal(lines.join(" "), exactText);
  assert.ok(lines.length > 3, "une longue copie utilise une vraie grille de lignes");
  assert.ok(lines.length <= 20, "la copie reste dans la zone éditoriale");

  const common = {
    width: 568,
    height: 320,
    logo: null,
    colors: ["#0ea5e9", "#8b5cf6", "#db2777"] as [string, string, string],
    companyName: "Entreprise test",
    visualStyle: "clean" as const,
    logoMode: "none" as const,
    withText: true,
    exactText,
    scene: {
      eyebrow: "",
      title: "",
      body: "",
      layout: "editorial" as const,
    },
  };
  const overlay = await runtime.renderAiMediaVideoOverlay(common);
  const overlayAlpha = await sharp(overlay).extractChannel(3).stats();
  assert.ok(
    overlayAlpha.channels[0]!.max > 150,
    "la vidéo reçoit un calque de longue copie non vide"
  );

  const base = await sharp({
    create: {
      width: common.width,
      height: common.height,
      channels: 3,
      background: "#2563eb",
    },
  })
    .jpeg()
    .toBuffer();
  const composed = await runtime.composeAiMediaBrandedImage({
    ...common,
    input: base,
    imagePurpose: "flyer",
  });
  const imageStats = await sharp(composed).stats();
  assert.ok(
    imageStats.channels.every((channel) => channel.stdev > 8),
    "l'image commerciale reçoit elle aussi le composite exact non vide"
  );
});

test("les cartes commerciales conservent noms, montants et mentions tarifaires", () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts",
  );
  assert.deepEqual(runtime.resolveAiMediaCommercialCardCopy("Standard à 58 € HT par mois"), {
    label: "Standard", price: "58 €", detail: "HT par mois",
  });
  assert.deepEqual(runtime.resolveAiMediaCommercialCardCopy("Premium 108,50 euros TTC / mois"), {
    label: "Premium", price: "108,50 euros", detail: "TTC / mois",
  });
  assert.deepEqual(runtime.resolveAiMediaCommercialCardCopy("Une équipe à votre écoute."), {
    label: "", price: "", detail: "Une équipe à votre écoute.",
  });
});

test("un flyer reçoit une vraie grille commerciale avec offres et CTA", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
  );
  const base = await sharp({
    create: {
      width: 568,
      height: 320,
      channels: 3,
      background: "#f8fafc",
    },
  })
    .jpeg()
    .toBuffer();
  const composed = await runtime.composeAiMediaBrandedImage({
    input: base,
    width: 568,
    height: 320,
    logo: null,
    colors: ["#f97316", "#8b5cf6", "#0ea5e9"],
    companyName: "iNrCy",
    visualStyle: "clean",
    logoMode: "none",
    imagePurpose: "flyer",
    withText: true,
    copy: {
      headline: "Standard ou Premium",
      subline: "standard 58 € / mois · premium 108 € / mois",
      cta: "Comparer les offres",
    },
    scene: {
      eyebrow: "iNrCy",
      title: "Standard ou Premium",
      body: "standard 58 € / mois · premium 108 € / mois",
      layout: "editorial",
    },
  });
  const metadata = await sharp(composed).metadata();
  const stats = await sharp(composed).stats();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 568);
  assert.equal(metadata.height, 320);
  assert.ok(
    stats.channels.every((channel) => channel.mean < 210),
    "la grille du flyer transforme bien le fond clair en composition éditoriale",
  );
  assert.ok(
    stats.channels.some((channel) => channel.stdev > 35),
    "les cartes, accents et CTA produisent une hiérarchie graphique visible",
  );
});

test("chaque format commercial reçoit une composition structurée dédiée", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts",
  );
  const base = await sharp({
    create: {
      width: 420,
      height: 420,
      channels: 3,
      background: "#f8fafc",
    },
  })
    .jpeg()
    .toBuffer();

  for (const imagePurpose of [
    "product_sheet",
    "poster",
    "banner",
    "infographic",
  ] as const) {
    const composed = await runtime.composeAiMediaBrandedImage({
      input: base,
      width: 420,
      height: 420,
      logo: null,
      colors: ["#f97316", "#8b5cf6", "#0ea5e9"],
      companyName: "iNrCy",
      visualStyle: "clean",
      logoMode: "none",
      imagePurpose,
      withText: true,
      copy: {
        headline: "Une offre claire et mémorable",
        subline:
          "Un bénéfice concret. Une preuve lisible. Une action immédiate.",
        cta: "Découvrir maintenant",
      },
      scene: {
        eyebrow: "iNrCy",
        title: "Une offre claire et mémorable",
        body: "Un bénéfice concret. Une preuve lisible. Une action immédiate.",
        layout: "editorial",
      },
    });
    const stats = await sharp(composed).stats();
    assert.ok(
      stats.channels.every((channel) => channel.mean < 220),
      `${imagePurpose} doit produire une structure éditoriale visible`,
    );
  }
});

test("le mode sans texte ni logo conserve un calque entièrement transparent", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
  );
  const overlay = await runtime.renderAiMediaVideoOverlay({
    width: 320,
    height: 320,
    logo: null,
    colors: ["#0ea5e9", "#8b5cf6", "#db2777"],
    companyName: "Test",
    visualStyle: "clean",
    logoMode: "none",
    withText: false,
    scene: {
      eyebrow: "Repère",
      title: "Titre",
      body: "Corps",
      layout: "editorial",
    },
  });
  const alpha = await sharp(overlay).extractChannel(3).stats();
  assert.equal(alpha.channels[0]!.max, 0);
});

test("le compositeur conserve l’image jusqu’au bord inférieur depuis un plan vertical", async () => {
  const runtime = transpileRuntimeModule<ComposerModule>(
    "../../lib/aiMediaGeneratedVideo.ts"
  );
  const directory = await mkdtemp(
    path.join(tmpdir(), "inrcy-full-frame-cover-test-")
  );
  const sourcePath = path.join(directory, "source.mp4");
  const outputPath = path.join(directory, "output.mp4");
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
        "color=c=0xed2945:s=320x568:r=30:d=8",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-an",
        sourcePath,
      ],
      { timeout: 45_000, windowsHide: true }
    );
    const overlay = await sharp({
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
      clips: [{ buffer: await readFile(sourcePath), durationSeconds: 8 }],
      overlays: [overlay],
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
      { timeout: 30_000, windowsHide: true }
    );

    for (const top of [0, 150, 300]) {
      const stats = await sharp(framePath)
        .extract({ left: 0, top, width: 320, height: 20 })
        .stats();
      assert.ok(stats.channels[0]!.mean > 180, `plan visible à y=${top}`);
      assert.ok(
        stats.channels[1]!.mean < 90 && stats.channels[2]!.mean < 110,
        `aucun bandeau ou remplissage noir à y=${top}`
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("an explicit large bottom-left logo is composed at that position with more visible area", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>("../../lib/aiMediaBrandRenderer.ts");
  const logo = await sharp({ create: { width: 500, height: 200, channels: 4, background: "#db2777" } }).png().toBuffer();
  const base = { width: 1080, height: 1080, logo, colors: ["#000000", "#ffffff", "#777777"] as [string,string,string], companyName: "", visualStyle: "clean" as const, logoMode: "discreet" as const, scene: { eyebrow: "", title: "", body: "", layout: "editorial" as const }, withText: false };
  const defaultOverlay = await runtime.renderAiMediaVideoOverlay(base);
  const positioned = await runtime.renderAiMediaVideoOverlay({ ...base, logoPlacement: { horizontal: "left", vertical: "bottom", size: "large" } });
  const bounds = async (input: Buffer) => {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let minX = info.width, minY = info.height, maxX = 0, maxY = 0, pixels = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 20) {
      minX = Math.min(minX,x); minY = Math.min(minY,y); maxX = Math.max(maxX,x); maxY = Math.max(maxY,y); pixels++;
    }
    return { minX,minY,maxX,maxY,pixels };
  };
  const ordinary = await bounds(defaultOverlay), explicit = await bounds(positioned);
  assert.ok(ordinary.minX > 700 && ordinary.minY < 150);
  assert.ok(explicit.minX < 100 && explicit.minY > 750);
  assert.ok(explicit.pixels > ordinary.pixels * 2);
  assert.ok(explicit.maxX < 1080 && explicit.maxY < 1080);
});

test("le logo transparent reste discret, sans pastille blanche et en zone sûre", async () => {
  const runtime = transpileRuntimeModule<BrandRendererModule>(
    "../../lib/aiMediaBrandRenderer.ts"
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
          '<svg width="300" height="120" xmlns="http://www.w3.org/2000/svg"><rect x="35" y="35" width="230" height="50" rx="18" fill="#db2777"/></svg>'
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
    "../../lib/aiMediaBrandRenderer.ts"
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
          '<svg width="420" height="160" xmlns="http://www.w3.org/2000/svg"><circle cx="118" cy="80" r="42" fill="#0ea5e9"/><rect x="175" y="45" width="185" height="70" rx="22" fill="#db2777"/></svg>'
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
          '<svg width="320" height="130" xmlns="http://www.w3.org/2000/svg"><rect x="45" y="35" width="230" height="60" rx="20" fill="#ffffff"/></svg>'
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
    "les éléments blancs sur transparence ne sont jamais supprimés"
  );
});
