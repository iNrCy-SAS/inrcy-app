import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parseInrAssistantStudioFormSelection, isInrAssistantStudioFormSelectionApplied, type InrAssistantStudioFormSnapshot } from "../../lib/inrAssistantStudioFormSelection.ts";
import { defaultAiMediaNarrationVoiceVariant, isAiMediaNarrationVoiceVariantForGender } from "../../lib/aiMediaNarrationVoices.ts";
import { isInrStudioTabUnavailable, canSwitchInrStudioMediaType } from "../../lib/inrStudioModalPolicy.ts";

const encode = (field: string, value: unknown) => JSON.stringify({ field, value });
const guided = (): InrAssistantStudioFormSnapshot => ({ mode: "guided", kind: "image", editorVisible: true, locked: false, sourceMode: "criteria", people: "auto", speechMode: "voiceover", narrationVoice: "female", textMode: "ai", publicationAvailable: false, format: "square", creativeBrief: "Original" });
const free = (): InrAssistantStudioFormSnapshot => ({ mode: "free", kind: "video", editorVisible: true, locked: false, speechMode: "voiceover", narrationVoice: "female", spokenScriptOpen: false, spokenScript: "", maxPromptLength: 3900 });

test("Studio form selections accept only native finite fields and preserve omitted criteria without generation or consent", () => {
  for (const [field, value] of [["activeTab", "selection"], ["people", "two"], ["setting", "exterior"], ["focus", "product"], ["imagePurpose", "flyer"], ["format", "portrait"], ["imageStyle", "three_d"], ["visualDirection", "bold"], ["useBrandColors", false], ["logoMode", "visible"], ["textMode", "exact"], ["textKeywords", ["Nouveauté", "20 septembre"]], ["creativeBrief", "x".repeat(1600)]]) assert.ok(parseInrAssistantStudioFormSelection(encode(String(field), value), guided()), String(field));
  for (const [field, value] of [["activeTab", "criteria"], ["prompt", "x".repeat(3900)], ["useBusinessDna", true], ["withMusic", false], ["withSubtitles", true], ["spokenScriptOpen", true], ["speechMode", "characters"], ["narrationVoiceVariant", "Kore"]]) assert.ok(parseInrAssistantStudioFormSelection(encode(String(field), value), free()), String(field));
  const before = guided(); parseInrAssistantStudioFormSelection(encode("format", "story"), before); assert.equal(before.format, "square"); assert.equal(before.creativeBrief, "Original");
  assert.ok(parseInrAssistantStudioFormSelection(encode("prompt", "\n".repeat(3900)), free()), "JSON escaping does not reduce the native prompt character limit");
  for (const field of ["identityConsent", "teamConsent", "generate", "save", "delete", "engine", "mediaId", "url", "script", "saved", "__proto__"]) assert.equal(parseInrAssistantStudioFormSelection(encode(field, true), guided()), null, field);
  for (const value of [{ field: "format", value: "square", submit: true }, { field: "format" }, [], null, "text"]) assert.equal(parseInrAssistantStudioFormSelection(JSON.stringify(value), guided()), null);
});

