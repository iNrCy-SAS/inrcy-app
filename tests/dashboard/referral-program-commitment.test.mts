import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const EXPECTED_TRANSLATIONS = {
  "fr-FR": ["3 mois", "• Client engagé au minimum 3 mois"],
  "en-GB": ["3 months", "• Client committed for a minimum of 3 months"],
  "es-ES": ["3 meses", "• Cliente con un compromiso mínimo de 3 meses"],
  "it-IT": ["3 mesi", "• Cliente con un impegno minimo di 3 mesi"],
  "de-DE": ["3 Monate", "• Kunde mit einer Mindestlaufzeit von 3 Monaten"],
  "nl-NL": ["3 maanden", "• Klant met een minimale verbintenis van 3 maanden"],
  "pt-PT": ["3 meses", "• Cliente com contrato mínimo de 3 meses"],
  "th-TH": ["3 เดือน", "• ลูกค้าผูกพันเป็นเวลาอย่างน้อย 3 เดือน"],
  "zh-CN": ["3个月", "• 客户承诺至少3个月"],
} as const;

test("the referral UI and every locale use a three-month commitment", () => {
  const panel = read("app/dashboard/_components/ReferralPanel.tsx");
  assert.match(panel, /i18nT\("3_mois_d07765c5"\)/);
  assert.match(panel, /i18nT\("client_engage_au_minimum_3_mois_7337b4c1"\)/);
  assert.doesNotMatch(panel, /(?:6_mois_1242b310|client_engage_au_minimum_6_mois_68e0f36c)/);

  for (const [locale, [duration, condition]] of Object.entries(EXPECTED_TRANSLATIONS)) {
    const catalog = JSON.parse(read(`messages/${locale}/shell.json`)) as Record<string, string>;
    assert.equal(catalog["3_mois_d07765c5"], duration, locale);
    assert.equal(catalog["client_engage_au_minimum_3_mois_7337b4c1"], condition, locale);
    assert.equal(catalog["6_mois_1242b310"], undefined, locale);
    assert.equal(catalog["client_engage_au_minimum_6_mois_68e0f36c"], undefined, locale);
  }
});

test("the referral email repeats the three-month condition in text and HTML", () => {
  const route = read("app/api/referrals/route.ts");
  assert.equal(route.match(/reste engagé au minimum 3 mois/g)?.length, 2);
  assert.doesNotMatch(route, /reste engagé au minimum 6 mois/);
});
