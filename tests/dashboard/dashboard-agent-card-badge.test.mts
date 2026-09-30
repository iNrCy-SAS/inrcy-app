import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const dashboard = read("app/dashboard/DashboardClient.tsx");
const channels = read("app/dashboard/_components/DashboardChannelsSection.tsx");
const premium = read("app/dashboard/_components/DashboardModulesCard.tsx");
const standard = read("app/dashboard/_components/DashboardStandardModulesCard.tsx");
const logo = read("app/dashboard/_components/DashboardAgentLogoButton.tsx");
const logoCss = read("app/dashboard/_components/DashboardAgentLogoButton.module.css");
const topbar = read("app/dashboard/_components/DashboardTopbar.tsx");
const pendingCount = read("app/dashboard/_hooks/useInrAgentPendingCount.ts");

test("le dashboard retire le raccourci Agent du header et transmet son autorisation aux deux éditions", () => {
  assert.match(dashboard, /<DashboardTopbar[\s\S]*?inrAgentEnabled=\{canAccessInrAgent\}[\s\S]*?showInrAgent=\{false\}/);
  assert.match(dashboard, /<DashboardChannelsSection[\s\S]*?inrAgentEnabled=\{canAccessInrAgent\}/);
  assert.equal([...channels.matchAll(/inrAgentEnabled=\{inrAgentEnabled\}/g)].length, 2);
  assert.match(topbar, /useInrAgentPendingCount\(showInrAgent && inrAgentEnabled\)/);
});

test("les logos Premium et Standard ouvrent la navigation Agent existante sans ignorer chargement ou autorisation", () => {
  for (const source of [premium, standard]) {
    assert.match(source, /inrAgentEnabled\?: boolean/);
  }
  assert.match(standard, /\{ onOpenPremium, \.\.\.props \}/);
  assert.match(standard, /<DashboardModulesCard \{\.\.\.props\} standardMode openPanel=\{onOpenPremium\}/);
  assert.doesNotMatch(standard, /useInrAgentPendingCount|DashboardAgentLogoButton|useDelayedPendingAction/);
  assert.match(premium, /inrAgentEnabled = true/);
  assert.match(premium, /<DashboardAgentLogoButton[\s\S]*?enabled=\{inrAgentEnabled\}[\s\S]*?onClick=\{\(\) => startModuleNavigation\(agentPath\)\}/);
  assert.match(premium, /<DashboardAgentLogoButton[\s\S]*?busy=\{isModuleLoadingVisible\(agentPath\)\}/);
  assert.match(logo, /type="button"/);
  assert.match(logo, /disabled=\{!enabled \|\| busy\}/);
  assert.match(logo, /aria-busy=\{busy \|\| undefined\}/);
  assert.match(logo, /data-dashboard-prefetch=\{enabled \? "\/dashboard\/agent" : undefined\}/);
});

test("le badge n'affiche que le compteur réel partagé, au-delà de zéro et plafonné à 99+", () => {
  assert.match(logo, /const pendingCount = useInrAgentPendingCount\(enabled\)/);
  assert.match(logo, /const pendingLabel = pendingCount > 99 \? "99\+" : String\(pendingCount\)/);
  assert.match(logo, /enabled && pendingCount > 0 \? <span[^\n]*data-testid="dashboard-agent-pending-badge"[^\n]*>\{pendingLabel\}<\/span> : null/);
  assert.doesNotMatch(logo, /fetch\(|setInterval|localStorage|useEffect/);
  assert.match(pendingCount, /useSyncExternalStore/);
  assert.match(pendingCount, /enabled \? subscribe : subscribeDisabled/);
  assert.match(pendingCount, /requestPromisesByAccount = new Map/);
  assert.match(pendingCount, /ACTIVE_INRCY_ACCOUNT_EVENT/);
});

test("le logo reste rond, laisse déborder le badge et décrit les actions en attente de manière localisée", () => {
  assert.match(logo, /aria-label=\{actionLabel\}/);
  assert.match(logo, /title=\{actionLabel\}/);
  for (const key of ["inrAgentOpen", "inrAgentAction", "inrAgentActions", "inrAgentPending", "inrAgentDisabled"]) {
    assert.ok(logo.includes(`t.topbar.${key}`), key);
  }
  assert.match(logo, /src="\/icons\/inr-agent-header\.png" alt=""/);
  assert.match(logoCss, /button\.button\[data-agent-logo-button\]\s*\{[^}]*overflow: visible;[^}]*border-radius: 50%/);
  assert.match(logoCss, /\.badge\s*\{[^}]*position: absolute;[^}]*top: -7px;[^}]*right: -7px/);
  assert.match(logoCss, /\.button:focus-visible/);
});
