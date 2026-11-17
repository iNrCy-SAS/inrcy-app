import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Recovery from "../../lib/aiMediaCompositionRecovery.ts";
import * as soundtrackCatalog from "../../lib/aiMediaSoundtrackCatalog.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import * as pending from "../../lib/aiMediaPendingVideo.ts";

const accountId = "11111111-1111-4111-8111-111111111111", jobId = "22222222-2222-4222-8222-222222222222", authUserId = "33333333-3333-4333-8333-333333333333";
function harness(options: { uploadFails?: boolean; corruptAsset?: boolean; leaseLost?: boolean; composeFails?: string; cleanupRows?: Array<{storage_bucket:string;storage_path:string}>; providerState?: "processing" | "completed" | "failed"; providerDuration?: number; providerStatusFails?: boolean; receiptWriteFails?: boolean; receiptWriteLostAck?: boolean; receiptCasConflict?: boolean; readyLostAck?: boolean; bucketFails?: boolean } = {}) {
  const objects = new Map<string, Buffer>();
  const events: string[] = [];
  const warnings: unknown[][] = [];
  const removed: Array<{bucket:string;paths:string[]}> = [];
  let record: Record<string, unknown> | undefined;
  let composed: Recovery.AiMediaCompositionInput | undefined;
  let composedSoundtrack: Buffer | undefined;
  let savedMetadata: Record<string, unknown> | undefined;
  let completedMetadata: Record<string, unknown> | undefined;
  let savedMedia: { buffer: Buffer } | undefined;
  const job: Record<string,unknown> = {id:jobId,account_id:accountId,actor_auth_user_id:authUserId,status:"processing",metadata:{format:"story"}};
  let casConflictRemaining=options.receiptCasConflict===true, receiptAckRemaining=options.receiptWriteLostAck===true,readyAckRemaining=options.readyLostAck===true;
  const runtimeModule = { exports: {} };
  const supabaseAdmin = {
    from: (table: string) => {
      let patch: Record<string,unknown> | undefined;
      const filters: Array<[string,unknown]> = [];
      const query = { select: () => query, update: (value: Record<string,unknown>) => { patch = value; return query; },
        eq: (column: string, value: unknown) => { filters.push([column,value]); return query; },
        is: (column:string,value:unknown)=>{filters.push([column,value]);return query;},
        in: (column:string,values:unknown[])=>{filters.push([column,values]);return query;},
        lte: () => query, gt: () => query, lt: () => query,
        maybeSingle: async () => {
          if (table === "ai_media_generation_jobs") {
            if(filters.some(([key,value])=>Array.isArray(value)?!value.includes(job[key]):key==="metadata"&&typeof value==="string"?JSON.stringify(job[key])!==value:job[key]!==value))return {data:null,error:null};
            if(patch){
              events.push("receipt-cas");
              if(options.receiptWriteFails)return {data:null,error:new Error("receipt unavailable")};
              if(casConflictRemaining){casConflictRemaining=false;job.metadata={...(job.metadata as Record<string,unknown>),concurrent:"preserved"};return {data:null,error:null};}
              Object.assign(job,patch);
              if(receiptAckRemaining){receiptAckRemaining=false;return {data:null,error:new Error("lost receipt acknowledgement")};}
            }
            return {data:{...job},error:null};
          }
          if (!record || filters.some(([key,value]) => record![key] !== value)) return { data: null, error: null };
          if (patch) Object.assign(record,patch);
          return { data: {...record}, error: null };
        },
        then: (resolve: (value: unknown) => unknown) => query.maybeSingle().then(resolve),
      }; return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      events.push(name);
      if(name==="start_ai_media_composition_checkpoint_v2"){
        if(args.p_actor_auth_user_id!==authUserId||args.p_account_id!==accountId||args.p_job_id!==jobId)return {data:null,error:new Error("scope conflict")};
        if(record&&record.lease_token!==args.p_lease_token)return {data:null,error:new Error("lease conflict")};
        record ||= {account_id:accountId,job_id:jobId,actor_auth_user_id:authUserId,lease_token:args.p_lease_token,storage_bucket:"inrcy-ai-composition",state:"uploading",attempts:0};
      }
      if(name==="ready_ai_media_composition_checkpoint"){
        record!.manifest_path=args.p_manifest_path;record!.state="ready";
        if(readyAckRemaining){readyAckRemaining=false;return {data:null,error:new Error("lost ready acknowledgement")};}
      }
      if (name === "claim_ai_media_composition_checkpoint_v2") { if (record) record.attempts = Number(record.attempts) + 1; return { data: record ? [{...record}] : [], error: null }; }
      if (name === "list_expired_ai_media_composition_objects_v2") return { data: options.cleanupRows || [], error: null };
      if (name === "assert_ai_media_composition_lease" && options.leaseLost) return { data: null, error: new Error("lease conflict") };
      return { data: true, error: null };
    },
    storage: {
      getBucket: async () => ({data:options.bucketFails?null:{public:false},error:options.bucketFails?new Error("bucket unavailable"):null}),
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
    "./aiMediaPendingVideo.ts": pending,
    "./aiVideoHeygenApi.ts": { createHeygenApiClient: () => ({
      getVideo: async (id: string) => { events.push(`provider-get:${id}`); if (options.providerStatusFails) throw new Error("private upstream transport"); return { id, status: options.providerState || "processing", durationSeconds: options.providerDuration ?? 8, videoUrl: "https://resource2.heygen.ai/paid.mp4" }; },
      downloadVideo: async () => { events.push("provider-download"); return Buffer.from("paid-heygen-mp4"); },
    }) },
    "./aiVideoProviderHeygen.ts": { cleanupHeygenTemporaryResources: async () => { events.push("provider-cleanup"); } },
    "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/lib/aiMediaGeneratedVideo": { composeOriginalAiVideo: async (input: Recovery.AiMediaCompositionInput) => {
      events.push("compose"); composed = input;
      if (options.composeFails) throw new Error(options.composeFails);
      if (input.soundtrack) composedSoundtrack = readFileSync(input.soundtrack.absolutePath);
      return { kind: "video", buffer: Buffer.from("recovered-mp4"), extension: "mp4", mimeType: "video/mp4", width: input.width, height: input.height, durationSeconds: input.durationSeconds };
    } },
    "@/lib/aiGeneratedMediaRegistry": {
      getExistingGeneratedAiMedia: async () => null,
      saveGeneratedAiMediaDraft: async (args: { metadata: Record<string, unknown>; media: { buffer: Buffer } }) => { events.push("save"); savedMetadata = args.metadata; savedMedia = args.media; return { id: "recovered-media" }; },
    },
    "@/lib/aiMediaGenerationQuota": {
      completeAiMediaGeneration: async (args: { metadata?: Record<string, unknown> }) => { events.push("complete"); completedMetadata = args.metadata; }, expireAiMediaGenerationReservations: async () => { events.push("expire"); },
      failAiMediaGeneration: async () => { events.push("fail"); },
    },
    "@/lib/aiMediaSoundtrackCatalog": soundtrackCatalog,
    "@/lib/aiMediaVideoLocalQa": { inspectAiMediaVideoBufferLocally: async () => ({ status: "ok", advisories: [] }) },
  };
  const source = readFileSync(new URL("../../lib/aiMediaCompositionRecovery.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const nativeRequire = createRequire(import.meta.url);
  vm.runInNewContext(`(function(require,module,exports){${js}\n})`, { Buffer, Error, process: { cwd: process.cwd, env: { HEYGEN_API_KEY: "synthetic-key" } }, console: {...console,warn:(...args:unknown[])=>warnings.push(args)} })((id: string) => {
    if (id.startsWith("node:")) return nativeRequire(id);
    if (!(id in stubs)) throw new Error(`Unexpected dependency (provider imports forbidden): ${id}`);
    return stubs[id];
  }, runtimeModule, runtimeModule.exports);
  return { runtime: runtimeModule.exports as typeof Recovery, job, objects, events, warnings, removed, get record(){return record;}, get composed() { return composed; }, get composedSoundtrack(){return composedSoundtrack;}, get metadata() { return savedMetadata; }, get media() { return savedMedia; }, get completedMetadata() { return completedMetadata; } };
}
const input: Recovery.AiMediaCompositionInput = {
  clips: [{ buffer: Buffer.from("paid-video-bytes"), durationSeconds: 8 }], overlays: [Buffer.from("rendered-overlay")],
  width: 1080, height: 1920, durationSeconds: 8, nativeAudioMode: "mute",
  narration: { buffer: Buffer.from("already-paid-audio"), extension: "wav", mimeType: "audio/wav", model: "tts", voice: "Kore" },
};
const heygenTask = { provider: "heygen-direct", model: "heygen-avatar-iv", videoId: "accepted-video", temporaryVoiceIds: ["voice-1"],
  temporaryAvatarGroupIds: ["group-1"], temporaryAssetIds: ["asset-1"], estimatedCostMicroUsd: 640_000 } as const;
const pendingTask = () => ({ ...heygenTask, temporaryVoiceIds: [...heygenTask.temporaryVoiceIds],
  temporaryAvatarGroupIds: [...heygenTask.temporaryAvatarGroupIds], temporaryAssetIds: [...heygenTask.temporaryAssetIds] });
async function saveHeygenCheckpoint(h: ReturnType<typeof harness>, durationSeconds = 8) {
  await h.runtime.persistAiMediaCompositionCheckpoint({ accountId, jobId, authUserId,
    input: { ...input, durationSeconds, clips: [{ buffer: Buffer.alloc(0), durationSeconds }], nativeAudioMode: "dialogue", narration: null },
    pendingProvider: pendingTask(), metadata: { provider: "heygen-direct", video_engine: "heygen-avatar", prompt: "private brief" } });
}
test("pending HeyGen checkpoints persist the remote ID and montage privately without uploading an empty video", async () => {
  const h = harness(); await saveHeygenCheckpoint(h);
  assert.ok(![...h.objects.keys()].some(key => key.endsWith(".mp4")));
  const manifest = JSON.parse([...h.objects.entries()].find(([key]) => key.endsWith("manifest.json"))![1].toString());
  assert.equal(manifest.version, 2); assert.equal(manifest.pendingProvider.videoId, "accepted-video");
  assert.doesNotMatch(JSON.stringify(manifest), /private brief|https:/);
});
test("ten normal HeyGen polls keep the paid job alive without consuming composition retries, saving or billing", async () => {
  const h = harness(); await saveHeygenCheckpoint(h);
  for (let i = 0; i < 10; i++) {
    assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"retry_pending");
    assert.equal(h.record!.attempts,0);
  }
  assert.equal(h.events.filter(event => event === "provider-get:accepted-video").length,10);
  assert.ok(!h.events.some(event => ["compose","save","complete","fail","expire","provider-cleanup"].includes(event)));
});
test("a transient status lookup failure keeps the same HeyGen task and its resources for the next poll", async () => {
  const h = harness({ providerStatusFails: true }); await saveHeygenCheckpoint(h);
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"retry_pending");
  assert.equal(h.record!.attempts,0);
  assert.ok(!h.events.includes("provider-cleanup"));
});
test("an explicit HeyGen render failure releases the user reservation and cleans only its tracked resources", async () => {
  const h = harness({ providerState: "failed" }); await saveHeygenCheckpoint(h);
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"failed");
  assert.equal(h.record!.state,"failed");
  assert.equal(h.events.filter(event => event === "fail").length,1);
  assert.ok(h.events.includes("provider-cleanup"));
  assert.ok(!h.events.includes("save") && !h.events.includes("complete"));
});
test("a completed HeyGen render is downloaded once and keeps its native voices through saving and final billing", async () => {
  const h = harness({ providerState: "completed" }); await saveHeygenCheckpoint(h);
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"completed");
  assert.equal(h.events.filter(event => event === "provider-download").length,1);
  assert.equal(h.composed!.nativeAudioMode,"dialogue"); assert.equal(h.composed!.narration,null);
  assert.equal(h.composed!.clips[0].buffer.toString(),"paid-heygen-mp4");
  assert.ok(h.events.indexOf("provider-cleanup") > h.events.indexOf("complete"));
});

