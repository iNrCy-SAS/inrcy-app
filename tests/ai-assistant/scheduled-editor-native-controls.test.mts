import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { buildScheduledPublicationEdit } from "../../lib/inrAssistantScheduledPublicationEdit.ts";
import { editableHtmlToSiteText } from "../../lib/boosterFormatting.ts";
import { applyInrAgentPublicationSoundtrack, readInrAgentPublicationSoundtrack } from "../../lib/inrAgentPublicationSoundtrack.ts";
type Options = Parameters<typeof import("../../app/dashboard/_hooks/useInrAssistantScheduledPublicationControls.ts").useInrAssistantScheduledPublicationControls>[0];
type Handler = { invoke: (value: string | null, valid: () => boolean) => void | Promise<void>; matches: (state: unknown, value: string | null) => boolean; allowUnmount?: boolean };
type Registration = { state: Record<string, unknown>; handlers: Record<string, Handler>; enabled: boolean; busy: boolean };
const encode = (field: string, value: unknown) => JSON.stringify({ field, value });

function harness() {
  const scope = { actorUserId: "actor", activeAccountId: "account" }, slots: Array<{ value?: unknown; deps?: unknown[]; cleanup?: () => void }> = [], registrations = new Map<string, Registration>(); let cursor = 0;
  const react = { useRef(value: unknown) { const index = cursor++; return (slots[index] ??= { value: { current: value } }).value; }, useMemo(value: () => unknown, deps: unknown[]) { const index = cursor++, slot = slots[index] ??= {}; if (!slot.deps || deps.some((dep, i) => dep !== slot.deps![i])) { slot.value = value(); slot.deps = deps; } return slot.value; }, useLayoutEffect(effect: () => void | (() => void), deps?: unknown[]) { const index = cursor++, slot = slots[index] ??= {}; if (!deps || !slot.deps || deps.some((dep, i) => dep !== slot.deps![i])) { slot.cleanup?.(); slot.cleanup = effect() || undefined; slot.deps = deps; } } };
  const runtime = runtimeModules({ react, "next/navigation": { usePathname: () => "/dashboard/agent" }, "../_components/DashboardViewerAccessProvider": { useDashboardViewerAccess: () => scope }, "./useInrAssistantLocalInterface": { useInrAssistantLocalInterface: (id: string, state: Record<string, unknown>, handlers: Record<string, Handler>, enabled = true, busy = false) => registrations.set(id, { state, handlers, enabled, busy }) } })<typeof import("../../app/dashboard/_hooks/useInrAssistantScheduledPublicationControls.ts")>("app/dashboard/_hooks/useInrAssistantScheduledPublicationControls.ts");
  const calls: unknown[] = [];
  let options: Options = {
    enabled: true, sessionId: "scheduled-a", sourceVersion: "source-v1", baseline: "baseline", channel: "facebook", channels: ["facebook", "instagram"], busy: false, dirty: false, actionSignature: "original-payload",
    choiceOpen: false, textOpen: true, canEditContent: true, canEditOptions: true, textDraft: { channel: "facebook", title: "Titre", body: "Corps", hashtags: "#Nantes", cta: "En savoir plus", ctaMode: "website", ctaUrl: "https://old.fr", ctaPhone: "", ctaAction: "" }, ctaChoice: "site", ctaMode: "website", ctaChoices: ["site", "devis", "appeler"], websiteUrl: "https://site-enregistre.fr", supportsHashtags: true,
    expectedTextSignature: all => all ? "text-all" : "text-channel", openEditor: () => { calls.push("open-editor"); options = { ...options, choiceOpen: true }; }, closeEditor: () => { options = { ...options, choiceOpen: false, textOpen: false }; }, exitEditor: async valid => { if (valid()) options = { ...options, sessionId: null }; }, openText: () => {},
    changeText: (field, value) => { calls.push([field, value]); options = { ...options, textDraft: { ...options.textDraft, [field]: value } }; }, changeCtaChoice: value => { options = { ...options, ctaChoice: value }; }, chooseWebsite: () => { options = { ...options, textDraft: { ...options.textDraft, ctaUrl: options.websiteUrl } }; }, applyText: async (all, valid) => { if (!valid()) throw Error("stale"); options = { ...options, actionSignature: all ? "text-all" : "text-channel", textOpen: false, dirty: true }; }, changeChannel: value => { options = { ...options, channel: value }; },
    mediaOpen: false, mediaCount: 3, mediaIndex: 0, mediaAvailable: true, mediaGhost: false, libraryOpen: false, studioOpen: false, canGenerate: true, canModify: true, mediaKind: "image", mediaAllAllowed: true, expectedMediaAllSignature: "media-all",
    openMedia: () => { options = { ...options, mediaOpen: true }; }, closeMedia: () => { options = { ...options, mediaOpen: false }; }, setMediaIndex: index => { options = { ...options, mediaIndex: index }; }, setLibraryOpen: open => { options = { ...options, libraryOpen: open }; }, openStudio: async (_mode, valid) => { if (valid()) options = { ...options, studioOpen: true }; }, applyMediaAll: async valid => { if (valid()) options = { ...options, actionSignature: "media-all", dirty: true }; },
    placement: "classic", placements: ["classic", "reel", "story"], storyEnabled: true, hasUsableMedia: true, threadsMode: "classic", threadsModes: ["classic", "ghost"], pinterestBoardId: "native-board", pinterestBoardIds: ["native-board"], changePlacement: async (value, valid) => { if (valid()) options = { ...options, placement: value, dirty: true }; }, changeThreadsMode: async (value, valid) => { if (valid()) options = { ...options, threadsMode: value, dirty: true }; }, changePinterestBoard: async (value, valid) => { if (valid()) options = { ...options, pinterestBoardId: value, dirty: true }; },
  };
  const render = (patch: Partial<Options> = {}) => { options = { ...options, ...patch }; cursor = 0; registrations.clear(); runtime.useInrAssistantScheduledPublicationControls(options); };
  render();
  return { scope, calls, render, options: () => options, registration: (id: string) => { const value = registrations.get(id); assert.ok(value, id); return value; }, dispose: () => slots.forEach(slot => slot.cleanup?.()) };
}

