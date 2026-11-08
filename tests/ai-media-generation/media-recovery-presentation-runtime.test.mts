import * as speechBudget from "../../lib/aiMediaVideoSpeechBudget.ts";
import * as inspirationImagePolicy from "../../lib/studioInspirationImagePolicy.ts";
import assert from "node:assert/strict";
import * as studioForm from "../../lib/inrAssistantStudioFormSelection.ts";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as videoOptions from "../../lib/aiMediaVideoClientOptions.ts";
import * as voices from "../../lib/aiMediaNarrationVoices.ts";
import * as rules from "../../lib/mediaRules.ts";
import * as policy from "../../lib/inrStudioModalPolicy.ts";
import * as characterVoices from "../../lib/aiMediaCharacterVoiceClient.ts";
import * as characterVoiceRules from "../../lib/aiMediaCharacterVoices.ts";

type Props = Record<string, unknown>;
type Element = { type: unknown; props: Props };
const jsx = (type: unknown, props: Props): Element => ({ type, props: props || {} });
const styles = { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) };
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  return [tree as Element, ...elements((tree as Element).props.children)];
}
const find = (tree: unknown, predicate: (node: Element) => boolean) => {
  const node = elements(tree).find(predicate); assert.ok(node, "Expected rendered element"); return node;
};
const text = (tree: unknown): string => Array.isArray(tree) ? tree.map(text).join("") : typeof tree === "string" || typeof tree === "number" ? String(tree) : tree && typeof tree === "object" && "props" in tree ? text((tree as Element).props.children) : "";