test("a failed optional HeyGen finishing still delivers the original paid render once", async () => {
  const h = harness({ providerState: "completed", composeFails: "ai_original_video_clip_contract_failed:https://private.invalid?token=secret" });
  await saveHeygenCheckpoint(h);
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status, "completed");
  assert.ok(h.events.includes("save") && h.events.includes("complete") && h.events.includes("provider-cleanup"));
  assert.doesNotMatch(JSON.stringify(h.warnings), /private.invalid|token=secret/);
  assert.equal(JSON.stringify((h.metadata!.gateway as Record<string,unknown>).warnings), JSON.stringify(["video_finishing_unavailable_original_retained"]));
  assert.equal(h.events.filter(event => event === "provider-download").length, 1);
});

test("a direct HeyGen video without requested finishing is saved byte-for-byte without FFmpeg", async () => {
  const h = harness({ providerState: "completed" });
  await h.runtime.persistAiMediaCompositionCheckpoint({ accountId,jobId,authUserId,
    input: {...input,clips:[{buffer:Buffer.alloc(0),durationSeconds:8}],nativeAudioMode:"dialogue",narration:null},
    pendingProvider:pendingTask(),metadata:{provider:"heygen-direct",video_engine:"heygen-avatar",video_resolution:"1080p",video_finishing_requested:false} });
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"completed");
  assert.ok(!h.events.includes("compose"));
  assert.equal(h.events.filter(event=>event==="save").length,1);
  assert.equal(h.events.filter(event=>event==="complete").length,1);
});
test("a direct unadorned HeyGen render does not depend on unused overlay storage", async () => {
  const h = harness({ providerState: "completed" });
  await h.runtime.persistAiMediaCompositionCheckpoint({ accountId,jobId,authUserId,
    input: {...input,clips:[{buffer:Buffer.alloc(0),durationSeconds:8}],nativeAudioMode:"dialogue",narration:null},
    pendingProvider:pendingTask(),metadata:{provider:"heygen-direct",video_engine:"heygen-avatar",video_finishing_requested:false} });
  for (const key of [...h.objects.keys()]) if (key.endsWith("/overlay-0.png")) h.objects.delete(key);
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"completed");
  assert.equal(h.media!.buffer.toString(),"paid-heygen-mp4");
  assert.ok(!h.events.includes("compose"));
  assert.equal(JSON.stringify((h.metadata!.gateway as Record<string,unknown>).warnings),"[]");
});

