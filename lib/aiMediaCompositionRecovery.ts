import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { composeOriginalAiVideo } from "@/lib/aiMediaGeneratedVideo";
import { getExistingGeneratedAiMedia, saveGeneratedAiMediaDraft } from "@/lib/aiGeneratedMediaRegistry";
import { completeAiMediaGeneration, expireAiMediaGenerationReservations } from "@/lib/aiMediaGenerationQuota";
import { AI_MEDIA_SOUNDTRACKS } from "@/lib/aiMediaSoundtrackCatalog";
import { inspectAiMediaVideoBufferLocally } from "@/lib/aiMediaVideoLocalQa";

export type AiMediaCompositionInput = Omit<Parameters<typeof composeOriginalAiVideo>[0], "signal">;
export type AiMediaCompositionCheckpoint = { accountId: string; jobId: string; leaseToken: string };
export type AiMediaCompositionRecoveryOutcome =
  | { status: "idle" }
  | { status: "completed"; accountId: string; jobId: string; mediaId: string }
  | { status: "retry_pending" | "failed"; accountId: string; jobId: string };

const BUCKET = "inrcy-pro-media";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CLIP_BYTES = 128 * 1024 * 1024;
const MAX_AUX_BYTES = 32 * 1024 * 1024;
const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
function uuid(value: string) { if (!UUID.test(value)) throw new Error("ai_media_composition_scope_invalid"); return value.toLowerCase(); }
function prefix(accountId: string, jobId: string) { return `${uuid(accountId)}/_composition-recovery/${uuid(jobId)}/`; }
function parameters(checkpoint: AiMediaCompositionCheckpoint) {
  return { p_account_id: uuid(checkpoint.accountId), p_job_id: uuid(checkpoint.jobId), p_lease_token: uuid(checkpoint.leaseToken) };
}
async function rpc(name: string, args: Record<string, unknown> = {}) {
  const result = await supabaseAdmin.rpc(name, args);
  if (result.error) throw new Error(`ai_media_composition_rpc_failed:${name}`);
  return result.data;
}

type Asset = { file: string; bytes: number; sha256: string };
type Manifest = {
  version: 1; accountId: string; jobId: string; width: number; height: number; durationSeconds: number;
  nativeAudioMode: "ambience" | "dialogue" | "mute";
  clips: Array<Asset & { durationSeconds: number; sourceStartSeconds?: number }>;
  overlays: Asset[];
  narration: (Asset & { extension: "wav" | "mp3" | "ogg" | "aac"; mimeType: string; model: string; voice: string }) | null;
  soundtrack: (Asset & { id: string; durationSeconds: number }) | null;
  metadata: Record<string, unknown>;
};

/** Persist diagnostics only: the brief, prompt and dialogue text never enter a checkpoint. */
function safeMetadata(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const key of ["provider", "model", "prompt_version", "prompt_sha256", "casting_variant_key", "soundtrack_id", "video_engine_result", "format", "video_engine", "video_resolution", "creation_mode"]) {
    const value = input[key];
    if (value === null) output[key] = null;
    else if (typeof value === "string" && !value.includes("://") && /^[a-z0-9_.:/+\-]{1,300}$/i.test(value)) output[key] = value;
  }
  for (const key of ["provider_request_ids", "warnings"]) if (Array.isArray(input[key])) {
    output[key] = input[key].filter(value => typeof value === "string" && !value.includes("://") && /^[a-z0-9_.:/+>\-]{1,300}$/i.test(value)).slice(0, 50);
  }
  for (const key of ["native_character_dialogue_preserved", "native_voiceover_preserved"]) if (typeof input[key] === "boolean") output[key] = input[key];
  if (typeof input.estimated_cost_micro_usd === "number" && Number.isSafeInteger(input.estimated_cost_micro_usd) && input.estimated_cost_micro_usd >= 0) output.estimated_cost_micro_usd = input.estimated_cost_micro_usd;
  const soundtrack = input.soundtrack as { id?: unknown } | undefined;
  if (typeof soundtrack?.id === "string" && AI_MEDIA_SOUNDTRACKS.some(s => s.id === soundtrack.id)) output.soundtrack_id = soundtrack.id;
  if (input.pipeline_timings_ms && typeof input.pipeline_timings_ms === "object") {
    output.pipeline_timings_ms = Object.fromEntries(Object.entries(input.pipeline_timings_ms).filter(([key, value]) =>
      /^[a-z0-9_]{1,80}$/i.test(key) && typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 3_600_000));
  }
  return output;
}

