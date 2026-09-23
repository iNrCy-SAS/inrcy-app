import { createHash } from "node:crypto";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "assets", "media-generation", "soundtracks");
const SAMPLE_RATE = 24_000;
const DURATION_VARIANTS = [8, 16, 24];
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

const TRACKS = [
  { id: "horizon-clair", bpm: 108, root: 60, style: "bright", seed: 101 },
  { id: "cap-confiance", bpm: 104, root: 57, style: "corporate", seed: 149 },
  { id: "impact-corporate", bpm: 118, root: 62, style: "impact", seed: 181 },
  { id: "atelier-vivant", bpm: 116, root: 57, style: "artisan", seed: 211 },
  { id: "matiere-authentique", bpm: 98, root: 55, style: "acoustic", seed: 257 },
  { id: "marche-local", bpm: 114, root: 60, style: "local", seed: 281 },
  { id: "elan-local", bpm: 112, root: 62, style: "bright", seed: 307 },
  { id: "confiance-douce", bpm: 88, root: 55, style: "soft", seed: 401 },
  { id: "douceur-organique", bpm: 76, root: 53, style: "organic", seed: 449 },
  { id: "premium-minimal", bpm: 94, root: 58, style: "minimal", seed: 503 },
  { id: "signature-luxe", bpm: 86, root: 54, style: "luxury", seed: 557 },
  { id: "energie-sociale", bpm: 126, root: 64, style: "drive", seed: 601 },
  { id: "pulsation-urbaine", bpm: 122, root: 58, style: "urban", seed: 653 },
  { id: "lancement-dynamique", bpm: 128, root: 62, style: "impact", seed: 683 },
  { id: "nature-apaisante", bpm: 82, root: 53, style: "nature", seed: 701 },
  { id: "respiration-verte", bpm: 72, root: 50, style: "organic", seed: 751 },
  { id: "innovation-lumineuse", bpm: 120, root: 61, style: "digital", seed: 809 },
  { id: "futur-positif", bpm: 116, root: 59, style: "future", seed: 853 },
  { id: "digital-flow", bpm: 124, root: 63, style: "urban", seed: 881 },
  { id: "celebration-legere", bpm: 124, root: 65, style: "celebration", seed: 907 },
  { id: "moment-festif", bpm: 132, root: 60, style: "festival", seed: 953 },
  { id: "nocturne-elegant", bpm: 92, root: 51, style: "night", seed: 1009 },
  { id: "saveurs-modernes", bpm: 102, root: 56, style: "lounge", seed: 1051 },
  { id: "cinema-inspirant", bpm: 84, root: 48, style: "cinematic", seed: 1103 },
];

