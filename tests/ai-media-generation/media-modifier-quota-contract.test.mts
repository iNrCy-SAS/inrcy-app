import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const modifier = readFileSync(
  path.resolve("app/dashboard/_components/MediaModifier.tsx"),
  "utf8",
);
const styles = readFileSync(
  path.resolve("app/dashboard/_components/MediaModifier.module.css"),
  "utf8",
);

test("Modifier Image recharge et affiche le compteur image partagé", () => {
  assert.match(modifier, /const \{[\s\S]*?quota,[\s\S]*?quotaLoading,[\s\S]*?loadQuota,/);
  assert.match(modifier, /void loadQuota\(\)/);
  assert.match(modifier, /const imageCounter = quota\?\.image \|\| null/);
  assert.match(modifier, /imageCounter\.used \+ imageCounter\.reserved/);
  assert.match(modifier, /ai_generator_image_quota/);
  assert.match(modifier, /ai_generator_remaining/);
  assert.match(modifier, /ai_generator_reset/);
});

test("le quota reste à gauche du CTA Modifier et bloque un crédit épuisé", () => {
  const footer = modifier
    .match(/<footer className=\{styles\.actionBar\}>[\s\S]*?<\/footer>/g)
    ?.find((candidate) => candidate.includes("styles.quotaCard"));

  assert.ok(footer, "le bandeau Modifier doit exister");
  assert.ok(
    footer.indexOf("styles.quotaCard") < footer.indexOf("styles.primaryButton"),
    "le quota doit précéder le CTA",
  );
  assert.match(footer, /imageQuotaExhausted/);
  assert.match(styles, /\.quotaCard\s*\{[\s\S]*?width:\s*fit-content/);
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.quotaCard\s*\{[\s\S]*?width:\s*100%/,
  );
});
