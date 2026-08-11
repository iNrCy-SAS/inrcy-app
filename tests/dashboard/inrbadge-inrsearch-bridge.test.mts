import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_INRBADGE_SHARE_SETTINGS,
  normalizeInrBadgeShareSettings,
} from "../../lib/inrBadgeSettings.ts";
import { effectiveInrBadgeShareSettings } from "../../lib/inrBadgeEditionPolicy.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const dashboard = read("app/dashboard/DashboardClient.tsx");
const settingsPanel = read("app/dashboard/settings/_components/InrBadgeSettingsContent.tsx");
const publicBadge = read("app/badge/[slug]/page.tsx");
const publicBadgeStyles = read("app/badge/[slug]/badge.module.css");

test("iNr'Search is a persisted iNrBadge sharing choice in every edition", () => {
  assert.equal(DEFAULT_INRBADGE_SHARE_SETTINGS.inrSearch, true);
  assert.equal(normalizeInrBadgeShareSettings({}).inrSearch, true);

  const standardSettings = effectiveInrBadgeShareSettings(
    { ...DEFAULT_INRBADGE_SHARE_SETTINGS, inrSearch: true, appointment: true },
    "standard",
  );
  assert.equal(standardSettings.inrSearch, true);
  assert.equal(standardSettings.appointment, false);
});

test("the dashboard only enables the iNr'Search share option for a published page", () => {
  assert.match(settingsPanel, /key: "inrSearch", label: "iNr'Search"/);
  assert.match(settingsPanel, /canShareChannel\(channels\.inrSearch\)/);
  assert.match(
    dashboard,
    /inrSearch:\s*\{\s*connected: Boolean\(canAccessInrSearch && inrSearchConnected && inrSearchUrl\)/,
  );
});

test("the public badge exposes iNr'Search as a channel and a verified news CTA", () => {
  assert.match(publicBadge, /getInrSearchPublicStatus\(inrSearchSlug\)/);
  assert.match(publicBadge, /inrSearchStatus\?\.published \? inrSearchStatus\.publicUrl/);
  assert.match(publicBadge, /label: "iNr'Search"/);
  assert.match(publicBadge, /label: "Voir nos actualités"/);
  assert.match(publicBadge, /`\$\{inrSearchUrl\}#actualites`/);
  assert.match(publicBadgeStyles, /\.ctaWrap \.tone_inrsearch/);
});

test("Standard keeps the appointment card visible but locked as Premium", () => {
  assert.match(settingsPanel, /aria-label="Prise de RDV réservée au forfait Premium"/);
  assert.match(settingsPanel, /<span style=\{premiumPillStyle\}>Premium<\/span>/);
  assert.match(settingsPanel, /Disponible avec iNr’Calendar dans le forfait Premium/);
});

test("channel row balancing cannot truncate a ninth or tenth channel", () => {
  assert.match(publicBadge, /Math\.ceil\(actions\.length \/ 4\)/);
  assert.match(publicBadge, /actions\.slice\(cursor, cursor \+ size\)/);
  assert.doesNotMatch(publicBadge, /:\s*\[4, 4\];/);
});
