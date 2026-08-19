import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const dashboardClientSource = read("../../app/dashboard/DashboardClient.tsx");
const fluxBubblesSource = read("../../app/dashboard/dashboard.flux-bubbles.ts");
const fluxConstantsSource = read("../../app/dashboard/dashboard.constants.ts");
const channelsSectionSource = read("../../app/dashboard/_components/DashboardChannelsSection.tsx");
const helpModalsSource = read("../../app/dashboard/_components/DashboardHelpModals.tsx");
const heroSource = read("../../app/dashboard/_components/DashboardHero.tsx");
const dashboardCssSource = read("../../app/dashboard/dashboard.module.css");
const bubbleAccessSource = read("../../lib/bubbleAccess.ts");
const adminToolsApiSource = read("../../app/api/admin/tools/route.ts");

test("les dix canaux Standard précèdent Mails et Site iNrCy", () => {
  const moduleBlock = fluxConstantsSource.slice(
    fluxConstantsSource.indexOf("export const fluxModules"),
    fluxConstantsSource.indexOf("export const DRAWER_TITLES"),
  );
  const moduleKeys = [...moduleBlock.matchAll(/^    key: "([^"]+)",$/gm)].map((match) => match[1]);

  assert.deepEqual(moduleKeys, [
    "inrbadge",
    "site_web",
    "gmb",
    "inr_search",
    "facebook",
    "instagram",
    "linkedin",
    "tiktok",
    "youtube_shorts",
    "pinterest",
    "mails",
    "site_inrcy",
  ]);
});

test("Mails est visible mais verrouillé uniquement en Standard", () => {
  assert.match(dashboardClientSource, /STANDARD_DASHBOARD_BUBBLE_KEYS[\s\S]*"mails"/);
  assert.match(dashboardClientSource, /standardMode: isStandardEdition/);
  assert.match(fluxBubblesSource, /const mailPremiumLocked = standardMode && m\.key === "mails";/);
  assert.match(fluxBubblesSource, /const accessEnabled = storedAccessEnabled && !mailPremiumLocked;/);
  assert.match(fluxBubblesSource, /mailPremiumLocked[\s\S]*copy\.status\.premiumPlan/);
  assert.match(fluxBubblesSource, /configureDisabled:[\s\S]*!accessEnabled/);
});

test("Site iNrCy reste indépendant du forfait et affiche Non souscrit sans droit", () => {
  assert.match(
    fluxBubblesSource,
    /const displayAccessEnabled = m\.key === "site_inrcy" && !siteInrcyAccessReady[\s\S]*\? siteInrcyDisplayAccess[\s\S]*: accessEnabled;/,
  );
  assert.match(fluxBubblesSource, /m\.key === "site_inrcy"[\s\S]*copy\.status\.notSubscribed/);
  assert.match(dashboardClientSource, /siteInrcySubscribed=\{siteInrcyDisplayAccess\}/);
  assert.match(helpModalsSource, /requiresSiteSubscription: true/);
  assert.match(helpModalsSource, /siteNotSubscribed[\s\S]*i18nT\("non_souscrit_fb632cc2"\)/);
});

test("le compteur Standard ignore les deux bulles commerciales", () => {
  assert.match(
    channelsSectionSource,
    /standardMode[\s\S]*item\.key !== "mails" && item\.key !== "site_inrcy"/,
  );
  assert.match(channelsSectionSource, /availableChannelsCount = summaryModules\.length/);
  assert.match(
    channelsSectionSource,
    /connectedChannelsCount[\s\S]*availableChannelsCount[\s\S]*t\.channels\.available/,
  );
});

test("la puissance exclut Mails et Site iNrCy tout en restant sur 100 points", () => {
  assert.match(dashboardClientSource, /const sitePowerLinkConnected = hasSiteWebUrl;/);
  assert.match(dashboardClientSource, /const sitePowerGa4Connected = hasSiteWebUrl && siteWebGa4Connected;/);
  assert.match(dashboardClientSource, /const sitePowerGscConnected = hasSiteWebUrl && siteWebGscConnected;/);

  const powerBlock = dashboardClientSource.slice(
    dashboardClientSource.indexOf("const generatorPowerSteps = ["),
    dashboardClientSource.indexOf("] as const;", dashboardClientSource.indexOf("const generatorPowerSteps = [")),
  );
  assert.doesNotMatch(powerBlock, /key: "mails"/);
  assert.doesNotMatch(powerBlock, /hasSiteInrcyUrl|siteInrcyGa4Connected|siteInrcyGscConnected/);
  assert.match(powerBlock, /key: "inr_search"[\s\S]*weight: 5/);

  const totalWeight = [...powerBlock.matchAll(/weight: (\d+)/g)]
    .reduce((sum, match) => sum + Number(match[1]), 0);
  assert.equal(totalWeight, 100);
});

test("le détail de puissance passe devant les pastilles quand il est ouvert", () => {
  assert.match(heroSource, /powerBreakdownOpen \? styles\.heroPowerOpen/);
  assert.match(dashboardCssSource, /\.heroPowerOpen\s*\{[\s\S]*position: relative;[\s\S]*z-index: 40;/);
});

test("Supabase possède déjà les deux axes indépendants nécessaires", () => {
  assert.match(bubbleAccessSource, /site_inrcy: false/);
  assert.match(adminToolsApiSource, /\.from\("app_bubble_access"\)/);
  assert.match(adminToolsApiSource, /bubble_key: bubbleKey,[\s\S]*enabled,/);
  assert.match(dashboardClientSource, /const canAccessSiteInrcy = isBubbleEnabled\(bubbleAccessMap, "site_inrcy"\);/);
  assert.match(dashboardClientSource, /const isStandardEdition = dashboardEdition === "standard";/);
});
