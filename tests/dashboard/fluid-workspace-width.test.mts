import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CHANNEL_BUBBLE_EDGE, getChannelSceneLayout } from "../../app/dashboard/_components/dashboard-channel-presentation.ts";

const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const fluidCssWorkspaces = [
  ["Dashboard", "app/dashboard/dashboard.module.css", ".contentFull"],
  ["iNr'Calendar", "app/dashboard/agenda/agenda.module.css", ".wrap"],
  ["iNr'Send", "app/dashboard/mails/mails.module.css", ".wrap"],
  ["iNr'CRM", "app/dashboard/crm/crm.module.css", ".shell"],
  ["iNr'Stats", "app/dashboard/stats/stats.module.css", ".page"],
  ["iNr'Agent", "app/dashboard/agent/agent.module.css", ".agentCanvas"],
  ["iNr'Booster", "app/dashboard/booster/booster.module.css", ".container"],
  ["iNr'Fidéliser", "app/dashboard/fideliser/fideliser.module.css", ".container"],
  ["Médiathèque", "app/dashboard/mediatheque/mediaLibrary.module.css", ".wrap"],
  ["Générateur de médias", "app/dashboard/_components/MediaGenerator.module.css", ".generator"],
  ["Documents", "app/dashboard/_documents/documents.module.css", ".container"],
  ["e-réputation", "app/dashboard/e-reputation/eReputation.module.css", ".wrap"],
  ["iNr'GPS", "app/dashboard/gps/gps.module.css", ".page"],
  ["Administration", "app/dashboard/admin/admin.module.css", ".wrap"],
  ["Commandes admin", "app/dashboard/admin/commandes/adminOrders.module.css", ".wrap"],
  ["Utilisateurs admin", "app/dashboard/admin/users/users.module.css", ".wrap"],
  ["Outils admin", "app/dashboard/admin/tools/tools.module.css", ".wrap"],
  ["Banque d'images admin", "app/dashboard/admin/image-bank/imageBank.module.css", ".wrap"],
  ["Diagnostics admin", "app/dashboard/admin/diagnostics/diagnostics.module.css", ".wrap"],
  ["Réglages admin", "app/dashboard/admin/settings/settings.module.css", ".wrap"],
  ["Attribution des rendez-vous", "app/equipe/agenda/teamAgenda.module.css", ".shell"],
] as const;

