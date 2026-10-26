import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getChannelTone, getChannelSceneLayout } from "../../app/dashboard/_components/dashboard-channel-presentation.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const dashboard = read("app/dashboard/DashboardClient.tsx");
const channels = read("app/dashboard/_components/DashboardChannelsSection.tsx");
const modules = read("app/dashboard/_components/DashboardModulesCard.tsx");
const modal = read("app/dashboard/_components/DashboardChannelsModal.tsx");
const bubble = read("app/dashboard/_components/DashboardFluxBubble.tsx");
const hero = read("app/dashboard/_components/DashboardHero.tsx");
const generator = read("app/dashboard/_components/DashboardGeneratorHub.tsx");
const generatorOrb = read("app/dashboard/_components/DashboardGeneratorOrb.tsx");
const modalCss = read("app/dashboard/_components/DashboardChannelsModal.module.css");
const toolsCss = read("app/dashboard/_components/DashboardSignatureTools.module.css");
const hubCss = read("app/dashboard/_components/DashboardExperience.module.css");
const heroCss = read("app/dashboard/_components/DashboardHeroPremium.module.css");

function assertOrdered(source: string, ...markers: string[]) {
  let last = -1;
  for (const marker of markers) {
    const position = source.indexOf(marker, last + 1);
    assert.ok(position > last, `ordre ou présence incorrecte : ${marker}`);
    last = position;
  }
}

function channel(status: Parameters<typeof getChannelTone>[0]["bubbleStatus"], text = "Connecté"): Parameters<typeof getChannelTone>[0] {
  return { key: "test", name: "Test", description: "", accent: "blue", logoSrc: "/test.svg", logoAlt: "", bubbleStatus: status, bubbleStatusText: text, onConfigure: () => {} };
}

test("le dashboard conserve le cockpit et place le Générateur au centre sans second accès aux canaux", () => {
  assertOrdered(dashboard, "<DashboardChannelsSection", "cockpit={", "<DashboardHero", "generator={", "<DashboardGeneratorHub");
  assert.doesNotMatch(dashboard + channels, /dashboardQuickJump|scrollToDashboardAnchor/);
  assert.doesNotMatch(channels, /<DashboardFluxBubble\b|fluxCarousel|carouselTrack/);
  assert.match(generator, /data-testid="dashboard-generator-hub"/);
  assert.match(generator, /onClick=\{onOpenGeneratorSettings\}/);
  assert.match(generator, /aria-haspopup="dialog"/);
  assert.match(generator, /aria-label=\{`\$\{heroT\("settingsAria"\)\} · \$\{generatorIsActive \? t\.hero\.active : t\.hero\.waiting\}`\}/);
  assert.match(generator, /<DashboardGeneratorOrb isActive=\{generatorIsActive\}/);
  assert.match(generatorOrb, /data-active=\{isActive === null \? "unknown" : String\(isActive\)\} aria-hidden="true"/);
  assert.doesNotMatch(channels, /dashboard-channels-hub|styles\.hubRow/);
  assert.match(channels, /channelsOpen \? <DashboardChannelsModal/);
  assert.match(channels, /import DashboardChannelsModal from "\.\/DashboardChannelsModal"/);
  assert.match(dashboard, /import DashboardChannelWorkspace from "\.\/_components\/DashboardChannelWorkspace"/);
});

