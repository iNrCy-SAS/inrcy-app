import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("the dashboard activates a route-scoped dark browser surface", () => {
  const layout = read("app/dashboard/layout.tsx");
  const globals = read("app/globals.css");

  assert.match(layout, /inrcy-dashboard-shell/);
  assert.match(globals, /html:has\(\.inrcy-dashboard-shell\)/);
  assert.match(globals, /body:has\(\.inrcy-dashboard-shell\)/);
  assert.match(globals, /background-color: #0b142c/);
});

test("the mobile dashboard keeps a continuous dark rendering surface", () => {
  const css = read("app/dashboard/dashboard.module.css");

  assert.match(css, /\.shell \{[\s\S]*background-color: #0b142c/);
  assert.match(css, /\.mobileViewport \{[\s\S]*overscroll-behavior-y: contain[\s\S]*background-color: #0b142c/);
});

test("the bottom dock prevents compositor seams while preserving its border", () => {
  const css = read("app/dashboard/_components/ResponsiveBottomNav.module.css");
  const barStart = css.indexOf("  .bar {");
  const itemStart = css.indexOf("  .item,", barStart);
  const barBlock = css.slice(barStart, itemStart);

  assert.ok(barStart >= 0 && itemStart > barStart);
  assert.match(barBlock, /border-top: 1px solid rgba\(255, 255, 255, 0\.15\)/);
  assert.match(barBlock, /background-color: #070c1d/);
  assert.match(barBlock, /backdrop-filter: none/);
  assert.match(barBlock, /0 -1px 0 rgba\(16, 23, 49, 0\.995\)/);
  assert.match(barBlock, /\.bar::after \{[\s\S]*top: -1px[\s\S]*height: 1px/);
  assert.doesNotMatch(barBlock, /display: none/);
  assert.doesNotMatch(barBlock, /border-top: none/);
});

test("shared header actions switch to icon mode across the tablet breakpoint", () => {
  const css = read("app/dashboard/_components/ResponsiveActionButton.module.css");

  assert.match(
    css,
    /@media \(max-width: 900px\)\s*\{[\s\S]*?\.text\{ display:none; \}[\s\S]*?\.icon\{ display:inline; \}/,
  );
  assert.doesNotMatch(css, /@media \(max-width: 720px\)/);
});
