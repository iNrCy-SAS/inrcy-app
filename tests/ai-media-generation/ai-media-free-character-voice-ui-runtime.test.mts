import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as videoOptions from "../../lib/aiMediaVideoClientOptions.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as narration from "../../lib/aiMediaNarrationVoices.ts";
import * as rules from "../../lib/mediaRules.ts";
import * as voiceRules from "../../lib/aiMediaCharacterVoices.ts";
import * as voiceClient from "../../lib/aiMediaCharacterVoiceClient.ts";
import type { MediaGenerationRequest } from "../../app/dashboard/_hooks/useMediaGeneration.ts";

type Props = Record<string, unknown>;
type Element = { type: unknown; props: Props; key?: string };
type Slot = { value?: unknown; setter?: (value: unknown) => void; deps?: unknown[]; cleanup?: () => void };
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const frenchMessages = JSON.parse(read("messages/fr-FR/media.json")) as Record<string, string>;
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === "object" && "props" in tree ? [tree as Element, ...elements((tree as Element).props.children)] : [];
const find = (tree: unknown, predicate: (node: Element) => boolean) => { const node = elements(tree).find(predicate); assert.ok(node, "Expected real rendered control"); return node; };
const text = (tree: unknown): string => Array.isArray(tree) ? tree.map(text).join("") : typeof tree === "string" || typeof tree === "number" ? String(tree) : tree && typeof tree === "object" && "props" in tree ? text((tree as Element).props.children) : "";

