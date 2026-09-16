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
const appearancePicker = readFileSync(new URL("../../app/dashboard/settings/_components/AppAppearancePicker.tsx", import.meta.url), "utf8");

function rgbHue([red, green, blue]: number[]) {
  const [r, g, b] = [red, green, blue].map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0;

  const hue = max === r
    ? ((g - b) / delta) % 6
    : max === g
      ? (b - r) / delta + 2
      : (r - g) / delta + 4;

  return (hue * 60 + 360) % 360;
}

function hueDistance(a: number, b: number) {
  const distance = Math.abs(a - b);
  return Math.min(distance, 360 - distance);
}

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

test("every alternative theme exposes four genuinely distinct accent roles", () => {
  for (const theme of APP_APPEARANCE_THEMES.filter((candidate) => candidate !== "original")) {
    const block = globalsCss.match(
      new RegExp(`html\\[data-inrcy-theme="${theme}"\\] \\{([\\s\\S]*?)\\n\\}`),
    )?.[1];

    assert.ok(block, `missing CSS palette for ${theme}`);

    const accents = [...block.matchAll(/--inrcy-theme-accent-rgb-[1-4]:\s*(\d+),\s*(\d+),\s*(\d+);/g)]
      .map((match) => match.slice(1).map(Number));

    assert.equal(accents.length, 4, `${theme} must expose four accent roles`);

    const hues = accents.map(rgbHue);
    const separatedPairs = hues.flatMap((hue, index) =>
      hues.slice(index + 1).map((otherHue) => hueDistance(hue, otherHue)),
    );

    assert.ok(
      separatedPairs.filter((distance) => distance >= 45).length >= 4,
      `${theme} must not collapse into a monochrome palette`,
    );
  }
});

test("theme palette blocks remain color-only and cannot move dashboard controls", () => {
  const geometryDeclaration = /^\s*(?:display|position|inset|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|grid|grid-template-columns|grid-template-rows|flex|gap|margin|padding|transform|translate|scale)\s*:/m;

  for (const theme of APP_APPEARANCE_THEMES.filter((candidate) => candidate !== "original")) {
    const block = globalsCss.match(
      new RegExp(`html\\[data-inrcy-theme="${theme}"\\] \\{([\\s\\S]*?)\\n\\}`),
    )?.[1];

    assert.ok(block, `missing CSS palette for ${theme}`);
    assert.doesNotMatch(block, geometryDeclaration, `${theme} must not alter layout geometry`);
  }
});

test("the four dashboard metrics consume the four distinct accent roles", () => {
  assert.match(
    dashboardCss,
    /\.metricDemandes\s*\{\s*--metric-accent:\s*rgba\(var\(--inrcy-theme-accent-rgb-4/,
  );
});

test("preference previews advertise the same four-color spectrum as the live themes", () => {
  for (const theme of APP_APPEARANCE_THEMES.filter((candidate) => candidate !== "original")) {
    const block = globalsCss.match(
      new RegExp(`html\\[data-inrcy-theme="${theme}"\\] \\{([\\s\\S]*?)\\n\\}`),
    )?.[1];
    const spectrum = block?.match(/--inrcy-theme-spectrum:\s*([^;]+);/)?.[1];
    const previewKey = theme.includes("-") ? `"${theme}"` : theme;

    assert.ok(spectrum, `missing live spectrum for ${theme}`);
    assert.ok(
      appearancePicker.includes(`${previewKey}: "${spectrum}"`),
      `${theme} preview must match its live spectrum`,
    );
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