test("the actual scheduled editor hook changes only its mounted local fields and acknowledges the exact committed native payload", async () => {
  const h = harness(), registration = h.registration("scheduled_publication_text_form"), handler = registration.handlers.select, title = encode("title", "Titre actuel");
  await handler.invoke(title, () => true); assert.equal(handler.matches(registration.state, title), false); h.render(); assert.equal(handler.matches(h.registration("scheduled_publication_text_form").state, title), true); assert.equal(h.options().textDraft.ctaUrl, "https://old.fr"); assert.equal(h.options().dirty, false, "draft field editing has not yet applied the local action payload");
  const apply = h.registration("scheduled_publication_text_form").handlers.select; await apply.invoke(encode("apply", "channel"), () => true); assert.equal(apply.matches(registration.state, encode("apply", "channel")), false); h.render(); assert.equal(apply.matches(h.registration("scheduled_publication_text_form").state, encode("apply", "channel")), true); assert.equal(h.options().dirty, true); assert.equal(h.options().sourceVersion, "source-v1");
  for (const patch of [{ enabled: false }, { sessionId: null }, { busy: true }, { canEditContent: false }]) { h.render({ enabled: true, sessionId: "scheduled-a", busy: false, canEditContent: true, ...patch, textOpen: true }); const item = h.registration("scheduled_publication_text_form"); assert.equal(item.enabled && !item.busy, false); await assert.rejects(async () => item.handlers.select.invoke(title, () => true)); }
});

test("the actual scheduled editor hook keeps channel options media navigation and owned selection within the active session", async () => {
  const h = harness(), original = h.registration("scheduled_publication_channel"); original.handlers.next.invoke(null, () => true); h.render(); assert.equal(original.handlers.next.matches(h.registration("scheduled_publication_channel").state, null), true); assert.equal(h.options().channel, "instagram");
  const media = h.registration("scheduled_publication_media"); media.handlers.open.invoke(null, () => true); h.render(); assert.equal(media.handlers.open.matches(h.registration("scheduled_publication_media").state, null), true);
  const library = h.registration("scheduled_publication_library"); library.handlers.open.invoke(null, () => true); h.render(); assert.equal(library.handlers.open.matches(h.registration("scheduled_publication_library").state, null), true); library.handlers.close.invoke(null, () => true); h.render(); assert.equal(h.options().libraryOpen, false);
  await h.registration("scheduled_publication_media").handlers.select.invoke("index:2", () => true); h.render(); assert.equal(h.options().mediaIndex, 2); await assert.rejects(async () => h.registration("scheduled_publication_media").handlers.select.invoke("index:3", () => true));
  const options = h.registration("scheduled_publication_options").handlers.select; await options.invoke(encode("placement", "reel_story"), () => true); h.render(); assert.equal(options.matches(h.registration("scheduled_publication_options").state, encode("placement", "reel_story")), true);
  h.render({ channel: "threads", threadsModes: ["classic"] }); await assert.rejects(async () => h.registration("scheduled_publication_options").handlers.select.invoke(encode("threadsMode", "ghost"), () => true));
  h.render({ channel: "pinterest" }); await assert.rejects(async () => h.registration("scheduled_publication_options").handlers.select.invoke(encode("pinterestBoard", "invented"), () => true));
  h.render({ channel: "facebook", mediaGhost: true }); await assert.rejects(async () => h.registration("scheduled_publication_media").handlers.select.invoke("studio_generate", () => true));
  h.render({ mediaGhost: false }); const all = h.registration("scheduled_publication_media").handlers.select; await all.invoke("apply_to_all", () => true); h.render(); assert.equal(all.matches(h.registration("scheduled_publication_media").state, "apply_to_all"), true);
});