function validateLayout(input: Pick<Manifest, "width" | "height" | "durationSeconds" | "clips" | "overlays" | "nativeAudioMode">) {
  if (![input.width, input.height].every(n => Number.isInteger(n) && n >= 320 && n <= 2160) ||
    !Number.isInteger(input.durationSeconds) || input.durationSeconds < 4 || input.durationSeconds > 30 ||
    !["ambience", "dialogue", "mute"].includes(input.nativeAudioMode) ||
    !Array.isArray(input.clips) || input.clips.length < 1 || input.clips.length > 2 ||
    !Array.isArray(input.overlays) || input.overlays.length !== input.clips.length ||
    input.clips.some(c => !Number.isInteger(c.durationSeconds) || c.durationSeconds < 4 || c.durationSeconds > 30 ||
      (c.sourceStartSeconds !== undefined && (!Number.isFinite(c.sourceStartSeconds) || c.sourceStartSeconds < 0 || c.sourceStartSeconds > 30))) ||
    input.clips.reduce((total, c) => total + c.durationSeconds, 0) !== input.durationSeconds) throw new Error("ai_media_composition_manifest_invalid");
}

export async function persistAiMediaCompositionCheckpoint(args: {
  accountId: string; jobId: string; authUserId: string; input: AiMediaCompositionInput; metadata: Record<string, unknown>;
  checkpoint?: AiMediaCompositionCheckpoint;
}): Promise<AiMediaCompositionCheckpoint> {
  const checkpoint = { accountId: uuid(args.accountId), jobId: uuid(args.jobId), leaseToken: args.checkpoint?.leaseToken || randomUUID() };
  if (args.checkpoint && (args.checkpoint.accountId !== checkpoint.accountId || args.checkpoint.jobId !== checkpoint.jobId)) throw new Error("ai_media_composition_scope_invalid");
  const layout = { ...args.input, nativeAudioMode: args.input.nativeAudioMode || "ambience" as const };
  validateLayout(layout as unknown as Manifest);
  const bucket = await supabaseAdmin.storage.getBucket(BUCKET);
  if (bucket.error || !bucket.data || bucket.data.public) throw new Error("ai_media_composition_private_bucket_required");
  await rpc("start_ai_media_composition_checkpoint", { ...parameters(checkpoint), p_actor_auth_user_id: uuid(args.authUserId) });
  const folder = `${prefix(checkpoint.accountId, checkpoint.jobId)}${randomUUID()}/`;
  const upload = async (file: string, buffer: Buffer, contentType: string, maximum = MAX_AUX_BYTES): Promise<Asset> => {
    if (!buffer.length || buffer.length > maximum) throw new Error("ai_media_composition_asset_size_invalid");
    const result = await supabaseAdmin.storage.from(BUCKET).upload(folder + file, buffer, { contentType, upsert: false, cacheControl: "0" });
    if (result.error) throw new Error("ai_media_composition_upload_failed");
    return { file, bytes: buffer.length, sha256: hash(buffer) };
  };
  try {
    const clips = [];
    for (const [i, clip] of args.input.clips.entries()) clips.push({
      ...await upload(`clip-${i}.mp4`, clip.buffer, "video/mp4", MAX_CLIP_BYTES),
      durationSeconds: clip.durationSeconds, ...(clip.sourceStartSeconds !== undefined ? { sourceStartSeconds: clip.sourceStartSeconds } : {}),
    });
    const overlays = [];
    for (const [i, buffer] of args.input.overlays.entries()) overlays.push(await upload(`overlay-${i}.png`, buffer, "image/png"));
    let narration: Manifest["narration"] = null;
    if (args.input.narration) {
      const audio = args.input.narration;
      if (!["wav", "mp3", "ogg", "aac"].includes(audio.extension)) throw new Error("ai_media_composition_audio_invalid");
      narration = { ...await upload(`narration.${audio.extension}`, audio.buffer, audio.mimeType),
        extension: audio.extension, mimeType: audio.mimeType, model: "recovered-audio", voice: "preserved" };
    }
    let soundtrack: Manifest["soundtrack"] = null;
    if (args.input.soundtrack) {
      const track = args.input.soundtrack;
      const expectedPath = path.resolve(process.cwd(), "assets", "media-generation", "soundtracks", `${track.id}-${track.durationSeconds}s.wav`);
      if (!AI_MEDIA_SOUNDTRACKS.some(s => s.id === track.id) || path.resolve(track.absolutePath) !== expectedPath) throw new Error("ai_media_composition_soundtrack_invalid");
      const audio = await readFile(expectedPath);
      if (hash(audio) !== track.sha256) throw new Error("ai_media_composition_soundtrack_changed");
      soundtrack = { ...await upload("soundtrack.wav", audio, "audio/wav"), id: track.id, durationSeconds: track.durationSeconds };
    }
    const manifest: Manifest = { version: 1, accountId: checkpoint.accountId, jobId: checkpoint.jobId,
      width: args.input.width, height: args.input.height, durationSeconds: args.input.durationSeconds, nativeAudioMode: layout.nativeAudioMode,
      clips, overlays, narration, soundtrack, metadata: safeMetadata(args.metadata) };
    await upload("manifest.json", Buffer.from(JSON.stringify(manifest)), "application/json", 32_768);
    await rpc("ready_ai_media_composition_checkpoint", { ...parameters(checkpoint), p_manifest_path: folder + "manifest.json" });
    return checkpoint;
  } catch (error) {
    // No immediate object deletion: a lost ready-RPC response may have committed.
    // A healthy main composition may continue after this advisory failure.
    // Never release its credits or its ready lease while it is still running.
    await rpc("abandon_ai_media_composition_checkpoint", parameters(checkpoint)).catch(() => undefined);
    throw error;
  }
}

