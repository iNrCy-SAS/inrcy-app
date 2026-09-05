import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  BUSINESS_DNA_MAX_WEBSITE_PAGES,
  BUSINESS_DNA_MAX_WEBSITE_SOURCE_CHARS,
  buildBalancedBusinessDnaWebsiteContent,
} from "../../lib/businessDnaWebsiteBudget.ts";

const ROOT = resolve(import.meta.dirname, "../..");

function pageSections(content: string) {
  return content.split("\n\nPAGE ").map((section, index) => (
    index === 0 ? section : `PAGE ${section}`
  ));
}

test("website collection keeps at most eight pages including the home page", () => {
  const documents = Array.from({ length: 12 }, (_value, index) => ({
    url: index === 0 ? "https://example.test/" : `https://example.test/page-${index}`,
    text: `marker-${index} ${"x".repeat(500)}`,
  }));

  const content = buildBalancedBusinessDnaWebsiteContent(documents);
  const sections = pageSections(content);

  assert.equal(BUSINESS_DNA_MAX_WEBSITE_PAGES, 8);
  assert.equal(sections.length, 8);
  for (let index = 0; index < 8; index += 1) {
    assert.match(content, new RegExp(`marker-${index}\\b`));
  }
  assert.doesNotMatch(content, /marker-8\b/);
});

test("a very long home page cannot evict any discovered useful page", () => {
  const documents = [
    { url: "https://example.test/", text: `HOME ${"h".repeat(14_000)}` },
    ...Array.from({ length: 7 }, (_value, index) => ({
      url: `https://example.test/service-${index + 1}`,
      text: `SERVICE_${index + 1} ${String(index + 1).repeat(4_000)}`,
    })),
  ];

  const content = buildBalancedBusinessDnaWebsiteContent(documents);
  const sections = pageSections(content);

  assert.equal(sections.length, 8);
  assert.match(sections[0], /HOME/);
  for (let index = 1; index <= 7; index += 1) {
    assert.match(content, new RegExp(`SERVICE_${index}\\b`));
  }
  assert.ok(sections[0].length < 3_000, "the home page must receive a fair share, not ~14k");
  const representedLengths = sections.map((section) => section.length);
  assert.ok(Math.max(...representedLengths) - Math.min(...representedLengths) < 100);
});

test("balanced website content respects the exact unchanged 16k source ceiling", () => {
  const content = buildBalancedBusinessDnaWebsiteContent(
    Array.from({ length: 8 }, (_value, index) => ({
      url: `https://example.test/useful-${index}`,
      text: `${index}-${"é".repeat(30_000)}`,
    })),
  );

  assert.equal(BUSINESS_DNA_MAX_WEBSITE_SOURCE_CHARS, 16_000);
  assert.equal(content.length, BUSINESS_DNA_MAX_WEBSITE_SOURCE_CHARS);
});

test("collector preserves parallel fetch, SSRF, failure tolerance and 30 second timeout", () => {
  const collector = readFileSync(
    resolve(ROOT, "lib/businessDnaChannelAnalysis.ts"),
    "utf8",
  );

  assert.match(collector, /\.slice\(0, BUSINESS_DNA_MAX_WEBSITE_PAGES - 1\)/);
  assert.match(collector, /Promise\.allSettled\([\s\S]*?usefulLinks\.map/);
  assert.match(collector, /fetchPublicWebsitePage\(new URL\(link\)\)/);
  assert.match(collector, /current = await assertPublicWebsiteUrl\(current\.toString\(\)\)/);
  assert.match(collector, /const MAX_SOURCE_COLLECTION_MS = 30_000/);
  assert.match(collector, /signal: AbortSignal\.timeout\(9_000\)/);
  assert.match(collector, /result\.status === "fulfilled" && result\.value\.text/);
});
