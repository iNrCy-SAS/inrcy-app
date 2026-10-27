import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { classifyBoosterPublicationResult } from "../../lib/boosterPublicationOutcome.ts";
import { isBoosterPublishFailureRetryable } from "../../lib/boosterPublicationPolicy.ts";
import { selectAiMediaSoundtrack } from "../../lib/aiMediaSoundtrackCatalog.ts";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const routePath = "app/api/booster/publish-now/route.ts";
const ref = "11111111-1111-4111-8111-111111111111";
const labels = { facebook: "Facebook", instagram: "Instagram" };
const obj = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
function execute<T>(source: string, context: Record<string, unknown>): T {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), code)(...Object.values(context)) as T;
}
function callable<T>(file: string, name: string, context: Record<string, unknown>): T {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true); let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }
  visit(source); assert.ok(found, `Production function ${name} must exist`);
  return execute(`return (${found.getText(source).replace(/^export\s+/, "")});`, context);
}

test("a Story resume validates UUID/channel and forces Story-only before ingress without repeating a delivered Reel", () => {
  const source = read(routePath); const start = source.indexOf("const storyResumeByChannel ="); const end = source.indexOf("const requestedInstagramPublicationSelection", start);
  assert.ok(start >= 0 && end > start && end < source.indexOf("enqueueBoosterPublication({"));
  const normalizeMediaType = callable<(value: unknown) => string>("app/api/booster/publish-now/publishNow.foundations.ts", "normalizePublicationMediaType", {});
  const run = (body: Record<string, unknown>, selected = ["facebook", "instagram"]) => execute<Record<string, unknown>>(`${source.slice(start, end)}; return body;`, { body, selected, asRecord: obj, normalizePublicationMediaType: normalizeMediaType, NextResponse: { json: (value: unknown) => ({ rejected: value }) } });
  const body = run({ storySequenceResumeByChannel: { facebook: ref }, facebookPublicationSettings: { primaryPlacement: "reel", includeStory: true }, instagramPublicationSettings: { primaryPlacement: "reel", includeStory: false } });
  assert.deepEqual(body.facebookPublicationSettings, { placement: "story" }); assert.deepEqual(body.instagramPublicationSettings, { primaryPlacement: "reel", includeStory: false });
  assert.deepEqual(body.mediaModeByChannel, { facebook: "images" }, "Pin the image branch even if a later workspace fallback reports video");
  for (const value of [{ facebook: "not-a-uuid" }, { linkedin: ref }, { instagram: ref }, []]) assert.ok(run({ storySequenceResumeByChannel: value }, ["facebook"]).rejected);
  const normal = run({ facebookPublicationSettings: { primaryPlacement: "reel", includeStory: true } });
  assert.deepEqual(normal.facebookPublicationSettings, { primaryPlacement: "reel", includeStory: true });
  assert.match(read("lib/boosterPublicationIngress.ts"), /storySequenceResumeByChannel: body\.storySequenceResumeByChannel/);
  assert.match(source, /storySequenceResumeByChannel: \{ \[channel\]: storyResumeByChannel\[channel\] \}/);
  for (const channel of ["facebook", "instagram"]) {
    for (const mode of ["video", "none", "invalid", null]) {
      const invalid = run({ storySequenceResumeByChannel: { [channel]: ref }, mediaType: "images", mediaModeByChannel: { [channel]: mode } });
      assert.equal((invalid.rejected as Record<string, unknown>).code, "meta_story_resume_media_mismatch");
    }
    assert.equal((run({ storySequenceResumeByChannel: { [channel]: ref }, mediaType: "video" }).rejected as Record<string, unknown>).code, "meta_story_resume_media_mismatch");
    const valid = run({ storySequenceResumeByChannel: { [channel]: ref }, mediaType: "video", mediaModeByChannel: { [channel]: "images", youtube_shorts: "video" }, imagesByChannel: { [channel]: [{ storagePath: "original-photo.jpg" }] } });
    assert.deepEqual(valid.mediaModeByChannel, { [channel]: "images", youtube_shorts: "video" });
    assert.deepEqual(valid.imagesByChannel, { [channel]: [{ storagePath: "original-photo.jpg" }] });
  }
});

