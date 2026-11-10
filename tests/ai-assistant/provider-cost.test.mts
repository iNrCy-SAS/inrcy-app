import assert from "node:assert/strict";
import test from "node:test";
import { getInrAssistantProviderCost } from "../../lib/inrAssistantProviderCost.ts";

const cost = (amount: unknown) => getInrAssistantProviderCost({ gateway: { gatewayCost: amount } });

test("attested Gateway cost accepts numeric and decimal USD, rounds upward and preserves zero", () => {
  for (const [input, expected] of [[0, 0], [-0, 0], ["0", 0], ["0.000000", 0], [0.005646075, 5647], ["0.005646075", 5647],
    ["1.25", 1_250_000], ["0.000001", 1], ["0.000000001", 1], [Number.MIN_VALUE, 1], ["000.00100", 1000]] as const) {
    assert.equal(cost(input), expected, String(input));
  }
});

test("decimal conversion stays exact at microdollar and safe-integer boundaries", () => {
  assert.equal(cost("0.0000010000000000000000000000000000001"), 2);
  assert.equal(cost("0.0000010000000000000000000000000000000"), 1);
  assert.equal(cost("9007199254.740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(cost("9007199254.7409901"), Number.MAX_SAFE_INTEGER);
  for (const input of ["9007199254.7409911", "9007199254.740992", Number.MAX_SAFE_INTEGER, 1e50, Number.POSITIVE_INFINITY]) assert.equal(cost(input), undefined, String(input));
});

test("missing, malformed, negative and unsafe costs never become a zero", () => {
  for (const input of [undefined, null, "", " ", " 0.01", "0.01 ", "NaN", "Infinity", "-0.01", "-0", "+0.01", "1e-3", "0x10", ".01", "1.", "0,01", "1_000", "1\n", "0".repeat(101), -0.01, Number.NaN, -Infinity, false, {}, [], BigInt(1)]) {
    assert.equal(cost(input), undefined, String(input));
  }
});

test("only gateway.gatewayCost is authoritative, including its real zero", () => {
  for (const metadata of [undefined, null, [], "0.01", { gatewayCost: "0.01" }, { gateway: [] }, { gateway: { cost: "0.01", totalCost: "0.02", inferenceCost: "0.001" } },
    { otherProvider: { gatewayCost: "0.01" } }, Object.create({ gateway: { gatewayCost: "0.01" } }), { gateway: Object.create({ gatewayCost: "0.01" }) }]) {
    assert.equal(getInrAssistantProviderCost(metadata), undefined);
  }
  assert.equal(getInrAssistantProviderCost({ gateway: { gatewayCost: 0, cost: "9.99", inferenceCost: "9.99" } }), 0);
});
