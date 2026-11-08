import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parseInrAssistantStudioFormSelection, isInrAssistantStudioFormSelectionApplied, isInrAssistantStudioFormSelectionRequested, type InrAssistantStudioFormSnapshot } from "../../lib/inrAssistantStudioFormSelection.ts";
import { defaultAiMediaNarrationVoiceVariant, isAiMediaNarrationVoiceVariantForGender } from "../../lib/aiMediaNarrationVoices.ts";
import { isInrStudioTabUnavailable, canSwitchInrStudioMediaType } from "../../lib/inrStudioModalPolicy.ts";
import { isInrAssistantLocalInterfaceRequest, isInrAssistantLocalInterfaceValueRequested, parseInrAssistantLocalInterfaceCommand } from "../../lib/inrAssistantLocalInterface.ts";
import { canGenerateAiMediaVideoDuration } from "../../lib/aiMediaVideoTimeline.ts";

const encode = (field: string, value: unknown) => JSON.stringify({ field, value });
const guided = (): InrAssistantStudioFormSnapshot => ({ mode: "guided", kind: "image", editorVisible: true, locked: false, sourceMode: "criteria", people: "auto", speechMode: "voiceover", narrationVoice: "female", textMode: "ai", publicationAvailable: false, format: "square", creativeBrief: "Original" });
const free = (): InrAssistantStudioFormSnapshot => ({ mode: "free", kind: "video", editorVisible: true, locked: false, speechMode: "voiceover", voiceMode: "ai", narrationVoice: "female", spokenScriptOpen: false, spokenScript: "", maxPromptLength: 3900 });

test("automatic Studio duration accepts seconds only, derives the native pair and refuses unavailable engines or legacy montage choices", () => {
  const state: InrAssistantStudioFormSnapshot = { ...free(), automaticSceneMode: true, videoEngine: "grok-lite", videoResolution: "720p", durationScene: { seconds: 8, sceneMode: "single" } };
  const allowed = (seconds: number, mode: "single" | "multi") => canGenerateAiMediaVideoDuration("grok-lite", seconds, "720p", mode);
  assert.deepEqual(parseInrAssistantStudioFormSelection(encode("durationSeconds", 15), state, allowed), { field: "durationScene", value: { seconds: 15, sceneMode: "single" } });
  assert.deepEqual(parseInrAssistantStudioFormSelection(encode("durationSeconds", 30), state, allowed), { field: "durationScene", value: { seconds: 30, sceneMode: "multi" } });
  for (const value of [3, 31, 8.5, "15", { seconds: 15, sceneMode: "multi" }]) assert.equal(parseInrAssistantStudioFormSelection(encode("durationSeconds", value), state, allowed), null);
  for (const sceneMode of ["single", "multi"]) assert.equal(parseInrAssistantStudioFormSelection(encode("durationScene", { seconds: 15, sceneMode }), state, allowed), null);
  for (const patch of [{ locked: true }, { editorVisible: false }, { kind: "image" as const }, { videoEngine: "wan3" as const }, { videoEngine: "heygen" as const }, { videoEngine: "not-a-real-engine" as never }, { videoEngine: undefined }, { videoResolution: "768p" as const }, { videoResolution: undefined }, { automaticSceneMode: false }, { mode: "guided" as const }]) {
    assert.equal(parseInrAssistantStudioFormSelection(encode("durationSeconds", 15), { ...state, ...patch }, allowed), null);
  }
  assert.equal(parseInrAssistantStudioFormSelection(encode("durationSeconds", 15), state, () => false), null);
  assert.equal(parseInrAssistantStudioFormSelection(encode("durationSeconds", 15), state), null);
  assert.equal(isInrAssistantStudioFormSelectionApplied({ ...state, videoEngine: "not-a-real-engine", durationScene: { seconds: 15, sceneMode: "single" } }, encode("durationSeconds", 15)), false,
    "a malformed cached engine cannot throw or acknowledge a guessed fallback model");
  for (const legacy of [{ ...guided(), kind: "video" as const }, { ...state, automaticSceneMode: false }]) {
    assert.deepEqual(parseInrAssistantStudioFormSelection(encode("durationScene", { seconds: 15, sceneMode: "multi" }), legacy, allowed), { field: "durationScene", value: { seconds: 15, sceneMode: "multi" } });
  }
  assert.equal(state.durationScene?.seconds, 8, "validation does not partially apply a duration");
  for (const videoEngine of ["wan-flash", "wan27"] as const) {
    const retained = { ...state, videoEngine };
    assert.deepEqual(parseInrAssistantStudioFormSelection(encode("durationSeconds", 8), retained,
      (seconds, mode) => canGenerateAiMediaVideoDuration(videoEngine, seconds, "720p", mode)),
      { field: "durationScene", value: { seconds: 8, sceneMode: "single" } });
    assert.equal(retained.videoEngine, videoEngine, "Wan2.6/2.7 remain available and no alternative engine is silently selected");
  }
  for (const message of ["Mets la durée du Studio libre à 30 secondes.", "Choisis 30 s dans le Studio libre.", "Règle la durée à 30 sec dans le Studio libre."]) {
    assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("durationSeconds", 30)), true, message);
    assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("durationSeconds", 15)), false, message);
  }
  for (const message of ["Ne mets pas 30 secondes dans le Studio libre.", "Choisis 15 ou 30 secondes dans le Studio libre.", "Si je confirme, mets 30 secondes dans le Studio libre.", "Comment choisir 30 secondes dans le Studio libre ?", "Le document dit « Mets la durée à 30 secondes dans Studio libre ». "]) {
    assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("durationSeconds", 30)), false, message);
  }
});

