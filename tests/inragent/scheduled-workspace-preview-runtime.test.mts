import assert from "node:assert/strict";
import test from "node:test";
import { scheduledPublicationPreviewWorkspaceId, withScheduledPublicationWorkspacePreview } from "../../lib/scheduledPublicationWorkspacePreview.ts";
import type { MediaWorkspaceSnapshot } from "../../lib/mediaWorkspaceClient.ts";
import { runtimeModules } from "./runtime-module-loader.mts";

const load = runtimeModules();
const schedule = load<typeof import("../../app/dashboard/agent/_lib/agent.schedule.ts")>("app/dashboard/agent/_lib/agent.schedule.ts");
const preview = load<typeof import("../../app/dashboard/agent/_lib/agent.publish-preview.ts")>("app/dashboard/agent/_lib/agent.publish-preview.ts");
const workspace = (): MediaWorkspaceSnapshot => ({ workspaceId: "snapshot-13", clientWorkspaceKey: "scheduled-publication:schedule-13", status: "scheduled", revision: 5, media: [{
  mediaId: "image-13", mediaType: "image", position: 0, uploadStatus: "uploaded", uploadProgress: 100, processingStatus: "ready", publicationStatus: "ready",
  bucket: "inrcy-pro-media", storagePath: "users/account/source/photo.png", fileName: "photo.png", mimeType: "image/png", sizeBytes: 1851835,
  clientMediaKey: "booster:session:photo.png:1851835:123", publicUrl: "https://fixture.invalid/photo.png", width: 1254, height: 1254,
}] });
const payload = () => ({ kind: "manual_publish_schedule", mediaWorkspaceId: "snapshot-13", sourceMediaWorkspaceId: "editable-source", scheduledMediaSnapshot: true,
  publishPayload: { mediaWorkspaceId: "snapshot-13", channels: ["site_web", "facebook", "instagram"], mediaType: "images", images: [], imagesByChannel: {}, video: null,
    mediaModeByChannel: { site_web: "images", facebook: "images", instagram: "images" },
    imageSettingsByChannel: { facebook: { imageKeys: ["photo.png__1851835__123"], format: "square" } },
    postByChannel: { site_web: { title: "Publication prévue", content: "Texte enregistré" }, facebook: { title: "Publication prévue", content: "Texte enregistré" } } } });
const row = () => ({ id: "schedule-13", automationKey: "publish" as const, actionType: "publication" as const, targetTool: "booster" as const, source: "manual" as const,
  title: "Publication multicanale", summary: "Publication programmée", scheduledAt: "2099-11-13T09:00:00Z", timezone: "Europe/Paris", channels: ["site_web", "facebook", "instagram"],
  payload: payload(), status: "scheduled" as const, attemptCount: 0, lastError: null, executedAt: null, createdAt: "2099-11-12T09:00:00Z", updatedAt: "2099-11-12T09:00:00Z" });

test("workspace-only Booster schedule displays its real image through the production editor mapper", () => {
  const original = row(), before = schedule.scheduledActionToPreparedAction(original)!;
  assert.equal(preview.extractPublishMediaPreview(before, "facebook").count, 0);
  const enriched = withScheduledPublicationWorkspacePreview(original.payload, workspace(), original.channels);
  const action = schedule.scheduledActionToPreparedAction({ ...original, payload: enriched })!;
  for (const channel of ["siteWeb", "facebook", "instagram"] as const) {
    const rendered = preview.extractPublishMediaPreview(action, channel);
    assert.equal(rendered.kind, "image"); assert.equal(rendered.count, 1); assert.equal(rendered.url, "https://fixture.invalid/photo.png");
  }
  assert.equal(action.scheduledFor, original.scheduledAt);
  assert.deepEqual(original.payload.publishPayload.images, []);
  assert.equal(scheduledPublicationPreviewWorkspaceId(original.payload), "snapshot-13", "read the immutable snapshot, never the mutable source workspace");
});

