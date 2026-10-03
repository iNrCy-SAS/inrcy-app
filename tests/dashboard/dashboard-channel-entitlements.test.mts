import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { collapseDashboardWebsiteChannels, getChannelTone } from "../../app/dashboard/_components/dashboard-channel-presentation.ts";
import type { DashboardFluxBubbleData } from "../../app/dashboard/_components/DashboardFluxBubble.tsx";
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
const heroCssSource = read("../../app/dashboard/_components/DashboardHeroPremium.module.css");
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

test("les deux offres montrent douze canaux, Mails restant verrouillé en Standard", () => {
  assert.match(
    channelsSectionSource,
    /const total = fluxBubbleItems\.length;/,
  );
  assert.match(
    channelsSectionSource,
    /const connected = fluxBubbleItems\.filter\(\(item\) => getChannelTone\(item\) === "connected"\)\.length;/,
  );
  assert.match(channelsSectionSource, /\{connected\}<small>\/\{total\}<\/small>/);
  assert.match(channelsSectionSource, /items=\{fluxBubbleItems\} summary=\{\{ connected, total \}\}/);
  assert.match(dashboardClientSource, /const dashboardChannelItems = useMemo\(\(\) => \{[\s\S]*collapseDashboardWebsiteChannels\(fluxBubbleItems, \{/);
  assert.match(dashboardClientSource, /<ChannelConnectionsModal[\s\S]*items=\{dashboardChannelItems\}/);
  assert.match(dashboardClientSource, /<DashboardChannelsSection[\s\S]*fluxBubbleItems=\{dashboardChannelItems\}/);

  const buildItems = (standardMode: boolean): DashboardFluxBubbleData[] => DASHBOARD_CHANNEL_SETUP.map(({ key }) => ({
    key,
    name: key,
    description: "",
    accent: "cyan",
    logoSrc: "/test.svg",
    logoAlt: key,
    bubbleStatus: key === "x" ? "reconnect" : key === "youtube_shorts" || key === "site_web" ? "available" : standardMode && key === "mails" ? "coming" : "connected",
    bubbleStatusText: key === "pinterest" ? "Connexion à réactualiser" : "Connecté",
    onConfigure: () => {},
  }));
  const standard = collapseDashboardWebsiteChannels(buildItems(true));
  const premium = collapseDashboardWebsiteChannels(buildItems(false));
  assert.equal(standard.length, 12);
  assert.equal(premium.length, 12);
  assert.equal(standard.filter((item) => getChannelTone(item) === "connected").length, 8);
  assert.equal(premium.filter((item) => getChannelTone(item) === "connected").length, 9);
  assert.equal(standard.find((item) => item.key === "site_web")?.bubbleStatus, "connected", "le site iNrCy connecté valide l'unique canal web");
  assert.equal(standard.find((item) => item.key === "mails")?.bubbleStatus, "coming", "Mails reste visible mais verrouillé");
});

test("la bulle web unique conserve les actions du site connecté", () => {
  const openExternal = () => {};
  const openInrcy = () => {};
  const makeSite = (key: "site_web" | "site_inrcy", connected: boolean, onConfigure: () => void): DashboardFluxBubbleData => ({
    key,
    name: key === "site_web" ? "Site web" : "Site iNrCy",
    description: "",
    accent: "cyan",
    logoSrc: "/test.svg",
    logoAlt: "",
    bubbleStatus: connected ? "connected" : "available",
    bubbleStatusText: connected ? "Connecté" : "À configurer",
    onConfigure,
  });
  const inrcyOnly = collapseDashboardWebsiteChannels([
    makeSite("site_web", false, openExternal),
    makeSite("site_inrcy", true, openInrcy),
  ]);
  assert.equal(inrcyOnly.length, 1);
  assert.equal(inrcyOnly[0].name, "Site web");
  assert.equal(inrcyOnly[0].bubbleStatus, "connected");
  assert.equal(inrcyOnly[0].onConfigure, openInrcy);

  const both = collapseDashboardWebsiteChannels([
    makeSite("site_web", true, openExternal),
    makeSite("site_inrcy", true, openInrcy),
  ]);
  assert.equal(both.length, 1);
  assert.equal(both[0].onConfigure, openExternal, "le site externe reste prioritaire quand les deux sont connectés");

  const urlOnly = collapseDashboardWebsiteChannels([
    makeSite("site_web", false, openExternal),
    makeSite("site_inrcy", false, openInrcy),
  ], { connectedSite: "site_inrcy", connectedText: "Connecté" });
  assert.equal(urlOnly[0].bubbleStatus, "connected", "une URL enregistrée valide le canal sans exiger GA4/GSC");
  assert.equal(urlOnly[0].bubbleStatusText, "Connecté");
  assert.equal(urlOnly[0].onConfigure, openInrcy);
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
  assert.match(dashboardClientSource, /site_web: hasSiteWebUrl \|\| \(canAccessSiteInrcy && hasSiteInrcyUrl\)/);
  assert.match(dashboardClientSource, /mails: Boolean\(!isStandardEdition && mailAccountsConnectedCount > 0 && !mailAccountsRequireUpdate\)/);

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
  assert.match(heroCssSource, /\.heroInfoOpen\s*\{ position: relative; z-index: 5; \}/);
  assert.match(heroCssSource, /\.cockpitInfoPopover\s*\{[^}]*background: #0d1c3c/);
});

test("Supabase possède déjà les deux axes indépendants nécessaires", () => {
  assert.match(bubbleAccessSource, /site_inrcy: false/);
  assert.match(adminToolsApiSource, /\.from\("app_bubble_access"\)/);
  assert.match(adminToolsApiSource, /bubble_key: bubbleKey,[\s\S]*enabled,/);
  assert.match(dashboardClientSource, /const canAccessSiteInrcy = isBubbleEnabled\(bubbleAccessMap, "site_inrcy"\);/);
  assert.match(dashboardClientSource, /const isStandardEdition = dashboardEdition === "standard";/);
});
