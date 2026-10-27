import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { INSTRUMENTAL_COMPOSITIONS, composeInstrumental } from "../../scripts/music/instrumental-compositions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(root, "assets/media-generation/soundtracks/v2");
const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
const digest = value => createHash("sha256").update(value).digest("hex");

test("the thirty instrumental scores each have three complete distinct PCM recordings matching their manifest hashes", () => {
  assert.equal(INSTRUMENTAL_COMPOSITIONS.length, 30);
  assert.equal(manifest.generatedBy, "inrcy-instrumental-scores");
  assert.equal(manifest.tracks.length, 90);
  assert.equal(new Set(manifest.tracks.map(track => track.sha256)).size, 90);
  const catalogueIds = INSTRUMENTAL_COMPOSITIONS.map(track => track.id).sort();
  assert.deepEqual([...new Set(manifest.tracks.map(track => track.soundtrackId))].sort(), catalogueIds);
  for (const id of catalogueIds) {
    assert.deepEqual(manifest.tracks.filter(track => track.soundtrackId === id).map(track => track.durationSeconds).sort((a, b) => a - b), [8, 16, 24]);
  }
  for (const track of manifest.tracks) {
    assert.match(track.fileName, /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:8|16|24)s\.wav$/);
    const bytes = readFileSync(path.join(directory, track.fileName));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF", track.id);
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE", track.id);
    assert.equal(bytes.toString("ascii", 12, 16), "fmt ", track.id);
    assert.equal(bytes.readUInt16LE(20), 1, "PCM format");
    assert.equal(bytes.readUInt16LE(22), 1, "Mono recording");
    assert.equal(bytes.readUInt32LE(24), 24_000);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.toString("ascii", 36, 40), "data");
    assert.equal(bytes.readUInt32LE(40), 24_000 * track.durationSeconds * 2);
    assert.equal(bytes.length, 44 + 24_000 * track.durationSeconds * 2);
    assert.equal(track.sizeBytes, bytes.length);
    assert.equal(digest(bytes), track.sha256, `${track.id} must retain its published audio`);
  }
});

test("every released instrumental has a genuine nonconstant signal without clipped PCM samples", () => {
  for (const track of manifest.tracks) {
    const bytes = readFileSync(path.join(directory, track.fileName));
    const count = (bytes.length - 44) / 2;
    let sum = 0, squares = 0, clipped = 0, peak = 0;
    for (let index = 0; index < count; index++) {
      const pcm = bytes.readInt16LE(44 + index * 2), sample = pcm / 32768;
      sum += sample;
      squares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      if (Math.abs(pcm) >= 32760) clipped++;
    }
    const mean = sum / count;
    assert.ok(squares / count > 1e-6, `${track.id} is not audible`);
    assert.ok(squares / count - mean * mean > 1e-6, `${track.id} must contain varying audio rather than DC`);
    assert.ok(Math.abs(mean) < 0.02, `${track.id} has a DC offset`);
    assert.ok(peak > 0.02, `${track.id} has no useful signal peak`);
    assert.equal(clipped, 0, `${track.id} must keep headroom after normalization`);
  }
});

test("the thirty compositions have distinct written motifs and distinct active instrument and note schedules", () => {
  const motifs = new Set(), arrangements = new Set();
  for (const track of INSTRUMENTAL_COMPOSITIONS) {
    const score = composeInstrumental(track, 24);
    const activeChannels = new Set(score.events.filter(event => event.on).map(event => event.channel));
    assert.ok(activeChannels.size >= 2, `${track.id} must render its written melody and accompaniment`);
    const activeVoices = score.voices.filter(voice => activeChannels.has(voice.channel));
    assert.ok(activeVoices.some(voice => !voice.drums && voice.program === track.lead));
    motifs.add(digest(JSON.stringify(track.motif)));
    // IDs and display labels are deliberately excluded: renaming the same score
    // must never satisfy the catalogue's musical diversity requirement.
    arrangements.add(digest(JSON.stringify({
      bpm: score.bpm,
      metre: score.metre,
      voices: activeVoices,
      events: score.events,
    })));
    const recorded = manifest.tracks.find(item => item.soundtrackId === track.id && item.durationSeconds === 24);
    assert.equal(recorded.noteEvents, score.events.length, track.id);
    assert.equal(recorded.bpm, score.bpm);
    assert.equal(recorded.metre, score.metre);
  }
  assert.equal(motifs.size, 30, "Each selection needs its own written melodic and rhythmic phrase");
  assert.equal(arrangements.size, 30, "Each selection needs a different actual orchestration or note schedule");
});

test("all authored notes have valid ordered times and MIDI values and close before the declared recording end", () => {
  for (const track of INSTRUMENTAL_COMPOSITIONS) for (const duration of [8, 16, 24]) {
    const score = composeInstrumental(track, duration);
    let previous = -1;
    for (const event of score.events) {
      assert.ok(Number.isFinite(event.time) && event.time >= 0 && event.time < duration, track.id);
      assert.ok(event.time >= previous, `${track.id} schedule order`);
      previous = event.time;
      assert.ok(Number.isInteger(event.channel) && event.channel >= 0 && event.channel < 16);
      assert.ok(Number.isInteger(event.pitch) && event.pitch >= 0 && event.pitch <= 127);
      assert.ok(Number.isInteger(event.velocity) && event.velocity >= 0 && event.velocity <= 127);
      assert.equal(typeof event.on, "boolean");
      if (event.on) assert.ok(event.velocity > 0);
    }
    assert.ok(score.events.some(event => event.on && event.channel === 0), `${track.id} needs its lead phrase`);
  }
});

test("offline renderer provenance is pinned separately and no sound bank or renderer runtime is bundled with the recording catalogue", () => {
  const notice = readFileSync(path.join(directory, "NOTICE.txt"), "utf8");
  assert.match(notice, /GeneralUser GS v2\.0\.3/);
  assert.match(notice, /9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe/);
  assert.match(notice, /684543d5e5efaef08d02be50dcda8d552478fa60/);
  assert.match(notice, /GeneralUser-GS-LICENSE\.txt/);
  assert.match(notice, /does not grant exclusive rights/);
  const runtime = path.join(root, "scripts/music/renderer-runtime");
  const pkg = JSON.parse(readFileSync(path.join(runtime, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(path.join(runtime, "package-lock.json"), "utf8"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies.spessasynth_core, "4.4.1");
  assert.equal(lock.packages["node_modules/spessasynth_core"].version, "4.4.1");
  assert.match(lock.packages["node_modules/spessasynth_core"].integrity, /^sha512-/);
  const app = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(app.dependencies?.spessasynth_core, undefined);
  assert.equal(app.devDependencies?.spessasynth_core, undefined);
  assert.ok(readdirSync(directory).every(file => !/\.(?:sf2|sf3|dls|wasm|js)$/i.test(file)));
});
