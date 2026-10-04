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
  assert.match(workspace, /openBusinessDna = \(\) => void requestNavigation/);
  assert.match(workspace, /router\.push\("\/dashboard\/adn-entreprise"\)/);
  assert.match(workspace, /onClick: openBusinessDna,[\s\S]*?disabled: voiceBusy/);
});

test("AI configuration surfaces are modal and keep the page stationary", () => {
  assert.match(configurationSurface, /presentation = "drawer"/);
  assert.match(configurationSurface, /presentation === "workspace"/);
  assert.match(configurationSurface, /previousFocusRef\.current\?\.focus/);
  assert.match(configurationSurface, /getElementById\("inrcy-dialog-title"\)/);
  assert.match(configurationSurface, /globalDialog\?\.contains\(target\)/);
  assert.match(configurationSurface, /event\.key === "Escape"/);
  assert.match(configurationSurface, /event\.stopPropagation\(\)/);
  assert.match(configurationSurface, /event\.key !== "Tab"/);
  assert.match(configurationSurface, /getFocusableElements\(workspace\)/);
  const sharedSurface = configurationSurface.slice(
    configurationSurface.indexOf("function PublishAiConfigurationSideDrawer"),
    configurationSurface.indexOf("export default function PublishAiConfigurationDrawer"),
  );
  assert.match(sharedSurface, /createPortal\(/);
  assert.match(sharedSurface, /document\.documentElement\.style\.overflow = "hidden"/);
  assert.match(sharedSurface, /previousFocus\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(sharedSurface, /window\.visualViewport\?\.height/);
  assert.match(sharedSurface, /data-ai-configuration-fullscreen-header[\s\S]*?flex: "0 0 auto"/);
  assert.match(sharedSurface, /data-ai-configuration-fullscreen-scroll[\s\S]*?minHeight: 0[\s\S]*?overflowY: "auto"/);
  assert.match(sharedSurface, /<AiConfigurationContent[\s\S]*?workspaceMode/);
  assert.doesNotMatch(sharedSurface, /MOBILE_DOCK_HEIGHT|min\(560px, 92vw\)/);
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
