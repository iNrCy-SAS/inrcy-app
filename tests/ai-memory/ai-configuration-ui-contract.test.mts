import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("the three secondary style controls share one aligned row with help below", () => {
  const configuration = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");

  assert.match(configuration, /data-style-secondary-fields/);
  assert.match(configuration, /gridTemplateColumns: "repeat\(3, minmax\(0, 1fr\)\)"/);
  assert.match(configuration, /<ContentLengthSelect[\s\S]*?<span style=\{hint\}>\{memoryT\("webLengthLabel"\)\}<\/span>/);
  assert.match(configuration, /<ContentLengthSelect[\s\S]*?<span style=\{hint\}>\{memoryT\("socialLengthLabel"\)\}<\/span>/);
  assert.match(configuration, /<select style=\{input\} value=\{form\.emojiLevel\}[\s\S]*?configurationT\("emojiHint"\)/);
});

test("content-length menus are opaque and portaled above neighbouring cards", () => {
  const configuration = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");

  assert.match(configuration, /createPortal\(/);
  assert.match(configuration, /position: "fixed"/);
  assert.match(configuration, /zIndex: 10000/);
  assert.match(configuration, /background: "#090f25"/);
  assert.match(configuration, /background: "#171d38"/);
});

test("two liked examples are distinct, persisted and laid out above full-width instructions", () => {
  const configuration = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");
  const compatibility = read("lib/aiConfigurationCompatibility.ts");

  assert.match(compatibility, /likedExample2: string/);
  assert.match(compatibility, /firstMeaningful\(source, \["likedExample2"\]\)/);
  assert.match(compatibility, /result\.likedExample2 = String\(likedExample2\)/);
  assert.match(configuration, /ai_liked_example_2: form\.likedExample2\.trim\(\)/);
  assert.match(configuration, /value=\{form\.likedExample2\}/);
  assert.match(configuration, /data-instruction-examples/);
  assert.match(configuration, /data-custom-instructions/);
  assert.match(configuration, /gridTemplateColumns: "repeat\(2, minmax\(0, 1fr\)\)"/);
});

test("all dashboard locales explain emojis and both liked-content fields", () => {
  const locales = ["de-DE", "en-GB", "es-ES", "fr-FR", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
  const keys = [
    "emojiHint",
    "likedContent1Label",
    "likedContent2Label",
    "likedContentPlaceholder",
    "likedContentHint",
  ];

  for (const locale of locales) {
    const catalog = JSON.parse(read(`messages/${locale}/dashboard.json`));
    for (const key of keys) {
      assert.equal(typeof catalog.aiConfiguration[key], "string", `${locale}: ${key}`);
      assert.ok(catalog.aiConfiguration[key].trim().length > 0, `${locale}: ${key} must not be empty`);
    }
  }
});