for (const missingAsset of ["overlay-0.png", "soundtrack.wav"]) test("a missing optional " + missingAsset + " keeps the paid native render and honest music metadata", async () => {
  const load = runtimeModules();
  const assets = load<typeof import("../../lib/aiMediaGenerationSoundtracks.ts")>("lib/aiMediaGenerationSoundtracks.ts");
  const soundtrack = await assets.loadAiMediaSoundtrack("", { soundtrackId:"piano-serein", durationSeconds:8 });
  const h = harness({ providerState:"completed" });
  await h.runtime.persistAiMediaCompositionCheckpoint({ accountId,jobId,authUserId,
    input:{...input,clips:[{buffer:Buffer.alloc(0),durationSeconds:8}],nativeAudioMode:"dialogue",narration:null,soundtrack},
    pendingProvider:pendingTask(),metadata:{provider:"heygen-direct",video_engine:"heygen-avatar",video_finishing_requested:true,soundtrack} });
  for (const key of [...h.objects.keys()]) if (key.endsWith("/" + missingAsset)) h.objects.delete(key);
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"completed");
  assert.equal(h.media!.buffer.toString(),"paid-heygen-mp4");
  assert.ok(!h.events.includes("compose"));
  assert.equal(h.events.filter(event=>event==="complete").length,1);
  assert.equal(h.events.filter(event=>event==="provider-download").length,1);
  assert.equal(h.metadata!.soundtrack,null);
  assert.equal(h.completedMetadata!.soundtrack_id,undefined);
  assert.equal(JSON.stringify((h.metadata!.gateway as Record<string,unknown>).warnings),JSON.stringify(["video_finishing_unavailable_original_retained"]));
});

