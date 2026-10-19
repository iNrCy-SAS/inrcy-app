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
  const hook = { quota, quotaLoading: false, busy: false, progress: 0, error: "", result: null, canRecover: false, loadQuota() {}, generate: async (request: MediaGenerationRequest) => { requests.push(request); } };
  const preference = { videoEngine: initialEngine, imageEngine: "openai" as models.AiMediaImageEngine, videoResolution: models.getAiMediaVideoModel(initialEngine).defaultResolution, update(patch: Props) { Object.assign(preference, patch); } };
  const modules = new Map<string, unknown>([
    ["react", react], ["react/jsx-runtime", { jsx, jsxs: jsx }],
    ["next-intl", { useLocale: () => "fr-FR", useTranslations: () => (key: string, values?: { credits?: string; provider?: string }) => {
      if (key === "ai_generator_character_voice_provider_consent_label" || key === "ai_generator_team_video_provider_consent") return frenchMessages[key].replace("{provider}", values?.provider || "");
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
  const browser = { addEventListener(name: string, callback: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); }, removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); } };
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
    async addPhoto(name = "personnage.png") { const input = find(tree, (node) => node.type === "input" && node.props.type === "file"); (input.props.onChange as (event: unknown) => void)({ currentTarget: { files: [new File(["synthetic-photo"], name, { type: "image/png" })], value: "" }, target: { files: [new File(["synthetic-photo"], name, { type: "image/png" })], value: "" } }); await flush(); },
    criteria(index: number, role: string, usage: string) { const menus = elements(cards()[index]).filter((node) => node.type === "select"); (menus[0].props.onChange as (event: unknown) => void)({ target: { value: role } }); render(); const refreshed = elements(cards()[index]).filter((node) => node.type === "select"); (refreshed[1].props.onChange as (event: unknown) => void)({ target: { value: usage } }); render(); },
    chooseVoice(index: number, mode: "ai" | "provided") { const child = renderVoice(index); (find(child, (node) => node.type === "select").props.onChange as (event: unknown) => void)({ target: { value: mode } }); render(); },
    async uploadVoice(index: number) { const child = renderVoice(index); const input = find(child, (node) => node.type === "input" && node.props.type === "file"); (input.props.onChange as (event: unknown) => void)({ currentTarget: { files: [new File(["wav-voice"], "vocal.wav", { type: "audio/wav" })], value: "" } }); await flush(); },
    consent() { const label = find(tree, (node) => node.type === "label" && node.props.className === "consent"); (find(label, (node) => node.type === "input").props.onChange as (event: unknown) => void)({ target: { checked: true } }); render(); },
    consentTeam() { const label = elements(tree).filter((node) => node.type === "label" && node.props.className === "consent")[1]; assert.ok(label, "The real provider consent must be present for two required people"); (find(label, (node) => node.type === "input").props.onChange as (event: unknown) => void)({ target: { checked: true } }); render(); },
    setSound(value: string) { const input = find(tree, (node) => node.type === "input" && node.props.type === "radio" && node.props.value === value); (input.props.onChange as () => void)(); render(); },
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

test("all three supported engines remain selected or can be selected through real controls with the corresponding quote and request", async () => {
  for (const engine of voiceRules.AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES) {
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

test("two required people keep two distinct supplied voices paired with their portraits and team consent on every supported engine", async () => {
  for (const engine of voiceRules.AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES) {
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
    const providerConsent = elements(h.tree()).filter((node) => node.type === "label" && node.props.className === "consent")[1];
    const expectedConsent = `Pour cette génération, j’autorise l’envoi des photos et des vocaux fournis à ${models.getAiMediaVideoModelForCharacterVoice(engine, true).providerLabel}, et je confirme avoir l’autorisation de toutes les personnes représentées.`;
    assert.equal(text(providerConsent), expectedConsent);
    assert.doesNotMatch(text(providerConsent), /image de groupe dérivée|dialogues synthétiques/);
    const regenerationConsents = find(h.tree(), (node) => node.type === "preview").props.regenerationConsents as Array<{ id: string; label: string }>;
    assert.equal(regenerationConsents.find((consent) => consent.id === "team")?.label, expectedConsent);
    h.consent(); await h.generate(); assert.equal(h.requests.length, 0, "identity consent cannot bypass the engine-specific team consent");
    h.consentTeam(); await h.generate(); assert.equal(h.requests.length, 1);
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

test("HeyGen shows voice-specific 768p and 1080p rates while AI voices retain the regular tariff", async () => {
  const h = harness("video", "heygen"); await h.addPhoto(); h.criteria(0, "character", "inspiration"); h.chooseVoice(0, "provided");
  let menu = find(h.renderEngines(), (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
  const option = (quality: string) => find(menu, (node) => node.type === "option" && node.props.value === `heygen:${quality}`);
  assert.match(text(option("768p")), /credit_rate_short 10/); assert.match(text(option("1080p")), /credit_rate_short 18/);
  assert.match(text(h.renderEngineInfo()), /credit_rate_short 18/);
  h.chooseVoice(0, "ai"); menu = find(h.renderEngines(), (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
  assert.match(text(option("768p")), /credit_rate_short 4/); assert.match(text(option("1080p")), /credit_rate_short 10/);
  assert.doesNotMatch(text(h.renderEngineInfo()), /credit_rate_short 18/); h.dispose();
});

test("Wan 3 blocks over fifteen seconds of samples without discarding them or changing the selected engine", async () => {
  const h = harness("video", "wan3", 8); await h.addPhoto("premier.png"); await h.addPhoto("deuxieme.png");
  for (let index = 0; index < 2; index++) { h.criteria(index, "character", "inspiration"); h.chooseVoice(index, "provided"); await h.uploadVoice(index); }
  assert.equal(h.quoteInputs.at(-1)!.videoEngine, "wan3");
  const menu = find(h.renderEngines(), (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
  for (const quality of ["720p", "1080p"]) assert.equal(find(menu, (node) => node.type === "option" && node.props.value === `wan3:${quality}`).props.disabled, true);
  assert.ok(text(h.tree()).includes("ai_generator_character_voice_wan3_duration_limit")); h.consent(); await h.generate(); assert.equal(h.requests.length, 0);
  h.selectEngine("heygen"); h.consent(); await h.generate(); assert.equal(h.requests[0].videoEngine, "heygen");
  assert.equal(h.requests[0].inspirationImages!.filter((image) => image.voiceSample).length, 2); h.dispose();
});

test("voice Inspiration alone requires permission but retains identity auto, and incompatible sound cannot silently discard it", async () => {
  const h = harness(); await h.addPhoto(); h.criteria(0, "character", "inspiration"); h.chooseVoice(0, "provided"); await h.uploadVoice(0);
  assert.equal(h.quoteInputs.at(-1)!.identityMode, "auto"); assert.ok(text(h.tree()).includes("ai_generator_character_voice_consent_label"));
  h.consent(); h.setSound("silent"); await h.generate(); assert.equal(h.requests.length, 0); assert.ok(text(h.tree()).includes("ai_generator_character_voice_speech_required"));
  h.setSound("characters"); await h.generate(); assert.equal(h.requests[0].identityMode, "auto"); assert.equal(h.requests[0].identityConsent, true); h.dispose();
});

test("switching back to AI restores regular engines, and pending voice uploads lock the actual Free editor and clear on account change", async () => {
  const h = harness(); await h.addPhoto(); h.criteria(0, "character", "inspiration"); h.chooseVoice(0, "provided"); await h.uploadVoice(0); h.chooseVoice(0, "ai");
  assert.equal(h.quoteInputs.at(-1)!.videoEngine, "omni"); assert.deepEqual(h.deleted, [h.sample.path]);
  h.chooseVoice(0, "provided"); h.deferVoiceUpload(); const pending = h.uploadVoice(0); await h.flush();
  assert.equal(find(h.tree(), (node) => node.type === "textarea").props.disabled, true);
  h.changeAccount(); assert.equal(h.cards().length, 0); h.finishVoiceUpload(); await pending;
  assert.equal(h.cards().length, 0); assert.equal(h.requests.length, 0); h.dispose();
});