/** Stable hook slots and dependency-aware effects; each Activity panel gets its own instance. */
function runtime(file: string, dependencies: Map<string, unknown>) {
  const slots: Array<{ value?: unknown; deps?: unknown[]; cleanup?: () => void }> = [];
  let cursor = 0; let dirty = false; const effects: Array<() => void> = [];
  const react = {
    Activity: "activity", useId: () => "recovery-ui",
    useState(initial: unknown) { const index = cursor++; const slot = slots[index] ||= { value: typeof initial === "function" ? initial() : initial }; return [slot.value, (value: unknown) => { const next = typeof value === "function" ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; } }]; },
    useRef(initial: unknown) { const index = cursor++; return (slots[index] ||= { value: { current: initial } }).value; },
    useCallback(value: unknown, deps: unknown[]) { const index = cursor++; const slot = slots[index] ||= {}; if (!slot.deps || deps.some((item, i) => item !== slot.deps![i])) { slot.deps = deps; slot.value = value; } return slot.value; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) { const index = cursor++; const slot = slots[index] ||= {}; if (!slot.deps || deps.some((item, i) => item !== slot.deps![i])) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; }); } },
    useLayoutEffect(effect: () => void | (() => void), deps: unknown[]) { react.useEffect(effect, deps); },
  };
  const modules = new Map(dependencies);
  modules.set("react", react); modules.set("react/jsx-runtime", { jsx, jsxs: jsx });
  modules.set("./DashboardAssistantTrigger", { __esModule: true, default: "assistant-trigger" });
  modules.set("./DashboardAssistantScreenContext", { useInrAssistantScreen() {} });
  modules.set("../_hooks/useInrAssistantLocalInterface", { useInrAssistantLocalInterface() {} });
  modules.set("./DashboardUnsavedNavigationProvider", { useDashboardUnsavedNavigation: () => ({ registerGuard: () => () => {} }) });
  modules.set("@/lib/inrAssistantStudioFormSelection", studioForm);
  modules.set("@/lib/browserAccountCache", { getActiveBrowserUserId: () => null });
  modules.set("next-intl", { useLocale: () => "fr-FR", useTranslations: () => (key: string, values?: Props) => `${key}${values ? JSON.stringify(values) : ""}` });
  modules.set("@/lib/multicompte/constants", { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" });
  const output = ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const record = { exports: {} as Props };
  new Function("module", "exports", "require", "window", "document", "HTMLElement", output)(record, record.exports, (name: string) => {
    if (name.endsWith(".module.css")) return styles;
    if (name === "@/lib/studioInspirationImagePolicy") return inspirationImagePolicy;
    if (name === "@/lib/aiMediaVideoSpeechBudget") return speechBudget;
    assert.ok(modules.has(name), `Unexpected UI dependency: ${name}`); return modules.get(name);
  }, { addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {} }, { activeElement: null, body: { style: {}, children: [] }, documentElement: { style: {} } }, class {});
  return {
    render(props: Props, name = "default") { let tree: unknown; let count = 0; do { assert.ok(++count < 20, "UI effects settle"); dirty = false; cursor = 0; tree = (record.exports[name] as (props: Props) => unknown)(props); for (const effect of effects.splice(0)) effect(); } while (dirty); return tree; },
    dispose() { for (const slot of slots) slot.cleanup?.(); },
  };
}
const common = new Map<string, unknown>([
  ["./DashboardMobileSelect", { __esModule: true, default: "mobile-select" }],
  ["@/lib/aiMediaModelCatalog", models], ["@/lib/aiMediaGenerationContracts", contracts],
  ["@/lib/aiMediaVideoTimeline", timeline], ["@/lib/aiMediaVideoClientOptions", videoOptions],
]);
const result = { item: { id: "same-paid-veo", media_type: "video", width: 1080, height: 1920, duration_seconds: 8 }, format: "story", draft: true, recovered: true, videoEngineResult: "veo", creditsUsed: 103 };

test("reload selects the owning Video Activity before recovery, preserves its result and never presents the fresh Recraft quote", async () => {
  let canRecover = true; let recovered: typeof result | null = null; let reads = 0;
  let context = { kind: "video", format: "story" };
  const callbackResults: unknown[] = [];
  const hook = () => ({
    quota: { accountId: "account-a", creditsReady: true, credits: { remaining: 0 }, videoMaxDurationSeconds: 30 },
    canRecover, recoveryContext: canRecover ? context : null, result: recovered,
    busy: false, progress: 0, loadQuota() {},
    generate() { assert.fail("Recovery must never create another generation"); },
    async retryRecovery() { reads++; recovered = result; canRecover = false; return result; },
  });
  const hookModule = { __esModule: true, default: hook, MediaGenerationAccountChangedError: Error, MediaGenerationCancelledError: Error };
  const modalModules = new Map(common);
  modalModules.set("@/app/dashboard/_hooks/useMediaGeneration", hookModule);
  modalModules.set("@/lib/inrStudioModalPolicy", policy);
  modalModules.set("react-dom", { createPortal: (tree: unknown) => tree });
  for (const name of ["next/link", "./MediaModifier", "./MediaFreeGenerator", "./MediaRetoucher", "./MediaVideoRetoucher", "./DashboardMobileSelect"]) modalModules.set(name, { __esModule: true, default: name });
  const modal = runtime("app/dashboard/_components/MediaGeneratorModal.tsx", modalModules);
  const modalProps = { open: true, source: "studio", origin: "menu", acceptMode: "library", onClose() {}, onAccepted() {} };
  const activePanel = (tree: unknown) => find(find(tree, (node) => node.type === "activity" && node.props.mode === "visible"), (node) => node.type === "./MediaFreeGenerator");
  let modalTree = modal.render(modalProps); let panel = activePanel(modalTree); assert.equal(panel.props.mediaType, "image");

  const freeModules = new Map(common);
  freeModules.set("@/app/dashboard/_hooks/useMediaGeneration", hookModule);
  freeModules.set("@/lib/aiMediaNarrationVoices", voices); freeModules.set("@/lib/mediaRules", rules);
  freeModules.set("@/lib/mediaGenerationReferenceClient", {});
  freeModules.set("@/lib/aiMediaCharacterVoiceClient", characterVoices);
  freeModules.set("@/lib/aiMediaCharacterVoices", characterVoiceRules);
  freeModules.set("@/lib/aiMediaModelRecommendation", { recommendAiMediaModel: () => null });
  freeModules.set("../_hooks/useMediaEnginePreference", { __esModule: true, default: () => ({ imageEngine: "recraft", videoEngine: "omni", videoResolution: "720p", update() {} }) });
  freeModules.set("../_hooks/useMediaCreditQuote", { __esModule: true, default: () => ({ ready: true, insufficient: false, quote: { totalCredits: 4 }, authorization: {} }) });
  for (const name of ["./MediaLibraryPickerModal", "./MediaSubjectVoiceButton", "./MediaPromptHelp", "./MediaBusinessDnaHelp", "./MediaQuotaSummary", "./MediaCharacterVoiceInput", "./StudioMusicLibrary", "./StudioVoicePool"]) freeModules.set(name, { __esModule: true, default: name });
  freeModules.set("./MediaGenerationCreationWorkspace", { __esModule: true, default: "preview", MediaGenerationSettingsTabs: "settings" });
  freeModules.set("./MediaEngineCreditControls", { __esModule: true, default: "engines", isMediaVideoReferenceCompatible: () => true, MediaCreditQuoteSummary: "new-quote", MediaRecoveredCreditSummary: "recorded-cost", MediaGenerationActions: "actions" });
  const imagePanel = runtime("app/dashboard/_components/MediaFreeGenerator.tsx", freeModules);
  imagePanel.render(panel.props); assert.equal(reads, 0);
  modalTree = modal.render(modalProps); panel = activePanel(modalTree);
  assert.equal(panel.props.mediaType, "video", "Hydration switches the panel before any status request");
  assert.equal(elements(modalTree).filter((node) => node.type === "activity").length, 1, "The wrong-type provisional hook is unmounted, so its stale pointer cannot return");
  assert.equal(find(modalTree, (node) => node.props.role === "radio" && text(node).includes("video_304f6ca4")).props["aria-checked"], true);
  imagePanel.dispose();

  const videoPanel = runtime("app/dashboard/_components/MediaFreeGenerator.tsx", freeModules);
  const videoProps = { ...panel.props, onResultChange(value: unknown) { callbackResults.push(value); (panel.props.onResultChange as (result: unknown) => void)(value); } };
  let tree = videoPanel.render(videoProps);
  assert.equal(find(tree, (node) => node.type === "select" && String(node.props.id).endsWith("-media-format")).props.value, "story");
  assert.equal(find(tree, (node) => node.type === "textarea").props.placeholder, "ai_generator_free_prompt_placeholder_video");
  assert.equal(elements(tree).some((node) => node.type === "new-quote"), false, "the cost of a new draft must not be shown as the recovered charge");
  assert.equal(elements(tree).some((node) => node.type === "engines"), true, "the next draft's engine and duration stay editable while the existing result is checked");
  (find(tree, (node) => node.props["data-media-primary-action"] !== undefined).props.onClick as () => void)();
  await new Promise((resolve) => setImmediate(resolve)); tree = videoPanel.render(videoProps);
  assert.equal(reads, 1); assert.equal(find(tree, (node) => node.type === "preview").props.generationResult, result);
  assert.equal(find(tree, (node) => node.type === "recorded-cost").props.creditsUsed, 103);
  assert.equal(elements(tree).some((node) => node.type === "new-quote" || node.type === "engines"), false);
  modalTree = modal.render(modalProps); assert.equal(activePanel(modalTree).props.mediaType, "video");
  assert.equal(callbackResults.at(-1), result, "No newly mounted empty panel clears the recovered result");
  assert.equal(find(tree, (node) => node.type === "preview").props.disabled, true, "A recovered result cannot regenerate before the user reviews a new quote");
  (find(tree, (node) => node.type === "preview").props.handleEditCriteria as () => void)();
  tree = videoPanel.render(videoProps);
  assert.equal(elements(tree).some((node) => node.type === "new-quote"), true, "Réajuster makes the new quote visible");
  assert.equal(elements(tree).some((node) => node.type === "engines"), true, "Réajuster exposes the engine used for the next request");
  assert.equal(find(tree, (node) => node.type === "preview").props.generationResult, result, "Showing new criteria preserves the paid draft");
  assert.equal(reads, 1);
  videoPanel.dispose(); modal.dispose();

  for (const [kind, format, incompatible] of [["video", "square", true], ["image", "story", true], ["image", "square", false]] as const) {
    canRecover = true; recovered = null; context = { kind, format };
    const ads = runtime("app/dashboard/_components/MediaFreeGenerator.tsx", freeModules);
    const adsTree = ads.render({ source: "studio", acceptMode: "insert", mediaType: "image", imageOnly: true, fixedFormat: "square", onAccepted() {}, onRecoveryKind() { assert.fail("Ads cannot switch to an incompatible panel"); } });
    const links = elements(adsTree).filter((node) => node.props["data-media-recovery-studio-link"] !== undefined);
    assert.equal(links.length, incompatible ? 1 : 0, `${kind}/${format}: only an incompatible recovery is sent to the general Studio`);
    const formatSelect = find(adsTree, (node) => node.type === "select" && String(node.props.id).endsWith("-media-format"));
    assert.equal(formatSelect.props.value, "square", "The constrained square format remains selected");
    assert.equal(formatSelect.props.disabled, true);
    assert.deepEqual(elements(formatSelect).filter(node => node.type === "option").map(node => node.props.value), ["square"]);
    if (incompatible) {
      assert.equal(links[0].props.href, "/dashboard/generer-media");
      assert.equal(elements(adsTree).some((node) => node.props["data-media-primary-action"] !== undefined), false);
      assert.equal(find(adsTree, (node) => node.type === "preview").props.generationCancellable, false);
    } else {
      assert.equal(find(adsTree, (node) => node.props["data-media-primary-action"] !== undefined).props.disabled, false, "A compatible Ads image remains recoverable with an exhausted quota");
    }
    assert.equal(reads, 1, "Rendering and redirecting never requests a new generation or recovery");
    ads.dispose();
  }
});

test("the recovered cost summary renders a known historical cost and hides unknown legacy prices", () => {
  const controls = runtime("app/dashboard/_components/MediaEngineCreditControls.tsx", common);
  const tree = controls.render({ creditsUsed: 103 }, "MediaRecoveredCreditSummary");
  assert.match(text(tree), /103/); assert.doesNotMatch(text(tree), /estimate|remaining|retry/);
  for (const creditsUsed of [undefined, null, -1, NaN, "103"]) assert.equal(controls.render({ creditsUsed }, "MediaRecoveredCreditSummary"), null);
});

test("uncertain recovery is presented separately from a confirmed generation failure", () => {
  const deps = new Map(common);
  deps.set("next/image", { __esModule: true, default: "image" });
  deps.set("./MediaEngineCreditControls", { MediaGenerationActions: "actions" });
  deps.set("./MediaResultViewer", { __esModule: true, default: () => null });
  deps.set("@/app/dashboard/_hooks/useMediaResultReveal", { useMediaResultReveal: () => ({ reviewRef: { current: null }, headingRef: { current: null } }) });
  const view = runtime("app/dashboard/_components/MediaGenerationCreationWorkspace.tsx", deps);
  const props = { variant: "embedded", kind: "video", format: "story", durationSeconds: 15, progress: 0, operationLocked: false, generationInProgress: false, finishing: false, generationResult: null, generationCancellable: false, disabled: true, error: "Le résultat n'a pas encore pu être vérifié.", acceptMode: "library" };
  const pending = view.render({ ...props, recoveryPending: true });
  assert.match(text(pending), /ai_generator_recovery_title/);
  assert.ok(elements(pending).some(node => node.props["data-media-recovery-check"] !== undefined));
  assert.ok(elements(pending).some(node => node.props["data-media-recovery-pause"] !== undefined));
  assert.doesNotMatch(text(pending), /ai_generator_creation_failed_title/);
  assert.equal(elements(pending).some((node) => node.props.role === "alert"), false);
  const failed = view.render({ ...props, recoveryPending: false });
  assert.match(text(failed), /ai_generator_creation_failed_title/);
  assert.equal(elements(failed).some((node) => node.props.role === "alert"), true);
  const saved = view.render({ ...props, recoveryPending: false, generationResult: { ...result, draft: false } });
  assert.doesNotMatch(text(saved), /ai_generator_creation_failed_title/);
  view.dispose();
});

test("video waiting retains its estimated percentage and matching loading bar without inventing a rendering phase", () => {
  const deps = new Map(common);
  deps.set("next/image", { __esModule: true, default: "image" });
  deps.set("./MediaEngineCreditControls", { MediaGenerationActions: "actions" });
  deps.set("./MediaResultViewer", { __esModule: true, default: () => null });
  deps.set("@/app/dashboard/_hooks/useMediaResultReveal", { useMediaResultReveal: () => ({ reviewRef: { current: null }, headingRef: { current: null } }) });
  const view = runtime("app/dashboard/_components/MediaGenerationCreationWorkspace.tsx", deps);
  let stops = 0;
  const props = { variant: "full", kind: "video", format: "story", durationSeconds: 30, operationLocked: true,
    generationInProgress: true, finishing: false, generationResult: null, generationCancellable: true,
    handleRequestGenerationStop: () => { stops++; }, disabled: false, acceptMode: "library" };
  for (const creationMode of ["guided", "free"]) for (const progress of [4, 25, 75, 94, 100]) {
    const tree = view.render({ ...props, creationMode, progress, identityTeam: true, referenceCinematicRequested: true });
    const waiting = find(tree, node => node.props.className === "creationProgress");
    assert.match(text(waiting), /ai_generator_generating/);
    assert.match(text(waiting), /ai_generator_free_progress_hint/);
    assert.doesNotMatch(text(waiting), /ai_generator_stage_/);
    assert.equal(text(find(waiting, node => node.type === "strong")), `≈ ${progress} %`);
    const track = find(waiting, node => node.props.className === "largeProgressTrack");
    assert.equal(track.props["data-indeterminate"], undefined, "video keeps its determinate loading bar");
    assert.equal(track.props["aria-hidden"], "true", "the decorative track does not duplicate the visible percentage announcement");
    assert.equal((find(track, node => node.type === "span").props.style as Props).width, `${Math.max(4, progress)}%`, "the video bar follows the displayed estimated percentage");
    const stop = find(waiting, node => node.type === "button");
    (stop.props.onClick as () => void)();
  }
  assert.equal(stops, 10, "the existing stop action remains connected");
  const stopping = view.render({ ...props, progress: 94, cancellationPending: true });
  assert.match(text(find(stopping, node => node.props.className === "creationProgress")), /ai_generator_editor_stop_pending/);
  const image = view.render({ ...props, kind: "image", progress: 94 });
  const imageWaiting = find(image, node => node.props.className === "creationProgress");
  assert.match(text(imageWaiting), /94\s*%/);
  assert.equal(elements(imageWaiting).filter(node => node.props.className === "largeProgressTrack").length, 1, "image progress presentation stays unchanged");
  view.dispose();
});