test("Studio form selections retain native hidden, locked, duration, voice and exact-text constraints", () => {
  const refusals: Array<[string, unknown, InrAssistantStudioFormSnapshot]> = [
    ["format", "story", { ...guided(), locked: true }], ["format", "story", { ...guided(), editorVisible: false }],
    ["format", "story", { ...free(), fixedFormat: "square" }], ["subjectSource", "publication", guided()], ["sourceMode", "real", { ...guided(), transformMode: true }],
    ["people", "one", { ...guided(), sourceMode: "ai" }], ["focus", "people", { ...guided(), people: "none" }], ["imagePurpose", "flyer", free()],
    ["exactText", "Hello", guided()], ["textKeywords", ["#Hello"], guided()], ["textKeywords", ["Hello", "hello"], guided()],
    ["speechMode", "silent", { ...guided(), kind: "video" }], ["speechMode", "silent", { ...free(), spokenScript: "Bonjour" }],
    ["spokenScriptOpen", true, { ...free(), speechMode: "silent" }], ["spokenScript", "Bonjour", free()],
    ["withSubtitles", true, { ...free(), spokenScriptOpen: true, spokenScript: "" }], ["narrationVoiceVariant", "Puck", free()], ["narrationVoice", "male", { ...free(), speechMode: "characters" }],
    ["creativeBrief", "x".repeat(1601), guided()], ["exactText", "x".repeat(601), { ...guided(), textMode: "exact" }], ["prompt", "x".repeat(3901), free()],
  ];
  for (const [field, value, state] of refusals) assert.equal(parseInrAssistantStudioFormSelection(encode(field, value), state), null, `${field} ${JSON.stringify(value).slice(0, 40)}`);
  const duration = encode("durationScene", { seconds: 12, sceneMode: "multi" });
  assert.equal(parseInrAssistantStudioFormSelection(duration, free()), null, "no duration is guessed without the mounted provider's real validator");
  assert.ok(parseInrAssistantStudioFormSelection(duration, free(), (seconds, mode) => seconds === 12 && mode === "multi"));
  assert.equal(parseInrAssistantStudioFormSelection(duration, free(), () => false), null);
});

