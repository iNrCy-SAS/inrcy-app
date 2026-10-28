import assert from "node:assert/strict";
import test from "node:test";
import { readInrAssistantDocument } from "../../lib/inrAssistantAttachmentReader.ts";
import { assistantMessagesWithFiles } from "../../lib/inrAssistantAttachmentPrompt.ts";
test("long attachment reader reaches passages beyond the initial excerpt without expanding the initial prompt", () => {
  const files = [{ name: "contrat.txt", kind: "document" as const, text: "A".repeat(20000) + "Clôture du contrat : 31 décembre", textTruncated: false, note: "Texte fourni" }];
  const initial = JSON.stringify(assistantMessagesWithFiles([{ role: "user", content: "Quelle échéance ?" }], files));
  assert.ok(initial.length < 8500); assert.doesNotMatch(initial, /31 décembre/); assert.match(initial, /readAttachedDocument/);
  const found = readInrAssistantDocument(files, { documentIndex: 1, offset: 0, query: "Clôture" });
  assert.equal(found.ok, true); assert.match(JSON.stringify(found), /31 décembre/);
  const segment = readInrAssistantDocument(files, { documentIndex: 1, offset: 18000, query: null });
  assert.match(JSON.stringify(segment), /31 décembre/); assert.ok("source" in segment); assert.equal(segment.source, "untrusted_attachment");
});
test("pagination is bounded and invalid or unavailable documents never yield another file", () => {
  const files = [{ name: "long.txt", kind: "document" as const, text: "texte ".repeat(20000), note: "Extrait" }];
  const first = readInrAssistantDocument(files, { documentIndex: 1, offset: 0, query: null });
  assert.ok("excerpt" in first); assert.equal(first.excerpt.length, 6000); assert.equal(first.nextOffset, 6000); assert.equal(first.extractionLimited, true);
  for (const input of [{ documentIndex: 2, offset: 0, query: null }, { documentIndex: 1, offset: -1, query: null }, { documentIndex: 1, offset: 0, query: "" }]) assert.equal(readInrAssistantDocument(files, input).ok, false);
  assert.equal(readInrAssistantDocument([{ name: "scan.pdf", kind: "document", note: "Scan" }], { documentIndex: 1, offset: 0, query: null }).ok, false);
});
