import assert from "node:assert/strict";
import test from "node:test";
import { BOUTIQUE_PRICE_TAX_BEHAVIOR, BOUTIQUE_PRODUCTS, boutiqueOrderAmounts, boutiqueOrderPriceLabel, boutiqueSavingsPercent, boutiqueTtcToRoundedHt, findBoutiqueProduct } from "../../lib/boutique/products.ts";
import { boutiqueOrderTotals, formatStoredBoutiqueAmounts } from "../../lib/boutique/orderAmounts.ts";

const expected = [
  ["cartes_visite", 299, 179, 7200],
  ["flyers", 350, 210, 8400],
  ["facebook_page", 350, 210, 8400],
  ["instagram_page", 350, 210, 8400],
  ["linkedin_page", 391, 234, 9400],
  ["gmb", 249, 149, 6000],
  ["logo", 499, 299, 12000],
  ["ads", 599, 359, 14400],
  ["site_refonte", 1499, 899, 26000],
  ["site_creation", 2492, 1495, 33000],
] as const;

test("all Boutique offers convert 20% TTC to nearest-euro HT while keeping UI quantities", () => {
  assert.equal(BOUTIQUE_PRODUCTS.length, expected.length);
  for (const [key, euros, combinedEuros, ui] of expected) {
    const product = findBoutiqueProduct(key)!;
    assert.ok(product);
    assert.equal(product.priceEurHt, euros, key);
    assert.equal(product.comboEurHt, combinedEuros, key);
    assert.equal(product.priceUi, ui, key);
    assert.deepEqual(boutiqueOrderAmounts(product, "EUR"), { amountEurHt: euros, amountUi: null });
    assert.deepEqual(boutiqueOrderAmounts(product, "UI"), { amountEurHt: combinedEuros, amountUi: ui });
    assert.equal(product.priceEurHt - product.comboEurHt, euros - combinedEuros);
    assert.match(boutiqueOrderPriceLabel(product, "EUR"), /€ HT$/);
    assert.match(boutiqueOrderPriceLabel(product, "UI"), /€ HT \+ .+ UI$/);
  }
  assert.deepEqual(BOUTIQUE_PRODUCTS.map((p) => p.priceEurHt), [...BOUTIQUE_PRODUCTS].map((p) => p.priceEurHt).sort((a, b) => a - b));
});

test("conversion rounds half euros upwards and rejects non-prices", () => {
  assert.equal(boutiqueTtcToRoundedHt(3), 3);
  assert.equal(boutiqueTtcToRoundedHt(0), 0);
  assert.equal(boutiqueTtcToRoundedHt(2990), 2492);
  for (const invalid of [-1, Infinity, NaN]) assert.throws(() => boutiqueTtcToRoundedHt(invalid), RangeError);
});

test("the current storefront catalogue exposes only HT prices and no legacy TTC offer", () => {
  assert.equal(BOUTIQUE_PRICE_TAX_BEHAVIOR, "exclusive");
  for (const product of BOUTIQUE_PRODUCTS) {
    assert.equal(Object.hasOwn(product, "priceEurTtc"), false, product.key);
    assert.equal(Object.hasOwn(product, "comboEurTtc"), false, product.key);
    for (const method of ["EUR", "UI"] as const) {
      const label = boutiqueOrderPriceLabel(product, method);
      assert.match(label, /€ HT/);
      assert.doesNotMatch(label, /TTC/);
    }
  }
});

test("UI savings use the displayed euro prices and a rounded percentage, not the unit quantity", () => {
  assert.equal(boutiqueSavingsPercent(findBoutiqueProduct("cartes_visite")!), 40);
  assert.equal(boutiqueSavingsPercent(findBoutiqueProduct("linkedin_page")!), 40);
  assert.equal(boutiqueSavingsPercent({ priceEurHt: 200, comboEurHt: 150 }), 25);
  assert.equal(boutiqueSavingsPercent({ priceEurHt: 80, comboEurHt: 60 }), 25);
  assert.equal(boutiqueSavingsPercent({ priceEurHt: 3, comboEurHt: 2 }), 33);
  assert.equal(boutiqueSavingsPercent({ priceEurHt: 100, comboEurHt: 100 }), 0);
  assert.equal(boutiqueSavingsPercent({ priceEurHt: 0, comboEurHt: 0 }), 0);
  assert.equal(boutiqueSavingsPercent({ priceEurHt: 100, comboEurHt: 120 }), 0);
});

test("historical stored amounts are neither converted nor silently relabelled HT", () => {
  const legacy = { amount_eur: 359.4, amount_ui: null, amount_eur_tax_behavior: null };
  assert.equal(formatStoredBoutiqueAmounts(legacy), "359,4 € Base non renseignée");
  assert.equal(formatStoredBoutiqueAmounts({ amount_eur: null, amount_ui: 7200 }).replaceAll("\u202f", " "), "7 200 UI");
  assert.equal(formatStoredBoutiqueAmounts({ ...legacy, amount_eur_tax_behavior: "inclusive" }), "359,4 € TTC");
  assert.deepEqual(legacy, { amount_eur: 359.4, amount_ui: null, amount_eur_tax_behavior: null });
});

test("admin totals include combined euros but keep HT, TTC and unqualified historical amounts separate", () => {
  assert.deepEqual(boutiqueOrderTotals([
    { amount_eur: 299, amount_ui: null, amount_eur_tax_behavior: "exclusive" },
    { amount_eur: 179, amount_ui: 7200, amount_eur_tax_behavior: "exclusive" },
    { amount_eur: 359, amount_ui: null, amount_eur_tax_behavior: null },
    { amount_eur: 420, amount_ui: null, amount_eur_tax_behavior: "inclusive" },
    { amount_eur: null, amount_ui: 8400 },
  ]), { eurHt: 478, eurTtc: 420, eurUnclassified: 359, ui: 15600 });
});