for (const durationSeconds of [2.65, 10.3184, 19.7681, 31.2, 200]) test(`HeyGen preserves all ${durationSeconds}s of spoken video instead of enforcing the requested 16s`, async () => {
  const h = harness({ providerState: "completed", providerDuration: durationSeconds });
  await saveHeygenCheckpoint(h, 16);
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status, "completed");
  assert.equal(h.composed!.durationSeconds, durationSeconds);
  assert.equal(h.composed!.clips[0].durationSeconds, durationSeconds);
  assert.equal(h.composed!.durationFromAudio, true);
  assert.equal(h.composed!.nativeAudioMode, "dialogue");
  assert.equal((h.metadata!.provenance as Record<string, unknown>).duration_seconds, durationSeconds);
  assert.equal((h.metadata!.provenance as Record<string, unknown>).requested_duration_seconds, 16);
  assert.equal(h.events.filter(event => event === "provider-download").length, 1);
  assert.equal(h.events.filter(event => event === "complete").length, 1);
});

test("HeyGen's existing multi-cut montage reads the entire rendered dialogue once without repeating its start", async () => {
  const h = harness({ providerState: "completed", providerDuration: 10.3184 });
  await h.runtime.persistAiMediaCompositionCheckpoint({ accountId, jobId, authUserId,
    input: { ...input, durationSeconds: 16, clips: [{ buffer: Buffer.alloc(0), durationSeconds: 8, sourceStartSeconds: 0 },
      { buffer: Buffer.alloc(0), durationSeconds: 8, sourceStartSeconds: 8 }], overlays: [Buffer.from("first"), Buffer.from("second")],
      nativeAudioMode: "dialogue", narration: null }, pendingProvider: pendingTask(), metadata: { provider: "heygen-direct", video_engine: "heygen-avatar" } });
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status, "completed");
  assert.equal(h.composed!.clips.length, 2);
  assert.equal(h.composed!.clips[0].durationSeconds, 5.1592);
  assert.equal(h.composed!.clips[1].sourceStartSeconds, 5.1592);
  assert.equal(h.composed!.clips[1].buffer, h.composed!.clips[0].buffer);
  assert.equal(h.events.filter(event => event === "provider-download").length, 1);
});
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
test("requested narration captions survive a private checkpoint roundtrip without entering diagnostics", async () => {
  const h = harness();
  const subtitles = { script: "L’été d’Inès révèle l’élégance du jardin." };
  await h.runtime.persistAiMediaCompositionCheckpoint({ accountId, jobId, authUserId, input: { ...input, subtitles }, metadata: { prompt: "PRIVATE BRIEF", subtitles } });
  const manifest = JSON.parse([...h.objects.entries()].find(([key]) => key.endsWith("manifest.json"))![1].toString());
  assert.deepEqual(manifest.subtitles, subtitles);
  assert.ok(!JSON.stringify(manifest.metadata).includes(subtitles.script));
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status, "completed");
  assert.equal(h.composed!.subtitles!.script, subtitles.script);
  assert.deepEqual(h.composed!.narration!.buffer, input.narration!.buffer);
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

test("Studio composition checkpoints preserve the actual legacy or versioned audio bytes without selecting or regenerating music on recovery", async () => {
  const load = runtimeModules();
  const assets = load<typeof import("../../lib/aiMediaGenerationSoundtracks.ts")>("lib/aiMediaGenerationSoundtracks.ts");
  for (const id of ["cinema-inspirant", "piano-serein"]) for (const durationSeconds of [8, 24]) {
    const soundtrack = await assets.loadAiMediaSoundtrack("", { soundtrackId: id, durationSeconds });
    const h = harness();
    await h.runtime.persistAiMediaCompositionCheckpoint({ accountId, jobId, authUserId, input: { ...input, soundtrack }, metadata: { soundtrack } });
    const storedAudio = [...h.objects.entries()].find(([key]) => key.endsWith("/soundtrack.wav"))![1];
    const savedManifest = JSON.parse([...h.objects.entries()].find(([key]) => key.endsWith("/manifest.json"))![1].toString());
    assert.equal(savedManifest.metadata.soundtrack_id, id);
    assert.equal(createHash("sha256").update(storedAudio).digest("hex"), soundtrack.sha256);
    assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status, "completed");
    assert.deepEqual(h.composedSoundtrack, storedAudio);
    assert.equal(h.composed!.soundtrack!.id, id);
    assert.equal(h.composed!.soundtrack!.durationSeconds, durationSeconds);
    assert.equal(h.composed!.soundtrack!.sha256, soundtrack.sha256);
    assert.equal(h.composed!.soundtrack!.license, soundtrack.license);
    const finalSoundtrack = h.metadata!.soundtrack as { id: string; sha256: string };
    assert.equal(finalSoundtrack.id, id);
    assert.equal(finalSoundtrack.sha256, soundtrack.sha256);
    assert.ok(h.events.includes("complete"));
  }
});

