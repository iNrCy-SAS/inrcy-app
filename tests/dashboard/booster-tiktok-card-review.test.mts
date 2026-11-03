import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile(
  "PublishModal.tsx",
  readFileSync("app/dashboard/booster/publier/PublishModal.tsx", "utf8"),
  ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX,
);

// Execute the real client callbacks with in-memory effects; no provider or database calls.
function evaluate(name: string, scope: Record<string, unknown>) {
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, `Missing client callback: ${name}`);
  const code = ts.transpileModule(`const value = (${expression.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(scope), `${code}\nreturn value;`)(...Object.values(scope));
}

const settings = { privacyLevel: "SELF_ONLY", commercialContent: "self", musicUsageConfirmed: true };
const post = { title: "A local draft", content: "Its content", hashtags: ["demo"] };
const signatureScope = {
  getChannelDetailInfo: () => ({ mobileLabel: "@demo" }), connected: { tiktok: true },
  buildPreparedPostsByChannel: () => ({ tiktok: post }),
  resolveChannelMediaMode: () => "images", getPublishImageKeysForChannel: () => ["image-a"],
  channelImageEditors: { tiktok: { transforms: { "image-a": { scale: 1 } } } },
  videoFile: null, videoPreviewUrl: "", videoSettingsByChannel: { tiktok: { format: "vertical" } },
};

test("TikTok card approval belongs to the exact account, text, selection and media settings", () => {
  const signature = evaluate("tiktokCurrentSignature", signatureScope);
  assert.equal(evaluate("tiktokCurrentSignature", { ...signatureScope }), signature);
  const changed = [
    { getChannelDetailInfo: () => ({ mobileLabel: "@another" }) },
    { connected: { tiktok: false } },
    { buildPreparedPostsByChannel: () => ({ tiktok: { ...post, content: "Edited" } }) },
    { getPublishImageKeysForChannel: () => ["image-b"] },
    { channelImageEditors: { tiktok: { transforms: { "image-a": { scale: 2 } } } } },
    { resolveChannelMediaMode: () => "video" },
    { videoFile: { name: "new.mp4", size: 120, lastModified: 10 }, videoPreviewUrl: "blob:new" },
    { videoSettingsByChannel: { tiktok: { format: "square" } } },
  ];
  for (const change of changed) assert.notEqual(evaluate("tiktokCurrentSignature", { ...signatureScope, ...change }), signature);
  assert.equal(evaluate("tiktokCurrentSignature", {
    ...signatureScope, buildPreparedPostsByChannel: () => ({ tiktok: post, facebook: { content: "Other channel edited" } }),
  }), signature, "editing Facebook must not invalidate TikTok approval");
  assert.equal(evaluate("tiktokReviewCurrent", { tiktokPublicationSettings: settings, tiktokReviewSignature: signature, tiktokCurrentSignature: signature }), true);
  assert.equal(evaluate("tiktokReviewCurrent", { tiktokPublicationSettings: settings, tiktokReviewSignature: signature, tiktokCurrentSignature: "edited" }), false);
  assert.equal(evaluate("tiktokReviewCurrent", { tiktokPublicationSettings: null, tiktokReviewSignature: signature, tiktokCurrentSignature: signature }), false);
});

function effects(reviewed: boolean, channel = "tiktok", blockers: string[] = []) {
  const calls: Array<[string, unknown]> = [];
  const record = (name: string) => (value?: unknown) => calls.push([name, value]);
  const scope: Record<string, unknown> = {
    tiktokReviewCurrent: reviewed, tiktokPublicationSettings: settings, tiktokCurrentSignature: "draft-version",
    tiktokSettingsFlow: "review", pendingScheduleRequest: null,
    saving: false, draftSaving: false, scheduleSaving: false, voiceInputBusy: false,
    selectedChannels: [channel], getImagePreparationIssue: () => "", i18nT: (key: string) => key,
    finalReviewPosts: null, scheduleReviewPosts: null,
    buildPreparedPostsByChannel: () => ({ [channel]: post }),
    buildFinalReviewItems: () => [{ channel, blockers }],
    runPublish: record("publish"), performSchedulePublication: record("schedule"),
    closeEmptyContentWarnings: record("closeEmptyWarnings"), scrollToPublishArea: record("scroll"),
  };
  for (const name of ["setPublishError", "setDraftMessage", "setImgError", "setPublishProgress", "setPublishProgressLabel", "setPostsByChannel", "setPendingPublishPosts", "setFinalReviewPosts", "setTiktokPublicationSettings", "setTiktokReviewSignature", "setTiktokSettingsFlow", "setTiktokSettingsOpen", "setFinalReviewOpen", "setScheduleModalOpen", "setPendingScheduleRequest", "setPendingImmediatePublishAfterSchedule", "publishImmediateChannelsAfterSchedule", "onClose"]) scope[name] = record(name);
  return { calls, scope, called: (name: string) => calls.filter(([key]) => key === name) };
}

test("validating the TikTok card records approval without publishing or opening another confirmation", async () => {
  const h = effects(false);
  await evaluate("validateTiktokSettingsModal", h.scope)(settings);
  assert.deepEqual(h.called("setTiktokPublicationSettings"), [["setTiktokPublicationSettings", settings]]);
  assert.deepEqual(h.called("setTiktokReviewSignature"), [["setTiktokReviewSignature", "draft-version"]]);
  assert.equal(h.called("publish").length + h.called("schedule").length + h.called("setFinalReviewOpen").length, 0);
});

test("publish reuses a current card review but stale approval must reopen TikTok settings", async () => {
  for (const reviewed of [false, true]) {
    const h = effects(reviewed);
    await evaluate("onPublish", h.scope)();
    assert.equal(h.called("setTiktokSettingsOpen").length, reviewed ? 0 : 1);
    assert.equal(h.called("setFinalReviewOpen").length, reviewed ? 1 : 0);
    assert.equal(h.called("publish").length, 0, "the first click remains a review, never dispatch");
    await evaluate("confirmFinalReview", h.scope)();
    assert.equal(h.called("publish").length, reviewed ? 1 : 0);
    if (reviewed) assert.equal((h.called("publish")[0][1] as { tiktokPublicationSettings: unknown }).tiktokPublicationSettings, settings);
  }
  const blocked = effects(true, "tiktok", ["media_required"]);
  await evaluate("confirmFinalReview", blocked.scope)();
  assert.equal(blocked.called("publish").length, 0, "approval must never bypass media requirements");
});

test("scheduling also rechecks stale approval and preserves a current selection", async () => {
  const selections = [{ channel: "tiktok", scheduledAt: "2026-11-01T15:00:00Z" }];
  const stale = effects(false);
  await assert.rejects(evaluate("confirmSchedulePublication", stale.scope)(selections));
  assert.equal(stale.called("setTiktokSettingsOpen").length, 1);
  assert.equal(stale.called("schedule").length, 0);
  const current = effects(true);
  await evaluate("confirmSchedulePublication", current.scope)(selections);
  assert.equal(current.called("schedule").length, 1);
  assert.equal(current.called("setTiktokSettingsOpen").length, 0);
});

test("closing final confirmation retains only a still-current TikTok card review", () => {
  for (const reviewed of [false, true]) {
    const h = effects(reviewed);
    evaluate("closeFinalReview", h.scope)();
    assert.equal(h.called("setTiktokPublicationSettings").length, reviewed ? 0 : 1);
  }
});

test("a media readiness rejection after TikTok approval keeps scheduling open without an unhandled promise or immediate publication", async () => {
  const h = effects(true);
  const request = { selections: [{ channel: "tiktok", scheduledAt: "2099-04-05T10:00:00.000Z" }], preparedPostsByChannel: { tiktok: post }, immediateChannels: ["facebook"] };
  Object.assign(h.scope, {
    tiktokSettingsFlow: "schedule", pendingScheduleRequest: request,
    performSchedulePublication: async (...args: unknown[]) => {
      h.calls.push(["schedule", args]);
      throw new Error("Les médias sont encore en cours de préparation.");
    },
  });
  await assert.doesNotReject(evaluate("validateTiktokSettingsModal", h.scope)(settings));
  assert.deepEqual(h.called("schedule"), [["schedule", [request.selections, request.preparedPostsByChannel, settings, request.immediateChannels]]]);
  assert.deepEqual(h.called("setScheduleModalOpen"), [["setScheduleModalOpen", true]], "the schedule error remains visible instead of closing the workspace");
  assert.deepEqual(h.called("setPendingScheduleRequest"), [], "the selected dates remain available when the schedule form reopens");
  for (const action of ["onClose", "publishImmediateChannelsAfterSchedule", "setPendingImmediatePublishAfterSchedule", "setPostsByChannel"]) assert.equal(h.called(action).length, 0, action);
});

test("a controlled scheduling refusal after TikTok approval cannot be mistaken for a successful schedule", async () => {
  const h = effects(true);
  Object.assign(h.scope, {
    tiktokSettingsFlow: "schedule",
    pendingScheduleRequest: { selections: [{ channel: "tiktok", scheduledAt: "2099-04-05T10:00:00.000Z" }], preparedPostsByChannel: { tiktok: post }, immediateChannels: [] },
    performSchedulePublication: async () => undefined,
  });
  await evaluate("validateTiktokSettingsModal", h.scope)(settings);
  assert.deepEqual(h.called("setScheduleModalOpen"), [["setScheduleModalOpen", true]]);
  assert.equal(h.called("onClose").length, 0);
  assert.equal(h.called("publishImmediateChannelsAfterSchedule").length, 0);
});

test("the standard scheduling form receives a rejection for a controlled refusal", async () => {
  const h = effects(true);
  h.scope.performSchedulePublication = async () => undefined;
  await assert.rejects(evaluate("confirmSchedulePublication", h.scope)([{ channel: "tiktok", scheduledAt: "2099-04-05T10:00:00.000Z" }]));
  assert.equal(h.called("onClose").length, 0);
});

test("only durable scheduling may defer pending image preparation; missing and failed images still block", () => {
  const base = {
    mediaPipelineCutoverEnabled: true, persistentMediaWorkspaceEnabled: true, unifiedMediaConsumptionClientAvailable: true,
    resolveChannelMediaMode: () => "images", channelImageEditors: { facebook: { imageKeys: ["image-a"] } },
    imagePreparationItems: [{ imageKey: "image-a", status: "pending" }], persistentMediaSynchronizing: false, imagePreparationError: "",
  };
  const check = (change = {}) => evaluate("getImagePreparationIssue", { ...base, ...change });
  assert.notEqual(check()(["facebook"]), "", "immediate publication still waits for preparation");
  assert.equal(check()(["facebook"], "schedule"), "");
  assert.equal(check({ persistentMediaSynchronizing: true })(["facebook"], "schedule"), "", "submission itself must finish and verify the upload");
  assert.notEqual(check({ persistentMediaWorkspaceEnabled: false })(["facebook"], "schedule"), "");
  assert.notEqual(check({ unifiedMediaConsumptionClientAvailable: false })(["facebook"], "schedule"), "");
  assert.notEqual(check({ imagePreparationItems: [] })(["facebook"], "schedule"), "");
  assert.notEqual(check({ imagePreparationItems: [{ imageKey: "image-a", status: "failed" }] })(["facebook"], "schedule"), "");
});

test("successful scheduling after TikTok approval closes normally or publishes only the explicit immediate selection", async () => {
  for (const immediate of [null, { immediateChannels: ["facebook"], preparedPostsByChannel: { facebook: post }, tiktokSettingsForSchedule: settings }]) {
    const h = effects(true);
    Object.assign(h.scope, {
      tiktokSettingsFlow: "schedule",
      pendingScheduleRequest: { selections: [{ channel: "tiktok", scheduledAt: "2099-04-05T10:00:00.000Z" }], preparedPostsByChannel: { tiktok: post }, immediateChannels: immediate?.immediateChannels || [] },
      performSchedulePublication: async () => immediate,
    });
    await evaluate("validateTiktokSettingsModal", h.scope)(settings);
    assert.deepEqual(h.called("setScheduleModalOpen"), [["setScheduleModalOpen", true], ["setScheduleModalOpen", false]]);
    assert.equal(h.called("onClose").length, immediate ? 0 : 1);
    assert.deepEqual(h.called("publishImmediateChannelsAfterSchedule"), immediate ? [["publishImmediateChannelsAfterSchedule", immediate]] : []);
  }
});