/** Execute the real Free editor, reusable voice input and engine controls; only external IO is mocked. */
function harness(kind: "video" | "image" = "video", initialEngine: models.AiMediaVideoEngine = "omni", sampleDurationSeconds = 2) {
  const parentSlots: Slot[] = []; const childSlots = new Map<string, Slot[]>();
  let slots = parentSlots; let cursor = 0; let dirty = false; let tree!: Element;
  const effects: Array<() => void> = []; const listeners = new Map<string, Set<() => void>>();
  const requests: MediaGenerationRequest[] = []; const quoteInputs: Props[] = []; const deleted: string[] = []; const uploads: FormData[] = [];
  const uploadedSamples: voiceRules.AiMediaCharacterVoiceSample[] = [];
  const sample: voiceRules.AiMediaCharacterVoiceSample = { path: `_studio-voice-references/2026-10-19/account-a__1792404000000__00000000-0000-4000-8000-000000000001.wav`, mimeType: "audio/wav", name: "ma-voix.wav", durationSeconds: sampleDurationSeconds, sizeBytes: sampleDurationSeconds * 32_000 + 44 };
  let uploadReply: (() => void) | undefined; let deferUpload = false;
  const react = {
    useId: () => "real-free-voice",
    useState(initial: unknown) {
      const bank = slots; const index = cursor++; const slot = bank[index] ||= { value: typeof initial === "function" ? (initial as () => unknown)() : initial };
      slot.setter ||= (value: unknown) => { const next = typeof value === "function" ? (value as (previous: unknown) => unknown)(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; } };
      return [slot.value, slot.setter];
    },
    useRef(initial: unknown) { const index = cursor++; return (slots[index] ||= { value: { current: initial } }).value; },
    useCallback(callback: unknown, deps: unknown[]) {
      const slot = slots[cursor++] ||= {};
      if (!slot.deps || slot.deps.length !== deps.length || deps.some((value, at) => value !== slot.deps![at])) {
        slot.deps = deps;
        slot.value = callback;
      }
      return slot.value;
    },
    useEffect(callback: () => void | (() => void), deps: unknown[]) {
      const slot = slots[cursor++] ||= {};
      if (!slot.deps || deps.some((value, at) => value !== slot.deps![at])) {
        slot.deps = deps;
        effects.push(() => { slot.cleanup?.(); slot.cleanup = callback() || undefined; });
      }
    },
    useLayoutEffect(callback: () => void | (() => void), deps: unknown[]) { react.useEffect(callback, deps); },
  };
  const jsx = (type: unknown, props: Props, key?: string): Element => ({ type, props: props || {}, key });
  const css = { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) };
  const quota = { accountId: "account-a", creditsReady: true, studioEnabled: true, unlimited: true, credits: { remaining: 1000 }, videoMaxDurationSeconds: 30 };
  type RecoveredResult = { item: { id: string; media_type: "video" | "image" }; format: MediaGenerationRequest["format"]; recovered: true };
  let failGenerationForRecovery = false; let recoveryFailure = false;
  const recoveredResult: RecoveredResult = { item: { id: "recovered-paid-result", media_type: kind }, format: kind === "video" ? "story" : "square", recovered: true };
  const hook = { quota, quotaLoading: false, busy: false, progress: 0, error: "", result: null as RecoveredResult | null, canRecover: false,
    recoveryContext: null as { kind: "video" | "image"; format: MediaGenerationRequest["format"] } | null,
    loadQuota() {},
    generate: async (request: MediaGenerationRequest): Promise<void> => {
      requests.push(request);
      if (failGenerationForRecovery) { failGenerationForRecovery = false; hook.canRecover = true; hook.recoveryContext = { kind, format: request.format }; throw new Error("A paid generation needs recovery"); }
    },
    retryRecovery: async (): Promise<RecoveredResult> => {
      if (recoveryFailure) throw new Error("Recovery is temporarily unavailable");
      hook.canRecover = false; hook.recoveryContext = null; hook.result = recoveredResult; return recoveredResult;
    },
    cancelRecovery: async (): Promise<null> => {
      if (recoveryFailure) throw new Error("Abandon is temporarily unavailable");
      hook.canRecover = false; hook.recoveryContext = null; return null;
    },
  };
  const preference = { videoEngine: initialEngine, imageEngine: "openai" as models.AiMediaImageEngine, videoResolution: models.getAiMediaVideoModel(initialEngine).defaultResolution, update(patch: Props) { Object.assign(preference, patch); } };
  const modules = new Map<string, unknown>([
    ["react", react], ["react/jsx-runtime", { jsx, jsxs: jsx }],
    ["next-intl", { useLocale: () => "fr-FR", useTranslations: () => (key: string, values?: { credits?: string; provider?: string }) => {
      if (key === "ai_generator_final_authorization_images_label" || key === "ai_generator_final_authorization_voices_label") return frenchMessages[key].replace("{provider}", values?.provider || "");
      if (key === "ai_generator_final_authorization_short" || key === "ai_generator_final_authorization_details") return frenchMessages[key];
      return values?.credits ? `${key} ${values.credits}` : key;
    } }],
    ["@/app/dashboard/_hooks/useMediaGeneration", { __esModule: true, default: () => hook, MediaGenerationAccountChangedError: class extends Error {}, MediaGenerationCancelledError: class extends Error {} }],
    ["@/lib/multicompte/constants", { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" }],
    ["@/lib/aiMediaGenerationContracts", contracts], ["@/lib/aiMediaNarrationVoices", narration], ["@/lib/mediaRules", rules],
    ["@/lib/aiMediaModelCatalog", models], ["@/lib/aiMediaVideoTimeline", timeline], ["@/lib/aiMediaVideoClientOptions", videoOptions],
    ["@/lib/aiMediaCharacterVoices", voiceRules], ["@/lib/aiMediaCharacterVoiceClient", { ...voiceClient, deleteCharacterVoiceSample: async (value: voiceRules.AiMediaCharacterVoiceSample | undefined) => { if (value) deleted.push(value.path); } }],
    ["@/lib/aiMediaCharacterVoiceRecorderClient", { beginCharacterVoiceRecording() { assert.fail("These tests never activate a microphone"); }, CharacterVoiceRecorderUnavailableError: class extends Error {} }],
    ["@/lib/mediaGenerationReferenceClient", { prepareMediaGenerationImageReference: async (file: File) => ({ name: file.name, data: Buffer.from("synthetic-photo").toString("base64"), mimeType: "image/png" }) }],
    ["@/lib/aiMediaModelRecommendation", { recommendAiMediaModel: () => null }],
    ["../_hooks/useMediaEnginePreference", { __esModule: true, default: () => preference }],
    ["../_hooks/useMediaCreditQuote", { __esModule: true, default: (input: Props) => { quoteInputs.push(input); return { ready: true, insufficient: false, authorization: { expectedCredits: 88 }, quote: { totalCredits: 88 } }; } }],
    ["./MediaGenerationCreationWorkspace", { __esModule: true, default: "preview", MediaGenerationSettingsTabs: "settings-tabs" }],
  ]);
  for (const name of ["./MediaLibraryPickerModal", "./MediaSubjectVoiceButton", "./MediaPromptHelp", "./MediaQuotaSummary", "./MediaCharacterVoiceLibraryPicker"]) modules.set(name, { __esModule: true, default: name });
  const browser = { addEventListener(name: string, callback: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); }, removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); }, requestAnimationFrame() { return 1; } };
  const fetch = async (_url: string, init: RequestInit) => {
    uploads.push(init.body as FormData);
    if (deferUpload) await new Promise<void>((resolve) => { uploadReply = resolve; });
    const uploadNumber = uploads.length;
    const uploadedSample = uploadNumber === 1 ? sample : {
      ...sample,
      path: sample.path.replace(/000000000001\.wav$/, `${String(uploadNumber).padStart(12, "0")}.wav`),
      name: `voix-${uploadNumber}.wav`,
    };
    uploadedSamples.push(uploadedSample);
    return Response.json({ ok: true, sample: uploadedSample });
  };
  function load(file: string) {
    const output = ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const record = { exports: {} as { default: (props: Props) => Element } };
    new Function("module", "exports", "require", "window", "fetch", output)(record, record.exports, (id: string) => { if (id.endsWith(".module.css")) return css; assert.ok(modules.has(id), `Unexpected actual Free dependency ${id}`); return modules.get(id); }, browser, fetch);
    return record.exports;
  }
  const voice = load("app/dashboard/_components/MediaCharacterVoiceInput.tsx"); modules.set("./MediaCharacterVoiceInput", { __esModule: true, ...voice });
  const controls = load("app/dashboard/_components/MediaEngineCreditControls.tsx"); modules.set("./MediaEngineCreditControls", { __esModule: true, ...controls });
  const free = load("app/dashboard/_components/MediaFreeGenerator.tsx");
  const props = { source: "studio", acceptMode: "library", mediaType: kind, initialPrompt: "Le personnage présente son métier avec sa voix.", onAccepted() {} };
  const render = () => {
    let count = 0;
    do { assert.ok(++count < 20); slots = parentSlots; cursor = 0; dirty = false; tree = free.default(props); for (const effect of effects.splice(0)) effect(); } while (dirty);
    return tree;
  };
  const renderChild = (id: string, component: { default: (props: Props) => Element }, input: Props) => {
    slots = childSlots.get(id) || []; childSlots.set(id, slots); cursor = 0;
    const child = component.default(input); for (const effect of effects.splice(0)) effect(); slots = parentSlots;
    return child;
  };
  const cards = () => elements(tree).filter((node) => node.props["data-reference-id"]);
  const voiceNode = (index: number) => find(cards()[index], (node) => node.type === voice.default);
  const renderVoice = (index: number) => renderChild(String(cards()[index].props["data-reference-id"]), voice, voiceNode(index).props);
  const flush = async () => { for (let at = 0; at < 5; at++) { await new Promise((resolve) => setImmediate(resolve)); render(); } };
  render();
  return { cards, tree: () => tree, requests, quoteInputs, deleted, uploads, uploadedSamples, sample, render, flush,
    renderVoice,
    renderEngines() { const node = find(tree, (item) => item.type === controls.default); return renderChild("engines", controls, node.props); },
    renderEngineInfo() { const node = find(tree, (item) => item.type === controls.default); let child = renderChild("engines", controls, node.props); (find(child, (item) => item.type === "button" && item.props["aria-haspopup"] === "dialog").props.onClick as () => void)(); child = renderChild("engines", controls, node.props); const info = find(child, (item) => typeof item.type === "function" && item.type.name === "MediaEngineInfoModal"); return renderChild("engine-info", { default: info.type as (props: Props) => Element }, info.props); },
    selectEngine(engine: models.AiMediaVideoEngine, resolution = models.getAiMediaVideoModel(engine).defaultResolution) { const node = find(tree, (item) => item.type === controls.default); const child = renderChild("engines", controls, node.props); const menu = find(child, (item) => item.type === "select" && String(item.props.id).endsWith("-engine")); (menu.props.onChange as (event: unknown) => void)({ target: { value: `${engine}:${resolution}` } }); render(); },
    selectImageEngine(engine: models.AiMediaImageEngine) { const node = find(tree, (item) => item.type === controls.default); const child = renderChild("engines", controls, node.props); const menu = find(child, (item) => item.type === "select" && String(item.props.id).endsWith("-engine")); (menu.props.onChange as (event: unknown) => void)({ target: { value: engine } }); render(); },
    changePreferredVideoEngine(engine: models.AiMediaVideoEngine) { preference.update({ videoEngine: engine, videoResolution: models.getAiMediaVideoModel(engine).defaultResolution }); render(); },
    changePreferredImageEngine(engine: models.AiMediaImageEngine) { preference.update({ imageEngine: engine }); render(); },
    async addPhoto(name = "personnage.png") { const input = find(tree, (node) => node.type === "input" && node.props.type === "file"); (input.props.onChange as (event: unknown) => void)({ currentTarget: { files: [new File(["synthetic-photo"], name, { type: "image/png" })], value: "" }, target: { files: [new File(["synthetic-photo"], name, { type: "image/png" })], value: "" } }); await flush(); },
    criteria(index: number, role: string, usage: string) { const menus = elements(cards()[index]).filter((node) => node.type === "select"); (menus[0].props.onChange as (event: unknown) => void)({ target: { value: role } }); render(); const refreshed = elements(cards()[index]).filter((node) => node.type === "select"); (refreshed[1].props.onChange as (event: unknown) => void)({ target: { value: usage } }); render(); },
    chooseVoice(index: number, mode: "ai" | "provided") { const child = renderVoice(index); (find(child, (node) => node.type === "select").props.onChange as (event: unknown) => void)({ target: { value: mode } }); render(); },
    async uploadVoice(index: number) { const child = renderVoice(index); const input = find(child, (node) => node.type === "input" && node.props.type === "file"); (input.props.onChange as (event: unknown) => void)({ currentTarget: { files: [new File(["wav-voice"], "vocal.wav", { type: "audio/wav" })], value: "" } }); await flush(); },
    consent(checked = true) { const authorization = find(tree, (node) => node.props["data-media-final-authorization"] !== undefined); (find(authorization, (node) => node.type === "input").props.onChange as (event: unknown) => void)({ target: { checked } }); render(); },
    regenerationConsent(checked: boolean) { const consents = find(tree, (node) => node.type === "preview").props.regenerationConsents as Array<{ onChange: (checked: boolean) => void }>; assert.equal(consents.length, 1); consents[0].onChange(checked); render(); },
    failNextGenerationForRecovery() { failGenerationForRecovery = true; },
    setRecoveryFailure(value: boolean) { recoveryFailure = value; },
    editRecovered() { (find(tree, (node) => node.type === "preview").props.handleEditCriteria as () => void)(); render(); },
    async abandonRecovery() { (find(tree, (node) => node.type === "preview").props.handleConfirmGenerationStop as () => void)(); await flush(); },
    removePhoto(index: number) { (find(cards()[index], (node) => node.type === "button").props.onClick as () => void)(); render(); },
    setSound(value: string) { const input = find(tree, (node) => node.type === "input" && node.props.type === "radio" && node.props.value === value); (input.props.onChange as () => void)(); render(); },
    addSpeech() { const button = find(tree, (node) => node.type === "button" && String(node.props.id).endsWith("-add-spoken-script")); if (!button.props.disabled) (button.props.onClick as () => void)(); render(); },
    enterSpeech(value: string) { const input = find(tree, (node) => node.type === "textarea" && String(node.props.id).endsWith("-spoken-script")); assert.equal(input.props.disabled, false); (input.props.onChange as (event: unknown) => void)({ target: { value } }); render(); },
    removeSpeech() { const panel = find(tree, (node) => String(node.props.id).endsWith("-spoken-script-panel")); (find(panel, (node) => node.type === "button").props.onClick as () => void)(); render(); },
    setTab(value: string) { (find(tree, (node) => node.type === "settings-tabs").props.onChange as (value: string) => void)(value); render(); },
    setSubtitles(checked: boolean) { const input = find(tree, (node) => node.props["data-media-subtitles"] !== undefined); if (!input.props.disabled) (input.props.onChange as (event: unknown) => void)({ target: { checked } }); render(); },
    async generate() { const button = find(tree, (node) => node.props["data-media-primary-action"] !== undefined); if (button.props.disabled) return; (button.props.onClick as () => void)(); await flush(); },
    deferVoiceUpload() { deferUpload = true; }, finishVoiceUpload() { uploadReply?.(); },
    changeAccount() { for (const callback of [...listeners.get("account-change") || []]) callback(); render(); },
    dispose() { for (const bank of [parentSlots, ...childSlots.values()]) for (const slot of bank) slot.cleanup?.(); },
  };
}

