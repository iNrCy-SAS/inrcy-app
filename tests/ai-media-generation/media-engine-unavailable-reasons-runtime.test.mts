import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { IntlMessageFormat } from "intl-messageformat";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as videoOptions from "../../lib/aiMediaVideoClientOptions.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as voices from "../../lib/aiMediaNarrationVoices.ts";
import * as mediaRules from "../../lib/mediaRules.ts";
import * as characterVoices from "../../lib/aiMediaCharacterVoiceClient.ts";
import * as characterVoiceRules from "../../lib/aiMediaCharacterVoices.ts";

type Element = { type: unknown; props: Record<string, unknown> };
type ControlsProps = Parameters<typeof import("../../app/dashboard/_components/MediaEngineCreditControls.tsx").default>[0];
type FreeProps = Parameters<typeof import("../../app/dashboard/_components/MediaFreeGenerator.tsx").default>[0];
type Reference = { id: string; mimeType: "image/png"; data: string; fromVideo: boolean; role?: "product" | "character"; usage?: "required" | "inspiration" };
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const messages = JSON.parse(read("messages/fr-FR/media.json")) as Record<string, string>;
const t = (key: string, values: Record<string, string | number> = {}) => String(new IntlMessageFormat(messages[key] || key, "fr-FR").format(values));
const jsx = (type: unknown, props: Record<string, unknown> | null): Element => ({ type, props: props || {} });
function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const node = tree as Element;
  return [node, ...elements(node.props.children)];
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree && typeof tree === "object" && "props" in tree ? text((tree as Element).props.children) : "";
}
function find(tree: unknown, predicate: (node: Element) => boolean) {
  const found = elements(tree).find(predicate); assert.ok(found, "Expected rendered control is missing"); return found;
}
function load<T>(path: string, modules: Map<string, unknown>): T {
  const output = ts.transpileModule(read(path), { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const record = { exports: {} as T };
  new Function("module", "exports", "require", output)(record, record.exports, (specifier: string) => {
    assert.ok(modules.has(specifier), `Unexpected dependency: ${specifier}`); return modules.get(specifier);
  });
  return record.exports;
}
const styles = { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) };
const commonModules = new Map<string, unknown>([
  ["react/jsx-runtime", { jsx, jsxs: jsx, Fragment: "fragment" }],
  ["next-intl", { useLocale: () => "fr-FR", useTranslations: () => t }],
  ["@/lib/aiMediaModelCatalog", models], ["@/lib/aiMediaVideoTimeline", timeline],
  ["@/lib/aiMediaVideoClientOptions", videoOptions], ["./MediaEngineCreditControls.module.css", styles],
]);

function controls(overrides: Partial<ControlsProps> = {}) {
  const effects: Array<() => void> = []; const changes: unknown[][] = [];
  const modules = new Map(commonModules);
  modules.set("react", { useId: () => "reason-controls", useRef: () => ({ current: null }), useState: (initial: unknown) => [initial, () => {}], useEffect: (callback: () => void) => effects.push(callback) });
  const component = load<{ default: (props: ControlsProps) => Element; isMediaVideoReferenceCompatible: (engine: models.AiMediaVideoEngine, count: number) => boolean }>("app/dashboard/_components/MediaEngineCreditControls.tsx", modules);
  const props: ControlsProps = { kind: "video", videoEngine: "omni", imageEngine: "openai", resolution: "720p", referenceCount: 0, brief: "Une baleine traverse les nuages.", disabled: false, durationSeconds: 8, sceneMode: "single", videoMaxDurationSeconds: 30,
    onVideoEngineChange: (...value) => changes.push(["engine", ...value]), onImageEngineChange: (...value) => changes.push(["image", ...value]), onResolutionChange: (...value) => changes.push(["resolution", ...value]), onDurationSceneChange: (...value) => changes.push(["duration", ...value]), ...overrides };
  const tree = component.default(props);
  return { tree, effects, changes, component, props };
}
const engineOption = (tree: unknown, value: string) => find(tree, (node) => node.type === "option" && node.props.value === value);
const selectEngine = (tree: unknown, value: string) => {
  const select = find(tree, (node) => node.type === "select" && String(node.props.id).endsWith("-engine"));
  (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
};

test("Wan 2.6 est grisé sans référence avec une raison précise, indépendamment de la durée choisie", () => {
  for (const durationSeconds of [8, 20, 30]) {
    const runtime = controls({ durationSeconds });
    for (const resolution of ["720p", "1080p"]) {
      const option = engineOption(runtime.tree, `wan-flash:${resolution}`);
      assert.equal(option.props.disabled, true);
      assert.ok(text(option).includes(t("ai_generator_model_photo_required")));
      assert.ok(!text(option).includes(t("ai_generator_model_unavailable_short")));
      selectEngine(runtime.tree, `wan-flash:${resolution}`);
    }
    assert.deepEqual(runtime.changes, [], "Une sélection forcée ne contourne pas le besoin de photo.");
  }
});

test("une référence active Wan et le changement de moteur adapte ensuite la durée native", () => {
  const runtime = controls({ referenceCount: 1 });
  for (const resolution of ["720p", "1080p"]) assert.equal(engineOption(runtime.tree, `wan-flash:${resolution}`).props.disabled, false);
  selectEngine(runtime.tree, "wan-flash:720p");
  assert.deepEqual(runtime.changes, [["engine", "wan-flash", "720p"]], "La durée de huit secondes est déjà compatible avec Wan.");
  const thirtySeconds = controls({ referenceCount: 1, durationSeconds: 30 });
  selectEngine(thirtySeconds.tree, "wan-flash:720p");
  assert.deepEqual(thirtySeconds.changes, [["duration", 30, "multi"], ["engine", "wan-flash", "720p"]], "Trente secondes exigent deux scènes avec Wan.");
  const multiple = controls({ referenceCount: 5 });
  assert.equal(engineOption(multiple.tree, "wan-flash:720p").props.disabled, false, "Les références Studio sont composées dans une seule première image.");
  const tooLong = controls({ referenceCount: 1, brief: "x".repeat(1501) });
  assert.equal(engineOption(tooLong.tree, "wan-flash:720p").props.disabled, true);
  assert.ok(text(engineOption(tooLong.tree, "wan-flash:720p")).includes(t("ai_generator_engine_brief_too_long")));
});

test("les références précomposées ne bloquent pas artificiellement la résolution Grok", () => {
  for (const referenceCount of [2, 5]) {
    const runtime = controls({ referenceCount });
    assert.equal(engineOption(runtime.tree, "grok:720p").props.disabled, false);
    assert.equal(engineOption(runtime.tree, "grok:1080p").props.disabled, false);
    selectEngine(runtime.tree, "grok:1080p"); assert.deepEqual(runtime.changes, [["engine", "grok", "1080p"]]);
  }
  assert.equal(engineOption(controls({ referenceCount: 1 }).tree, "grok:1080p").props.disabled, false);
  const automatic = controls({ videoEngine: "grok", resolution: "1080p", referenceCount: 2 });
  automatic.effects.forEach((effect) => effect()); assert.deepEqual(automatic.changes, [], "Le nombre de photos Studio ne réduit pas silencieusement la qualité.");
  const compatible = controls({ videoEngine: "grok", resolution: "720p", referenceCount: 2 });
  compatible.effects.forEach((effect) => effect()); assert.deepEqual(compatible.changes, []);
  const locked = controls({ videoEngine: "grok", resolution: "1080p", referenceCount: 2, disabled: true });
  locked.effects.forEach((effect) => effect()); assert.deepEqual(locked.changes, [], "La génération en cours conserve son contrat.");
});

function freeEditor(options: { kind?: "image" | "video"; engine?: models.AiMediaVideoEngine; imageEngine?: models.AiMediaImageEngine; references?: Reference[]; prompt?: string; busy?: boolean; remaining?: number; quoteReady?: boolean } = {}) {
  const slots: unknown[] = []; let cursor = 0;
  const modules = new Map(commonModules);
  modules.set("react", { useId: () => "reason-free", useRef: (value: unknown) => ({ current: value }), useEffect() {}, useLayoutEffect() {}, useState: (initial: unknown) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = Array.isArray(initial) ? options.references || [] : typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? (next as (current: unknown) => unknown)(slots[index]) : next; }];
  } });
  modules.set("@/app/dashboard/_hooks/useMediaGeneration", { __esModule: true, default: () => ({ quota: { accountId: "test-account", creditsReady: true, studioEnabled: true, credits: { remaining: options.remaining ?? 1000 }, videoMaxDurationSeconds: 30 }, quotaLoading: false, busy: options.busy ?? false, progress: 0, error: "", result: null, originChangedNotice: false, cancellable: false, cancellationPending: false, canRecover: false, loadQuota() {}, generate() { assert.fail("These UI tests must never submit generation."); } }), MediaGenerationAccountChangedError: Error, MediaGenerationCancelledError: Error });
  modules.set("@/lib/multicompte/constants", { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" });
  modules.set("@/lib/aiMediaGenerationContracts", contracts); modules.set("@/lib/aiMediaNarrationVoices", voices); modules.set("@/lib/mediaRules", mediaRules);
  modules.set("@/lib/mediaGenerationReferenceClient", {});
  modules.set("@/lib/aiMediaCharacterVoiceClient", characterVoices);
  modules.set("@/lib/aiMediaCharacterVoices", characterVoiceRules);
  for (const path of ["./MediaLibraryPickerModal", "./MediaSubjectVoiceButton", "./MediaQuotaSummary", "./MediaPromptHelp", "./MediaCharacterVoiceInput"]) modules.set(path, { __esModule: true, default: path });
  modules.set("./MediaGenerationCreationWorkspace", { __esModule: true, default: "preview", MediaGenerationSettingsTabs: "settings-tabs" });
  modules.set("./MediaGenerationCreationWorkspace.module.css", styles); modules.set("./MediaFreeGenerator.module.css", styles);
  modules.set("../_hooks/useMediaEnginePreference", { __esModule: true, default: () => ({ videoEngine: options.engine || "omni", imageEngine: options.imageEngine || "openai", videoResolution: "720p", update() {} }) });
  modules.set("../_hooks/useMediaCreditQuote", { __esModule: true, default: () => ({ ready: options.quoteReady !== false, insufficient: false, authorization: {}, quote: { totalCredits: 1 } }) });
  modules.set("@/lib/aiMediaModelRecommendation", { recommendAiMediaModel: () => null });
  modules.set("./MediaEngineCreditControls", { __esModule: true, default: "engine-controls", isMediaVideoReferenceCompatible: controls().component.isMediaVideoReferenceCompatible, MediaCreditQuoteSummary: "credit-summary", MediaGenerationActions: "actions" });
  const component = load<{ default: (props: FreeProps) => Element }>("app/dashboard/_components/MediaFreeGenerator.tsx", modules);
  const render = () => { cursor = 0; return component.default({ source: "studio", acceptMode: "library", mediaType: options.kind || "video", initialPrompt: options.prompt ?? "Une baleine traverse les nuages.", onAccepted() {} }); };
  return { render };
}
const reference = (id: number, role?: "product" | "character", usage?: "required" | "inspiration"): Reference => ({ id: `ref-${id}`, mimeType: "image/png", data: "A".repeat(64), fromVideo: false, role, usage });
const warnings = (tree: unknown) => find(tree, (node) => node.type === "settings-tabs").props.tabs as Array<{ id: string; warning: string }>;
const warning = (tree: unknown, id: string) => warnings(tree).find((tab) => tab.id === id)?.warning;

test("Critères explique la photo obligatoire sous Wan sans la présenter comme facultative ni répéter le message", () => {
  const tree = freeEditor({ engine: "wan-flash" }).render();
  assert.equal(warning(tree, "criteria"), t("ai_generator_model_photo_required"));
  assert.equal(warning(tree, "prompt"), "");
  const references = find(tree, (node) => node.props.className === "referencesSection");
  assert.ok(!text(references).includes(t("ai_generator_free_optional")));
  const alerts = elements(references).filter((node) => node.props.role === "alert");
  assert.equal(alerts.length, 1); assert.equal(text(alerts[0]), t("ai_generator_model_photo_required"));
  const ready = freeEditor({ engine: "wan-flash", references: [reference(1, "product", "required")] }).render();
  assert.equal(warning(ready, "criteria"), "");
});

test("les raisons précises des références et autorisations disparaissent lorsqu’elles sont complétées", () => {
  const incomplete = freeEditor({ references: [reference(1)] }).render();
  assert.equal(warning(incomplete, "criteria"), t("ai_generator_free_reference_criteria_required"));
  const exceeded = freeEditor({ references: [1, 2, 3, 4].map((id) => reference(id, "character", "required")) }).render();
  assert.equal(warning(exceeded, "criteria"), t("ai_generator_free_role_limit"));
  const runtime = freeEditor({ references: [reference(1, "character", "required"), reference(2, "character", "required")] });
  let tree = runtime.render(); assert.equal(warning(tree, "criteria"), t("ai_generator_video_character_consent_required"));
  const authorize = (tree: Element, index: number) => {
    const consent = elements(tree).filter((node) => node.type === "label" && node.props.className === "consent")[index]; assert.ok(consent);
    const checkbox = find(consent, (node) => node.type === "input" && node.props.type === "checkbox");
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
  };
  authorize(tree, 0); tree = runtime.render(); assert.equal(warning(tree, "criteria"), t("ai_generator_team_video_consent_required"));
  authorize(tree, 1); tree = runtime.render(); assert.equal(warning(tree, "criteria"), "");
  assert.equal(find(tree, (node) => node.props["data-media-primary-action"] !== undefined).props.disabled, false);
});

test("les avertissements concernent le bon onglet et ne confondent pas critères, crédits ou génération en cours", () => {
  for (const options of [{ kind: "image" as const }, { quoteReady: false }, { remaining: 0 }]) {
    const tree = freeEditor(options).render(); assert.equal(warning(tree, "criteria"), ""); assert.equal(warning(tree, "prompt"), "");
  }
  assert.equal(warning(freeEditor({ prompt: "" }).render(), "prompt"), t("ai_generator_idea_required"));
  const long = freeEditor({ engine: "wan-flash", references: [reference(1, "product", "required")], prompt: "x".repeat(1501) }).render();
  assert.equal(warning(long, "prompt"), t("ai_generator_engine_brief_too_long")); assert.equal(warning(long, "criteria"), "");
  const locked = freeEditor({ engine: "wan-flash", busy: true }).render(); assert.equal(warning(locked, "prompt"), ""); assert.equal(warning(locked, "criteria"), "");
  const image = freeEditor({ kind: "image", imageEngine: "recraft", references: [reference(1, "product", "required")] }).render();
  assert.equal(warning(image, "criteria"), t("ai_generator_image_references_unavailable"));
});
