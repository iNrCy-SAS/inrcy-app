import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import { catalogTranslator } from "../helpers/catalog-translator.mts";

type Row = Record<string, unknown>;
type Element = { type: unknown; props: Row };
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const registry = ts.createSourceFile("registry.ts", read("lib/aiGeneratedMediaRegistry.ts"), ts.ScriptTarget.Latest, true);
function registryFunction<T>(name: string, context: Row): T {
  const declaration = registry.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Actual registry function ${name} exists`);
  const output = ts.transpileModule(`const run = (${declaration.getText(registry)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(context), `${output}; return run;`)(...Object.values(context)) as T;
}
const projection = registryFunction<(metadata: Row | null | undefined) => boolean>("hasSpeechReviewWarning", {});
const sourceConstants = { GENERATED_SOURCE: "ai_media_generation", GENERATED_DRAFT_SOURCE: "ai_media_generation_draft" };
const serialize = registryFunction<(row: Row) => Promise<contracts.AiMediaLibraryPickerItem>>("toPickerItem", {
  hasSpeechReviewWarning: projection,
  isGeneratedDraft: registryFunction("isGeneratedDraft", sourceConstants),
  isAcceptedGeneratedMedia: registryFunction("isAcceptedGeneratedMedia", sourceConstants),
  buildMediaLibraryContentUrl: (id: string) => `/api/media-library/items/${id}/content`,
  createSafeStorageSignedUrl: () => assert.fail("Generated results keep their authenticated preview route"),
  BUCKET: "inrcy-pro-media", CONTENT_URL_TTL_SECONDS: 600,
});
function row(metadata: unknown, accepted = false, mediaType = "video"): Row {
  return { id: "owned-video", bucket_name: "inrcy-pro-media", storage_path: "private/owned-video.mp4", original_file_name: "video.mp4",
    media_type: mediaType, mime_type: "video/mp4", size_bytes: 1024, title: "Vidéo", tags: [], width: 1080, height: 1920,
    duration_seconds: 16, created_at: "2026-11-17T01:00:00Z", upload_status: "uploaded", is_active: accepted,
    source: accepted ? sourceConstants.GENERATED_SOURCE : sourceConstants.GENERATED_DRAFT_SOURCE, media_metadata: metadata };
}
const decision = { version: 1, status: "warning", code: "native_speech_review_recommended", issues: ["spoken_critical_value_mismatch"], sceneIndexes: [0] };

test("fresh, accepted and composition-recovered videos expose only a safe review flag while preserving rejected raw QA", async () => {
  const metadata = { gateway: { quality_assurance: { native_dialogue: { status: "rejected", privateTranscript: "PRIVATE_SPEECH_CANARY" }, native_dialogue_delivery: decision } } };
  const before = structuredClone(metadata);
  for (const accepted of [false, true]) {
    const item = await serialize(row(metadata, accepted));
    assert.equal(item.speech_review_recommended, true);
    assert.ok(item.signed_url?.startsWith("/api/"));
    assert.equal(Object.hasOwn(item, "media_metadata"), false);
    assert.equal(JSON.stringify(item).includes("PRIVATE_SPEECH_CANARY"), false);
  }
  assert.deepEqual(metadata, before, "Presentation never relabels rejected exact speech as passed");
  const recovered = await serialize(row({ gateway: { warnings: ["native_speech_review_recommended"], quality_assurance: { final_video: { status: "ok" } } } }));
  assert.equal(recovered.speech_review_recommended, true, "The durable checkpoint's fixed warning survives recovery");
  const voiceover = await serialize(row({ gateway: { quality_assurance: { native_voiceover_delivery: decision } } }));
  assert.equal(voiceover.speech_review_recommended, true);
});

test("ordinary, malformed, unknown-warning and image results keep their existing public contract", async () => {
  for (const metadata of [null, {}, { gateway: [] }, { gateway: { warnings: ["another_warning", "native_speech_review_recommended_extra"] } },
    { gateway: { quality_assurance: { native_dialogue: { status: "rejected" } } } },
    ...[{ ...decision, version: 2 }, { ...decision, status: "passed" }, { ...decision, code: "another_warning" }]
      .map(value => ({ gateway: { quality_assurance: { native_dialogue_delivery: value } } }))]) {
    assert.equal(Object.hasOwn(await serialize(row(metadata)), "speech_review_recommended"), false);
  }
  assert.equal(Object.hasOwn(await serialize(row({ gateway: { quality_assurance: { native_dialogue_delivery: decision } } }, false, "image")), "speech_review_recommended"), false);
});

function ui() {
  const jsx = (type: unknown, props: Row): Element => ({ type, props: props || {} });
  const t = catalogTranslator("media");
  const modules = new Map<string, unknown>([
    ["react", { useId: () => "speech-review", useState: (value: unknown) => [value, () => {}], useCallback: (value: unknown) => value }],
    ["react/jsx-runtime", { jsx, jsxs: jsx }], ["next/image", { __esModule: true, default: "image" }],
    ["next-intl", { useTranslations: () => t }], ["@/lib/aiMediaGenerationContracts", contracts], ["@/lib/aiMediaModelCatalog", models],
    ["@/app/dashboard/_hooks/useMediaResultReveal", { useMediaResultReveal: () => ({ reviewRef: { current: null }, headingRef: { current: null } }) }],
    ["../_hooks/useInrAssistantLocalInterface", { useInrAssistantLocalInterface() {} }],
    ["@/lib/browserAccountCache", { getActiveBrowserUserId: () => "account-a" }],
    ["./MediaEngineCreditControls", { MediaGenerationActions: "actions" }],
    ["./DashboardMobileSelect", { __esModule: true, default: "mobile-select" }], ["./MediaResultViewer", { __esModule: true, default: "result-viewer" }],
  ]);
  const file = "app/dashboard/_components/MediaGenerationCreationWorkspace.tsx";
  const output = ts.transpileModule(read(file), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const record = { exports: {} as Row };
  new Function("module", "exports", "require", output)(record, record.exports, (name: string) => {
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) };
    assert.ok(modules.has(name), `Expected UI dependency ${name}`); return modules.get(name);
  });
  return record.exports.default as (props: Row) => unknown;
}
function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const element = tree as Element;
  if (typeof element.type === "function") return elements((element.type as (props: Row) => unknown)(element.props));
  return [element, ...elements(element.props.children)];
}
const text = (tree: unknown): string => Array.isArray(tree) ? tree.map(text).join("") : typeof tree === "string" || typeof tree === "number" ? String(tree)
  : tree && typeof tree === "object" && "props" in tree ? text((tree as Element).props.children) : "";

