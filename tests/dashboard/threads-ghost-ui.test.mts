import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { DEFAULT_THREADS_PUBLICATION_PREFERENCES as enabled, CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES as disabled, parseThreadsPublicationSettings } from "../../lib/threadsPublicationPreferences.ts";
import { getEffectiveThreadsMediaMode, getThreadsPublicationModeIssue } from "../../app/dashboard/booster/publier/threadsPublicationUi.ts";

const read = (file: string) => readFileSync(new URL("../../" + file, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const source = ts.createSourceFile("PublishModal.tsx", read("app/dashboard/booster/publier/PublishModal.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find<T extends ts.Node>(predicate: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(source); return found;
}
function variable(name: string) {
  const node = find((node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node) && node.name.getText(source) === name)[0];
  assert.ok(node?.initializer, name);
  return node.initializer.getText(source);
}
function runtime(mode: "classic" | "ghost", mediaMode: "images" | "video" = "images") {
  const mapping = { instagram: { imageKeys: ["photo"], transforms: {} }, threads: { imageKeys: ["photo"], transforms: {} } };
  const code = compile("const resolveStoredChannelMediaMode = " + variable("resolveStoredChannelMediaMode") + "; const resolveChannelMediaMode = " + variable("resolveChannelMediaMode") + "; const buildChannelRecord = " + variable("buildChannelRecord") + "; return { resolveChannelMediaMode, buildChannelRecord };");
  const result = new Function("images", "channelImageEditors", "channelMediaModes", "videoFile", "videoPreviewUrl", "threadsPublicationMode", "channelSupportsImages", "getEffectiveThreadsMediaMode", code)(["photo"], mapping, { instagram: mediaMode, threads: mediaMode }, mediaMode === "video" ? {} : null, mediaMode === "video" ? "video.mp4" : "", mode, (channel: string) => channel !== "youtube_shorts", getEffectiveThreadsMediaMode);
  return { ...result, mapping };
}
const translations = JSON.parse(read("messages/fr-FR/booster.json"));
const require = createRequire(import.meta.url);
const componentModule = { exports: {} as { default?: (props: Record<string, unknown>) => ReturnType<typeof createElement> } };
new Function("require", "module", "exports", compile(read("app/dashboard/booster/publier/components/ThreadsPublicationModeControls.tsx")))((id: string) => {
  if (id === "next-intl") return { useTranslations: () => (key: string) => translations[key] };
  if (id === "../threadsPublicationUi") return { getThreadsPublicationModeIssue };
  if (id === "../publishModal.styles") return { pillBtn: {}, pillBtnActive: {} };
  return require(id);
}, componentModule, componentModule.exports);
const renderControls = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(componentModule.exports.default!, { mode: "classic", preferences: enabled, loading: false, failed: false, onChange() {}, ...props }));

test("actual Booster resolver suppresses only Threads media and Classic restores its original mapping", () => {
  for (const mediaMode of ["images", "video"] as const) {
    const ghost = runtime("ghost", mediaMode);
    assert.equal(ghost.resolveChannelMediaMode("threads"), "none");
    assert.equal(ghost.resolveChannelMediaMode("instagram"), mediaMode);
    assert.deepEqual(ghost.mapping.threads.imageKeys, ["photo"]);
    const classic = runtime("classic", mediaMode);
    assert.equal(classic.resolveChannelMediaMode("threads"), mediaMode);
    assert.deepEqual(classic.mapping, ghost.mapping);
  }
});

test("Ghost remains explicit and blocked through load, failure and disabled preferences", () => {
  assert.equal(getThreadsPublicationModeIssue("ghost", disabled, true, false), "threads_ghost_preferences_loading");
  assert.equal(getThreadsPublicationModeIssue("ghost", disabled, false, true), "threads_ghost_preferences_error");
  assert.equal(getThreadsPublicationModeIssue("ghost", disabled, false, false), "threads_ghost_disabled");
  assert.equal(getThreadsPublicationModeIssue("ghost", enabled, false, false), null);
  assert.equal(getThreadsPublicationModeIssue("classic", disabled, true, true), null);
  assert.equal(parseThreadsPublicationSettings({ mode: "ghost" }).mode, "ghost");
});

test("actual mode controls explain archive at 24h and retain disabled Ghost selection without choosing Classic", () => {
  const markup = renderControls({ mode: "ghost", preferences: disabled });
  assert.match(markup, /Ghost : texte seul, 500 caractères maximum, archivé après 24 h/);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /aria-pressed="true"[^>]*disabled=""[^>]*>Ghost<\/button>/);
  assert.match(markup, /aria-pressed="false"[^>]*>Classique<\/button>/);
  assert.match(markup, /choisissez explicitement Classique/);
  assert.doesNotMatch(renderControls({ mode: "classic" }), /role="alert"/);
  assert.match(renderControls({ loading: true }), /aria-pressed="false"[^>]*disabled=""[^>]*>Ghost<\/button>/);
});

function fields(object: ts.ObjectLiteralExpression, context: Record<string, unknown>) {
  const properties = object.properties.filter((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && ["mediaModeByChannel", "imagesByChannel", "imageSettingsByChannel", "threadsPublicationSettings"].includes(property.name.getText(source)));
  const expression = "({" + properties.map(property => property.getText(source)).join(",") + "})";
  return new Function(...Object.keys(context), compile("return " + expression + ";"))(...Object.values(context));
}
test("actual immediate and scheduled payloads preserve Ghost while removing only Threads images and settings", () => {
  const direct = find((node): node is ts.CallExpression => ts.isCallExpression(node) && node.expression.getText(source) === "trackEvent" && node.arguments[0]?.getText(source) === '"publish"')[0].arguments[1] as ts.ObjectLiteralExpression;
  const scheduled = find((node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node) && node.name.getText(source) === "publishPayload" && ts.isObjectLiteralExpression(node.initializer))[0].initializer as ts.ObjectLiteralExpression;
  const ghost = runtime("ghost");
  const context = { buildChannelRecord: ghost.buildChannelRecord, buildChannelUnknownRecord: ghost.buildChannelRecord, resolveChannelMediaMode: ghost.resolveChannelMediaMode, publishTargetChannels: ["instagram", "threads"], publishableChannels: ["instagram", "threads"], groupChannels: ["instagram", "threads"], publishTargetMediaModeByChannel: { instagram: "images", threads: "none" }, publishMediaModeByChannel: { instagram: "images", threads: "none" }, uploadedChannelImages: { instagram: ["photo"], threads: ["photo"] }, channelSettings: ghost.mapping, threadsPublicationMode: "ghost" };
  for (const object of [direct, scheduled]) {
    const payload = fields(object, context);
    assert.deepEqual(payload.mediaModeByChannel, { instagram: "images", threads: "none" });
    assert.deepEqual(payload.imagesByChannel, { instagram: ["photo"] });
    assert.equal(payload.imageSettingsByChannel.threads, undefined);
    assert.deepEqual(payload.imageSettingsByChannel.instagram.imageKeys, ["photo"]);
    assert.deepEqual(payload.threadsPublicationSettings, { mode: "ghost" });
    assert.deepEqual(ghost.mapping.threads.imageKeys, ["photo"]);
  }
});

test("actual draft payload keeps Ghost and original channel images for reopening or switching back", () => {
  const draft = find((node): node is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(node) && node.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "status" && property.initializer.getText(source) === '"draft"'))[0];
  assert.ok(draft);
  const setting = draft.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "threadsPublicationSettings") as ts.PropertyAssignment;
  const images = draft.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "imageSettingsByChannel") as ts.PropertyAssignment;
  const ghost = runtime("ghost");
  const payload = new Function("threadsPublicationMode", "getDraftImageSettingsByChannel", compile("return ({" + setting.getText(source) + "," + images.getText(source) + "});"))("ghost", () => ghost.mapping);
  assert.deepEqual(payload.threadsPublicationSettings, { mode: "ghost" });
  assert.deepEqual(payload.imageSettingsByChannel.threads.imageKeys, ["photo"]);
  assert.deepEqual(payload.imageSettingsByChannel.instagram.imageKeys, ["photo"]);
});
