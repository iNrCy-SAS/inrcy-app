import assert from "node:assert/strict";
import test from "node:test";

import { estimateMailCapturedDemands } from "../../lib/inrstats/mailCapturedDemandEstimate.ts";

test("mail demand estimation is profile-driven, bounded and deliberately pessimistic", () => {
  assert.equal(estimateMailCapturedDemands({ campaigns: 0, recipients: 500, leadConversionRate: 20 }), 0);
  assert.equal(estimateMailCapturedDemands({ campaigns: 1, recipients: 487, leadConversionRate: 20 }), 4);
  assert.equal(estimateMailCapturedDemands({ campaigns: 5, recipients: 1_000, leadConversionRate: 50 }), 15);
  assert.equal(estimateMailCapturedDemands({ campaigns: 5, recipients: 1_000, leadConversionRate: 1 }), 2);
  assert.equal(estimateMailCapturedDemands({ campaigns: 5, recipients: 1_000, leadConversionRate: 0 }), 4);
});
