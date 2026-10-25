import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { channelItem, channelNodes, channelRuntime, workspaceConnection } from "../helpers/channel-bubble-runtime.mts";

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
  assert.match(content, /className=\{(?:styles\.settingsDrawerContent|`\$\{styles\.settingsDrawerContent\}[^`]*`)\}/);
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
  const css = read("app/dashboard/_components/DashboardChannelBubble.module.css");
  const editableFieldCss = read("app/dashboard/_components/EditableChannelUrlField.module.css");
  const connection = workspaceConnection({ item: channelItem, gmbPanelProps: { gmbAccountConnected: true, gmbConfigured: true, gmbLocations: [], gmbLocationName: "locations/1", gmbLocationLabel: "Une entreprise avec un nom très long", saveGmbLocation() {} } });
  const tree = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx").render({ item: { ...channelItem, connection } });
  assert.equal(channelNodes(tree).find(node => node.type === "select")!.props.value, "locations/1");
  assert.equal(connection.publicLinks.props.channel, "gmb");
  assert.match(css, /\.resourceGroup\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
  assert.match(css, /\.resourcePill select\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
  assert.match(css, /\.resourcePill select\s*\{[^}]*text-overflow:\s*ellipsis;/);
  assert.match(editableFieldCss, /@media \(max-width: 720px\)[\s\S]*?grid-template-columns: 1fr 1fr;[\s\S]*?grid-column: 1 \/ -1;/);
});

test("Pinterest exposes one connection action at a time and keeps controls inside the responsive bubble", () => {
  const runtime = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const css = read("app/dashboard/_components/DashboardChannelBubble.module.css");
  const connection = { onConnect() {}, onDisconnect() {}, onSelect() {} };
  for (const connected of [false, true]) {
    const tree = runtime.render({ item: { ...channelItem, key: "pinterest", name: "Pinterest", bubbleStatus: connected ? "connected" : "available", connection: { ...connection, accountConnected: connected } } });
    const actions = channelNodes(tree).filter(node => node.type === "button");
    assert.equal(actions.some(node => node.props["aria-label"] === "Connecter — Pinterest"), !connected);
    assert.equal(actions.some(node => node.props["aria-label"] === "Déconnecter — Pinterest"), connected);
  }
  assert.match(css, /\.workspaceStack\s*\{[^}]*inset:\s*9% 12% max\(15%,\s*54px\)/);
  assert.match(css, /\.connectAction\s*\{[^}]*width:\s*min\(100%,\s*196px\)/);
  assert.match(css, /\.iconAction\s*\{[^}]*flex-shrink:\s*0;[^}]*width:\s*clamp\(/);
});
