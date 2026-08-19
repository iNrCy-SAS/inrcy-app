import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("shared delayed pending hook avoids loading flashes while keeping actions protected", () => {
  const hook = read("hooks/useDelayedPendingAction.ts");

  assert.match(hook, /DEFAULT_PENDING_DELAY_MS = 650/);
  assert.match(hook, /DEFAULT_PENDING_MIN_VISIBLE_MS = 250/);
  assert.match(hook, /pendingKeyRef\.current = key/);
  assert.match(hook, /setPendingKey\(key\)/);
  assert.match(hook, /setVisibleKey\(key\)/);
  assert.match(hook, /scheduleDelayedReveal/);
  const scheduler = read("lib/delayedPendingReveal.ts");
  assert.match(scheduler, /paintFrameId = scheduler\.requestFrame/);
  assert.match(scheduler, /revealFrameId = scheduler\.requestFrame/);
  assert.match(scheduler, /delay starts after the first browser frame/);
  assert.match(scheduler, /label is committed on a separate frame/);
  assert.match(hook, /Date\.now\(\) - visibleSinceRef\.current/);
  assert.match(hook, /Math\.max\(0, minVisibleMs - visibleForMs\)/);
  assert.match(hook, /DEFAULT_PENDING_TIMEOUT_MS = 8_000/);
});

test("dashboard tool, modal and configure buttons share the delayed loading behavior", () => {
  const actionButton = read("app/dashboard/_components/DashboardActionButton.tsx");
  const modules = read("app/dashboard/_components/DashboardModulesCard.tsx");
  const bubble = read("app/dashboard/_components/DashboardFluxBubble.tsx");
  const mobileNavigation = read("app/dashboard/_components/ResponsiveBottomNav.tsx");

  for (const source of [actionButton, modules, bubble, mobileNavigation]) {
    assert.match(source, /useDelayedPendingAction/);
    assert.match(source, /aria-busy=/);
    assert.match(source, /i18nT\("chargement_01cba1df"\)/);
  }

  assert.match(actionButton, /loadingVisible \? i18nT\("chargement_01cba1df"\) : action\.label/);
  assert.match(modules, /modal:publish/);
  assert.match(modules, /modal:cash/);
  assert.match(modules, /panel:/);
  assert.match(modules, /route:/);
  assert.match(bubble, /configureLoadingVisible \? i18nT\("chargement_01cba1df"\)/);
  assert.match(bubble, /data-dashboard-prefetch=/);
  assert.match(mobileNavigation, /modal:publish/);
  assert.match(mobileNavigation, /shortcutLoadingVisible/);
});

test("bubble logos use immutable static assets and stay mounted in the dashboard layout", () => {
  const constants = read("app/dashboard/dashboard.constants.ts");
  const layout = read("app/dashboard/layout.tsx");
  const persistentCache = read("app/dashboard/_components/DashboardPersistentImageCache.tsx");
  const bubble = read("app/dashboard/_components/DashboardFluxBubble.tsx");
  const channels = read("app/dashboard/_components/DashboardChannelsSection.tsx");

  assert.match(constants, /import inrcyBubbleIcon from/);
  assert.match(constants, /DASHBOARD_BUBBLE_ICON_PRELOADS/);
  assert.match(constants, /moduleIcon\.src|inrcyBubbleIcon\.src/);
  assert.match(layout, /DashboardPersistentImageCache/);
  assert.match(layout, /fetchPriority="high"/);
  assert.match(persistentCache, /data-dashboard-persistent-image-cache/);
  assert.match(persistentCache, /loading="eager"/);
  assert.match(persistentCache, /DASHBOARD_BUBBLE_ICON_PRELOADS\.map/);
  assert.match(bubble, /loading="eager"/);
  assert.match(bubble, /fetchPriority="high"/);
  assert.match(channels, /className=\{styles\.carouselIconImg\}/);
  assert.match(channels, /decoding="sync"/);
});
