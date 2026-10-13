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

test("Modifier Image recharge et affiche le portefeuille médias partagé", () => {
  assert.match(modifier, /const \{[\s\S]*?quota,[\s\S]*?quotaLoading,[\s\S]*?loadQuota,/);
  assert.match(modifier, /void loadQuota\(\)/);
  assert.match(modifier, /const imageCounter = quota\?\.credits \|\| null/);
  assert.match(modifier, /<MediaQuotaSummary kind="image" counter=\{imageCounter\}/);
  assert.match(modifier, /creditsReady=\{quota\?\.creditsReady\}/);
  assert.match(modifier, /useMediaCreditQuote\(\{ kind: "image", operation: "modify"/);
  assert.match(modifier, /\.\.\.creditQuote\.authorization/);
  assert.match(modifier, /imageEngine: enginePreference\.imageEngine/);
  assert.match(modifier, /<MediaCreditQuoteSummary/);
});

test("le portefeuille reste séparé des commandes compactes et le prix confirmé protège Modifier", () => {
  const footer = modifier
    .match(/<footer\b[^>]*data-media-footer[^>]*>[\s\S]*?<\/footer>/g)
    ?.find((candidate) => candidate.includes("<MediaQuotaSummary"));

  assert.ok(footer, "le bandeau Modifier doit exister");
  assert.ok(
    footer.indexOf("<MediaQuotaSummary") < footer.indexOf("<MediaGenerationActions>"),
    "le portefeuille doit précéder les commandes de génération",
  );
  const actions=footer.match(/<MediaGenerationActions>[\s\S]*?<\/MediaGenerationActions>/)?.[0];
  assert.ok(actions,"le moteur, le prix et le CTA doivent partager les commandes compactes");
  assert.ok(actions.indexOf("{engineControls}")<actions.indexOf("<MediaCreditQuoteSummary"));
  assert.ok(actions.indexOf("<MediaCreditQuoteSummary")<actions.indexOf("styles.primaryButton"));
  assert.match(footer, /imageQuotaExhausted/);
  assert.match(footer, /!creditQuote\.ready \|\| creditQuote\.insufficient/);
  assert.match(modifier,/if \(operationLocked \|\| !creditQuote\.ready \|\| creditQuote\.insufficient\) return/);
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.actionBar\s*\{[\s\S]*?flex-direction:\s*column/,
  );
});