test("the actual active Free editor shows the real voice selector on video Personne cards for both usages", async () => {
  for (const usage of ["required", "inspiration"]) {
    const h = harness(); await h.addPhoto(); h.criteria(0, "character", usage);
    const selector = find(h.renderVoice(0), (node) => node.type === "select"); assert.equal(selector.props.value, "ai");
    assert.equal(selector.props["aria-label"], "ai_generator_character_voice_label");
    assert.equal(elements(selector).filter((node) => node.type === "option").length, 2);
    assert.equal(elements(h.cards()[0]).filter((node) => node.type === "select").length + elements(h.renderVoice(0)).filter((node) => node.type === "select").length, 3, "Role, usage and voice are the three reference menus");
    assert.equal(find(h.renderVoice(0), (node) => node.type === "label").props.className, "srOnly", "The voice name stays accessible without a separate visible heading");
    h.chooseVoice(0, "provided");
    const directActions = elements(h.renderVoice(0)).filter((node) => node.type === "button").map((node) => node.props.children);
    for (const action of ["import", "record", "library"]) assert.ok(directActions.includes(`ai_generator_character_voice_${action}`));
    assert.equal(directActions.includes("ai_generator_character_voice_upload"), false);
    assert.equal(find(h.tree(), (node) => node.props["data-character-voices"] !== undefined).props["data-character-voices"], "true"); h.dispose();
  }
  const image = harness("image"); await image.addPhoto(); image.criteria(0, "character", "required");
  assert.equal(elements(image.cards()[0]).some((node) => typeof node.type === "function" && String(node.type).includes("MediaCharacterVoiceInput")), false); image.dispose();
});

