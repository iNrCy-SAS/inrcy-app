import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { getPublicationTargetPredecessor, runPublicationJobsInChannelOrder } from "../../lib/boosterPublicationSequence.ts";
import { buildBoosterPublicationTargets } from "../../lib/metaPublicationTargets.ts";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" ? value as RecordValue : {};
const clean = (value: unknown) => String(value || "").trim();
function callable<T = RecordValue>(file: string, name: string, context: RecordValue): (...args: unknown[]) => T {
  const text = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let found = "";
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(source).replace(/^export /, "");
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) found = `const ${name}=${node.initializer.getText(source)};`;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(found, name);
  const js = ts.transpileModule(`${found};return ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(context), js)(...Object.values(context));
}

test("each channel awaits its primary, a rejected primary still permits its Story, and other channels stay independent", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const primary = new Promise<void>(resolve => { release = resolve; });
  const jobs = [{ channel: "facebook", placement: "story" }, { channel: "facebook", placement: "classic" }, { channel: "instagram", placement: "classic" }];
  const run = runPublicationJobsInChannelOrder(jobs, job => job.channel, job => job.placement, async job => {
    calls.push(`${job.channel}:${job.placement}`);
    if (job.channel === "facebook" && job.placement === "classic") { await primary; throw new Error("Primary rejected"); }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.includes("instagram:classic"));
  assert.ok(!calls.includes("facebook:story"));
  release(); await run;
  assert.ok(calls.indexOf("facebook:classic") < calls.indexOf("facebook:story"));
});

test("a durable Story dependency survives pending continuations and unlocks after either terminal primary outcome", async () => {
  const rows = new Map<string, RecordValue>();
  const supabaseAdmin = { from() { const filters = new Map<string, unknown>(); const query = {
    select() { return query; }, eq(key: string, value: unknown) { filters.set(key, value); return query; },
    async maybeSingle() { return { data: rows.get(String(filters.get("id"))) || null, error: null }; },
  }; return query; } };
  const ready = callable<Promise<boolean>>("lib/boosterAsyncPublication.ts", "isAsyncPublicationTargetReady", {
    supabaseAdmin, asRecord: record, cleanString: clean, getPublicationTargetPredecessor,
    TERMINAL_CHANNEL_STATUSES: new Set(["completed", "failed"]), BOOSTER_ASYNC_CHANNEL_EVENT_TYPE: "publish_async_channel",
  });
  rows.set("story", { id: "story", payload: { publication_id: "publication", channel: "instagram", placement: "story", targetCount: 2, status: "queued", dependsOnEventId: "primary" } });
  const input = { userId: "account", publicationId: "publication", eventId: "story" };
  for (const status of ["preparing", "queued", "processing"]) {
    rows.set("primary", { payload: { publication_id: "publication", channel: "instagram", status } });
    assert.equal(await ready(input), false, status);
  }
  for (const status of ["completed", "failed"]) {
    rows.set("primary", { payload: { publication_id: "publication", channel: "instagram", status } });
    assert.equal(await ready(input), true, status);
  }
  rows.delete("primary"); assert.equal(await ready(input), false, "Missing prerequisite never silently permits publication");
  rows.set("primary", { payload: { publication_id: "another-publication", channel: "instagram", status: "completed" } });
  assert.equal(await ready(input), false);
  rows.set("story", { payload: { publication_id: "publication", channel: "instagram", placement: "story", targetKey: "instagram:story", targetCount: 2, status: "queued" } });
  rows.set("publication", { payload: { publicationTargets: [
    { key: "instagram:classic", channel: "instagram", placement: "classic" },
    { key: "instagram:story", channel: "instagram", placement: "story" },
  ], channelEventIds: { "instagram:classic": "primary" } } });
  rows.set("primary", { payload: { publication_id: "publication", channel: "instagram", status: "processing" } });
  assert.equal(await ready(input), false, "Legacy queued jobs derive and retain their pending dependency");
  rows.set("primary", { payload: { publication_id: "publication", channel: "instagram", status: "failed" } });
  assert.equal(await ready(input), true);
  rows.delete("primary");
  assert.equal(await ready(input), true, "A missing child declared by the parent is an isolated terminal failure");
  const cron = readFileSync(new URL("../../app/api/cron/booster-publications/route.ts", import.meta.url), "utf8");
  const gate = cron.indexOf("if (!(await isAsyncPublicationTargetReady");
  assert.ok(gate > 0 && gate < cron.indexOf("if (attemptsExhausted)", gate), "The wait must not consume attempts or exhaust a Story");
});

test("the actual cron wait performs no provider dispatch, attempt mutation or premature exhaustion", async () => {
  const mutations: string[] = [];
  const dispatch = callable<Promise<void>>("app/api/cron/booster-publications/route.ts", "dispatchChannelJob", {
    isAsyncPublicationMarkedSubscriptionInactive: async () => false,
    isAsyncPublicationTargetReady: async () => false,
    updateAsyncChannelEvent: async () => { mutations.push("attempt"); },
    fetch: async () => { mutations.push("provider"); },
    MAX_ASYNC_DISPATCH_ATTEMPTS: 3, MAX_INSTAGRAM_VIDEO_CONTINUATION_ATTEMPTS: 480,
    MAX_YOUTUBE_UPLOAD_CONTINUATION_ATTEMPTS: 128, MAX_PINTEREST_VIDEO_CONTINUATION_ATTEMPTS: 480,
  });
  await dispatch({ id: "story", userId: "account", publicationId: "parent", channel: "facebook", attempt: 3 }, "https://app.invalid");
  assert.deepEqual(mutations, [], "A waiting Story cannot use up its retries or contact Meta");
});

test("legacy queued Stories derive their primary from the durable parent and Story-only retries have no dependency", async () => {
  const targets = [{ key: "facebook:classic", channel: "facebook", placement: "classic" }, { key: "facebook:story", channel: "facebook", placement: "story" }];
  assert.equal(getPublicationTargetPredecessor(targets[1], targets, { "facebook:classic": "primary-id" }), "primary-id");
  assert.equal(getPublicationTargetPredecessor(targets[0], targets, {}), null);
  assert.equal(getPublicationTargetPredecessor(targets[1], [targets[1]], {}), null);
});

test("the real per-placement post resolver retains primary CTA and strips it only from both Story jobs", () => {
  const load = runtimeModules();
  const { stripMetaStoryOnlyPostContent } = load<typeof import("../../lib/metaPublicationTargets.ts")>("lib/metaPublicationTargets.ts");
  const post = { title: "Principal", content: "Texte", ctaMode: "call", cta: "Appeler", ctaPhone: "0102030405", hashtags: ["test"] };
  const resolver = callable("app/api/booster/publish-now/route.ts", "getChannelPostForPlacement", {
    stripMetaStoryOnlyPostContent, resolveChannelPost: () => post, getChannelPost: () => post,
    imagesByChannel: {}, images: [], mediaModeByChannel: { facebook: "video", instagram: "video" },
    getPrimaryImageInteractionLink: () => null, applyImageInteractionCtaFallback: (_channel: unknown, value: unknown) => value,
  });
  for (const channel of ["facebook", "instagram"]) {
    const primary = resolver(channel, "classic"); const story = resolver(channel, "story");
    assert.equal(primary.ctaMode, "call"); assert.equal(primary.content, "Texte");
    assert.equal(story.ctaMode, "none"); assert.equal(story.content, ""); assert.deepEqual(story.hashtags, []);
  }
  assert.equal(post.ctaMode, "call", "Preparing the additional Story does not mutate the original");
});

test("target failures persist through durable ingress without blocking the other format", () => {
  const labels = { facebook: "Facebook", instagram: "Instagram", threads: "Threads" };
  const normalize = callable("lib/boosterPublicationIngress.ts", "normalizeClientPreflightFailuresByTarget", { asRecord: record });
  const failures = normalize({ "facebook:story": { code: "facebook_story_video_duration_out_of_range", error: "69,58 s" }, "threads:story": { error: "unsupported" } }, ["facebook", "threads"]);
  assert.deepEqual(Object.keys(failures), ["facebook:story"]);
  const summary = callable<{ entries: RecordValue[]; failureCount: number; pendingCount: number }>("lib/boosterPublicationIngress.ts", "queuedSummary", { BOOSTER_PUBLICATION_CHANNEL_LABELS: labels })(["facebook"], {},
    [{ key: "facebook:classic", channel: "facebook", placement: "classic" }, { key: "facebook:story", channel: "facebook", placement: "story" }], failures);
  assert.equal(summary.entries[0].ok, null); assert.equal(summary.entries[1].ok, false);
  assert.equal(summary.failureCount, 1); assert.equal(summary.pendingCount, 1);
  const input = callable("lib/boosterPublicationIngress.ts", "buildDurablePreparationInput", { asRecord: record, stripMetaStoryOnlyPostContent: (post: unknown) => post });
  const targets = [{ channel: "facebook", placement: "story" }];
  assert.deepEqual(input({ publicationTargets: targets, clientPreflightFailuresByTarget: failures }).publicationTargets, targets);
  assert.deepEqual(input({ publicationTargets: targets, clientPreflightFailuresByTarget: failures }).clientPreflightFailuresByTarget, failures);
});

test("the actual queued response counts each Meta format and never calls pending work successful", () => {
  const queued = callable<{ total: number; successCount: number; failureCount: number; pendingCount: number; entries: RecordValue[] }>(
    "app/api/booster/publish-now/publishNow.foundations.ts", "buildQueuedPublicationSummary",
    { asRecord: record, CHANNEL_LABELS: { facebook: "Facebook", instagram: "Instagram", threads: "Threads" } },
  );
  const targets = buildBoosterPublicationTargets({ channels: ["facebook", "instagram"],
    facebookPublicationSettings: { primaryPlacement: "classic", includeStory: true },
    instagramPublicationSettings: { primaryPlacement: "reel", includeStory: true } });
  const pending = queued(["facebook", "instagram"], targets);
  assert.equal(pending.total, 4);
  assert.equal(pending.pendingCount, 4);
  assert.equal(pending.successCount, 0);
  assert.deepEqual(pending.entries.map(entry => entry.targetKey), ["facebook:classic", "facebook:story", "instagram:reel", "instagram:story"]);
  const partial = queued(["facebook", "instagram"], targets, {
    "facebook:story": { ok: false, status: "failed", code: "story_invalid", error: "Durée trop longue", retryable: false },
    "instagram:reel": { ok: true, status: "processing" },
  });
  assert.equal(partial.total, 4);
  assert.equal(partial.failureCount, 1);
  assert.equal(partial.pendingCount, 3);
  assert.equal(partial.successCount, 0);
  assert.equal(partial.entries[0].ok, null, "An invalid Story cannot fail its queued primary");
  assert.equal(partial.entries[1].code, "story_invalid");
  const route = readFileSync(new URL("../../app/api/booster/publish-now/route.ts", import.meta.url), "utf8");
  assert.match(route, /const queuedSummary = buildQueuedPublicationSummary\(selected, publicationTargets,/);
});

test("queued Story-only retries count one requested block, while Threads stays one exclusive mode", () => {
  const queued = callable<{ total: number; successCount: number; pendingCount: number; entries: RecordValue[] }>(
    "app/api/booster/publish-now/publishNow.foundations.ts", "buildQueuedPublicationSummary",
    { asRecord: record, CHANNEL_LABELS: { facebook: "Facebook", threads: "Threads" } },
  );
  const targets = buildBoosterPublicationTargets({ channels: ["facebook"], facebookPublicationSettings: { placement: "story" } });
  const story = queued(["facebook"], targets);
  assert.equal(story.total, 1); assert.equal(story.pendingCount, 1); assert.equal(story.successCount, 0);
  assert.equal(story.entries[0].targetKey, "facebook:story");
  assert.equal(story.entries[0].placement, "story");
  const exclusive = queued(["threads"], [{ key: "threads", channel: "threads", placement: null }], { threads: { threads_publication_mode: "ghost" } });
  assert.equal(exclusive.total, 1); assert.equal(exclusive.entries[0].threads_publication_mode, "ghost");
  const duplicate = queued(["facebook"], [...targets, ...targets]);
  assert.equal(duplicate.total, 1, "A duplicate target cannot inflate requested work");
});

test("prepared adaptation uses the output FPS proof rather than the source's incompatible FPS", () => {
  const load = runtimeModules();
  const { createPublishNowVideoContext } = load<typeof import("../../app/api/booster/publish-now/publishNow.channel-context.ts")>("app/api/booster/publish-now/publishNow.channel-context.ts");
  const { getMetaPreparedVideoFailure } = load<typeof import("../../lib/metaPlacementPreparedVideo.ts")>("lib/metaPlacementPreparedVideo.ts");
  const variant = { channel: "facebook", format: "9_16", adaptationMode: "safe_frame", publicUrl: "https://example.invalid/output.mp4", storagePath: "account/output.mp4", contentType: "video/mp4", size: 8_000_000, duration: 59, width: 720, height: 1280, frameRate: 30 };
  const original = { name: "video.mp4", type: "video/mp4", size: 8_458_075, duration: 59, url: "https://example.invalid/original.mp4", publicUrl: "https://example.invalid/original.mp4", storagePath: "account/original.mp4", thumbnailUrl: null, thumbnailStoragePath: null, thumbnailBucket: null, sourceMetadata: { width: 464, height: 832, frameRate: 23.44, fps: 23.44 }, transformedVariants: [variant] };
  const params = { publicationVideo: original, videoSettingsByChannel: { facebook: { format: "9_16", adaptationMode: "safe_frame" } }, selected: ["facebook"], mediaModeByChannel: { facebook: "video" } };
  const output = createPublishNowVideoContext(params as unknown as Parameters<typeof createPublishNowVideoContext>[0]).getPublicationVideoForChannel("facebook");
  assert.equal(output?.sourceMetadata?.frameRate, 30); assert.equal(output?.sourceMetadata?.fps, 30);
  assert.equal(getMetaPreparedVideoFailure("facebook", "story", output), null);
  assert.equal(getMetaPreparedVideoFailure("facebook", "story", original)?.ok, false);
  const unknownOutput = createPublishNowVideoContext({ ...params, publicationVideo: { ...original, transformedVariants: [{ ...variant, frameRate: undefined }] } } as unknown as Parameters<typeof createPublishNowVideoContext>[0]).getPublicationVideoForChannel("facebook");
  assert.equal(unknownOutput?.sourceMetadata?.frameRate, null, "Legacy derivative metadata must not inherit the source FPS");
});
