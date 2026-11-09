import * as inspirationImagePolicy from "../../lib/studioInspirationImagePolicy.ts";
import assert from "node:assert/strict";
import * as studioForm from "../../lib/inrAssistantStudioFormSelection.ts";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as videoOptions from "../../lib/aiMediaVideoClientOptions.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as speechBudget from "../../lib/aiMediaVideoSpeechBudget.ts";
import * as narration from "../../lib/aiMediaNarrationVoices.ts";
import * as rules from "../../lib/mediaRules.ts";
import * as voiceRules from "../../lib/aiMediaCharacterVoices.ts";
import * as voiceClient from "../../lib/aiMediaCharacterVoiceClient.ts";
import * as soundtracks from "../../lib/mediaSoundtrackSelection.ts";
import { quoteAiMediaCredits, type AiMediaCreditsQuoteInput } from "../../lib/aiMediaCreditsPricing.ts";
import type { MediaGenerationRequest } from "../../app/dashboard/_hooks/useMediaGeneration.ts";

type Props = Record<string, unknown>;
type Element = { type: unknown; props: Props; key?: string };
type Slot = { value?: unknown; setter?: (value: unknown) => void; deps?: unknown[]; cleanup?: () => void };
type NativeEntry = { snapshot: Props; handlers: Record<string, { invoke(value: string | null): unknown; matches(snapshot: unknown, value: string | null): boolean }>; enabled: boolean; locked: boolean };
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const frenchMessages = JSON.parse(read("messages/fr-FR/media.json")) as Record<string, string>;
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === "object" && "props" in tree ? [tree as Element, ...elements((tree as Element).props.children)] : [];
const find = (tree: unknown, predicate: (node: Element) => boolean) => { const node = elements(tree).find(predicate); assert.ok(node, "Expected real rendered control"); return node; };
const text = (tree: unknown): string => Array.isArray(tree) ? tree.map(text).join("") : typeof tree === "string" || typeof tree === "number" ? String(tree) : tree && typeof tree === "object" && "props" in tree ? text((tree as Element).props.children) : "";

