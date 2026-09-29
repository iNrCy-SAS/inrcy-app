import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../app/dashboard/mails/_components/AdsCampaignDetailsModal.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../app/dashboard/mails/_components/AdsCampaignsFolder.module.css", import.meta.url),
  "utf8",
);

test("les détails Ads reprennent la fenêtre iNrSend en plein écran", () => {
  assert.match(component, /mailboxStyles\.detailsModalCard/);
  assert.match(component, /styles\.fullScreenOverlay/);
  assert.match(component, /styles\.fullScreenModal/);
  assert.match(styles, /\.fullScreenModal\{[^}]*width:100vw!important;[^}]*height:100dvh!important;/);
});

test("les informations et statistiques sont séparées dans deux onglets accessibles", () => {
  assert.match(component, /role="tablist"/);
  assert.match(component, />Infos campagne<\/button>/);
  assert.match(component, />Stats<\/button>/);
  assert.match(component, /role="tabpanel"/);
  assert.match(component, /activeTab === "info"/);
});

test("la grille Infos utilise quatre colonnes desktop puis deux et une", () => {
  assert.match(styles, /\.detailGrid\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:950px\)\{\.detailGrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:640px\)[\s\S]*?\.detailGrid\{grid-template-columns:1fr\}/);
  assert.match(styles, /\.section h3\{[^}]*color:#fff/);
});