test("le socle réunit Stats puis Send, Studio et Réputation, et Premium regroupe quatre outils", () => {
  assertOrdered(modules, "{cockpit}", "signatureStyles.boosterCard", "{generator}", 'aria-labelledby="dashboard-pilot-title"', "pilotTools.map(renderSignatureTool)", 'aria-labelledby="dashboard-premium-title"', "premiumTools.map(renderSignatureTool)");
  assertOrdered(modules, "const pilotTools", 'tool.tone === "statsCard"', 'tool.tone === "sendCard"', 'tool.tone === "studioCard"', 'tool.tone === "reputationCard"');
  assert.match(modules, /const premiumTools = \["adsCard", "campaignCard", "calendarCard", "crmCard"\]/);
  assert.match(toolsCss, /grid-template-areas: "cockpit booster" "generator generator" "create pilot"/);
  assert.match(toolsCss, /\.signatureGrid\.premiumGrid\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(toolsCss, /\.statsCard\s*\{[^}]*grid-column: 1 \/ -1/);
});
test("les cartes Premium partagent le rendu, les agents et le verrouillage de section", () => {
  assert.match(modules, /const renderSignatureTool/);
  assert.match(modules, /tone: "campaignCard"[^\n]*premiumOnly: true[^\n]*onOpen: openCampaignModal/);
  assert.match(modules, /<fieldset disabled=\{standardMode\}[^>]*data-dashboard-premium-tools="true"/);
  assert.match(modules, /tool\.tone === "campaignCard" \? agentControls\("campaigns",/);
  assert.match(modules, /tool\.tone === "campaignCard" \? planningControl\("campaigns"\)/);
  assert.match(modules, /!standardMode && campaignModalOpen \?/);
});
test("les réglages, le planning et le bilan ont des commandes clairement visibles sur ordinateur et mobile", () => {
  assert.match(modules, /onClick=\{openBoosterSummary\}/);
  assert.match(modules, /aria-label=\{t\.modules\.boosterStatsTitle\}/);
  assert.match(modules, /planningControl\("publications"\)/);
  assert.match(toolsCss, /\.boosterSummaryButtons \.boosterStats, \.boosterSummaryButtons \.modulePlanning[^}]*width: 44px/);
  assert.match(toolsCss, /\.boosterCard[^}]*grid-template-areas: "brand summary \." "publish summary agent"/);
  assert.match(modules, /aria-label=\{tool\.settingsLabel\}/);
});
test("les cartes de pilotage conservent des textes et actions lisibles à chaque breakpoint", () => {
  const readableSizes = [
    [".signatureCopy h4", 15],
    [".signatureCopy p", 12],
    [".relationshipCopy h4", 16],
    [".relationshipCopy p", 12],
    [".toolButton", 11],
    [".relationshipCard .cardButton", 12],
  ] as const;

  for (const [selector, minimum] of readableSizes) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blocks = [...toolsCss.matchAll(new RegExp(`^\\s*${escaped}\\s*\\{([^}]+)\\}`, "gm"))];
    assert.ok(blocks.length, `${selector} must define its readable sizes`);
    for (const [, block] of blocks) {
      const size = block.match(/font-size:\s*(\d+)px/);
      if (size) assert.ok(Number(size[1]) >= minimum, `${selector}: ${size[1]}px is too small`);
      const height = block.match(/min-height:\s*(\d+)px/);
      if (selector.includes("Button") && height) {
        assert.ok(Number(height[1]) >= 34, `${selector}: actions must remain at least 34px high`);
      }
    }
  }

  // Actions now participate in the card layout instead of relying on a fixed
  // bottom reservation. Long translated copy can therefore grow without overlap.
  assert.match(toolsCss, /\.signatureCard\s*\{[^}]*display: grid/);
  assert.match(toolsCss, /\.signatureCard \.cardActions\s*\{[^}]*grid-column: 1 \/ -1;[^}]*align-self: end/);
  assert.match(toolsCss, /\.signatureCopy h4,[^}]*\.relationshipCopy h4\s*\{[^}]*overflow-wrap: anywhere/);
  assert.match(toolsCss, /@media \(max-width: 700px\)[\s\S]*?\.creationGrid \.signatureCard \.toolButton\s*\{[^}]*max-width: 100%/);
});

test("les outils conservent leurs destinations et les callbacks de publication, bilan et statistiques", () => {
  assert.match(modules, /if \(onOpenBoosterPublish\) onOpenBoosterPublish\(\);\s*else goToModule\("\/dashboard\?action=publish"\)/);
  assert.match(modules, /if \(onOpenBoosterStats\) onOpenBoosterStats\(\);\s*else goToModule\("\/dashboard\?stats=1"\)/);
  assert.match(modules, /startModuleNavigation\("\/dashboard\/stats", onOpenStats\)/);
  assert.match(modules, /onClick=\{openPublishModal\}/);
  assert.match(modules, /onClick=\{openBoosterSummary\}/);
  assert.match(modules, /const studioPath = "\/dashboard\/generer-media"/);
  assert.match(modules, /path: "\/dashboard\/e-reputation"/);
  for (const destination of ["propulser", "fideliser"]) {
    assert.ok(modules.includes(`startModuleNavigation("/dashboard/${destination}")`), destination);
  }
  assert.match(modules, /onOpen: openCampaignModal/);
  assert.match(modules, /setPlanningWorkspace\(workspace\)/);
  assert.match(modules, /onClick=\{\(\) => startPanelOpening\(standardMode \? "abonnement" : tool\.panel!\)\}/);
});

