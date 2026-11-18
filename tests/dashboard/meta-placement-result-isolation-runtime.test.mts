/* eslint-disable @typescript-eslint/no-explicit-any -- execute production summary functions with isolated service boundaries */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isBoosterPublicationPendingStatus } from "../../lib/boosterPublicationStatus.ts";
import { classifyBoosterPublicationResult, mergePreflightFailuresIntoPublicationSummary } from "../../lib/boosterPublicationOutcome.ts";
import { isBoosterPublishFailureRetryable } from "../../lib/boosterPublicationPolicy.ts";
import * as storyRetry from "../../lib/publicationStorySequenceRetry.ts";
import { buildMetaPublicationSelection, normalizeMetaPublicationPlacement } from "../../lib/metaPublicationTargets.ts";
import { getMetaPlacementVideoIssues } from "../../lib/metaPlacementVideoPolicy.ts";
import { normalizeMetaPublicationRestrictionResult } from "../../lib/metaGraphErrorClassification.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
function productionFunction(path: string, name: string, scope: Record<string, unknown> = {}): any {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, `Production function ${name} is required`);
  const context = {
    ...storyRetry,
    cleanString: (value: unknown) => String(value ?? "").trim(),
    asRecord: (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value : {},
    CHANNEL_LABELS: { facebook: "Facebook", instagram: "Instagram", threads: "Threads", linkedin: "LinkedIn" },
    classifyBoosterPublicationResult, isBoosterPublishFailureRetryable, isBoosterPublicationPendingStatus, normalizeMetaPublicationRestrictionResult,
    mergePreflightFailuresIntoPublicationSummary, ...scope,
  };
  const code = ts.transpileModule(`return (${found.getText(source).replace(/^export\s+/, "")});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(context), code)(...Object.values(context));
}
const resultPath = "app/dashboard/_components/PublishExecutionResultModal.tsx";
const progressPath = "app/dashboard/_components/PublishExecutionProgress.tsx";
const getPublicationDestinationStatus = productionFunction(progressPath, "getPublicationDestinationStatus");
const publicationChannelKey = productionFunction(resultPath, "publicationChannelKey");
const entryPublicationId = productionFunction(resultPath, "entryPublicationId");
const isPendingPublicationEntry = productionFunction(resultPath, "isPendingPublicationEntry", { getPublicationDestinationStatus });
const resultScope = { getPublicationDestinationStatus, publicationChannelKey, entryPublicationId, isPendingPublicationEntry };
const mergeSnapshot = productionFunction(resultPath, "mergePublicationResultSnapshot", resultScope);
const resultCounts = productionFunction(resultPath, "getPublicationResultCounts", resultScope);

const entry = (channel: string, placement: string, status: string, extra: Record<string, unknown> = {}) => ({
  channel, targetKey: `${channel}:${placement}`, placement, label: channel,
  ok: status !== "failed", status, publicationId: "initial", ...extra,
});

test("Facebook main and Story are two publications even when channel totals still say one", () => {
  const counts = resultCounts({ total: 1, successCount: 1, entries: [entry("facebook", "classic", "published"), entry("facebook", "story", "published")] });
  assert.equal(counts.publishedCount, 2);
  assert.equal(counts.totalCount, 2);
  assert.equal(counts.destinationKeys.length, 2);
});

test("summary-only counts keep pending separate from one confirmed success", () => {
  const counts = resultCounts({ total: 2, successCount: 1, pendingCount: 1 });
  assert.equal(counts.publishedCount, 1);
  assert.equal(counts.pendingCount, 1);
  assert.equal(counts.totalCount, 2);
});

test("preflight merging never promotes unknown or pending metadata to published", () => {
  for (const details of [{ warning_kind: "pending", ok: true }, { technicalStatus: "processing", ok: true }, {}]) {
    const summary = mergePreflightFailuresIntoPublicationSummary({ successCount: 99, entries: [{ channel: "instagram", ...details }] }, []);
    assert.equal(summary.successCount, 0);
    assert.equal(summary.pendingCount, 1);
    assert.equal(summary.allSucceeded, false);
    assert.equal(summary.allFailed, false);
  }
});

test("Facebook and Instagram main plus Stories are four publications, never two networks", () => {
  const entries = [entry("facebook", "classic", "published"), entry("facebook", "story", "published"), entry("instagram", "reel", "published"), entry("instagram", "story", "published")];
  const counts = resultCounts({ total: 2, successCount: 2, entries }, [{ key: "facebook", label: "Facebook" }, { key: "instagram", label: "Instagram" }]);
  assert.equal(counts.publishedCount, 4);
  assert.equal(counts.totalCount, 4);
  assert.equal(counts.destinationKeys.length, 4);
});

test("partial delivery stays one out of two and ignores inconsistent aggregate metadata", () => {
  const counts = resultCounts({ total: 30, successCount: 20, failureCount: 10, pendingCount: 4, entries: [entry("facebook", "classic", "published"), entry("facebook", "story", "failed")] });
  assert.equal(counts.publishedCount, 1);
  assert.equal(counts.failedOrSkippedCount, 1);
  assert.equal(counts.pendingCount, 0);
  assert.equal(counts.totalCount, 2);
});

test("a single publication remains one and primary metadata never adds a second block", () => {
  const single = resultCounts({ entries: [{ channel: "linkedin", label: "LinkedIn", status: "published" }] });
  assert.equal(single.publishedCount, 1);
  assert.equal(single.totalCount, 1);
  const counts = resultCounts({ entries: [
    { channel: "facebook", label: "Facebook aggregate", status: "published" },
    entry("facebook", "classic", "published"), entry("facebook", "story", "failed"), entry("facebook", "classic", "published"),
  ] }, [{ key: "facebook", label: "Facebook" }, { key: "facebook:classic", placement: "classic", label: "Facebook main" }, { key: "facebook:story", placement: "story", label: "Facebook Story" }]);
  assert.equal(counts.entries.length, 2);
  assert.equal(counts.publishedCount, 1);
  assert.equal(counts.totalCount, 2);
  assert.deepEqual(counts.destinationKeys, ["facebook:classic", "facebook:story"]);
});

test("selected placements keep the denominator while their result has not arrived", () => {
  const counts = resultCounts({ entries: [entry("facebook", "classic", "published")] }, [
    { key: "facebook:classic", placement: "classic", label: "Facebook main" }, { key: "facebook:story", placement: "story", label: "Facebook Story" },
  ]);
  assert.equal(counts.publishedCount, 1);
  assert.equal(counts.pendingCount, 1);
  assert.equal(counts.totalCount, 2);
});

test("legacy published aggregates never override explicit Story state in either order", () => {
  const aggregate = { key: "facebook", label: "Facebook", status: "published" };
  const story = { key: "facebook:story", placement: "story", label: "Facebook Story", status: "pending" };
  for (const destinations of [[aggregate, story], [story, aggregate]]) {
    const counts = resultCounts({ entries: [entry("facebook", "classic", "published")] }, destinations);
    assert.equal(counts.publishedCount, 1);
    assert.equal(counts.pendingCount, 1);
    assert.equal(counts.totalCount, 2);
    assert.equal(counts.destinationsByChannel.get("facebook:story").status, "pending");
  }
  const primary = { key: "facebook:classic", placement: "classic", label: "Facebook main", status: "published" };
  const unconfirmedStory = { key: "facebook:story", placement: "story", label: "Facebook Story" };
  for (const destinations of [[aggregate, primary, unconfirmedStory], [primary, unconfirmedStory, aggregate]]) {
    const counts = resultCounts({ entries: [] }, destinations);
    assert.equal(counts.publishedCount, 1, "Only the explicitly confirmed primary is published");
    assert.equal(counts.pendingCount, 1, "An aggregate success proves nothing about the missing Story result");
    assert.equal(counts.totalCount, 2);
    assert.equal(counts.destinationsByChannel.get("facebook:story").status, undefined);
  }
});

test("common preflight failures count each selected placement exactly once", () => {
  const failures = ["classic", "story"].map((placement) => ({ channel: "facebook", targetKey: `facebook:${placement}`, placement, label: `Facebook ${placement}`, blockers: ["Média absent"] }));
  const summary = mergePreflightFailuresIntoPublicationSummary({ total: 0, successCount: 0, failureCount: 0, entries: [] }, [...failures, failures[0]]);
  assert.equal(summary.total, 2);
  assert.equal(summary.failureCount, 2);
  assert.deepEqual(summary.entries.map((entry) => entry.targetKey), ["facebook:classic", "facebook:story"]);
  assert.equal(resultCounts(summary).totalCount, 2);
  const mergedAgain = mergePreflightFailuresIntoPublicationSummary(summary, [{ channel: "facebook", blockers: ["Média absent"] }]);
  assert.equal(mergedAgain.total, 2, "An outer channel-level callback must not add a third aggregate failure");
  assert.equal(mergedAgain.entries.length, 2);
});

test("a Story retry retains two selected publications and does not count pending as success", () => {
  const publicationSummaryTargetKey = productionFunction("app/dashboard/booster/publier/publicationSubmissionPayload.ts", "publicationSummaryTargetKey");
  const mergeRetry = productionFunction("app/dashboard/booster/publier/publicationSubmissionPayload.ts", "mergeRetriedPublicationSummary", { ...resultScope, publicationSummaryTargetKey });
  const previous = { publicationId: "initial", entries: [entry("facebook", "classic", "published"), entry("facebook", "story", "failed", { retryable: true })] };
  const pending = mergeRetry(previous, { entries: [entry("facebook", "story", "processing")] }, "retry", ["facebook"]);
  assert.equal(pending.total, 2);
  assert.equal(pending.successCount, 1);
  assert.equal(pending.pendingCount, 1);
  assert.equal(pending.allFailed, false);
  assert.equal(resultCounts(pending).totalCount, 2);
  const done = mergeSnapshot(pending, { entries: [entry("facebook", "story", "published")] }, "retry");
  assert.equal(resultCounts(done).publishedCount, 2);
  assert.equal(resultCounts(done).totalCount, 2);
});

test("both server summaries preserve each Meta format and count partial success accurately", () => {
  for (const [path, name] of [["lib/boosterAsyncPublication.ts", "buildAsyncPublicationSummary"], ["app/api/booster/publish-now/publishNow.foundations.ts", "buildResultsSummary"]]) {
    const summary = productionFunction(path, name)({
      facebook: { ok: true, placements: { classic: { ok: true }, story: { ok: false, code: "facebook_story_video_duration_out_of_range", retryable: false, error: "Story supérieure à 60 s" } } },
      instagram: { ok: true, placements: { reel: { ok: true, status: "processing", warning_kind: "pending" }, story: { ok: false, retryable: true, error: "Une erreur temporaire" } } },
    }, ["facebook", "instagram"]);
    assert.deepEqual(summary.entries.map((item: any) => [item.targetKey, item.placement]), [
      ["facebook:classic", "classic"], ["facebook:story", "story"], ["instagram:reel", "reel"], ["instagram:story", "story"],
    ]);
    assert.equal(summary.total, 4);
    assert.equal(summary.successCount, 1);
    assert.equal(summary.failureCount, 2);
    assert.equal(summary.pendingCount, 1);
    assert.equal(summary.allFailed, false);
    assert.equal(summary.entries.find((item: any) => item.targetKey === "facebook:story").retryable, false);
  }
});

test("a snapshot updates two formats of the same channel without borrowing their outcomes", () => {
  const initial = { publicationId: "initial", entries: [entry("facebook", "classic", "queued"), entry("facebook", "story", "queued")] };
  const next = mergeSnapshot(initial, { entries: [entry("facebook", "classic", "published"), entry("facebook", "story", "failed", { retryable: false, error: "Durée incompatible" })] }, "initial");
  assert.deepEqual(next.entries.map((item: any) => [item.targetKey, item.status]), [["facebook:classic", "published"], ["facebook:story", "failed"]]);
  assert.equal(next.successCount, 1);
  assert.equal(next.failureCount, 1);
  assert.equal(next.pendingCount, 0);
  assert.equal(next.allFailed, false);
});

test("a slower pending snapshot cannot undo the confirmed primary while its Story continues", () => {
  const initial = { publicationId: "initial", entries: [entry("instagram", "reel", "published"), entry("instagram", "story", "queued")] };
  const next = mergeSnapshot(initial, { entries: [entry("instagram", "reel", "processing"), entry("instagram", "story", "published")] }, "initial");
  assert.deepEqual(next.entries.map((item: any) => item.status), ["published", "published"]);
  assert.equal(next.pendingCount, 0);
});

test("an older job snapshot cannot replace a retried Story with the same channel", () => {
  const initial = { publicationId: "retry", entries: [entry("facebook", "classic", "published"), entry("facebook", "story", "queued", { publicationId: "retry" })] };
  const next = mergeSnapshot(initial, { entries: [entry("facebook", "classic", "published"), entry("facebook", "story", "failed")] }, "initial");
  assert.equal(next.entries.length, 2);
  const story = next.entries.find((item: any) => item.targetKey === "facebook:story");
  assert.equal(story.status, "queued");
  assert.equal(story.publicationId, "retry");
});

test("an already open legacy channel card upgrades to two independently reported formats", () => {
  const initial = { publicationId: "initial", entries: [{ channel: "facebook", label: "Facebook", status: "queued", ok: true }] };
  const next = mergeSnapshot(initial, { entries: [entry("facebook", "classic", "published"), entry("facebook", "story", "failed")] }, "initial");
  assert.equal(next.entries.length, 2);
  assert.deepEqual(next.entries.map((item: any) => item.targetKey), ["facebook:classic", "facebook:story"]);
  const counts = resultCounts(next, [{ key: "facebook", label: "Facebook" }]);
  assert.deepEqual(counts.destinationKeys, ["facebook:classic", "facebook:story"]);
  assert.equal(counts.pendingCount, 0, "the replaced channel card must not remain as a phantom pending result");
  assert.equal(counts.totalCount, 2);
});

test("Story retry merges keep the original confirmed primary and its original job", () => {
  const payloadPath = "app/dashboard/booster/publier/publicationSubmissionPayload.ts";
  const publicationSummaryTargetKey = productionFunction(payloadPath, "publicationSummaryTargetKey");
  const mergeRetry = productionFunction(payloadPath, "mergeRetriedPublicationSummary", { ...resultScope, publicationSummaryTargetKey });
  const previous = { publicationId: "initial", entries: [entry("facebook", "classic", "published"), entry("facebook", "story", "failed", { retryable: true })] };
  const next = mergeRetry(previous, { entries: [entry("facebook", "story", "published")] }, "retry", ["facebook"]);
  assert.equal(next.entries.length, 2);
  assert.equal(next.entries.find((item: any) => item.targetKey === "facebook:classic").publicationId, "initial");
  assert.equal(next.entries.find((item: any) => item.targetKey === "facebook:story").publicationId, "retry");
  assert.equal(next.successCount, 2);
  assert.equal(next.failureCount, 0);
  assert.equal(next.allSucceeded, true);
});

test("Threads Ghost remains its own supported mode and never acquires Meta Story placements", () => {
  const summary = productionFunction("lib/boosterAsyncPublication.ts", "buildAsyncPublicationSummary")({ threads: { ok: true, threads_publication_mode: "ghost" } }, ["threads"]);
  assert.equal(summary.entries.length, 1);
  assert.equal(summary.entries[0].channel, "threads");
  assert.equal(summary.entries[0].threads_publication_mode, "ghost");
  assert.equal(summary.entries[0].placement ?? null, null);
});

test("the actual review keeps a Sunga Classic destination ready while refusing only its incompatible Story", () => {
  const path = "app/dashboard/booster/publier/publicationPlacementReview.ts";
  const buildReviews = productionFunction(path, "buildPublicationPlacementReviews", { buildMetaPublicationSelection, getMetaPlacementVideoIssues });
  const getFailures = productionFunction(path, "getPublicationTargetFailures");
  for (const channel of ["facebook", "instagram"]) {
    const reviews = buildReviews({
      channel, channelLabel: channel, primaryPlacement: "classic", includeStory: true,
      hasImage: false, hasVideo: true, durationSeconds: 69.58,
      source: { width: 464, height: 832, frameRate: 23.44 }, sizeBytes: 8.45 * 1024 * 1024, format: "original",
    });
    assert.equal(reviews.length, 2);
    assert.deepEqual(reviews[0].blockers, []);
    assert.ok(reviews[1].blockers.length > 0);
    const failures = getFailures(reviews);
    assert.deepEqual(Object.keys(failures), [`${channel}:story`]);
    assert.equal(failures[`${channel}:story`].retryable, false);
    assert.match(failures[`${channel}:story`].error, /3 à 60 s/);
  }
});

test("the actual review preserves Story-only intent and does not require media for Classic", () => {
  const path = "app/dashboard/booster/publier/publicationPlacementReview.ts";
  const buildReviews = productionFunction(path, "buildPublicationPlacementReviews", { buildMetaPublicationSelection, getMetaPlacementVideoIssues });
  const selection = { channel: "facebook", channelLabel: "Facebook", hasImage: false, hasVideo: false };
  const classic = buildReviews({ ...selection, primaryPlacement: "classic", includeStory: false });
  assert.equal(classic.length, 1);
  assert.deepEqual(classic[0].blockers, []);
  const story = buildReviews({ ...selection, primaryPlacement: "story", includeStory: true });
  assert.equal(story.length, 1);
  assert.equal(story[0].targetKey, "facebook:story");
  assert.deepEqual(story[0].blockerCodes, ["meta_placement_media_required"]);
});

test("retry selection contains only retryable formats without resending a confirmed primary", () => {
  const path = "app/dashboard/booster/publier/publicationSubmissionPayload.ts";
  const publicationSummaryTargetKey = productionFunction(path, "publicationSummaryTargetKey");
  const retryTargets = productionFunction(path, "getRetryPublicationTargets", { publicationSummaryTargetKey, normalizeMetaPublicationPlacement });
  const summary = { entries: [
    entry("facebook", "classic", "published"), entry("facebook", "story", "failed", { retryable: true }),
    entry("instagram", "reel", "published"), entry("instagram", "story", "failed", { retryable: false }),
    { channel: "threads", label: "Threads", ok: false, status: "failed", retryable: true, threads_publication_mode: "ghost" },
  ] };
  assert.deepEqual(retryTargets(summary, ["facebook", "instagram", "threads"]), [
    { key: "facebook:story", channel: "facebook", placement: "story" },
    { key: "threads", channel: "threads", placement: null },
  ]);
  assert.deepEqual(retryTargets(summary, ["instagram"]), []);
});
