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

test("le statut précède les actions dans la ligne du titre sur desktop", () => {
  const headingIndex = component.indexOf("className={styles.detailHeading}");
  const titleIndex = component.indexOf("className={styles.detailTitle}", headingIndex);
  const statusIndex = component.indexOf("className={styles.status}", headingIndex);
  const actionsIndex = component.indexOf("styles.headerActions", headingIndex);
  const tabsIndex = component.indexOf("className={styles.detailTabs}", headingIndex);

  assert.ok(headingIndex >= 0 && titleIndex > headingIndex);
  assert.ok(statusIndex > titleIndex, "le statut doit suivre le titre");
  assert.ok(actionsIndex > statusIndex, "les actions doivent suivre le statut");
  assert.ok(tabsIndex > actionsIndex, "les actions doivent rester dans l’en-tête, avant les onglets");
  assert.match(styles, /\.detailHeading\{[^}]*flex-wrap:nowrap/);
  assert.match(styles, /\.headerActions\{[^}]*flex-wrap:nowrap/);
  assert.match(styles, /@media\(max-width:760px\)[\s\S]*?\.headerActions\{[^}]*flex-wrap:wrap/);
});

test("ChatGPT Ads récupère une interruption et confirme explicitement toute reprise payante", () => {
  assert.match(component, /const isInterruptedRemoteOperation = canRecoverInterruptedAdsCampaign\(campaign\)/);
  assert.match(component, /isInterruptedRemoteOperation \? <button[\s\S]*?runRemoteAction\(campaign, "reconcile"\)[\s\S]*?Contrôler l’opération interrompue/);
  assert.match(component, /const canToggleRemote = canManageRemote && \(campaign\.status === "active" \|\| campaign\.status === "paused"\)/);
  assert.match(component, /campaign\.provider === "openai" \? setResumeId\(campaign\.id\)/);
  assert.match(component, /ADS_OPENAI_REMOTE_RESUME_CONFIRMATION/);
  assert.match(component, /billingConfirmed: true/);
  assert.match(component, /Activer la diffusion payante ChatGPT Ads/);
  assert.match(component, /peut générer des dépenses selon son budget/);
  assert.doesNotMatch(component, /l’activation depuis iNrSend n’est pas disponible/);
  assert.match(component, /const canDeleteRemote = canManageRemote && \(campaign\.provider === "google" \|\| campaign\.provider === "meta"\)/);
});

test("la grille Infos utilise quatre colonnes desktop puis deux et une", () => {
  assert.match(styles, /\.detailGrid\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:950px\)\{\.detailGrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:640px\)[\s\S]*?\.detailGrid\{grid-template-columns:1fr\}/);
  assert.match(styles, /\.section h3\{[^}]*color:#fff/);
});
