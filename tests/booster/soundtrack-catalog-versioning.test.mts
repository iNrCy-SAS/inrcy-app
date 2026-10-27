import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { AI_MEDIA_SOUNDTRACKS, ALL_AI_MEDIA_SOUNDTRACKS, LEGACY_AI_MEDIA_SOUNDTRACKS, findAiMediaSoundtrack, getAiMediaSoundtrackAssetRelativePath, selectAiMediaSoundtrack } from "../../lib/aiMediaSoundtrackCatalog.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const load = runtimeModules();
const tracks = load<typeof import("../../lib/aiMediaGenerationSoundtracks.ts")>("lib/aiMediaGenerationSoundtracks.ts");
const booster = load<typeof import("../../lib/boosterSoundtracks.ts")>("lib/boosterSoundtracks.ts");
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(new URL("../../assets/media-generation/soundtracks/manifest.json", import.meta.url), "utf8")) as { tracks: Array<{ id: string; soundtrackId: string; durationSeconds: number; sha256: string }> };

test("the current 30 selections and immutable 24 historical IDs stay disjoint and Auto never re-selects an archived track", () => {
  assert.equal(AI_MEDIA_SOUNDTRACKS.length, 30);
  assert.equal(LEGACY_AI_MEDIA_SOUNDTRACKS.length, 24);
  assert.equal(ALL_AI_MEDIA_SOUNDTRACKS.length, 54);
  assert.equal(new Set(ALL_AI_MEDIA_SOUNDTRACKS.map(track => track.id)).size, 54);
  const publicIds = new Set(booster.getBoosterSoundtrackCatalog().map(track => track.id));
  assert.deepEqual([...publicIds], AI_MEDIA_SOUNDTRACKS.map(track => track.id));
  for (const archived of LEGACY_AI_MEDIA_SOUNDTRACKS) {
    assert.equal(booster.normalizeBoosterSoundtrackId(archived.id), archived.id, "Saved drafts and checkpoints keep their explicit ID");
    assert.ok(!publicIds.has(archived.id));
    assert.equal(findAiMediaSoundtrack(archived.id)?.license, "inrcy-original-procedural-v1");
  }
  for (let i = 0; i < 96; i++) {
    const selected = selectAiMediaSoundtrack(i % 2 ? "atelier artisan local" : "calme piano bien-être", { selectionKey: `new-publication-${i}` });
    assert.ok(publicIds.has(selected.id));
    assert.equal(selected.assetVersion, 2);
    assert.equal(selected.license, "inrcy-original-instrumental-v2");
  }
});

test("historical audio hashes remain identical at eight, sixteen and twenty-four seconds after the new catalogue ships", async () => {
  assert.equal(digest(JSON.stringify(manifest.tracks.map(track => [track.id, track.sha256]))), "66994dd7bade5da4cd5820483d299942428c59793338e61991b0f183026fcc30", "Do not rewrite the historical manifest or substitute audio under an old ID");
  for (const archived of LEGACY_AI_MEDIA_SOUNDTRACKS) for (const seconds of [8, 16, 24]) {
    const track = await tracks.loadAiMediaSoundtrack("A changed brief must not select different music", { soundtrackId: archived.id, durationSeconds: seconds });
    const original = manifest.tracks.find(entry => entry.soundtrackId === archived.id && entry.durationSeconds === seconds)!;
    assert.ok(original);
    assert.equal(track.sha256, original.sha256);
    assert.equal(track.fileName, `${archived.id}-${seconds}s.wav`);
    assert.equal(track.durationSeconds, seconds);
    assert.equal(track.assetVersion, undefined);
  }
});

test("all current previews are exactly the versioned twenty-four-second asset used by new Stories and Reels", async () => {
  const preview = load<typeof import("../../app/api/booster/soundtracks/[id]/preview/route.ts")>("app/api/booster/soundtracks/[id]/preview/route.ts");
  for (const option of booster.getBoosterSoundtrackCatalog()) {
    const track = await tracks.loadAiMediaSoundtrack("", { soundtrackId: option.id, durationSeconds: 24 });
    assert.equal(track.fileName, `v2/${option.id}-24s.wav`);
    assert.equal(track.license, "inrcy-original-instrumental-v2");
    const response = await preview.GET(new Request(`https://fixture.invalid${option.audioPreview}`), { params: Promise.resolve({ id: option.id }) });
    assert.equal(response.status, 200, option.id);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(digest(bytes), track.sha256, option.id);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
    assert.equal(bytes.readUInt32LE(40) / (bytes.readUInt32LE(24) * bytes.readUInt16LE(22) * bytes.readUInt16LE(34) / 8), 24);
  }
});

test("asset paths come only from exact catalogue identities, including legacy previews, and refuse unknown IDs or physical durations", async () => {
  for (const definition of ALL_AI_MEDIA_SOUNDTRACKS) for (const seconds of [8, 16, 24]) {
    const relative = getAiMediaSoundtrackAssetRelativePath(definition.id, seconds);
    assert.equal(relative, `${definition.assetVersion === 2 ? "v2/" : ""}${definition.id}-${seconds}s.wav`);
    const absolute = path.resolve("assets/media-generation/soundtracks", relative);
    assert.ok(absolute.startsWith(path.resolve("assets/media-generation/soundtracks") + path.sep));
  }
  let reads = 0;
  const isolated = runtimeModules({ "node:fs/promises": { async readFile() { reads++; throw new Error("Unexpected read"); } } });
  const preview = isolated<typeof import("../../app/api/booster/soundtracks/[id]/preview/route.ts")>("app/api/booster/soundtracks/[id]/preview/route.ts");
  for (const invalid of ["../piano-serein", "v2/piano-serein", "Piano-serein", "piano-serein ", "unregistered-track", "https://external.invalid/audio.wav", "%2e%2e%2fsecret"]) {
    assert.throws(() => getAiMediaSoundtrackAssetRelativePath(invalid, 24), /ai_soundtrack_id_invalid/);
    assert.equal((await preview.GET(new Request("https://fixture.invalid"), { params: Promise.resolve({ id: invalid }) })).status, 404);
  }
  for (const invalid of [0, 4, 7, 15, 25, NaN, Infinity]) assert.throws(() => getAiMediaSoundtrackAssetRelativePath("piano-serein", invalid), /ai_soundtrack_duration_invalid/);
  assert.equal(reads, 0, "Invalid identifiers must fail before any filesystem access");
});
