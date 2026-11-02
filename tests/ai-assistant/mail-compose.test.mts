import assert from "node:assert/strict";
import test from "node:test";
import { parseInrAssistantMailPatch, inrAssistantMailRecipientRequested } from "../../lib/inrAssistantMailCompose.ts";
import { parseInrAssistantClientContext } from "../../lib/inrAssistantClientContext.ts";

test("compose patch cannot smuggle sending, another field, multiple recipients or header injection", () => {
  for (const patch of [null, [], {}, { send: true }, { recipient: "a@example.invalid,b@example.invalid" }, { subject: "Hello\r\nBcc: bad@example.invalid" }, { bodyText: "a\0b" }, { bodyText: "a".repeat(6001) }, { recipient: "bob@example.invalid", attachments: [] }]) assert.equal(parseInrAssistantMailPatch(patch), null);
  assert.deepEqual(parseInrAssistantMailPatch({ subject: "", bodyText: "Bonjour", recipient: null }), { subject: "", bodyText: "Bonjour" });
  assert.equal(inrAssistantMailRecipientRequested("Prépare pour alice@example.invalid.", "alice@example.invalid"), true);
  assert.equal(inrAssistantMailRecipientRequested("Prépare pour malice@example.invalid", "alice@example.invalid"), false);
});
test("mail capability leaks no compose contents and is valid only on the native mail route", () => {
  const screen = { pathname: "/dashboard/mails", selection: { kind: "mail", id: "local_1" }, revision: "r1", availableCommands: ["configure_mail_draft"], bodyText: "Private message", recipient: "private@example.invalid" };
  const context = parseInrAssistantClientContext({ screen });
  assert.deepEqual(context?.screen?.availableCommands, ["configure_mail_draft"]);
  assert.ok(!JSON.stringify(context).includes("Private"));
  assert.ok(!parseInrAssistantClientContext({ screen: { ...screen, pathname: "/dashboard/ads" } })?.screen?.availableCommands);
});
