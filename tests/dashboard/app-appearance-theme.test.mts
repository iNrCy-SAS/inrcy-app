import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_APPEARANCE_THEMES,
  APP_APPEARANCE_THEME_STORAGE_KEY,
  normalizeAppAppearanceTheme,
} from "../../lib/appAppearanceTheme.ts";

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
