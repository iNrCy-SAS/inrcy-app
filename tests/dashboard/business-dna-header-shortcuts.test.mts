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
  const agentShortcut = booster.indexOf("data-inr-agent-header-shortcut", dna);
  const save = booster.indexOf("publishSaveDraftRef.current?.()", agentShortcut);

  assert.ok(ai >= 0 && dna > ai && agentShortcut > dna && save > agentShortcut);
  assert.match(booster, /const openBusinessDna = useCallback\(async \(\) => \{[\s\S]*await confirmPublishExit\(\)[\s\S]*router\.push\("\/dashboard\/adn-entreprise"\)/);
  assert.match(booster, /title=\{dashboardT\("aiMemory\.openTitle"\)\}/);
  assert.match(booster, /aria-label=\{dashboardT\("aiMemory\.openTitle"\)\}/);
  assert.match(booster, /styles\.aiHeaderBtn[\s\S]*styles\.dnaHeaderBtn/);
});

test("Booster Publier exposes the existing iNrAgent mark with the same draft guard", () => {
  assert.match(booster, /const openInrAgent = useCallback\(async \(\) => \{[\s\S]*await confirmPublishExit\(\)[\s\S]*router\.push\("\/dashboard\/agent"\)/);
  assert.match(booster, /src="\/icons\/inr-agent-header\.png"/);
  assert.match(booster, /title=\{dashboardT\("topbar\.inrAgentOpen"\)\}/);
  assert.match(booster, /aria-label=\{dashboardT\("topbar\.inrAgentOpen"\)\}/);
  assert.match(booster, /styles\.aiHeaderBtn[\s\S]*styles\.agentHeaderBtn/);
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
  assert.match(icon, /src="\/icons\/business-dna\.svg"/);
  assert.match(icon, /data-business-dna-icon/);
  assert.match(booster, /import BusinessDnaIcon from "\.\/BusinessDnaIcon"/);
});
