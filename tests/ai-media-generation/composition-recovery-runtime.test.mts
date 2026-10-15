import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Recovery from "../../lib/aiMediaCompositionRecovery.ts";

const accountId = "11111111-1111-4111-8111-111111111111", jobId = "22222222-2222-4222-8222-222222222222", authUserId = "33333333-3333-4333-8333-333333333333";
function harness(options: { uploadFails?: boolean; corruptAsset?: boolean; leaseLost?: boolean; cleanupRows?: Array<{storage_bucket:string;storage_path:string}> } = {}) {
  const objects = new Map<string, Buffer>();
  const events: string[] = [];
  const warnings: unknown[][] = [];
  const removed: Array<{bucket:string;paths:string[]}> = [];
  let record: Record<string, unknown> | undefined;
  let composed: Recovery.AiMediaCompositionInput | undefined;
  let savedMetadata: Record<string, unknown> | undefined;
  const runtimeModule = { exports: {} };
  const supabaseAdmin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      events.push(name);
      if (name === "start_ai_media_composition_checkpoint_v2") record = { account_id: accountId, job_id: jobId, actor_auth_user_id: authUserId, lease_token: args.p_lease_token, storage_bucket: "inrcy-ai-composition" };
      if (name === "ready_ai_media_composition_checkpoint") record!.manifest_path = args.p_manifest_path;
      if (name === "claim_ai_media_composition_checkpoint_v2") return { data: record ? [record] : [], error: null };
      if (name === "list_expired_ai_media_composition_objects_v2") return { data: options.cleanupRows || [], error: null };
      if (name === "assert_ai_media_composition_lease" && options.leaseLost) return { data: null, error: new Error("lease conflict") };
      return { data: true, error: null };
    },
    storage: {
      getBucket: async () => ({ data: { public: false }, error: null }),
      from: (bucket: string) => ({
        upload: async (storagePath: string, buffer: Buffer, settings:{contentType:string}) => {
          if (options.uploadFails) return { error: { code: "InvalidMimeType", statusCode: "415", message: "SECRET URL https://private.invalid?token=secret" } };
          // Mirror the production media bucket that rejects WAV and JSON.
          const allowed = bucket === "inrcy-ai-composition"
            ? ["video/mp4","image/png","audio/wav","audio/mpeg","audio/ogg","audio/aac","application/json"]
            : ["video/mp4","image/png","audio/mpeg"];
          if (!allowed.includes(settings.contentType)) return { error: { code: "InvalidMimeType" } };
          objects.set(`${bucket}:${storagePath}`, Buffer.from(buffer));
          return { error: null };
        },
        download: async (storagePath: string) => {
          const buffer = options.corruptAsset && storagePath.endsWith(".mp4") ? Buffer.from("corrupt") : objects.get(`${bucket}:${storagePath}`);
          return { data: buffer ? new Blob([Uint8Array.from(buffer).buffer]) : null, error: buffer ? null : new Error("missing") };
        },
        remove: async (paths:string[]) => { if(!options.cleanupRows)throw new Error("unexpected_immediate_delete");removed.push({bucket,paths});return {error:null}; },
      }),
    },
  };
  const stubs: Record<string, unknown> = {
    "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/lib/aiMediaGeneratedVideo": { composeOriginalAiVideo: async (input: Recovery.AiMediaCompositionInput) => {
      events.push("compose"); composed = input;
      return { kind: "video", buffer: Buffer.from("recovered-mp4"), extension: "mp4", mimeType: "video/mp4", width: input.width, height: input.height, durationSeconds: input.durationSeconds };
    } },
    "@/lib/aiGeneratedMediaRegistry": {
      getExistingGeneratedAiMedia: async () => null,
      saveGeneratedAiMediaDraft: async (args: { metadata: Record<string, unknown> }) => { events.push("save"); savedMetadata = args.metadata; return { id: "recovered-media" }; },
    },
    "@/lib/aiMediaGenerationQuota": {
      completeAiMediaGeneration: async () => { events.push("complete"); }, expireAiMediaGenerationReservations: async () => { events.push("expire"); },
    },
    "@/lib/aiMediaSoundtrackCatalog": { AI_MEDIA_SOUNDTRACKS: [] },
    "@/lib/aiMediaVideoLocalQa": { inspectAiMediaVideoBufferLocally: async () => ({ status: "ok", advisories: [] }) },
  };
  const source = readFileSync(new URL("../../lib/aiMediaCompositionRecovery.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const nativeRequire = createRequire(import.meta.url);
  vm.runInNewContext(`(function(require,module,exports){${js}\n})`, { Buffer, process: { cwd: process.cwd }, console: {...console,warn:(...args:unknown[])=>warnings.push(args)} })((id: string) => {
    if (id.startsWith("node:")) return nativeRequire(id);
    if (!(id in stubs)) throw new Error(`Unexpected dependency (provider imports forbidden): ${id}`);
    return stubs[id];
  }, runtimeModule, runtimeModule.exports);
  return { runtime: runtimeModule.exports as typeof Recovery, objects, events, warnings, removed, get record(){return record;}, get composed() { return composed; }, get metadata() { return savedMetadata; } };
}
const input: Recovery.AiMediaCompositionInput = {
  clips: [{ buffer: Buffer.from("paid-video-bytes"), durationSeconds: 8 }], overlays: [Buffer.from("rendered-overlay")],
  width: 1080, height: 1920, durationSeconds: 8, nativeAudioMode: "mute",
  narration: { buffer: Buffer.from("already-paid-audio"), extension: "wav", mimeType: "audio/wav", model: "tts", voice: "Kore" },
};
test("an unclaimed completed/discarded checkpoint causes no composition or upload", async () => {
  const h = harness();
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status, "idle");
  assert.equal(h.composed, undefined);
  assert.equal(h.objects.size, 0);
  assert.ok(!h.events.includes("save"));
  assert.ok(!h.events.includes("complete"));
});
test("checkpoint roundtrip composes paid bytes locally with audio, without persisting prompts", async () => {
  const h = harness();
  await h.runtime.persistAiMediaCompositionCheckpoint({ accountId, jobId, authUserId, input,
    metadata: { model: "model-v1", provider: "google-gemini", prompt_sha256: "a".repeat(64), prompt: "SECRET BRIEF", dialogue: "SECRET QUOTE", provider_request_ids: ["operations/123"], warnings: ["safe_code", "https://signed.invalid/private?token=secret"], video_resolution: "1080p" } });
  const manifestBytes = [...h.objects.entries()].find(([key]) => key.endsWith("manifest.json"))![1];
  assert.ok([...h.objects.keys()].every(key=>key.startsWith("inrcy-ai-composition:")),"WAV and JSON must never use the restrictive media-library bucket");
  assert.doesNotMatch(manifestBytes.toString(), /SECRET|signed.invalid|token=secret/);
  const metadata = JSON.parse(manifestBytes.toString()).metadata;
  assert.equal(metadata.provider, "google-gemini");
  assert.deepEqual(metadata.provider_request_ids, ["operations/123"]);
  assert.equal(metadata.video_resolution, "1080p");
  const result = await h.runtime.recoverNextAiMediaCompositionCheckpoint();
  assert.equal(result.status, "completed");
  assert.deepEqual(h.composed!.clips[0].buffer, input.clips[0].buffer);
  assert.deepEqual(h.composed!.narration!.buffer, input.narration!.buffer);
  assert.deepEqual(h.composed!.overlays[0], input.overlays[0]);
  assert.equal(h.composed!.nativeAudioMode, "mute");
  assert.ok(h.events.indexOf("save") > h.events.indexOf("compose"));
  assert.ok(h.events.indexOf("complete") > h.events.indexOf("save"));
});
test("advisory upload failure abandons only partial checkpoint without expiring a healthy main request", async () => {
  const h = harness({ uploadFails: true });
  await assert.rejects(h.runtime.persistAiMediaCompositionCheckpoint({ accountId, jobId, authUserId, input, metadata: {} }), /upload_failed/);
  assert.ok(h.events.includes("abandon_ai_media_composition_checkpoint"));
  assert.ok(!h.events.includes("release_ai_media_composition_checkpoint"));
  assert.ok(!h.events.includes("expire"));
  const diagnostic=JSON.stringify(h.warnings);
  assert.match(diagnostic,/InvalidMimeType/);
  assert.match(diagnostic,/415/);
  assert.doesNotMatch(diagnostic,/SECRET|https|private.invalid|token/);
});
for (const failure of ["corruptAsset", "leaseLost"] as const) test(`${failure} stops before saving or charging and leaves a bounded retry`, async () => {
  const h = harness({ [failure]: true });
  await h.runtime.persistAiMediaCompositionCheckpoint({ accountId, jobId, authUserId, input, metadata: {} });
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status, "retry_pending");
  assert.ok(!h.events.includes("save"));
  assert.ok(!h.events.includes("complete"));
});

