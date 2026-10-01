import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const configurationSurface = read(
  "app/dashboard/booster/publier/components/PublishAiConfigurationDrawer.tsx",
);

test("Booster opens AI configuration as the real full-screen workspace", () => {
  assert.match(
    publishModal,
    /<PublishAiConfigurationDrawer[\s\S]*?presentation="workspace"[\s\S]*?onClose=\{\(\) => setAiConfigurationOpen\(false\)\}/,
  );

  const workspace = configurationSurface.slice(
    configurationSurface.indexOf("function PublishAiConfigurationWorkspace"),
    configurationSurface.indexOf("function PublishAiConfigurationSideDrawer"),
  );
  assert.match(workspace, /createPortal\(/);
  assert.match(workspace, /data-ai-configuration-workspace-overlay/);
  assert.match(workspace, /role="dialog"/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(workspace, /position: "fixed"/);
  assert.match(workspace, /top: viewportOffsetTop/);
  assert.match(workspace, /right: 0/);
  assert.match(workspace, /left: 0/);
  assert.match(workspace, /width: "100vw"/);
  assert.match(workspace, /height: drawerHeight/);
  assert.match(workspace, /boxSizing: "border-box"/);
  assert.match(workspace, /<DashboardWorkspaceHeader/);
  assert.match(workspace, /<AiConfigurationContent[\s\S]*?workspaceMode/);
  assert.doesNotMatch(workspace, /min\(560px, 92vw\)/);
});

test("the full-screen workspace explicitly returns to the mounted Booster context", () => {
  const workspace = configurationSurface.slice(
    configurationSurface.indexOf("function PublishAiConfigurationWorkspace"),
    configurationSurface.indexOf("function PublishAiConfigurationSideDrawer"),
  );
  assert.match(workspace, /label: i18nT\("retour_dans_booster_publier"\)/);
  assert.match(workspace, /onClick: \(\) => void confirmExit\(\)/);
  assert.match(workspace, /onConfirmExit: onClose/);
  assert.match(workspace, /onUnsavedChange=\{setHasUnsavedChanges\}/);
  assert.match(workspace, /onSaved=\{\(\) => \{[\s\S]*?setHasUnsavedChanges\(false\);[\s\S]*?onClose\(\)/);
  assert.doesNotMatch(workspace, /router\.(?:push|replace)|window\.location/);
});

test("the workspace is modal, keyboard-contained and leaves shared drawers unchanged", () => {
  assert.match(configurationSurface, /presentation = "drawer"/);
  assert.match(configurationSurface, /presentation === "workspace"/);
  assert.match(configurationSurface, /previousFocusRef\.current\?\.focus/);
  assert.match(configurationSurface, /getElementById\("inrcy-dialog-title"\)/);
  assert.match(configurationSurface, /globalDialog\?\.contains\(target\)/);
  assert.match(configurationSurface, /event\.key === "Escape"/);
  assert.match(configurationSurface, /event\.stopPropagation\(\)/);
  assert.match(configurationSurface, /event\.key !== "Tab"/);
  assert.match(configurationSurface, /getFocusableElements\(workspace\)/);
  assert.match(configurationSurface, /MOBILE_DOCK_HEIGHT/);
  assert.match(configurationSurface, /min\(560px, 92vw\)/);
});

test("every Booster catalogue exposes the explicit return label", () => {
  for (const locale of [
    "fr-FR",
    "en-GB",
    "es-ES",
    "it-IT",
    "de-DE",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ]) {
    const catalogue = JSON.parse(read(`messages/${locale}/booster.json`));
    assert.equal(
      typeof catalogue.retour_dans_booster_publier,
      "string",
      `${locale}.retour_dans_booster_publier`,
    );
    assert.ok(catalogue.retour_dans_booster_publier.trim().length > 0);
  }
});
