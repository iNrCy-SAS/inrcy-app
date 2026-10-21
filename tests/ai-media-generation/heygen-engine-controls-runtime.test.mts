import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { IntlMessageFormat } from "intl-messageformat";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as videoOptions from "../../lib/aiMediaVideoClientOptions.ts";

type Element = { type: unknown; props: Record<string, unknown> };
type ControlsProps = Parameters<typeof import("../../app/dashboard/_components/MediaEngineCreditControls.tsx").default>[0];
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const jsx = (type: unknown, props: Record<string, unknown> | null): Element => ({ type, props: props || {} });
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === "object" && "props" in tree ? [tree as Element, ...elements((tree as Element).props.children)] : [];
const text = (tree: unknown): string => Array.isArray(tree) ? tree.map(text).join("") : typeof tree === "string" || typeof tree === "number" ? String(tree) : tree && typeof tree === "object" && "props" in tree ? text((tree as Element).props.children) : "";
function find(tree: unknown, predicate: (element: Element) => boolean) {
  const element = elements(tree).find(predicate);
  assert.ok(element, "Expected rendered control is missing");
  return element;
}

function controls(overrides: Partial<ControlsProps> = {}, locale = "fr-FR") {
  const messages = JSON.parse(read(`messages/${locale}/media.json`)) as Record<string, string>;
  const t = (key: string, values: Record<string, string | number> = {}) => {
    assert.equal(typeof messages[key], "string", `Missing ${locale} translation: ${key}`);
    return String(new IntlMessageFormat(messages[key], locale).format(values));
  };
  const states: unknown[] = []; let cursor = 0;
  const changes: unknown[][] = [];
  const modules = new Map<string, unknown>([
    ["react", { useId: () => "heygen-controls", useRef: () => ({ current: null }), useEffect() {}, useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? (value as (current: unknown) => unknown)(states[index]) : value; }];
    } }],
    ["react/jsx-runtime", { jsx, jsxs: jsx, Fragment: "fragment" }],
    ["next-intl", { useLocale: () => locale, useTranslations: () => t }],
    ["@/lib/aiMediaModelCatalog", models], ["@/lib/aiMediaVideoTimeline", timeline],
    ["@/lib/aiMediaVideoClientOptions", videoOptions],
    ["./MediaEngineCreditControls.module.css", { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) }],
  ]);
  const file = "app/dashboard/_components/MediaEngineCreditControls.tsx";
  const output = ts.transpileModule(read(file), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const record = { exports: {} as { default: (props: ControlsProps) => Element } };
  new Function("module", "exports", "require", output)(record, record.exports, (name: string) => {
    assert.ok(modules.has(name), `Unexpected UI dependency: ${name}`);
    return modules.get(name);
  });
  const props: ControlsProps = { kind: "video", videoEngine: "omni", imageEngine: "openai", resolution: "720p", referenceCount: 0, brief: "Une personne salue devant son atelier.", disabled: false, durationSeconds: 8, sceneMode: "single", videoMaxDurationSeconds: 30,
    onVideoEngineChange: (...value) => changes.push(["engine", ...value]), onImageEngineChange: (...value) => changes.push(["image", ...value]), onResolutionChange: (...value) => changes.push(["resolution", ...value]), onDurationSceneChange: (...value) => changes.push(["duration", ...value]), ...overrides };
  const render = () => { cursor = 0; return record.exports.default(props); };
  const renderInfo = () => {
    const opened = render();
    const modal = find(opened, (element) => typeof element.type === "function");
    return (modal.type as (props: Record<string, unknown>) => Element)(modal.props);
  };
  return { render, renderInfo, changes, t, openInfo() {
    const trigger = find(render(), (element) => element.props["aria-haspopup"] === "dialog");
    (trigger.props.onClick as () => void)();
    const opened = render();
    assert.equal(find(opened, (element) => element.props["aria-haspopup"] === "dialog").props["aria-expanded"], true);
    return renderInfo();
  } };
}