test("a legacy ready manifest is downloaded from its recorded bucket",async()=>{
  const h=harness();
  await h.runtime.persistAiMediaCompositionCheckpoint({accountId,jobId,authUserId,input,metadata:{}});
  h.record!.storage_bucket="inrcy-pro-media";
  for(const [key,value] of [...h.objects]){h.objects.delete(key);h.objects.set(key.replace("inrcy-ai-composition:","inrcy-pro-media:"),value);}
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"completed");
  assert.deepEqual(h.composed!.narration!.buffer,input.narration!.buffer);
});

test("cleanup targets both recorded buckets while rejecting unrelated paths and bucket names",async()=>{
  const scoped=`${accountId}/_composition-recovery/${jobId}/${authUserId}`;
  const h=harness({cleanupRows:[
    {storage_bucket:"inrcy-pro-media",storage_path:`${scoped}/clip-0.mp4`},
    {storage_bucket:"inrcy-ai-composition",storage_path:`${scoped}/manifest.json`},
    {storage_bucket:"inrcy-ai-composition",storage_path:`users/${accountId}/ai-generated/video/result.mp4`},
    {storage_bucket:"another-private-bucket",storage_path:`${scoped}/manifest.json`},
  ]});
  assert.equal(await h.runtime.purgeExpiredAiMediaCompositionObjects(),2);
  assert.deepEqual(JSON.parse(JSON.stringify(h.removed)),[
    {bucket:"inrcy-ai-composition",paths:[`${scoped}/manifest.json`]},
    {bucket:"inrcy-pro-media",paths:[`${scoped}/clip-0.mp4`]},
  ]);
});
