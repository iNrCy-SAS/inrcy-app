import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_INRBADGE_THEME_SETTINGS,
  INRBADGE_THEME_PRESETS,
  createInrBadgeIdentityColors,
  getInrBadgeThemeCssVariables,
  normalizeInrBadgeThemeSettings,
  resolveInrBadgeThemePalette,
} from "../../lib/inrBadgeTheme.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("iNrBadge exposes five curated themes plus the logo identity theme", () => {
  assert.deepEqual(
    INRBADGE_THEME_PRESETS.map((theme) => theme.id),
    ["aurora", "ocean", "sunset", "forest", "graphite"],
  );
  assert.equal(DEFAULT_INRBADGE_THEME_SETTINGS.id, "aurora");
});

test("iNrBadge theme settings reject unknown ids and unsafe colors", () => {
  assert.deepEqual(
    normalizeInrBadgeThemeSettings({
      id: "<script>",
      identityColors: { primary: "red", secondary: "#123456", accent: "url(javascript:1)" },
    }),
    DEFAULT_INRBADGE_THEME_SETTINGS,
  );

  assert.deepEqual(
    normalizeInrBadgeThemeSettings({
      id: "identity",
      identityColors: { primary: "#12abEF", secondary: "#223344", accent: "#fedCBA" },
    }),
    {
      id: "identity",
      identityColors: { primary: "#12ABEF", secondary: "#223344", accent: "#FEDCBA" },
    },
  );
});

test("a one-color logo receives accessible companion colors", () => {
  const colors = createInrBadgeIdentityColors(["#E11D48"]);
  assert.equal(colors.primary, "#E11D48");
  assert.match(colors.secondary, /^#[0-9A-F]{6}$/);
  assert.match(colors.accent, /^#[0-9A-F]{6}$/);
  assert.notEqual(colors.secondary, colors.primary);
  assert.notEqual(colors.accent, colors.primary);
});

test("the identity palette derives dark surfaces and safe CSS variables", () => {
  const theme = {
    id: "identity",
    identityColors: { primary: "#FF5500", secondary: "#0055FF", accent: "#22CC88" },
  };
  const palette = resolveInrBadgeThemePalette(theme);
  const variables = getInrBadgeThemeCssVariables(theme);

  assert.equal(palette.primary, "#FF5500");
  assert.notEqual(palette.pageStart, palette.primary);
  assert.equal(variables["--badge-primary"], "#FF5500");
  assert.equal(variables["--badge-primary-rgb"], "255 85 0");
});

test("the iNrBadge settings API persists the normalized theme in the existing JSON settings", () => {
  const route = read("app/api/inrbadge/settings/route.ts");
  assert.match(route, /theme: normalizeInrBadgeThemeSettings\(rootSettings\.inrBadgeTheme\)/);
  assert.match(route, /sanitizeInrBadgeThemeSettingsPayload\(input\.theme\)/);
  assert.match(route, /inrBadgeTheme: nextTheme/);
  assert.match(route, /theme: nextTheme/);
});

test("the dashboard extracts logo colors and the public badge consumes the saved palette", () => {
  const settings = read("app/dashboard/settings/_components/InrBadgeSettingsContent.tsx");
  const publicBadge = read("app/badge/[slug]/page.tsx");
  const stylesheet = read("app/badge/[slug]/badge.module.css");

  assert.match(settings, /Identité entreprise/);
  assert.match(settings, /extractInrBadgeThemeColorsFromLogo/);
  assert.match(settings, /Actualiser depuis le logo/);
  assert.match(publicBadge, /normalizeInrBadgeThemeSettings\(toolSettings\.inrBadgeTheme\)/);
  assert.match(publicBadge, /getInrBadgeThemeCssVariables\(badgeTheme\)/);
  assert.match(publicBadge, /style=\{badgeThemeStyle\}/);
  assert.match(stylesheet, /--badge-primary/);
  assert.match(stylesheet, /var\(--badge-secondary\)/);
  assert.match(stylesheet, /var\(--badge-accent\)/);
});

test("the appointment page keeps the public badge theme", () => {
  const pageSource = read("app/badge/[slug]/rdv/page.tsx");
  const clientSource = read("app/badge/[slug]/rdv/RdvBookingClient.tsx");

  assert.match(pageSource, /normalizeInrBadgeThemeSettings\(rootSettings\.inrBadgeTheme\)/);
  assert.match(pageSource, /themeStyle=\{getInrBadgeThemeCssVariables\(badgeTheme\) as CSSProperties\}/);
  assert.match(clientSource, /style=\{themeStyle\}/);
  assert.match(clientSource, /data-badge-theme=\{themeId\}/);
});
