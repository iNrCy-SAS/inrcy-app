import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const cssDeclarations = (
  source: string,
  selector: string,
  property: string,
) => {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const declarationPattern = new RegExp(
    `${escapeRegExp(property)}\\s*:\\s*([^;]+);`,
    "g",
  );
  const values: string[] = [];
  const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");

  for (const rule of sourceWithoutComments.matchAll(rulePattern)) {
    const selectors = rule[1].split(",").map((value) => value.trim());
    if (!selectors.includes(selector)) continue;

    for (const declaration of rule[2].matchAll(declarationPattern)) {
      values.push(declaration[1].trim());
    }
  }

  assert.ok(
    values.length > 0,
    `Expected ${selector} to declare ${property}`,
  );
  return values;
};

const lastCssDeclaration = (
  source: string,
  selector: string,
  property: string,
) => cssDeclarations(source, selector, property).at(-1)!;

test("Booster explains the 300 Mo source ceiling and the automatic optimization thresholds", () => {
  const shared = read("app/dashboard/booster/publier/publishModal.shared.tsx");
  const intent = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
  );
  const media = read(
    "app/dashboard/booster/publier/components/PublishImagesPanel.tsx",
  );

  assert.match(
    shared,
    /Jusqu’à \$\{BOOSTER_MAX_IMAGE_COUNT\} images ou 1 vidéo \(\$\{MEDIA_LIBRARY_VIDEO_SOURCE_MAX_MB_LABEL\} max\) · médias optimisés si nécessaire : format adapté et\/ou poids ramené à \$\{BOOSTER_MAX_IMAGE_MB_LABEL\}\/image ou \$\{BOOSTER_MAX_VIDEO_MB_LABEL\}\/vidéo\./,
  );
  assert.match(shared, /BOOSTER_PUBLICATION_MEDIA_OPTIMIZATION_LABEL/);
  assert.match(intent, /getLocalizedBoosterMediaOptimization\("generation", runtimeT\)/);
  assert.match(media, /getLocalizedBoosterMediaOptimization\("publication", runtimeT\)/);
});

