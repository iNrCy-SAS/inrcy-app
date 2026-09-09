import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("desktop dashboard channels wrap with safe side spacing when needed", () => {
  const section = read("app/dashboard/_components/DashboardChannelsSection.tsx");
  const css = read("app/dashboard/dashboard.module.css");
  const row = css.match(/^\.channelPillRow\s*\{[\s\S]*?\}/m)?.[0] ?? "";
  const rail = css.match(/^\.channelPillRail\s*\{[\s\S]*?\}/m)?.[0] ?? "";
  const hover = css.match(/^\.channelPill:hover\s*\{[\s\S]*?\}/m)?.[0] ?? "";

  assert.match(section, /const channelPillRows = useMemo\(\(\) => \[baseModules\]/);
  assert.match(row, /flex-wrap:\s*wrap/);
  assert.match(row, /overflow:\s*visible/);
  assert.match(rail, /padding:\s*2px clamp\(14px, 2vw, 28px\)/);
  assert.match(hover, /transform:\s*none/, "hovering a channel must not clip its top border");
});

test("mobile dashboard carousel keeps both arrows inside narrow viewports", () => {
  const section = read("app/dashboard/_components/DashboardChannelsSection.tsx");
  const css = read("app/dashboard/dashboard.module.css");

  assert.match(section, /--dashboard-channel-count["']?:\s*Math\.max\(baseModules\.length, 1\)/);
  assert.match(css, /grid-template-columns:\s*var\(--dash-channel-arrow-size\) minmax\(0, 1fr\) var\(--dash-channel-arrow-size\)/);
  assert.match(css, /padding-inline:\s*max\(8px, env\(safe-area-inset-left\)\) max\(8px, env\(safe-area-inset-right\)\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(var\(--dashboard-channel-count, 13\), minmax\(0, 1fr\)\)/);
  assert.match(css, /width:\s*min\(100%, var\(--dash-channel-icon-size\)\)/);
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
