import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

test("the native local-close helper waits for its actual callback and accepts only a committed close or unmount", async () => {
  let registration: unknown[] = [], closes = 0, release: (() => void) | undefined;
  const ref = { current: "" };
  const { useInrAssistantLocalClose } = runtimeModules({ react: { useRef: (value: string) => { if (!ref.current) ref.current = value; return ref; }, useLayoutEffect: (callback: () => void) => callback() }, "./useInrAssistantLocalInterface": { useInrAssistantLocalInterface: (...args: unknown[]) => { registration = args; } } })<typeof import("../../app/dashboard/_hooks/useInrAssistantLocalClose.ts")>("app/dashboard/_hooks/useInrAssistantLocalClose.ts");
  useInrAssistantLocalClose("media_import", true, async () => { closes++; await new Promise<void>(resolve => { release = resolve; }); }, true);
  assert.equal(registration[3], true); assert.equal(registration[4], true, "a busy native import remains blocked");
  const handler = (registration[2] as { close: { invoke: (value: null, stillCurrent: () => boolean) => Promise<void>; matches: (value: unknown) => boolean; allowUnmount: boolean } }).close;
  const pending = handler.invoke(null, () => true); assert.equal(closes, 1); assert.equal(handler.matches({ open: true }), false); release!(); await pending;
  assert.equal(handler.matches({ open: true }), false, "a cancelled native confirmation cannot become success"); assert.equal(handler.matches({ open: false }), true); assert.equal(handler.allowUnmount, true);
  useInrAssistantLocalClose("media_import", false, () => {}); assert.equal(registration[3], false);
  let validAfter = true;
  useInrAssistantLocalClose("media_import", true, async valid => { await new Promise<void>(resolve => { release = resolve; }); validAfter = valid(); }, false, "old selection");
  const guarded = (registration[2] as { close: { invoke: (value: null, stillCurrent: () => boolean) => Promise<void> } }).close.invoke(null, () => true);
  useInrAssistantLocalClose("media_import", true, () => {}, false, "new selection"); release!(); await guarded; assert.equal(validAfter, false, "a native confirmation cannot apply to another selection or changed input");
});

test("Basic modal close bindings call their native cancel callback and preserve operation locks and unsaved guards", () => {
  const expected = [
    ["app/dashboard/_components/GeneratorSettingsModal.tsx", "generator_settings", "onClose", "loading || saving"],
    ["app/dashboard/_components/DashboardBoosterModalLayer.tsx", "booster_stats", "onClose", "mode === \"stats\""],
    ["app/dashboard/booster/publier/components/MediaPoolImagePreview.tsx", "publication_media_preview", "onClose", "!!current"],
    ["app/dashboard/booster/publier/components/PublishContentAdjustmentModal.tsx", "publication_adjustment", "onClose", "busy"],
    ["app/dashboard/booster/publier/components/PublishFinalReviewModal.tsx", "publication_review", "onClose", "saving"],
    ["app/dashboard/booster/publier/components/PublishWarningModals.tsx", "publication_warning", "onCloseOversizedMedia", "!!oversizedMedia || !!emptyContentChannel"],
    ["app/dashboard/_components/channel-image-adapter/frames.tsx", "channel_image_viewer", "onClose", "open && hasImages"],
    ["app/dashboard/_components/channel-image-adapter/modal.tsx", "channel_image_dialog", "confirmExit", "saving"],
    ["app/dashboard/e-reputation/EReputationReviewsClient.tsx", "google_review_details", "requestCloseDetails", "publishing || generating || deleting"],
    ["app/dashboard/mediatheque/MediaLibraryClient.tsx", "media_import", "setImportOpen(false)", "uploading"],
  ];
  for (const [file, id, callback, restriction] of expected) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let registration = ""; const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantLocalClose" && node.arguments[0]?.getText(ast).includes(id)) registration = node.getText(ast); ts.forEachChild(node, visit); }; visit(ast);
    assert.ok(registration.includes(callback), `${id} native callback`); assert.ok(registration.includes(restriction), `${id} native restriction`);
    assert.doesNotMatch(registration, /onConfirm|onApply|handleGenerate|handlePublish|confirmClose\(|confirmReset/);
  }
});

test("the actual unsaved-exit guard rechecks the assistant scope after native confirmation while preserving normal UI confirmation", async () => {
  let release: ((value: boolean) => void) | undefined, current = true, exits = 0;
  const { useUnsavedExitGuard } = runtimeModules({ react: { useCallback: (callback: unknown) => callback, useEffect: () => {}, useRef: (value: unknown) => ({ current: value }) }, "@/lib/inrcyDialog": { confirmInrcy: async () => new Promise<boolean>(resolve => { release = resolve; }) }, "../_components/DashboardUnsavedNavigationProvider": { useDashboardUnsavedNavigation: () => ({ registerGuard: () => () => {} }) } })<typeof import("../../app/dashboard/_hooks/useUnsavedExitGuard.ts")>("app/dashboard/_hooks/useUnsavedExitGuard.ts");
  const native = useUnsavedExitGuard({ active: true, shouldBlock: true, onConfirmExit: () => { exits++; } });
  const stale = native.confirmExitIfCurrent(() => current); current = false; release!(true); assert.equal(await stale, false); assert.equal(exits, 0);
  const manual = native.confirmExit(); release!(true); assert.equal(await manual, true); assert.equal(exits, 1, "the existing direct UI API keeps its original confirmation contract");
});