test("composition persistence rejects a forged asset path even for a registered current or historical ID", async () => {
  const load = runtimeModules();
  const assets = load<typeof import("../../lib/aiMediaGenerationSoundtracks.ts")>("lib/aiMediaGenerationSoundtracks.ts");
  for (const id of ["cinema-inspirant", "piano-serein"]) {
    const soundtrack = await assets.loadAiMediaSoundtrack("", { soundtrackId: id, durationSeconds: 24 });
    const h = harness();
    await assert.rejects(h.runtime.persistAiMediaCompositionCheckpoint({ accountId, jobId, authUserId, input: { ...input, soundtrack: { ...soundtrack, absolutePath: "/untrusted/signed-audio.wav" } }, metadata: {} }), /ai_media_composition_soundtrack_invalid/);
    assert.ok(![...h.objects.keys()].some(key => key.endsWith("/soundtrack.wav")));
    assert.ok(!h.events.includes("ready_ai_media_composition_checkpoint"));
    assert.ok(!h.events.includes("compose"));
    assert.ok(!h.events.includes("complete"));
    assert.ok(h.events.includes("abandon_ai_media_composition_checkpoint"));
  }
});

test("corrupt saved soundtrack bytes block recovery before composition, saving or charging", async () => {
  const load = runtimeModules();
  const assets = load<typeof import("../../lib/aiMediaGenerationSoundtracks.ts")>("lib/aiMediaGenerationSoundtracks.ts");
  const soundtrack = await assets.loadAiMediaSoundtrack("", { soundtrackId: "piano-serein", durationSeconds: 24 });
  const h = harness();
  await h.runtime.persistAiMediaCompositionCheckpoint({ accountId, jobId, authUserId, input: { ...input, soundtrack }, metadata: {} });
  const [key, bytes] = [...h.objects.entries()].find(([entry]) => entry.endsWith("/soundtrack.wav"))!;
  const corrupted = Buffer.from(bytes); corrupted[corrupted.length - 1] ^= 1; h.objects.set(key, corrupted);
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status, "retry_pending");
  assert.ok(!h.events.includes("compose"));
  assert.ok(!h.events.includes("save"));
  assert.ok(!h.events.includes("complete"));
});