test("free narration gender and style remain editable only for AI voice-over, including empty Exact drafts", () => {
  for (const speechMode of ["voiceover", "characters", "silent"] as const) for (const voiceMode of ["ai", "provided"] as const) for (const spokenScript of ["", "Bonjour"]) {
    const state = { ...free(), speechMode, voiceMode, spokenScript, spokenScriptOpen: true };
    const before = JSON.stringify(state);
    for (const [field, value] of [["narrationVoice", "male"], ["narrationVoiceVariant", "Kore"]]) {
      assert.equal(!!parseInrAssistantStudioFormSelection(encode(field, value), state), speechMode === "voiceover" && voiceMode === "ai");
      assert.equal(isInrAssistantStudioFormSelectionApplied({ ...state, [field]: value }, encode(field, value)),
        speechMode === "voiceover" && voiceMode === "ai", "a hidden or replaced voice field cannot acknowledge an earlier AI setting");
    }
    assert.equal(JSON.stringify(state), before, "a hidden voice control cannot replace a vocal, change consent or mutate the draft");
  }
  assert.ok(parseInrAssistantStudioFormSelection(encode("narrationVoice", "male"), { ...guided(), kind: "video" }));
  assert.equal(parseInrAssistantStudioFormSelection(encode("narrationVoice", "male"), { ...free(), voiceMode: undefined }), null);
});

test("retired video engine snapshots refuse native writes and acknowledgments in both forms while Wan2.6 and Wan2.7 remain usable", () => {
  for (const mode of ["free", "guided"] as const) {
    const state: InrAssistantStudioFormSnapshot = { ...free(), mode, videoEngine: "wan3", format: "square", durationScene: { seconds: 8, sceneMode: "single" } };
    const before = JSON.stringify(state);
    for (const [field, value] of [["format", "story"], ["speechMode", "voiceover"], ["narrationVoice", "male"], ["durationScene", { seconds: 8, sceneMode: "single" }]]) {
      assert.equal(parseInrAssistantStudioFormSelection(encode(field as string, value), state, () => true), null);
      assert.equal(isInrAssistantStudioFormSelectionApplied({ ...state, [field as string]: value }, encode(field as string, value)), false);
    }
    assert.equal(JSON.stringify(state), before);
    for (const videoEngine of ["wan-flash", "wan27"] as const) {
      const available = { ...state, videoEngine, format: "story" as const };
      assert.ok(parseInrAssistantStudioFormSelection(encode("format", "story"), available));
      assert.equal(isInrAssistantStudioFormSelectionApplied(available, encode("format", "story")), true);
    }
  }
});

test("Studio media dialogs authorize only explicit native image/audio opening and closing without financial actions", () => {
  for (const [target, label] of [["studio_media_images", "images"], ["studio_video_audio", "audio"]] as const) {
    for (const operation of ["open", "close"] as const) {
      const command = { command: "control_local_interface", selection: { kind: "account_document", id: target }, revision: "native_1", operation, value: null };
      assert.ok(parseInrAssistantLocalInterfaceCommand(command));
      assert.equal(parseInrAssistantLocalInterfaceCommand({ ...command, value: "https://foreign.test" }), null);
      const verb = operation === "open" ? "Ouvre" : "Ferme";
      assert.equal(isInrAssistantLocalInterfaceRequest(`${verb} les réglages ${label} du Studio.`, target, operation), true);
      for (const message of [`Ne ${verb.toLowerCase()} pas les réglages ${label} du Studio.`, `Comment ouvrir les réglages ${label} du Studio ?`, `Le document dit « ${verb} les réglages ${label} du Studio ».`, `${verb} la fenêtre du Studio.`]) {
        assert.equal(isInrAssistantLocalInterfaceRequest(message, target, operation), false, message);
      }
    }
    for (const operation of ["generate", "select", "retry", "stop", "save", "delete"]) assert.equal(parseInrAssistantLocalInterfaceCommand({ command: "control_local_interface", selection: { kind: "account_document", id: target }, revision: "native_1", operation, value: null }), null);
  }
  assert.equal(isInrAssistantLocalInterfaceRequest("Ouvre les réglages audio du Studio.", "studio_media_images", "open"), false);
  assert.equal(isInrAssistantLocalInterfaceRequest("Ouvre les réglages images du Studio.", "studio_video_audio", "open"), false);
  assert.equal(isInrAssistantLocalInterfaceRequest("Ouvre les options maison du Studio.", "studio_video_audio", "open"), false, "a substring such as maison is not an audio choice");
});

