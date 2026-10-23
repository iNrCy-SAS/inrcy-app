import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { applyReferenceImageOrder, moveImageKeyToTarget, setImageKeysForChannel } from "../../app/dashboard/booster/publier/imageChannelAssignment.ts";
import { getActionablePublicationWarningCodes, getPublicationMediaPoolDefaults } from "../../app/dashboard/booster/publier/publicationMediaPool.ts";

const parse = (path: string) => ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const modal = parse("app/dashboard/booster/publier/PublishModal.tsx");
const controller = parse("app/dashboard/booster/publier/usePublishImageController.ts");

function callback(source: ts.SourceFile, name: string, scope: Record<string, unknown>, boardProp = false, component = "PublishValidationBoard") {
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (!boardProp && ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer;
    if (boardProp && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === component) {
      const attribute = node.attributes.properties.find((entry) => ts.isJsxAttribute(entry) && entry.name.getText(source) === name);
      if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) expression = attribute.initializer.expression;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(expression, `Missing callback ${name}`);
  const output = ts.transpileModule(`const value = (${expression.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), `${output}\nreturn value;`)(...Object.values(scope));
}

test("pool defaults choose the video for YouTube, ordered images elsewhere, and respect each channel limit", () => {
  const channels = ["site_web", "facebook", "x", "youtube_shorts"] as const;
  const keys = ["a", "b", "c", "d", "e"];
  const defaults = getPublicationMediaPoolDefaults(channels, keys, true, (channel) => channel === "x" ? 4 : 5);
  assert.deepEqual(defaults.modes, { site_web: "images", facebook: "images", x: "images", youtube_shorts: "video" });
  assert.deepEqual(defaults.selections.facebook, keys);
  assert.deepEqual(defaults.selections.x, ["a", "b", "c", "d"]);
  assert.equal(defaults.selections.youtube_shorts, undefined);
  assert.deepEqual(getPublicationMediaPoolDefaults(channels, [], true, () => 5).modes, { site_web: "video", facebook: "video", x: "video", youtube_shorts: "video" });
  assert.ok(Object.values(getPublicationMediaPoolDefaults(channels, [], false, () => 5).modes).every((mode) => mode === "none"));
  defaults.selections.facebook?.pop();
  assert.equal(keys.length, 5, "channel selections never mutate the source pool");
});

test("routine Pinterest notices stay out of warning triangles while actionable warnings remain", () => {
  const codes = ["pinterest_multi_image", "pinterest_board_selected", "pinterest_video_cover_auto", "tiktok_photo_settings_validated", "linkedin_video_finalization", "pinterest_url_invalid", "video_duration_exceeded", "title_too_long"];
  assert.deepEqual(getActionablePublicationWarningCodes(codes), ["pinterest_url_invalid", "video_duration_exceeded", "title_too_long"]);
  assert.equal(codes.length, 8, "display filtering must not remove provider diagnostics from the execution result");
});

test("image shortcuts hand the selected source to iNrStudio and keep the publication return context", async () => {
  const calls: Array<{ tab: string; source: { file: unknown }; context: { imageKey: string; channel: string; draftId: string } }> = [];
  const opened: string[] = [];
  const sourceFile = { name: "second.jpg" };
  const openInrStudioImageTool = callback(modal, "openInrStudioImageTool", {
    images: [{ name: "first.jpg" }, sourceFile], makeImageKey: (file: { name: string }) => file.name,
    previewByKey: { "second.jpg": "blob:second" }, imagePreparationItems: [],
    setImgError: (message: string) => assert.fail(message),
    preparePublicationDraftForStudio: async () => ({ draftId: "draft", returnHref: "/dashboard?action=publish&draftId=draft" }),
    createInrStudioHandoff: async (input: typeof calls[number]) => { calls.push(input); return { href: `/dashboard/generer-media?studio_tab=${input.tab}` }; },
    openStudio: (href: string) => opened.push(href),
  });
  const props = { openInrStudioImageTool, activeImageChannel: "facebook", imageKeys: ["first.jpg", "second.jpg"] };
  callback(modal, "onModifyImage", props, true, "PublishMediaPoolPanel")(1);
  callback(modal, "onRetouchImage", props, true, "PublishMediaPoolPanel")(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((entry) => entry.tab), ["modify", "retouch"]);
  assert.ok(calls.every((entry) => entry.source.file === sourceFile));
  assert.ok(calls.every((entry) => entry.context.imageKey === "second.jpg" && entry.context.channel === "facebook" && entry.context.draftId === "draft"));
  assert.deepEqual(opened, ["/dashboard/generer-media?studio_tab=modify", "/dashboard/generer-media?studio_tab=retouch"]);
});

function assignment() {
  const pool = ["a", "b", "c"];
  const transform = { zoom: 2, offsetX: 10 };
  const state = {
    editors: { facebook: { imageKeys: ["a", "b"], transforms: { a: transform } }, instagram: { imageKeys: ["b", "c"], transforms: {} } } as Record<string, { imageKeys: string[]; transforms: Record<string, unknown> }>,
    modes: { facebook: "images", instagram: "images" } as Record<string, string>,
    active: { facebook: "a" } as Record<string, string>,
  };
  const scope = () => ({
    imageKeys: pool, channelImageEditors: state.editors, imageMetaByKey: {},
    setChannelImageEditors: (update: (value: typeof state.editors) => typeof state.editors) => { state.editors = update(state.editors); },
    setChannelMediaModes: (update: (value: typeof state.modes) => typeof state.modes) => { state.modes = update(state.modes); },
    setActiveImageKeyByChannel: (update: (value: typeof state.active) => typeof state.active) => { state.active = update(state.active); },
    getImpactedImageChannels: (channel: string) => [channel], getBoosterMaxImageCountForChannel: () => 5,
    getOptimizedTransform: () => ({ zoom: 1 }), setImageKeysForChannel, moveImageKeyToTarget,
  });
  const board = (name: string) => callback(modal, name, {
    ...scope(), resolveChannelMediaMode: (channel: string) => state.modes[channel],
    setChannelMediaMode: (channel: string, mode: string) => { state.modes[channel] = mode; },
    removeImagesFromChannel: callback(controller, "removeImagesFromChannel", scope()),
    toggleChannelImage: callback(controller, "toggleChannelImage", scope()),
  }, true);
  return { state, pool, transform, board, reorder: () => callback(controller, "moveChannelImageTo", scope()) };
}

test("validation removes and restores only the requested channel media, preserving sources and other channels", () => {
  const h = assignment();
  const other = h.state.editors.instagram;
  h.board("onToggleImage")("facebook", "a");
  assert.deepEqual(h.state.editors.facebook.imageKeys, ["b"]);
  h.board("onToggleImage")("facebook", "b");
  assert.deepEqual(h.state.editors.facebook.imageKeys, []);
  assert.equal(h.state.modes.facebook, "none");
  h.board("onAddImage")("facebook", "c");
  assert.deepEqual(h.state.editors.facebook.imageKeys, ["c"], "adding after removal must not restore every source");
  assert.equal(h.state.modes.facebook, "images");
  assert.equal(h.state.editors.instagram, other);
  assert.deepEqual(h.pool, ["a", "b", "c"]);
});

test("switching from video adds exactly the chosen image; ordering preserves transforms and every other channel", () => {
  const h = assignment();
  const other = h.state.editors.instagram;
  h.reorder()("facebook", "a", "b");
  assert.deepEqual(h.state.editors.facebook.imageKeys, ["b", "a"]);
  assert.equal(h.state.editors.facebook.transforms.a, h.transform);
  assert.equal(h.state.editors.instagram, other);
  h.state.modes.facebook = "video";
  h.board("onAddImage")("facebook", "c");
  assert.deepEqual(h.state.editors.facebook.imageKeys, ["c"]);
  assert.equal(h.state.editors.instagram, other);
});

test("reordering pool files keeps their previews and metadata paired and preserves each channel's media selection", () => {
  const files = [{ name: "a" }, { name: "b" }, { name: "c" }];
  const transforms = { a: { zoom: 2 }, c: { zoom: 1.5 } };
  const customized = ["a"];
  const state = {
    files, previews: ["blob:a", "blob:b", "blob:c"],
    editors: {
      facebook: { imageKeys: ["a", "c"], transforms, customizedImageKeys: customized },
      instagram: { imageKeys: [], transforms: {} },
    },
  };
  const metadata = { a: { width: 100 }, b: { width: 200 }, c: { width: 300 } };
  const persisted: unknown[][] = [];
  const scope = {
    imageKeys: files.map((file) => file.name), imageFileByKey: Object.fromEntries(files.map((file) => [file.name, file])),
    previewByKey: { a: "blob:a", b: "blob:b", c: "blob:c" }, imageMetaByKey: metadata,
    makeImageKey: (file: { name: string }) => file.name, moveImageKeyToTarget, applyReferenceImageOrder,
    setImages: (next: typeof files) => { state.files = next; },
    setImagePreviews: (next: string[]) => { state.previews = next; },
    setChannelImageEditors: (update: (value: typeof state.editors) => typeof state.editors) => { state.editors = update(state.editors); },
    setChannelMediaModes: () => assert.fail("Reordering must not change image/video choices"),
    syncPersistentWorkspaceImages: (...args: unknown[]) => persisted.push(args),
  };
  callback(controller, "movePoolImageTo", scope)("c", "a");
  assert.deepEqual(state.files, [files[2], files[0], files[1]]);
  assert.deepEqual(state.previews, ["blob:c", "blob:a", "blob:b"]);
  assert.deepEqual(state.editors.facebook.imageKeys, ["c", "a"]);
  assert.deepEqual(state.editors.instagram.imageKeys, [], "explicit removals stay removed");
  assert.equal(state.editors.facebook.transforms, transforms);
  assert.equal(state.editors.facebook.customizedImageKeys, customized);
  assert.deepEqual(persisted, [[state.files, [
    { source_metadata: metadata.c }, { source_metadata: metadata.a }, { source_metadata: metadata.b },
  ]]]);
  const currentFiles = state.files;
  callback(controller, "movePoolImageTo", scope)("missing", "a");
  assert.equal(state.files, currentFiles, "an invalid drag must not change files or persist anything");
  assert.equal(persisted.length, 1);
});

test("changing only the pool order does not reset per-channel image/video choices", () => {
  const signature = (imageKeys: string[], videoPreviewUrl: string) => callback(modal, "mediaPoolSignature", { imageKeys, videoPreviewUrl });
  const initial = signature(["a", "b", "c"], "blob:video");
  assert.equal(signature(["c", "a", "b"], "blob:video"), initial);
  assert.notEqual(signature(["a", "b"], "blob:video"), initial);
  assert.notEqual(signature(["a", "b", "c", "d"], "blob:video"), initial);
  assert.notEqual(signature(["a", "b", "c"], ""), initial);
});