test("retired HeyGen has no family or quality in the engine menu, including supplied voices", () => {
  for (const hasProvidedCharacterVoice of [false, true]) {
    const tree = controls({ hasProvidedCharacterVoice }).render();
    assert.ok(!elements(tree).some((element) => element.type === "optgroup" && element.props.label === "HeyGen"));
    assert.ok(!elements(tree).some((element) => element.type === "option" && String(element.props.value).startsWith("heygen:")));
  }
});

test("available engine and quality choices continue to reach the selection callback", () => {
  const runtime = controls({ videoEngine: "omni", resolution: "720p" });
  const tree = runtime.render();
  const select = find(tree, (element) => element.type === "select" && String(element.props.id).endsWith("-engine"));
  assert.equal(elements(select).filter((element) => element.type === "option").length, 16);
  const option = find(select, (element) => element.type === "option" && element.props.value === "grok-lite:1080p");
  assert.equal(option.props.disabled, false);
  (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "grok-lite:1080p" } });
  assert.deepEqual(runtime.changes, [["engine", "grok-lite", "1080p"]]);
  assert.equal(find(controls().render(), (element) => element.type === "select" && String(element.props.id).endsWith("-engine")).props.value, "omni:720p");
});

test("the information guide excludes retired HeyGen at every account duration and remains closable", () => {
  for (const maximum of [15, 20, 30]) {
    const runtime = controls({ videoMaxDurationSeconds: maximum, disabled: true });
    const tree = runtime.render();
    assert.ok(!find(tree, (element) => element.type === "fieldset").props.disabled, "The information button must remain available during generation");
    assert.ok(elements(tree).filter((element) => element.type === "select").every((element) => element.props.disabled === true), "Generation settings remain locked");
    assert.ok(!find(tree, (element) => element.props["aria-haspopup"] === "dialog").props.disabled);
    const dialog = runtime.openInfo();
    assert.equal(dialog.type, "dialog");
    assert.doesNotMatch(text(dialog), /HeyGen/i);
    assert.deepEqual(elements(dialog).filter((element) => element.type === "h3").map(text), [models.getAiMediaVideoModel("omni").label]);
    assert.ok(text(dialog).includes(runtime.t("ai_generator_engine_info_cost_note")), "The guide still explains what the displayed Studio cost covers");
    assert.doesNotMatch(text(dialog), /50\s*%|\$|USD|31 octobre/, "Wholesale promotions must not imply a permanent client discount");
    const close = find(dialog, (element) => element.type === "button" && element.props["aria-label"] === runtime.t("ai_generator_engine_info_close"));
    (close.props.onClick as () => void)();
    assert.equal(find(runtime.render(), (element) => element.props["aria-haspopup"] === "dialog").props["aria-expanded"], false);
  }
});

test("the compact guide keeps every model accessible while showing one translated detail without changing the generation engine", () => {
  for (const locale of ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    for (const kind of ["video", "image"] as const) {
      const runtime = controls({ kind }, locale);
      let dialog = runtime.openInfo();
      const catalogue = kind === "video" ? models.AI_MEDIA_AVAILABLE_VIDEO_MODELS : models.AI_MEDIA_IMAGE_MODELS;
      for (const model of catalogue) {
        const choices = elements(dialog).filter((element) => element.type === "button" && "aria-pressed" in element.props);
        assert.equal(choices.length, catalogue.length, `${locale}: all ${kind} choices remain available`);
        const choice = choices.find((element) => text(element).includes(model.label));
        assert.ok(choice, `${locale}: ${model.label}`);
        (choice.props.onClick as () => void)();
        dialog = runtime.renderInfo();
        const headings = elements(dialog).filter((element) => element.type === "h3");
        assert.deepEqual(headings.map(text), [model.label], "Only the viewed model has a detailed card");
        assert.ok(text(dialog).includes(runtime.t(`ai_generator_engine_info_${kind}_use_${model.id}`)), locale);
        assert.ok(text(dialog).includes(runtime.t(`ai_generator_engine_info_${kind}_limits_${model.id}`)), locale);
        if (kind === "video") assert.doesNotMatch(text(dialog), /HeyGen/i);
        assert.doesNotMatch(text(dialog), /ai_generator_|\{seconds\}/);
      }
      assert.deepEqual(runtime.changes, [], "Browsing information must not alter generation settings");
    }
  }
});
