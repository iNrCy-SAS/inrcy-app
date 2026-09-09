import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the shared settings drawer keeps every configuration panel inside the responsive viewport", () => {
  const drawer = read("app/dashboard/SettingsDrawer.tsx");
  const content = read("app/dashboard/_components/DashboardSettingsDrawerContent.tsx");
  const css = read("app/dashboard/dashboard.module.css");

  assert.match(drawer, /data-dashboard-settings-drawer="true"/);
  assert.match(drawer, /width: isPhone[\s\S]*?\? "100%"/);
  assert.match(drawer, /flexDirection: "column"/);
  assert.match(drawer, /data-dashboard-settings-drawer-scroll="true"[\s\S]*?minHeight: 0[\s\S]*?overflowY: "auto"/);
  assert.match(content, /className=\{styles\.settingsDrawerContent\}/);
  assert.match(css, /\.settingsDrawerContent[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(css, /\.settingsDrawerContent :where\(input, select, textarea, fieldset, table, img, video, iframe\)/);
});

test("Google Business stacks controls on phones instead of clipping its establishment selector", () => {
  const panel = read("app/dashboard/_components/GoogleBusinessPanel.tsx");
  const css = read("app/dashboard/dashboard.module.css");

  assert.match(panel, /className=\{styles\.channelConfigPanel\}/);
  assert.ok((panel.match(/className=\{styles\.channelConfigActionRow\}/g) || []).length >= 3);
  assert.match(panel, /className=\{`\$\{styles\.channelConfigField\} \$\{styles\.selectReadable\}`\}/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.channelConfigActionRow[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.channelConfigActionRow > \*[\s\S]*?width: 100% !important;/);
});