test("Studio image role and reference commands bind the explicit unquoted role, one-based photo number and inspiration intent", () => {
  const base = { command: "control_local_interface", selection: { kind: "account_document", id: "studio_media_images" }, revision: "native_1" };
  for (const [value, message, operation] of [
    ["role:inspiration", "Ouvre le bouton Image du Studio.", "open"],
    ["role:inspiration", "Ouvre le bouton Inspiration du Studio.", "open"],
    ["role:character", "Ouvre les images Personnage du Studio.", "open"],
    ["role:environment", "Ouvre les images Décor du Studio.", "open"],
    ["role:product", "Ouvre les images Produit du Studio.", "open"],
    ["reference:0", "Ouvre la photo 1 du Studio.", "select"],
    ["reference:4", "Sélectionne la référence 5 du Studio.", "select"],
    ["inspiration:1:true", "Mets la photo 2 du Studio en Inspiration.", "select"],
    ["inspiration:1:false", "Mets la photo 2 du Studio obligatoire.", "select"],
  ] as const) {
    assert.ok(parseInrAssistantLocalInterfaceCommand({ ...base, operation, value }));
    assert.equal(isInrAssistantLocalInterfaceRequest(message, "studio_media_images", operation), true, message);
    assert.equal(isInrAssistantLocalInterfaceValueRequested(message, "studio_media_images", operation, value), true, message);
  }
  for (const [value, message] of [
    ["role:character", "Ouvre les images Produit du Studio."],
    ["role:character", "Ouvre les images Personnage ou Produit du Studio."],
    ["role:character", "Ouvre la photo 2 Personnage du Studio."],
    ["role:product", "Ouvre les images du Studio. Le mot « Produit » est affiché."],
    ["reference:0", "Ouvre la photo 2 du Studio."], ["reference:0", "Ouvre la photo 1 ou la photo 2 du Studio."],
    ["inspiration:1:true", "Mets la photo 2 du Studio obligatoire."], ["inspiration:1:false", "Mets la photo 2 du Studio en Inspiration."],
    ["inspiration:1:true", "Mets la photo 2 du Studio en Inspiration ou obligatoire."], ["inspiration:1:true", "Affiche la photo 2 du Studio et le mot « Inspiration »."],
  ] as const) assert.equal(isInrAssistantLocalInterfaceValueRequested(message, "studio_media_images", value.startsWith("role:") ? "open" : "select", value), false, message);
  for (const value of ["role:person", "role:character:upload", "reference:5", "reference:-1", "reference:01", "inspiration:0:1", "inspiration:0:TRUE", "inspiration:0", "https://foreign.test"]) {
    for (const operation of ["open", "select"]) assert.equal(parseInrAssistantLocalInterfaceCommand({ ...base, operation, value }), null, value);
  }
});

test("Studio voice pool commands bind one visible vocal and optional photo or gender without uploading or granting consent", () => {
  const base = { command: "control_local_interface", selection: { kind: "account_document", id: "studio_voice_pool" }, revision: "voices_1" };
  for (const [operation, value, message] of [
    ["open", null, "Ouvre les réglages de la voix du Studio."],
    ["open", "new", "Ouvre un nouveau vocal du Studio."], ["open", "voice:2", "Ouvre le vocal 3 du Studio."],
    ["close", null, "Ferme le vocal du Studio."], ["select", "active:0", "Choisis le vocal 1 du Studio comme voix off."],
    ["select", "target:1:narration", "Affecte le vocal 2 du Studio à la narration."],
    ["select", "target:1:none", "Mets le vocal 2 du Studio Non affecté."],
    ["select", "target:0:none", "Retire l’affectation du vocal 1 du Studio."],
    ["select", "target:2:reference:4", "Associe le vocal 3 à la photo 5 dans le Studio."],
    ["select", "gender:1:female", "Règle le genre du vocal 2 du Studio en féminin."],
    ["select", "gender:0:male", "Mets le vocal 1 du Studio en masculin."],
    ["select", "gender:2:auto", "Choisis le genre automatique pour le vocal 3 du Studio."],
  ] as const) {
    assert.ok(parseInrAssistantLocalInterfaceCommand({ ...base, operation, value }), `${operation}:${value}`);
    assert.equal(isInrAssistantLocalInterfaceRequest(message, "studio_voice_pool", operation), true, message);
    assert.equal(isInrAssistantLocalInterfaceValueRequested(message, "studio_voice_pool", operation, value), true, message);
  }
  for (const [operation, value] of [["open", "voice:3"], ["open", "voice:01"], ["select", "active:3"], ["select", "active:0:"], ["select", "target:0:reference:5"], ["select", "target:0:reference:01"], ["select", "gender:0:feminine"], ["select", "https://foreign.test"], ["close", "voice:0"]] as const) assert.equal(parseInrAssistantLocalInterfaceCommand({ ...base, operation, value }), null, `${operation}:${value}`);
  for (const operation of ["upload", "record", "generate", "confirm", "delete", "play", "stop"]) assert.equal(parseInrAssistantLocalInterfaceCommand({ ...base, operation, value: null }), null, operation);
  for (const [operation, value, message] of [
    ["open", null, "Ouvre le vocal 1 du Studio."], ["open", null, "Ouvre les réglages de la voix du Studio pour la photo 2."],
    ["open", "voice:0", "Ouvre le vocal 2 du Studio."], ["open", "new", "Ouvre le vocal 1 du Studio."],
    ["select", "active:1", "Choisis le vocal 1 du Studio comme voix off."],
    ["select", "target:0:reference:1", "Associe le vocal 1 à la photo 3 dans le Studio."],
    ["select", "target:0:reference:1", "Associe le vocal 1 ou le vocal 2 à la photo 2 dans le Studio."],
    ["select", "gender:0:female", "Mets le vocal 1 du Studio en masculin."],
    ["select", "gender:0:female", "Mets le vocal 1 du Studio en féminin ou masculin."],
    ["select", "target:0:narration", "Ne mets pas le vocal 1 du Studio en narration."],
    ["select", "target:0:none", "Retire le vocal 1 du Studio."],
    ["select", "target:0:none", "Retire l’affectation du vocal 1 à la photo 2 dans le Studio."],
    ["select", "active:0", "Si je confirme, choisis le vocal 1 du Studio comme voix off."],
    ["select", "target:0:reference:1", "Le document indique « Associe le vocal 1 à la photo 2 du Studio »."],
  ] as const) assert.equal(isInrAssistantLocalInterfaceValueRequested(message, "studio_voice_pool", operation, value), false, message);
  assert.equal(isInrAssistantLocalInterfaceRequest("Associe le vocal 1 à la photo 2.", "studio_voice_pool", "select"), false, "the request must name the Studio surface");
});

