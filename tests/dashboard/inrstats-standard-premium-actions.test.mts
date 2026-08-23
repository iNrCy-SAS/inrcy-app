import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isDashboardDestinationAllowedForEdition,
} from "../../lib/dashboardEdition.ts";
import {
  applyStatsEditionActionPolicy,
  isPremiumStatsAction,
  isPremiumStatsRecommendedTool,
} from "../../app/dashboard/stats/stats.edition-policy.ts";
import type { CubeModel } from "../../app/dashboard/stats/stats.shared.types.ts";

const statsClientSource = readFileSync(
  new URL("../../app/dashboard/stats/StatsClient.tsx", import.meta.url),
  "utf8",
);
const statsUiSource = readFileSync(
  new URL("../../app/dashboard/stats/stats.ui.tsx", import.meta.url),
  "utf8",
);
const statsModelSource = readFileSync(
  new URL("../../app/dashboard/stats/stats.shared.model.ts", import.meta.url),
  "utf8",
);
const notificationMenuSource = readFileSync(
  new URL("../../app/dashboard/_components/NotificationMenu.tsx", import.meta.url),
  "utf8",
);

function action(
  overrides: Partial<CubeModel["action"]> = {},
): CubeModel["action"] {
  return {
    key: "booster_publier",
    title: "Booster",
    detail: "Publier",
    href: "/dashboard?action=publish",
    pill: "Booster",
    ...overrides,
  };
}

test("Standard verrouille Propulser et Fideliser sans les remplacer par Booster", () => {
  const propulser = action({
    key: "propulser_action",
    title: "Propulser",
    pill: "Propulser",
    href: "/dashboard/propulser",
  });
  const fideliser = action({
    key: "fideliser_action",
    title: "Fidéliser",
    pill: "Fidéliser",
    href: "/dashboard/fideliser",
  });

  for (const premiumAction of [propulser, fideliser]) {
    assert.equal(isPremiumStatsAction(premiumAction), true);
    assert.deepEqual(applyStatsEditionActionPolicy(premiumAction, true), {
      ...premiumAction,
      href: "",
      premiumLocked: true,
    });
    assert.equal(
      applyStatsEditionActionPolicy(premiumAction, false),
      premiumAction,
    );
  }
});

test("Standard conserve le GO Booster actif", () => {
  const booster = action();
  assert.equal(isPremiumStatsAction(booster), false);
  assert.equal(applyStatsEditionActionPolicy(booster, true), booster);
  assert.equal(isPremiumStatsRecommendedTool("booster"), false);
  assert.equal(isPremiumStatsRecommendedTool("propulser"), true);
  assert.equal(isPremiumStatsRecommendedTool("fideliser"), true);
});

test("les destinations affichees dans la synthese correspondent a leur outil", () => {
  assert.match(
    statsModelSource,
    /inr_search:\s*"\/dashboard\/propulser"/,
  );
  assert.match(
    statsModelSource,
    /mails:\s*"\/dashboard\/fideliser"/,
  );
  assert.match(
    statsModelSource,
    /facebook:\s*"\/dashboard\?action=publish"/,
  );
  assert.match(
    statsClientSource,
    /actionItem\?\.actionHref \|\| model\.action\.href/,
  );
});

test("les deux vues iNrStats rendent le cadenas et desactivent vraiment GO", () => {
  assert.match(
    statsClientSource,
    /disabled=\{premiumLocked\}/,
  );
  assert.match(
    statsClientSource,
    /isPremiumStatsRecommendedTool\(actionItem\?\.recommendedTool\)/,
  );
  assert.match(
    statsUiSource,
    /const actionDisabled = model\.loading \|\| !action\.href \|\| premiumLocked/,
  );
  assert.match(
    statsUiSource,
    /disabled=\{actionDisabled\}/,
  );
  assert.match(
    statsUiSource,
    /premiumLockIcon[\s\S]*🔒/,
  );
});

test("les CTA dynamiques Standard ne peuvent pas ouvrir un outil Premium", () => {
  assert.equal(
    isDashboardDestinationAllowedForEdition("/dashboard/propulser", "standard"),
    false,
  );
  assert.equal(
    isDashboardDestinationAllowedForEdition("/dashboard/fideliser", "standard"),
    false,
  );
  assert.equal(
    isDashboardDestinationAllowedForEdition("/dashboard/crm?lead=1", "standard"),
    false,
  );
  assert.equal(
    isDashboardDestinationAllowedForEdition("/dashboard?action=publish", "standard"),
    true,
  );
  assert.equal(
    isDashboardDestinationAllowedForEdition("/dashboard/stats", "standard"),
    true,
  );
  assert.equal(
    isDashboardDestinationAllowedForEdition("/dashboard/propulser", "premium"),
    true,
  );
  assert.match(
    notificationMenuSource,
    /disabled=\{premiumCtaLocked\}/,
  );
  assert.match(
    notificationMenuSource,
    /isDashboardDestinationAllowedForEdition\(item\.cta_url, dashboardEdition\)/,
  );
});
