import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { collapseDashboardWebsiteChannels, getChannelTone } from "../../app/dashboard/_components/dashboard-channel-presentation.ts";
import type { DashboardFluxBubbleData } from "../../app/dashboard/_components/DashboardFluxBubble.tsx";
import {
  DASHBOARD_CHANNEL_POWER_SETUP,
  DASHBOARD_CHANNEL_SETUP,
  getDashboardChannelSetup,
  getDashboardChannelPowerSetup,
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

test("les onze canaux Standard précèdent Mails", () => {
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
    "threads",
    "linkedin",
    "tiktok",
    "youtube_shorts",
    "pinterest",
    "x",
    "mails",
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

test("le canal retiré n'ouvre plus de panneau ni d'aide ni de configuration", () => {
  assert.doesNotMatch(fluxConstantsSource, /site_inrcy|Site iNrCy/);
  assert.doesNotMatch(fluxBubblesSource, /site_inrcy|siteInrcy|SiteInrcy/);
  assert.doesNotMatch(dashboardClientSource, /site_inrcy|siteInrcy|SiteInrcy|inrcy_site_configs/);
  assert.doesNotMatch(helpModalsSource, /Site iNrCy|siteInrcy|SiteInrcy/);
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

  const buildItems = (standardMode: boolean, metaPilotEnabled = false): DashboardFluxBubbleData[] => getDashboardChannelSetup(metaPilotEnabled).map(({ key }) => ({
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
  assert.equal(collapseDashboardWebsiteChannels(buildItems(false, true)).length, 13, "le pilote ADMIN ajoute Threads");
  assert.equal(standard.filter((item) => getChannelTone(item) === "connected").length, 7);
  assert.equal(premium.filter((item) => getChannelTone(item) === "connected").length, 8);
  assert.equal(standard.find((item) => item.key === "site_web")?.bubbleStatus, "available", "le site unique conserve son état canonique");
  assert.equal(standard.find((item) => item.key === "mails")?.bubbleStatus, "coming", "Mails reste visible mais verrouillé");
});

test("la présence du site unique conserve ses actions et sa connexion sans dépendre de Google", () => {
  const onConfigure = () => {};
  const site: DashboardFluxBubbleData = {
    key: "site_web", name: "Site Web", description: "", accent: "cyan",
    logoSrc: "/test.svg", logoAlt: "Site Web", bubbleStatus: "available",
    bubbleStatusText: "À configurer", onConfigure,
  };
  const configured = collapseDashboardWebsiteChannels([site], {
    connectedSite: "site_web", connectedText: "Connecté",
  });
  assert.equal(configured.length, 1);
  assert.equal(configured[0].onConfigure, onConfigure);
  assert.equal(configured[0].bubbleStatus, "connected");
  assert.equal(collapseDashboardWebsiteChannels([site])[0].bubbleStatus, "available");
});

test("la puissance garde les poids fixes des douze connexions, même si Threads est masqué", () => {
  assert.equal(DASHBOARD_CHANNEL_SETUP.length, 13);
  assert.equal(getDashboardChannelSetup(false).length, 12);
  assert.equal(getDashboardChannelPowerSetup(true).length, 12);

  const channelKeys = DASHBOARD_CHANNEL_SETUP.map((channel) => channel.key);
  assert.equal(new Set(channelKeys).size, 13, "chaque canal doit apparaître une seule fois");

  const weightedChannels = getDashboardChannelSetup(false).filter((channel) => channel.weight > 0);
  assert.equal(weightedChannels.length, 11);
  assert.equal(
    weightedChannels.reduce((sum, channel) => sum + channel.weight, 0),
    96,
  );
  assert.deepEqual(DASHBOARD_CHANNEL_POWER_SETUP, weightedChannels);
  assert.equal(DASHBOARD_CHANNEL_SETUP.find((channel) => channel.key === "mails")?.weight, 7);
  assert.equal(DASHBOARD_CHANNEL_SETUP.find((channel) => channel.key === "inrbadge")?.weight, 0);
  assert.match(dashboardClientSource, /site_web: hasSiteWebUrl/);
  assert.match(dashboardClientSource, /mails: Boolean\(!isStandardEdition && mailAccountsConnectedCount > 0 && !mailAccountsRequireUpdate\)/);

  assert.match(
    dashboardClientSource,
    /const generatorPowerSteps = channelPowerSetup\.map\(\(channel\) => \(\{[\s\S]*completed: channelPowerConnected\[channel\.key\],/,
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

test("les droits Site Web et le forfait restent indépendants", () => {
  assert.doesNotMatch(bubbleAccessSource, /site_inrcy/);
  assert.match(bubbleAccessSource, /site_web: true/);
  assert.match(adminToolsApiSource, /\.from\("app_bubble_access"\)/);
  assert.match(adminToolsApiSource, /bubble_key: bubbleKey,[\s\S]*enabled,/);
  assert.match(dashboardClientSource, /const isStandardEdition = dashboardEdition === "standard";/);
});
