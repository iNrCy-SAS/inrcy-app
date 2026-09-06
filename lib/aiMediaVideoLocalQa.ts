import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
} from "./mediaVideoNormalizer.ts";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_SCAN_SECONDS = 30;
const VISUAL_SAMPLE_FPS = 2;

export type AiMediaVideoQaAdvisory =
  | "metadata_unavailable"
  | "duration_mismatch"
  | "audio_stream_missing"
  | "visual_scan_unavailable"
  | "mostly_black"
  | "mostly_frozen";

export type AiMediaVideoVisualQa = {
  scanned: boolean;
  analyzedSeconds: number;
  blackSeconds: number;
  longestBlackSeconds: number;
  frozenSeconds: number;
  longestFrozenSeconds: number;
  likelyBlack: boolean;
  likelyFrozen: boolean;
};

export type AiMediaVideoLocalQaResult = {
  version: 1;
  /**
   * Cette QA rapide est volontairement consultative. Un scan indisponible ou
   * un signal heuristique ne doit jamais transformer seul un média en échec.
   */
  blocking: false;
  status: "ok" | "advisory" | "unavailable";
  elapsedMs: number;
  advisories: AiMediaVideoQaAdvisory[];
  metadata: {
    durationSeconds: number | null;
    expectedDurationSeconds: number | null;
    durationDeltaSeconds: number | null;
    width: number | null;
    height: number | null;
    frameRate: number | null;
    hasAudio: boolean | null;
  };
  visual: AiMediaVideoVisualQa;
};

export type AiMediaVideoLocalQaOptions = {
  expectedDurationSeconds?: number | null;
  audioExpectation?: "optional" | "required";
  scanVisualQuality?: boolean;
  ffmpegPath?: string;
  timeoutMs?: number;
};

function finitePositive(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function boundedTimeout(value: unknown) {
  const parsed = finitePositive(value) || DEFAULT_TIMEOUT_MS;
  return Math.max(3_000, Math.min(30_000, Math.round(parsed)));
}

function numericFilterValues(stderr: string, key: string) {
  const values: number[] = [];
  const expression = new RegExp(
    `(?:lavfi\\.[a-z_.]+\\.)?${key}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)`,
    "gi",
  );
  for (const match of String(stderr || "").matchAll(expression)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) values.push(value);
  }
  return values;
}

function roundedSeconds(value: number) {
  return Number(Math.max(0, value).toFixed(3));
}

export function parseAiMediaVideoVisualQa(
  stderr: string,
  analyzedSeconds: number,
): AiMediaVideoVisualQa {
  const duration = finitePositive(analyzedSeconds);
  const blackDurations = numericFilterValues(stderr, "black_duration");
  const frozenDurations = numericFilterValues(stderr, "freeze_duration");
  const blackSeconds = Math.min(
    duration,
    blackDurations.reduce((sum, value) => sum + value, 0),
  );
  const frozenSeconds = Math.min(
    duration,
    frozenDurations.reduce((sum, value) => sum + value, 0),
  );
  const longestBlackSeconds = Math.min(
    duration,
    Math.max(0, ...blackDurations),
  );
  const longestFrozenSeconds = Math.min(
    duration,
    Math.max(0, ...frozenDurations),
  );

  // Seuls les défauts couvrant une large part du film sont signalés. Cela
  // ignore volontairement les fondus noirs et les plans fixes éditoriaux.
  const likelyBlack =
    duration >= 2 &&
    (longestBlackSeconds >= Math.max(1.8, duration * 0.5) ||
      blackSeconds >= duration * 0.8);
  const likelyFrozen =
    !likelyBlack &&
    duration >= 4 &&
    (longestFrozenSeconds >= Math.max(4, duration * 0.7) ||
      frozenSeconds >= duration * 0.9);

  return {
    scanned: true,
    analyzedSeconds: roundedSeconds(duration),
    blackSeconds: roundedSeconds(blackSeconds),
    longestBlackSeconds: roundedSeconds(longestBlackSeconds),
    frozenSeconds: roundedSeconds(frozenSeconds),
    longestFrozenSeconds: roundedSeconds(longestFrozenSeconds),
    likelyBlack,
    likelyFrozen,
  };
}

function emptyVisualQa(): AiMediaVideoVisualQa {
  return {
    scanned: false,
    analyzedSeconds: 0,
    blackSeconds: 0,
    longestBlackSeconds: 0,
    frozenSeconds: 0,
    longestFrozenSeconds: 0,
    likelyBlack: false,
    likelyFrozen: false,
  };
}

