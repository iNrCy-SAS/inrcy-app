import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const lockSource = readFileSync(
  new URL("../../app/dashboard/_components/RequiredSetupLock.tsx", import.meta.url),
  "utf8",
);
const modulesSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardModulesCard.tsx", import.meta.url),
  "utf8",
);
const channelsSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardChannelsSection.tsx", import.meta.url),
  "utf8",
);
const topbarSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardTopbar.tsx", import.meta.url),
  "utf8",
);
const bottomNavSource = readFileSync(
  new URL("../../app/dashboard/_components/ResponsiveBottomNav.tsx", import.meta.url),
  "utf8",
);
const i18nSource = readFileSync(
  new URL("../../messages/fr-FR/dashboard.json", import.meta.url),
  "utf8",
);

test("the lock only explains the block and never redirects to a settings panel", () => {
  assert.match(lockSource, /onMouseEnter=\{\(\) => \{ if \(!isResponsive\) setOpen\(true\); \}\}/);
  assert.match(lockSource, /if \(isResponsive\) setOpen\(\(value\) => !value\)/);
  assert.match(lockSource, /event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);/);
  assert.doesNotMatch(lockSource, /router\.|openPanel|window\.location/);
});

test("desktop modules integrate locks into COMS and every gearbox title", () => {
  assert.match(modulesSource, /requiredSetupLockLoopBadge/);
  assert.equal((modulesSource.match(/renderGearTitle\(t\.modules\./g) || []).length >= 5, true);
  assert.match(modulesSource, /t\.modules\.reputationTitle/);
  assert.match(modulesSource, /t\.modules\.requiredSetupLocked/);
});

test("iNrAgent, iNrSend, iNrBadge and iNrSearch display the same status lock", () => {
  assert.match(channelsSource, /\["inr_agent", "mails", "inrbadge", "inr_search"\]\.includes\(item\.key\)/);
  assert.match(topbarSource, /inrAgentSetupLocked/);
  assert.match(topbarSource, /RequiredSetupLock/);
});

test("responsive shortcuts and Publish expose a clickable lock without a settings link", () => {
  assert.match(bottomNavSource, /shortcutLocked = requiredSetupLocked && isDashboardRequiredSetupProtectedDestination/);
  assert.match(bottomNavSource, /requiredSetupLockShortcut/);
  assert.match(bottomNavSource, /requiredSetupLockPublish/);
});

test("the French tooltip uses the approved wording", () => {
  assert.match(i18nSource, /"requiredSetupLocked": "Mon profil et\/ou Mon activité sont incomplets\."/);
});

test("desktop keyboard focus keeps the explanatory tooltip open", () => {
  assert.match(lockSource, /if \(isResponsive\) \{[\s\S]*setOpen\(\(value\) => !value\)[\s\S]*\} else \{[\s\S]*setOpen\(true\)/);
});