const STYLE_PRESETS = {
  bright: { wave: "triangle", progression: [0, 5, 3, 7], chord: [0, 4, 7], melody: [12, 14, 16, 19, 16, 14, 12, 9], groove: "steady", pad: 0.07, lead: 0.11, bass: 0.19 },
  corporate: { wave: "sine", progression: [0, 7, 5, 3], chord: [0, 4, 7, 11], melody: [12, 16, 14, 11, 12, 19, 16, 14], groove: "steady", pad: 0.06, lead: 0.09, bass: 0.18 },
  impact: { wave: "square", progression: [0, 3, 7, 5], chord: [0, 4, 7], melody: [12, 12, 19, 16, 14, 19, 21, 16], groove: "drive", pad: 0.055, lead: 0.12, bass: 0.22 },
  artisan: { wave: "triangle", progression: [0, 5, 7, 3], chord: [0, 3, 7], melody: [12, 15, 17, 15, 12, 10, 12, 17], groove: "sparse", pad: 0.065, lead: 0.105, bass: 0.17 },
  acoustic: { wave: "triangle", progression: [0, 3, 5, 0], chord: [0, 4, 7], melody: [12, 16, 19, 16, 14, 12, 9, 12], groove: "soft", pad: 0.05, lead: 0.12, bass: 0.14 },
  local: { wave: "triangle", progression: [0, 5, 0, 7], chord: [0, 4, 7], melody: [12, 14, 16, 14, 19, 16, 14, 12], groove: "sparse", pad: 0.07, lead: 0.1, bass: 0.18 },
  soft: { wave: "sine", progression: [0, 5, 3, 0], chord: [0, 4, 7, 11], melody: [12, 16, 14, 12, 9, 12, 14, 11], groove: "soft", pad: 0.075, lead: 0.075, bass: 0.12 },
  organic: { wave: "sine", progression: [0, 3, 5, 3], chord: [0, 3, 7], melody: [12, 15, 17, 19, 17, 15, 12, 10], groove: "air", pad: 0.08, lead: 0.07, bass: 0.1 },
  minimal: { wave: "sine", progression: [0, 7, 3, 5], chord: [0, 4, 11], melody: [12, 19, 16, 14, 12, 11, 16, 14], groove: "minimal", pad: 0.055, lead: 0.08, bass: 0.14 },
  luxury: { wave: "sine", progression: [0, 3, 8, 5], chord: [0, 3, 7, 10], melody: [12, 15, 19, 22, 19, 17, 15, 10], groove: "minimal", pad: 0.07, lead: 0.085, bass: 0.13 },
  drive: { wave: "square", progression: [0, 5, 7, 3], chord: [0, 4, 7], melody: [12, 19, 14, 21, 16, 19, 14, 12], groove: "drive", pad: 0.045, lead: 0.13, bass: 0.23 },
  urban: { wave: "saw", progression: [0, 3, 5, 7], chord: [0, 3, 7], melody: [12, 12, 15, 19, 10, 17, 15, 12], groove: "urban", pad: 0.045, lead: 0.115, bass: 0.24 },
  nature: { wave: "sine", progression: [0, 5, 3, 5], chord: [0, 4, 7, 9], melody: [12, 16, 19, 21, 19, 16, 14, 12], groove: "air", pad: 0.085, lead: 0.065, bass: 0.09 },
  digital: { wave: "triangle", progression: [0, 7, 3, 8], chord: [0, 4, 7], melody: [12, 19, 16, 23, 21, 16, 14, 19], groove: "digital", pad: 0.05, lead: 0.12, bass: 0.18 },
  future: { wave: "saw", progression: [0, 5, 8, 3], chord: [0, 4, 7, 11], melody: [12, 16, 23, 19, 14, 21, 16, 12], groove: "digital", pad: 0.045, lead: 0.105, bass: 0.17 },
  celebration: { wave: "triangle", progression: [0, 5, 7, 5], chord: [0, 4, 7], melody: [12, 16, 19, 21, 19, 24, 21, 16], groove: "dance", pad: 0.055, lead: 0.13, bass: 0.2 },
  festival: { wave: "square", progression: [0, 7, 5, 7], chord: [0, 4, 7], melody: [12, 19, 24, 21, 16, 23, 19, 14], groove: "dance", pad: 0.04, lead: 0.135, bass: 0.22 },
  night: { wave: "sine", progression: [0, 3, 5, 2], chord: [0, 3, 7, 10], melody: [12, 15, 19, 17, 14, 10, 12, 15], groove: "lounge", pad: 0.075, lead: 0.08, bass: 0.14 },
  lounge: { wave: "triangle", progression: [0, 5, 2, 3], chord: [0, 4, 7, 10], melody: [12, 16, 21, 19, 14, 17, 16, 12], groove: "lounge", pad: 0.065, lead: 0.09, bass: 0.15 },
  cinematic: { wave: "sine", progression: [0, 8, 5, 3], chord: [0, 3, 7, 12], melody: [12, 15, 19, 24, 22, 19, 17, 12], groove: "cinematic", pad: 0.09, lead: 0.085, bass: 0.16 },
};

function midiFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function oscillator(phase, wave) {
  if (wave === "triangle") return 2 * Math.asin(Math.sin(phase)) / Math.PI;
  if (wave === "square") return Math.tanh(2.4 * Math.sin(phase));
  if (wave === "saw") {
    const cycle = phase / (Math.PI * 2);
    return 2 * (cycle - Math.floor(cycle + 0.5));
  }
  return Math.sin(phase);
}