async function scanVisualQuality(args: {
  ffmpegPath: string;
  inputPath: string;
  analyzedSeconds: number;
  timeoutMs: number;
}) {
  let stderr = "";
  try {
    const result = await execFileAsync(
      args.ffmpegPath,
      [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "info",
        "-i",
        args.inputPath,
        "-map",
        "0:v:0",
        "-t",
        String(args.analyzedSeconds),
        "-vf",
        [
          `fps=${VISUAL_SAMPLE_FPS}`,
          "scale=160:-2:flags=fast_bilinear",
          "format=yuv420p",
          "blackdetect=d=1.5:pix_th=0.10:pic_th=0.98",
          "freezedetect=n=-60dB:d=2.5",
        ].join(","),
        "-an",
        "-f",
        "null",
        "-",
      ],
      {
        timeout: args.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
    );
    stderr = String(result.stderr || "");
  } catch (error) {
    const record = error as { stderr?: unknown } | null;
    return {
      completed: false,
      visual: {
        ...parseAiMediaVideoVisualQa(
          String(record?.stderr || ""),
          args.analyzedSeconds,
        ),
        scanned: false,
      },
    };
  }
  return {
    completed: true,
    visual: parseAiMediaVideoVisualQa(stderr, args.analyzedSeconds),
  };
}

/**
 * Inspecte rapidement un fichier vidéo local sans le modifier.
 *
 * Le décodage visuel est ramené à 160 px et 2 fps, soit au maximum 60 petites
 * trames pour les films iNr'Studio de 8/16/24 s. Le résultat reste advisory :
 * le pipeline peut l'observer ou proposer une régénération, jamais bloquer
 * automatiquement l'utilisateur sur cette seule heuristique.
 */
export async function inspectAiMediaVideoLocally(args: {
  inputPath: string;
} & AiMediaVideoLocalQaOptions): Promise<AiMediaVideoLocalQaResult> {
  const startedAt = Date.now();
  const expectedDuration = finitePositive(args.expectedDurationSeconds) || null;
  const advisories: AiMediaVideoQaAdvisory[] = [];
  const unavailable = (): AiMediaVideoLocalQaResult => ({
    version: 1,
    blocking: false,
    status: "unavailable",
    elapsedMs: Date.now() - startedAt,
    advisories: ["metadata_unavailable"],
    metadata: {
      durationSeconds: null,
      expectedDurationSeconds: expectedDuration,
      durationDeltaSeconds: null,
      width: null,
      height: null,
      frameRate: null,
      hasAudio: null,
    },
    visual: emptyVisualQa(),
  });

  try {
    const ffmpegPath =
      String(args.ffmpegPath || "").trim() ||
      (await resolveVideoNormalizationFfmpegPath());
    const timeoutMs = boundedTimeout(args.timeoutMs);
    const probe = await probeVideoSource({
      ffmpegPath,
      inputPath: args.inputPath,
      timeoutMs,
    });
    const durationDelta =
      expectedDuration === null
        ? null
        : roundedSeconds(Math.abs(probe.durationSeconds - expectedDuration));
    const durationTolerance =
      expectedDuration === null ? 0 : Math.max(0.75, expectedDuration * 0.05);
    if (durationDelta !== null && durationDelta > durationTolerance) {
      advisories.push("duration_mismatch");
    }
    if (args.audioExpectation === "required" && !probe.hasAudio) {
      advisories.push("audio_stream_missing");
    }

    let visual = emptyVisualQa();
    if (args.scanVisualQuality !== false) {
      const analyzedSeconds = Math.min(
        MAX_SCAN_SECONDS,
        probe.durationSeconds,
      );
      const scan = await scanVisualQuality({
        ffmpegPath,
        inputPath: args.inputPath,
        analyzedSeconds,
        timeoutMs,
      });
      visual = scan.visual;
      if (!scan.completed) advisories.push("visual_scan_unavailable");
      if (scan.completed && visual.likelyBlack) advisories.push("mostly_black");
      if (scan.completed && visual.likelyFrozen) advisories.push("mostly_frozen");
    }

    return {
      version: 1,
      blocking: false,
      status: advisories.length ? "advisory" : "ok",
      elapsedMs: Date.now() - startedAt,
      advisories,
      metadata: {
        durationSeconds: roundedSeconds(probe.durationSeconds),
        expectedDurationSeconds: expectedDuration,
        durationDeltaSeconds: durationDelta,
        width: probe.orientedWidth,
        height: probe.orientedHeight,
        frameRate: probe.frameRate || null,
        hasAudio: probe.hasAudio,
      },
      visual,
    };
  } catch {
    return unavailable();
  }
}

/**
 * Variante pour un MP4/WebM déjà présent en mémoire. Le buffer est écrit une
 * seule fois dans le dossier temporaire système, inspecté, puis supprimé dans
 * tous les cas. Aucun média ou résultat de QA n'est persisté par ce helper.
 */
export async function inspectAiMediaVideoBufferLocally(
  args: {
    buffer: Uint8Array;
  } & AiMediaVideoLocalQaOptions,
): Promise<AiMediaVideoLocalQaResult> {
  const startedAt = Date.now();
  let directory = "";
  try {
    if (!args.buffer.byteLength) {
      throw new Error("ai_media_video_qa_empty_buffer");
    }
    directory = await mkdtemp(path.join(tmpdir(), "inrcy-ai-video-qa-"));
    const inputPath = path.join(directory, "media-input");
    await writeFile(inputPath, args.buffer, { flag: "wx" });
    const result = await inspectAiMediaVideoLocally({
      inputPath,
      expectedDurationSeconds: args.expectedDurationSeconds,
      audioExpectation: args.audioExpectation,
      scanVisualQuality: args.scanVisualQuality,
      ffmpegPath: args.ffmpegPath,
      timeoutMs: args.timeoutMs,
    });
    return { ...result, elapsedMs: Date.now() - startedAt };
  } catch {
    return {
      version: 1,
      blocking: false,
      status: "unavailable",
      elapsedMs: Date.now() - startedAt,
      advisories: ["metadata_unavailable"],
      metadata: {
        durationSeconds: null,
        expectedDurationSeconds:
          finitePositive(args.expectedDurationSeconds) || null,
        durationDeltaSeconds: null,
        width: null,
        height: null,
        frameRate: null,
        hasAudio: null,
      },
      visual: emptyVisualQa(),
    };
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
