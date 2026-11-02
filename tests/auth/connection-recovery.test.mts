import assert from "node:assert/strict";
import test from "node:test";
import { connectionRecoverySteps } from "../../lib/connectionRecovery.ts";

test("incomplete observations cannot claim the account is repaired", () => {
  assert.deepEqual(connectionRecoverySteps([], false), ["wait"]);
  assert.deepEqual(connectionRecoverySteps([{ id: "api-ping", severity: "pending" }], false), ["wait"]);
  assert.deepEqual(connectionRecoverySteps([{ id: "api-ping", severity: "ok" }], true), ["wait"]);
  assert.deepEqual(connectionRecoverySteps([{ id: "api-ping", severity: "ok" }], false), ["credentials"]);
});

test("network and browser persistence failures have distinct recovery without deleting data", () => {
  assert.deepEqual(connectionRecoverySteps([{ id: "api-ping", severity: "error" }], false), ["network", "credentials"]);
  assert.deepEqual(connectionRecoverySteps([{ id: "cookies", severity: "warn" }], false), ["storage", "credentials"]);
  assert.deepEqual(connectionRecoverySteps([{ id: "local-storage", severity: "error" }, { id: "asset-logo", severity: "error" }], false), ["network", "storage", "credentials"]);
});
