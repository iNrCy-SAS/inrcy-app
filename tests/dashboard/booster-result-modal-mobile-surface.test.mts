import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8").replace(/\r\n/g, "\n");

const resultModal = read(
  "app/dashboard/_components/PublishExecutionResultModal.tsx",
);
const resultStyles = read("app/dashboard/_components/PublishExecutionResultModal.module.css");

test("the standalone result owns a bounded opaque surface while actions remain outside the scrolling content", () => {
  assert.doesNotMatch(resultModal, /styles\.blockCard/);
  assert.match(resultStyles, /\.shell \{[^}]*max-height: min\(900px, calc\(100dvh - 48px\)\)[^}]*background: linear-gradient/);
  assert.match(resultStyles, /\.scrollSurface \{[^}]*min-height: 0[^}]*overflow-y: auto[^}]*overflow-x: hidden[^}]*overscroll-behavior: contain/);
  assert.match(resultStyles, /\.standaloneFooter \{[^}]*flex-shrink: 0[^}]*background: #0c1220/);
  assert.match(resultModal, /className=\{resultCss\.scrollSurface\}>\{resultCard\}<\/div>\s*<footer className=\{resultCss\.standaloneFooter\}>\{resultActions\}/);
  assert.match(resultModal, /<PublishWizardFrame[\s\S]*?footer=\{resultActions\}/);
  assert.match(resultStyles, /@media \(max-width: 700px\)[\s\S]*max-height: calc\(100dvh - var\(--inrcy-mobile-bottom-nav-total-height/);
  assert.match(resultStyles, /@media \(max-width: 700px\)[\s\S]*\.overlay \{ bottom: var\(--inrcy-mobile-bottom-nav-total-height/);
});

test("the result is readable as a single column on phones and respects reduced motion", () => {
  assert.match(resultStyles, /@media \(max-width: 700px\)[\s\S]*\.channelGrid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(resultStyles, /\.actions \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(resultStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none[\s\S]*transition: none !important/);
  assert.match(resultModal, /aria-labelledby=\{titleId\}/);
  assert.match(resultModal, /event\.key === "Escape"/);
  assert.match(resultModal, /event\.key === "Tab"/);
});