test("HeyGen private bucket and scoped DB anchor are established before any provider work",async()=>{
  const h=harness();const anchor=await h.runtime.startPendingAiMediaVideoAnchor({accountId,jobId,authUserId});
  assert.equal(anchor.accountId,accountId);assert.equal(h.record!.state,"uploading");
  assert.deepEqual(h.events,["start_ai_media_composition_checkpoint_v2"]);
  assert.equal(h.objects.size,0);
  const unavailable=harness({bucketFails:true});
  await assert.rejects(unavailable.runtime.startPendingAiMediaVideoAnchor({accountId,jobId,authUserId}),/private_bucket_required/);
  assert.equal(unavailable.events.length,0);
});

for(const options of [{receiptCasConflict:true},{receiptWriteLostAck:true}])test("the accepted receipt survives CAS concurrency or a lost acknowledgement without overwriting job metadata "+JSON.stringify(options),async()=>{
  const h=harness(options);await saveHeygenCheckpoint(h);
  const metadata=h.job.metadata as Record<string,unknown>;
  assert.equal(metadata.format,"story");if(options.receiptCasConflict)assert.equal(metadata.concurrent,"preserved");
  const receipt=metadata.ai_media_pending_video_receipt as {manifest:{pendingProvider:{videoId:string}}};
  assert.equal(receipt.manifest.pendingProvider.videoId,"accepted-video");
  assert.equal(h.events.filter(value=>value==="receipt-cas").length,options.receiptCasConflict?2:1);
  assert.doesNotMatch(JSON.stringify(receipt),/private brief|https:|script|narration-source/);
});

