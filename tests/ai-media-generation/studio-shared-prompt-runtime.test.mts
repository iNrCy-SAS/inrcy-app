import assert from "node:assert/strict";
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

/** Separate hook slots for each real component/Activity; no provider or browser requests. */
function runtime(file: string, dependencies: Map<string, unknown>) {
  const slots: Array<{ value?: unknown; deps?: unknown[]; cleanup?: () => void }> = [];
  let cursor = 0; let dirty = false; const effects: Array<() => void> = [];
  const listeners = new Map<string, Set<() => void>>();
  const react = {
    Activity: "activity", useId: () => "shared-prompt-ui",
    useState(initial: unknown) { const index = cursor++; const slot = slots[index] ||= { value: typeof initial === "function" ? initial() : initial }; return [slot.value, (value: unknown) => { const next = typeof value === "function" ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; } }]; },
    useRef(initial: unknown) { const index = cursor++; return (slots[index] ||= { value: { current: initial } }).value; },
    useCallback(value: unknown, deps: unknown[]) { const index = cursor++; const slot = slots[index] ||= {}; if (!slot.deps || deps.some((item, i) => item !== slot.deps![i])) { slot.deps = deps; slot.value = value; } return slot.value; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) { const index = cursor++; const slot = slots[index] ||= {}; if (!slot.deps || deps.some((item, i) => item !== slot.deps![i])) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; }); } },
    useLayoutEffect(effect: () => void | (() => void), deps: unknown[]) { react.useEffect(effect, deps); },
  };
  const modules = new Map(dependencies);
  modules.set("react", react); modules.set("react/jsx-runtime", { jsx, jsxs: jsx });
  modules.set("./DashboardAssistantTrigger", { __esModule: true, default: "assistant-trigger" });
  modules.set("next-intl", { useLocale: () => "fr-FR", useTranslations: () => (key: string) => key });
  modules.set("@/lib/multicompte/constants", { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" });
  const output = ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const record = { exports: {} as Props };
  new Function("module", "exports", "require", "window", "document", "HTMLElement", output)(record, record.exports, (name: string) => {
    if (name.endsWith(".module.css")) return styles;
    assert.ok(modules.has(name), `Unexpected UI dependency: ${name}`); return modules.get(name);
  }, {
    addEventListener(name: string, listener: () => void) { const list = listeners.get(name) || new Set(); list.add(listener); listeners.set(name, list); },
    removeEventListener(name: string, listener: () => void) { listeners.get(name)?.delete(listener); },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  }, { activeElement: null, body: { style: {}, children: [] }, documentElement: { style: {} } }, class {});
  return {
    render(props: Props) { let tree: unknown; let count = 0; do { assert.ok(++count < 20, "UI effects settle"); dirty = false; cursor = 0; tree = (record.exports.default as (props: Props) => unknown)(props); for (const effect of effects.splice(0)) effect(); } while (dirty); return tree; },
    emit(name: string) { for (const listener of [...listeners.get(name) || []]) listener(); },
    dispose() { for (const slot of slots) slot.cleanup?.(); },
  };
}

function fixture(extra: Props = {}) {
  let generations = 0;
  const discards: Array<{ mediaId: string; scope: { accountId: string | null; kind: string; isCurrent: () => boolean } }> = [];
  let discardHandler: () => Promise<boolean> = async () => true;
  const hookState = {
    quota: { accountId: "account-a", creditsReady: true, credits: { remaining: 697 }, videoMaxDurationSeconds: 30 } as { accountId: string; creditsReady: boolean; credits: { remaining: number }; videoMaxDurationSeconds: number } | null,
    quotaLoading: false,
    canRecover: false, recoveryContext: null, result: null,
    busy: false, progress: 0, error: "", loadQuota() {}, reset() {},
    generate() { generations++; assert.fail("Editing or inserting a prompt cannot generate media"); },
  };
  const hookModule = { __esModule: true, default: () => hookState, async discardMediaGenerationDraft(mediaId: string, scope: { accountId: string | null; kind: string; isCurrent: () => boolean }) { discards.push({ mediaId, scope }); return discardHandler(); }, MediaGenerationAccountChangedError: Error, MediaGenerationCancelledError: Error };
  const common = new Map<string, unknown>([
    ["./DashboardMobileSelect", { __esModule: true, default: "mobile-select" }],
    ["@/lib/aiMediaModelCatalog", models], ["@/lib/aiMediaGenerationContracts", contracts],
    ["@/lib/aiMediaVideoTimeline", timeline], ["@/lib/aiMediaVideoClientOptions", videoOptions],
    ["@/app/dashboard/_hooks/useMediaGeneration", hookModule],
  ]);
  const modalModules = new Map(common);
  modalModules.set("@/lib/inrStudioModalPolicy", policy);
  modalModules.set("react-dom", { createPortal: (tree: unknown) => tree });
  for (const name of ["next/link", "./MediaModifier", "./MediaFreeGenerator", "./MediaRetoucher", "./MediaVideoRetoucher"]) modalModules.set(name, { __esModule: true, default: name });
  const modal = runtime("app/dashboard/_components/MediaGeneratorModal.tsx", modalModules);
  let replacement: (() => Promise<boolean>) | null = null;
  let state: { busy: boolean; hasDraft: boolean } | null = null;
  const props = {
    open: true, source: "studio", origin: "menu", acceptMode: "library", onClose() {}, onAccepted() {},
    onWorkspaceStateChange(value: { busy: boolean; hasDraft: boolean }) { state = value; },
    registerDraftReplacementRequest(value: (() => Promise<boolean>) | null) { replacement = value; },
    ...extra,
  };
  const freeModules = new Map(common);
  freeModules.set("@/lib/aiMediaNarrationVoices", voices); freeModules.set("@/lib/mediaRules", rules);
  freeModules.set("@/lib/mediaGenerationReferenceClient", {});
  freeModules.set("@/lib/aiMediaCharacterVoiceClient", characterVoices);
  freeModules.set("@/lib/aiMediaCharacterVoices", characterVoiceRules);
  freeModules.set("@/lib/aiMediaModelRecommendation", { recommendAiMediaModel: () => null });
  const preference = { imageEngine: "recraft", videoEngine: "omni", videoResolution: "720p", update() {} };
  const quote = { ready: true, insufficient: false, quote: { totalCredits: 4 }, authorization: {} };
  freeModules.set("../_hooks/useMediaEnginePreference", { __esModule: true, default: () => preference });
  freeModules.set("../_hooks/useMediaCreditQuote", { __esModule: true, default: () => quote });
  for (const name of ["./MediaLibraryPickerModal", "./MediaSubjectVoiceButton", "./MediaPromptHelp", "./MediaQuotaSummary", "./MediaCharacterVoiceInput"]) freeModules.set(name, { __esModule: true, default: name });
  freeModules.set("./MediaGenerationCreationWorkspace", { __esModule: true, default: "preview", MediaGenerationSettingsTabs: "settings" });
  freeModules.set("./MediaEngineCreditControls", { __esModule: true, default: "engines", isMediaVideoReferenceCompatible: () => true, MediaCreditQuoteSummary: "new-quote", MediaRecoveredCreditSummary: "recorded-cost", MediaGenerationActions: "actions" });
  const panels: ReturnType<typeof runtime>[] = [];
  return {
    modal, props, hookState, quote, discards,
    setDiscardHandler(handler: () => Promise<boolean>) { discardHandler = handler; },
    render(overrides: Props = {}) { return modal.render({ ...props, ...overrides }); },
    panel(tree: unknown) { return find(find(tree, node => node.type === "activity" && node.props.mode === "visible"), node => node.type === "./MediaFreeGenerator"); },
    createPanel() { const panel = runtime("app/dashboard/_components/MediaFreeGenerator.tsx", freeModules); panels.push(panel); return panel; },
    replacement() { assert.ok(replacement); return replacement(); },
    get state() { return state; },
    get generations() { return generations; },
    dispose() { for (const panel of panels) panel.dispose(); modal.dispose(); },
  };
}
const click = (node: Element) => (node.props.onClick as () => void)();
const mediaRadio = (tree: unknown, kind: "image" | "video") => find(tree, node => node.props.role === "radio" && text(node).includes(kind === "image" ? "image_50e19fda" : "video_304f6ca4"));
const resetAction = (tree: unknown, key: string) => find(tree, node => node.type === "button" && text(node) === key);
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
/** Modal-only tests acknowledge the child's completed account/recovery hydration. */
function ready(f: ReturnType<typeof fixture>) {
  const tree = f.render();
  (f.panel(tree).props.onPendingRecoveryChange as (pending: boolean) => void)(false);
  return f.render();
}

test("zero and insufficient Studio balances stay in credit controls without unsolicited bottom errors", () => {
  for (const mediaType of ["image", "video"] as const) {
    for (const remaining of [0, 2]) {
      const f = fixture({ initialFreePrompt: "Une création pour mon entreprise", initialMediaType: mediaType });
      assert.ok(f.hookState.quota);
      f.hookState.quota.credits.remaining = remaining;
      f.quote.insufficient = true;
      f.quote.ready = false;
      const panel = f.createPanel();
      const props = f.panel(f.render()).props;
      let tree = panel.render(props);
      assert.doesNotMatch(text(tree), /ai_generator_quota_reached|ai_generator_video_credit_insufficient/);
      const balance = find(tree, (node) => node.type === "./MediaQuotaSummary");
      assert.equal((balance.props.counter as { remaining: number }).remaining, remaining);
      assert.equal(balance.props.creditsReady, true);
      assert.equal(find(tree, (node) => node.type === "new-quote").props.status, f.quote);
      const primary = find(tree, (node) => node.props["data-media-primary-action"] !== undefined);
      assert.equal(primary.props.disabled, true, "hiding a balance banner must never authorize generation");
      click(primary);
      assert.equal(f.generations, 0);

      f.hookState.error = "Une erreur serveur doit rester visible";
      tree = panel.render(props);
      assert.equal(find(tree, (node) => node.type === "preview").props.error, f.hookState.error);

      f.hookState.quota.credits.remaining = 697;
      f.hookState.error = "";
      f.quote.insufficient = false;
      f.quote.ready = true;
      tree = panel.render(props);
      assert.equal(find(tree, (node) => node.props["data-media-primary-action"] !== undefined).props.disabled, false, "a funded confirmed quote keeps the existing generation action available");
      assert.equal(f.generations, 0);
      f.dispose();
    }
  }
});

test("a shared generation brief follows Image/Video Activities and dictation while their criteria stay separate", () => {
  const f = fixture({ initialFreePrompt: "Brief de départ", initialMediaType: "image" });
  let modalTree = f.render(); const image = f.createPanel();
  let imageTree = image.render(f.panel(modalTree).props);
  assert.equal(find(imageTree, node => node.type === "textarea").props.value, "Brief de départ");
  (find(imageTree, node => node.type === "textarea").props.onChange as (event: unknown) => void)({ target: { value: "Un flyer pour mon atelier" } });
  modalTree = f.render(); assert.deepEqual(f.state, { busy: false, hasDraft: true });
  click(mediaRadio(modalTree, "video")); modalTree = f.render();
  const video = f.createPanel(); let videoTree = video.render(f.panel(modalTree).props);
  assert.equal(find(videoTree, node => node.type === "textarea").props.value, "Un flyer pour mon atelier");
  assert.equal(find(videoTree, node => node.type === "input" && node.props.value === "story").props.checked, true);
  (find(videoTree, node => node.type === "./MediaSubjectVoiceButton").props.onChange as (value: string) => void)("Un flyer dicté pour mon atelier");
  modalTree = f.render(); click(mediaRadio(modalTree, "image")); modalTree = f.render();
  imageTree = image.render(f.panel(modalTree).props);
  assert.equal(find(imageTree, node => node.type === "textarea").props.value, "Un flyer dicté pour mon atelier");
  assert.equal(find(imageTree, node => node.type === "input" && node.props.value === "square").props.checked, true);
  (find(imageTree, node => node.type === "input" && node.props.value === "landscape").props.onChange as () => void)();
  imageTree = image.render(f.panel(modalTree).props);
  assert.equal(find(imageTree, node => node.type === "input" && node.props.value === "landscape").props.checked, true);
  click(mediaRadio(f.render(), "video")); modalTree = f.render(); videoTree = video.render(f.panel(modalTree).props);
  assert.equal(find(videoTree, node => node.type === "input" && node.props.value === "story").props.checked, true);
  assert.equal(f.generations, 0); f.dispose();
});

test("only explicit reset clears the shared brief and old dictation callbacks cannot restore it", async () => {
  const f = fixture({ initialFreePrompt: "Mon brief", initialMediaType: "video" });
  let tree = ready(f); const oldPromptChange = f.panel(tree).props.onSharedPromptChange as (value: string) => void;
  (f.panel(tree).props.onReset as () => void)(); tree = f.render();
  click(resetAction(tree, "ai_generator_workspace_reset_cancel")); tree = f.render();
  assert.equal(f.panel(tree).props.sharedPrompt, "Mon brief");
  (f.panel(tree).props.onReset as () => void)(); tree = f.render();
  click(resetAction(tree, "ai_generator_workspace_reset_action")); await settle(); tree = f.render();
  assert.equal(f.panel(tree).props.sharedPrompt, "");
  oldPromptChange("Une dictée terminée après Réinitialiser"); tree = f.render();
  assert.equal(f.panel(tree).props.sharedPrompt, "");
  (f.panel(tree).props.onSharedPromptChange as (value: string) => void)("Nouveau brief");
  assert.equal(f.panel(f.render()).props.sharedPrompt, "Nouveau brief");
  assert.equal(f.generations, 0); f.dispose();
});

test("account changes and closing invalidate old briefs and reopen seeds the requested media tab", () => {
  const f = fixture({ initialFreePrompt: "Compte A" }); let tree = ready(f);
  const old = f.panel(tree).props.onSharedPromptChange as (value: string) => void;
  f.modal.emit("account-change"); tree = f.render(); old("Ancien compte"); tree = f.render();
  assert.equal(f.panel(tree).props.sharedPrompt, ""); assert.deepEqual(f.state, { busy: true, hasDraft: false });
  tree = ready(f); assert.deepEqual(f.state, { busy: false, hasDraft: false });
  const beforeClose = f.panel(tree).props.onSharedPromptChange as (value: string) => void;
  f.render({ open: false }); beforeClose("Dictée après fermeture");
  tree = f.render({ initialFreePrompt: "Prompt vidéo préparé", initialMediaType: "video", initialTab: "generate" });
  assert.equal(f.panel(tree).props.mediaType, "video"); assert.equal(f.panel(tree).props.sharedPrompt, "Prompt vidéo préparé");
  beforeClose("Dictée de la session fermée");
  assert.equal(f.panel(f.render({ initialFreePrompt: "Prompt vidéo préparé", initialMediaType: "video" })).props.sharedPrompt, "Prompt vidéo préparé");
  assert.equal(f.generations, 0); f.dispose();
});

test("assistant replacement asks the native reset confirmation and respects cancel, account scope and active work", async () => {
  const f = fixture({ initialFreePrompt: "Brouillon à conserver" }); let tree = ready(f);
  let pending = f.replacement(); tree = f.render();
  click(resetAction(tree, "ai_generator_workspace_reset_cancel")); assert.equal(await pending, false);
  tree = f.render(); assert.equal(f.panel(tree).props.sharedPrompt, "Brouillon à conserver");
  (f.panel(tree).props.onBusyChange as (busy: boolean) => void)(true); tree = f.render();
  assert.deepEqual(f.state, { busy: true, hasDraft: true }); assert.equal(await f.replacement(), false);
  assert.equal(mediaRadio(tree, "video").props.disabled, true);
  (f.panel(tree).props.onBusyChange as (busy: boolean) => void)(false); tree = f.render();
  (f.panel(tree).props.onPendingRecoveryChange as (busy: boolean) => void)(true); tree = f.render();
  assert.deepEqual(f.state, { busy: true, hasDraft: true }); assert.equal(await f.replacement(), false);
  (f.panel(tree).props.onPendingRecoveryChange as (busy: boolean) => void)(false); f.render();
  pending = f.replacement(); tree = f.render();
  (f.panel(tree).props.onPendingRecoveryChange as (busy: boolean) => void)(true); tree = f.render();
  click(resetAction(tree, "ai_generator_workspace_reset_action")); assert.equal(await pending, false); tree = f.render();
  assert.equal(f.panel(tree).props.sharedPrompt, "Brouillon à conserver", "A recovery discovered during confirmation preserves the owning workspace");
  (f.panel(tree).props.onPendingRecoveryChange as (busy: boolean) => void)(false); f.render();
  pending = f.replacement(); f.render(); f.modal.emit("account-change"); assert.equal(await pending, false);
  tree = ready(f); (f.panel(tree).props.onSharedPromptChange as (value: string) => void)("Nouveau compte"); f.render();
  pending = f.replacement(); tree = f.render();
  click(resetAction(tree, "ai_generator_workspace_reset_action")); assert.equal(await pending, true); tree = f.render();
  assert.equal(f.panel(tree).props.sharedPrompt, ""); assert.deepEqual(f.state, { busy: true, hasDraft: false });
  tree = ready(f); assert.deepEqual(f.state, { busy: false, hasDraft: false });
  assert.equal(await f.replacement(), true, "A verified empty workspace needs no reset confirmation");
  (f.panel(tree).props.onSharedPromptChange as (value: string) => void)("Brief avant fermeture"); f.render();
  pending = f.replacement(); f.render(); f.render({ open: false }); assert.equal(await pending, false);
  assert.equal(f.generations, 0); f.dispose();
  const embedded = fixture({ initialFreePrompt: "Campagne publication", handoffOriginLabel: "Booster", onAbandonHandoff() {} });
  embedded.render(); assert.equal(await embedded.replacement(), false); embedded.dispose();
});

test("the real generation form reports unresolved paid recovery separately from busy operations", () => {
  const f = fixture(); let tree = f.render(); const panel = f.createPanel();
  f.hookState.canRecover = true;
  panel.render(f.panel(tree).props); tree = f.render();
  assert.deepEqual(f.state, { busy: true, hasDraft: false });
  f.hookState.canRecover = false;
  panel.render(f.panel(tree).props); f.render();
  assert.deepEqual(f.state, { busy: false, hasDraft: false });
  assert.equal(f.generations, 0); f.dispose();
});

test("replacement stays blocked from the first mount until the scoped quota and recovery pointer have hydrated", async () => {
  const f = fixture({ initialFreePrompt: "Prompt gratuit de l’assistant" }); let tree = f.render();
  assert.deepEqual(f.state, { busy: true, hasDraft: true }); assert.equal(await f.replacement(), false);
  const panel = f.createPanel(); const quota = f.hookState.quota;
  f.hookState.quota = null; f.hookState.quotaLoading = true;
  panel.render(f.panel(tree).props); tree = f.render();
  assert.deepEqual(f.state, { busy: true, hasDraft: true }); assert.equal(await f.replacement(), false);
  f.hookState.quota = quota; f.hookState.quotaLoading = false; f.hookState.canRecover = true;
  panel.render(f.panel(tree).props); tree = f.render();
  assert.deepEqual(f.state, { busy: true, hasDraft: true }); assert.equal(await f.replacement(), false);
  f.hookState.canRecover = false;
  panel.render(f.panel(tree).props); f.render();
  assert.deepEqual(f.state, { busy: false, hasDraft: true });
  assert.equal(f.generations, 0); f.dispose();
});

test("native reset scopes draft deletion to the returned media and invalidates late account acknowledgements", async () => {
  const f = fixture({ initialFreePrompt: "Brief du compte A", initialMediaType: "video" }); let tree = ready(f);
  let finishDiscard!: (confirmed: boolean) => void;
  f.setDiscardHandler(() => new Promise<boolean>(resolve => { finishDiscard = resolve; }));
  (f.panel(tree).props.onResultChange as (result: unknown) => void)({ item: { id: "media-before", media_type: "video" }, draft: true, quota: { accountId: "account-a" } });
  tree = f.render(); (f.panel(tree).props.onReset as () => void)(); tree = f.render();
  click(resetAction(tree, "ai_generator_workspace_reset_action"));
  assert.equal(f.discards.length, 1); assert.equal(f.discards[0].mediaId, "media-before");
  assert.equal(f.discards[0].scope.accountId, "account-a"); assert.equal(f.discards[0].scope.kind, "video");
  assert.equal(f.discards[0].scope.isCurrent(), true);
  f.modal.emit("account-change"); tree = ready(f);
  (f.panel(tree).props.onSharedPromptChange as (value: string) => void)("Brief privé du compte B"); f.render();
  assert.equal(f.discards[0].scope.isCurrent(), false);
  finishDiscard(true); await settle(); tree = f.render();
  assert.equal(f.panel(tree).props.sharedPrompt, "Brief privé du compte B");
  assert.equal(f.generations, 0); f.dispose();
});