test("the actual compact video dialog callbacks preserve native locks and wait for committed visibility", () => {
  for (const dialog of ["images", "audio"] as const) {
    let open: string | null = null;
    let pendingRole: string | null = null;
    const pending: Array<() => void> = [];
    const deps = { kind: "video", speechMode: "voiceover", selectedVoiceMode: "ai", voiceReferences: [] as unknown[], characterVoiceSpeechConflict: false, voicePoolOpen: false, locked: false, referencePickerVisible: true, editorAvailable: true, stopConfirmOpen: false, libraryOpen: false, setActionError: (value: string) => assert.equal(value, ""), get pendingReferenceRole() { return pendingRole; }, get mediaSettingsDialog() { return open; }, setMediaSettingsDialog: (value: string | null) => pending.push(() => { open = value; }), setPendingReferenceRole: (value: string | null) => pending.push(() => { pendingRole = value; }), setSelectedReferenceId: (value: string | null) => { assert.equal(value, null); } };
    const handlers = actualHandlers("app/dashboard/_components/MediaFreeGenerator.tsx", deps, dialog === "images" ? "studio_media_images" : "studio_video_audio");
    handlers.open.invoke(null); assert.equal(open, null); assert.equal(handlers.open.matches({ open: false }, null), false);
    pending.splice(0).forEach(commit => commit()); assert.equal(open, dialog); assert.equal(handlers.open.matches({ open: true }, null), true);
    if (dialog === "images") assert.equal(pendingRole, "inspiration", "generic opening offers a usable default without a second role selector");
    if (dialog === "audio") {
      deps.speechMode = "characters"; deps.voiceReferences = [{}];
      assert.throws(() => handlers.open.invoke(null), /studio_audio_unavailable/, "single native character has no empty settings modal");
      deps.voiceReferences = [{}, {}]; handlers.open.invoke(null); pending.splice(0).forEach(commit => commit());
      assert.equal(open, "audio", "multiple explicit character voices retain useful settings");
      deps.speechMode = "voiceover"; deps.voiceReferences = [];
    }
    deps.locked = true; assert.throws(() => handlers.open.invoke(null)); assert.throws(() => handlers.close.invoke(null)); deps.locked = false;
    if (dialog === "audio") { deps.speechMode = "silent"; assert.throws(() => handlers.open.invoke(null)); deps.speechMode = "voiceover"; deps.voicePoolOpen = true; assert.throws(() => handlers.open.invoke(null)); deps.voicePoolOpen = false; deps.selectedVoiceMode = "provided"; assert.throws(() => handlers.open.invoke(null)); deps.selectedVoiceMode = "ai"; }
    if (dialog === "images") { deps.libraryOpen = true; assert.throws(() => handlers.close.invoke(null)); deps.libraryOpen = false; }
    handlers.close.invoke(null); assert.equal(handlers.close.matches({ open: true }, null), false); pending.splice(0).forEach(commit => commit()); assert.equal(open, null); assert.equal(handlers.close.matches({ open: false }, null), true);
    deps.kind = "image";
    if (dialog === "audio") assert.throws(() => handlers.open.invoke(null));
    else { handlers.open.invoke(null); pending.splice(0).forEach(commit => commit()); assert.equal(open, "images", "images remain available in the compact image editor"); }
  }
});

test("the actual image reference controls acknowledge the captured ID after reorder and reject removal, replacement or stale indices", () => {
  let references = [{ id: "reference-a", role: "character", usage: "required" }, { id: "reference-b", role: "product", usage: "required" }];
  let open: string | null = null, selected: string | null = null, pendingRole: string | null = null;
  const commits: Array<() => void> = [], updates: string[] = [];
  const deps = {
    locked: false, libraryOpen: false, referencePickerVisible: true, referenceAction: { current: null }, setActionError: (value: string) => assert.equal(value, ""), get references() { return references; },
    setPendingReferenceRole: (value: string | null) => commits.push(() => { pendingRole = value; }), setSelectedReferenceId: (value: string) => commits.push(() => { selected = value; }), setMediaSettingsDialog: (value: string) => commits.push(() => { open = value; }),
    updateReference: (id: string, patch: { usage: string }) => { updates.push(id); commits.push(() => { references = references.map(reference => reference.id === id ? { ...reference, ...patch } : reference); }); },
  };
  const handlers = actualHandlers("app/dashboard/_components/MediaFreeGenerator.tsx", deps, "studio_media_images");
  const snapshot = () => ({ open: open === "images", selectedReferenceId: selected, pendingReferenceRole: pendingRole, references });
  handlers.open.invoke("role:product"); assert.equal(handlers.open.matches(snapshot(), "role:product"), false); commits.splice(0).forEach(commit => commit()); assert.equal(handlers.open.matches(snapshot(), "role:product"), true);
  handlers.select.invoke("inspiration:0:true"); assert.deepEqual(updates, ["reference-a"]); assert.equal(handlers.select.matches(snapshot(), "inspiration:0:true"), false);
  references.reverse(); commits.splice(0).forEach(commit => commit());
  assert.equal(handlers.select.matches(snapshot(), "inspiration:0:true"), true, "reordering preserves confirmation for the same captured ID");
  assert.equal(references.find(reference => reference.id === "reference-b")?.usage, "required", "the reference now at index zero is untouched");
  references = [{ id: "replacement", role: "character", usage: "inspiration" }, references[0]];
  assert.equal(handlers.select.matches(snapshot(), "inspiration:0:true"), false, "a same-index replacement cannot impersonate the captured reference");
  handlers.select.invoke("reference:1"); assert.equal(handlers.select.matches(snapshot(), "reference:1"), false); commits.splice(0).forEach(commit => commit());
  assert.equal(selected, "reference-b"); assert.equal(handlers.select.matches(snapshot(), "reference:1"), true);
  assert.equal(handlers.select.matches(snapshot(), "reference:0"), false, "an acknowledgement is tied to its exact encoded command");
  for (const value of ["reference:2", "reference:5", "reference:-1", "inspiration:0", "inspiration:0:TRUE", "reference:0:true"]) assert.throws(() => handlers.select.invoke(value));
  deps.locked = true; assert.throws(() => handlers.select.invoke("inspiration:0:false")); assert.equal(commits.length, 0);
});

