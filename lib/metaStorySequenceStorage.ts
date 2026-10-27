import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { acquireExecutionIdempotencyLock, completeExecutionIdempotencyLockOrThrow, failExecutionIdempotencyLock } from "@/lib/executionIdempotency";
import { runMetaStorySequence, type MetaStorySequenceState } from "@/lib/metaStorySequence";
import { publishMetaVideoStory } from "@/lib/metaPhotoStoryPublisher";
import { createInstagramImageMotionVideo } from "@/lib/instagramImageMotionVideo";
import { loadAiMediaSoundtrack, type LoadedAiMediaSoundtrack } from "@/lib/aiMediaGenerationSoundtracks";
import type { InstagramAuthMode } from "@/lib/instagramAuthMode";
import { normalizeBoosterSoundtrackId } from "@/lib/boosterSoundtracks";

export const META_STORY_SEQUENCE_EVENT_TYPE = "publish_meta_story_sequence";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function sequenceId(accountId: string, publicationId: string, channel: string) {
  const hash = createHash("sha256").update(`meta-story-v1:${accountId}:${publicationId}:${channel}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Dedicated retained app_event: publication finalization may remove technical
 * child events, while a partial Story sequence must remain safely resumable. */
export async function publishPersistedMetaStorySequence(args: {
  accountId: string; publicationId: string; channel: "facebook" | "instagram";
  remoteAccountId: string; accessToken: string; authMode?: InstagramAuthMode;
  tokenCandidates?: readonly { source?: string; accessToken: string }[];
  photos: readonly { url: string; storagePath: string; sourceIdentity: string }[];
  soundtrackPrompt: string; soundtrackId?: string | null; resumeRef?: unknown; deadlineAt?: number; signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const hasResume = args.resumeRef !== undefined && args.resumeRef !== null;
  const ref = hasResume ? String(args.resumeRef) : sequenceId(args.accountId, args.publicationId, args.channel);
  let exists = false;
  const blocked = (code: string, message: string, retryable = false) => ({ ok: false, code, error: message, retryable, ...((exists || hasResume) && UUID.test(ref) ? { story_sequence_resume_ref: ref } : {}) });
  let requestedSoundtrackId: string | null;
  try { requestedSoundtrackId = normalizeBoosterSoundtrackId(args.soundtrackId); }
  catch { return blocked("booster_soundtrack_invalid", "Choisissez une musique iNrCy disponible ou le mode Auto."); }
  if (!UUID.test(args.accountId) || !UUID.test(args.publicationId) || !UUID.test(ref) || !args.photos.length || args.photos.length > 5 || args.photos.some(photo => !/^jpeg-sha256:[a-f0-9]{64}$/.test(photo.sourceIdentity))) return blocked("meta_story_resume_invalid", "La référence de reprise ou les photos de cette séquence sont invalides.");
  const identities = args.photos.map(photo => photo.sourceIdentity);
  const authMode = args.channel === "instagram" ? args.authMode || "facebook_login" : "facebook_login";
  let revision = 0;
  let soundtrack: LoadedAiMediaSoundtrack | null = null;
  let nativePreparations = identities.map(() => ({ preparedId: null as string | null, publishStarted: false }));
  let persistState: (state: MetaStorySequenceState) => Promise<void> = async () => { throw new Error("meta_story_storage_not_ready"); };
  let currentState: unknown = null;
  const metadata = { version: 1, nativeStageVersion: 1, mediaKind: "video", audioMode: "shared", publicationId: args.publicationId, channel: args.channel, remoteAccountId: args.remoteAccountId, authMode, sources: identities };
  let storedMetadata: Record<string, unknown> = metadata;
  try {
    const read = await supabaseAdmin.from("app_events").select("id,payload").eq("id", ref).eq("user_id", args.accountId).eq("type", META_STORY_SEQUENCE_EVENT_TYPE).maybeSingle();
    if (read.error) throw read.error;
    if (read.data) {
      const payload = object(read.data.payload);
      if (read.data.id !== ref || payload.version !== 1 || payload.nativeStageVersion !== 1 || payload.mediaKind !== "video" || payload.audioMode !== "shared" || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1 || payload.channel !== args.channel || payload.remoteAccountId !== args.remoteAccountId || payload.authMode !== authMode || JSON.stringify(payload.sources) !== JSON.stringify(identities) || !UUID.test(String(payload.publicationId || ""))) return blocked("meta_story_resume_mismatch", "Ces photos, leur ordre ou le compte connecté ne correspondent pas à la séquence initiale. Aucune Story supplémentaire n’a été publiée.");
      exists = true; storedMetadata = { ...metadata, publicationId: payload.publicationId }; currentState = payload.state;
      if (!currentState) return blocked("meta_story_checkpoint_invalid", "L’état de cette séquence ne peut pas être vérifié. Consultez les Stories publiées avant de reprendre.");
    } else if (hasResume) return blocked("meta_story_resume_not_found", "Cette séquence de Stories n’a pas été retrouvée pour cet établissement. Aucune nouvelle publication n’a été lancée.");
  } catch {
    return blocked("meta_story_checkpoint_unavailable", "L’état de la séquence n’a pas pu être lu. Aucune Story n’a été publiée par cette tentative.", true);
  }
  const lease = await acquireExecutionIdempotencyLock({ supabase: supabaseAdmin, userId: args.accountId, scope: "meta_story_sequence", idempotencyKey: ref, ttlMs: 5 * 60_000, metadata: { sequenceId: ref, channel: args.channel } });
  if (lease.state === "unavailable" || lease.state === "acquired" && !lease.lock?.id) return blocked("meta_story_lease_unavailable", "La séquence n’a pas pu être sécurisée. Aucune Story n’a été publiée par cette tentative.", true);
    if (lease.state === "running") return { ...blocked("meta_story_sequence_running", "Cette séquence est déjà en cours. Patientez avant de reprendre.", true), story_sequence_resume_ref: ref };
  const deadlineAt = Math.min(args.deadlineAt || Infinity, Date.now() + 140_000);
  try {
    const result = await runMetaStorySequence({
      scopeKey: `${args.accountId}:${ref}:${args.channel}:${args.remoteAccountId}:${authMode}`,
      sources: identities,
      canStartWork: () => !args.signal?.aborted && Date.now() < deadlineAt - 5_000,
      load: async () => {
        // A sibling retry may have advanced the state between the first read
        // and lease acquisition. Never execute from that stale snapshot.
        const fresh = await supabaseAdmin.from("app_events").select("id,payload").eq("id", ref).eq("user_id", args.accountId).eq("type", META_STORY_SEQUENCE_EVENT_TYPE).maybeSingle();
        if (fresh.error) throw fresh.error;
        if (!fresh.data) {
          if (hasResume || exists) throw new Error("meta_story_checkpoint_missing");
          soundtrack = await loadAiMediaSoundtrack(args.soundtrackPrompt, { selectionKey: `${args.accountId}:${args.publicationId}:story-series`, durationSeconds: 8, soundtrackId: requestedSoundtrackId || undefined });
          storedMetadata = { ...metadata, soundtrackId: soundtrack.id, soundtrackSha256: soundtrack.sha256 };
          return null;
        }
        const payload = object(fresh.data.payload);
        if (fresh.data.id !== ref || payload.version !== 1 || payload.nativeStageVersion !== 1 || payload.mediaKind !== "video" || payload.audioMode !== "shared" || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1 || payload.channel !== args.channel || payload.remoteAccountId !== args.remoteAccountId || payload.authMode !== authMode || JSON.stringify(payload.sources) !== JSON.stringify(identities) || !UUID.test(String(payload.publicationId || "")) || !payload.state || typeof payload.soundtrackId !== "string" || !/^[a-f0-9]{64}$/.test(String(payload.soundtrackSha256 || "")) || !Array.isArray(payload.nativePreparations) || payload.nativePreparations.length !== identities.length || payload.nativePreparations.some(raw => { const item = object(raw); return typeof item.publishStarted !== "boolean" || item.preparedId !== null && (typeof item.preparedId !== "string" || !/^[a-zA-Z0-9_-]{1,180}$/.test(item.preparedId)); })) throw new Error("meta_story_checkpoint_changed");
        normalizeBoosterSoundtrackId(payload.soundtrackId);
        nativePreparations = payload.nativePreparations.map(raw => ({ preparedId: object(raw).preparedId as string | null, publishStarted: object(raw).publishStarted as boolean }));
        exists = true; revision = Number(payload.revision); storedMetadata = { ...metadata, publicationId: payload.publicationId, soundtrackId: payload.soundtrackId, soundtrackSha256: payload.soundtrackSha256 }; currentState = payload.state;
        const state = object(currentState);
        // Only a durable false flag proves staging never reached the final
        // provider commit. A true flag keeps the helper's unknown blockade.
        return state.version === 1 && Array.isArray(state.items) ? { ...state, items: state.items.map((raw, index) => { const item = object(raw); return item.status === "dispatching" && Object.keys(item).length === 3 && item.index === index && item.source === identities[index] && nativePreparations[index]?.publishStarted === false ? { index: item.index, source: item.source, status: "failed", retryable: true, error: "La préparation précédente a été interrompue avant la publication de cette Story." } : raw; }) } : currentState;
      },
      persist: persistState = async (state: MetaStorySequenceState) => {
        if (lease.state !== "acquired") throw new Error("meta_story_lease_required");
        const nextRevision = revision + 1;
        const payload = { ...storedMetadata, revision: nextRevision, state, nativePreparations: nativePreparations.map(item => ({ ...item })), updatedAt: new Date().toISOString() };
        const written = exists
          ? await supabaseAdmin.from("app_events").update({ payload }).eq("id", ref).eq("user_id", args.accountId).eq("type", META_STORY_SEQUENCE_EVENT_TYPE).eq("payload->>revision", String(revision)).select("id").maybeSingle()
          : await supabaseAdmin.from("app_events").insert({ id: ref, user_id: args.accountId, module: "booster", type: META_STORY_SEQUENCE_EVENT_TYPE, payload }).select("id").maybeSingle();
        if (written.error || written.data?.id !== ref) throw new Error("meta_story_checkpoint_write_failed");
        exists = true; revision = nextRevision; currentState = state;
      },
      publish: async (_source, index) => {
        if (lease.state !== "acquired" || Date.now() >= deadlineAt - 5_000) return { ok: false, certainty: "not_published", retryable: lease.state === "acquired", error: "Le délai de cette tentative est atteint. Reprenez la même séquence pour terminer les Stories restantes." };
        let video: Awaited<ReturnType<typeof createInstagramImageMotionVideo>>;
        try {
          if (!soundtrack) soundtrack = await loadAiMediaSoundtrack("", { soundtrackId: String(storedMetadata.soundtrackId), durationSeconds: 8 });
          if (soundtrack.sha256 !== storedMetadata.soundtrackSha256) return { ok: false, certainty: "not_published", retryable: false, error: "La piste de cette séquence ne peut plus être vérifiée. Les Stories restantes n’ont pas été publiées." };
          video = await createInstagramImageMotionVideo({ accountId: args.accountId, publicationId: `${ref}-${index}`, imageStoragePaths: [args.photos[index].storagePath], placement: "story", preserveComposition: true, soundtrackPrompt: "", loadedSoundtrack: soundtrack, signal: args.signal });
        } catch { return { ok: false, certainty: "not_published", retryable: true, error: "La courte vidéo de cette Story n’a pas pu être préparée. La séquence peut être reprise." }; }
        return publishMetaVideoStory({ channel: args.channel, remoteAccountId: args.remoteAccountId, accessToken: args.accessToken, authMode: args.authMode, tokenCandidates: args.tokenCandidates, videoUrl: video.publicUrl, preparedId: nativePreparations[index].preparedId || undefined, deadlineAt, signal: args.signal,
          onPrepared: async id => { nativePreparations[index] = { preparedId: id, publishStarted: false }; await persistState(currentState as MetaStorySequenceState); },
          onPublishStarting: async () => { nativePreparations[index] = { ...nativePreparations[index], publishStarted: true }; await persistState(currentState as MetaStorySequenceState); },
        });
      },
    });
    const response = { ok: result.ok, code: result.ok ? "meta_story_sequence_published" : result.certainty === "unknown" ? "meta_story_sequence_unknown" : "meta_story_sequence_incomplete", retryable: result.retryable === true, ...(result.error ? { error: result.error } : {}), external_id: result.remoteIds[0] || null, external_ids: result.remoteIds, story_ids: result.remoteIds, image_count: result.publishedCount, published_image_count: result.publishedCount, expected_image_count: result.expectedCount, ...(exists ? { story_sequence_resume_ref: ref, soundtrack_id: storedMetadata.soundtrackId, ...(requestedSoundtrackId && requestedSoundtrackId !== storedMetadata.soundtrackId ? { soundtrack_selection_preserved: true } : {}) } : {}), requestMayHaveSucceeded: result.certainty === "unknown" };
    if (lease.state === "acquired") {
      if (result.ok) await completeExecutionIdempotencyLockOrThrow({ supabase: supabaseAdmin, lockId: lease.lock?.id, result: response });
      else await failExecutionIdempotencyLock({ supabase: supabaseAdmin, lockId: lease.lock?.id, error: String(response.error || response.code), result: response });
    }
    return response;
  } catch {
    if (lease.state === "acquired") await failExecutionIdempotencyLock({ supabase: supabaseAdmin, lockId: lease.lock?.id, error: "meta_story_checkpoint_unavailable" });
    return blocked("meta_story_checkpoint_unavailable", "Le suivi de la séquence n’a pas pu être confirmé. Vérifiez les Stories déjà publiées avant de reprendre.", false);
  }
}
