import * as speechBudget from "../../lib/aiMediaVideoSpeechBudget.ts";
import * as inspirationImagePolicy from "../../lib/studioInspirationImagePolicy.ts";
import assert from "node:assert/strict";
import * as studioForm from "../../lib/inrAssistantStudioFormSelection.ts";
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
    if (specifier.endsWith("useInrAssistantLocalInterface")) return { useInrAssistantLocalInterface() {} };
    if (specifier === "@/lib/inrAssistantStudioFormSelection") return studioForm;
    if (specifier === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => null };
    if (specifier === "@/lib/studioInspirationImagePolicy") return inspirationImagePolicy;
    if (specifier === "@/lib/aiMediaVideoSpeechBudget") return speechBudget;
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
  modules.set("react", { useId: () => "reason-free", useRef: (value: unknown) => ({ current: value }), useEffect() {}, useLayoutEffect() {}, useCallback(callback: unknown, deps: unknown[]) {
    const index = cursor++;
    const slot = slots[index] as { callback: unknown; deps: unknown[] } | undefined;
    if (!slot || slot.deps.length !== deps.length || deps.some((value, at) => value !== slot.deps[at])) slots[index] = { callback, deps };
    return (slots[index] as { callback: unknown }).callback;
  }, useState: (initial: unknown) => {
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
  for (const path of ["./MediaLibraryPickerModal", "./MediaSubjectVoiceButton", "./MediaQuotaSummary", "./MediaPromptHelp", "./MediaBusinessDnaHelp", "./MediaCharacterVoiceInput"]) modules.set(path, { __esModule: true, default: path });
  modules.set("./MediaGenerationCreationWorkspace", { __esModule: true, default: "preview", MediaGenerationSettingsTabs: "settings-tabs" });
  modules.set("./MediaGenerationCreationWorkspace.module.css", styles); modules.set("./MediaFreeGenerator.module.css", styles);
  modules.set("../_hooks/useMediaEnginePreference", { __esModule: true, default: () => ({ videoEngine: options.engine || "omni", imageEngine: options.imageEngine || "openai", videoResolution: "720p", update() {} }) });
  modules.set("../_hooks/useMediaCreditQuote", { __esModule: true, default: () => ({ ready: options.quoteReady !== false, insufficient: false, authorization: {}, quote: { totalCredits: 1 } }) });
  modules.set("@/lib/aiMediaModelRecommendation", { recommendAiMediaModel: () => null });
  modules.set("./MediaEngineCreditControls", { __esModule: true, default: "engine-controls", isMediaVideoReferenceCompatible: controls().component.isMediaVideoReferenceCompatible, MediaCreditQuoteSummary: "credit-summary", MediaGenerationActions: "actions" });
  const component = load<{ default: (props: FreeProps) => Element }>("app/dashboard/_components/MediaFreeGenerator.tsx", modules);
  const render = () => { cursor = 0; return component.default({ source: "studio", acceptMode: "library", mediaType: options.kind || "video", initialPrompt: options.prompt ?? "Une baleine traverse les nuages.", onAccepted() {} }); };
  return { render, openImages() { const tree = render(); const launcher = find(tree, node => node.props["data-media-role-add"] === "inspiration"); (launcher.props.onClick as () => void)(); return render(); } };
}
const reference = (id: number, role?: "product" | "character", usage?: "required" | "inspiration"): Reference => ({ id: `ref-${id}`, mimeType: "image/png", data: "A".repeat(64), fromVideo: false, role, usage });
const imagesLauncher = (tree: unknown) => find(tree, node => node.props["data-media-role-add"] === "inspiration");
const imagesWarning = (tree: unknown) => {
  const warning = elements(tree).find(node => node.props["data-reference-warning"] !== undefined);
  if (!warning) return "";
  assert.equal(warning.type, "p", "The explanation is visible text rather than a screen-reader-only span");
  assert.notEqual(warning.props.className, "srOnly");
  return text(warning.props.children).replace(/^!/, "");
};
const promptError = (tree: unknown) => text(elements(tree).find(node => node.props.role === "alert" && String(node.props.id).endsWith("-visual-brief-error")));

test("a single visible reference explanation names the photo-based engine without four identical role alerts", () => {
  for (const engine of ["wan-flash", "wan27"] as const) {
    const tree = freeEditor({ engine }).render();
    const message = t("ai_generator_reference_photo_needed", { model: models.getAiMediaVideoModel(engine).label });
    assert.equal(imagesWarning(tree), message);
    const warnings = elements(tree).filter(node => node.props["data-reference-warning"] !== undefined);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].props.role, "status");
    const launchers = elements(tree).filter(node => node.props["data-media-role-add"] !== undefined);
    assert.equal(launchers.length, 4);
    for (const launcher of launchers) {
      assert.equal(launcher.props["data-invalid"], undefined);
      assert.equal(elements(launcher).some(node => node.props.className === "referenceIconWarning"), false);
      assert.equal(launcher.props["aria-describedby"], warnings[0].props.id);
      assert.ok(String(launcher.props["data-inrcy-tooltip-title"]).includes(message), "The tooltip explains the actual requirement too");
    }
    assert.equal(promptError(tree), "");
  }
});

