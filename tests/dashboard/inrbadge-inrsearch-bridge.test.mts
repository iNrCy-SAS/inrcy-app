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
  assert.match(settingsPanel, /key: "inrSearch", label: i18nT\("inr_search_ce47ed45"\)/);
  assert.match(settingsPanel, /canShareChannel\(channels\.inrSearch\)/);
  assert.match(
    dashboard,
    /inrSearch:\s*\{\s*connected: Boolean\(canAccessInrSearch && inrSearchConnected && inrSearchUrl\)/,
  );
});

test("the public badge exposes iNr'Search as a channel and a verified news CTA", () => {
  assert.match(publicBadge, /getInrSearchPublicStatus\(inrSearchSlug\)/);
  assert.match(publicBadge, /inrSearchStatus\?\.published \? inrSearchStatus\.publicUrl/);
  assert.match(publicBadge, /label: i18nT\("inr_apos_search_6cbfd855"\)/);
  assert.match(publicBadge, /label: i18nT\("voir_nos_actualites_052324ba"\)/);
  assert.match(publicBadge, /`\$\{inrSearchUrl\}#actualites`/);
  assert.match(publicBadgeStyles, /\.ctaWrap \.tone_inrsearch/);
  assert.match(publicBadge, /inr-search-bubble-128\.png/);
  assert.match(publicBadge, /inr-search-logo-transparent\.png/);
  assert.match(publicBadge, /iconSrc: inrSearchBubbleIcon\.src/);
  assert.match(publicBadge, /iconSrc: inrSearchLogo\.src/);
  assert.match(publicBadgeStyles, /\.channelsRow > \.tone_inrsearch\.actionIconOnly \.iconImage/);
  assert.match(
    publicBadgeStyles,
    /\.ctaWrap \.tone_inrsearch \.arrow,[\s\S]*?position: relative;[\s\S]*?display: grid;[\s\S]*?place-items: center;[\s\S]*?transform: none;/,
  );
  assert.match(
    publicBadgeStyles,
    /\.ctaWrap \.tone_inrsearch \.actionIcon,[\s\S]*?\{[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
  );
});

test("Standard keeps the appointment card visible but locked as Premium", () => {
  assert.match(settingsPanel, /aria-label=\{i18nT\("prise_de_rdv_reservee_au_forfait_c652d03f"\)\}/);
  assert.match(settingsPanel, /<span style=\{premiumPillStyle\}>\{i18nT\("premium_6c2f2888"\)\}<\/span>/);
  assert.match(settingsPanel, /i18nT\("disponible_avec_inr_calendar_dans_le_a627ba6d"\)/);
});

test("channel row balancing cannot truncate a ninth or tenth channel", () => {
  assert.match(publicBadge, /Math\.ceil\(actions\.length \/ 4\)/);
  assert.match(publicBadge, /actions\.slice\(cursor, cursor \+ size\)/);
  assert.doesNotMatch(publicBadge, /:\s*\[4, 4\];/);
});