test("the real Story dispatch stages all five photos then delegates durable video sequencing with worker deadline and token fallback", async () => {
  const calls: Array<{ kind: string; input: Record<string, unknown> }> = [];
  const paths = [0, 1, 2, 3, 4].map(index => `account/${index}.jpg`);
  let expected = 5;
  const signal = new AbortController().signal;
  const run = callable<(...args: unknown[]) => Promise<Record<string, unknown>>>(routePath, "publishImageStorySequence", {
    getChannelImageSet: () => ({ socialFeedStoragePaths: paths, publishableStoragePaths: paths, storagePaths: paths }), getExpectedChannelImageCount: () => expected,
    prepareMetaImageStoryPhotos: async (input: Record<string, unknown>) => { calls.push({ kind: "photos", input }); return paths.map(storagePath => ({ storagePath, url: `https://storage.example/${storagePath}`, sourceIdentity: "fixture" })); },
    publishPersistedMetaStorySequence: async (input: Record<string, unknown>) => { calls.push({ kind: "sequence", input }); return { ok: true, image_count: 5 }; },
    userId: "account", publicationId: "current-parent", requestedOriginSource: "booster", publicationSoundtrackId: "atelier-vivant", storyResumeByChannel: { instagram: ref }, storyWorkerDeadlineAt: 123456, req: { signal }, idea: "Notre atelier", console,
  });
  const candidates = [{ source: "page", accessToken: "private-fixture-token" }];
  assert.equal((await run("instagram", "remote-account", "primary-token", "facebook_login", candidates)).ok, true);
  assert.deepEqual(calls[0].input.imageStoragePaths, paths); assert.equal(calls[1].input.resumeRef, ref); assert.equal(calls[1].input.deadlineAt, 123456); assert.equal(calls[1].input.signal, signal); assert.equal(calls[1].input.tokenCandidates, candidates);
  assert.equal(calls[1].input.soundtrackPrompt, "Notre atelier");
  assert.equal(calls[1].input.soundtrackId, "atelier-vivant");
  expected = 6; calls.length = 0;
  assert.equal((await run("facebook", "page", "token")).ok, false); assert.equal(calls.length, 0, "A missing photo blocks the entire first Story batch");
  const source = read(routePath);
  assert.ok(source.indexOf('publishImageStorySequence("facebook"') < source.indexOf("facebookPublishVideo = await createFacebookImageMotionVideo"));
  assert.ok(source.indexOf('publishImageStorySequence("instagram"') < source.indexOf("instagramPublishVideo = await createInstagramImageMotionVideo"));
});

test("partial Stories retain their confirmed IDs and resumable state beside a delivered Reel through both summary projections", () => {
  const cleanString = (value: unknown) => String(value || "").trim();
  const aggregate = callable<(channel: string, states: unknown[]) => Record<string, unknown>>("lib/boosterAsyncPublication.ts", "aggregateChannelTargetResults", { cleanString, CHANNEL_LABELS: labels, getTargetResultLabel: (state: { placement: string }) => state.placement, classifyBoosterPublicationResult });
  for (const channel of ["facebook", "instagram"]) {
    const result = aggregate(channel, [
      { channel, placement: "reel", targetKey: `${channel}:reel`, status: "completed", result: { ok: true, external_id: "reel-already-published" } },
      { channel, placement: "story", targetKey: `${channel}:story`, status: "failed", result: { ok: false, retryable: true, story_sequence_resume_ref: ref, story_ids: ["story-0", "story-1", "story-2"], published_image_count: 3, expected_image_count: 5, error: "Deux Stories restent à publier" } },
    ]);
    assert.equal(result.ok, false); assert.equal(result.retryable, true); assert.equal(result.story_sequence_resume_ref, ref);
    assert.deepEqual(result.external_ids, ["reel-already-published", "story-0", "story-1", "story-2"]);
    for (const [file, name] of [["lib/boosterAsyncPublication.ts", "buildAsyncPublicationSummary"], ["app/api/booster/publish-now/publishNow.foundations.ts", "buildResultsSummary"]]) {
      const summary = callable<(results: unknown, selected: string[]) => { entries: Array<Record<string, unknown>> }>(file, name, { asRecord: obj, cleanString, CHANNEL_LABELS: labels, classifyBoosterPublicationResult, isBoosterPublishFailureRetryable });
      const entry = summary({ [channel]: result }, [channel]).entries[0];
      assert.equal(entry.story_sequence_resume_ref, ref); assert.equal(entry.retryable, true); assert.equal(entry.published_image_count, 3); assert.equal(entry.expected_image_count, 5);
    }
  }
});

