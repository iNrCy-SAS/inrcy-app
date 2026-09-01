import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "assets", "media-generation", "soundtracks");
const SAMPLE_RATE = 32_000;
const DURATION_SECONDS = 10;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

const TRACKS = [
  { id: "horizon-clair", bpm: 108, root: 60, wave: "sine", seed: 101 },
  { id: "atelier-vivant", bpm: 116, root: 57, wave: "triangle", seed: 211 },
  { id: "elan-local", bpm: 112, root: 62, wave: "triangle", seed: 307 },
  { id: "confiance-douce", bpm: 88, root: 55, wave: "sine", seed: 401 },
  { id: "premium-minimal", bpm: 94, root: 58, wave: "sine", seed: 503 },
  { id: "energie-sociale", bpm: 126, root: 64, wave: "square", seed: 601 },
  { id: "nature-apaisante", bpm: 82, root: 53, wave: "sine", seed: 701 },
  { id: "innovation-lumineuse", bpm: 120, root: 61, wave: "triangle", seed: 809 },
  { id: "celebration-legere", bpm: 124, root: 65, wave: "triangle", seed: 907 },
  { id: "nocturne-elegant", bpm: 92, root: 51, wave: "sine", seed: 1009 },
];

function midiFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function oscillator(phase, wave) {
  if (wave === "triangle") return 2 * Math.asin(Math.sin(phase)) / Math.PI;
  if (wave === "square") return Math.tanh(2.4 * Math.sin(phase));
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

function renderTrack(track) {
  const sampleCount = SAMPLE_RATE * DURATION_SECONDS;
  const dataBytes = sampleCount * 2;
  const output = Buffer.allocUnsafe(44 + dataBytes);
  writeWavHeader(output, dataBytes);
  const beatSeconds = 60 / track.bpm;
  const random = xorshift(track.seed);
  const noise = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    noise[index] = random() * 2 - 1;
  }
  const progression = [0, 5, 3, 7];
  const chordIntervals = [0, 4, 7];
  const melody = [12, 14, 16, 19, 16, 14, 12, 9];

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    const beat = time / beatSeconds;
    const beatIndex = Math.floor(beat);
    const beatPhase = beat - beatIndex;
    const bar = Math.floor(beat / 4);
    const root = track.root + progression[bar % progression.length];
    let sample = 0;

    for (const interval of chordIntervals) {
      const frequency = midiFrequency(root + interval);
      sample += oscillator(Math.PI * 2 * frequency * time, track.wave) * 0.075;
    }
    const bassEnvelope = Math.exp(-3.5 * beatPhase);
    sample += Math.sin(Math.PI * 2 * midiFrequency(root - 12) * time) * 0.2 * bassEnvelope;

    const halfBeat = beat * 2;
    const melodyIndex = Math.floor(halfBeat) % melody.length;
    const melodyPhase = halfBeat - Math.floor(halfBeat);
    const melodyEnvelope = Math.sin(Math.PI * Math.min(1, melodyPhase)) ** 1.4;
    sample +=
      oscillator(
        Math.PI * 2 * midiFrequency(root + melody[melodyIndex]) * time,
        track.wave === "square" ? "triangle" : track.wave,
      ) *
      0.11 *
      melodyEnvelope;

    const kickPhase = beatPhase * beatSeconds;
    if (kickPhase < 0.18) {
      const kickFrequency = 82 - 45 * (kickPhase / 0.18);
      sample +=
        Math.sin(Math.PI * 2 * kickFrequency * kickPhase) *
        Math.exp(-18 * kickPhase) *
        0.42;
    }
    const offbeatPhase = ((beat + 0.5) % 1) * beatSeconds;
    if (offbeatPhase < 0.09 && beatIndex % 2 === 1) {
      sample += noise[index] * Math.exp(-35 * offbeatPhase) * 0.11;
    }
    const hatPhase = ((beat * 2) % 1) * (beatSeconds / 2);
    if (hatPhase < 0.035) {
      sample += noise[index] * Math.exp(-90 * hatPhase) * 0.045;
    }

    const fadeIn = Math.min(1, time / 0.22);
    const fadeOut = Math.min(1, (DURATION_SECONDS - time) / 0.65);
    const master = Math.max(0, Math.min(fadeIn, fadeOut));
    const limited = Math.tanh(sample * 1.25) * master * 0.84;
    output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, limited)) * 32767), 44 + index * 2);
  }

  return output;
}

await mkdir(OUTPUT, { recursive: true });
const manifest = [];
for (const track of TRACKS) {
  const buffer = renderTrack(track);
  const fileName = `${track.id}.wav`;
  await writeFile(path.join(OUTPUT, fileName), buffer);
  manifest.push({
    id: track.id,
    fileName,
    durationSeconds: DURATION_SECONDS,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
    sizeBytes: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    license: "inrcy-original-procedural-v1",
  });
}
await writeFile(
  path.join(OUTPUT, "manifest.json"),
  `${JSON.stringify({ version: 1, generatedBy: "inrcy-procedural-synth", tracks: manifest }, null, 2)}\n`,
  "utf8",
);

process.stdout.write(`Generated ${manifest.length} original 10-second soundtracks in ${OUTPUT}\n`);
