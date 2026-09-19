import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("subscription invoices stay scoped to the authenticated Stripe subscription", () => {
  const route = read("app/api/billing/invoices/route.ts");

  assert.match(route, /requireUser\(\)/);
  assert.match(route, /stripe_customer_id,stripe_subscription_id,billing_provider/);
  assert.match(route, /invoiceSubscriptionId\(invoice\) === subscriptionId/);
  assert.match(route, /Cache-Control": "private, no-store/);
  assert.doesNotMatch(route, /STRIPE_SECRET_KEY[^\n]*NextResponse/);
});

test("invoice UI references keys available in every settings catalogue", () => {
  const panel = read(
    "app/dashboard/settings/_components/SubscriptionInvoicesPanel.tsx",
  );
  const keys = Array.from(panel.matchAll(/i18nT\("([^"]+)"\)/g), (match) => match[1]);
  assert.ok(keys.length > 0);

  for (const locale of [
    "de-DE",
    "en-GB",
    "es-ES",
    "fr-FR",
    "it-IT",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ]) {
    const catalogue = JSON.parse(read(`messages/${locale}/settings.json`));
    for (const key of keys) {
      assert.equal(typeof catalogue[key], "string", `${locale}: ${key}`);
      assert.ok(catalogue[key].trim(), `${locale}: ${key} must not be empty`);
    }
  }
});
