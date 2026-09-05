import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../app/dashboard/settings/_components/AiMemoryContent.tsx", import.meta.url),
  "utf8",
);

test("Business DNA shows one numbered mobile tab with arrows and swipe navigation", () => {
  assert.match(source, /data-ai-memory-mobile-tabs/);
  assert.match(source, /activeTabIndex \+ 1} \/ {tabs\.length/);
  assert.match(source, /onTouchStart=/);
  assert.match(source, /onTouchEnd=/);
  assert.match(source, /Math\.abs\(deltaX\) < 54/);
  assert.match(source, /nav\[data-ai-memory-desktop-tabs\] \{ display: none !important; \}/);
  assert.match(source, /nav\[data-ai-memory-mobile-tabs\] \{ display: grid !important; \}/);
});

test("mobile Business DNA channels wrap inside the analysis card", () => {
  assert.match(source, /\[data-business-dna-channel-states\][\s\S]*?flex-wrap: wrap !important/);
  assert.doesNotMatch(
    source.slice(source.indexOf("@media (max-width: 720px)")),
    /\[data-business-dna-channel-states\][\s\S]{0,220}flex-wrap: nowrap/,
  );
});

test("mobile DNA score keeps a dedicated gap above the illustration", () => {
  const mobileStyles = source.slice(source.indexOf("@media (max-width: 720px)"));

  assert.match(
    mobileStyles,
    /\[data-business-dna-analysis-orb\][\s\S]{0,220}height: 270px !important;[\s\S]{0,160}padding-top: 48px/,
  );
  assert.match(mobileStyles, /\[data-dna-score-summary\] \{ top: -4px !important; \}/);
});