/** Execute the real Free editor, reusable voice input and engine controls; only external IO is mocked. */
function harness(kind: "video" | "image" = "video", initialEngine: models.AiMediaVideoEngine = "omni", sampleDurationSeconds = 2, options: { initialPrompt?: string; locale?: string; realEnginePreference?: boolean } = {}) {
  const parentSlots: Slot[] = []; const childSlots = new Map<string, Slot[]>();
  let slots = parentSlots; let cursor = 0; let dirty = false; let tree!: Element;
  const effects: Array<() => void> = []; const listeners = new Map<string, Set<() => void>>();
  const requests: MediaGenerationRequest[] = []; const quoteInputs: Props[] = []; const deleted: string[] = []; const uploads: FormData[] = [];
  const uploadedSamples: voiceRules.AiMediaCharacterVoiceSample[] = [];
  const sample: voiceRules.AiMediaCharacterVoiceSample = { path: `_studio-voice-references/2026-10-19/account-a__1792404000000__00000000-0000-4000-8000-000000000001.wav`, mimeType: "audio/wav", name: "ma-voix.wav", durationSeconds: sampleDurationSeconds, sizeBytes: sampleDurationSeconds * 32_000 + 44 };
  let uploadReply: (() => void) | undefined; let deferUpload = false; let voiceUploadError = false;
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
  const hook = { quota, quotaLoading: false, busy: false, progress: 0, error: "", result: null as RecoveredResult | null, canRecover: false, recovering: false, canPauseRecovery: false,
    recoveryContext: null as { kind: "video" | "image"; format: MediaGenerationRequest["format"] } | null,
    loadQuota() {},
    pauseRecovery() { if (!hook.canPauseRecovery) return false; hook.busy = false; hook.recovering = false; hook.canPauseRecovery = false; hook.canRecover = true; return true; },
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
  const preferenceKey = "inrcy:media-engines:v1:account-a";
  const storedPreferences = new Map([[preferenceKey, JSON.stringify({ videoEngine: initialEngine, imageEngine: preference.imageEngine, videoResolution: preference.videoResolution })]]);
  const localStorage = { getItem: (key: string) => storedPreferences.get(key) ?? null, setItem: (key: string, value: string) => { storedPreferences.set(key, value); } };
  const interfaces = new Map<string, Props>(), nativeEntries = new Map<string, NativeEntry>();
  const modules = new Map<string, unknown>([
    ["../_hooks/useInrAssistantLocalInterface", { useInrAssistantLocalInterface(id: string, snapshot: Props, handlers: NativeEntry["handlers"], enabled = true, locked = false) { interfaces.set(id, snapshot); nativeEntries.set(id, { snapshot, handlers, enabled, locked }); } }],
    ["@/lib/inrAssistantStudioFormSelection", studioForm],
    ["react", react], ["react/jsx-runtime", { jsx, jsxs: jsx }],
    ["react-dom", { createPortal: (content: Element) => content }],
    ["next-intl", { useLocale: () => options.locale || "fr-FR", useTranslations: () => (key: string, values?: Record<string, string | number>) => {
      if (key.startsWith("ai_generator_video_") || key === "ai_generator_character_voice_engine_required" || key === "ai_generator_character_voice_kling_reference_limits") return (frenchMessages[key] || key).replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
      if (key === "ai_generator_final_authorization_images_label" || key === "ai_generator_final_authorization_voices_label") return frenchMessages[key].replace("{provider}", String(values?.provider || ""));
      if (key === "ai_generator_final_authorization_short" || key === "ai_generator_final_authorization_details") return frenchMessages[key];
      return values?.credits ? `${key} ${values.credits}` : key;
    } }],
    ["@/app/dashboard/_hooks/useMediaGeneration", { __esModule: true, default: () => hook, MediaGenerationAccountChangedError: class extends Error {}, MediaGenerationCancelledError: class extends Error {} }],
    ["@/lib/multicompte/constants", { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" }],
    ["@/lib/aiMediaGenerationContracts", contracts], ["@/lib/aiMediaNarrationVoices", narration], ["@/lib/mediaRules", rules],
    ["@/lib/aiMediaVideoSpeechBudget", speechBudget],
    ["@/lib/aiMediaModelCatalog", models], ["@/lib/aiMediaVideoTimeline", timeline], ["@/lib/aiMediaVideoClientOptions", videoOptions],
    ["@/lib/aiMediaCharacterVoices", voiceRules], ["@/lib/aiMediaCharacterVoiceClient", { ...voiceClient, deleteCharacterVoiceSample: async (value: voiceRules.AiMediaCharacterVoiceSample | undefined) => { if (value) deleted.push(value.path); } }],
    ["@/lib/mediaSoundtrackSelection", soundtracks],
    ["@/lib/aiMediaCharacterVoiceRecorderClient", { beginCharacterVoiceRecording() { assert.fail("These tests never activate a microphone"); }, CharacterVoiceRecorderUnavailableError: class extends Error {} }],
    ["@/lib/mediaGenerationReferenceClient", { prepareMediaGenerationImageReference: async (file: File) => ({ name: file.name, data: Buffer.from("synthetic-photo").toString("base64"), mimeType: "image/png" }) }],
    ["@/lib/aiMediaModelRecommendation", { recommendAiMediaModel: () => null }],
    ["../_hooks/useMediaEnginePreference", { __esModule: true, default: () => preference }],
    ["../_hooks/useMediaCreditQuote", { __esModule: true, default: (input: Props, _quota: unknown, enabled: boolean) => { quoteInputs.push({ ...input, enabled }); const quote = options.realEnginePreference ? quoteAiMediaCredits(input as AiMediaCreditsQuoteInput) : { totalCredits: 88 }; return { ready: true, insufficient: false, authorization: { expectedCredits: quote.totalCredits }, quote }; } }],
    ["./MediaGenerationCreationWorkspace", { __esModule: true, default: "preview", MediaGenerationSettingsTabs: "settings-tabs" }],
  ]);
  for (const name of ["./MediaLibraryPickerModal", "./MediaSubjectVoiceButton", "./MediaPromptHelp", "./MediaBusinessDnaHelp", "./MediaQuotaSummary", "./MediaCharacterVoiceLibraryPicker"]) modules.set(name, { __esModule: true, default: name });
  class FakeElement { isConnected = true; focus() { document.activeElement = this; } click() {} pause() {} showModal() {} close() {} getBoundingClientRect() { return { left: 0, top: 0, right: 560, bottom: 560 }; } }
  const document = { body: {}, activeElement: null as FakeElement | null };
  const commitRefs = (child: Element) => { for (const node of elements(child)) if (typeof node.type === "string" && node.props.ref && typeof node.props.ref === "object") { const ref = node.props.ref as { current: unknown }; ref.current ||= new FakeElement(); } };
  const browser = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener(name: string, callback: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); }, removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); }, requestAnimationFrame() { return 1; }, setTimeout, clearTimeout };
  let musicCatalogueMode: "ready" | "error" = "ready", musicCatalogueCalls = 0, musicPauses = 0, musicPlaybackDeferred = false;
  let finishMusicPlayback: (() => void) | undefined, musicAudioRef: { current: unknown } | undefined;
  const musicPlays: string[] = [];
  const musicTracks = ["piano-serein", "guitare-solaire"].map(id => ({ id, label: id, description: "Extrait local de test", durationSeconds: 24, audioPreview: `/api/booster/soundtracks/${id}/preview?v=24` }));
  const musicAudio = { paused: true, src: "", pause() { musicPauses++; this.paused = true; }, removeAttribute(name: string) { assert.equal(name, "src"); this.src = ""; }, load() {},
    play() { this.paused = false; musicPlays.push(this.src); return musicPlaybackDeferred ? new Promise<void>(resolve => { finishMusicPlayback = resolve; }) : Promise.resolve(); } };
  const fetch = async (_url: string, init: RequestInit = {}) => {
    if (_url === "/api/booster/soundtracks") { musicCatalogueCalls++; assert.equal(init.credentials, "same-origin"); return musicCatalogueMode === "error" ? Response.json({}, { status: 503 }) : Response.json({ ok: true, soundtracks: musicTracks }); }
    uploads.push(init.body as FormData);
    if (deferUpload) await new Promise<void>((resolve) => { uploadReply = resolve; });
    if (voiceUploadError) return Response.json({ ok: false, message: "Le vocal n’a pas pu être importé." }, { status: 503 });
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
    new Function("module", "exports", "require", "window", "fetch", "localStorage", "document", "HTMLElement", "ResizeObserver", output)(record, record.exports, (id: string) => { if (id === "@/lib/studioInspirationImagePolicy") return inspirationImagePolicy; if (id.endsWith(".module.css")) return css; assert.ok(modules.has(id), `Unexpected actual Free dependency ${id}`); return modules.get(id); }, browser, fetch, localStorage, document, FakeElement, class { observe() {} disconnect() {} });
    return record.exports;
  }
  const voice = load("app/dashboard/_components/MediaCharacterVoiceInput.tsx"); modules.set("./MediaCharacterVoiceInput", { __esModule: true, ...voice });
  const music = load("app/dashboard/_components/StudioMusicLibrary.tsx"); modules.set("./StudioMusicLibrary", { __esModule: true, ...music });
  const pool = load("app/dashboard/_components/StudioVoicePool.tsx"); modules.set("./StudioVoicePool", { __esModule: true, ...pool });
  const controls = load("app/dashboard/_components/MediaEngineCreditControls.tsx"); modules.set("./MediaEngineCreditControls", { __esModule: true, ...controls });
  if (options.realEnginePreference) modules.set("../_hooks/useMediaEnginePreference", { __esModule: true, ...load("app/dashboard/_hooks/useMediaEnginePreference.ts") });
  const free = load("app/dashboard/_components/MediaFreeGenerator.tsx");
  const props = { source: "studio", acceptMode: "library", mediaType: kind, initialPrompt: options.initialPrompt ?? "Le personnage présente son métier avec sa voix.", onAccepted() {} };
  const render = () => {
    let count = 0;
    do { assert.ok(++count < 20); slots = parentSlots; cursor = 0; dirty = false; tree = free.default(props); if (kind === "video") renderPool(); for (const effect of effects.splice(0)) effect(); } while (dirty);
    return tree;
  };
  const renderChild = (id: string, component: { default: (props: Props) => Element }, input: Props, commit?: (child: Element) => void) => {
    slots = childSlots.get(id) || []; childSlots.set(id, slots); cursor = 0;
    const child = component.default(input); commit?.(child); for (const effect of effects.splice(0)) effect(); slots = parentSlots;
    return child;
  };
  const currentVideoDialog = () => elements(tree).find(node => typeof node.type === "function" && node.type.name === "MediaSettingsDialog");
  const closeSettings = () => { const dialog = currentVideoDialog(); if (dialog) { assert.equal(dialog.props.closeBlocked, false); (dialog.props.onClose as () => void)(); render(); } };
  const openSettings = (name: "images" | "audio") => {
    if (currentVideoDialog()?.props.kind === name) return;
    assert.ok(kind === "video" || name === "images", "image creation has no audio dialog");
    closeSettings();
    const button = find(tree, node => name === "images" ? node.props["data-media-role-add"] === "inspiration" : node.props["data-video-audio-button"] !== undefined);
    assert.equal(button.props.disabled, false); (button.props.onClick as () => void)(); render();
    assert.equal(currentVideoDialog()?.props.kind, name, "the real native launcher opens the requested settings dialog");
  };
  const cards = () => {
    if (nativeEntries.get("studio_voice_pool")?.snapshot.open) closePool();
    let rendered = elements(tree).filter(node => node.props["data-reference-id"]);
    if (rendered.length) return rendered;
    closeSettings();
    const thumbnail = elements(tree).find(node => node.props["data-media-reference-open"] !== undefined);
    if (!thumbnail) return [];
    assert.equal(thumbnail.props.disabled, false); (thumbnail.props.onClick as () => void)(); render();
    rendered = elements(tree).filter(node => node.props["data-reference-id"]);
    return rendered;
  };
  let poolTree: Element, voiceTree: Element;
  const renderPool = () => {
    const node = find(tree, item => item.type === pool.default);
    poolTree = renderChild("pool", pool, node.props, commitRefs);
    const child = elements(poolTree).find(item => item.type === voice.default);
    if (child) voiceTree = renderChild("pool-voice", voice, child.props, commitRefs);
    return poolTree;
  };
  const closePool = () => { const dialog = find(poolTree, node => node.type === "dialog"); (dialog.props.onCancel as (event: unknown) => void)({ preventDefault() {}, stopPropagation() {} }); render(); };
  const selectVoicePerson = (referenceId: string) => {
    if (nativeEntries.get("studio_voice_pool")?.snapshot.open) closePool();
    closeSettings();
    const audio = find(tree, node => node.type === "select" && String(node.props.id).endsWith("-video-speech-mode"));
    if (audio.props.value !== "characters") { (audio.props.onChange as (event: unknown) => void)({ target: { value: "characters" } }); render(); }
    const select = nativeEntries.get("studio_free_form")!.handlers.select;
    select.invoke(JSON.stringify({ field: "voiceReferenceId", value: referenceId })); render();
    closeSettings();
  };
  const chooseMainVoice = (mode: "ai" | "provided") => {
    if (nativeEntries.get("studio_voice_pool")?.snapshot.open) closePool();
    closeSettings(); const select = find(tree, node => node.type === "select" && String(node.props.id).endsWith("-video-voice-mode"));
    assert.equal(select.props.disabled, false); (select.props.onChange as (event: unknown) => void)({ target: { value: mode } }); render();
  };
  const renderVoice = (index: number) => {
    const referenceId = String(cards()[index].props["data-reference-id"]);
    selectVoicePerson(referenceId);
    const snapshot = nativeEntries.get("studio_voice_pool")!.snapshot as Props & { profiles: Array<{ id: string; target: { characterId: string } | string | null }> };
    const profile = snapshot.profiles.find(profile => profile.target && typeof profile.target === "object" && profile.target.characterId === referenceId);
    if (profile) { const button = find(poolTree, node => node.props["data-voice-profile"] === profile.id); (button.props.onClick as () => void)(); render(); }
    else { chooseMainVoice("provided"); const button = find(poolTree, node => node.props["data-voice-pool-settings"] !== undefined); assert.equal(button.props.disabled, false); (button.props.onClick as () => void)(); render(); if (nativeEntries.get("studio_voice_pool")!.snapshot.editingId) { const add = find(poolTree, node => node.props["data-voice-pool-add"] !== undefined); (add.props.onClick as () => void)(); render(); } }
    return voiceTree;
  };
  const flush = async () => { for (let at = 0; at < 5; at++) { await new Promise((resolve) => setImmediate(resolve)); render(); } };
  const renderMusic = () => {
    const node = find(tree, item => item.type === music.default);
    return renderChild("music", music, node.props, child => {
      const audio = elements(child).find(item => item.type === "audio");
      if (audio) { musicAudioRef = audio.props.ref as { current: unknown }; musicAudioRef.current = musicAudio; }
      else if (musicAudioRef) musicAudioRef.current = null;
    });
  };
  const flushMusic = async () => { for (let at = 0; at < 5; at++) { await new Promise(resolve => setImmediate(resolve)); render(); renderMusic(); } };
  const beginReferenceAddition = (role: string) => {
    if (nativeEntries.get("studio_voice_pool")?.snapshot.open) closePool();
    closeSettings(); const launcher = find(tree, node => node.props["data-media-role-add"] === role);
    assert.equal(launcher.props.disabled, false); (launcher.props.onClick as () => void)(); render();
    assert.equal(interfaces.get("studio_media_images")?.pendingReferenceRole, role, "the native role launcher captures the import role");
    assert.equal(elements(tree).some(node => node.props["data-reference-add-role"] !== undefined), false, "adding from a role icon does not ask for the role a second time");
  };
  const selectReferenceFiles = async (files: File[]) => {
    const input = find(tree, node => node.type === "input" && node.props.type === "file");
    (input.props.onClick as (() => void) | undefined)?.();
    (input.props.onChange as (event: unknown) => void)({ currentTarget: { files, value: "" }, target: { files, value: "" } });
    await flush();
  };
  render();
  return { cards, tree: () => tree, requests, quoteInputs, deleted, uploads, uploadedSamples, sample, render, flush,
    renderMusic, flushMusic, musicTracks, musicPlays, musicAudio,
    musicNative() { renderMusic(); return nativeEntries.get("studio_video_music")!; },
    musicReads: () => musicCatalogueCalls, musicPauseCount: () => musicPauses,
    setMusicCatalogue(mode: "ready" | "error") { musicCatalogueMode = mode; },
    setMusicLocked(locked: boolean) { hook.busy = locked; render(); renderMusic(); },
    changeMusicAccount(id: string) { quota.accountId = id; for (const callback of [...listeners.get("account-change") || []]) callback(); render(); renderMusic(); },
    deferMusicPlay() { musicPlaybackDeferred = true; }, finishMusicPlay() { finishMusicPlayback?.(); musicPlaybackDeferred = false; },
    mountedInterfaces: () => [...nativeEntries.keys()],
    storedEnginePreference: () => JSON.parse(localStorage.getItem(preferenceKey) || "null") as Props,
    renderVoice, poolTree: () => poolTree, voiceTree: () => voiceTree, closePool,
    poolNative: () => nativeEntries.get("studio_voice_pool")!,
    formNative: () => nativeEntries.get("studio_free_form")!,
    audioNative: () => nativeEntries.get("studio_video_audio")!,
    setVoiceUploadError(value: boolean) { voiceUploadError = value; },
    beginVocalImport() { chooseMainVoice("provided"); const button = find(poolTree, node => node.props["data-voice-pool-settings"] !== undefined); assert.equal(button.props.disabled, false); (button.props.onClick as () => void)(); render(); if (nativeEntries.get("studio_voice_pool")!.snapshot.editingId) { const add = find(poolTree, node => node.props["data-voice-pool-add"] !== undefined); (add.props.onClick as () => void)(); render(); } },
    async selectVocalFile(file: File) { const input = find(voiceTree, node => node.type === "input" && node.props.type === "file"); (input.props.onChange as (event: unknown) => void)({ currentTarget: { files: [file], value: "" } }); await flush(); },
    reverseProfiles() { const component = find(tree, node => node.type === pool.default); (component.props.onChange as (profiles: unknown[]) => void)([...(component.props.profiles as unknown[])].reverse()); render(); },
    setLocked(locked: boolean) { hook.busy = locked; render(); },
    removePoolVocal() { const remove = find(voiceTree, node => node.type === "button" && node.props["aria-label"] === "ai_generator_character_voice_remove"); assert.equal(remove.props.disabled, false); (remove.props.onClick as () => void)(); render(); },
    async importNarrator() { chooseMainVoice("provided"); const button = find(poolTree, node => node.props["data-voice-pool-settings"] !== undefined); assert.equal(button.props.disabled, false); (button.props.onClick as () => void)(); render(); if (nativeEntries.get("studio_voice_pool")!.snapshot.editingId) { const add = find(poolTree, node => node.props["data-voice-pool-add"] !== undefined); (add.props.onClick as () => void)(); render(); } const input = find(voiceTree, node => node.type === "input" && node.props.type === "file"); (input.props.onChange as (event: unknown) => void)({ currentTarget: { files: [new File(["wav-voice"], "narration.wav", { type: "audio/wav" })], value: "" } }); await flush(); },
    narrationConsent(checked = true) { const input = find(poolTree, node => node.type === "input" && node.props.type === "checkbox"); (input.props.onChange as (event: unknown) => void)({ target: { checked } }); render(); },
    renderEngines() { const node = find(tree, (item) => item.type === controls.default); return renderChild("engines", controls, node.props); },
    renderEngineInfo() { const node = find(tree, (item) => item.type === controls.default); let child = renderChild("engines", controls, node.props); (find(child, (item) => item.type === "button" && item.props["aria-haspopup"] === "dialog").props.onClick as () => void)(); child = renderChild("engines", controls, node.props); const info = find(child, (item) => typeof item.type === "function" && item.type.name === "MediaEngineInfoModal"); return renderChild("engine-info", { default: info.type as (props: Props) => Element }, info.props); },
    selectEngine(engine: models.AiMediaVideoEngine, resolution = models.getAiMediaVideoModel(engine).defaultResolution) { const node = find(tree, (item) => item.type === controls.default); const child = renderChild("engines", controls, node.props); const menu = find(child, (item) => item.type === "select" && String(item.props.id).endsWith("-engine")); (menu.props.onChange as (event: unknown) => void)({ target: { value: `${engine}:${resolution}` } }); render(); },
    selectImageEngine(engine: models.AiMediaImageEngine) { const node = find(tree, (item) => item.type === controls.default); const child = renderChild("engines", controls, node.props); const menu = find(child, (item) => item.type === "select" && String(item.props.id).endsWith("-engine")); (menu.props.onChange as (event: unknown) => void)({ target: { value: engine } }); render(); },
    changePreferredVideoEngine(engine: models.AiMediaVideoEngine) { preference.update({ videoEngine: engine, videoResolution: models.getAiMediaVideoModel(engine).defaultResolution }); render(); },
    changePreferredImageEngine(engine: models.AiMediaImageEngine) { preference.update({ imageEngine: engine }); render(); },
    openAudioSettings: () => openSettings("audio"), closeSettings,
    beginReferenceAddition, selectReferenceFiles,
    async addPhoto(name = "personnage.png", role = "inspiration") { beginReferenceAddition(role); await selectReferenceFiles([new File(["synthetic-photo"], name, { type: "image/png" })]); assert.equal(currentVideoDialog(), undefined, "only a successful import closes the add chooser"); },
    criteria(index: number, role: string, usage: string) { const menu = find(cards()[index], node => node.type === "select"); (menu.props.onChange as (event: unknown) => void)({ target: { value: role } }); render(); const toggle = find(cards()[index], node => node.props["data-reference-inspiration-toggle"] !== undefined); if (toggle.props["aria-pressed"] !== (usage === "inspiration")) (toggle.props.onClick as () => void)(); render(); },
    chooseVoice(index: number, mode: "ai" | "provided") { const id = String(cards()[index].props["data-reference-id"]); selectVoicePerson(id); chooseMainVoice(mode); },
    chooseMainVoice,
    voiceSnapshot: () => interfaces.get("studio_free_form") as Props & { voiceReferences: Array<{ id: string; name: string; voiceMode: string; referenceIndex: number }>; voiceMode: string; spokenScriptOpen: boolean; spokenScript: string },
    selectVoicePerson,
    async uploadVoice(index: number) { const child = renderVoice(index); const input = find(child, (node) => node.type === "input" && node.props.type === "file"); (input.props.onChange as (event: unknown) => void)({ currentTarget: { files: [new File(["wav-voice"], "vocal.wav", { type: "audio/wav" })], value: "" } }); await flush(); },
    consent(checked = true) { const authorization = find(tree, (node) => node.props["data-media-final-authorization"] !== undefined); (find(authorization, (node) => node.type === "input").props.onChange as (event: unknown) => void)({ target: { checked } }); render(); },
    regenerationConsent(checked: boolean) { const consents = find(tree, (node) => node.type === "preview").props.regenerationConsents as Array<{ onChange: (checked: boolean) => void }>; assert.equal(consents.length, 1); consents[0].onChange(checked); render(); },
    failNextGenerationForRecovery() { failGenerationForRecovery = true; },
    beginRecoveryChecking() { hook.busy = true; hook.recovering = true; hook.canRecover = true; hook.canPauseRecovery = true; hook.recoveryContext = { kind, format: "story" }; render(); },
    pauseRecoveryChecking() { (find(tree, node => node.type === "preview").props.handlePauseRecovery as () => void)(); render(); },
    clearRecoveryState() { hook.busy = false; hook.recovering = false; hook.canRecover = false; hook.canPauseRecovery = false; hook.recoveryContext = null; render(); },
    setRecoveryFailure(value: boolean) { recoveryFailure = value; },
    editRecovered() { (find(tree, (node) => node.type === "preview").props.handleEditCriteria as () => void)(); render(); },
    async abandonRecovery() { (find(tree, (node) => node.type === "preview").props.handleConfirmGenerationStop as () => void)(); await flush(); },
    removePhoto(index: number) { (find(cards()[index], (node) => node.type === "button").props.onClick as () => void)(); render(); },
    setSound(value: string) { const audioWasOpen = currentVideoDialog()?.props.kind === "audio"; closeSettings(); const select = find(tree, node => node.type === "select" && String(node.props.id).endsWith("-video-speech-mode")); (select.props.onChange as (event: unknown) => void)({ target: { value } }); render(); const settings = elements(tree).find(node => node.props["data-video-audio-button"] !== undefined); if (audioWasOpen && settings && !settings.props.disabled) openSettings("audio"); },
    enterPrompt(value: string) { const input = find(tree, (node) => node.type === "textarea" && String(node.props.id).endsWith("-prompt")); (input.props.onChange as (event: unknown) => void)({ target: { value } }); render(); },
    setDuration(seconds: number, mode: "single" | "multi" = "single") { const node = find(tree, (item) => item.type === controls.default); (node.props.onDurationSceneChange as (seconds: number, mode: string) => void)(seconds, mode); render(); },
    async invokeGenerateCallback() { await (find(tree, node => node.type === "preview").props.handleGenerate as () => Promise<void>)(); await flush(); },
    addSpeech() { const menu = find(tree, (node) => node.type === "select" && String(node.props.id).endsWith("-spoken-script-mode")); if (!menu.props.disabled) (menu.props.onChange as (event: unknown) => void)({ target: { value: "exact" } }); render(); },
    enterSpeech(value: string) {
      if (!elements(tree).some(node => node.type === "textarea" && String(node.props.id).endsWith("-spoken-script"))) {
        const menu = find(tree, node => node.type === "select" && String(node.props.id).endsWith("-spoken-script-mode"));
        assert.equal(menu.props.disabled, false);
        (menu.props.onChange as (event: unknown) => void)({ target: { value: "exact" } }); render();
      }
      const input = find(tree, (node) => node.type === "textarea" && String(node.props.id).endsWith("-spoken-script")); assert.equal(input.props.disabled, false); (input.props.onChange as (event: unknown) => void)({ target: { value } }); render();
    },
    removeSpeech() { const menu = find(tree, (node) => node.type === "select" && String(node.props.id).endsWith("-spoken-script-mode")); (menu.props.onChange as (event: unknown) => void)({ target: { value: "automatic" } }); render(); },
    setSubtitles(checked: boolean) { const input = find(tree, (node) => node.props["data-media-subtitles"] !== undefined); if (!input.props.disabled) (input.props.onChange as (event: unknown) => void)({ target: { checked } }); render(); },
    async generate() { const button = find(tree, (node) => node.props["data-media-primary-action"] !== undefined); if (button.props.disabled) return; (button.props.onClick as () => void)(); await flush(); },
    deferVoiceUpload() { deferUpload = true; }, finishVoiceUpload() { uploadReply?.(); },
    changeAccount() { for (const callback of [...listeners.get("account-change") || []]) callback(); render(); },
    dispose() { for (const bank of [parentSlots, ...childSlots.values()]) for (const slot of bank) slot.cleanup?.(); },
  };
}