test("les lanceurs Images expliquent la photo obligatoire sous Wan et le détail natif ne la présente pas comme facultative", () => {
  const runtime = freeEditor({ engine: "wan-flash" });
  const dialog = find(runtime.openImages(), node => typeof node.type === "function" && node.type.name === "MediaSettingsDialog");
  assert.equal(dialog.props.addRole, "inspiration");
  assert.ok(!text(dialog).includes(t("ai_generator_free_optional")));
  assert.equal(find(dialog, node => node.type === "input" && node.props.type === "file").props.disabled, false, "the required-photo warning still leads to a usable native import");
  assert.equal(elements(dialog).some(node => node.props["data-reference-add-role"] !== undefined), false, "the chosen role is not requested twice");
  const ready = freeEditor({ engine: "wan-flash", references: [reference(1, "product", "required")] }).render();
  assert.equal(imagesWarning(ready), "");
});

test("les erreurs de références restent dans Images et l’autorisation finale reste au footer", () => {
  const incomplete = freeEditor({ references: [reference(1)] }).render();
  assert.equal(imagesWarning(incomplete), t("ai_generator_free_reference_criteria_required"));
  const exceeded = freeEditor({ references: [1, 2, 3, 4].map((id) => reference(id, "character", "required")) }).render();
  assert.equal(imagesWarning(exceeded), t("ai_generator_free_role_limit"));
  const flaggedRoles = elements(exceeded).filter(node => node.props["data-media-role-add"] !== undefined && node.props["data-invalid"]);
  assert.deepEqual(flaggedRoles.map(node => node.props["data-media-role-add"]), ["character"], "The person limit marks only the relevant role");
  const invalidThumbnail = find(incomplete, node => node.props.className === "mediaReferenceThumb");
  assert.equal(invalidThumbnail.props["data-invalid"], true, "An incomplete existing reference remains visibly marked");
  const thumbnailButton = find(invalidThumbnail, node => node.props["data-media-reference-open"] !== undefined);
  assert.ok(thumbnailButton.props["aria-describedby"]);
  assert.ok(String(thumbnailButton.props.title).includes(t("ai_generator_free_reference_criteria_required")));
  const runtime = freeEditor({ references: [reference(1, "character", "required"), reference(2, "character", "required")] });
  let tree = runtime.render(); assert.equal(imagesWarning(tree), "", "L’autorisation manquante ne doit pas renvoyer vers Images");
  const footer = find(tree, (node) => node.props["data-media-footer"] !== undefined);
  const authorization = find(footer, (node) => node.props["data-media-final-authorization"] !== undefined);
  const checkbox = find(authorization, (node) => node.type === "input" && node.props.type === "checkbox");
  assert.equal(checkbox.props.checked, false);
  assert.equal(find(tree, (node) => node.props["data-media-primary-action"] !== undefined).props.disabled, true);
  (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
  tree = runtime.render(); assert.equal(imagesWarning(tree), "");
  assert.equal(find(tree, (node) => node.props["data-media-primary-action"] !== undefined).props.disabled, false);
});

test("les avertissements du panneau unique distinguent les références, la consigne, les crédits et une génération en cours", () => {
  for (const options of [{ kind: "image" as const }, { quoteReady: false }, { remaining: 0 }]) {
    const tree = freeEditor(options).render(); assert.equal(imagesWarning(tree), ""); assert.equal(promptError(tree), "");
  }
  const empty = freeEditor({ prompt: "" }).render();
  assert.equal(find(empty, node => node.type === "textarea").props.value, "");
  assert.equal(find(empty, node => node.props["data-media-primary-action"] !== undefined).props.disabled, true, "une consigne vide ne peut pas lancer une génération");
  assert.equal(imagesWarning(empty), "", "une consigne vide ne devient pas une erreur de photo");
  const long = freeEditor({ engine: "wan-flash", references: [reference(1, "product", "required")], prompt: "x".repeat(501) }).render();
  assert.equal(promptError(long), t("ai_generator_video_brief_too_long", { max: 500 })); assert.equal(imagesWarning(long), "");
  const locked = freeEditor({ engine: "wan-flash", busy: true }).render(); assert.equal(promptError(locked), ""); assert.equal(imagesWarning(locked), ""); assert.equal(imagesLauncher(locked).props.disabled, true);
  const image = freeEditor({ kind: "image", imageEngine: "recraft", references: [reference(1, "product", "required")] }).render();
  assert.equal(imagesWarning(image), t("ai_generator_image_references_unavailable"));
});
