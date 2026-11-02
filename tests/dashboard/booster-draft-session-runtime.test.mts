import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { LoadPublicationDraftContext, SavePublicationDraftContext } from "../../app/dashboard/booster/publier/publicationDraftContext.ts";

type DraftSession = typeof import("../../app/dashboard/booster/publier/publicationDraftSession.ts");
type Json = Record<string, unknown>;
const source = readFileSync("app/dashboard/booster/publier/publicationDraftSession.ts", "utf8");
function fixture() {
  const writes: Record<string, unknown[]> = {};
  const requests: { url: string; body: Json | null }[] = [];
  const order: string[] = [];
  let payload: Json = {};
  let responseOk = true;
  let restoreImages = async (drafts: unknown[]) => { assert.ok(Array.isArray(drafts)); return { restoredFiles: [], restoredPreviews: [], restoredMeta: {}, restoredClientMediaKeysByImageKey: {}, restoredImageKeyRemap: {} }; };
  const values: Json = {
    saving: false, draftSaving: false, voiceInputBusy: false, hasDraftablePublicationContent: true,
    selectedChannels: ["facebook"], CHANNEL_KEYS: ["facebook", "instagram"], channels: { facebook: true, instagram: false },
    idea: "  Draft idea  ", publicationInstruction: "  Instruction  ", theme: "", contentStyle: "equilibre", creationMode: "manual",
    images: [], videoFile: null, imageMetaByKey: {}, pdfFile: null, selectedAiPreferredEngine: "google", defaultAiPreferredEngine: "openai",
    loadedPublicationDraftId: null, publicationDraftIdParam: "draft-original", mediaPipelineCutoverEnabled: true,
    mediaWorkspaceId: "workspace-a", mediaWorkspaceClientKey: "client-a", legacyMediaCutoverClientAvailable: false,
    currentPublicationDraftSnapshot: "snapshot-current", lastSavedStudioVideoDraftRef: { current: null },
    soundtrackByChannel: { facebook: "sound-a" }, threadsPublicationMode: "text", channelMediaModes: {},
    videoFormatByChannel: {}, videoAdaptationModeByChannel: {}, videoSettingsByChannel: {},
    metaPilotEnabled: true, ctaDefaults: null,
    instagramPublicationPreferencesRef: { current: { reelsEnabled: true, storiesEnabled: true } },
    facebookPublicationPreferencesRef: { current: { reelsEnabled: true, storiesEnabled: true } },
    manuallyEditedCtaChannelsRef: { current: new Set() }, aiEngineRestoredFromDraftRef: { current: false },
    draftChannelsRestoredRef: { current: false }, threadsModeTouchedRef: { current: false },
    instagramPlacementTouchedRef: { current: false }, facebookPlacementTouchedRef: { current: false },
    i18nT: (key: string) => key,
    scrollToPublishArea: () => order.push("scroll"),
    buildPreparedPostsByChannel: () => ({ facebook: { title: "Title", content: "Content" } }),
    filterPostsForSelectedChannels: (posts: unknown) => posts,
    uploadPublicationDraftImages: async () => { order.push("upload-images"); return []; },
    buildPublicationDraftVideoPayload: async () => { order.push("upload-video"); return null; },
    getDraftImageSettingsByChannel: () => ({}),
    linkPersistentWorkspaceDraft: async (id: string) => { order.push(`link:${id}`); },
    router: { replace: (url: string) => order.push(`route:${url}`) },
    onUnsavedChange: (dirty: boolean) => order.push(`dirty:${dirty}`),
    adoptMediaWorkspace: (id: string) => order.push(`adopt:${id}`),
    restorePublicationDraftImages: (drafts: unknown[]) => restoreImages(drafts),
    buildVideoPreparationStateFromVariants: () => ({}),
  };
  const context = new Proxy(values, { get(target, key: string) {
    if (key in target) return target[key];
    if (key.startsWith("set")) return (value: unknown) => { (writes[key] ||= []).push(value); };
    return undefined;
  } });
  const shared = {
    CHANNEL_LABELS: { facebook: "Facebook" }, normalizePost: (post: Json) => ({ title: "", content: "", ...post }),
    normalizePublicationMediaType: (value: string) => value || "images", normalizeVideoFormat: (_channel: string, value: string) => value,
    normalizeVideoAdaptationMode: (value: string) => value, buildVideoSettingsByChannel: () => ({}),
  };
  const modules: Record<string, Json> = {
    "./components/publishWizard": { getRestoredPublishWizardStep: () => "content" },
    "@/lib/metaChannelUiAccess": { filterMetaPilotPayload: (value: unknown) => value },
    "@/lib/siteWebChannel": { normalizeSiteWebPublicationPayload: (value: unknown) => value },
    "@/lib/mediaSoundtrackSelection": { normalizeMediaSoundtrackByChannel: (value: unknown) => value || {} },
    "@/lib/userFacingErrors": { getClientUserFacingErrorMessage: (error: Error) => error.message },
    "@/lib/aiEnginePreference": { normalizeAiPreferredEngine: (value: string) => value },
    "@/lib/videoAiContextReference": { normalizeVideoAiContextReference: (value: unknown) => value || null, videoAiContextReferenceAliases: () => ({}) },
    "./publishModal.shared": shared,
    "./publishModal.foundations": { isChannelKey: (value: string) => ["facebook", "instagram"].includes(value), isThemeKey: () => false, isStyleKey: () => false, sanitizePostsForEditor: (value: unknown) => value },
    "./publishModal.videoAiRuntime": { readVideoSourceMetadata: async () => ({}) },
    "@/lib/boosterCreationMode": { inferBoosterCreationMode: (value: Json) => value.explicitMode || "ai" },
    "@/lib/threadsPublicationPreferences": { normalizeThreadsPublicationMode: (value: string) => value || "text" },
    "@/lib/metaPublicationTargets": { normalizeMetaPublicationSelection: (value: Json) => ({ primaryPlacement: value.placement || "classic", includeStory: !!value.includeStory }) },
    "@/lib/mediaWorkspaceClient": { loadMediaPublicationWorkspace: async () => { order.push("load-workspace"); return { media: [] }; } },
    "./usePublishVideoController": { normalizeRestoredVideoVariants: (value: unknown) => value || [] },
    "./publishImageRecovery": { remapRestoredChannelImageEditors: (value: unknown) => value },
  };
  const fetchMock = async (url: string, options: RequestInit = {}) => {
    requests.push({ url, body: options.body ? JSON.parse(String(options.body)) : null });
    order.push(options.method === "POST" ? "save" : "load");
    return { ok: responseOk, json: async () => responseOk ? { id: "draft-saved", payload } : { error: "Draft rejected" } };
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported: Json = {};
  new Function("exports", "require", "fetch", compiled)(exported, (name: string) => { assert.ok(modules[name], `Unexpected dependency ${name}`); return modules[name]; }, fetchMock);
  return { api: exported as unknown as DraftSession, context, writes, requests, order, setPayload: (value: Json) => { payload = value; }, setFailure: () => { responseOk = false; }, setImageRestore: (fn: typeof restoreImages) => { restoreImages = fn; } };
}

test("draft save reuses the workspace, links the returned ID and preserves Studio route control", async () => {
  const f = fixture();
  f.context.images = [{ name: "image.jpg", type: "image/jpeg", size: 42 }];
  f.context.pdfFile = { name: "local-context.pdf" };
  const id = await f.api.savePublicationDraft(f.context as unknown as SavePublicationDraftContext, { updateRoute: false });
  assert.equal(id, "draft-saved");
  assert.equal(f.requests.length, 1);
  const body = f.requests[0].body!;
  const payload = body.payload as Json;
  assert.equal(body.draftId, "draft-original");
  assert.equal(payload.idea, "Draft idea");
  assert.equal(payload.publicationInstruction, "Instruction");
  assert.equal(payload.creationMode, "manual");
  assert.equal(payload.aiPreferredEngine, "google");
  assert.equal(payload.mediaWorkspaceId, "workspace-a");
  assert.deepEqual(payload.imageDrafts, []);
  assert.equal(payload.videoDraft, null);
  assert.deepEqual(payload.soundtrackByChannel, { facebook: "sound-a" });
  assert.ok(!JSON.stringify(body).includes("local-context.pdf"));
  assert.deepEqual(f.order, ["save", "link:draft-saved", "dirty:true"]);
  assert.deepEqual(f.writes.setDraftSaving, [true, false]);
  assert.deepEqual(f.writes.setLoadedPublicationDraftId, ["draft-saved"]);
  assert.deepEqual(f.writes.setLastPublicationDraftSnapshot, ["snapshot-current"]);
});

test("draft save rejection clears its busy state without marking the snapshot saved", async () => {
  const f = fixture(); f.setFailure();
  assert.equal(await f.api.savePublicationDraft(f.context as unknown as SavePublicationDraftContext), null);
  assert.deepEqual(f.writes.setDraftSaving, [true, false]);
  assert.deepEqual(f.writes.setPublishError, ["", "Draft rejected"]);
  assert.equal(f.writes.setLoadedPublicationDraftId, undefined);
  assert.equal(f.writes.setLastPublicationDraftSnapshot, undefined);
});

test("draft restore commits the saved text and engine after media restoration and rebuilds its clean snapshot", async () => {
  const f = fixture();
  f.setPayload({ idea: "Saved idea", publicationInstruction: "Saved instruction", creationMode: "manual", aiPreferredEngine: "google", channels: ["facebook"], postByChannel: { facebook: { title: "Saved title", content: "Saved content", ctaMode: "none" } }, mediaWorkspaceId: "workspace-a", contentWorkspaceOpen: true });
  f.setImageRestore(async () => { assert.equal(f.writes.setIdea, undefined); f.order.push("restore-images"); return { restoredFiles: [], restoredPreviews: [], restoredMeta: {}, restoredClientMediaKeysByImageKey: {}, restoredImageKeyRemap: {} }; });
  await f.api.loadPublicationDraft(f.context as unknown as LoadPublicationDraftContext, () => false);
  assert.deepEqual(f.writes.setPublishError, [""]);
  assert.deepEqual(f.writes.setIdea, ["Saved idea"]);
  assert.deepEqual(f.writes.setPublicationInstruction, ["Saved instruction"]);
  assert.deepEqual(f.writes.setSelectedAiPreferredEngine, ["google"]);
  assert.deepEqual(f.writes.setDocumentFiles, [[]]);
  assert.deepEqual(f.writes.setLoadedPublicationDraftId, ["draft-original"]);
  const snapshot = JSON.parse(String(f.writes.setLastPublicationDraftSnapshot[0]));
  assert.equal(snapshot.idea, "Saved idea"); assert.equal(snapshot.creationMode, "manual");
  assert.deepEqual(f.order, ["load", "adopt:workspace-a", "restore-images", "dirty:false"]);
  assert.equal((f.context.manuallyEditedCtaChannelsRef as { current: Set<string> }).current.has("facebook"), true);
});

test("a cancelled draft restore discards editor mutations after the media await", async () => {
  const f = fixture(); let cancelled = false;
  f.setPayload({ idea: "Late draft", channels: ["facebook"] });
  f.setImageRestore(async () => { cancelled = true; return { restoredFiles: [], restoredPreviews: [], restoredMeta: {}, restoredClientMediaKeysByImageKey: {}, restoredImageKeyRemap: {} }; });
  await f.api.loadPublicationDraft(f.context as unknown as LoadPublicationDraftContext, () => cancelled);
  assert.equal(f.writes.setIdea, undefined);
  assert.equal(f.writes.setLoadedPublicationDraftId, undefined);
  assert.equal(f.writes.setLastPublicationDraftSnapshot, undefined);
  assert.ok(!f.order.includes("dirty:false"));
});
