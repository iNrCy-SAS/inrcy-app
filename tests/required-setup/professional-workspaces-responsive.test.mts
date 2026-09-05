import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const sharedHeader = read("../../app/dashboard/_components/DashboardWorkspaceHeader.tsx");
const profile = read("../../app/dashboard/settings/_components/ProfilContent.tsx");
const configuration = read("../../app/dashboard/settings/_components/AiConfigurationContent.tsx");
const businessDna = read("../../app/dashboard/settings/_components/AiMemoryContent.tsx");

test("the three professional workspaces share a mobile-safe header and page shell", () => {
  assert.match(sharedHeader, /@media \(max-width: 820px\)/);
  assert.match(sharedHeader, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.match(sharedHeader, /@media \(max-width: 520px\)/);
  assert.match(sharedHeader, /overflowX: "clip"/);
});

test("profile and AI configuration collapse fields without horizontal overflow", () => {
  assert.match(profile, /@media \(max-width: 620px\)[\s\S]*?grid-template-columns: 1fr !important/);
  assert.match(configuration, /@media \(max-width: 1120px\)[\s\S]*?grid-template-columns: 1fr !important/);
  assert.match(configuration, /@media \(max-width: 760px\)[\s\S]*?\[data-ai-card-fields\][\s\S]*?grid-template-columns: 1fr !important/);
  assert.match(configuration, /grid-template-columns: minmax\(0, \.75fr\) minmax\(0, 1\.25fr\) !important/);
});

test("Business DNA uses one swipeable tab and keeps its analysis content within the phone viewport", () => {
  assert.match(businessDna, /data-ai-memory-mobile-tabs/);
  assert.match(businessDna, /onTouchStart=/);
  assert.match(businessDna, /onTouchEnd=/);
  assert.match(businessDna, /\[data-business-dna-channel-states\][\s\S]*?flex-wrap: wrap !important/);
  assert.match(businessDna, /\[data-dna-score-summary\] \{ top: -4px !important; \}/);
  assert.match(businessDna, /\[data-dna-score-help\]::after \{[\s\S]*?right: -2px;[\s\S]*?width: min\(220px, calc\(100vw - 76px\)\)/);
  assert.doesNotMatch(businessDna, /@media \(max-width: 640px\)[\s\S]*?\[data-dna-score-help\]::after \{[\s\S]*?left: 50%/);
});