test("the actual scheduled editor choice and close controls distinguish the text dialog from the guarded edit workspace", async () => {
  const h = harness(); h.render({ textOpen: false }); const editor = h.registration("scheduled_publication_editor"); editor.handlers.open.invoke(null, () => true); assert.equal(editor.handlers.open.matches(editor.state, null), false); h.render(); assert.equal(editor.handlers.open.matches(h.registration("scheduled_publication_editor").state, null), true);
  editor.handlers.close.invoke(null, () => true); h.render(); assert.equal(editor.handlers.close.matches(h.registration("scheduled_publication_editor").state, null), true); assert.equal(h.options().sessionId, "scheduled-a", "closing the chooser cannot abandon the workspace");
  await h.registration("scheduled_publication_workspace").handlers.close.invoke(null, () => true); h.render(); assert.equal(h.options().sessionId, null); assert.equal(h.registration("scheduled_publication_workspace").enabled, false);
});

test("the actual scheduled editor hook rejects late Studio openings after account actor channel source or mount replacement", async () => {
  for (const replacement of ["account", "actor", "channel", "sourceVersion", "sessionId", "baseline", "unmount"]) {
    const h = harness(); let release!: () => void, applied = 0;
    h.render({ openStudio: async (_mode, valid) => { await new Promise<void>(resolve => { release = resolve; }); if (valid()) applied++; } });
    const pending = h.registration("scheduled_publication_media").handlers.select.invoke("studio_retouch", () => true);
    if (replacement === "account") h.scope.activeAccountId = "other-account"; else if (replacement === "actor") h.scope.actorUserId = "other-actor";
    if (replacement === "unmount") h.dispose(); else h.render(replacement === "channel" ? { channel: "instagram" } : ["sourceVersion", "sessionId", "baseline"].includes(replacement) ? { [replacement]: "replaced" } : {});
    release(); await pending; assert.equal(applied, 0, replacement);
  }
});