test("desktop workspaces use all of the available width", () => {
  for (const [name, path, selector] of fluidCssWorkspaces) {
    const css = read(path);
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blocks = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${escapedSelector}\\s*\\{[\\s\\S]*?\\}`, "gm"))].map(
      (match) => match[0],
    );
    const block = blocks.find(
      (candidate) =>
        /width:\s*100%/.test(candidate) &&
        /max-width:\s*none/.test(candidate) &&
        /margin:\s*0(?:;|\s|\})/.test(candidate),
    ) ?? "";

    assert.match(block, /width:\s*100%/, `${name} should fill the available width`);
    assert.match(block, /max-width:\s*none/, `${name} should not have a desktop width cap`);
    assert.match(block, /margin:\s*0(?:;|\s|\})/, `${name} should not be centered inside artificial side margins`);
  }
});

test("calendar appointments stack as equal-width vertical cards", () => {
  const css = read("app/dashboard/agenda/agenda.module.css");
  const ui = read("app/dashboard/agenda/agenda.ui.tsx");
  const chips = css.match(/^\.chips\s*\{[\s\S]*?\}/m)?.[0] ?? "";
  const chip = css.match(/^\.chip\s*\{[\s\S]*?\}/m)?.[0] ?? "";

  assert.match(chips, /display:\s*flex/);
  assert.match(chips, /flex-direction:\s*column/);
  assert.match(chips, /align-items:\s*stretch/);
  assert.match(chip, /width:\s*100%/);
  assert.match(chip, /height:\s*44px/);
  assert.match(chip, /flex-direction:\s*column/);
  assert.match(ui, /styles\.chipTime/);
  assert.match(ui, /styles\.chipTitle/);
});

test("desktop dashboard channels use a fluid modal with safe spacing and a wrapping responsive header", () => {
  const section = read("app/dashboard/_components/DashboardChannelsSection.tsx");
  const css = read("app/dashboard/_components/DashboardChannelsModal.module.css");
  const dialog = css.match(/^\.dialog\s*\{[\s\S]*?\}/m)?.[0] ?? "";
  const surface = css.match(/^\.surface\s*\{[\s\S]*?\}/m)?.[0] ?? "";
  const hover = css.match(/^\.satellite:hover\s*\{[\s\S]*?\}/m)?.[0] ?? "";

  assert.match(section, /<DashboardChannelsModal items=\{fluxBubbleItems\}/);
  assert.match(dialog, /width:\s*min\(96vw, 1920px\)/);
  assert.match(surface, /padding:\s*clamp\(18px, 1\.5vw, 26px\)/);
  assert.match(surface, /overflow-y:\s*auto/);
  assert.match(surface, /overflow-x:\s*hidden/);
  assert.match(css, /@media \(max-width: 1280px\)[\s\S]*?\.headerPanel\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\) auto/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.headerInfo\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.doesNotMatch(hover, /transform:/, "hover must not enlarge a channel beyond its reserved space");
  assert.match(hover, /animation-play-state:\s*paused/);

  for (const [width, height] of [[1000, 430], [1280, 470], [1600, 520], [1920, 800]]) {
    for (const slot of getChannelSceneLayout(width, height).slots) {
      assert.ok(slot.x - slot.size / 2 - 6 >= CHANNEL_BUBBLE_EDGE - 6 - .01);
      assert.ok(width - slot.x - slot.size / 2 - 6 >= CHANNEL_BUBBLE_EDGE - 6 - .01);
      assert.ok(slot.y - slot.size / 2 - 8 >= CHANNEL_BUBBLE_EDGE - 8 - .01);
      assert.ok(height - slot.y - slot.size / 2 - 8 >= CHANNEL_BUBBLE_EDGE - 8 - .01);
    }
  }
});

test("mobile channel selection keeps both arrows around the bubble inside narrow viewports", () => {
  const modal = read("app/dashboard/_components/DashboardChannelsModal.tsx");
  const css = read("app/dashboard/_components/DashboardChannelsModal.module.css");

  assert.match(modal, /aria-label="Canal précédent"[^\n]*selectAdjacentChannel\(-1\)/);
  assert.match(modal, /aria-label="Canal suivant"[^\n]*selectAdjacentChannel\(1\)/);
  assert.match(modal, /disabled=\{filteredItems\.length < 2\}/);
  assert.doesNotMatch(modal + css, /channelDetails|channelExplanation/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.selectedArea\s*\{[^}]*width:\s*min\(296px,calc\(100% - 92px\)\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.channelArrow\s*\{[^}]*width:\s*36px; height:\s*36px/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.arrowPrevious\s*\{ left: -12px/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.arrowNext\s*\{ right: -12px/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.dialog\s*\{[^}]*width:\s*calc\(100vw - 20px\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.satellites\s*\{[^}]*grid-template-columns:\s*repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.satellites\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.satellitePosition\s*\{[^}]*width:\s*min\(100%,125px\)/);
  const selectedPosition = modal.indexOf("ref={selectedAreaRef}");
  const arrowsPosition = modal.indexOf('styles.arrowPrevious');
  const satellitesPosition = modal.indexOf('className={styles.satellites}');
  assert.ok(selectedPosition >= 0 && selectedPosition < arrowsPosition && arrowsPosition < satellitesPosition);
  for (const viewport of [320, 360, 390, 420, 480, 600, 720]) {
    const available = viewport - 20 - 2 - 32;
    const bubble = viewport <= 420 ? Math.min(.75 * viewport, 296) : Math.min(296, available - 92);
    const outerArrows = viewport <= 420 ? 24 : 92;
    assert.ok(bubble + outerArrows <= available, `${viewport}px: arrows must fit the scene`);
  }
});

test("mobile dashboard channel logos fill their circular controls without spilling", () => {
  const modal = read("app/dashboard/_components/DashboardChannelsModal.tsx");
  const css = read("app/dashboard/_components/DashboardChannelsModal.module.css");
  const medallion = css.match(/^\.channelLogoMedallion\s*\{[\s\S]*?\}/m)?.[0] ?? "";
  const image = css.match(/^\.channelLogo\s*\{[\s\S]*?\}/m)?.[0] ?? "";

  assert.match(modal, /key=\{item\.key\} className=\{styles\.satellitePosition\}/);
  assert.match(modal, /className=\{styles\.channelLogoMedallion\}><Image src=\{item\.logoSrc\}/);
  assert.match(medallion, /overflow:\s*hidden/);
  assert.match(medallion, /border-radius:\s*50%/);
  assert.match(image, /width:\s*100%; height:\s*100%/);
  assert.match(image, /border-radius:\s*50%/);
  assert.match(image, /object-fit:\s*contain/);
  assert.match(css, /\.selectedBubble img\s*\{[^}]*border-radius:\s*50%/);
  assert.match(css, /\.channelName\s*\{[^}]*max-width:\s*100%;[^}]*text-wrap:\s*balance/);
});

test("shared workspace shells no longer impose a fixed desktop width", () => {
  const sharedHeader = read("app/dashboard/_components/DashboardWorkspaceHeader.tsx");
  const aiMemory = read("app/dashboard/settings/_components/AiMemoryContent.tsx");

  assert.match(sharedHeader, /dashboardWorkspaceContentStyle[\s\S]*?maxWidth:\s*"none"/);
  assert.match(sharedHeader, /const headerStyle[\s\S]*?width:\s*"100%"[\s\S]*?maxWidth:\s*"none"/);
  assert.match(aiMemory, /const pageStyle:[\s\S]*?width:\s*"100%"[\s\S]*?maxWidth:\s*"none"/);
});

test("team agenda keeps the page fixed and scrolls only its appointment list on desktop", () => {
  const css = read("app/equipe/agenda/teamAgenda.module.css");
  const ui = read("app/equipe/agenda/TeamAgendaClient.tsx");

  assert.match(css, /\.page\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /\.days\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow-y:\s*auto;/);
  assert.match(ui, /href="\/dashboard\/admin"[^>]*className=\{styles\.closeButton\}>Fermer<\/Link>/);
  assert.doesNotMatch(ui, /styles\.reassurance/);
});

test("admin cards reserve a visible desktop row for their action", () => {
  const css = read("app/dashboard/admin/admin.module.css");

  assert.match(css, /grid-template-rows:\s*auto auto minmax\(0, 1fr\) 32px/);
  assert.match(css, /\.cardFooter\s*\{[\s\S]*?min-height:\s*32px;[\s\S]*?overflow:\s*visible;/);
  assert.match(css, /\.cardLink\s*\{[\s\S]*?height:\s*30px;[\s\S]*?min-height:\s*30px\s*!important;/);
});
