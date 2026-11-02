import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as storyRetry from "../../lib/publicationStorySequenceRetry.ts";
import { mergePreflightFailuresIntoPublicationSummary } from "../../lib/boosterPublicationOutcome.ts";
import { isBoosterPublicationPendingStatus } from "../../lib/boosterPublicationStatus.ts";
import { mapProgressRange, resolvePublicationBilanProgress } from "../../lib/boosterProgressPhases.ts";
import type { PublicationSubmissionContext } from "../../app/dashboard/booster/publier/publicationSubmissionContext.ts";
import type { PublishExecutionSummary } from "../../app/dashboard/_components/PublishExecutionResultModal.tsx";
import { buildBoosterPublicationDispatchPlan, type BoosterChannelPreflightFailure } from "../../lib/boosterPublicationDispatchPlan.ts";
import { durationReviewItems } from "./booster-duration-readiness-fixture.mts";

type Json = Record<string, unknown>;
type Submission = ReturnType<typeof import("../../app/dashboard/booster/publier/publicationSubmission.ts").createPublicationSubmission>;
const read = (file: string) => readFileSync(`app/dashboard/booster/publier/${file}`, "utf8");
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const writes: Record<string, unknown[]> = {}, requests: Json[] = [], scheduled: Json[] = [], successes: Json[] = [];
  const state = {
    saving: false, draftSaving: false, scheduleSaving: false, voiceInputBusy: false,
    publishStartGuardRef: { current: false }, scheduleStartGuardRef: { current: false },
    authoritativeChannelsRef: { current: true }, connectedChannelsScopeRef: { current: "account-a" }, activeAccountId: "account-a",
    actorUserId: "actor-a", publicationActorScopeRef: { current: { actorUserId: "actor-a", accountId: "account-a" } },
    latestPublicationSummaryRef: { current: null as PublishExecutionSummary | null }, phasedPublicationProgressRef: { current: false },
    selectedChannels: ["facebook", "gmb"], i18nT: (key: string) => key, creationMode: "manual", idea: "Draft", theme: "",
    facebookPublicationPlacement: "classic", facebookStoryEnabled: false, instagramPublicationPlacement: "classic", instagramStoryEnabled: false,
    threadsPublicationMode: "classic", pinterestBoardId: "", pinterestBoardName: "", tiktokPublicationSettings: null,
    channelDetails: { facebook: { href: "https://example.test/facebook" }, gmb: { href: "https://example.test/gmb" } },
  };
  const media = { persistentMediaWorkspaceEnabled: false, mediaPipelineCutoverEnabled: false, images: [], videoFile: null, videoSettingsByChannel: {}, videoDurationSeconds: null, videoSourceMetadata: null, persistentMediaSynchronizing: false, persistentMediaStates: {}, videoVariantPreparationByChannel: {}, channelImageEditors: {}, imageMetaByKey: {}, unifiedMediaConsumptionClientAvailable: false, mediaWorkspaceClientKey: null, videoFormatByChannel: {}, videoAdaptationModeByChannel: {} };
  const posts = { facebook: { title: "Facebook", content: "Ready", cta: "" }, gmb: { title: "Google", content: "Ready", cta: "" } };
  let waitForIdle = async () => [] as unknown[];
  const preparation = {
    buildPreparedPostsByChannel: () => posts, getImagePreparationIssue: () => "", resolveChannelMediaMode: () => "none",
    waitForPersistentWorkspaceIdle: () => waitForIdle(), buildFinalReviewItems: (_posts: Json, channels: string[]) => channels.map(channel => ({ channel, label: channel, blockers: [] as string[], blockerCodes: [] as string[], publishable: true })),
    waitForPersistentWorkspaceReadiness: async () => null, getPublicationSoundtracks: () => ({}),
    filterPostsForSelectedChannels: (value: Json, channels: string[]) => Object.fromEntries(channels.map(channel => [channel, value[channel]])),
  };
  const actionValues: Json = {
    trackEvent: async (_type: string, payload: Json) => { requests.push(payload); const channels = payload.channels as string[]; return { publication_id: "publication-new", summary: { entries: channels.map(channel => ({ channel, label: channel, status: "published", ok: true })), successCount: channels.length, failureCount: 0, pendingCount: 0, allFailed: false } }; },
    onPublishSuccess: (result: Json) => successes.push(result), archivePersistentMediaWorkspace: async () => {},
    closeEmptyContentWarnings: () => {}, resetPublicationProgressPhases: () => {}, scrollToPublishArea: () => {},
    completePublicationProgress: () => {}, onUnsavedChange: () => {}, onClose: () => {},
  };
  const actions = new Proxy(actionValues, { get(target, key: string) { if (key in target) return target[key]; if (key.startsWith("set")) return (value: unknown) => { (writes[key] ||= []).push(value); }; throw new Error(`Unexpected action ${key}`); } });
  const modules: Record<string, Json> = {
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => state.activeAccountId },
    "../../_components/PublishExecutionProgress": { getPublicationDestinationStatus: (entry: Json) => isBoosterPublicationPendingStatus(entry.status) ? "pending" : entry.status === "published" ? "published" : entry.status === "published_with_warning" ? "warning" : "failed" },
    "@/lib/boosterPublicationOutcome": { mergePreflightFailuresIntoPublicationSummary },
    "@/lib/publicationStorySequenceRetry": storyRetry,
    "@/lib/boosterScheduleClient": { postBoosterScheduledAction: async (payload: Json) => { scheduled.push(payload); return { ok: true }; } },
    "@/lib/userFacingErrors": { getClientUserFacingErrorMessage: (error: Error) => error.message },
    "@/lib/boosterProgressPhases": { mapProgressRange, resolvePublicationBilanProgress },
    "@/lib/boosterPublicationStatus": { isBoosterPublicationPendingStatus },
    "./publishModal.shared": { CHANNEL_LABELS: { facebook: "Facebook", gmb: "Google" }, clampPercent: (value: number) => Math.max(0, Math.min(100, Math.round(value))), getAutomaticVideoSettingsForPublication: () => ({ format: "original", adaptationMode: "fit" }), uploadPreparedImages: async () => { throw new Error("Unexpected media upload"); } },
    "./publishModal.foundations": { EMPTY_CHANNEL_DETAILS: {}, normalizeExternalHref: (value: string) => value || "" },
    "@/lib/metaPublicationTargets": { buildMetaPublicationSelection: (primaryPlacement: string, includeStory: boolean) => ({ primaryPlacement, includeStory }) },
    "@/lib/mediaWorkspaceTimeout": { MEDIA_WORKSPACE_READINESS_TIMEOUT_MS: 35_000 },
  };
  let timerId = 0;
  const window = { setTimeout: (callback: () => void, delay: number) => { if (delay < 1_000) queueMicrotask(callback); return ++timerId; }, clearTimeout: () => {} };
  function load(file: string) { const exported: Json = {}; const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; new Function("exports", "require", "window", "fetch", code)(exported, (name: string) => { assert.ok(modules[name], `Unexpected dependency ${name}`); return modules[name]; }, window, () => { throw new Error("Unexpected fetch"); }); return exported; }
  modules["./publicationSubmissionPayload"] = load("publicationSubmissionPayload.ts");
  const factory = load("publicationSubmission.ts").createPublicationSubmission as (read: () => PublicationSubmissionContext) => Submission;
  const api = factory(() => ({ state, media, preparation, actions }) as unknown as PublicationSubmissionContext);
  return { api, state, media, preparation, actionValues, posts, requests, scheduled, successes, writes, setWorkspaceWait: (fn: typeof waitForIdle) => { waitForIdle = fn; } };
}

