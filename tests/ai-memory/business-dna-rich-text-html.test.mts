import assert from "node:assert/strict";
import test from "node:test";
import { businessDnaHtmlToPlainText, sanitizeBusinessDnaRichHtml } from "../../lib/businessDnaRichText.ts";

test("formatting a paragraph as a list persists valid HTML without synthetic empty paragraphs", () => {
  for (const tag of ["ul", "ol"]) {
    const input = `<p><${tag}><li><strong>Argument clair</strong></li></${tag}></p>`;
    const html = sanitizeBusinessDnaRichHtml(input);
    assert.equal(html, `<${tag}><li><strong>Argument clair</strong></li></${tag}>`);
    assert.equal(businessDnaHtmlToPlainText(html), "• Argument clair");
    assert.equal(sanitizeBusinessDnaRichHtml(html), html);
  }
});

test("repairing paragraph wrappers preserves neighbouring text, headings and deliberate blank lines", () => {
  const input = "<p><br></p><p>Introduction<h3>Notre offre</h3>Conclusion</p><p><br></p>";
  const html = sanitizeBusinessDnaRichHtml(input);
  assert.equal(html, "<p><br></p><p>Introduction</p><h3>Notre offre</h3>Conclusion<p><br></p>");
  assert.equal(businessDnaHtmlToPlainText(html), "Introduction\nNotre offre\nConclusion");
  assert.equal(sanitizeBusinessDnaRichHtml(html), html);
});

test("valid rich text stays unchanged and repaired blocks retain the existing security filter and limits", () => {
  const valid = "<div><p>Une <strong>offre</strong> <em>précise</em></p><ul><li><p>Premier point</p></li></ul></div>";
  assert.equal(sanitizeBusinessDnaRichHtml(valid), valid);
  const hostile = '<p onclick="bad()"><ul><li><b>Argument</b><script>bad()</script><img src=x onerror="bad()"></li></ul></p>';
  assert.equal(sanitizeBusinessDnaRichHtml(hostile), "<ul><li><strong>Argument</strong></li></ul>");
  const oversized = `<p><ul><li>${"Argument ".repeat(2_000)}</li></ul></p>`;
  assert.ok(sanitizeBusinessDnaRichHtml(oversized).length <= 7_000);
});