test("Studio speech mode choices require an explicit unquoted request for the matching Exact or Automatic option", () => {
  for (const message of ["Choisis les paroles exactes.", "Sélectionne les paroles exactes.", "Mets les paroles exactes.", "Active les paroles exactes."]) {
    assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("spokenScriptOpen", true)), true, message);
    assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("spokenScriptOpen", false)), false, message);
  }
  for (const message of ["Mets les paroles automatiques.", "Choisis les paroles automatiques.", "Sélectionnez les paroles automatiques."]) {
    assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("spokenScriptOpen", false)), true, message);
    assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("spokenScriptOpen", true)), false, message);
  }
  for (const message of ["Paroles automatiques", "Paroles exactes", "Ne choisis pas les paroles exactes.", "Ne mets pas les paroles automatiques.", "Choisis les paroles exactes ou les paroles automatiques.", "« Choisis les paroles exactes. »", 'Mets la consigne « Choisis les paroles exactes ».']) {
    for (const value of [true, false]) assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("spokenScriptOpen", value)), false, message);
  }
  assert.equal(parseInrAssistantStudioFormSelection(encode("spokenScriptOpen", true), { ...free(), locked: true }), null);
  assert.equal(parseInrAssistantStudioFormSelection(encode("spokenScriptOpen", true), { ...free(), speechMode: "silent" }), null);
});

test("Studio form selections accept only native finite fields and preserve omitted criteria without generation or consent", () => {
  for (const [field, value] of [["activeTab", "selection"], ["people", "two"], ["setting", "exterior"], ["focus", "product"], ["imagePurpose", "flyer"], ["format", "portrait"], ["imageStyle", "three_d"], ["visualDirection", "bold"], ["useBrandColors", false], ["logoMode", "visible"], ["textMode", "exact"], ["textKeywords", ["Nouveauté", "20 septembre"]], ["creativeBrief", "x".repeat(1600)]]) assert.ok(parseInrAssistantStudioFormSelection(encode(String(field), value), guided()), String(field));
  for (const [field, value] of [["activeTab", "criteria"], ["prompt", "x".repeat(500)], ["useBusinessDna", true], ["withMusic", false], ["withSubtitles", true], ["spokenScriptOpen", true], ["speechMode", "characters"], ["narrationVoiceVariant", "Kore"]]) assert.ok(parseInrAssistantStudioFormSelection(encode(String(field), value), free()), String(field));
  const before = guided(); parseInrAssistantStudioFormSelection(encode("format", "story"), before); assert.equal(before.format, "square"); assert.equal(before.creativeBrief, "Original");
  assert.ok(parseInrAssistantStudioFormSelection(encode("prompt", "\n".repeat(500)), free()), "JSON escaping does not reduce the 500-character video brief allowance");
  assert.equal(parseInrAssistantStudioFormSelection(encode("prompt", "x".repeat(501)), free()), null);
  assert.ok(parseInrAssistantStudioFormSelection(encode("prompt", "x".repeat(3900)), { ...free(), kind: "image" }), "the image allowance remains unchanged");
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
    ["withSubtitles", true, { ...free(), speechMode: "silent" }], ["narrationVoiceVariant", "Puck", free()], ["narrationVoice", "male", { ...free(), speechMode: "characters" }],
    ["creativeBrief", "x".repeat(1601), guided()], ["exactText", "x".repeat(601), { ...guided(), textMode: "exact" }], ["prompt", "x".repeat(3901), free()],
  ];
  for (const [field, value, state] of refusals) assert.equal(parseInrAssistantStudioFormSelection(encode(field, value), state), null, `${field} ${JSON.stringify(value).slice(0, 40)}`);
  const duration = encode("durationScene", { seconds: 12, sceneMode: "multi" });
  assert.equal(parseInrAssistantStudioFormSelection(duration, free()), null, "no duration is guessed without the mounted provider's real validator");
  assert.ok(parseInrAssistantStudioFormSelection(duration, free(), (seconds, mode) => seconds === 12 && mode === "multi"));
  assert.equal(parseInrAssistantStudioFormSelection(duration, free(), () => false), null);
});

