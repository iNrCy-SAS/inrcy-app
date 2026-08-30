import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_OAUTH_CHANNELS,
  createLatestChannelResponseGate,
} from "../../lib/dashboardChannelSync.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const channel of DASHBOARD_OAUTH_CHANNELS) {
  test(`${channel}: a pre-mutation response cannot overwrite the post-mutation response`, () => {
    const gate = createLatestChannelResponseGate<string>();
    const beforeMutation = gate.begin(channel);
    const afterMutation = gate.begin(channel);

    assert.equal(gate.isCurrent(channel, afterMutation), true);
    assert.equal(gate.isCurrent(channel, beforeMutation), false);
  });

  test(`${channel}: the same guard protects a disconnection`, () => {
    const gate = createLatestChannelResponseGate<string>();
    const staleConnectedResponse = gate.begin(channel);
    const currentDisconnectedResponse = gate.begin(channel);

    assert.equal(gate.isCurrent(channel, currentDisconnectedResponse), true);
    assert.equal(gate.isCurrent(channel, staleConnectedResponse), false);
  });

  test(`${channel}: delayed HTTP completion cannot undo the last-started response`, async () => {
    const gate = createLatestChannelResponseGate<string>();
    const oldResponse = deferred<boolean>();
    const newResponse = deferred<boolean>();
    const oldToken = gate.begin(channel);
    let applied: boolean | null = null;
    const oldJob = oldResponse.promise.then((value) => {
      if (gate.isCurrent(channel, oldToken)) applied = value;
    });

    const newToken = gate.begin(channel);
    const newJob = newResponse.promise.then((value) => {
      if (gate.isCurrent(channel, newToken)) applied = value;
    });

    newResponse.resolve(true);
    await newJob;
    oldResponse.resolve(false);
    await oldJob;
    assert.equal(applied, true);
  });
}

test("a response from the previous active account is ignored", () => {
  const gate = createLatestChannelResponseGate<string>();
  const previousAccountResponse = gate.begin("gmb");
  gate.changeScope();
  const activeAccountResponse = gate.begin("gmb");

  assert.equal(gate.isCurrent("gmb", previousAccountResponse), false);
  assert.equal(gate.isCurrent("gmb", activeAccountResponse), true);
});