test("the publication balance highlights successes and keeps independent processing and failure quotas", () => {
  const modal = read(
    "app/dashboard/_components/PublishExecutionResultModal.tsx",
  );

  assert.match(modal, /width: "min\(660px, 100%\)"/);
  assert.match(modal, /const hasPublishedChannels = publishedCount > 0/);
  assert.match(modal, /Publication avec résultats mixtes/);
  assert.match(modal, /publishedCount[\s\S]*?publié/);
  assert.match(modal, /pendingCount[\s\S]*?en traitement/);
  assert.match(modal, /failedOrSkippedCount[\s\S]*?échec/);
  assert.match(modal, /gridTemplateColumns: "minmax\(0, 1fr\)"/);
  assert.match(modal, /CHANNEL_LOGO_BY_KEY/);
  assert.match(modal, /const channelLogoSize = entry\.channel === "site_web" \? 25 : 27/);
  assert.match(modal, /borderRadius: 999,[\s\S]*?objectFit: "cover"/);
  assert.match(modal, /loading="eager"[\s\S]*?decoding="sync"[\s\S]*?fetchPriority="high"/);
  assert.match(modal, /Afficher le détail de l’échec/);
  assert.match(modal, /expandedEntryDetails/);
  assert.match(modal, /const orderedEntries = \[\.\.\.entries\]\.sort/);
  assert.match(modal, /i18nT\("voir_8a754f1f"\)/);
  assert.match(modal, /i18nT\("voir_dans_inr_send_a74cc9ea"\)/);
  assert.match(modal, /i18nT\("retenter_value_value_en_echec_b7d1f934"/);
});

test("Pinterest derives its account URL for settings, the immediate balance and iNrSend", () => {
  const oauth = read("lib/pinterestOAuth.ts");
  const settings = read(
    "app/dashboard/settings/_components/PinterestSettingsContent.tsx",
  );
  const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const inrSend = read(
    "app/dashboard/mails/_components/MailboxDetailsModal.tsx",
  );

  assert.match(
    oauth,
    /https:\/\/www\.pinterest\.fr\/\$\{encodeURIComponent\(clean\)\}\//,
  );
  assert.match(settings, /status\?live=1/);
  assert.match(
    settings,
    /setProfileLinkDraft\(settings\.publicProfileUrl \|\| settings\.profileUrl \|\| ""\)/,
  );
  assert.match(publishModal, /status\?live=1/g);
  assert.match(publishModal, /recoveredPinterestHref/);
  assert.match(publishModal, /channelLinks = Object\.fromEntries/);
  assert.match(inrSend, /status\?live=1/);
  assert.match(inrSend, /activeChannelAccountHref/);
  assert.match(inrSend, /t\("ouvrir_le_compte_72c79948"\)/);
});

test("TikTok uses the OAuth username and never turns a short-link token into the account name", () => {
  const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const connectedChannels = read(
    "app/api/booster/connected-channels/route.ts",
  );
  const foundations = read(
    "app/dashboard/booster/publier/publishModal.foundations.ts",
  );

  assert.match(publishModal, /fetch\("\/api\/integrations\/tiktok\/status"/);
  assert.match(publishModal, /label: username \? `@\$\{username\}` : "Compte TikTok connecté"/);
  for (const source of [connectedChannels, foundations]) {
    assert.match(source, /\(\^\|\\\.\)tiktok\\\.com\$\/i/);
    assert.match(source, /!\/\^\\\/@\/i\.test\(url\.pathname\)/);
  }
});

test("iNrStats channel panels use the global column width while zoom reflow stays active", () => {
  const client = read("app/dashboard/stats/StatsClient.tsx");
  const css = read("app/dashboard/stats/stats.module.css");

  assert.match(client, /styles\.statsWorkspaceChannel/);
  assert.match(client, /data-stats-view=\{activeStatsPanel === "all" \? "global" : "channel"\}/);
  assert.match(
    css,
    /\.statsWorkspaceChannel \.channelStatsHeader[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important/,
  );
  assert.match(
    css,
    /\.statsWorkspaceChannel \.channelStatsHeader \.allStatsKpis[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important/,
  );
  assert.match(
    css,
    /\.statsWorkspaceChannel \.channelStatsPanel \.detailTopRow,[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important/,
  );
  assert.match(css, /@container channelStats \(max-width: 800px\)/);
  assert.match(
    css,
    /@container channelStats \(max-width: 800px\)[\s\S]*?\.channelStatsPanel \.actionBtn\.lectureBusinessGoButton[\s\S]*?justify-self: center !important;[\s\S]*?margin-inline: auto !important;/,
  );
  assert.match(css, /overflow-x: hidden !important;[\s\S]*?overflow-y: visible !important/);
});

test("iNrStats uses a full-width master/detail table on desktop", () => {
  const client = read("app/dashboard/stats/StatsClient.tsx");
  const css = read("app/dashboard/stats/stats.module.css");

  assert.doesNotMatch(client, /<aside className=\{styles\.statsRail\}/);
  assert.match(client, /className=\{styles\.allStatsDetailsButton\}[\s\S]*?selectStatsPanel\(model\.key\)/);
  assert.match(client, /className=\{styles\.channelStatsBackButton\}[\s\S]*?selectStatsPanel\("all"\)/);
  assert.match(css, /\.statsRail \{[\s\S]*?display: none !important;/);
  assert.match(css, /max-width: 1480px !important;/);
  assert.match(
    css,
    /\.allStatsActionCard \{[\s\S]*?grid-template-columns:[\s\S]*?minmax\(116px, 0\.58fr\)[\s\S]*?minmax\(58px, 0\.3fr\) !important;/,
  );
});

test("iNrStats keeps its taller global summary and all channel rows compact without desktop overflow", () => {
  const client = read("app/dashboard/stats/StatsClient.tsx");
  const css = read("app/dashboard/stats/stats.module.css");
  const globalWorkspace = '.statsWorkspace[data-stats-view="global"]';
  const globalHero = `${globalWorkspace} .allStatsHero`;
  const globalActions = `${globalWorkspace} .allStatsActions`;
  const globalRow = `${globalWorkspace} .allStatsActionCard`;

  assert.match(client, /className=\{styles\.allStatsTitle\}>\{i18nT\("vue_globale_08073c33"\)\}/);
  assert.match(client, /<div className=\{styles\.allStatsKpis\}>[\s\S]*?<button[\s\S]*?className=\{styles\.allStatsReportButton\}/);

  const heroHeight = Number.parseFloat(
    lastCssDeclaration(css, globalHero, "min-height"),
  );
  assert.ok(
    heroHeight >= 56,
    `Expected the final desktop hero to be at least 56px high, got ${heroHeight}px`,
  );

  const rowGrid = lastCssDeclaration(
    css,
    globalRow,
    "grid-template-columns",
  );
  const fixedFirstTrack = rowGrid.match(/^(\d+(?:\.\d+)?)px\b/);
  const flexibleFirstTrack = rowGrid.match(
    /^minmax\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)fr\)/,
  );
  assert.ok(
    fixedFirstTrack || flexibleFirstTrack,
    "Expected the desktop channel row to start with a fixed or minmax() pixel track",
  );
  const firstTrackPixels = Number(
    fixedFirstTrack?.[1] ?? flexibleFirstTrack?.[1],
  );
  const firstTrackFraction = Number(flexibleFirstTrack?.[2] ?? 0);
  assert.ok(
    firstTrackPixels <= 160 && firstTrackFraction <= 0.9,
    `Expected a tightened first track (at most 160px / 0.9fr), got ${fixedFirstTrack?.[0] ?? flexibleFirstTrack?.[0]}`,
  );
  assert.equal(
    rowGrid.replace(/\s*!important$/, "").match(/minmax\([^)]*\)|auto|\d+(?:\.\d+)?px/g)?.length,
    5,
    "Expected the compact desktop channel row to retain its five columns",
  );

  assert.match(lastCssDeclaration(css, ".page", "overflow"), /^hidden\b/);
  assert.match(lastCssDeclaration(css, globalWorkspace, "overflow-x"), /^hidden\b/);
  assert.match(lastCssDeclaration(css, globalWorkspace, "overflow-y"), /^hidden\b/);
  assert.match(lastCssDeclaration(css, globalActions, "overflow-x"), /^hidden\b/);
  assert.match(lastCssDeclaration(css, globalActions, "overflow-y"), /^hidden\b/);
  assert.ok(
    cssDeclarations(css, globalActions, "grid-auto-rows").some((value) =>
      /^minmax\(44px,\s*1fr\)/.test(value),
    ),
    "Expected the normal desktop rows to retain their compact 44px floor",
  );
});

test("iNrStats detail keeps the direct back action, prominent channel title and KPIs on one desktop header row", () => {
  const client = read("app/dashboard/stats/StatsClient.tsx");
  const css = read("app/dashboard/stats/stats.module.css");

  assert.match(
    client,
    /<div className=\{styles\.channelStatsHeader\}>\s*<button[\s\S]*?className=\{styles\.channelStatsBackButton\}[\s\S]*?onClick=\{\(\) => selectStatsPanel\("all"\)\}[\s\S]*?<\/button>\s*<div className=\{styles\.channelStatsTitleBlock\}>/,
  );
  assert.match(
    client,
    /<div className=\{styles\.channelStatsTitleBlock\}>[\s\S]*?<h2 className=\{styles\.allStatsTitle\}>\{activeModel\.title\}<\/h2>[\s\S]*?<\/div>\s*<div className=\{`\$\{styles\.allStatsKpis\} \$\{styles\.channelStatsKpis\}/,
  );
  const titleBlockStart = client.indexOf('<div className={styles.channelStatsTitleBlock}>');
  const titleBlockEnd = client.indexOf('</div>', titleBlockStart);
  const titleBlock = client.slice(titleBlockStart, titleBlockEnd);
  assert.doesNotMatch(titleBlock, /canal_actif_09801074|allStatsEyebrow/);
  assert.match(titleBlock, /activeModel\.title[\s\S]*?channelStatsTitleIconBubble/);

  const headerGrid = lastCssDeclaration(
    css,
    ".statsWorkspaceChannel .channelStatsHeader",
    "grid-template-columns",
  );
  assert.match(
    headerGrid,
    /^(?:auto|minmax\([^)]*\))\s+(?:auto|minmax\([^)]*\))\s+(?:auto|minmax\([^)]*\))\s*!important$/,
    "Expected the final desktop detail header to keep back, title and KPIs on three columns",
  );
  assert.match(
    lastCssDeclaration(
      css,
      ".statsWorkspaceChannel .channelStatsHeader > .channelStatsTitleBlock",
      "grid-column",
    ),
    /^2\b/,
  );
  assert.match(
    lastCssDeclaration(
      css,
      ".statsWorkspaceChannel .channelStatsHeader > .channelStatsTitleBlock",
      "text-align",
    ),
    /^center\b/,
  );
  assert.match(
    lastCssDeclaration(
      css,
      ".statsWorkspaceChannel .channelStatsHeader .channelStatsKpis",
      "grid-column",
    ),
    /^3\b/,
  );
});