test("the optional speech editor keeps exact script separate from the brief in both quote and generation", async () => {
  const h = harness();
  const add = find(h.tree(), (node) => node.type === "button" && String(node.props.id).endsWith("-add-spoken-script"));
  assert.equal(add.props["aria-expanded"], false);
  assert.equal(find(h.tree(), (node) => node.props.id === add.props["aria-controls"]).props.hidden, true);
  h.setSound("characters"); h.changePreferredVideoEngine("veo");
  assert.equal(find(h.tree(), (node) => node.props.id === add.props["aria-controls"]).props.hidden, true, "voice and engine choices never open the optional speech editor");
  assert.equal(Object.hasOwn(h.quoteInputs.at(-1)!, "spokenScript"), false);
  h.addSpeech();
  const script = '  Bonjour, je suis Océane.\n« iNrCy », notre application.  ';
  h.enterSpeech(script);
  const input = () => find(h.tree(), (node) => node.type === "textarea" && String(node.props.id).endsWith("-spoken-script"));
  assert.equal(input().props.maxLength, contracts.AI_MEDIA_SPOKEN_SCRIPT_MAX_CHARS);
  assert.equal(h.quoteInputs.at(-1)!.spokenScript, script);
  h.setTab("criteria"); h.setSound("characters"); h.setTab("prompt");
  assert.equal(input().props.value, script, "criteria and speech-mode changes preserve the script");
  await h.generate();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].spokenScript, script);
  assert.equal(h.requests[0].freePrompt, "Le personnage présente son métier avec sa voix.");
  assert.equal(h.requests[0].teamVideoSpeechMode, "characters");
  h.dispose();
});

test("a closed speech editor omits the field while an explicitly opened empty editor sends exact empty speech", async () => {
  for (const script of ["", " \n\t "]) {
    const h = harness();
    assert.equal(Object.hasOwn(h.quoteInputs.at(-1)!, "spokenScript"), false);
    h.addSpeech(); h.enterSpeech(script);
    assert.equal(Object.hasOwn(h.quoteInputs.at(-1)!, "spokenScript"), true);
    assert.equal(h.quoteInputs.at(-1)!.spokenScript, script);
    assert.equal(h.quoteInputs.at(-1)!.withNarration, false);
    assert.equal(h.quoteInputs.at(-1)!.teamVideoSpeechMode, "voiceover");
    assert.equal(h.quoteInputs.at(-1)!.withSubtitles, false);
    await h.generate();
    assert.equal(Object.hasOwn(h.requests[0], "spokenScript"), true);
    assert.equal(h.requests[0].spokenScript, script);
    assert.equal(h.requests[0].withNarration, false);
    assert.equal(h.requests[0].teamVideoSpeechMode, "voiceover");
    assert.equal(h.requests[0].withSubtitles, false);
    h.removeSpeech();
    assert.equal(Object.hasOwn(h.quoteInputs.at(-1)!, "spokenScript"), false);
    h.dispose();
  }
});

test("empty speech temporarily silences the request while retaining the professional’s voice and subtitle choices", () => {
  const h = harness(); h.setSound("characters"); h.setSubtitles(true); h.addSpeech();
  assert.equal(h.quoteInputs.at(-1)!.withSubtitles, false);
  assert.equal(h.quoteInputs.at(-1)!.teamVideoSpeechMode, "voiceover");
  assert.equal(find(h.tree(), (node) => node.type === "input" && node.props.value === "characters").props.checked, true);
  h.enterSpeech("Bienvenue chez nous.");
  assert.equal(h.quoteInputs.at(-1)!.withSubtitles, true);
  assert.equal(h.quoteInputs.at(-1)!.teamVideoSpeechMode, "characters");
  h.enterSpeech("");
  assert.equal(h.quoteInputs.at(-1)!.withSubtitles, false);
  assert.equal(h.quoteInputs.at(-1)!.withNarration, false);
  h.removeSpeech();
  assert.equal(h.quoteInputs.at(-1)!.withSubtitles, true);
  assert.equal(h.quoteInputs.at(-1)!.teamVideoSpeechMode, "characters");
  h.dispose();
});

