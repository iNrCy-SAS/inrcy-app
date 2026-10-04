import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MOBILE_SHORTCUTS,
  MOBILE_SHORTCUT_TOTAL_MAX,
  MOBILE_TOOL_SHORTCUT_OPTIONS,
  getDisplayedMobileShortcuts,
  getMobileShortcutLabel,
  getMobileShortcutOption,
  normalizeMobileShortcuts,
} from "../../lib/mobileShortcutPolicy.ts";

const tools = ["channels", "business_dna", "ai_configuration", "media_studio"];

test("existing six personal shortcuts retain their order alongside the four relocated tools", () => {
  const saved = ["reputation", "stats", "calendar", "crm", "inrsend", "agent"];
  const previous = [...saved];
  const visible = getDisplayedMobileShortcuts(saved);
  assert.deepEqual(visible, [...saved, ...tools]);
  assert.equal(visible.length, MOBILE_SHORTCUT_TOTAL_MAX);
  assert.equal(new Set(visible).size, 10);
  assert.deepEqual(saved, previous);
  assert.deepEqual(normalizeMobileShortcuts(saved), previous);
});

test("Standard exposes eight shortcuts without adding Premium-only destinations", () => {
  assert.deepEqual(getDisplayedMobileShortcuts(["crm", "calendar", "propulser", "fideliser"], true), [
    "agent", "inrsend", "stats", "reputation", ...tools,
  ]);
});

test("missing, malformed and minimal saved preferences cannot remove the relocated tools", () => {
  for (const input of [undefined, null, {}, [], ["unknown"], ["cash"], tools]) {
    assert.deepEqual(getDisplayedMobileShortcuts(input), [...DEFAULT_MOBILE_SHORTCUTS, ...tools]);
  }
  assert.deepEqual(getDisplayedMobileShortcuts(["stats", "stats", "cash", "unknown"]), ["stats", ...tools]);
});

test("the relocated tools resolve to their existing routes", () => {
  assert.deepEqual(MOBILE_TOOL_SHORTCUT_OPTIONS.map(({id}) => getMobileShortcutOption(id).href), [
    "/dashboard?action=channels", "/dashboard/adn-entreprise", "/dashboard/configuration-ia", "/dashboard/generer-media",
  ]);
  assert.deepEqual(MOBILE_TOOL_SHORTCUT_OPTIONS.map(({id}) => id), tools);
});

test("every supported language supplies labels for all four relocated tools", () => {
  for (const locale of ["fr-FR", "en-US", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    for (const {id} of MOBILE_TOOL_SHORTCUT_OPTIONS) {
      const label = getMobileShortcutLabel(id, locale);
      assert.ok(label.length > 0);
      assert.notEqual(label, id);
      if (locale !== "fr-FR") assert.notEqual(label, getMobileShortcutLabel(id, "fr-FR"), `${locale}: ${id}`);
    }
  }
});