test("the real Studio music library binds catalogue choices, confirms preview and preserves Auto Off and account scope without generation", async () => {
  const h = harness();
  try {
    const closed = h.musicNative(); closed.handlers.open.invoke(null); await h.flushMusic();
    let entry = h.musicNative(); assert.equal(entry.snapshot.open, true); assert.equal(entry.snapshot.ready, true);
    assert.deepEqual(entry.snapshot.catalogue, h.musicTracks.map(track => track.id));
    assert.equal(h.musicReads(), 1);
    const previewId = h.musicTracks[1].id;
    await entry.handlers.play.invoke(previewId); await h.flushMusic(); entry = h.musicNative();
    assert.equal(entry.snapshot.withMusic, true); assert.equal(entry.snapshot.soundtrackId, null, "previewing an unselected track never changes the default Auto choice");
    assert.equal(entry.snapshot.playingId, previewId); assert.equal(entry.snapshot.playbackActive, true);
    assert.equal(entry.handlers.play.matches(entry.snapshot, previewId), true);
    assert.equal(h.musicPlays.at(-1), h.musicTracks[1].audioPreview);
    entry.handlers.stop.invoke(null); await h.flushMusic(); entry = h.musicNative();
    assert.equal(entry.handlers.stop.matches(entry.snapshot, null), true); assert.equal(h.musicAudio.paused, true);
    const trackId = h.musicTracks[0].id, select = entry.handlers.select;
    select.invoke(trackId); assert.equal(select.matches(entry.snapshot, trackId), false); await h.flushMusic(); entry = h.musicNative();
    assert.equal(select.matches(entry.snapshot, trackId), true); assert.equal(entry.snapshot.soundtrackId, trackId); assert.equal(entry.snapshot.withMusic, true);
    entry.handlers.select.invoke("auto"); await h.flushMusic(); entry = h.musicNative();
    assert.equal(entry.snapshot.withMusic, true); assert.equal(entry.snapshot.soundtrackId, null); assert.equal(entry.handlers.select.matches(entry.snapshot, "auto"), true);
    entry.handlers.select.invoke("off"); await h.flushMusic(); entry = h.musicNative();
    assert.equal(entry.snapshot.withMusic, false); assert.equal(entry.snapshot.soundtrackId, null); assert.equal(entry.handlers.select.matches(entry.snapshot, "off"), true);
    entry.handlers.select.invoke(trackId); await h.flushMusic(); entry = h.musicNative();
    await entry.handlers.play.invoke(null); await h.flushMusic(); assert.equal(h.musicAudio.paused, false);
    const beforeClose = h.musicPauseCount(); h.musicNative().handlers.close.invoke(null); await h.flushMusic(); entry = h.musicNative();
    assert.equal(entry.snapshot.open, false); assert.equal(h.musicAudio.paused, true); assert.equal(h.musicAudio.src, ""); assert.ok(h.musicPauseCount() > beforeClose, "closing pauses the captured audio even after its dialog ref is cleared");
    const old = entry; h.changeMusicAccount("account-b"); await h.flushMusic(); entry = h.musicNative();
    assert.equal(entry.snapshot.scopeKey, "account-b"); assert.equal(entry.snapshot.withMusic, true); assert.equal(entry.snapshot.soundtrackId, null, "another account starts with Auto rather than the previous selected track");
    assert.equal(old.handlers.select.matches(entry.snapshot, trackId), false, "another account cannot acknowledge the previous selection");
    assert.equal(h.mountedInterfaces().some(id => id.startsWith("publication_soundtrack_")), false);
    assert.equal(h.requests.length, 0); assert.equal(h.uploads.length, 0);
  } finally { h.dispose(); }
});