test("duration preflight reaches the dispatch plan as a non-retryable failure and preserves the valid channel result", async () => {
  const f = fixture(), providerChannels: string[] = [];
  const reviews = durationReviewItems(31);
  assert.deepEqual(reviews.find(item => item.channel === "gmb")?.mediaBlockerCodes, ["video_duration_too_long"]);
  f.preparation.buildFinalReviewItems = () => reviews;
  f.actionValues.trackEvent = async (_type: string, payload: Json) => {
    f.requests.push(payload);
    const plan = buildBoosterPublicationDispatchPlan(payload.channels as string[], payload.clientPreflightFailuresByChannel as Record<string, BoosterChannelPreflightFailure>);
    assert.deepEqual(plan.failedChannels, ["gmb"]);
    assert.equal(plan.entries.find(entry => entry.channel === "gmb")?.status, "failed");
    providerChannels.push(...plan.dispatchableChannels);
    return { publication_id: "publication-new", summary: { entries: plan.dispatchableChannels.map(channel => ({ channel, label: channel, status: "published", ok: true })), successCount: plan.dispatchableChannels.length, failureCount: 0, pendingCount: 0 } };
  };
  await f.api.runPublish();
  assert.deepEqual(providerChannels, ["facebook"], "the invalid video never reaches provider dispatch");
  assert.deepEqual(f.requests[0].channels, ["facebook", "gmb"], "the API envelope retains failed destinations for reporting");
  const failure = (f.requests[0].clientPreflightFailuresByChannel as Record<string, Json>).gmb;
  assert.equal(failure.code, "video_duration_too_long");
  assert.equal(failure.retryable, false);
  const summary = f.successes[0].summary as PublishExecutionSummary;
  assert.deepEqual(summary.entries?.map(entry => [entry.channel, entry.status]), [["facebook", "published"], ["gmb", "failed"]]);
  assert.equal(summary.entries?.find(entry => entry.channel === "gmb")?.retryable, false);
  assert.equal(summary.failureCount, 1);
});

