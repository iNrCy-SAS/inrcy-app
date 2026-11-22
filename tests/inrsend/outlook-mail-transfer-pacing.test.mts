import assert from "node:assert/strict";
import test from "node:test";
import { getOutlookTransferIntervalMs } from "../../lib/outlookMailTransferPacing.ts";

test("Outlook transfer tiers include each decimal MB boundary and change on the next byte", () => {
  const cases = [
    [3, 10], [4, 12], [5, 15], [6, 19], [7, 22], [8, 25], [9, 28],
    [10, 30], [11, 34], [12, 38], [14, 43], [16.5, 50], [20, 60], [25, 75],
  ];
  let firstByte = 0;
  for (const [maxMB, intervalSeconds] of cases) {
    const lastByte = maxMB * 1_000_000;
    assert.equal(getOutlookTransferIntervalMs(firstByte), intervalSeconds * 1_000);
    assert.equal(getOutlookTransferIntervalMs(lastByte), intervalSeconds * 1_000);
    firstByte = lastByte + 1;
  }
});

test("larger serialized messages are spaced within a 100 MB rolling window", () => {
  assert.equal(getOutlookTransferIntervalMs(25_000_001), 100_000);
  assert.equal(getOutlookTransferIntervalMs(33_333_333), 100_000);
  assert.equal(getOutlookTransferIntervalMs(33_333_334), 150_000);
  assert.equal(getOutlookTransferIntervalMs(50_000_000), 150_000);
  assert.equal(getOutlookTransferIntervalMs(50_000_001), 300_000);
  assert.equal(getOutlookTransferIntervalMs(100_000_000), 300_000);
});

test("invalid measurements and payloads larger than one reservation window are rejected", () => {
  for (const bytes of [-1, 1.5, NaN, Infinity, 100_000_001]) {
    assert.throws(() => getOutlookTransferIntervalMs(bytes), RangeError);
  }
});