function actualHandlers(file: string, deps: Record<string, unknown>) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantLocalInterface" && node.arguments[0]?.getText(ast).includes("studio_")) expression = node.arguments[2]; ts.forEachChild(node, visit); }; visit(ast); assert.ok(expression);
  const compiled = ts.transpileModule(`(${expression.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  return vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps) as Record<string, { invoke: (value: string | null) => void; matches: (snapshot: unknown, value: string | null) => boolean; allowUnmount?: boolean }>;
}

test("the actual guided Studio callbacks apply native setters and acknowledge only committed target criteria", () => {
  let state = { ...guided(), activeTab: "subject", narrationVoiceVariant: "Kore", focus: "people", textKeywords: [] as string[] }, submitted = 0;
  const pending: Array<() => void> = [];
  const setter = (key: string) => (value: unknown) => pending.push(() => { const current = state as Record<string, unknown>; state = { ...state, [key]: typeof value === "function" ? value(current[key]) : value }; });
  const deps = { quotaLoading: true, get assistantFormSnapshot() { return state; }, get subjectSource() { return state.subjectSource; }, get aiFocusCriterion() { return state.focus; }, durations: [8, 12], selectedVideoEngine: "fixture", videoResolution: "720p", canGenerateAiMediaVideoDuration: () => true,
    parseInrAssistantStudioFormSelection, isInrAssistantStudioFormSelectionApplied, isAiMediaNarrationVoiceVariantForGender, defaultAiMediaNarrationVoiceVariant,
    setActiveSettingsTab: setter("activeTab"), setFormat: setter("format"), setAiPeopleCriterion: setter("people"), setAiFocusCriterion: setter("focus"), setNarrationVoice: setter("narrationVoice"), setNarrationVoiceVariant: setter("narrationVoiceVariant"), generate: () => submitted++, setIdentityConsent: () => submitted++,
  };
  const native = actualHandlers("app/dashboard/_components/MediaGenerator.tsx", deps).select, change = encode("people", "none");
  native.invoke(change); assert.equal(native.matches(state, change), false); pending.splice(0).forEach(commit => commit()); assert.equal(native.matches(state, change), true); assert.equal(state.focus, "auto", "same side-effect as the native people selector"); assert.equal(state.format, "square");
  assert.throws(() => native.invoke(encode("identityConsent", true))); assert.equal(submitted, 0);
  state = { ...state, locked: true }; assert.throws(() => native.invoke(encode("format", "story"))); assert.equal(pending.length, 0);
});

test("the actual free Studio callbacks preserve prompt ownership and reset native speech authorizations without granting them", () => {
  let state = { ...free(), prompt: "Original", narrationVoiceVariant: "Kore" }, resets = 0;
  const pending: Array<() => void> = []; const setter = (key: string) => (value: unknown) => pending.push(() => { state = { ...state, [key]: value }; });
  const deps = { quotaLoading: true, get assistantFormSnapshot() { return state; }, durations: [8, 12], selectedVideoEngine: "fixture", videoResolution: "720p", canGenerateAiMediaVideoDuration: () => true,
    parseInrAssistantStudioFormSelection, isInrAssistantStudioFormSelectionApplied, defaultAiMediaNarrationVoiceVariant, resetConsent: () => resets++,
    setPrompt: setter("prompt"), setVoice: setter("narrationVoice"), setVoiceVariant: setter("narrationVoiceVariant"), setSpeechMode: setter("speechMode"), setSpokenScript: setter("spokenScript"), setSpokenScriptOpen: setter("spokenScriptOpen"),
  };
  const native = actualHandlers("app/dashboard/_components/MediaFreeGenerator.tsx", deps).select, prompt = encode("prompt", "Nouveau texte de création");
  native.invoke(prompt); assert.equal(native.matches(state, prompt), false); pending.splice(0).forEach(commit => commit()); assert.equal(native.matches(state, prompt), true);
  native.invoke(encode("narrationVoice", "male")); pending.splice(0).forEach(commit => commit()); assert.equal(state.narrationVoiceVariant, "Charon");
  native.invoke(encode("speechMode", "characters")); pending.splice(0).forEach(commit => commit()); assert.equal(resets, 1); assert.equal(state.prompt, "Nouveau texte de création");
  assert.throws(() => native.invoke(encode("generate", true)));
});

test("the actual Studio result controls expand the verified preview, continue creation and zoom without changing a media", () => {
  let expandedResult: string | null = null, cancelConfirmationOpen = true, pauseCount = 0, zoom = 1, closeCount = 0, scrollCount = 0;
  const resultKey = "account:media", pending: Array<() => void> = [];
  const workspace = actualHandlers("app/dashboard/_components/MediaGenerationCreationWorkspace.tsx", { operationLocked: false, resultKey, generationResult: { item: { signed_url: "/api/media-generation/drafts/fixture" } }, cancelConfirmationOpen, generationCancellable: true,
    criteriaEditorState: { activeTab: "criteria", targetTab: "prompt", ready: false }, handleEditCriteria: () => {}, reviewRef: { current: { querySelector: () => ({ pause: () => pauseCount++ }) } }, setExpandedResult: (value: string) => pending.push(() => { expandedResult = value; }), setCancelConfirmationOpen: (value: boolean) => pending.push(() => { cancelConfirmationOpen = value; }),
  });
  workspace.open.invoke(null); assert.equal(workspace.open.matches({ expandedResult }, null), false); pending.splice(0).forEach(commit => commit()); assert.equal(workspace.open.matches({ expandedResult }, null), true); assert.equal(pauseCount, 1);
  workspace.close.invoke(null); assert.equal(workspace.close.matches({ cancelConfirmationOpen }, null), false); pending.splice(0).forEach(commit => commit()); assert.equal(workspace.close.matches({ cancelConfirmationOpen }, null), true);
  assert.equal(workspace.select.matches({ criteriaEditorState: { activeTab: "prompt", targetTab: "prompt", ready: false } }, "edit_criteria"), false, "a recovered job must leave native recovery review before criteria editing is acknowledged");
  assert.equal(workspace.select.matches({ criteriaEditorState: { activeTab: "prompt", targetTab: "prompt", ready: true } }, "edit_criteria"), true);
  const viewer = actualHandlers("app/dashboard/_components/MediaResultViewer.tsx", { video: false, onClose: () => closeCount++, setZoom: (value: number) => pending.push(() => { zoom = value; }), viewportRef: { current: { scrollTo: () => scrollCount++ } } });
  viewer.select.invoke("2.5"); assert.equal(viewer.select.matches({ zoom }, "2.5"), false); pending.splice(0).forEach(commit => commit()); assert.equal(viewer.select.matches({ zoom }, "2.5"), true);
  viewer.select.invoke("1"); pending.splice(0).forEach(commit => commit()); assert.equal(scrollCount, 1); assert.throws(() => viewer.select.invoke("javascript:alert(1)")); assert.throws(() => viewer.select.invoke("4.5"));
  viewer.close.invoke(null); assert.equal(closeCount, 1); assert.equal(viewer.close.allowUnmount, true);
  const video = actualHandlers("app/dashboard/_components/MediaResultViewer.tsx", { video: true, onClose: () => {}, setZoom: () => assert.fail("Video has no zoom control") }); assert.equal(video.select, undefined);
});

test("the actual Studio modal driver respects native mode gates and never resets, discards or silently closes a draft", () => {
  let pendingWork = false, external = false, source = true, closeConfirmOpen = false, imageOnly = false, closes = 0, cancels = 0, studioTab = "generate";
  const changes: Array<[string, string]> = [];
  const handlers = actualHandlers("app/dashboard/_components/MediaGeneratorModal.tsx", {
    get hasPendingWork() { return pendingWork; }, get hasExternalHandoff() { return external; }, get closeConfirmOpen() { return closeConfirmOpen; }, get hasSourceMedia() { return source; }, get imageOnly() { return imageOnly; }, get studioTab() { return studioTab; },
    isInrStudioTabUnavailable, canSwitchInrStudioMediaType, requestClose: () => closes++, cancelClose: () => cancels++, requestStudioTab: (value: string) => changes.push(["tab", value]), requestMediaType: (value: string) => changes.push(["mediaType", value]),
  });
  handlers.select.invoke(encode("tab", "modify")); assert.deepEqual(changes, [["tab", "modify"]]); assert.equal(handlers.select.matches({ studioTab: "generate" }, encode("tab", "modify")), false); assert.equal(handlers.select.matches({ studioTab: "modify" }, encode("tab", "modify")), true);
  for (const value of ["reset", "discard", "confirm_close", encode("tab", "unknown"), encode("url", "https://foreign.test"), JSON.stringify({ field: "tab", value: "modify", confirm: true })]) assert.throws(() => handlers.select.invoke(value), value);
  source = false; handlers.select.invoke(encode("tab", "modify")); external = true; assert.throws(() => handlers.select.invoke(encode("tab", "modify"))); source = true; external = false;
  pendingWork = true; assert.throws(() => handlers.select.invoke(encode("tab", "retouch"))); pendingWork = false;
  external = true; handlers.select.invoke(encode("mediaType", "video")); studioTab = "retouch"; assert.throws(() => handlers.select.invoke(encode("mediaType", "video"))); external = false; studioTab = "generate";
  imageOnly = true; assert.throws(() => handlers.select.invoke(encode("mediaType", "video"))); imageOnly = false;
  closeConfirmOpen = true; handlers.select.invoke("continue_editing"); assert.equal(cancels, 1); assert.equal(handlers.select.matches({ closeConfirmOpen: false }, "continue_editing"), true);
  const blocked = actualHandlers("app/dashboard/_components/MediaGeneratorModal.tsx", { hasPendingWork: true, hasExternalHandoff: false, closeConfirmOpen: true }); assert.equal(blocked.close, undefined);
  assert.equal(closes, 0, "selection cannot invoke close/reset/discard");
});

test("the actual free Studio return-to-criteria callback reopens a recovered result without discarding or regenerating", () => {
  const file = "app/dashboard/_components/MediaFreeGenerator.tsx", source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleEdit") expression = node.initializer; ts.forEachChild(node, visit); }; visit(ast); assert.ok(expression);
  const compiled = ts.transpileModule(`(${expression.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  let recovered = "", tab = "criteria", focused = 0;
  const deps = { operationLocked: false, result: { recovered: true, item: { id: "native-result" } }, instanceId: "mounted", setEditingRecoveredId: (value: string) => { recovered = value; }, setActiveSettingsTab: (value: string) => { tab = value; }, window: { requestAnimationFrame: (callback: () => void) => callback() }, document: { getElementById: (id: string) => { assert.equal(id, "mounted-prompt"); return { focus: () => focused++ }; } } };
  const native = vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps) as () => void;
  native(); assert.equal(recovered, "native-result"); assert.equal(tab, "prompt"); assert.equal(focused, 1);
  deps.operationLocked = true; tab = "criteria"; native(); assert.equal(tab, "criteria");
});
