import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../app/dashboard/_components/UserMenu.tsx", import.meta.url),
  "utf8",
);
const responsiveSource = readFileSync(
  new URL("../../app/dashboard/_components/ResponsiveBottomNav.tsx", import.meta.url),
  "utf8",
);

test("the professional workspace entries stay grouped in their logical order", () => {
  const preferences = source.indexOf('closeAndOpen("preferences")');
  const profile = source.indexOf('closeAndOpen("profil")');
  const configuration = source.indexOf('closeAndOpen("ia")');
  const businessDna = source.indexOf('closeAndOpen("ai_memory")');

  assert.ok(preferences >= 0);
  assert.ok(preferences < profile);
  assert.ok(profile < configuration);
  assert.ok(configuration < businessDna);
});

test("the responsive menu mirrors the same professional workspace order", () => {
  const preferences = responsiveSource.indexOf("label={t.userMenu.preferences}");
  const profile = responsiveSource.indexOf("label={t.userMenu.profile}");
  const configuration = responsiveSource.indexOf("label={t.userMenu.ai}");
  const businessDna = responsiveSource.indexOf("label={t.userMenu.aiMemory}");

  assert.ok(preferences >= 0);
  assert.ok(preferences < profile);
  assert.ok(profile < configuration);
  assert.ok(configuration < businessDna);
  assert.doesNotMatch(
    responsiveSource.slice(configuration, businessDna),
    /AiConfigurationIcon/,
  );
});
