import test from "node:test";
import assert from "node:assert/strict";
import { buildGoogleRiscStatusFromRows, emptyGoogleRiscStatus } from "../../lib/security/googleRiscTestables.ts";

test("emptyGoogleRiscStatus retourne un état vierge", () => {
  assert.deepEqual(emptyGoogleRiscStatus(), {
    site_web: { ga4: false, gsc: false },
    gmb: false,
    gmail: false,
  });
});

test("buildGoogleRiscStatusFromRows utilise Site Web, GMB et Gmail et ignore la source retirée", () => {
  const status = buildGoogleRiscStatusFromRows([
    { source: "site_inrcy", product: "ga4", meta: { risc: { reauth_required: true } } },
    { source: "site_web", product: "gsc", meta: { risc: { reauth_required: true } } },
    { source: "gmb", product: "gmb", meta: { risc: { reauth_required: true } } },
    { source: "mailbox", product: "gmail", meta: { risc: { reauth_required: true } } },
    { source: "site_web", product: "ga4", meta: { risc: { reauth_required: false } } },
  ]);

  assert.equal("site_inrcy" in status, false);
  assert.equal(status.site_web.ga4, false);
  assert.equal(status.site_web.gsc, true);
  assert.equal(status.gmb, true);
  assert.equal(status.gmail, true);
});