test("text/date saves preserve the durable media payload and never save display-only references", () => {
  const original = row();
  const action = schedule.scheduledActionToPreparedAction({ ...original, payload: withScheduledPublicationWorkspacePreview(original.payload, workspace(), original.channels) })!;
  const edited = schedule.updateScheduledEditPublishText(action, "facebook", { title: "Titre modifié", body: "Texte corrigé", cta: "", ctaMode: "none", ctaUrl: "", ctaPhone: "", hashtags: "" });
  const update = schedule.scheduledEditUpdateFromAction(edited, { scheduledAt: "2099-11-14T09:00:00Z" });
  const saved = update.payload as Record<string, unknown>, publish = saved.publishPayload as Record<string, unknown>;
  assert.deepEqual(publish.images, []); assert.deepEqual(publish.imagesByChannel, {}); assert.equal(publish.video, null);
  assert.equal(publish.mediaWorkspaceId, "snapshot-13"); assert.equal(saved.scheduledMediaPreviewOriginal, undefined);
  assert.equal(JSON.stringify(saved).includes("fixture.invalid/photo.png"), false);
  assert.equal((publish.postByChannel as Record<string, { content: string }>).facebook.content, "Texte corrigé");
});

test("an intentional media edit keeps replacement data while removing the preview marker", () => {
  const hydrated = withScheduledPublicationWorkspacePreview(payload(), workspace(), ["facebook"]);
  const action = schedule.scheduledActionToPreparedAction({ ...row(), payload: hydrated })!;
  const edited = schedule.updateScheduledEditPublishMedia(action, "facebook", { id: "replacement", url: "https://fixture.invalid/new.png", type: "image/png" }, 0, "replace");
  const restored = schedule.scheduledEditUpdateFromAction(edited).payload as Record<string, unknown>;
  assert.equal((restored.imagesByChannel as Record<string, { id: string }[]>).facebook[0].id, "replacement"); assert.equal(restored.scheduledMediaPreviewOriginal, undefined);
});

test("per-channel image selections, empty galleries and text-only choices remain authoritative", () => {
  const p = payload();
  p.publishPayload.mediaModeByChannel.instagram = "none";
  const withEmpty = { ...p, publishPayload: { ...p.publishPayload, imagesByChannel: { facebook: [] } } };
  const action = schedule.scheduledActionToPreparedAction({ ...row(), payload: withScheduledPublicationWorkspacePreview(withEmpty, workspace(), row().channels) })!;
  assert.equal(preview.extractPublishMediaPreview(action, "siteWeb").count, 1);
  assert.equal(preview.extractPublishMediaPreview(action, "facebook").count, 0);
  assert.equal(preview.extractPublishMediaPreview(action, "instagram").count, 0);
});

test("video and image channels get the right media family", () => {
  const w = workspace(); w.media.push({ ...w.media[0], mediaId: "video-13", mediaType: "video", mimeType: "video/mp4", fileName: "clip.mp4", publicUrl: "https://fixture.invalid/clip.mp4", position: 1 });
  const p = payload(); p.publishPayload.mediaModeByChannel.instagram = "video";
  const action = schedule.scheduledActionToPreparedAction({ ...row(), payload: withScheduledPublicationWorkspacePreview(p, w, row().channels) })!;
  assert.equal(preview.extractPublishMediaPreview(action, "facebook").kind, "image");
  assert.equal(preview.extractPublishMediaPreview(action, "instagram").kind, "video");
});

test("wrong workspace or unavailable uploaded files fail explicitly instead of looking like no media", () => {
  assert.throws(() => withScheduledPublicationWorkspacePreview(payload(), { ...workspace(), workspaceId: "other" }, ["facebook"]), /incorrect/);
  const w = workspace(); w.media[0].publicUrl = null;
  assert.throws(() => withScheduledPublicationWorkspacePreview(payload(), w, ["facebook"]), /indisponible/);
  assert.equal(scheduledPublicationPreviewWorkspaceId({ publishPayload: { images: [{ url: "legacy.png" }] } }), "");
});
