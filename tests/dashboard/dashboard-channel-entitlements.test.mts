import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { getChannelTone } from "../../app/dashboard/_components/dashboard-channel-presentation.ts";
import {
  DASHBOARD_CHANNEL_POWER_SETUP,
  DASHBOARD_CHANNEL_SETUP,
} from "../../app/dashboard/dashboard.channel-setup.ts";

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

test("les onze canaux Standard précèdent Mails et Site iNrCy", () => {
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
    "x",
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
    /const summaryItems = standardMode \? fluxBubbleItems\.filter\(\(item\) => item\.key !== "mails" && item\.key !== "site_inrcy"\) : fluxBubbleItems;/,
  );
  assert.match(
    channelsSectionSource,
    /const connected = summaryItems\.filter\(\(item\) => getChannelTone\(item\) === "connected"\)\.length;/,
  );
  assert.match(channelsSectionSource, /\{connected\}<small>\/\{summaryItems\.length\}<\/small>/);
  assert.match(channelsSectionSource, /items=\{fluxBubbleItems\} summary=\{\{ connected, total: summaryItems\.length \}\}/);

  // Exercise the exact pure counter expressions without importing the client-side TSX tree.
  const counters = channelsSectionSource.match(/const summaryItems = [^\r\n]+[\r\n]+\s*const connected = [^\r\n]+/)?.[0];
  assert.ok(counters, "les deux compteurs dérivent ensemble des canaux réels");
  const fluxBubbleItems = DASHBOARD_CHANNEL_SETUP.map(({ key }) => ({
    key,
    bubbleStatus: key === "x" ? "reconnect" : key === "youtube_shorts" ? "available" : "connected",
    bubbleStatusText: key === "pinterest" ? "Connexion à réactualiser" : "Connecté",
  }));
  const evaluate = (standardMode: boolean) => runInNewContext(
    `${counters}\n({ connected, total: summaryItems.length });`,
    { standardMode, fluxBubbleItems, getChannelTone },
    { timeout: 100 },
  ) as { connected: number; total: number };
  const standard = evaluate(true);
  const premium = evaluate(false);
  assert.equal(standard.total, 11, "Mails et Site iNrCy ne gonflent pas le dénominateur Standard");
  assert.equal(standard.connected, 8, "les connexions à actualiser et à reconnecter sont exclues");
  assert.equal(premium.total, 13, "les deux canaux commerciaux restent comptés en Premium");
  assert.equal(premium.connected, 10, "les deux connexions commerciales ne sont pas comptées en Standard");
});

test("la puissance attribue un pourcentage propre à chacun des onze canaux actifs", () => {
  assert.equal(DASHBOARD_CHANNEL_SETUP.length, 13);

  const channelKeys = DASHBOARD_CHANNEL_SETUP.map((channel) => channel.key);
  assert.equal(new Set(channelKeys).size, 13, "chaque canal doit apparaître une seule fois");

  const weightedChannels = DASHBOARD_CHANNEL_SETUP.filter((channel) => channel.weight > 0);
  assert.equal(weightedChannels.length, 11);
  assert.equal(
    weightedChannels.reduce((sum, channel) => sum + channel.weight, 0),
    100,
  );
  assert.deepEqual(DASHBOARD_CHANNEL_POWER_SETUP, weightedChannels);
  assert.equal(DASHBOARD_CHANNEL_SETUP.find((channel) => channel.key === "mails")?.weight, 7);
  assert.equal(DASHBOARD_CHANNEL_SETUP.find((channel) => channel.key === "inrbadge")?.weight, 0);
  assert.equal(DASHBOARD_CHANNEL_SETUP.find((channel) => channel.key === "site_inrcy")?.weight, 0);

  assert.match(
    dashboardClientSource,
    /const generatorPowerSteps = DASHBOARD_CHANNEL_POWER_SETUP\.map\(\(channel\) => \(\{[\s\S]*completed: channelPowerConnected\[channel\.key\],/,
  );
});

test("le nouveau cockpit ouvre une infobulle par étape et détaille les onze canaux", () => {
  assert.match(heroSource, /useState<"channels" \| "dna" \| "ai" \| null>\(null\)/);
  assert.match(heroSource, /openInfo === step\.key \? styles\.cockpitStageInfoOpen/);
  assert.match(heroSource, /className=\{styles\.cockpitInfoPopover\} role="dialog"/);
  assert.match(
    heroSource,
    /step\.key === "channels"[\s\S]*className=\{styles\.cockpitPowerGrid\}[\s\S]*channelPowerSteps\.map/,
  );
  assert.match(
    heroSource,
    /const globalPower = Math\.round\([\s\S]*\[generatorPower, dnaPower, aiPower\][\s\S]*\/ 3/,
  );
  assert.match(dashboardCssSource, /\.cockpitStageInfoOpen\s*\{[\s\S]*z-index: 30;/);
  assert.match(dashboardCssSource, /\.cockpitInfoPopover\s*\{[\s\S]*z-index: 40;/);
});

test("Supabase possède déjà les deux axes indépendants nécessaires", () => {
  assert.match(bubbleAccessSource, /site_inrcy: false/);
  assert.match(adminToolsApiSource, /\.from\("app_bubble_access"\)/);
  assert.match(adminToolsApiSource, /bubble_key: bubbleKey,[\s\S]*enabled,/);
  assert.match(dashboardClientSource, /const canAccessSiteInrcy = isBubbleEnabled\(bubbleAccessMap, "site_inrcy"\);/);
  assert.match(dashboardClientSource, /const isStandardEdition = dashboardEdition === "standard";/);
});