test("native voice fields accept only a current Personne at the requested full reference position", () => {
  const state: InrAssistantStudioFormSnapshot = { ...free(), speechMode: "characters", voiceMode: "ai", voiceReferences: [
    { id: "person-a", name: "Alice.png", voiceMode: "ai", referenceIndex: 1 },
    { id: "person-b", name: "Bob.png", voiceMode: "ai", referenceIndex: 3 },
  ] };
  assert.deepEqual(parseInrAssistantStudioFormSelection(encode("voiceReferenceId", "reference:1"), state), { field: "voiceReferenceId", value: "person-a" });
  assert.deepEqual(parseInrAssistantStudioFormSelection(encode("voiceReferenceId", "reference:3"), state), { field: "voiceReferenceId", value: "person-b" });
  for (const value of ["reference:0", "reference:2", "reference:5", "reference:01", "foreign-person", null, {}, 1]) assert.equal(parseInrAssistantStudioFormSelection(encode("voiceReferenceId", value), state), null, String(value));
  assert.equal(parseInrAssistantStudioFormSelection(encode("voiceMode", "provided"), state), null, "several people require one explicit target");
  assert.equal(parseInrAssistantStudioFormSelection(encode("voiceMode", "ai"), state), null, "AI cannot acknowledge an arbitrary person in a multi-person draft either");
  assert.ok(parseInrAssistantStudioFormSelection(encode("voiceMode", "ai"), { ...state, voiceReferences: [] }));
  assert.ok(parseInrAssistantStudioFormSelection(encode("voiceMode", "provided"), { ...state, voiceReferenceId: "person-b" }));
  assert.ok(parseInrAssistantStudioFormSelection(encode("voiceMode", "provided"), { ...state, voiceReferences: state.voiceReferences!.slice(0, 1) }));
  assert.equal(parseInrAssistantStudioFormSelection(encode("voiceMode", "provided"), { ...state, voiceReferences: [] }), null);
  for (const patch of [{ kind: "image" as const }, { speechMode: "silent" as const }, { locked: true }, { editorVisible: false }, { mode: "guided" as const }]) {
    for (const command of [encode("voiceReferenceId", "person-a"), encode("voiceMode", "provided")]) assert.equal(parseInrAssistantStudioFormSelection(command, { ...state, voiceReferenceId: "person-a", ...patch }), null);
  }
  assert.equal(parseInrAssistantStudioFormSelection(encode("voiceMode", "unknown"), state), null);
  assert.equal(parseInrAssistantStudioFormSelection(encode("voiceReferenceId", "reference:1"), { ...state, voiceReferences: [...state.voiceReferences!, { id: "person-c", name: "Other.png", voiceMode: "ai", referenceIndex: 1 }] }), null, "a duplicated position cannot select an arbitrary image");
});

test("voice mode and photo selection require the matching explicit unquoted choice", () => {
  assert.equal(isInrAssistantStudioFormSelectionRequested("Choisis la voix réelle du Studio libre.", encode("voiceMode", "provided")), true);
  assert.equal(isInrAssistantStudioFormSelectionRequested("Utilise une voix IA dans le Studio libre.", encode("voiceMode", "ai")), true);
  for (const message of ["Choisis une voix IA ou une voix réelle.", "Ne choisis pas la voix réelle.", "Comment choisir ma voix réelle ?", "Si je confirme, choisis la voix réelle.", "Le document indique « Choisis ma voix réelle ». ", "Importe ma voix réelle.", "Enregistre ma voix réelle."]) assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("voiceMode", "provided")), false, message);
  assert.equal(isInrAssistantStudioFormSelectionRequested("Sélectionne la photo 2 du Studio libre pour la voix.", encode("voiceReferenceId", "reference:1")), true);
  for (const message of ["Sélectionne la photo 3 du Studio libre.", "Sélectionne la photo 2 ou la photo 3.", "Ne sélectionne pas la photo 2.", "Le document dit « Sélectionne la photo 2 ». "]) assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("voiceReferenceId", "reference:1")), false, message);
  assert.equal(isInrAssistantStudioFormSelectionRequested("Choisis la référence person-a pour sa voix.", encode("voiceReferenceId", "person-a")), true);
  assert.equal(isInrAssistantStudioFormSelectionRequested("Choisis la référence person-ab pour sa voix.", encode("voiceReferenceId", "person-a")), false, "a matching ID prefix is not an explicit selection");
});

test("native Real voiceover accepts no photo while character voices retain their explicit image target", () => {
  const voiceover = { ...free(), voiceMode: "ai" as const, voiceReferences: [] };
  for (const mode of ["ai", "provided"]) assert.ok(parseInrAssistantStudioFormSelection(encode("voiceMode", mode), voiceover));
  assert.equal(parseInrAssistantStudioFormSelection(encode("voiceReferenceId", "reference:0"), voiceover), null, "voiceover never opens a hidden person selector");
  assert.equal(parseInrAssistantStudioFormSelection(encode("voiceMode", "provided"), { ...voiceover, speechMode: "characters" }), null, "a character's real voice still needs its image");
  for (const patch of [{ kind: "image" as const }, { speechMode: "silent" as const }, { locked: true }, { editorVisible: false }]) assert.equal(parseInrAssistantStudioFormSelection(encode("voiceMode", "provided"), { ...voiceover, ...patch }), null);
  for (const field of ["narrationVoiceSample", "voiceSample", "identityConsent", "upload", "record", "generate"]) assert.equal(parseInrAssistantStudioFormSelection(encode(field, "provided"), voiceover), null, "choosing a voice mode cannot import a sample or grant permissions");
});

