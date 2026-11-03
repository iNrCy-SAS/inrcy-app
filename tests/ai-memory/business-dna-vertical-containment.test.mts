import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const workspace = read("app/dashboard/settings/_components/BusinessDnaAnalysisWorkspace.tsx");
const css = read("app/dashboard/settings/_components/BusinessDnaAnalysisWorkspace.module.css");
const pageCss = read("app/dashboard/personnalisation/personalization.module.css");
const memory = read("app/dashboard/settings/_components/AiMemoryContent.tsx");

test("the unified analysis occupies the remaining desktop viewport with its actions in a separate footer", () => {
  assert.match(pageCss, /\[data-analysis-view="true"\][\s\S]*?height:100dvh !important/);
  assert.match(pageCss, /grid-template-rows:auto minmax\(0,1fr\)/);
  assert.match(workspace, /<aside className=\{styles\.sources\}[\s\S]*?className=\{styles\.result\}[\s\S]*?<footer/);
  assert.match(css, /\.sources\s*\{[^}]*grid-row: 1 \/ 3/);
  assert.match(css, /\.footer\s*\{[^}]*grid-column: 2;[^}]*grid-row: 2/);
});

test("source documents can grow locally and the narrow-screen workspace returns to natural page flow", () => {
  assert.match(css, /\.sourceScroll\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.workspace\s*\{[^}]*height: auto;[^}]*min-height: 0/);
  assert.match(css, /\.sourceScroll\s*\{[^}]*max-height: none;[^}]*overflow: visible/);
  assert.match(workspace, /data-analysis-action-group/);
});

test("the original ADN model retains its rungs, bridges and two particle streams", () => {
  assert.match(memory, /length: 15/);
  for (const marker of ['data-dna-rung', 'data-dna-bridge', 'data-dna-node="a"', 'data-dna-node="b"', 'data-dna-stream="left"', 'data-dna-stream="right"']) assert.ok(memory.includes(marker), marker);
  assert.match(css, /width: min\(530px,100%\)[^;]*;[^}]*height: 300px/);
  assert.match(css, /@keyframes turnA/);
  assert.match(css, /@keyframes turnB/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("the persistent DNA score and title participate in layout above the model", () => {
  assert.match(workspace, /className=\{styles\.resultHeading\}[\s\S]*?data-dna-score-summary[\s\S]*?className=\{styles\.dnaTitle\}[\s\S]*?className=\{styles\.animation\}/);
  assert.match(css, /\.resultHeading\s*\{[^}]*display: flex/);
  const scoreRule = css.match(/\.score\s*\{([^}]+)\}/)?.[1] || "";
  assert.ok(scoreRule);
  assert.doesNotMatch(scoreRule, /position:\s*absolute/);
});
