import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import {
  adsConnectionDisplay,
  adsConnectionSnapshotFromRow,
  emptyAdsConnectionSnapshots,
  isAdsIntegrationForChannel,
} from "../lib/adsConnectionSnapshot.ts";

test("une association Ads persistée reste affichée pendant le changement de canal", () => {
  const snapshots = emptyAdsConnectionSnapshots();
  snapshots.google = adsConnectionSnapshotFromRow({
    status: "connected",
    resource_id: "6547075545",
    resource_label: "Mon compte annonceur",
  });
  assert.deepEqual(adsConnectionDisplay(snapshots.google), { label: "Compte connecté", tone: "connected" });
  assert.equal(snapshots.google.accountId, "6547075545");
  assert.deepEqual(adsConnectionDisplay(snapshots.meta), { label: "Vérification…", tone: "loading" });
});

test("une connexion révoquée garde l'association mais demande une actualisation", () => {
  const snapshot = adsConnectionSnapshotFromRow({ status: "needs_update", resource_id: "6547075545" });
  assert.equal(snapshot.accountId, "6547075545");
  assert.deepEqual(adsConnectionDisplay(snapshot), { label: "Connexion à actualiser", tone: "select-account" });
});

test("le snapshot X Ads exige provider, source et product sans confondre X organique", () => {
  assert.equal(isAdsIntegrationForChannel({ provider: "x", source: "x_ads", product: "ads" }, "x"), true);
  assert.equal(isAdsIntegrationForChannel({ provider: "x", source: "x", product: "x" }, "x"), false);
  assert.equal(isAdsIntegrationForChannel({ provider: "twitter", source: "x_ads", product: "ads" }, "x"), false);
});

test("la navigation iNr’ADS envoie le suivi vers le nouvel onglet iNr’Send", () => {
  const adsClient = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const draftsMenu = readFileSync(new URL("../app/dashboard/ads/AdsDraftsMenu.tsx", import.meta.url), "utf8");
  const mailbox = readFileSync(new URL("../app/dashboard/mails/MailboxClient.tsx", import.meta.url), "utf8");
  assert.match(adsClient, /href="\/dashboard\/mails\?folder=campagnes-ads"/);
  assert.match(draftsMenu, /href="\/dashboard\/mails\?folder=campagnes-ads&boxView=drafts"/);
  assert.match(mailbox, /<AdsCampaignsFolder key=\{activeAccountId\} onCountChange=\{refreshAdsCampaignCount\}/);
  assert.match(mailbox, /adsCampaignsSelected/);

  // The count hook must mount with the mailbox, even before ADS is selected.
  const source = ts.createSourceFile("MailboxClient.tsx", mailbox, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "MailboxClient");
  assert.ok(component && ts.isFunctionDeclaration(component) && component.body);
  const counter = component.body.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => Array.from(statement.declarationList.declarations))
    .find((declaration) => declaration.initializer && ts.isCallExpression(declaration.initializer)
      && declaration.initializer.expression.getText(source) === "useAdsCampaignCount");
  assert.ok(counter?.initializer && ts.isCallExpression(counter.initializer));
  assert.deepEqual(counter.initializer.arguments.map((argument) => argument.getText(source)), ["adsEnabled", "activeAccountId"]);
  assert.match(counter.name.getText(source), /count: adsCampaignCount/);
  assert.match(counter.name.getText(source), /error: adsCampaignCountError/);
  assert.match(counter.name.getText(source), /refresh: refreshAdsCampaignCount/);

  // Mobile and desktop receive the same total and error instead of keeping
  // a permanent loading badge or replacing an unavailable count with zero.
  assert.equal((mailbox.match(/adsTab=\{adsEnabled \? \{[^}]*count: adsCampaignCount, countError: adsCampaignCountError/g) || []).length, 2);
  for (const filename of ["FolderTabs.tsx", "MobileFoldersMenu.tsx"]) {
    const tabs = readFileSync(new URL(`../app/dashboard/mails/_components/${filename}`, import.meta.url), "utf8");
    assert.match(tabs, /title=\{adsTab\.countError \|\| "ADS"\}/);
    assert.match(tabs, /adsTab\.countError \? "—" : adsTab\.count \?\? "…"/);
  }
});