test("Storage failure after supplier acceptance keeps a ready receipt and saves the same paid render",async()=>{
  const h=harness({uploadFails:true,providerState:"completed"});await saveHeygenCheckpoint(h);
  assert.equal(h.record!.state,"ready");assert.equal(h.objects.size,0);
  assert.ok(!h.events.includes("abandon_ai_media_composition_checkpoint"));
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"completed");
  assert.equal(h.media!.buffer.toString(),"paid-heygen-mp4");assert.ok(!h.events.includes("compose"));
  assert.equal(h.events.filter(value=>value==="provider-download").length,1);
  assert.equal(h.events.filter(value=>value==="complete").length,1);assert.ok(!h.events.includes("fail"));
  assert.match(JSON.stringify((h.metadata!.gateway as Record<string,unknown>).warnings),/video_finishing_unavailable_original_retained/);
});

test("a lost ready acknowledgement reconciles its exact lease and manifest instead of abandoning the render",async()=>{
  const h=harness({readyLostAck:true});await saveHeygenCheckpoint(h);
  assert.equal(h.record!.state,"ready");assert.ok(!h.events.includes("abandon_ai_media_composition_checkpoint"));
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"retry_pending");
  assert.equal(h.events.filter(value=>value==="provider-get:accepted-video").length,1);
});

test("an unavailable receipt write still permits the independent private Storage checkpoint",async()=>{
  const h=harness({receiptWriteFails:true,providerState:"completed"});await saveHeygenCheckpoint(h);
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"completed");
  assert.equal(h.events.filter(value=>value==="provider-download").length,1);assert.ok(!h.events.includes("fail"));
});

test("simultaneous receipt and Storage outages never abandon or refund an accepted remote render",async()=>{
  const h=harness({receiptWriteFails:true,uploadFails:true});
  await assert.rejects(saveHeygenCheckpoint(h),/upload_failed/);
  assert.equal(h.record!.state,"uploading");
  assert.ok(!h.events.includes("abandon_ai_media_composition_checkpoint"));
  assert.ok(!h.events.includes("fail"));assert.ok(!h.events.includes("expire"));
});

for(const field of ["accountId","jobId","actorAuthUserId","manifestPath"])test("a forged fallback receipt "+field+" cannot read or download a supplier result",async()=>{
  const h=harness({uploadFails:true,providerState:"completed"});await saveHeygenCheckpoint(h);
  const receipt=(h.job.metadata as Record<string,unknown>).ai_media_pending_video_receipt as Record<string,unknown>;
  receipt[field]=field==="manifestPath"?accountId+"/_composition-recovery/"+jobId+"/"+authUserId+"/manifest.json":"44444444-4444-4444-8444-444444444444";
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"retry_pending");
  assert.ok(!h.events.some(value=>value.startsWith("provider-get:")));assert.ok(!h.events.includes("provider-download"));assert.ok(!h.events.includes("save"));assert.ok(!h.events.includes("complete"));
});