function actualFunction<T>(file: string, name: string, deps: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }; visit(ast); assert.ok(found, name);
  const compiled = ts.transpileModule(`(${found.getText(ast).replace(/^export\s+/, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, ""); return vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps) as T;
}

test("the actual scheduled text save uses the local native updater preserving formatting other channels media date and source keys", async () => {
  const nativeUpdate = actualFunction<(action: Record<string, unknown>, channel: string, draft: Record<string, unknown>) => Record<string, unknown>>("app/dashboard/agent/_lib/agent.schedule.ts", "updateScheduledEditPublishText", { boosterDisplayKeyFromAgentChannel: (channel: string) => channel, jsonClone: (value: unknown) => JSON.parse(JSON.stringify(value)), asRecord: (value: unknown) => value && typeof value === "object" ? value : null, firstSafeString: (...values: unknown[]) => values.find(value => typeof value === "string" && value.trim()) || "", apiChannelToUi: { facebook: "facebook", instagram: "instagram" } });
  const action = { id: "native-source", targetChannels: ["facebook", "instagram"], summary: "Résumé", previewText: "Texte", scheduledFor: "2099-06-05T09:00:00Z", payload: { publicationId: "stable-publication", idempotencyKey: "stable-native-key", postByChannel: { facebook: { content: "Avant", ctaUrl: "https://old.fr" }, instagram: { content: "Autre canal" } }, imagesByChannel: { facebook: ["owned-image"] } } };
  for (const fragment of ["<strong>Offre</strong>", "<em>Offre</em>", "<u>Offre</u>", "Offre 🏠"]) {
    const body = editableHtmlToSiteText(`<div>${fragment}</div>`); let changed: Record<string, unknown> | undefined, closed = false;
    const draft = { channel: "facebook", title: "Titre", body, cta: "Devis", ctaMode: "website", ctaUrl: "https://offre.fr", ctaPhone: "", ctaAction: "", hashtags: "#Nantes" };
    const save = actualFunction<() => Promise<void>>("app/dashboard/agent/AgentClient.tsx", "savePublishText", { selectedPreparedAction: action, publishSaveState: "idle", publishTextDraft: draft, preparedChannels: ["facebook", "instagram"], scheduledEditSession: { action }, updateScheduledEditAction: (update: (value: typeof action) => Record<string, unknown>) => { changed = update(action); }, updateScheduledEditPublishText: nativeUpdate, setPublishEditOpen: (value: boolean) => { closed = !value; }, showNotice: () => {}, i18nT: (value: string) => value, fetch: () => assert.fail("A scheduled local text save cannot PATCH Agent or publish"), agentXPostContainsForbiddenUrl: () => false });
    await save(); assert.equal(closed, true); const saved = changed as typeof action; assert.equal(saved.payload.postByChannel.facebook.content, body); assert.deepEqual(saved.payload.postByChannel.instagram, action.payload.postByChannel.instagram); assert.deepEqual(saved.payload.imagesByChannel, action.payload.imagesByChannel); assert.equal(saved.payload.idempotencyKey, action.payload.idempotencyKey); assert.equal(saved.scheduledFor, action.scheduledFor);
    const persisted = buildScheduledPublicationEdit({ ...action.payload, publishPayload: { postByChannel: action.payload.postByChannel, idempotencyKey: "stable-native-key" } }, { channel: "facebook", operation: "text", post: { title: null, content: body, hashtags: null }, mediaId: null, mediaOperation: null, mediaIndex: null });
    assert.equal((persisted.postByChannel as typeof action.payload.postByChannel).facebook.content, body, "the signed server workflow has an exact full-content formatting/emoji equivalent");
  }
});

test("the actual scheduled exit confirmation cannot discard another account source version or locally changed draft", async () => {
  for (const replacement of ["none", "account", "actor", "source", "payload", "scope"]) {
    let release!: (value: boolean) => void, closed = 0, decision = 0, valid = true;
    const session = { scheduledAction: { id: "scheduled-a", updatedAt: "v1" }, action: { payload: { value: 1 } }, previousSelectedKey: "publish", dirty: true };
    const current = { activeAccountId: "account", actorUserId: "actor", session };
    const deps = { activeAccountId: "account", actorUserId: "actor", scheduledEditSession: session, scheduledEditorScopeRef: { current }, preparedActionDirtySignature: (value: unknown) => JSON.stringify(value), confirmInrcy: async () => new Promise<boolean>(resolve => { release = resolve; }), i18nT: (value: string) => value, setScheduledEditSession: () => closed++, setValidationChoiceOpen: () => {}, setValidationScheduleOpen: () => {}, setPublishEditChoiceOpen: () => {}, setPublishEditOpen: () => {}, setPublishMediaPreviewOpen: () => {}, setCampaignEditOpen: () => {}, setMailTextEditOpen: () => {}, setRecipientsPreviewOpen: () => {}, recipientsEditor: { close: () => {} }, setAttachmentPreviewOpen: () => {}, setMailAccountEditOpen: () => {}, setSelectedKey: () => {}, showNotice: () => {} };
    const exit = actualFunction<(options: { canContinue: () => boolean; onDecision: () => void }) => boolean>("app/dashboard/agent/AgentClient.tsx", "exitScheduledEditSession", deps); assert.equal(exit({ canContinue: () => valid, onDecision: () => decision++ }), false);
    if (replacement === "account") current.activeAccountId = "other"; if (replacement === "actor") current.actorUserId = "other"; if (replacement === "source") deps.scheduledEditorScopeRef.current = { ...current, session: { ...session, scheduledAction: { ...session.scheduledAction, updatedAt: "v2" } } }; if (replacement === "payload") deps.scheduledEditorScopeRef.current = { ...current, session: { ...session, action: { payload: { value: 2 } } } }; if (replacement === "scope") valid = false;
    release(true); await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, replacement === "none" ? 1 : 0, replacement); assert.equal(decision, 1);
  }
});

test("the actual scheduled soundtrack callback changes only the local action and preserves the other channel without an Agent PATCH", () => {
  const action = { id: "scheduled-source", payload: { postByChannel: { facebook: { content: "Texte" }, instagram: { content: "Autre canal" } }, soundtrackByChannel: { instagram: "other-track" }, publishPayload: { idempotencyKey: "stable-key" } } };
  let updated: typeof action | undefined;
  const save = actualFunction<(id: string | null) => void>("app/dashboard/agent/AgentClient.tsx", "savePublishSoundtrack", { selectedPreparedAction: action, activeMetaPublicationChannel: "facebook", canEditPublicationSoundtrack: true, publishSoundtrackLocked: false, scheduledEditSession: { action }, updateScheduledEditAction: (update: (value: typeof action) => typeof action) => { updated = update(action); }, applyInrAgentPublicationSoundtrack, fetch: () => assert.fail("The manual edit cannot persist an Agent soundtrack immediately") });
  save("native-catalogue-track"); assert.ok(updated); assert.equal(readInrAgentPublicationSoundtrack(updated.payload, "facebook"), "native-catalogue-track"); assert.deepEqual(updated.payload.postByChannel.instagram, action.payload.postByChannel.instagram); assert.equal(updated.payload.publishPayload.idempotencyKey, "stable-key");
});

test("the actual scheduled Studio handoffs clean a stale prepared transfer before opening any source in another scope", async () => {
  for (const name of ["openPublishImageInStudio", "openPublishVideoInStudio", "openScheduledMediaGeneration"]) {
    let valid = true, release!: (value: unknown) => void, opened = 0, cleaned = 0;
    const deps = { manualPlanningOnly: true, manualStudioCredits: { generateAllowed: true, modifyAllowed: true, prepareModification: () => {} }, manualStudioCreditHelp: "", selectedPreparedAction: { id: "native-source", title: "Publication" }, activePreviewChannel: "facebook", publishMediaActiveIndex: 2, publishMediaPreview: { url: "/api/owned-source", name: "owned.png", kind: "image" }, currentPublishMediaRecord: { mimeType: "image/png", storagePath: "owned/path", kind: "image" }, scheduledEditSession: { scheduledAction: { id: "scheduled-a" } }, preparedChannelPreview: { body: "Brief natif" }, publishBoosterChannel: "facebook", getCurrentVideoSettings: () => ({ format: "original", adaptationMode: "safe_frame" }), asRecord: (value: unknown) => value && typeof value === "object" ? value : null, firstSafeString: (...values: unknown[]) => values.find(value => typeof value === "string" && value.trim()) || "", getUniversalMediaContentType: () => "image/png", i18nT: (value: string) => value, showNotice: () => {},
      createInrStudioHandoff: async (input: { context: { actionId: string; channel: string; mediaIndex: number; scheduledEdit: boolean } }) => { assert.equal(input.context.actionId, "native-source"); assert.equal(input.context.channel, "facebook"); assert.equal(input.context.mediaIndex, 2); assert.equal(input.context.scheduledEdit, true); return new Promise(resolve => { release = resolve; }); }, clearInrStudioHandoff: async (key: string) => { assert.equal(key, "owned-handoff"); cleaned++; }, openStudio: () => opened++,
    };
    const open = actualFunction<((tab: "retouch", valid: () => boolean) => Promise<void>) & ((valid: () => boolean) => Promise<void>)>("app/dashboard/agent/AgentClient.tsx", name, deps);
    const pending = name === "openPublishImageInStudio" ? open("retouch", () => valid) : open(() => valid); valid = false; release({ href: "/dashboard/generer-media?studio_handoff=owned-handoff", handoff: { key: "owned-handoff" } }); await pending; assert.equal(opened, 0, name); assert.equal(cleaned, 1, name);
  }
});

test("Basic scheduled native bindings keep non-scheduled Agent writes unreachable and hide its unsupported Save as draft affordance", () => {
  const source = readFileSync(new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url), "utf8");
  assert.match(source, /enabled: manualPlanningOnly && Boolean\(scheduledEditSession\) && isPublishView/); assert.match(source, /assistantUiScope=\{scheduledEditSession \? "scheduled" : undefined\}/); assert.match(source, /!scheduledEditSession && \(isCampaignView \|\| isPublishView\) && \(/);
  const native = source.slice(source.indexOf("async function savePublishAsDraft()"), source.indexOf("async function savePublishAsDraft()") + 500); assert.match(native, /if \(scheduledEditSession\)/); assert.ok(native.indexOf("if (scheduledEditSession)") < native.indexOf("fetch("));
  const hook = readFileSync(new URL("../../app/dashboard/_hooks/useInrAssistantScheduledPublicationControls.ts", import.meta.url), "utf8"); assert.doesNotMatch(hook, /fetch\(|publishNow|executePublication|updateActionStatus|setAutomationEnabled/);
  const data = readFileSync(new URL("../../app/dashboard/agent/_hooks/useAgentRuntimeData.ts", import.meta.url), "utf8"); assert.match(data, /if \(manualPlanningOnly\) \{ setActions\(\[\]\); return; \}/); assert.match(data, /if \(!manualPlanningOnly && Array\.isArray\(cachedSnapshot\?\.actions\)\)/); assert.match(source, /const canNavigatePublications =[\s\S]{0,100}!scheduledEditSession/);
});
