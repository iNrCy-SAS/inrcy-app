import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

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
  assert.match(css, /overflow-x: hidden !important;[\s\S]*?overflow-y: visible !important/);
});