function xorshift(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

function writeWavHeader(buffer, dataBytes) {
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
}

function renderTrack(track, durationSeconds) {
  const preset = STYLE_PRESETS[track.style];
  if (!preset) throw new Error(`Unknown soundtrack style: ${track.style}`);
  const sampleCount = SAMPLE_RATE * durationSeconds;
  const dataBytes = sampleCount * 2;
  const output = Buffer.allocUnsafe(44 + dataBytes);
  writeWavHeader(output, dataBytes);
  const beatSeconds = 60 / track.bpm;
  const random = xorshift(track.seed + durationSeconds * 7_919);
  const noise = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    noise[index] = random() * 2 - 1;
  }
  const progression = preset.progression;
  const chordIntervals = preset.chord;
  const melody = preset.melody;
  const endingDuration = durationSeconds === 8 ? 1.15 : durationSeconds === 16 ? 1.4 : 1.65;
  const endingStart = durationSeconds - endingDuration;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    const beat = time / beatSeconds;
    const beatIndex = Math.floor(beat);
    const beatPhase = beat - beatIndex;
    const bar = Math.floor(beat / 4);
    const endingProgress = Math.max(
      0,
      Math.min(1, (time - endingStart) / endingDuration),
    );
    // Chaque variante rejoint la tonique dans sa dernière mesure. La piste a
    // ainsi une vraie conclusion à 8, 16 ou 24 s au lieu d'être tronquée.
    const root =
      endingProgress > 0
        ? track.root
        : track.root + progression[bar % progression.length];
    const endingActivity = 1 - endingProgress * endingProgress;
    let harmony = 0;
    let lead = 0;
    let rhythm = 0;

    for (const interval of chordIntervals) {
      const frequency = midiFrequency(root + interval);
      harmony += oscillator(Math.PI * 2 * frequency * time, preset.wave) * preset.pad;
    }
    const bassEnvelope = Math.exp(-3.5 * beatPhase);
    harmony +=
      Math.sin(Math.PI * 2 * midiFrequency(root - 12) * time) *
      preset.bass *
      bassEnvelope *
      (0.82 + endingProgress * 0.18);

    const halfBeat = beat * 2;
    const melodyIndex = Math.floor(halfBeat) % melody.length;
    const melodyPhase = halfBeat - Math.floor(halfBeat);
    const melodyEnvelope = Math.sin(Math.PI * Math.min(1, melodyPhase)) ** 1.4;
    lead +=
      oscillator(
        Math.PI * 2 * midiFrequency(root + melody[melodyIndex]) * time,
        preset.wave === "square" || preset.wave === "saw" ? "triangle" : preset.wave,
      ) *
      preset.lead *
      melodyEnvelope *
      endingActivity;

    const kickPhase = beatPhase * beatSeconds;
    const kickEnabled = !["air"].includes(preset.groove);
    const kickOnThisBeat =
      !["sparse", "soft", "minimal", "lounge", "cinematic"].includes(preset.groove) ||
      beatIndex % 2 === 0;
    if (kickEnabled && kickOnThisBeat && kickPhase < 0.18) {
      const kickFrequency = 82 - 45 * (kickPhase / 0.18);
      const kickGain = ["drive", "dance", "urban", "digital"].includes(preset.groove)
        ? 0.46
        : ["soft", "minimal", "lounge", "cinematic"].includes(preset.groove)
          ? 0.2
          : 0.34;
      rhythm +=
        Math.sin(Math.PI * 2 * kickFrequency * kickPhase) *
        Math.exp(-18 * kickPhase) *
        kickGain *
        endingActivity;
    }
    const offbeatPhase = ((beat + 0.5) % 1) * beatSeconds;
    if (preset.groove !== "air" && offbeatPhase < 0.09 && beatIndex % 2 === 1) {
      const snareGain = ["drive", "dance", "urban"].includes(preset.groove) ? 0.13 : 0.065;
      rhythm +=
        noise[index] *
        Math.exp(-35 * offbeatPhase) *
        snareGain *
        endingActivity;
    }
    const hatPhase = ((beat * 2) % 1) * (beatSeconds / 2);
    if (!["air", "cinematic"].includes(preset.groove) && hatPhase < 0.035) {
      const hatGain = ["drive", "dance", "digital"].includes(preset.groove) ? 0.055 : 0.028;
      rhythm +=
        noise[index] *
        Math.exp(-90 * hatPhase) *
        hatGain *
        endingActivity;
    }
    if (["air", "cinematic", "organic"].includes(preset.groove) || track.style === "organic") {
      const shimmerFrequency = midiFrequency(root + 24);
      harmony +=
        Math.sin(Math.PI * 2 * shimmerFrequency * time) *
        0.018 *
        (0.5 + 0.5 * Math.sin(time * 0.7)) *
        endingActivity;
    }

    const cadenceEnvelope =
      endingProgress > 0
        ? Math.sin(Math.PI * Math.min(1, endingProgress)) * 0.075
        : 0;
    harmony +=
      Math.sin(Math.PI * 2 * midiFrequency(track.root) * time) * cadenceEnvelope;
    const sample = harmony + lead + rhythm;

    const fadeIn = Math.min(1, time / 0.22);
    const fadeOut = Math.min(1, (durationSeconds - time) / 0.48);
    const master = Math.max(0, Math.min(fadeIn, fadeOut));
    const limited = Math.tanh(sample * 1.25) * master * 0.84;
    output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, limited)) * 32767), 44 + index * 2);
  }

  return output;
}

await mkdir(OUTPUT, { recursive: true });
const manifest = [];
const generatedFileNames = new Set();
for (const track of TRACKS) {
  for (const durationSeconds of DURATION_VARIANTS) {
    const buffer = renderTrack(track, durationSeconds);
    const fileName = `${track.id}-${durationSeconds}s.wav`;
    generatedFileNames.add(fileName);
    await writeFile(path.join(OUTPUT, fileName), buffer);
    manifest.push({
      id: `${track.id}-${durationSeconds}s`,
      soundtrackId: track.id,
      fileName,
      durationSeconds,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      bitsPerSample: BITS_PER_SAMPLE,
      sizeBytes: buffer.byteLength,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      license: "inrcy-original-procedural-v1",
    });
  }
}

// Le dossier est réservé à ce catalogue. Supprimer seulement les anciens WAV
// qui ne correspondent plus à une variante attendue ; le manifeste est gardé.
const existingAssets = await readdir(OUTPUT, { withFileTypes: true });
await Promise.all(
  existingAssets
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".wav") &&
        !generatedFileNames.has(entry.name),
    )
    .map((entry) => unlink(path.join(OUTPUT, entry.name))),
);
await writeFile(
  path.join(OUTPUT, "manifest.json"),
  `${JSON.stringify({ version: 2, generatedBy: "inrcy-procedural-synth", tracks: manifest }, null, 2)}\n`,
  "utf8",
);

process.stdout.write(
  `Generated ${manifest.length} original soundtrack variants (${DURATION_VARIANTS.join("/")} s) in ${OUTPUT}\n`,
);