test("the native subtitle checkbox requires the requested checked state without granting any voice consent", () => {
  for (const [message, checked] of [["Coche les sous-titres du Studio libre.", true], ["Décoche les sous-titres du Studio libre.", false]] as const) {
    assert.equal(isInrAssistantLocalInterfaceRequest(message, "studio_free_form", "select"), true);
    assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("withSubtitles", checked)), true);
    assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("withSubtitles", !checked)), false);
    assert.ok(parseInrAssistantStudioFormSelection(encode("withSubtitles", checked), free()));
    const emptyExact = { ...free(), spokenScriptOpen: true, spokenScript: "", withSubtitles: !checked };
    assert.ok(parseInrAssistantStudioFormSelection(encode("withSubtitles", checked), emptyExact), "empty Exact keeps the same explicit checkbox selection available");
    assert.equal(isInrAssistantStudioFormSelectionApplied(emptyExact, encode("withSubtitles", checked)), false);
    assert.equal(isInrAssistantStudioFormSelectionApplied({ ...emptyExact, withSubtitles: checked }, encode("withSubtitles", checked)), true);
  }
  for (const message of ["Ne coche pas les sous-titres du Studio libre.", "Comment cocher les sous-titres du Studio libre ?", "Si je confirme, coche les sous-titres du Studio libre.", "Le document dit « Coche les sous-titres du Studio libre ». ", "Coche ou décoche les sous-titres du Studio libre."]) assert.equal(isInrAssistantStudioFormSelectionRequested(message, encode("withSubtitles", true)), false, message);
  for (const field of ["identityConsent", "narrationVoiceConsent", "teamConsent"]) assert.equal(parseInrAssistantStudioFormSelection(encode(field, true), free()), null);
});

test("native voice selections bind the requested current photo and acknowledge only its captured ID across reorder removal and account reset", () => {
  let state: InrAssistantStudioFormSnapshot = { ...free(), speechMode: "characters", voiceMode: "ai", voiceReferenceId: "person-a", voiceReferences: [
    { id: "person-a", name: "Alice.png", voiceMode: "ai", referenceIndex: 1 },
    { id: "person-b", name: "Bob.png", voiceMode: "ai", referenceIndex: 3 },
  ] };
  const pending: Array<() => void> = [], modes: Array<{ id: string | null; mode: string }> = [];
  const voiceAction: { current: { encoded: string; targetId: string | null } | null } = { current: null };
  const deps = { quotaLoading: true, voiceAction, isSettingsNavigationApplied: () => true,
    get assistantFormSnapshot() { return state; }, get selectedVoiceReference() { return state.voiceReferences?.find(reference => reference.id === state.voiceReferenceId); },
    parseInrAssistantStudioFormSelection, isInrAssistantStudioFormSelectionApplied,
    setVoiceReferenceId: (id: string) => pending.push(() => { state = { ...state, voiceReferenceId: id, voiceMode: state.voiceReferences?.find(reference => reference.id === id)?.voiceMode }; }),
    chooseVoiceMode: (mode: "ai" | "provided") => { const id = state.voiceReferenceId ?? null; modes.push({ id, mode }); pending.push(() => { state = { ...state, voiceMode: mode, voiceReferences: state.voiceReferences?.map(reference => reference.id === id ? { ...reference, voiceMode: mode } : reference) }; }); },
    generate: () => assert.fail("A voice selection never generates"), upload: () => assert.fail("A voice selection never uploads"), setIdentityConsent: () => assert.fail("A voice selection never grants consent"),
  };
  const native = actualHandlers("app/dashboard/_components/MediaFreeGenerator.tsx", deps, "studio_free_form").select;
  const photo = encode("voiceReferenceId", "reference:3"); native.invoke(photo); assert.equal(native.matches(state, photo), false);
  state.voiceReferences!.reverse(); pending.splice(0).forEach(commit => commit()); assert.equal(state.voiceReferenceId, "person-b"); assert.equal(native.matches(state, photo), true, "the ID captured before render survives a reorder");
  assert.deepEqual(modes, [], "inspecting another person never changes their voice mode");
  const real = encode("voiceMode", "provided"); native.invoke(real); assert.equal(native.matches(state, real), false); pending.splice(0).forEach(commit => commit()); assert.equal(native.matches(state, real), true);
  assert.deepEqual(modes, [{ id: "person-b", mode: "provided" }]); assert.equal(state.voiceReferences!.find(reference => reference.id === "person-a")!.voiceMode, "ai");
  state = { ...state, voiceReferenceId: "person-a", voiceMode: "provided" }; assert.equal(native.matches(state, real), false, "another photo cannot acknowledge a mode change for Bob");
  state = { ...state, voiceReferenceId: "person-b", voiceReferences: state.voiceReferences!.filter(reference => reference.id !== "person-b") }; assert.equal(native.matches(state, real), false);
  voiceAction.current = null; state = { ...state, voiceReferenceId: "new-account-person", voiceReferences: [{ id: "new-account-person", name: "New.png", voiceMode: "provided", referenceIndex: 3 }] };
  assert.equal(native.matches(state, photo), false); assert.equal(native.matches(state, real), false); assert.throws(() => native.invoke(encode("voiceReferenceId", "person-b")), "an old account ID cannot be reused");
});