export async function hasAiMediaCompositionCheckpoint(args: { accountId: string; jobId: string }): Promise<boolean> {
  return (await rpc("has_ai_media_composition_checkpoint", { p_account_id: uuid(args.accountId), p_job_id: uuid(args.jobId) })) === true;
}
export async function releaseAiMediaCompositionCheckpoint(checkpoint: AiMediaCompositionCheckpoint): Promise<boolean> {
  return (await rpc("release_ai_media_composition_checkpoint", parameters(checkpoint))) === true;
}
export async function finishAiMediaCompositionCheckpoint(checkpoint: AiMediaCompositionCheckpoint): Promise<boolean> {
  return (await rpc("finish_ai_media_composition_checkpoint", parameters(checkpoint))) === true;
}

/** Claim one paid result and finish locally. This module never imports a generation provider. */
export async function recoverNextAiMediaCompositionCheckpoint(): Promise<AiMediaCompositionRecoveryOutcome> {
  const rows = await rpc("claim_ai_media_composition_checkpoint");
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { status: "idle" };
  const checkpoint: AiMediaCompositionCheckpoint = { accountId: uuid(row.account_id), jobId: uuid(row.job_id), leaseToken: uuid(row.lease_token) };
  let directory: string | undefined;
  let stage = "existing_result";
  try {
    const existing = await getExistingGeneratedAiMedia(checkpoint);
    if (existing) {
      await completeAiMediaGeneration({ ...checkpoint, mediaId: existing.id });
      await finishAiMediaCompositionCheckpoint(checkpoint);
      return { status: "completed", accountId: checkpoint.accountId, jobId: checkpoint.jobId, mediaId: existing.id };
    }
    const manifestPath = String(row.manifest_path || "");
    stage = "download";
    const expectedPrefix = prefix(checkpoint.accountId, checkpoint.jobId);
    const suffix = manifestPath.slice(expectedPrefix.length);
    if (!manifestPath.startsWith(expectedPrefix) || !suffix.endsWith("/manifest.json") || !UUID.test(suffix.slice(0, -"/manifest.json".length))) throw new Error("ai_media_composition_path_invalid");
    const folder = manifestPath.slice(0, -"manifest.json".length);
    const download = async (storagePath: string, maximum: number) => {
      const result = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
      if (result.error || !result.data || result.data.size > maximum) throw new Error("ai_media_composition_download_failed");
      return Buffer.from(await result.data.arrayBuffer());
    };
    const manifest = JSON.parse((await download(manifestPath, 32_768)).toString("utf8")) as Manifest;
    if (manifest.version !== 1 || manifest.accountId !== checkpoint.accountId || manifest.jobId !== checkpoint.jobId) throw new Error("ai_media_composition_scope_invalid");
    validateLayout(manifest);
    const readAsset = async (asset: Asset, expectedFile: string, maximum = MAX_AUX_BYTES) => {
      if (asset.file !== expectedFile || !Number.isInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > maximum || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error("ai_media_composition_asset_invalid");
      const buffer = await download(folder + asset.file, maximum);
      if (buffer.length !== asset.bytes || hash(buffer) !== asset.sha256) throw new Error("ai_media_composition_asset_corrupt");
      return buffer;
    };
    const clips = [];
    for (const [i, clip] of manifest.clips.entries()) clips.push({ buffer: await readAsset(clip, `clip-${i}.mp4`, MAX_CLIP_BYTES), durationSeconds: clip.durationSeconds, sourceStartSeconds: clip.sourceStartSeconds });
    const overlays = [];
    for (const [i, overlay] of manifest.overlays.entries()) overlays.push(await readAsset(overlay, `overlay-${i}.png`));
    let soundtrack: AiMediaCompositionInput["soundtrack"] = null;
    if (manifest.soundtrack) {
      const track = manifest.soundtrack;
      const definition = AI_MEDIA_SOUNDTRACKS.find(s => s.id === track.id);
      if (!definition || ![8,16,24].includes(track.durationSeconds)) throw new Error("ai_media_composition_soundtrack_invalid");
      directory = await mkdtemp(path.join(tmpdir(), "inrcy-composition-recovery-"));
      const absolutePath = path.join(directory, "soundtrack.wav");
      await writeFile(absolutePath, await readAsset(track, "soundtrack.wav"));
      soundtrack = { ...definition, absolutePath, fileName: "soundtrack.wav", sha256: track.sha256, sizeBytes: track.bytes, durationSeconds: track.durationSeconds };
    }
    let narration: AiMediaCompositionInput["narration"] = null;
    if (manifest.narration) {
      const audio = manifest.narration;
      if (!["wav","mp3","ogg","aac"].includes(audio.extension)) throw new Error("ai_media_composition_audio_invalid");
      narration = { buffer: await readAsset(audio, `narration.${audio.extension}`), extension: audio.extension, mimeType: "audio/octet-stream", model: "recovered-audio", voice: "preserved" };
    }
    await rpc("assert_ai_media_composition_lease", parameters(checkpoint));
    stage = "compose";
    const media = await composeOriginalAiVideo({ clips, overlays, width: manifest.width, height: manifest.height,
      durationSeconds: manifest.durationSeconds, nativeAudioMode: manifest.nativeAudioMode, soundtrack, narration });
    const qa = await inspectAiMediaVideoBufferLocally({ buffer: media.buffer, expectedDurationSeconds: manifest.durationSeconds,
      audioExpectation: manifest.nativeAudioMode === "dialogue" || narration ? "required" : "optional", timeoutMs: 4_000 });
    await rpc("assert_ai_media_composition_lease", parameters(checkpoint));
    stage = "persist";
    const metadata = safeMetadata(manifest.metadata || {});
    const provider = String(metadata.provider || "");
    metadata.video_engine_result ||= provider.startsWith("inrcy-") ? "local_fallback"
      : metadata.video_engine === "veo" && provider.includes("google-gemini-omni") ? "veo_omni_fallback"
      : provider.includes("+") ? "omni_veo_fallback" : provider === "google-gemini-omni" ? "omni" : metadata.video_engine || "veo";
    const warnings = [...(Array.isArray(metadata.warnings) ? metadata.warnings : []), ...qa.advisories.map(code => `video_local_qa_${code}`)];
    const item = await saveGeneratedAiMediaDraft({ ...checkpoint, authUserId: uuid(row.actor_auth_user_id), title: "Vidéo générée par iNrCy", media,
      metadata: {
        provenance: { source: "inrcy_original_ai_video_engine", recovered_composition: true,
          prompt_version: metadata.prompt_version, prompt_sha256: metadata.prompt_sha256, casting_variant_key: metadata.casting_variant_key,
          format: metadata.format, video_engine: metadata.video_engine, video_resolution: metadata.video_resolution, creation_mode: metadata.creation_mode,
          duration_seconds: manifest.durationSeconds, active_account_id: checkpoint.accountId, actor_auth_user_id: row.actor_auth_user_id },
        gateway: { provider: metadata.provider, model: metadata.model, provider_request_ids: metadata.provider_request_ids,
          native_character_dialogue_preserved: metadata.native_character_dialogue_preserved, native_voiceover_preserved: metadata.native_voiceover_preserved,
          estimated_cost_micro_usd: metadata.estimated_cost_micro_usd, warnings, quality_assurance: { final_video: qa } },
        soundtrack: soundtrack ? { id: soundtrack.id, name: soundtrack.name, file_name: soundtrack.fileName,
          duration_seconds: soundtrack.durationSeconds, license: soundtrack.license, sha256: soundtrack.sha256, size_bytes: soundtrack.sizeBytes } : null,
      } });
    stage = "finalize";
    await completeAiMediaGeneration({ ...checkpoint, mediaId: item.id, metadata });
    await finishAiMediaCompositionCheckpoint(checkpoint);
    return { status: "completed", accountId: checkpoint.accountId, jobId: checkpoint.jobId, mediaId: item.id };
  } catch {
    console.warn("[ai-media] composition recovery deferred", { accountId: checkpoint.accountId, jobId: checkpoint.jobId, stage });
    await releaseAiMediaCompositionCheckpoint(checkpoint);
    const active = await hasAiMediaCompositionCheckpoint(checkpoint);
    if (!active) await expireAiMediaGenerationReservations({ batchSize: 100 });
    return { status: active ? "retry_pending" : "failed", accountId: checkpoint.accountId, jobId: checkpoint.jobId };
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function purgeExpiredAiMediaCompositionObjects(limit = 100): Promise<number> {
  const rows = await rpc("list_expired_ai_media_composition_objects", { p_batch_size: Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 100 });
  const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const allowed = new RegExp(`^${id}/_composition-recovery/${id}/${id}/(manifest[.]json|clip-[01][.]mp4|overlay-[01][.]png|narration[.](wav|mp3|ogg|aac)|soundtrack[.]wav)$`);
  const paths = (Array.isArray(rows) ? rows : []).map(row => String(row.storage_path)).filter(storagePath => allowed.test(storagePath)).slice(0, 100);
  if (!paths.length) return 0;
  const result = await supabaseAdmin.storage.from(BUCKET).remove(paths);
  if (result.error) throw new Error("ai_media_composition_cleanup_failed");
  return paths.length;
}
