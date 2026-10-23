import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const booster = read("app/dashboard/_components/DashboardBoosterModalLayer.tsx");
const agent = read("app/dashboard/agent/AgentClient.tsx");
const header = read("app/dashboard/agent/_components/AgentWorkspaceHeader.tsx");
const icon = read("app/dashboard/_components/BusinessDnaIcon.tsx");

test("Booster Publier exposes an accessible guarded ADN shortcut beside IA", () => {
  const ai = booster.indexOf("<AiConfigurationIcon");
  const dna = booster.indexOf("<BusinessDnaIcon");
  const drafts = booster.indexOf("<PublishDraftHeaderMenu", dna);
  const save = booster.indexOf("publishSaveDraftRef.current?.()", drafts);

  assert.ok(ai >= 0 && dna > ai && drafts > dna && save > drafts);
  assert.match(booster, /const openBusinessDna = useCallback\(async \(\) => \{[\s\S]*await confirmPublishExit\(\)[\s\S]*router\.push\("\/dashboard\/adn-entreprise"\)/);
  assert.match(booster, /title=\{dashboardT\("aiMemory\.openTitle"\)\}/);
  assert.match(booster, /aria-label=\{dashboardT\("aiMemory\.openTitle"\)\}/);
  assert.match(booster, /styles\.aiHeaderBtn[\s\S]*styles\.dnaHeaderBtn/);
});

test("Booster keeps the publication flow focused and uses an unframed DNA mark inside its round button", () => {
  assert.doesNotMatch(booster, /data-inr-agent-header-shortcut|openInrAgent|\/icons\/inr-agent-header\.png/);
  const svg = read("public/icons/business-dna.svg");
  assert.doesNotMatch(svg, /<rect/);
  assert.match(svg, /id="helixA"/);
  assert.match(svg, /id="helixB"/);
});

test("specialist headers expose their own controls while ADN remains accessible in manual Booster", () => {
  assert.match(agent, /<AgentWorkspaceHeader/);
  assert.match(agent, /onSettings=\{\(\) =>/);
  assert.match(agent, /onPlanning=\{\(\) =>/);
  assert.match(agent, /exitScheduledEditSession\(\{ silent: true, onAfterExit: open \}\)/);
  assert.match(agent, /useUnsavedExitGuard\(\{/);
  assert.doesNotMatch(header, /BusinessDnaIcon|AiConfigurationIcon/);
  assert.match(booster, /<BusinessDnaIcon/);
});

test("the manual Booster header keeps the existing business DNA asset", () => {
  assert.match(icon, /src="\/icons\/business-dna\.svg\?v=2"/);
  assert.match(icon, /data-business-dna-icon/);
  assert.match(booster, /import BusinessDnaIcon from "\.\/BusinessDnaIcon"/);
});