test("le rendu expose les canaux Ads validés sans contourner Standard ni les droits comptables", () => {
  assert.match(channels, /standardMode \? \(\s*<DashboardStandardModulesCard[\s\S]*?<DashboardModulesCard/);
  assert.match(modules, /adsPilotEnabled = false/);
  assert.match(modules, /path: "\/dashboard\/ads"[^\n]*premiumOnly: true[^\n]*unavailable: !adsPilotEnabled/);
  assert.match(modules, /disabled=\{Boolean\(standardMode && tool\.premiumOnly\) \|\| tool\.unavailable/);
  assert.match(modules, /const accountingEnabled = !standardMode && hasAccountingDashboardAccess\(dashboardEdition\)/);
  assert.match(modules, /accountingEnabled && cashModalOpen \?/);
});
test("les états de connexion distinguent un canal actif d'un avertissement ou d'un canal à venir", () => {
  assert.equal(getChannelTone(channel("connected")), "connected");
  assert.equal(getChannelTone(channel("available", "À connecter")), "available");
  assert.equal(getChannelTone(channel("reconnect", "Connexion requise")), "warning");
  assert.equal(getChannelTone(channel("coming", "À venir")), "disabled");
  assert.equal(getChannelTone(channel("coming", "Token expiré")), "disabled");
  for (const text of ["Connexion à réactualiser", "Token expiré", "Reconnect required", "Reconectar", "Da ricollegare", "Neu verbinden", "Opnieuw verbinden", "Religar", "Update required", "Aktualisieren", "Bijwerken", "Attention"]) {
    assert.equal(getChannelTone(channel("connected", text)), "warning", text);
  }
  assert.match(modal, /filter === "all" \|\| \(filter === "connected" \? tone === "connected" : tone === "available" \|\| tone === "warning"\)/);
  assert.match(modal, /summary\?\.connected \?\? items\.filter\(\(item\) => getChannelTone\(item\) === "connected"\)\.length/);
  assert.match(modal, /summary\?\.total \?\? items\.length/);
});

test("la grande fenêtre réutilise les actions et protections des bulles existantes", () => {
  assert.match(modal, /const selectedItem = selected \? \{\s*\.\.\.selected,/);
  assert.match(modal, /onConfigure: \(\) => \{ closeDialog\(\); selected\.onConfigure\(\); \}/);
  assert.match(modal, /onSpecialView: selected\.onSpecialView \? \(\) => \{ closeDialog\(\); selected\.onSpecialView\?\.\(\); \} : undefined/);
  assert.match(modal, /onCreate: selected\.onCreate \? \(\) => \{ closeDialog\(\); selected\.onCreate\?\.\(\); \} : undefined/);
  assert.match(modal, /viewAction: selected\.viewAction \? \{\s*\.\.\.selected\.viewAction,[\s\S]*?selected\.viewAction\?\.onClick\?\.\(\)/);
  assert.match(modal, /<DashboardFluxBubble key=\{selected\.key\} item=\{selectedItem!\} \/>/);
  assert.doesNotMatch(modal, /(?:configureDisabled|createDisabled|premiumLocked):\s*false/);
  assert.match(bubble, /item\.configureDisabled/);
  assert.match(bubble, /item\.premiumLocked/);
  assert.doesNotMatch(modal, /onClickCapture/);
  assert.match(modal, /renderSelected\(selectedItem!\)/);
  assert.match(modal, /aria-label="Aide sur les canaux" onClick=\{onOpenHelp\}/);
  assert.doesNotMatch(modal, /closeDialog\(\); onOpenHelp\(\)/);
});

test("la fenêtre native gère le clavier, le retour du focus et le verrouillage du défilement", () => {
  assert.match(modal, /<dialog[\s\S]*?aria-labelledby=\{titleId\}[\s\S]*?aria-describedby=\{descriptionId\}/);
  assert.match(modal, /dialog\?\.showModal\(\)/);
  assert.match(modal, /closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(modal, /const previousOverflow = document\.body\.style\.overflow/);
  assert.match(modal, /document\.body\.style\.overflow = "hidden"/);
  assert.match(modal, /return \(\) => \{\s*dialog\?\.close\(\);\s*document\.body\.style\.overflow = previousOverflow;\s*document\.documentElement\.style\.overflow = previousHtmlOverflow;\s*if \(opener\?\.isConnected\) opener\.focus\(\{ preventScroll: true \}\);/);
  assert.match(modal, /onCancel=\{\(event\) => \{ event\.preventDefault\(\); closeDialog\(\); \}\}/);
  assert.match(modal, /event\.target !== event\.currentTarget/);
  assert.match(modal, /event\.clientX < bounds\.left[\s\S]*?closeDialog\(\)/);
  assert.match(modal, /requestAnimationFrame\(\(\) => selectedAreaRef\.current\?\.focus\(\)\)/);
});

test("les bulles flottent sans hasard de rendu et proposent une pause ainsi que reduced-motion", () => {
  assert.match(modal, /getChannelSceneLayout\(width, height\)/);
  assert.match(modal, /new ResizeObserver/);
  assert.doesNotMatch(modal, /Math\.random|setInterval|setTimeout/);
  assert.match(modal, /aria-pressed=\{motionPaused\}[\s\S]*?setMotionPaused\(\(paused\) => !paused\)/);
  assert.match(modalCss, /animation: bubbleFloat var\(--bubble-duration\)/);
  assert.match(modalCss, /\.motionPaused[^}]*animation-play-state: paused !important/);
  assert.match(modalCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
  assert.match(hubCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
  assert.match(toolsCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  assert.match(heroCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test("les canaux occupent tout l’écran sans marges et se réorganisent sur mobile", () => {
  assert.match(modalCss, /width: 100vw/);
  assert.match(modalCss, /height: 100dvh/);
  assert.match(modalCss, /max-height: none/);
  assert.match(modalCss, /\.dialog::backdrop\s*\{[^}]*backdrop-filter: blur\(13px\)/);
  assert.match(modalCss, /@media \(max-width: 720px\)[\s\S]*?grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(modalCss, /\.surface\s*\{[^}]*overflow-y: auto/);
  assert.match(toolsCss, /@media \(max-width: 1100px\)[\s\S]*?\.lowerRow\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});

test("les bulles gardent un espace libre même à l'amplitude maximale de leur mouvement", () => {
  for (const [width, height] of [[1000, 430], [1100, 430], [1280, 470], [1550, 520], [1800, 780]]) {
    const layout = getChannelSceneLayout(width, height);
    assert.ok(layout.satelliteSize > 50);
    assert.equal(layout.slots.length, 12);
    const circles = [
      { x: width / 2, y: layout.centerY, radius: layout.centerSize / 2 },
      ...layout.slots.map((slot) => ({ ...slot, radius: slot.size / 2 })),
    ];
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const a = circles[i], b = circles[j];
        const freeSpace = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius - 16;
        assert.ok(freeSpace >= 19.9, `collision ${width}×${height}, bulles ${i}/${j} : ${freeSpace}px`);
      }
    }
  }
});

test("le header est fin avec les informations au centre, les logos sont ronds et le tourbillon reste visible", () => {
  assertOrdered(modal, "styles.headerPanel", "styles.headerInfo", "styles.connectionCount", "styles.filters", "styles.toolbarActions", "ref={sceneRef}");
  assert.doesNotMatch(modal, /<footer/);
  assert.doesNotMatch(modal, /styles\.selectedSummary|CONNECTER · RAYONNER · GRANDIR/);
  assert.match(modalCss, /\.headerPanel\s*\{[^}]*grid-template-columns: auto minmax\(0,1fr\) auto[^}]*min-height: 66px/);
  assert.match(modalCss, /\.channelLogoMedallion\s*\{[^}]*border-radius: 50%/);
  for (const part of ["generatorCoreCenter", "miniCoreRing", "miniCoreRotor", "miniCoreGlass", "miniCoreGlow"]) assert.ok(generatorOrb.includes(`styles.${part}`), part);
});

test("les flèches entourent la bulle centrale sans bloc dessous ni ouverture de fenêtre", () => {
  assertOrdered(modal, "styles.selectedArea", "<DashboardFluxBubble", "styles.arrowPrevious", 'aria-label="Canal précédent"', "styles.arrowNext", 'aria-label="Canal suivant"', "styles.satellites");
  assert.match(modal, /"--center-y": `\$\{sceneLayout\.centerY\}px`/);
  assert.doesNotMatch(modal, /channel-details|styles\.channelDetails|styles\.channelExplanation|--info-top/);
  assert.match(modalCss, /\.channelArrow\s*\{[^}]*top: calc\(var\(--center-size,340px\) \/ 2\);[^}]*width: 44px; height: 44px/);
  assert.match(modalCss, /\.arrowPrevious\s*\{ left: -64px; \}/);
  assert.match(modalCss, /\.arrowNext\s*\{ right: -64px; \}/);
  assert.match(modal, /"--bubble-size": `\$\{size\}px`/);
  assert.match(modal, /aria-live="polite" aria-atomic="true"/);
  assert.equal([...modal.matchAll(/disabled=\{filteredItems\.length < 2\}/g)].length, 2);
  const selectBody = modal.slice(modal.indexOf("const selectAdjacentChannel"), modal.indexOf("// Only wrap"));
  assert.match(selectBody, /setSelectedKey\(filteredItems\[\(index \+ direction \+ filteredItems\.length\) % filteredItems\.length\]\.key\)/);
  assert.doesNotMatch(selectBody, /onConfigure|onCreate|onSpecialView|closeDialog|router\./);
  // Exercise the exact wraparound expression used by both arrows.
  const nextIndex = (index: number, direction: -1 | 1, count: number) => (index + direction + count) % count;
  assert.equal(nextIndex(0, -1, 13), 12);
  assert.equal(nextIndex(12, 1, 13), 0);
  assert.equal(nextIndex(1, -1, 3), 0);
  assert.equal(nextIndex(1, 1, 3), 2);
});

test("les informations du header sont lisibles et Fermer ne contient plus de croix", () => {
  assert.match(modalCss, /\.connectionCount\s*\{[^}]*font-size: 14px/);
  assert.match(modalCss, /\.filter\s*\{[^}]*min-height: 40px;[^}]*font-size: 14px/);
  assert.match(modalCss, /\.close\s*\{[^}]*font-size: 14px/);
  assert.match(modal, /ref=\{closeButtonRef\}[^\n]*aria-label="Fermer les canaux">Fermer<\/button>/);
  assert.doesNotMatch(modalCss, /\.close\s*\{[^}]*font-size: 0/);
});

test("le cockpit garde ses trois actions et son solde UI, les métriques réelles restent dans Stats", () => {
  assert.match(hero, /import styles from "\.\/DashboardHeroPremium\.module\.css"/);
  for (const action of ["onOpenChannels", "onOpenDna", "onOpenAi"]) assert.ok(hero.includes(`action: ${action}`), action);
  assert.match(hero, /uiBalance\.toLocaleString\(locale\)/);
  for (const metric of ["leadsWeek", "leadsMonth", "oppTotal", "estimatedValue"]) assert.ok(modules.includes(`overview.${metric}`), metric);
  assert.match(generator, /onClick=\{onRefreshGenerator\}[\s\S]*?disabled=\{kpisLoading\}/);
  assert.match(generator, /onClick=\{onOpenGeneratorSettings\}/);
  assert.match(generator, /onClick=\{onOpenGeneratorHelp\}/);
  assert.match(modules, /startModuleNavigation\("\/dashboard\/stats", onOpenStats\)/);
  assert.match(hero, /role="progressbar"[\s\S]*?aria-valuenow=\{step\.value\}/);
  assert.match(heroCss, /\.hero\s*\{[^}]*grid-area: cockpit;[^}]*min-width: 0/);
  assert.match(toolsCss, /@media \(max-width: 1100px\)[\s\S]*?\.lowerRow\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});