test("Studio music controls reject unavailable tracks and stale playback while locked and retry only the current account catalogue", async () => {
  const h = harness();
  try {
    h.setMusicCatalogue("error"); h.musicNative().handlers.open.invoke(null); await h.flushMusic();
    let entry = h.musicNative(); assert.equal(entry.snapshot.ready, false); assert.throws(() => entry.handlers.select.invoke("unavailable-track"));
    const retry = entry.handlers.retry; h.setMusicCatalogue("ready"); retry.invoke(null); assert.equal(retry.matches(entry.snapshot, null), false);
    await h.flushMusic(); entry = h.musicNative(); assert.equal(entry.snapshot.ready, true); assert.equal(retry.matches(entry.snapshot, null), true); assert.equal(h.musicReads(), 2);
    assert.throws(() => entry.handlers.select.invoke("https://foreign.test/audio.mp3"));
    h.setMusicLocked(true); entry = h.musicNative(); assert.equal(entry.locked, true);
    for (const action of [() => entry.handlers.open.invoke(null), () => entry.handlers.close.invoke(null), () => entry.handlers.select.invoke("off"), () => entry.handlers.play.invoke(h.musicTracks[0].id), () => entry.handlers.retry.invoke(null)]) {
      await assert.rejects(async () => { await action(); });
    }
    h.setMusicLocked(false); entry = h.musicNative(); h.deferMusicPlay();
    const pending = entry.handlers.play.invoke(h.musicTracks[0].id) as Promise<unknown>;
    h.changeMusicAccount("account-c"); h.finishMusicPlay(); await assert.rejects(pending); await h.flushMusic(); entry = h.musicNative();
    assert.equal(entry.snapshot.scopeKey, "account-c"); assert.equal(entry.snapshot.playingId, null); assert.equal(entry.snapshot.playbackActive, false); assert.equal(h.musicAudio.paused, true);
    assert.equal(h.requests.length, 0); assert.equal(h.uploads.length, 0);
  } finally { h.dispose(); }
});


test("the real Studio vocal pool imports at most three sources and binds native choices to captured profile and photo IDs", async () => {
  const h = harness("video", "minimax-h3", 8);
  try {
    await h.addPhoto("Produit.png", "product"); await h.addPhoto("Alice.png", "character");
    h.chooseMainVoice("provided"); let pendingEntry = h.poolNative();
    pendingEntry.handlers.open.invoke(null); h.render(); pendingEntry = h.poolNative(); assert.equal(pendingEntry.handlers.open.matches(pendingEntry.snapshot, null), true); assert.equal(h.uploads.length, 0);
    pendingEntry.handlers.open.invoke("new"); h.render(); pendingEntry = h.poolNative(); assert.equal(pendingEntry.handlers.open.matches(pendingEntry.snapshot, "new"), true); assert.equal(h.uploads.length, 0, "opening a draft never uploads, records or grants consent");
    pendingEntry.handlers.close.invoke(null); h.render(); assert.equal(h.poolNative().handlers.close.matches(h.poolNative().snapshot, null), true);
    for (let at = 0; at < 3; at++) await h.importNarrator();
    let entry = h.poolNative();
    const profiles = entry.snapshot.profiles as Array<{ id: string; target: unknown; gender: string }>;
    assert.equal(profiles.length, 3); assert.equal(new Set(profiles.map(profile => profile.id)).size, 3);
    assert.equal(h.uploads.length, 3); assert.equal(elements(h.poolTree()).some(node => node.props["data-voice-pool-add"] !== undefined), false);
    assert.throws(() => entry.handlers.open.invoke("new"), /full/); assert.equal(h.uploads.length, 3);
    const activate = entry.handlers.select; activate.invoke("active:2"); h.render(); entry = h.poolNative(); assert.equal(activate.matches(entry.snapshot, "active:2"), true); assert.equal(entry.snapshot.activeNarrationVoiceId, profiles[2].id);
    const firstId = profiles[0].id;
    entry.handlers.open.invoke("voice:0"); h.render(); entry = h.poolNative();
    const gender = entry.handlers.select; gender.invoke("gender:0:female"); assert.equal(gender.matches(entry.snapshot, "gender:0:female"), false);
    h.render(); entry = h.poolNative(); assert.equal(gender.matches(entry.snapshot, "gender:0:female"), true);
    h.reverseProfiles(); entry = h.poolNative(); assert.equal(gender.matches(entry.snapshot, "gender:0:female"), true, "reorder does not redirect the captured vocal ID");
    assert.equal((entry.snapshot.profiles as Array<{ id: string; gender: string }>).find(profile => profile.id === firstId)!.gender, "female");
    const target = entry.handlers.select; target.invoke("target:2:reference:1"); h.render(); entry = h.poolNative();
    assert.equal(target.matches(entry.snapshot, "target:2:reference:1"), true);
    const attached = (entry.snapshot.profiles as Array<{ id: string; target: unknown }>).find(profile => profile.id === firstId)!;
    assert.deepEqual(attached.target, { characterId: (entry.snapshot.characters as Array<{ id: string }>)[0].id });
    assert.equal(h.uploads.length, 3); assert.equal(h.requests.length, 0);
    const pendingConsent = find(h.tree(), node => node.props["data-media-final-authorization"] !== undefined);
    assert.equal(find(pendingConsent, node => node.type === "input").props.checked, false, "native assignment never grants image or voice permission");
    entry.handlers.open.invoke("voice:0"); h.render(); entry = h.poolNative();
    assert.throws(() => entry.handlers.select.invoke("target:0:reference:1"), /target_unavailable/, "one photo cannot silently receive a second source");
    entry.handlers.open.invoke("voice:2"); h.render(); entry = h.poolNative();
    entry.handlers.select.invoke("target:2:none"); h.render(); entry = h.poolNative(); assert.equal(entry.handlers.select.matches(entry.snapshot, "target:2:none"), true);
    assert.equal((entry.snapshot.profiles as Array<{ id: string; target: unknown }>).find(profile => profile.id === firstId)!.target, null); assert.deepEqual(h.deleted, []);
    const beforeScope = entry;
    h.setLocked(true); entry = h.poolNative(); assert.equal(entry.locked, true);
    for (const action of [() => entry.handlers.open.invoke("voice:0"), () => entry.handlers.close.invoke(null), () => entry.handlers.select.invoke("gender:2:male")]) assert.throws(action);
    h.setLocked(false); h.removePoolVocal(); entry = h.poolNative(); assert.equal(beforeScope.handlers.select.matches(entry.snapshot, "target:2:none"), false, "an explicitly removed source cannot acknowledge the previous captured ID");
    h.changeMusicAccount("account-b"); entry = h.poolNative(); assert.equal(entry.snapshot.scopeKey, "account-b");
    assert.deepEqual(entry.snapshot.profiles, []); assert.equal(beforeScope.handlers.select.matches(entry.snapshot, "target:2:none"), false);
    assert.equal(h.requests.length, 0);
  } finally { h.dispose(); }
});


test("a second independent vocal preserves an occupied character assignment and stays unassigned until an explicit new choice", async () => {
  const h = harness("video", "wan27", 8);
  try {
    await h.addPhoto("Alice.png", "character"); h.chooseVoice(0, "provided"); await h.uploadVoice(0);
    const first = (h.poolNative().snapshot.profiles as Array<{ id: string; target: unknown }>)[0];
    h.poolNative().handlers.open.invoke("new"); h.render();
    await h.selectVocalFile(new File(["wav"], "second.wav", { type: "audio/wav" }));
    const profiles = h.poolNative().snapshot.profiles as Array<{ id: string; target: unknown }>;
    assert.equal(profiles.length, 2); assert.deepEqual(profiles[0].target, first.target); assert.equal(profiles[1].target, null, "a new source cannot silently compete for an already occupied photo");
    assert.deepEqual(h.deleted, []); h.closePool(); h.enterSpeech("Bonjour, bienvenue dans notre atelier."); h.consent(); await h.generate();
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].inspirationImages![0].voiceSample!.path, h.uploadedSamples[0].path); assert.notEqual(h.uploadedSamples[0].path, h.uploadedSamples[1].path);
  } finally { h.dispose(); }
});