test("removing speech clears the optional payload and permits no-speech mode without hidden text", async () => {
  const h = harness(); h.addSpeech(); h.enterSpeech("Bonjour, bienvenue chez nous.");
  const silent = () => find(h.tree(), (node) => node.type === "input" && node.props.type === "radio" && node.props.value === "silent");
  assert.equal(silent().props.disabled, true);
  h.setSound("silent");
  assert.equal(silent().props.checked, false, "even a stale event cannot discard active speech");
  assert.equal(h.quoteInputs.at(-1)!.spokenScript, "Bonjour, bienvenue chez nous.");
  h.removeSpeech();
  assert.equal(Object.hasOwn(h.quoteInputs.at(-1)!, "spokenScript"), false);
  h.setSound("silent");
  assert.equal(silent().props.checked, true);
  assert.equal(find(h.tree(), (node) => node.type === "button" && String(node.props.id).endsWith("-add-spoken-script")).props.disabled, true);
  assert.match(text(h.tree()), /ai_generator_spoken_script_silent_help/);
  await h.generate();
  assert.equal(h.requests.length, 1);
  assert.equal(Object.hasOwn(h.requests[0], "spokenScript"), false);
  h.dispose();
});

test("account changes erase speech and image creation never offers or submits it", async () => {
  const h = harness(); h.addSpeech(); h.enterSpeech("Un texte privé du compte A.");
  h.changeAccount();
  assert.equal(Object.hasOwn(h.quoteInputs.at(-1)!, "spokenScript"), false);
  assert.equal(find(h.tree(), (node) => String(node.props.id).endsWith("-spoken-script-panel")).props.hidden, true);
  h.addSpeech();
  assert.equal(find(h.tree(), (node) => node.type === "textarea" && String(node.props.id).endsWith("-spoken-script")).props.value, "");
  h.dispose();
  const image = harness("image");
  assert.equal(elements(image.tree()).some((node) => String(node.props.id).includes("spoken-script")), false);
  assert.equal(Object.hasOwn(image.quoteInputs.at(-1)!, "spokenScript"), false);
  assert.match(text(image.tree()), /ai_generator_free_prompt_help/);
  await image.generate();
  assert.equal(image.requests.length, 1);
  assert.equal(Object.hasOwn(image.requests[0], "spokenScript"), false);
  image.dispose();
});

test("video subtitles default off and the same explicit choice reaches quote and generation", async () => {
  const defaultVideo = harness();
  const control = find(defaultVideo.tree(), (node) => node.props["data-media-subtitles"] !== undefined);
  assert.equal(control.props.type, "checkbox");
  assert.equal(control.props.checked, false);
  assert.equal(control.props.disabled, false);
  assert.equal(defaultVideo.quoteInputs.at(-1)!.withSubtitles, false);
  await defaultVideo.generate();
  assert.equal(defaultVideo.requests[0].withSubtitles, false);
  defaultVideo.dispose();
  for (const mode of ["voiceover", "characters"]) {
    const h = harness(); h.setTab("criteria"); h.setSound(mode); h.setSubtitles(true);
    h.setTab("prompt"); h.setTab("criteria");
    assert.equal(find(h.tree(), (node) => node.props["data-media-subtitles"] !== undefined).props.checked, true);
    assert.equal(h.quoteInputs.at(-1)!.withSubtitles, true);
    await h.generate();
    assert.equal(h.requests[0].withSubtitles, true);
    assert.equal(h.requests[0].teamVideoSpeechMode, mode === "characters" ? "characters" : "voiceover");
    h.dispose();
  }
});

test("silent video disables subtitles without blocking generation; account reset clears the choice and images omit it", async () => {
  const h = harness(); h.setSubtitles(true); h.setSound("silent");
  let control = find(h.tree(), (node) => node.props["data-media-subtitles"] !== undefined);
  assert.equal(control.props.checked, false); assert.equal(control.props.disabled, true);
  assert.equal(h.quoteInputs.at(-1)!.withSubtitles, false);
  await h.generate(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].withSubtitles, false);
  h.setSound("voiceover");
  control = find(h.tree(), (node) => node.props["data-media-subtitles"] !== undefined);
  assert.equal(control.props.checked, true, "returning to speech retains the professional’s subtitle choice");
  h.changeAccount();
  assert.equal(find(h.tree(), (node) => node.props["data-media-subtitles"] !== undefined).props.checked, false);
  assert.equal(h.quoteInputs.at(-1)!.withSubtitles, false); h.dispose();
  const fresh = harness();
  assert.equal(find(fresh.tree(), (node) => node.props["data-media-subtitles"] !== undefined).props.checked, false, "a newly mounted form starts without subtitles"); fresh.dispose();
  const image = harness("image");
  assert.equal(elements(image.tree()).some((node) => node.props["data-media-subtitles"] !== undefined), false);
  assert.equal(Object.hasOwn(image.quoteInputs.at(-1)!, "withSubtitles"), false);
  await image.generate();
  assert.equal(Object.hasOwn(image.requests[0], "withSubtitles"), false); image.dispose();
});

