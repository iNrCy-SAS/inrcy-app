import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  APP_APPEARANCE_THEMES,
  APP_APPEARANCE_THEME_STORAGE_KEY,
  normalizeAppAppearanceTheme,
} from "../../lib/appAppearanceTheme.ts";

const globalsCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const dashboardCss = readFileSync(new URL("../../app/dashboard/dashboard.module.css", import.meta.url), "utf8");
const channelBubbleCss = readFileSync(new URL("../../app/dashboard/_components/DashboardChannelBubble.module.css", import.meta.url), "utf8");

test("the appearance theme catalog exposes only the supported branded presets", () => {
  assert.deepEqual(APP_APPEARANCE_THEMES, [
    "original",
    "midnight",
    "graphite",
    "soft-violet",
    "pearl-light",
    "azure-light",
  ]);
});

test("unknown or missing appearance themes safely fall back to the original UI", () => {
  assert.equal(normalizeAppAppearanceTheme(undefined), "original");
  assert.equal(normalizeAppAppearanceTheme(""), "original");
  assert.equal(normalizeAppAppearanceTheme("light-custom"), "original");
  assert.equal(normalizeAppAppearanceTheme(" MIDNIGHT "), "midnight");
  assert.equal(normalizeAppAppearanceTheme(" PEARL-LIGHT "), "pearl-light");
  assert.equal(normalizeAppAppearanceTheme("azure-light"), "azure-light");
});

test("the local preview uses its own versioned browser key", () => {
  assert.equal(APP_APPEARANCE_THEME_STORAGE_KEY, "inrcy_app_appearance_theme_v1");
});

test("the original iNrCy theme stays untouched while every alternative owns a complete premium palette", () => {
  assert.doesNotMatch(globalsCss, /html\[data-inrcy-theme=["']original["']\]/);

  for (const theme of APP_APPEARANCE_THEMES.filter((candidate) => candidate !== "original")) {
    const block = globalsCss.match(
      new RegExp(`html\\[data-inrcy-theme="${theme}"\\] \\{([\\s\\S]*?)\\n\\}`),
    )?.[1];

    assert.ok(block, `missing CSS palette for ${theme}`);
    for (const token of [
      "--inrcy-theme-shell-background",
      "--inrcy-theme-page-background",
      "--inrcy-theme-drawer-background",
      "--inrcy-theme-settings-card-background",
      "--inrcy-theme-field-background",
      "--inrcy-theme-text-primary",
      "--inrcy-theme-border-strong",
      "--inrcy-theme-accent-border",
      "--inrcy-theme-shadow-soft",
      "--inrcy-theme-surface-rgb-1",
      "--inrcy-theme-surface-rgb-2",
      "--inrcy-theme-surface-rgb-3",
      "--inrcy-theme-accent-rgb-1",
      "--inrcy-theme-accent-rgb-2",
      "--inrcy-theme-accent-rgb-3",
      "--inrcy-theme-accent-rgb-4",
      "--inrcy-theme-spectrum",
      "--inrcy-theme-card-text",
      "--inrcy-theme-card-muted",
      "--inrcy-theme-focus-ring",
      "--inrcy-theme-cta-background",
      "--inrcy-theme-cta-text",
    ]) {
      assert.match(block, new RegExp(`${token}:`), `${theme} must define ${token}`);
    }
  }
});

test("the premium palette reaches dashboard frames, controls and channel bubbles without an original override", () => {
  for (const token of [
    "--inrcy-theme-surface-rgb-1",
    "--inrcy-theme-surface-rgb-2",
    "--inrcy-theme-surface-rgb-3",
    "--inrcy-theme-accent-rgb-1",
    "--inrcy-theme-accent-rgb-2",
    "--inrcy-theme-accent-rgb-3",
    "--inrcy-theme-accent-rgb-4",
    "--inrcy-theme-card-text",
    "--inrcy-theme-card-muted",
  ]) {
    assert.match(dashboardCss, new RegExp(token), `dashboard must consume ${token}`);
    assert.match(channelBubbleCss, new RegExp(token), `channel bubbles must consume ${token}`);
  }
});
