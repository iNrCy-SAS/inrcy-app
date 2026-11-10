import assert from "node:assert/strict";
import test from "node:test";
import { parseInrAssistantAttachmentReadInput, readInrAssistantDocument } from "../../lib/inrAssistantAttachmentReader.ts";
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

test("a combined keyword search falls back explicitly and returns real bounded source positions", () => {
  const text = "İstanbul : préface multilingue.\n" + "Archive de l’atelier. ".repeat(1100) + "\nAVENANT SIGNÉ : délai de paiement de 45 jours.\n";
  const result = readInrAssistantDocument([{ name: "contrat.txt", kind: "document", text, note: "Texte extrait" }], { documentIndex: 1, offset: 0, query: "paiement délai avenant" });
  assert.ok("matches" in result); assert.equal(result.searchMode, "any_query_term");
  assert.match(JSON.stringify(result.matches), /45 jours/);
  assert.ok(result.matches.length <= 5);
  assert.ok(result.matches.reduce((sum, match) => sum + match.excerpt.length, 0) <= 6000);
  for (const match of result.matches) assert.equal(text.slice(match.offset, match.offset + match.excerpt.length), match.excerpt);
  assert.match(result.message, /pas une correspondance de la phrase entière/);
});

test("literal evidence takes priority and a no-result or EOF search gives actionable retry guidance", () => {
  const text = "Paiement ancien.\n" + "Archive. ".repeat(1000) + "\nAVENANT : paiement délai signé.\n";
  const files = [{ name: "contrat.txt", kind: "document" as const, text, note: "Texte extrait" }];
  const literal = readInrAssistantDocument(files, { documentIndex: 1, offset: 0, query: "paiement délai" });
  assert.ok("matches" in literal); assert.equal(literal.searchMode, "literal"); assert.equal(literal.matches.length, 1);
  assert.match(literal.matches[0].excerpt, /AVENANT/);
  const eof = readInrAssistantDocument(files, { documentIndex: 1, offset: text.length, query: "avenant" });
  assert.ok("matches" in eof); assert.equal(eof.matches.length, 0); assert.match(eof.message, /offset=0/); assert.match(eof.message, /query=null/);
  const missing = readInrAssistantDocument(files, { documentIndex: 1, offset: 0, query: "introuvable" });
  assert.ok("matches" in missing); assert.equal(missing.matches.length, 0); assert.match(missing.message, /mot-clé court/);
});

test("empty queries and forged reader fields are invalid while null reads a real segment", () => {
  for (const query of ["", " ", "ab"]) assert.throws(() => parseInrAssistantAttachmentReadInput({ documentIndex: 1, offset: 0, query }), /query=null/);
  assert.throws(() => parseInrAssistantAttachmentReadInput({ documentIndex: 1, offset: 0, query: null, accountId: "forged" }));
  const input = parseInrAssistantAttachmentReadInput({ documentIndex: 1, offset: 0, query: null });
  const result = readInrAssistantDocument([{ name: "texte.txt", kind: "document", text: "Texte réellement extrait.", note: "Texte extrait" }], input);
  assert.ok("excerpt" in result); assert.equal(result.excerpt, "Texte réellement extrait.");
});
test("pagination is bounded and invalid or unavailable documents never yield another file", () => {
  const files = [{ name: "long.txt", kind: "document" as const, text: "texte ".repeat(20000), note: "Extrait" }];
  const first = readInrAssistantDocument(files, { documentIndex: 1, offset: 0, query: null });
  assert.ok("excerpt" in first); assert.equal(first.excerpt.length, 6000); assert.equal(first.nextOffset, 6000); assert.equal(first.extractionLimited, true);
  for (const input of [{ documentIndex: 2, offset: 0, query: null }, { documentIndex: 1, offset: -1, query: null }, { documentIndex: 1, offset: 0, query: "" }]) assert.equal(readInrAssistantDocument(files, input).ok, false);
  assert.equal(readInrAssistantDocument([{ name: "scan.pdf", kind: "document", note: "Scan" }], { documentIndex: 1, offset: 0, query: null }).ok, false);
});