test("the actual shared result shows one compact notice only for flagged videos and keeps preview and acceptance available", async () => {
  const render = ui(), t = catalogTranslator("media");
  const item = await serialize(row({ gateway: { warnings: ["native_speech_review_recommended"] } }));
  for (const variant of ["full", "embedded"]) for (const recovered of [false, true]) {
    let accepts = 0, generations = 0;
    const result = { item, format: "story", draft: true, recovered, videoEngineResult: "kling", quota: { accountId: "account-a" } };
    const props = { accountId: "account-a", variant, kind: "video", format: "story", durationSeconds: 16, progress: 100, operationLocked: false,
      finishing: false, generationResult: result, generationCancellable: false, cancelConfirmationOpen: false, disabled: false, acceptMode: "insert",
      setCancelConfirmationOpen() {}, handleRequestGenerationStop() {}, handleConfirmGenerationStop() {}, handleEditCriteria() {},
      handleConfirm() { accepts++; }, handleSaveToLibrary() {}, handleGenerate() { generations++; } };
    const nodes = elements(render(props));
    const warnings = nodes.filter(node => Object.hasOwn(node.props, "data-media-speech-review-warning"));
    assert.equal(warnings.length, 1); assert.equal(warnings[0].props.role, "status");
    assert.ok(text(warnings[0]).includes(t("ai_generator_speech_review_warning")));
    assert.equal(elements(warnings[0]).some(node => ["input", "button"].includes(String(node.type))), false, "No extra approval or action is introduced");
    const video = nodes.find(node => node.type === "video"); assert.ok(video); assert.equal(video.props.controls, true); assert.equal(video.props.src, item.signed_url);
    const confirm = nodes.find(node => node.type === "button" && node.props.className === "confirmButton"); assert.ok(confirm); assert.equal(confirm.props.disabled, false);
    assert.equal(accepts, 0); assert.equal(generations, 0); (confirm.props.onClick as () => void)(); assert.equal(accepts, 1); assert.equal(generations, 0);
    for (const ordinaryItem of [{ ...item, speech_review_recommended: undefined }, { ...item, media_type: "image" }]) {
      assert.equal(elements(render({ ...props, generationResult: { ...result, item: ordinaryItem } })).some(node => Object.hasOwn(node.props, "data-media-speech-review-warning")), false);
    }
  }
});

test("all nine media catalogues provide the compact review notice", () => {
  for (const locale of ["fr-FR", "en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const message = JSON.parse(read(`messages/${locale}/media.json`)).ai_generator_speech_review_warning;
    assert.equal(typeof message, "string"); assert.ok(message.length > 10 && message.length < 120);
  }
});
