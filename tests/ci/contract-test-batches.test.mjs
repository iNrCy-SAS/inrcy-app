import assert from "node:assert/strict";
import test from "node:test";
import { contractTestBatches } from "../../scripts/contract-test-batches.mjs";

const files = Array.from({ length: 650 }, (_, index) => `tests/representative-contract-suite/contract-regression-${index}.test.mts`);

test("Windows batches every contract file without exceeding command-line headroom", () => {
  const batches = contractTestBatches(files, "win32");
  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flat(), files);
  assert.ok(batches.every((batch) => batch.reduce((size, file) => size + file.length + 3, 0) <= 24_000));
});

test("Linux CI retains one complete test runner and small Windows suites stay together", () => {
  assert.deepEqual(contractTestBatches(files, "linux"), [files]);
  assert.deepEqual(contractTestBatches(files.slice(0, 4), "win32"), [files.slice(0, 4)]);
});