test("publication and schedule refuse connections outside the active account before dispatch", async () => {
  const f = fixture(); f.state.connectedChannelsScopeRef.current = "old-account";
  await f.api.runPublish();
  await f.api.performSchedulePublication([{ channel: "gmb", scheduledAt: "2099-04-05T10:00:00.000Z" }], f.posts, null);
  assert.deepEqual(f.requests, []); assert.deepEqual(f.scheduled, []);
  assert.deepEqual(f.writes.setPublishError, ["connections_loading"]);
  assert.deepEqual(f.writes.setScheduleError, ["connections_loading"]);
});

test("the publication lock rejects a second invocation and a changed account aborts before dispatch", async () => {
  const f = fixture(), gate = deferred<unknown[]>(); f.media.persistentMediaWorkspaceEnabled = true;
  f.setWorkspaceWait(() => gate.promise);
  const pending = f.api.runPublish();
  assert.equal(f.state.publishStartGuardRef.current, true);
  await f.api.runPublish();
  assert.equal(f.requests.length, 0);
  f.state.activeAccountId = "account-b"; f.state.publicationActorScopeRef.current.accountId = "account-b";
  gate.resolve([]); await pending;
  assert.deepEqual(f.requests, []); assert.deepEqual(f.successes, []);
  assert.equal(f.state.publishStartGuardRef.current, false);
  assert.deepEqual(f.writes.setSaving, [true, false]);
  assert.equal(f.writes.setPublishError.at(-1), "connections_loading");
});

test("a retry submits only the failed selection and preserves the successful channel in its result", async () => {
  const f = fixture();
  const previous = { publicationId: "publication-old", entries: [{ channel: "facebook", label: "Facebook", ok: true, status: "published" }, { channel: "gmb", label: "Google", ok: false, status: "failed", retryable: true }] };
  await f.api.runPublish({ channels: ["gmb"], retryPreviousSummary: previous });
  assert.equal(f.requests.length, 1); assert.deepEqual(f.requests[0].channels, ["gmb"]);
  assert.deepEqual(Object.keys(f.requests[0].postByChannel as Json), ["gmb"]);
  assert.equal(f.successes.length, 1);
  const summary = f.successes[0].summary as PublishExecutionSummary;
  assert.deepEqual(summary.entries?.map(entry => [entry.channel, entry.status]), [["facebook", "published"], ["gmb", "published"]]);
  assert.equal(summary.entries?.[0].publicationId, "publication-old");
  assert.equal(summary.entries?.[1].publicationId, "publication-new");
  assert.equal(f.state.publishStartGuardRef.current, false);
});

test("scheduling returns only explicitly selected immediate channels and dispatches them only when chained", async () => {
  const f = fixture();
  const request = await f.api.performSchedulePublication([{ channel: "gmb", scheduledAt: "2099-04-05T10:00:00.000Z" }], f.posts, null, ["facebook"]);
  assert.equal(f.scheduled.length, 1); assert.deepEqual(f.scheduled[0].channels, ["gmb"]);
  assert.equal(f.requests.length, 0); assert.ok(request);
  assert.deepEqual(request.immediateChannels, ["facebook"]);
  assert.equal(f.state.scheduleStartGuardRef.current, false);
  f.api.publishImmediateChannelsAfterSchedule(request);
  for (let turn = 0; turn < 20 && !f.successes.length; turn++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1); assert.deepEqual(f.requests[0].channels, ["facebook"]);
  assert.equal(f.successes.length, 1);
});
