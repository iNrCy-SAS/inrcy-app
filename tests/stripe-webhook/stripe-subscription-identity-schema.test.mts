import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../ops/sql/2026-09-11_stripe_subscription_identity_integrity.sql",
    import.meta.url,
  ),
  "utf8",
);

const pricePrecisionMigration = readFileSync(
  new URL(
    "../../ops/sql/2026-09-11_subscription_monthly_price_precision.sql",
    import.meta.url,
  ),
  "utf8",
);

test("la base interdit qu'un abonnement Stripe appartienne à deux comptes", () => {
  assert.match(migration, /group by btrim\(stripe_subscription_id\)/i);
  assert.match(migration, /having count\(\*\) > 1/i);
  assert.match(migration, /create unique index if not exists/i);
  assert.match(migration, /\(\(btrim\(stripe_subscription_id\)\)\)/i);
  assert.match(migration, /where nullif\(btrim\(stripe_subscription_id\), ''\) is not null/i);
  assert.match(
    migration,
    /stripe_subscription_id = nullif\(btrim\(stripe_subscription_id\), ''\)/i,
  );
  assert.match(
    migration,
    /stripe_customer_id = nullif\(btrim\(stripe_customer_id\), ''\)/i,
  );
  assert.doesNotMatch(migration, /unique[\s\S]{0,80}stripe_customer_id/i);
});

test("la base conserve les équivalents mensuels Stripe avec des centimes", () => {
  assert.match(
    pricePrecisionMigration,
    /alter column monthly_price_eur type numeric\(12, 2\)/i,
  );
  assert.match(pricePrecisionMigration, /using round\(monthly_price_eur::numeric, 2\)/i);
  assert.match(pricePrecisionMigration, /where monthly_price_eur < 0/i);
  assert.match(pricePrecisionMigration, /subscriptions_monthly_price_eur_nonnegative/i);
  assert.match(pricePrecisionMigration, /validate constraint/i);
});
