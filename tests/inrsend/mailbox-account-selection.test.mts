import assert from "node:assert/strict";
import test from "node:test";
import { resolveMailAccountSelection } from "../../app/dashboard/mails/_lib/mailboxAccountSelection.ts";

const gmail = { id: "gmail-current", status: "connected", connection_status: "connected" };
const outlook = { id: "outlook", status: "connected", connection_status: "connected" };

test("an empty restored draft uses the sole connected mailbox", () => {
  assert.equal(resolveMailAccountSelection([gmail], ""), gmail);
});

test("a reconnected mailbox replaces a stale integration ID", () => {
  assert.equal(resolveMailAccountSelection([gmail], "gmail-old"), gmail);
});

test("late account loading and late draft restoration resolve the same sender", () => {
  assert.equal(resolveMailAccountSelection([], "gmail-old"), null);
  const afterLoad = resolveMailAccountSelection([gmail], "gmail-old");
  const afterRestore = resolveMailAccountSelection([gmail], "");
  assert.equal(afterLoad?.id, afterRestore?.id);
  assert.equal(afterLoad?.id, gmail.id);
});

test("an explicit sender is preserved among several mailboxes", () => {
  assert.equal(resolveMailAccountSelection([gmail, outlook], outlook.id), outlook);
});

test("a missing sender never silently selects among several ready mailboxes", () => {
  assert.equal(resolveMailAccountSelection([gmail, outlook], ""), null);
  assert.equal(resolveMailAccountSelection([gmail, outlook], "former-account"), null);
});

test("unavailable mailboxes are excluded from automatic selection", () => {
  const expired = { ...outlook, connection_status: "needs_update" };
  const disconnected = { ...outlook, status: "disconnected" };
  const inconsistent = { ...outlook, connection_status: "disconnected" };
  const requiresUpdate = { ...outlook, requires_update: true };
  for (const unavailable of [expired, disconnected, inconsistent, requiresUpdate]) {
    assert.equal(resolveMailAccountSelection([unavailable], ""), null);
    assert.equal(resolveMailAccountSelection([unavailable, gmail], ""), gmail);
  }
});

test("an explicitly selected expired sender stays selected for the reconnect guard", () => {
  const expired = { ...gmail, requires_update: true };
  assert.equal(resolveMailAccountSelection([expired, outlook], gmail.id), expired);
});

test("an explicitly disconnected sender cannot send or silently switch accounts", () => {
  const disconnected = { ...gmail, status: "disconnected" };
  assert.equal(resolveMailAccountSelection([disconnected, outlook], gmail.id), null);
  assert.equal(resolveMailAccountSelection([{ ...gmail, connection_status: "disconnected" }, outlook], gmail.id), null);
});