test("the known Facebook-login Creator restriction applies only to Story and never changes account rights", async () => {
  const source = read(routePath); const start = source.indexOf("const knownInstagramAccountType"); const end = source.indexOf("const igExpired", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end).replace("continue;", "return { blocked: true, result: results[ch] };");
  const run = (accountType: string, authMode: string, placement: string) => execute<Promise<{ blocked: boolean }>>(`return (async()=>{${block};return {blocked:false};})();`, { igMeta: { account_type: accountType }, igAuthMode: authMode, instagramPublicationSettings: { placement }, setDelivery: async () => {}, results: {}, ch: "instagram" });
  await Promise.all([run("CREATOR", "facebook_login", "story").then(value => assert.equal(value.blocked, true)), run("CREATOR", "facebook_login", "reel").then(value => assert.equal(value.blocked, false)), run("BUSINESS", "facebook_login", "story").then(value => assert.equal(value.blocked, false)), run("", "facebook_login", "story").then(value => assert.equal(value.blocked, false)), run("CREATOR", "instagram_login", "story").then(value => assert.equal(value.blocked, false))]);
});

test("explicit Auto in a prepared action takes priority over an older nested manual soundtrack", () => {
  const path = "app/api/agent/actions/schedule/route.ts";
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  let selection: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "soundtrackId") selection = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(selection, "Native scheduling must resolve the soundtrack selection");
  const selectionSource = selection.getText(source);
  const choose = (payload: Record<string, unknown>, nestedPublishPayload: Record<string, unknown>) => execute(`return (${selectionSource});`, { payload, nestedPublishPayload, normalizeBoosterSoundtrackId: (value: unknown) => value });
  assert.equal(choose({ soundtrackId: null }, { soundtrackId: "atelier-vivant" }), null);
  assert.equal(choose({}, { soundtrackId: "atelier-vivant" }), "atelier-vivant");
  assert.equal(choose({ soundtrackId: "horizon-clair" }, { soundtrackId: "atelier-vivant" }), "horizon-clair");
});

test("Auto resolves once for the parent publication and every Meta dispatch keeps that same music", () => {
  const source = ts.createSourceFile(routePath, read(routePath), ts.ScriptTarget.Latest, true);
  let initializer: ts.Expression | undefined;
  const payloadSelections: ts.Expression[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "publicationSoundtrackId") initializer = node.initializer;
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "soundtrackId") payloadSelections.push(node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(initializer);
  const selectionSource = initializer.getText(source);
  const calls: Array<{ prompt: string; selectionKey?: string }> = [];
  const choose = (requestedSoundtrackId: string | null) => execute<string>(`return (${selectionSource});`, {
    requestedSoundtrackId, idea: "Notre atelier", userId: "account", publicationId: "same-parent",
    selectAiMediaSoundtrack: (prompt: string, options: { selectionKey?: string }) => { calls.push({ prompt, ...options }); return selectAiMediaSoundtrack(prompt, options); },
  });
  const selected = choose(null);
  assert.deepEqual(calls, [{ prompt: "Notre atelier", selectionKey: "account:same-parent:publication-music" }]);
  assert.equal(choose("horizon-clair"), "horizon-clair");
  assert.equal(calls.length, 1, "A manual choice must not invoke Auto selection");
  assert.equal(payloadSelections.length, 6, "Fanout, both motion factories, Stories and executable snapshots must carry resolved music");
  assert.ok(payloadSelections.every(value => value.getText(source) === "publicationSoundtrackId"));
  const contexts = ["Texte Facebook restaurant", "Texte Instagram sport", "Contenu Story nature", "Reel innovation", "Bilan", "Worker"];
  for (const [index, expression] of payloadSelections.entries()) {
    const payload = execute<{ soundtrackId: string }>(`return {soundtrackId: (${expression.getText(source)})};`, { publicationSoundtrackId: selected, channelPost: { content: contexts[index] } });
    assert.equal(payload.soundtrackId, selected, "Channel-specific contents cannot choose another track");
  }
  assert.match(read(routePath), /_asyncPublicationId: publicationId/);
});
