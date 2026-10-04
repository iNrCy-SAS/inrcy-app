import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the shared settings drawer keeps every configuration panel inside the responsive viewport", () => {
  const drawer = read("app/dashboard/SettingsDrawer.tsx");
  const content = read("app/dashboard/_components/DashboardSettingsDrawerContent.tsx");
  const css = read("app/dashboard/dashboard.module.css");

  assert.match(drawer, /data-dashboard-settings-drawer="true"/);
  assert.match(drawer, /data-dashboard-settings-drawer="true"[\s\S]*?width: "100%",[\s\S]*?maxWidth: "100%"/);
  assert.doesNotMatch(drawer, /min\(560px, 92%\)/);
  assert.match(drawer, /const drawerHeight = viewportHeight \? `\$\{viewportHeight\}px` : "100dvh"/);
  assert.match(drawer, /top: viewportOffsetTop/);
  assert.doesNotMatch(drawer, /MOBILE_BOTTOM_NAV_HEIGHT/);
  assert.match(drawer, /height: "100%"/);
  assert.match(drawer, /flexDirection: "column"/);
  assert.match(drawer, /data-dashboard-settings-drawer-scroll="true"[\s\S]*?minHeight: 0[\s\S]*?overflowY: "auto"/);
  assert.match(content, /className=\{styles\.settingsDrawerContent\}/);
  assert.match(css, /\.settingsDrawerContent[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(css, /\.settingsDrawerContent :where\(input, select, textarea, fieldset, table, img, video, iframe\)/);
});

test("fullscreen settings lock page scrolling and restore it when closed", () => {
  const drawer = read("app/dashboard/SettingsDrawer.tsx");
  assert.match(drawer, /document\.body\.style\.overflow = "hidden"/);
  assert.match(drawer, /document\.documentElement\.style\.overflow = "hidden"/);
  assert.match(drawer, /document\.documentElement\.style\.overscrollBehavior = "none"/);
  assert.match(drawer, /document\.body\.style\.overflow = previousBodyOverflow/);
  assert.match(drawer, /document\.documentElement\.style\.overflow = previousRootOverflow/);
  assert.match(drawer, /document\.documentElement\.style\.overscrollBehavior = previousRootOverscroll/);
});

test("settings keep keyboard focus inside the active dialogue and restore their trigger", () => {
  const drawer = read("app/dashboard/SettingsDrawer.tsx");
  assert.match(drawer, /ref=\{dialogRef\}[\s\S]*?role="dialog"[\s\S]*?tabIndex=\{-1\}/);
  assert.match(drawer, /if \(event\.defaultPrevented \|\| !isTopmostDialog\(dialog\)\) return/);
  assert.match(drawer, /if \(event\.key !== "Tab"\) return/);
  assert.match(drawer, /event\.shiftKey \? active === first : active === last/);
  assert.match(drawer, /\(event\.shiftKey \? last : first\)\.focus\(\{ preventScroll: true \}\)/);
  assert.match(drawer, /querySelectorAll<HTMLElement>\("\[aria-controls\]"\)/);
  assert.match(drawer, /previousFocus\?\.isConnected/);
  assert.match(drawer, /previousFocus\.focus\(\{ preventScroll: true \}\)/);
  // Opening for the first time must also install focus handling when no portal was prepared.
  assert.match(drawer, /\}, \[hasBeenOpened, isOpen, portalReady\]\)/);
  assert.match(drawer, /document\.removeEventListener\("focusin", onFocusIn\)/);
});

test("configuration headers keep the close action compact and accessible on responsive screens", () => {
  const drawer = read("app/dashboard/SettingsDrawer.tsx");

  assert.match(drawer, /aria-label=\{t\.drawer\.close\}/);
  assert.match(drawer, /title=\{t\.drawer\.close\}/);
  assert.match(drawer, /width: isResponsive \? 40 : undefined/);
  assert.match(drawer, /height: isResponsive \? 40 : undefined/);
  assert.match(drawer, /padding: isResponsive \? 0/);
  assert.match(drawer, /<span aria-hidden="true">\{isResponsive \? "×" : t\.drawer\.close\}<\/span>/);
});

test("Google Business stacks controls on phones instead of clipping its establishment selector", () => {
  const panel = read("app/dashboard/_components/GoogleBusinessPanel.tsx");
  const stepCss = read("app/dashboard/_components/ChannelPanelSteps.module.css");
  const editableFieldCss = read("app/dashboard/_components/EditableChannelUrlField.module.css");

  assert.match(panel, /className=\{`\$\{stepStyles\.panel\} \$\{stepStyles\.googlePanel\}`\}/);
  assert.ok((panel.match(/className=\{stepStyles\.actionRow\}/g) || []).length >= 2);
  assert.match(panel, /<EditableChannelUrlField[\s\S]*?channel="gmb"/);
  assert.match(panel, /styles\.selectReadable[\s\S]*?stepStyles\.control[\s\S]*?stepStyles\.wideControl/);
  assert.match(stepCss, /@media \(max-width: 720px\)[\s\S]*?\.actionRow[\s\S]*?flex-wrap: wrap;/);
  assert.match(stepCss, /\.wideControl[\s\S]*?flex: 1 1 320px;/);
  assert.match(editableFieldCss, /@media \(max-width: 720px\)[\s\S]*?grid-template-columns: 1fr 1fr;[\s\S]*?grid-column: 1 \/ -1;/);
});

test("Pinterest keeps reconnect and disconnect balanced on a 393px viewport", () => {
  const panel = read("app/dashboard/settings/_components/PinterestSettingsContent.tsx");
  const stepCss = read("app/dashboard/settings/_components/ChannelSettingsSteps.module.css");

  assert.match(
    panel,
    /className=\{`\$\{guideStyles\.actionRow\} \$\{guideStyles\.pinterestConnectionActions\}`\}/,
  );
  assert.match(
    panel,
    /className=\{`\$\{styles\.actionBtn\} \$\{styles\.pinterestConfigActionBtn\} \$\{styles\.secondaryBtn\}`\}[\s\S]*?onClick=\{connectPinterest\}[\s\S]*?disabled=\{loading \|\| syncing\}/,
  );
  assert.match(
    panel,
    /className=\{`\$\{styles\.actionBtn\} \$\{styles\.pinterestConfigActionBtn\} \$\{styles\.disconnectBtn\}`\}[\s\S]*?onClick=\{disconnectPinterest\}[\s\S]*?disabled=\{syncing\}/,
  );
  assert.match(
    stepCss,
    /@media \(max-width: 720px\)[\s\S]*?\.pinterestConnectionActions \{[\s\S]*?width: 100%;[\s\S]*?flex-wrap: nowrap;[\s\S]*?\.pinterestConnectionActions > :is\(button, a\) \{[\s\S]*?min-width: 0;[\s\S]*?flex: 1 1 0;[\s\S]*?white-space: nowrap;/,
  );
  assert.match(
    stepCss,
    /@media \(max-width: 320px\)[\s\S]*?\.pinterestConnectionActions \{[\s\S]*?flex-wrap: wrap;/,
  );
});