test("an unclaimable checkpoint is active only while its owning job is still pending",async()=>{
  const h=harness();await saveHeygenCheckpoint(h);
  for(const status of ["reserved","processing"]){
    h.job.status=status;
    assert.equal(await h.runtime.hasActiveAiMediaCompositionCheckpoint({accountId,jobId}),true);
  }
  const reads=h.events.filter(value=>value==="has_ai_media_composition_checkpoint").length;
  for(const status of ["completed","failed","expired"]){
    h.job.status=status;
    assert.equal(await h.runtime.hasActiveAiMediaCompositionCheckpoint({accountId,jobId}),false);
  }
  assert.equal(h.events.filter(value=>value==="has_ai_media_composition_checkpoint").length,reads);
  assert.equal(await h.runtime.hasActiveAiMediaCompositionCheckpoint({accountId,jobId:"44444444-4444-4444-8444-444444444444"}),false);
});

test("the first accepted supplier ID is immutable across an accidental second persistence",async()=>{
  const h=harness();await saveHeygenCheckpoint(h);
  const checkpoint={accountId,jobId,leaseToken:h.record!.lease_token as string};
  await assert.rejects(h.runtime.persistAiMediaCompositionCheckpoint({accountId,jobId,authUserId,checkpoint,
    input:{...input,narration:null,nativeAudioMode:"dialogue"},pendingProvider:{...pendingTask(),videoId:"another-video"},
    metadata:{provider:"heygen-direct",video_engine:"heygen-avatar"}}),/receipt_conflict/);
  const receipt=(h.job.metadata as Record<string,unknown>).ai_media_pending_video_receipt as {manifest:{pendingProvider:{videoId:string}}};
  assert.equal(receipt.manifest.pendingProvider.videoId,"accepted-video");
});

for(const receiptWriteFails of [false,true])test("an immediate provider-only receipt tolerates unfinished PNGs and either private durability store "+receiptWriteFails,async()=>{
  const h=harness({receiptWriteFails,providerState:"completed"});
  const checkpoint=await h.runtime.persistAiMediaCompositionCheckpoint({accountId,jobId,authUserId,providerReceiptOnly:true,
    input:{...input,overlays:[Buffer.alloc(0)],clips:[{buffer:Buffer.alloc(0),durationSeconds:8}],narration:null,nativeAudioMode:"dialogue"},
    pendingProvider:pendingTask(),metadata:{provider:"heygen-direct",video_engine:"heygen-avatar",video_finishing_requested:true}});
  assert.equal(h.record!.state,"ready");assert.equal(checkpoint.leaseToken,h.record!.lease_token);
  assert.equal([...h.objects.keys()].filter(key=>key.endsWith(".png")).length,0);
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"completed");
  assert.equal(h.media!.buffer.toString(),"paid-heygen-mp4");assert.ok(!h.events.includes("compose"));
  assert.ok(!h.events.includes("abandon_ai_media_composition_checkpoint"));
});
test("a provider receipt can be completed with its requested native captions under the same immutable task and lease",async()=>{
  const h=harness({providerState:"completed"});
  const metadata={provider:"heygen-direct",video_engine:"heygen-avatar",video_finishing_requested:true};
  const native={...input,clips:[{buffer:Buffer.alloc(0),durationSeconds:8}],narration:null,nativeAudioMode:"dialogue" as const};
  const checkpoint=await h.runtime.persistAiMediaCompositionCheckpoint({accountId,jobId,authUserId,providerReceiptOnly:true,
    input:{...native,overlays:[Buffer.alloc(0)]},pendingProvider:pendingTask(),metadata});
  await h.runtime.persistAiMediaCompositionCheckpoint({accountId,jobId,authUserId,checkpoint,
    input:{...native,subtitles:{script:"Bienvenue au jardin.",source:"native"}},pendingProvider:pendingTask(),metadata});
  assert.equal((await h.runtime.recoverNextAiMediaCompositionCheckpoint()).status,"completed");
  assert.equal(h.composed!.subtitles!.source,"native");assert.equal(h.composed!.nativeAudioMode,"dialogue");assert.equal(h.composed!.narration,null);
  assert.equal(h.events.filter(event=>event==="receipt-cas").length,1);assert.equal(h.events.filter(event=>event==="provider-download").length,1);
});