test("the real voiceover pool accepts a vocal without a photo and keeps new Exact words gender subtitles and consent in its synthesis payload", async () => {
  for (const speech of ["auto", "exact"]) {
    const h = harness("video", "minimax-h3", 8);
    try {
      assert.equal(h.audioNative().enabled, true, "the mounted AI settings entry is initially available");
      h.chooseMainVoice("provided"); assert.equal(h.audioNative().enabled, false, "Real exposes only the vocal pool rather than the hidden AI settings");
      assert.throws(() => h.audioNative().handlers.open.invoke(null)); assert.equal(h.poolNative().enabled, true);
      await h.importNarrator(); const entry = h.poolNative();
      assert.equal((entry.snapshot.profiles as unknown[]).length, 1); assert.equal(h.quoteInputs.at(-1)!.enabled, false);
      assert.equal(h.voiceSnapshot().voiceMode, "provided"); assert.deepEqual(h.voiceSnapshot().voiceReferences, []); assert.equal(h.voiceSnapshot().voiceReferenceId, undefined);
      assert.equal(h.quoteInputs.at(-1)!.videoEngine, "minimax-h3", "voiceover cloning does not select a character-only Wan engine");
      await h.invokeGenerateCallback(); assert.equal(h.requests.length, 0, "upload alone never grants cloning consent");
      entry.handlers.select.invoke("gender:0:male"); h.render(); h.narrationConsent();
      h.addSpeech(); h.enterSpeech(""); assert.equal(h.quoteInputs.at(-1)!.enabled, false);
      await h.invokeGenerateCallback(); assert.equal(h.requests.length, 0); assert.equal(h.voiceSnapshot().spokenScriptOpen, true); assert.equal(h.voiceSnapshot().spokenScript, "");
      const words = "Bonjour, bienvenue dans notre atelier.";
      if (speech === "auto") h.removeSpeech(); else h.enterSpeech(words);
      h.setSubtitles(true); assert.equal(h.quoteInputs.at(-1)!.enabled, true);
      await h.generate(); assert.equal(h.requests.length, 1);
      const request = h.requests[0]; assert.equal(request.narrationVoiceMode, "provided"); assert.equal(request.narrationVoiceSample!.path, h.sample.path);
      assert.equal(request.narrationVoiceConsent, true); assert.equal(request.narrationVoiceGender, "male"); assert.equal(request.withNarration, true); assert.equal(request.withSubtitles, true);
      assert.equal(request.inspirationImages?.length ?? 0, 0); assert.equal(Object.hasOwn(request, "spokenScript"), speech === "exact");
      if (speech === "exact") assert.equal(request.spokenScript, words, "the source vocal is a reference for new words rather than a replay request");
      assert.deepEqual(h.deleted, []);
    } finally { h.dispose(); }
  }
});

test("the real direct vocal importer keeps invalid format and upload errors visible without adding a source or generating", async () => {
  const h = harness("video", "wan27", 8);
  try {
    h.beginVocalImport(); assert.equal(h.poolNative().snapshot.open, true);
    await h.selectVocalFile(new File(["not-audio"], "video.mp4", { type: "video/mp4" }));
    assert.equal(h.uploads.length, 0); assert.equal(h.poolNative().snapshot.open, true); assert.match(text(find(h.voiceTree(), node => node.props.role === "alert")), /file_error/);
    h.setVoiceUploadError(true); await h.selectVocalFile(new File(["wav"], "vocal.wav", { type: "audio/wav" }));
    assert.equal(h.uploads.length, 1); assert.equal(h.poolNative().snapshot.open, true); assert.match(text(find(h.voiceTree(), node => node.props.role === "alert")), /n’a pas pu être importé/);
    assert.deepEqual(h.poolNative().snapshot.profiles, []); assert.equal(h.requests.length, 0);
    h.setVoiceUploadError(false); await h.selectVocalFile(new File(["wav"], "vocal.wav", { type: "audio/wav" }));
    assert.equal((h.poolNative().snapshot.profiles as unknown[]).length, 1); assert.equal(elements(h.voiceTree()).some(node => node.props.role === "alert"), false);
  } finally { h.dispose(); }
});

test("the real three-menu voice flow binds supplied audio to the selected photo and never changes another person's voice", async () => {
  const h = harness();
  try {
    await h.addPhoto("Alice.png", "character"); await h.addPhoto("Bob.png", "character");
    h.setSound("characters"); const [alice, bob] = h.voiceSnapshot().voiceReferences;
    assert.equal(h.audioNative().enabled, true, "two AI characters retain the person selector");
    h.openAudioSettings();
    assert.equal(elements(h.tree()).some(node => node.type === "select" && String(node.props.id).endsWith("-voice-character")), true);
    h.closeSettings();
    h.chooseMainVoice("provided");
    assert.deepEqual(h.voiceSnapshot().voiceReferences.map(reference => reference.voiceMode), ["ai", "ai"], "choosing Real alone cannot assign it to every person");
    h.selectVoicePerson(bob.id); assert.equal(h.voiceSnapshot().voiceReferences.find(reference => reference.id === bob.id)!.voiceMode, "ai", "selecting a person only selects the target"); h.chooseMainVoice("provided");
    const actions = elements(h.renderVoice(1)).filter(node => node.type === "button").map(node => node.props.children);
    for (const action of ["import", "record", "library"]) assert.ok(actions.includes(`ai_generator_character_voice_${action}`));
    assert.equal(h.uploads.length, 0, "opening the three native choices never imports or records a voice");
    await h.uploadVoice(1); h.selectVoicePerson(alice.id);
    assert.equal(h.voiceSnapshot().voiceReferences.find(reference => reference.id === alice.id)!.voiceMode, "ai", "the one-shot intent cannot convert another person during inspection");
    assert.equal(h.voiceSnapshot().voiceReferences.find(reference => reference.id === bob.id)!.voiceMode, "provided");
    assert.deepEqual(h.deleted, []); h.chooseMainVoice("ai"); assert.deepEqual(h.deleted, [], "changing Alice to AI cannot delete Bob's vocal");
    h.selectVoicePerson(bob.id); h.chooseMainVoice("ai"); assert.deepEqual(h.deleted, [], "choosing AI detaches the vocal without deleting its independent profile");
    assert.equal((h.poolNative().snapshot.profiles as Array<{ target: unknown }>)[0].target, null);
    assert.equal(h.requests.length, 0);
  } finally { h.dispose(); }
});

test("provided voice with Exact empty preserves the draft and blocks quote and generation until the professional chooses Auto or supplies speech", async () => {
  for (const resolution of ["auto", "exact"]) {
    const h = harness("video", "minimax-h3", 2, { realEnginePreference: true });
    try {
      await h.addPhoto("Moi.png", "character"); h.chooseVoice(0, "provided"); await h.uploadVoice(0); h.addSpeech(); h.enterSpeech("");
      assert.equal(h.voiceSnapshot().spokenScriptOpen, true); assert.equal(h.voiceSnapshot().spokenScript, ""); assert.equal(h.quoteInputs.at(-1)!.enabled, false);
      assert.equal(find(h.tree(), node => node.props["data-video-voice-script-warning"] !== undefined).props.role, "alert");
      h.consent(); await h.invokeGenerateCallback(); assert.equal(h.requests.length, 0); assert.equal(h.uploads.length, 1);
      assert.equal(h.quoteInputs.at(-1)!.videoEngine, "wan27"); assert.equal(h.storedEnginePreference().videoEngine, "minimax-h3", "a temporary compatible recommendation preserves the saved preference");
      if (resolution === "auto") h.removeSpeech(); else h.enterSpeech("Bonjour, bienvenue chez nous.");
      assert.equal(h.quoteInputs.at(-1)!.enabled, true); assert.equal(h.voiceSnapshot().voiceReferences[0].voiceMode, "provided");
      h.consent(); await h.generate(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].withNarration, false); assert.equal(h.requests[0].inspirationImages![0].voiceSample!.path, h.sample.path);
      assert.equal(Object.hasOwn(h.requests[0], "spokenScript"), resolution === "exact");
    } finally { h.dispose(); }
  }
});

test("unattached supplied-voice intent is cancelled by a new speech choice while attached samples remain linked", async () => {
  const h = harness();
  try {
    h.setSound("characters"); h.chooseMainVoice("provided"); assert.equal(h.uploads.length, 0); h.setSound("silent"); h.setSound("voiceover");
    await h.addPhoto("Moi.png", "character"); h.setSound("characters"); assert.equal(h.voiceSnapshot().voiceReferences[0].voiceMode, "ai", "a later photo cannot revive a cancelled Real intent");
    h.chooseMainVoice("provided"); await h.uploadVoice(0); const path = h.sample.path;
    h.setSound("voiceover"); h.setSound("characters"); h.consent(); await h.generate();
    assert.equal(h.requests[0].inspirationImages![0].voiceSample!.path, path); assert.deepEqual(h.deleted, []);
  } finally { h.dispose(); }
});

test("native role launchers make Inspiration optional and Personne Decor Produit required without migrating existing references", async () => {
  for (const kind of ["image", "video"] as const) {
    const h = harness(kind, "wan27");
    for (const [index, role] of ["inspiration", "character", "environment", "product"].entries()) {
      await h.addPhoto(`${role}.png`, role);
      const card = h.cards()[index];
      assert.equal(find(card, node => node.type === "select").props.value, role);
      assert.equal(find(card, node => node.props["data-reference-inspiration-toggle"] !== undefined).props["aria-pressed"], role === "inspiration", `${kind}/${role}: only the Inspiration launcher defaults to optional`);
      assert.equal(h.requests.length, 0, "adding or classifying a photo cannot generate a media");
      h.criteria(index, role, "inspiration");
      assert.equal(find(h.cards()[index], node => node.props["data-reference-inspiration-toggle"] !== undefined).props["aria-pressed"], true);
      h.criteria(index, role, "required");
      assert.equal(find(h.cards()[index], node => node.props["data-reference-inspiration-toggle"] !== undefined).props["aria-pressed"], false, "the same explicit toggle restores a required reference");
    }
    assert.equal(h.quoteInputs.at(-1)!.identityMode, "professional", "a required person retains the native image rights gate");
    await h.generate(); assert.equal(h.requests.length, 0, "the untouched human authorization still blocks generation");
    h.dispose();
  }
});