test("the real Free voice import enables only supported engines and aligns quote and payload with inspiration voices", async () => {
  const h = harness(); await h.addPhoto("premier.png"); await h.addPhoto("deuxieme.png");
  h.criteria(0, "character", "inspiration"); h.criteria(1, "character", "required"); h.chooseVoice(0, "provided");
  assert.equal(find(h.tree(), (node) => node.type === "input" && node.props.value === "characters").props.checked, true);
  const quote = h.quoteInputs.at(-1)!; assert.equal(quote.videoEngine, "wan27"); assert.equal(quote.withNarration, false); assert.equal(quote.teamVideoSpeechMode, "characters");
  const engines = h.renderEngines(); const engineMenu = find(engines, (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
  const options = elements(engineMenu).filter((node) => node.type === "option");
  for (const option of options) assert.equal(option.props.disabled, !voiceRules.isAiMediaCharacterVoiceEngine(String(option.props.value).split(":")[0]));
  await h.generate(); assert.equal(h.requests.length, 0, "a selected supplied voice without a vocal cannot generate");
  await h.uploadVoice(0); assert.equal(h.uploads.length, 1); assert.equal(h.uploads[0].get("file") instanceof File, true);
  await h.generate(); assert.equal(h.requests.length, 0, "the real consent checkbox still gates generation");
  h.consent(); await h.generate(); assert.equal(h.requests.length, 1);
  const request = h.requests[0]; assert.equal(request.videoEngine, "wan27"); assert.equal(request.identityConsent, true); assert.equal(request.withNarration, false);
  assert.equal(request.inspirationImages![0].usage, "inspiration"); assert.equal(request.inspirationImages![0].characterIndex, 1); assert.equal(request.inspirationImages![1].characterIndex, 2);
  assert.equal(request.inspirationImages![0].voiceMode, "provided"); assert.equal(request.inspirationImages![0].voiceSample?.path, h.sample.path);
  assert.doesNotMatch(JSON.stringify(request.inspirationImages![0].voiceSample), /base64|blob:|audio\/webm|data:audio/);
  assert.equal("id" in request.inspirationImages![0], false); h.dispose();
});

test("available supplied-voice engines remain selected or can be selected with the corresponding quote and request", async () => {
  for (const engine of voiceRules.AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES.filter(models.isAiMediaVideoEngineAvailable)) {
    const preserved = harness("video", engine); await preserved.addPhoto(); preserved.criteria(0, "character", "inspiration"); preserved.chooseVoice(0, "provided");
    assert.equal(preserved.quoteInputs.at(-1)!.videoEngine, engine, "an already supported preferred engine must be preserved"); preserved.dispose();
    const h = harness(); await h.addPhoto(); h.criteria(0, "character", "inspiration"); h.chooseVoice(0, "provided"); await h.uploadVoice(0);
    h.selectEngine(engine); assert.equal(h.quoteInputs.at(-1)!.videoEngine, engine); assert.equal(h.quoteInputs.at(-1)!.hasProvidedCharacterVoice, true);
    assert.equal(h.quoteInputs.at(-1)!.videoResolution, models.getAiMediaVideoModelForCharacterVoice(engine, true).defaultResolution);
    const menu = find(h.renderEngines(), (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
    assert.equal(String(menu.props.value).split(":")[0], engine);
    h.consent(); await h.generate(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].videoEngine, engine); assert.equal(h.requests[0].teamVideoSpeechMode, "characters");
    assert.equal(h.requests[0].inspirationImages![0].voiceSample?.path, h.sample.path); h.dispose();
  }
});

test("one explicit footer authorization covers two required people and their distinct voices on every supported engine", async () => {
  for (const engine of voiceRules.AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES.filter(models.isAiMediaVideoEngineAvailable)) {
    const h = harness("video", engine);
    await h.addPhoto("moi.png"); await h.addPhoto("mon-epouse.png");
    for (let index = 0; index < 2; index++) {
      h.criteria(index, "character", "required"); h.chooseVoice(index, "provided"); await h.uploadVoice(index);
    }
    assert.equal(h.uploadedSamples.length, 2);
    assert.notEqual(h.uploadedSamples[0].path, h.uploadedSamples[1].path);
    assert.notEqual(h.uploadedSamples[0].name, h.uploadedSamples[1].name);
    assert.equal(h.quoteInputs.at(-1)!.videoEngine, engine); assert.equal(h.quoteInputs.at(-1)!.identityMode, "reference_team");
    assert.ok(h.uploadedSamples.reduce((seconds, voice) => seconds + voice.durationSeconds, 0) <= 15);
    const footer = find(h.tree(), (node) => node.props["data-media-footer"] !== undefined);
    const authorization = find(footer, (node) => node.props["data-media-final-authorization"] !== undefined);
    const providerConsent = find(authorization, (node) => node.type === "label");
    assert.equal(elements(h.tree()).filter((node) => node.type === "label" && node.props.className === "consent").length, 1);
    assert.equal(elements(footer).filter((node) => node.type === "input" && node.props.type === "checkbox").length, 1);
    const criteria = find(h.tree(), (node) => node.type === "section" && String(node.props.id).endsWith("-panel-criteria"));
    assert.equal(elements(criteria).some((node) => node.type === "label" && node.props.className === "consent"), false);
    const tabs = find(h.tree(), (node) => node.type === "settings-tabs").props.tabs as Array<{ id: string; warning: string }>;
    assert.equal(tabs.find((tab) => tab.id === "criteria")!.warning, "", "Missing footer authorization must not point to Criteria");
    assert.equal(find(providerConsent, (node) => node.type === "input").props.checked, false);
    const expectedConsent = `Je confirme que chaque personne représentée est majeure et que je dispose des droits et autorisations pour utiliser son image et sa voix. J’autorise l’envoi des photos et des vocaux fournis à ${models.getAiMediaVideoModelForCharacterVoice(engine, true).providerLabel} pour cette génération.`;
    assert.equal(text(providerConsent), frenchMessages.ai_generator_final_authorization_short);
    assert.equal(find(providerConsent, (node) => node.type === "input").props["aria-label"], expectedConsent);
    assert.ok(text(find(authorization, (node) => node.type === "details")).includes(expectedConsent));
    assert.doesNotMatch(text(authorization), /À cocher pour activer|ai_generator_footer_consent_blocking/);
    assert.doesNotMatch(text(providerConsent), /image de groupe dérivée|dialogues synthétiques/);
    const regenerationConsents = find(h.tree(), (node) => node.type === "preview").props.regenerationConsents as Array<{ id: string; label: string }>;
    assert.equal(regenerationConsents.length, 1); assert.equal(regenerationConsents[0].label, expectedConsent);
    await h.generate(); assert.equal(h.requests.length, 0, "the unique authorization starts unchecked and gates generation");
    h.consent(); h.consent(false); await h.generate(); assert.equal(h.requests.length, 0, "unchecking revokes every consent field");
    h.consent(); await h.generate(); assert.equal(h.requests.length, 1);
    const request = h.requests[0];
    assert.equal(request.videoEngine, engine); assert.equal(request.identityMode, "reference_team"); assert.equal(request.identityConsent, true);
    assert.equal(request.teamVideoProviderConsent, engine); assert.equal(request.teamVideoSpeechMode, "characters"); assert.equal(request.withNarration, false);
    for (const [index, name] of ["moi.png", "mon-epouse.png"].entries()) {
      const reference = request.inspirationImages![index];
      assert.equal(reference.name, name); assert.equal(reference.role, "character"); assert.equal(reference.usage, "required"); assert.equal(reference.characterIndex, index + 1);
      assert.equal(reference.voiceMode, "provided"); assert.equal(reference.voiceSample?.path, h.uploadedSamples[index].path); assert.equal(reference.voiceSample?.name, h.uploadedSamples[index].name);
    }
    h.dispose();
  }
});

test("photo-only authorization is a single footer checkbox with adult, image rights and provider permission", async () => {
  const empty = harness("image");
  assert.equal(elements(empty.tree()).some((node) => node.props["data-media-final-authorization"] !== undefined), false); empty.dispose();
  for (const kind of ["image", "video"] as const) {
    const h = harness(kind, "wan27"); await h.addPhoto(); h.criteria(0, "character", "required");
    const footer = find(h.tree(), (node) => node.props["data-media-footer"] !== undefined);
    const authorization = find(footer, (node) => node.props["data-media-final-authorization"] !== undefined);
    const provider = kind === "video" ? models.getAiMediaVideoModel("wan27").providerLabel : models.getAiMediaImageModel("openai").providerLabel;
    assert.equal(text(find(authorization, (node) => node.type === "label")), frenchMessages.ai_generator_final_authorization_short);
    const expectedConsent = `Je confirme que chaque personne représentée est majeure et que je dispose des droits et autorisations pour utiliser son image. J’autorise l’envoi des photos à ${provider} pour cette génération.`;
    assert.equal(find(authorization, (node) => node.type === "input").props["aria-label"], expectedConsent);
    assert.ok(text(find(authorization, (node) => node.type === "details")).includes(expectedConsent));
    assert.doesNotMatch(text(authorization), /sa voix|vocaux/);
    assert.equal(find(authorization, (node) => node.type === "input").props.checked, false);
    await h.generate(); assert.equal(h.requests.length, 0);
    h.consent(); await h.generate(); assert.equal(h.requests[0].identityConsent, true); assert.equal(h.requests[0].teamVideoProviderConsent, undefined); h.dispose();
  }
});

test("changing photos, voice samples, roles or the effective video/image engine revokes final authorization", async () => {
  const checked = (h: ReturnType<typeof harness>) => find(find(h.tree(), (node) => node.props["data-media-final-authorization"] !== undefined), (node) => node.type === "input").props.checked;
  const h = harness("video", "wan27"); await h.addPhoto("premier.png"); await h.addPhoto("second.png");
  for (let index = 0; index < 2; index++) h.criteria(index, "character", "required");
  h.chooseVoice(0, "provided"); await h.uploadVoice(0); h.consent(); assert.equal(checked(h), true);
  h.selectEngine("wan3"); assert.equal(checked(h), false);
  h.consent(); await h.uploadVoice(0); assert.equal(checked(h), false);
  h.consent(); h.chooseVoice(0, "ai"); assert.equal(checked(h), false);
  h.consent(); h.criteria(1, "character", "inspiration"); assert.equal(checked(h), false);
  h.consent(); await h.addPhoto("decor.png"); assert.equal(checked(h), false);
  h.criteria(2, "environment", "inspiration"); h.consent(); h.removePhoto(2); assert.equal(checked(h), false);
  h.consent(); h.changePreferredVideoEngine("wan27"); assert.equal(checked(h), false, "async preference changes must revoke consent even without a selector event"); h.dispose();
  const image = harness("image"); await image.addPhoto(); image.criteria(0, "character", "required");
  image.consent(); image.selectImageEngine("gemini"); assert.equal(checked(image), false);
  image.consent(); image.changePreferredImageEngine("openai"); assert.equal(checked(image), false); image.dispose();
});

test("regeneration also has one explicit authorization and supplies both existing server consent fields", async () => {
  const h = harness("video", "wan27"); await h.addPhoto("premier.png"); await h.addPhoto("second.png");
  for (let index = 0; index < 2; index++) h.criteria(index, "character", "required");
  h.regenerationConsent(true); await h.generate(); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].identityConsent, true); assert.equal(h.requests[0].teamVideoProviderConsent, "wan27");
  const consents = find(h.tree(), (node) => node.type === "preview").props.regenerationConsents as Array<{ checked: boolean }>;
  assert.equal(consents.length, 1); assert.equal(consents[0].checked, false, "a successful generation requires fresh explicit authorization");
  h.regenerationConsent(false); await h.generate(); assert.equal(h.requests.length, 1); h.dispose();
});

test("a failed recovery keeps its explicit attempt authorization while completed recovery or abandonment revokes it for a new generation", async () => {
  for (const action of ["recover", "abandon"]) {
    const h = harness("video", "wan27"); await h.addPhoto("premier.png"); await h.addPhoto("second.png");
    for (let index = 0; index < 2; index++) h.criteria(index, "character", "required");
    h.consent(); h.failNextGenerationForRecovery(); await h.generate(); assert.equal(h.requests.length, 1);
    const consents = () => find(h.tree(), (node) => node.type === "preview").props.regenerationConsents as Array<{ checked: boolean }>;
    assert.equal(consents()[0].checked, true, "the same uncertain paid attempt retains its explicit authorization");
    h.setRecoveryFailure(true);
    if (action === "recover") await h.generate(); else await h.abandonRecovery();
    assert.equal(consents()[0].checked, true, "an unsuccessful recovery must not lose the retry authorization");
    h.setRecoveryFailure(false);
    if (action === "recover") { await h.generate(); h.editRecovered(); } else await h.abandonRecovery();
    const authorization = find(h.tree(), (node) => node.props["data-media-final-authorization"] !== undefined);
    assert.equal(find(authorization, (node) => node.type === "input").props.checked, false);
    assert.equal(consents()[0].checked, false);
    assert.equal(find(h.tree(), (node) => node.type === "preview").props.disabled, true, "a new generation requires a fresh check");
    assert.equal(h.requests.length, 1, "recovery and abandon never submit a second paid generation"); h.dispose();
  }
});

test("retired HeyGen is absent from regular and supplied-voice menus and their information guide", async () => {
  const h = harness("video", "wan3"); await h.addPhoto(); h.criteria(0, "character", "inspiration"); h.chooseVoice(0, "provided");
  let menu = find(h.renderEngines(), (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
  assert.ok(!elements(menu).some((node) => node.type === "option" && String(node.props.value).startsWith("heygen:")));
  assert.doesNotMatch(text(h.renderEngineInfo()), /HeyGen/i);
  h.chooseVoice(0, "ai"); menu = find(h.renderEngines(), (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
  assert.ok(!elements(menu).some((node) => node.type === "option" && String(node.props.value).startsWith("heygen:")));
  assert.doesNotMatch(text(h.renderEngineInfo()), /HeyGen/i); h.dispose();
});

test("Wan 3 blocks over fifteen seconds of samples without discarding them or changing the selected engine", async () => {
  const h = harness("video", "wan3", 8); await h.addPhoto("premier.png"); await h.addPhoto("deuxieme.png");
  for (let index = 0; index < 2; index++) { h.criteria(index, "character", "inspiration"); h.chooseVoice(index, "provided"); await h.uploadVoice(index); }
  assert.equal(h.quoteInputs.at(-1)!.videoEngine, "wan3");
  const menu = find(h.renderEngines(), (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
  for (const quality of ["720p", "1080p"]) assert.equal(find(menu, (node) => node.type === "option" && node.props.value === `wan3:${quality}`).props.disabled, true);
  assert.ok(text(h.tree()).includes("ai_generator_character_voice_wan3_duration_limit")); h.consent(); await h.generate(); assert.equal(h.requests.length, 0);
  h.selectEngine("wan27"); h.consent(); await h.generate(); assert.equal(h.requests[0].videoEngine, "wan27");
  assert.equal(h.requests[0].inspirationImages!.filter((image) => image.voiceSample).length, 2); h.dispose();
});

test("voice Inspiration alone requires permission but retains identity auto, and incompatible sound cannot silently discard it", async () => {
  const h = harness(); await h.addPhoto(); h.criteria(0, "character", "inspiration"); h.chooseVoice(0, "provided"); await h.uploadVoice(0);
  assert.equal(h.quoteInputs.at(-1)!.identityMode, "auto"); assert.match(text(h.tree()), /son image et sa voix/);
  h.consent(); h.setSound("silent"); await h.generate(); assert.equal(h.requests.length, 0); assert.ok(text(h.tree()).includes("ai_generator_character_voice_speech_required"));
  h.setSound("characters"); h.consent(); await h.generate(); assert.equal(h.requests[0].identityMode, "auto"); assert.equal(h.requests[0].identityConsent, true); h.dispose();
});

test("switching back to AI restores regular engines, and pending voice uploads lock the actual Free editor and clear on account change", async () => {
  const h = harness(); await h.addPhoto(); h.criteria(0, "character", "inspiration"); h.chooseVoice(0, "provided"); await h.uploadVoice(0); h.chooseVoice(0, "ai");
  assert.equal(h.quoteInputs.at(-1)!.videoEngine, "omni"); assert.deepEqual(h.deleted, [h.sample.path]);
  h.chooseVoice(0, "provided"); h.deferVoiceUpload(); const pending = h.uploadVoice(0); await h.flush();
  assert.equal(find(h.tree(), (node) => node.type === "textarea").props.disabled, true);
  h.changeAccount(); assert.equal(h.cards().length, 0); h.finishVoiceUpload(); await pending;
  assert.equal(h.cards().length, 0); assert.equal(h.requests.length, 0); h.dispose();
});