function actualHandlers(file: string, deps: Record<string, unknown>, interfaceId?: string) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const helpers = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantLocalInterface" && (interfaceId ? node.arguments[0]?.getText(ast) === JSON.stringify(interfaceId) : node.arguments[0]?.getText(ast).includes("studio_"))) expression = node.arguments[2];
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ["isVoiceSelectionApplied", "committedFormSelectionMatches", "aiVoiceSettingsAvailable"].includes(node.name.text)) helpers.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  }; visit(ast); assert.ok(expression);
  if (helpers.size && !Object.hasOwn(deps, "voiceAction")) deps.voiceAction = { current: null };
  for (const name of ["isVoiceSelectionApplied", "committedFormSelectionMatches", "aiVoiceSettingsAvailable"]) {
    const helper = helpers.get(name);
    if (!helper) continue;
    const code = ts.transpileModule(`(${helper.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
    const evaluate = () => vm.runInNewContext(`(function(deps){with(deps){return ${code};}})`)(deps);
    if (name === "aiVoiceSettingsAvailable") Object.defineProperty(deps, name, { configurable: true, get: evaluate });
    else deps[name] = evaluate();
  }
  const compiled = ts.transpileModule(`(${expression.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  return vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps) as Record<string, { invoke: (value: string | null) => void; matches: (snapshot: unknown, value: string | null) => boolean; allowUnmount?: boolean }>;
}

test("the actual automatic duration callback confirms only the committed catalogue pair and never partially changes an unavailable engine", () => {
  let state: InrAssistantStudioFormSnapshot = { ...free(), automaticSceneMode: true, videoEngine: "grok-lite", videoResolution: "720p", durationScene: { seconds: 30, sceneMode: "multi" } };
  const pending: Array<() => void> = [];
  let consentChanges = 0;
  const native = actualHandlers("app/dashboard/_components/MediaFreeGenerator.tsx", {
    get assistantFormSnapshot() { return state; },
    quotaLoading: true,
    durations: Array.from({ length: 27 }, (_, index) => index + 4), selectedVideoEngine: "grok-lite", videoResolution: "720p",
    parseInrAssistantStudioFormSelection, isInrAssistantStudioFormSelectionApplied, canGenerateAiMediaVideoDuration,
    isSettingsNavigationApplied: () => true,
    setDuration: (seconds: number) => pending.push(() => { state = { ...state, durationScene: { seconds, sceneMode: state.durationScene!.sceneMode } }; }),
    setSceneMode: (sceneMode: "single" | "multi") => pending.push(() => { state = { ...state, durationScene: { seconds: state.durationScene!.seconds, sceneMode } }; }),
    resetConsent: () => { consentChanges++; }, generate: () => assert.fail("duration selection cannot generate media"),
  }, "studio_free_form").select;
  const command = encode("durationSeconds", 15);
  assert.equal(native.matches(state, command), false);
  native.invoke(command);
  assert.equal(native.matches(state, command), false, "invocation alone is not a committed change");
  pending.shift()!();
  assert.equal(state.durationScene?.seconds, 15);
  assert.equal(native.matches(state, command), false, "the same duration with the old multi mode cannot acknowledge the command");
  pending.shift()!();
  assert.equal(native.matches(state, command), true);
  assert.deepEqual(state.durationScene, { seconds: 15, sceneMode: "single" });
  for (const patch of [{ videoEngine: "wan3" as const }, { locked: true }]) {
    state = { ...state, ...patch }; const before = JSON.stringify(state);
    assert.throws(() => native.invoke(encode("durationSeconds", 30)), /studio_form_unavailable/);
    assert.equal(pending.length, 0); assert.equal(JSON.stringify(state), before);
    assert.equal(native.matches(state, encode("durationSeconds", 30)), false);
  }
  assert.equal(consentChanges, 0);
});

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
  const deps = { quotaLoading: true, kind: "video", isSettingsNavigationApplied: () => true, get assistantFormSnapshot() { return state; }, durations: [8, 12], selectedVideoEngine: "fixture", videoResolution: "720p", canGenerateAiMediaVideoDuration: () => true,
    parseInrAssistantStudioFormSelection, isInrAssistantStudioFormSelectionApplied, defaultAiMediaNarrationVoiceVariant, resetConsent: () => resets++,
    setPrompt: setter("prompt"), setVoice: setter("narrationVoice"), setVoiceVariant: setter("narrationVoiceVariant"), setSpeechMode: setter("speechMode"), setSpokenScript: setter("spokenScript"), setSpokenScriptOpen: setter("spokenScriptOpen"),
  };
  const native = actualHandlers("app/dashboard/_components/MediaFreeGenerator.tsx", deps).select, prompt = encode("prompt", "Nouveau texte de création");
  native.invoke(prompt); assert.equal(native.matches(state, prompt), false); pending.splice(0).forEach(commit => commit()); assert.equal(native.matches(state, prompt), true);
  const exact = encode("spokenScriptOpen", true), automatic = encode("spokenScriptOpen", false);
  native.invoke(exact); assert.equal(native.matches(state, exact), false); pending.splice(0).forEach(commit => commit()); assert.equal(native.matches(state, exact), true);
  state = { ...state, spokenScript: "Paroles conservées avant le choix explicite" };
  native.invoke(automatic); assert.equal(state.spokenScript, "Paroles conservées avant le choix explicite"); pending.splice(0).forEach(commit => commit());
  assert.equal(native.matches(state, automatic), true); assert.equal(state.spokenScript, ""); assert.equal(resets, 0, "changing the script option cannot grant or reset voice consent");
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