test("the native add chooser preserves the draft on file cancellation and shows a refused file error inside the open dialog", async () => {
  for (const kind of ["image", "video"] as const) {
    const h = harness(kind, "wan27"); h.beginReferenceAddition("character");
    await h.selectReferenceFiles([]);
    let dialog = find(h.tree(), node => typeof node.type === "function" && node.type.name === "MediaSettingsDialog");
    assert.equal(dialog.props.addRole, "character");
    assert.equal(h.quoteInputs.at(-1)!.inspirationImagesCount, 0);
    await h.selectReferenceFiles([new File(["video"], "ref.mp4", { type: "video/mp4" })]);
    dialog = find(h.tree(), node => typeof node.type === "function" && node.type.name === "MediaSettingsDialog");
    assert.ok(elements(dialog).some(node => node.props.role === "alert" && text(node).includes("ai_generator_inspiration_images_only")), "a refusal is readable inside the active chooser");
    assert.equal(h.quoteInputs.at(-1)!.inspirationImagesCount, 0); assert.equal(h.requests.length, 0);
    assert.deepEqual(h.deleted, []); assert.equal(h.uploads.length, 0);
    h.dispose();
  }
});

test("video visual brief accepts 500 characters and preserves oversized historical drafts before blocking the real callback", async () => {
  const h = harness("video", "wan3", 2, { initialPrompt: "x".repeat(501) });
  const visual = () => find(h.tree(), node => node.type === "textarea" && String(node.props.id).endsWith("-prompt"));
  assert.equal(visual().props.value, "x".repeat(501));
  assert.equal(visual().props.maxLength, undefined);
  assert.equal(visual().props["aria-invalid"], true);
  assert.match(text(h.tree()), /Consignes visuelles|200 à 300/);
  assert.ok(elements(h.tree()).some(node => node.props["data-video-speech-frame"] === true));
  await h.invokeGenerateCallback(); assert.equal(h.requests.length, 0);
  h.enterPrompt("x".repeat(500));
  await h.invokeGenerateCallback(); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].freePrompt, "x".repeat(500));
  h.dispose();
});

test("video speech live budget blocks seven words at four seconds then preserves them when duration and engine change", async () => {
  const h = harness("video", "wan3"); h.setDuration(4); h.setSound("characters");
  const script = "un deux trois quatre cinq six sept";
  h.enterSpeech(script);
  assert.match(text(h.tree()), /7 \/ 6 mots/);
  await h.invokeGenerateCallback(); assert.equal(h.requests.length, 0);
  h.setDuration(8); h.changePreferredVideoEngine("veo");
  assert.equal(find(h.tree(), node => node.type === "textarea" && String(node.props.id).endsWith("-spoken-script")).props.value, script);
  assert.match(text(h.tree()), /7 \/ 14 mots/);
  await h.invokeGenerateCallback(); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].spokenScript, script);
  assert.equal(h.requests[0].withNarration, false, "character dialogue must still be counted without separate narration");
  assert.equal(h.requests[0].teamVideoSpeechMode, "characters");
  h.dispose();
});

test("two real video segments and CJK speech use their own live budgets without truncating exact input", async () => {
  const h = harness("video", "wan3", 2, { locale: "zh-CN" });
  h.setDuration(8, "multi"); h.setSound("characters");
  const script = "你".repeat(37);
  h.enterSpeech(script);
  assert.match(text(h.tree()), /37 \/ 36 caractères prononcés/);
  assert.match(text(h.tree()), /Plan 1 \(4 s\)/);
  assert.match(text(h.tree()), /Plan 2 \(4 s\)/);
  await h.invokeGenerateCallback(); assert.equal(h.requests.length, 0);
  h.setDuration(30);
  await h.invokeGenerateCallback(); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].spokenScript, script);
  h.dispose();
});

test("oral instructions in the visual frame require an explicit speech choice while visible slogans stay visual", async () => {
  const h = harness();
  const prompt = 'Le personnage dit : « Bonjour, notre atelier vous accueille. »';
  h.enterPrompt(prompt);
  assert.match(text(h.tree()), /Vous avez écrit des paroles dans les consignes visuelles/);
  await h.invokeGenerateCallback(); assert.equal(h.requests.length, 0);
  h.enterSpeech("");
  await h.invokeGenerateCallback(); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].freePrompt, prompt, "a warning never moves or deletes the original wording");
  assert.equal(h.requests[0].spokenScript, "", "explicit silence stays authoritative over legacy speech");
  assert.equal(h.requests[0].withNarration, false);
  h.dispose();
  const visual = harness(); visual.enterPrompt('Un panneau affiche le slogan « Bienvenue au jardin ».');
  await visual.invokeGenerateCallback(); assert.equal(visual.requests.length, 1);
  assert.equal(Object.hasOwn(visual.requests[0], "spokenScript"), false);
  visual.dispose();
});

test("image creation keeps its original 4000-character brief and never gains video frames", async () => {
  const h = harness("image", "omni", 2, { initialPrompt: "x".repeat(2500) });
  const input = find(h.tree(), node => node.type === "textarea" && String(node.props.id).endsWith("-prompt"));
  assert.equal(input.props.maxLength, 4000);
  assert.equal(elements(h.tree()).some(node => node.props["data-video-brief-frame"] === true || node.props["data-video-speech-frame"] === true), false);
  await h.invokeGenerateCallback(); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].freePrompt, "x".repeat(2500));
  h.dispose();
});

test("the compact Free editor retains both Personne usages and opens the real independent vocal actions", async () => {
  for (const usage of ["required", "inspiration"]) {
    const h = harness(); await h.addPhoto(); h.criteria(0, "character", usage);
    h.chooseVoice(0, "provided");
    assert.equal(find(h.tree(), node => node.type === "select" && String(node.props.id).endsWith("-video-voice-mode")).props.value, "provided");
    assert.equal(find(h.cards()[0], node => node.props["data-reference-inspiration-toggle"] !== undefined).props["aria-pressed"], usage === "inspiration", "only the explicit inspiration toggle makes the reference optional");
    const directActions = elements(h.renderVoice(0)).filter((node) => node.type === "button").map((node) => node.props.children);
    for (const action of ["import", "record", "library"]) assert.ok(directActions.includes(`ai_generator_character_voice_${action}`));
    assert.equal(directActions.includes("ai_generator_character_voice_upload"), false);
    assert.equal(elements(h.renderVoice(0)).some(node => node.type === "select"), false, "the pool input does not duplicate the main AI/Real choice");
    assert.equal(h.uploads.length, 0); assert.equal(h.requests.length, 0); h.dispose();
  }
  const image = harness("image"); await image.addPhoto(); image.criteria(0, "character", "required");
  assert.equal(elements(image.cards()[0]).some((node) => typeof node.type === "function" && String(node.type).includes("MediaCharacterVoiceInput")), false); image.dispose();
});

test("the optional speech editor keeps exact script separate from the brief in both quote and generation", async () => {
  const h = harness();
  const mode = find(h.tree(), (node) => node.type === "select" && String(node.props.id).endsWith("-spoken-script-mode"));
  assert.equal(mode.props.value, "automatic");
  assert.notEqual(find(h.tree(), (node) => node.props.id === mode.props["aria-controls"]).props.hidden, true);
  assert.equal(elements(h.tree()).some(node => node.type === "textarea" && String(node.props.id).endsWith("-spoken-script")), false, "automatic speech never presents a text field to fill");
  h.setSound("characters"); h.changePreferredVideoEngine("veo");
  assert.notEqual(find(h.tree(), (node) => node.props.id === mode.props["aria-controls"]).props.hidden, true, "both frames remain visible without making speech explicit");
  assert.equal(Object.hasOwn(h.quoteInputs.at(-1)!, "spokenScript"), false);
  h.addSpeech();
  const script = '  Bonjour, je suis Océane.\n« iNrCy », notre application.  ';
  h.enterSpeech(script);
  const input = () => find(h.tree(), (node) => node.type === "textarea" && String(node.props.id).endsWith("-spoken-script"));
  assert.equal(input().props.maxLength, undefined, "pasting exact words never silently truncates them");
  assert.equal(h.quoteInputs.at(-1)!.spokenScript, script);
  h.setSound("voiceover"); h.openAudioSettings(); h.setSound("characters"); h.closeSettings();
  assert.equal(h.audioNative().enabled, false, "AI characters without a selectable person have no empty settings dialog");
  assert.throws(() => h.audioNative().handlers.open.invoke(null));
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
    h.openAudioSettings();
    const settings = elements(h.tree()).find(node => typeof node.type === "function" && node.type.name === "MediaSettingsDialog")!;
    assert.equal(elements(settings).filter(node => node.type === "select").length, 2, "an empty exact script keeps both voice preferences editable");
    h.closeSettings();
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
  assert.equal(find(h.tree(), (node) => node.type === "select" && String(node.props.id).endsWith("-video-speech-mode")).props.value, "characters");
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

test("the real subtitle checkbox keeps its explicit preference visible and editable while Exact is empty without enabling empty captions", async () => {
  for (const selected of [true, false]) {
    const h = harness();
    try {
      h.setSound("characters"); h.setSubtitles(true); h.addSpeech();
      const control = () => find(h.tree(), node => node.props["data-media-subtitles"] !== undefined);
      assert.equal(control().props.checked, true, "temporarily empty Exact cannot disguise the stored subtitle preference");
      assert.equal(control().props.disabled, false, "the professional can turn subtitles off before writing speech");
      h.setSubtitles(selected);
      assert.equal(control().props.checked, selected);
      for (const value of [!selected, selected]) {
        const entry = h.formNative(); const action = entry.handlers.select;
        const encoded = JSON.stringify({ field: "withSubtitles", value });
        action.invoke(encoded); h.render();
        assert.equal(control().props.checked, value);
        assert.equal(h.formNative().snapshot.withSubtitles, value, "the assistant reads the same stored preference as the visible checkbox");
        assert.equal(action.matches(h.formNative().snapshot, encoded), true, "the actual native handler acknowledges the preference while Exact is empty");
        assert.equal(h.quoteInputs.at(-1)!.withSubtitles, false);
      }
      assert.equal(h.quoteInputs.at(-1)!.withSubtitles, false);
      await h.generate();
      assert.equal(h.requests.length, 1); assert.equal(h.requests[0].spokenScript, "");
      assert.equal(h.requests[0].withSubtitles, false, "no captions are submitted without speech even when the preference is on");
      h.enterSpeech("Bienvenue chez nous.");
      assert.equal(control().props.checked, selected);
      assert.equal(h.quoteInputs.at(-1)!.withSubtitles, selected);
      await h.generate();
      assert.equal(h.requests.length, 2); assert.equal(h.requests[1].withSubtitles, selected);
      assert.equal(h.requests[1].spokenScript, "Bienvenue chez nous.");
      h.setLocked(true); assert.equal(control().props.disabled, true);
      h.setSubtitles(!selected); assert.equal(control().props.checked, selected, "the existing operation lock still protects the preference");
    } finally { h.dispose(); }
  }
});

test("removing speech clears the optional payload and permits no-speech mode without hidden text", async () => {
  const h = harness(); h.addSpeech(); h.enterSpeech("Bonjour, bienvenue chez nous.");
  const silent = () => find(h.tree(), (node) => node.type === "option" && node.props.value === "silent");
  const sound = () => find(h.tree(), node => node.type === "select" && String(node.props.id).endsWith("-video-speech-mode"));
  assert.equal(silent().props.disabled, true);
  h.setSound("silent");
  assert.notEqual(sound().props.value, "silent", "even a stale event cannot discard active speech");
  assert.equal(h.quoteInputs.at(-1)!.spokenScript, "Bonjour, bienvenue chez nous.");
  h.removeSpeech();
  assert.equal(Object.hasOwn(h.quoteInputs.at(-1)!, "spokenScript"), false);
  h.setSound("silent");
  assert.equal(sound().props.value, "silent");
  assert.equal(find(h.tree(), node => node.type === "select" && String(node.props.id).endsWith("-spoken-script-mode")).props.disabled, true, "the persistent speech menu cannot activate contradictory speech in silent mode");
  assert.equal(find(h.tree(), node => node.type === "select" && String(node.props.id).endsWith("-video-voice-mode")).props.disabled, true, "the persistent voice menu is disabled in silent mode");
  assert.equal(sound().props.disabled, false, "the compact audio selector remains available in silent mode");
  await h.generate();
  assert.equal(h.requests.length, 1);
  assert.equal(Object.hasOwn(h.requests[0], "spokenScript"), false);
  h.dispose();
});

test("account changes erase speech and image creation never offers or submits it", async () => {
  const h = harness(); h.addSpeech(); h.enterSpeech("Un texte privé du compte A.");
  h.changeAccount();
  assert.equal(Object.hasOwn(h.quoteInputs.at(-1)!, "spokenScript"), false);
  assert.notEqual(find(h.tree(), (node) => String(node.props.id).endsWith("-spoken-script-panel")).props.hidden, true);
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
  defaultVideo.openAudioSettings();
  const control = find(defaultVideo.tree(), (node) => node.props["data-media-subtitles"] !== undefined);
  assert.equal(control.props.type, "checkbox");
  assert.equal(control.props.checked, false);
  assert.equal(control.props.disabled, false);
  assert.equal(defaultVideo.quoteInputs.at(-1)!.withSubtitles, false);
  await defaultVideo.generate();
  assert.equal(defaultVideo.requests[0].withSubtitles, false);
  defaultVideo.dispose();
  for (const mode of ["voiceover", "characters"]) {
    const h = harness(); h.openAudioSettings(); h.setSound(mode); h.setSubtitles(true);
    h.closeSettings();
    if (mode === "voiceover") h.openAudioSettings();
    else {
      assert.equal(h.audioNative().enabled, false);
      assert.equal(elements(h.tree()).some(node => node.props["data-video-audio-button"] !== undefined), false, "no AI character options means no redundant Settings entry");
    }
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
  assert.equal(find(h.tree(), node => node.props["data-video-audio-button"] !== undefined).props.disabled, true, "silent mode keeps the voice settings unavailable");
  assert.equal(find(h.tree(), node => node.props["data-media-subtitles"] !== undefined).props.disabled, true, "the visible subtitle checkbox remains disabled in silent mode");
  assert.equal(h.quoteInputs.at(-1)!.withSubtitles, false);
  await h.generate(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].withSubtitles, false);
  h.setSound("voiceover");
  h.openAudioSettings();
  const control = find(h.tree(), (node) => node.props["data-media-subtitles"] !== undefined);
  assert.equal(control.props.checked, true, "returning to speech retains the professional’s subtitle choice");
  h.changeAccount();
  h.openAudioSettings();
  assert.equal(find(h.tree(), (node) => node.props["data-media-subtitles"] !== undefined).props.checked, false);
  assert.equal(h.quoteInputs.at(-1)!.withSubtitles, false); h.dispose();
  const fresh = harness();
  fresh.openAudioSettings();
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
  assert.equal(find(h.tree(), (node) => node.type === "select" && String(node.props.id).endsWith("-video-speech-mode")).props.value, "characters");
  const quote = h.quoteInputs.at(-1)!; assert.equal(quote.videoEngine, "wan27"); assert.equal(quote.withNarration, false); assert.equal(quote.teamVideoSpeechMode, "characters");
  const engines = h.renderEngines(); const engineMenu = find(engines, (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
  const options = elements(engineMenu).filter((node) => node.type === "option");
  for (const option of options) assert.equal(option.props.disabled, !voiceRules.isAiMediaCharacterVoiceEngine(String(option.props.value).split(":")[0]));
  const activeVoiceEngines = voiceRules.AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES.filter(models.isAiMediaVideoEngineAvailable);
  assert.deepEqual(activeVoiceEngines, ["wan27", "kling"], "recommend only current engines while historical capability metadata stays intact");
  assert.deepEqual(voiceRules.AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES, ["wan27", "wan3", "heygen", "kling"]);
  const status = elements(engines).filter(node => node.props.role === "status").map(text).find(value => value.includes("Voix fournie"));
  assert.ok(status, "the real restricted-engine menu keeps its useful visible status");
  assert.match(status, /Wan 2\.7/);
  assert.match(status, /Kling/);
  assert.doesNotMatch(status, /Wan 3|HeyGen/i);
  for (const option of options.filter(option => option.props.disabled)) {
    assert.match(text(option), /Wan 2\.7/, "each disabled option points to the current supplied-voice engine");
    assert.doesNotMatch(text(option), /Wan 3|HeyGen/i);
  }
  for (const locale of ["de-DE", "en-GB", "es-ES", "fr-FR", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const hint = (JSON.parse(read(`messages/${locale}/media.json`)) as Record<string, string>).ai_generator_character_voice_engine_required;
    assert.match(hint, /Wan 2\.7/, locale);
    assert.match(hint, /Kling/, locale);
    assert.doesNotMatch(hint, /Wan 3|HeyGen/i, locale);
  }
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

test("Free Studio blocks a short Kling voice with an actionable hint while retaining Wan's shorter-sample support", async () => {
  const h = harness("video", "kling", 3); await h.addPhoto(); h.criteria(0, "character", "required");
  h.chooseVoice(0, "provided"); await h.uploadVoice(0); h.consent();
  await h.generate(); assert.equal(h.requests.length, 0);
  assert.match(text(h.tree()), /Pour Kling.*5.*10 secondes/);
  h.selectEngine("wan27"); h.consent(); await h.generate();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].videoEngine, "wan27"); h.dispose();
});

test("available supplied-voice engines remain selected or can be selected with the corresponding quote and request", async () => {
  for (const engine of voiceRules.AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES.filter(models.isAiMediaVideoEngineAvailable)) {
    const preserved = harness("video", engine); await preserved.addPhoto(); preserved.criteria(0, "character", "inspiration"); preserved.chooseVoice(0, "provided");
    assert.equal(preserved.quoteInputs.at(-1)!.videoEngine, engine, "an already supported preferred engine must be preserved"); preserved.dispose();
    const h = harness("video", "omni", engine === "kling" ? 5 : 2); await h.addPhoto(); h.criteria(0, "character", "inspiration"); h.chooseVoice(0, "provided"); await h.uploadVoice(0);
    h.selectEngine(engine); assert.equal(h.quoteInputs.at(-1)!.videoEngine, engine); assert.equal(h.quoteInputs.at(-1)!.hasProvidedCharacterVoice, true);
    assert.equal(h.quoteInputs.at(-1)!.videoResolution, models.getAiMediaVideoModelForCharacterVoice(engine, true).defaultResolution);
    const menu = find(h.renderEngines(), (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
    assert.equal(String(menu.props.value).split(":")[0], engine);
    h.consent(); await h.generate(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].videoEngine, engine); assert.equal(h.requests[0].teamVideoSpeechMode, "characters");
    assert.equal(h.requests[0].inspirationImages![0].voiceSample?.path, h.sample.path); h.dispose();
  }
});

test("the real hydrated MiniMax preference persists automatic supplied-voice Wan 2.7 and 1080p together without losing speech or consent guards", async () => {
  const script = "Bonjour, nous prenons soin de votre jardin.";
  const h = harness("video", "minimax-h3", 8.4, { realEnginePreference: true, initialPrompt: "Le jardinier présente son jardin. Lumière naturelle." });
  assert.equal(h.storedEnginePreference().videoEngine, "minimax-h3");
  assert.equal(h.storedEnginePreference().videoResolution, "768p");
  await h.addPhoto("photo-jim.png"); h.criteria(0, "character", "required"); h.chooseVoice(0, "provided"); await h.uploadVoice(0);
  assert.equal(h.quoteInputs.at(-1)!.videoEngine, "wan27");
  assert.equal(h.storedEnginePreference().videoEngine, "minimax-h3", "the automatic compatible recommendation must not overwrite a saved engine before a user choice");
  h.enterSpeech(script); h.setDuration(10); h.consent();
  const authorization = () => find(h.tree(), node => node.type === "input" && String(node.props.id).endsWith("-authorization"));
  assert.equal(authorization().props.checked, true);
  h.selectEngine("wan27", "1080p"); await h.flush();
  assert.equal(h.storedEnginePreference().videoEngine, "wan27");
  assert.equal(h.storedEnginePreference().videoResolution, "1080p");
  assert.equal(find(h.renderEngines(), node => node.type === "select" && String(node.props.id).endsWith("-engine")).props.value, "wan27:1080p");
  assert.equal(authorization().props.checked, false, "changing effective resolution still revokes authorization");
  await h.generate(); assert.equal(h.requests.length, 0);
  h.setDuration(8); h.setDuration(10); await h.flush();
  const quote = h.quoteInputs.at(-1)!;
  assert.equal(quote.videoEngine, "wan27"); assert.equal(quote.videoResolution, "1080p");
  assert.equal(quote.durationSeconds, 10); assert.equal(quote.spokenScript, script); assert.equal(quote.hasProvidedCharacterVoice, true);
  assert.equal(quoteAiMediaCredits(quote as AiMediaCreditsQuoteInput).totalCredits, 157);
  h.consent(); await h.generate();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].videoEngine, "wan27"); assert.equal(h.requests[0].videoResolution, "1080p");
  assert.equal(h.requests[0].expectedCredits, 157); assert.equal(h.requests[0].spokenScript, script);
  assert.equal(h.requests[0].inspirationImages![0].voiceSample?.path, h.sample.path);
  assert.equal(h.requests[0].identityConsent, true);
  h.dispose();
});

test("the actual Free callbacks retain submitted voice samples through recovery edits and pause without relaunching the paid request", async () => {
  for (const phase of ["checking", "paused", "resolved"] as const) for (const change of ["role", "voice", "remove", "replace"] as const) {
    const h = harness("video", "wan27");
    await h.addPhoto(); h.criteria(0, "character", "required"); h.chooseVoice(0, "provided"); await h.uploadVoice(0); h.consent(); await h.generate();
    assert.equal(h.requests.length, 1, "one explicitly authorized submission captures its original sample paths");
    const submittedPath = h.requests[0].inspirationImages![0].voiceSample!.path;
    assert.equal(submittedPath, h.sample.path);
    h.beginRecoveryChecking();
    if (phase !== "checking") h.pauseRecoveryChecking();
    if (phase === "resolved") h.clearRecoveryState();
    if (change === "role") h.criteria(0, "environment", "inspiration");
    else if (change === "voice") h.chooseVoice(0, "ai");
    else if (change === "remove") h.removePhoto(0);
    else await h.uploadVoice(0);
    assert.deepEqual(h.deleted, [], `${phase}/${change}: original submitted audio is retained for existing expiry`);
    assert.equal(h.requests.length, 1, "editing or pausing never starts another request");
    assert.equal(h.requests[0].inspirationImages![0].voiceSample!.path, submittedPath, "the submitted request keeps its own immutable audio association");
    h.dispose();
  }
});

test("Free recovery hydration and ordinary AI changes preserve the independent vocal until its explicit removal", async () => {
  for (const pending of [true, false]) {
    const h = harness("video", "wan27"); await h.addPhoto(); h.criteria(0, "character", "required"); h.chooseVoice(0, "provided"); await h.uploadVoice(0);
    if (pending) { h.beginRecoveryChecking(); h.pauseRecoveryChecking(); }
    h.chooseVoice(0, "ai");
    assert.deepEqual(h.deleted, [], "AI changes only detach the reusable source");
    assert.equal((h.poolNative().snapshot.profiles as Array<{ target: unknown }>)[0].target, null);
    h.chooseVoice(0, "provided"); const entry = h.poolNative(); entry.handlers.open.invoke("voice:0"); h.render(); h.removePoolVocal();
    assert.deepEqual(h.deleted, pending ? [] : [h.sample.path], "only explicit source removal releases an unsubmitted vocal");
    assert.equal(h.requests.length, 0);
    h.dispose();
  }
});

test("one explicit footer authorization covers two required people and their distinct voices on every supported engine", async () => {
  for (const engine of voiceRules.AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES.filter(models.isAiMediaVideoEngineAvailable)) {
    const h = harness("video", engine, engine === "kling" ? 5 : 2);
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
    assert.equal(elements(h.tree()).some((node) => node.type === "settings-tabs"), false, "video has one settings view");
    assert.equal(find(h.tree(), node => node.props["data-media-role-add"] === "inspiration").props["data-invalid"], undefined);
    assert.equal(find(h.poolTree(), node => node.props["data-voice-pool-settings"] !== undefined).props["data-invalid"], undefined, "Missing footer authorization must not point to the voice settings");
    const settingsDialog = elements(h.tree()).find(node => typeof node.type === "function" && node.type.name === "MediaSettingsDialog");
    if (settingsDialog) assert.equal(elements(settingsDialog).some((node) => node.type === "label" && node.props.className === "consent"), false);
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
  h.consent(); await h.uploadVoice(0); assert.equal(checked(h), false);
  h.consent(); h.chooseVoice(0, "ai"); assert.equal(checked(h), false);
  h.consent(); h.selectEngine("veo"); assert.equal(checked(h), false, "an available engine change revokes authorization after the supplied voice is detached");
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
  const h = harness("video", "wan27"); await h.addPhoto(); h.criteria(0, "character", "inspiration"); h.chooseVoice(0, "provided");
  let menu = find(h.renderEngines(), (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
  assert.ok(!elements(menu).some((node) => node.type === "option" && String(node.props.value).startsWith("heygen:")));
  assert.doesNotMatch(text(h.renderEngineInfo()), /HeyGen/i);
  h.chooseVoice(0, "ai"); menu = find(h.renderEngines(), (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
  assert.ok(!elements(menu).some((node) => node.type === "option" && String(node.props.value).startsWith("heygen:")));
  assert.doesNotMatch(text(h.renderEngineInfo()), /HeyGen/i); h.dispose();
});

test("Wan2.7 keeps two independent eight-second supplied voices without the retired Wan3 shared cap", async () => {
  const h = harness("video", "wan27", 8);
  try {
    await h.addPhoto("premier.png"); await h.addPhoto("deuxieme.png");
    for (let index = 0; index < 2; index++) { h.criteria(index, "character", "inspiration"); h.chooseVoice(index, "provided"); await h.uploadVoice(index); }
    assert.equal(h.quoteInputs.at(-1)!.videoEngine, "wan27");
    assert.equal(h.uploadedSamples.reduce((total, sample) => total + sample.durationSeconds, 0), 16);
    const menu = find(h.renderEngines(), node => node.type === "select" && String(node.props.id).endsWith("-engine"));
    for (const quality of ["720p", "1080p"]) assert.equal(find(menu, node => node.type === "option" && node.props.value === `wan27:${quality}`).props.disabled, false);
    assert.equal(elements(menu).some(node => node.type === "option" && String(node.props.value).startsWith("wan3:")), false);
    assert.equal(text(h.tree()).includes("ai_generator_character_voice_wan3_duration_limit"), false);
    await h.generate(); assert.equal(h.requests.length, 0, "supplied voices still require explicit authorization");
    h.consent(); await h.generate(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].videoEngine, "wan27");
    assert.deepEqual(h.requests[0].inspirationImages!.map(image => image.voiceSample?.path), h.uploadedSamples.map(sample => sample.path));
    assert.deepEqual(h.deleted, []);
  } finally { h.dispose(); }
});

test("retired Wan3 selector and stale native payloads cannot partially alter people voices or consent", async () => {
  const h = harness("video", "wan27", 8);
  try {
    await h.addPhoto("premier.png"); await h.addPhoto("deuxieme.png");
    for (let index = 0; index < 2; index++) { h.criteria(index, "character", "required"); h.chooseVoice(index, "provided"); await h.uploadVoice(index); }
    h.consent();
    const authorizationChecked = () => find(find(h.tree(), node => node.props["data-media-final-authorization"] !== undefined), node => node.type === "input").props.checked;
    const selected = JSON.stringify(h.formNative().snapshot);
    h.selectEngine("wan3");
    assert.equal(h.formNative().snapshot.videoEngine, "wan27");
    assert.equal(JSON.stringify(h.formNative().snapshot), selected, "a forged old engine selector event cannot apply a partial change");
    assert.equal(authorizationChecked(), true, "a rejected selector event does not revoke or grant consent");
    h.changePreferredVideoEngine("wan3");
    assert.equal(authorizationChecked(), false, "an external effective-engine change revokes earlier consent");
    const stale = h.formNative(), before = JSON.stringify(stale.snapshot);
    assert.equal(stale.snapshot.videoEngine, "wan3");
    const person = (stale.snapshot.voiceReferences as Array<{ id: string }>)[0].id;
    for (const selection of [{ field: "voiceReferenceId", value: person }, { field: "withSubtitles", value: false }]) {
      const encoded = JSON.stringify(selection);
      assert.throws(() => stale.handlers.select.invoke(encoded), /studio_form_unavailable/);
      h.render(); assert.equal(JSON.stringify(h.formNative().snapshot), before);
      assert.equal(stale.handlers.select.matches(h.formNative().snapshot, encoded), false);
    }
    assert.equal(h.requests.length, 0); assert.equal(h.uploads.length, 2); assert.deepEqual(h.deleted, []);
    h.selectEngine("wan27"); h.consent(); await h.generate();
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].videoEngine, "wan27");
    assert.deepEqual(h.requests[0].inspirationImages!.map(image => image.voiceSample?.path), h.uploadedSamples.map(sample => sample.path));
  } finally { h.dispose(); }
});

test("voice Inspiration retains permission and its reusable source while silent requests omit inactive character voices", async () => {
  const h = harness(); await h.addPhoto(); h.criteria(0, "character", "inspiration"); h.chooseVoice(0, "provided"); await h.uploadVoice(0);
  assert.equal(h.quoteInputs.at(-1)!.identityMode, "auto"); assert.match(text(h.tree()), /son image et sa voix/);
  h.consent(); h.setSound("silent"); await h.generate(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].inspirationImages![0].voiceSample, undefined); assert.deepEqual(h.deleted, []);
  h.setSound("characters"); h.consent(); await h.generate(); assert.equal(h.requests[1].identityMode, "auto"); assert.equal(h.requests[1].identityConsent, true); assert.equal(h.requests[1].inspirationImages![0].voiceSample!.path, h.sample.path); h.dispose();
});

test("switching back to AI restores regular engines, and pending voice uploads lock the actual Free editor and clear on account change", async () => {
  const h = harness(); await h.addPhoto(); h.criteria(0, "character", "inspiration"); h.chooseVoice(0, "provided"); await h.uploadVoice(0); h.chooseVoice(0, "ai");
  assert.equal(h.quoteInputs.at(-1)!.videoEngine, "omni"); assert.deepEqual(h.deleted, []); assert.equal((h.poolNative().snapshot.profiles as unknown[]).length, 1);
  h.chooseVoice(0, "provided"); h.deferVoiceUpload(); const pending = h.uploadVoice(0); await h.flush();
  assert.equal(find(h.tree(), (node) => node.type === "textarea").props.disabled, true);
  h.changeAccount(); assert.equal(h.cards().length, 0); h.finishVoiceUpload(); await pending;
  assert.equal(h.cards().length, 0); assert.equal(h.requests.length, 0); h.dispose();
});
