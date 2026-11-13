import { withUiCopy } from "./helpers/localized-ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const settingsSource = readFileSync(
  new URL("../app/dashboard/ads/AdsConnectionSettings.tsx", import.meta.url),
  "utf8",
);
const clientSource = readFileSync(
  new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url),
  "utf8",
);
const accountsRouteSource = readFileSync(
  new URL("../app/api/ads/accounts/route.ts", import.meta.url),
  "utf8",
);
const selectionRouteSource = readFileSync(
  new URL("../app/api/ads/accounts/selection/route.ts", import.meta.url),
  "utf8",
);
const disconnectRouteSource = readFileSync(
  new URL("../app/api/ads/oauth/[provider]/disconnect/route.ts", import.meta.url),
  "utf8",
);
const organicFacebookDisconnectSource = readFileSync(
  new URL("../app/api/integrations/facebook/disconnect-account/route.ts", import.meta.url),
  "utf8",
);
const publishRouteSource = readFileSync(
  new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url),
  "utf8",
);

const clientAst = ts.createSourceFile("AdsClient.tsx", clientSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function clientFunctionBody(name: string): string {
  let body: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) {
      assert.equal(body, undefined, `Function ${name} must be unambiguous`);
      body = node.body.getText(clientAst);
    }
    ts.forEachChild(node, visit);
  }
  visit(clientAst);
  assert.ok(body, `Function ${name} must have an implementation`);
  return body;
}

test("un canal Ads connecté propose une déconnexion, pas une reconnexion systématique", () => {
  assert.match(withUiCopy(settingsSource), /connected \|\| needsReconnect/);
  assert.match(withUiCopy(settingsSource), /onClick=\{onDisconnect\}[\s\S]*?aria-label=\{i18nT\("deconnexion_value_3fdef0e3"/);
  assert.match(withUiCopy(settingsSource), /oauthLabel\(provider, needsReconnect \? "reconnect" : "connect"\)/);
});

test("Meta Ads et Google Ads partagent le choix et le changement persistants du compte annonceur", () => {
  assert.match(withUiCopy(settingsSource), /Charger mes comptes/);
  assert.match(withUiCopy(settingsSource), /Changer de compte/);
  assert.match(withUiCopy(settingsSource), /Dissocier ce compte/);
  assert.match(withUiCopy(clientSource), /\/api\/ads\/accounts\/selection/);
  assert.match(withUiCopy(selectionRouteSource), /listAdsAccounts\(user\.activeUserId, provider\)/);
  assert.match(withUiCopy(selectionRouteSource), /update\.resource_id = account\.id/);
  assert.match(withUiCopy(selectionRouteSource), /account_selection_cleared/);
  assert.match(withUiCopy(settingsSource), /\{!locked && hasConfiguredAccount \? <button[\s\S]*?Dissocier ce compte/);
});

test("la configuration Meta conserve aussi la sélection de l’identité Facebook et Instagram", () => {
  assert.match(withUiCopy(settingsSource), /Charger mes identités/);
  assert.match(withUiCopy(settingsSource), /Changer l’identité/);
  assert.match(withUiCopy(settingsSource), /Dissocier l’identité/);
  assert.match(withUiCopy(selectionRouteSource), /listMetaPages\(user\.activeUserId\)/);
  assert.match(withUiCopy(selectionRouteSource), /selected_instagram_user_id/);
});

test("Instagram n’est requis que pour les placements Meta qui l’utilisent", () => {
  assert.match(withUiCopy(settingsSource), /metaNeedsInstagramIdentity: boolean/);
  assert.match(withUiCopy(settingsSource), /!metaNeedsInstagramIdentity \|\| Boolean\(savedPage\?\.instagramUserId\)/);
  assert.match(withUiCopy(settingsSource), /Cette Page Facebook suffit pour les placements actuellement sélectionnés/);
  assert.match(withUiCopy(settingsSource), /Instagram requis pour ces placements/);
  assert.match(withUiCopy(clientSource), /metaNeedsInstagramIdentity=\{metaNeedsInstagramIdentity\}/);
  assert.match(withUiCopy(clientSource), /Compte et Page Facebook associés/);
  assert.match(withUiCopy(clientSource), /Compte, Page et Instagram associés/);
});

test("un compte unique est seulement proposé avant une association explicite et la déconnexion reste locale à iNr’ADS", () => {
  assert.match(withUiCopy(accountsRouteSource), /eligibleAccounts\.length === 1/);
  assert.match(withUiCopy(accountsRouteSource), /suggestedAccountId/);
  assert.match(withUiCopy(settingsSource), /Associer ce compte/);
  assert.doesNotMatch(withUiCopy(accountsRouteSource), /supabaseAdmin/);
  assert.match(withUiCopy(accountsRouteSource), /selectedAccountId/);
  assert.match(withUiCopy(disconnectRouteSource), /\.eq\("product", "ads"\)/);
  assert.match(withUiCopy(disconnectRouteSource), /\.eq\("source", source\)/);
});

test("le panneau affiche l’identité OAuth et respecte une dissociation explicite du compte annonceur", () => {
  assert.match(withUiCopy(settingsSource), /value=\{connectedAccountLabel\}/);
  assert.match(withUiCopy(settingsSource), /\[name, email\]\.filter\(Boolean\)\.join/);
  assert.match(withUiCopy(settingsSource), /Compte Facebook/);
  assert.match(withUiCopy(accountsRouteSource), /connectionAccount/);
  assert.match(withUiCopy(accountsRouteSource), /wasAccountExplicitlyCleared/);
});

test("une panne temporaire de découverte conserve les associations Ads enregistrées", () => {
  const fallback = accountsRouteSource.split("} catch (error) {").at(-1) || "";
  assert.match(withUiCopy(fallback), /selectedAccountId:\s*refreshedConnection\?\.resource_id\s*\|\|\s*""/);
  assert.match(withUiCopy(fallback), /selectedPageId:\s*selectedPageId\(refreshedConnection\)/);
  assert.match(withUiCopy(fallback), /accountSelectionCleared:\s*refreshedConnection\s*\?\s*wasAccountExplicitlyCleared\(refreshedConnection\)/);
  assert.match(withUiCopy(fallback), /selectedAccountAvailable:\s*false/);
});

test("une connexion à actualiser garde l’association visible sans autoriser une publication", () => {
  const disconnected = accountsRouteSource.split('if (!connection || connectionStatus !== "connected") {')[1]?.split('const [accounts, pages]')[0] || "";
  assert.match(withUiCopy(disconnected), /selectedAccountId:\s*connection\?\.resource_id\s*\|\|\s*""/);
  assert.match(withUiCopy(disconnected), /selectedAccountAvailable:\s*false/);
  assert.match(withUiCopy(publishRouteSource), /connection\?\.status !== "connected" \|\| connection\.resource_id !== draft\.adAccountId/);
});

test("une nouvelle campagne reprend le compte associé et le lancement l’enregistre dans le même clic", () => {
  const start = clientFunctionBody("startNewCampaign");
  const launchCheck = clientFunctionBody("openLaunchDialog");
  const launch = clientFunctionBody("confirmCampaignLaunch");
  assert.match(withUiCopy(start), /adAccountId: isAdsProvider\(channelId\)\s*\? configuredAccountId\s*: isExternalChannel\(channelId\) \? externalStatuses\[channelId\]\.selectedAccountId\s*: channelId === "openai" \? connectionSnapshots\.openai\.accountId : ""/);
  assert.match(withUiCopy(launchCheck), /connection\.selectedAccountId/);
  assert.match(withUiCopy(launch), /fetch\("\/api\/ads\/campaigns", \{/);
  assert.match(withUiCopy(launch), /fetch\(`\/api\/ads\/campaigns\/\$\{campaignId\}\/publish`/);
  assert.doesNotMatch(withUiCopy(launch), /!savedId \|\| dirty/);
  assert.match(withUiCopy(clientSource), /Lancer la campagne/);
});

test("déconnecter Facebook organique ne supprime pas la connexion Meta Ads", () => {
  const removal = organicFacebookDisconnectSource.split(".delete()")[1]?.split("if (deleteError)")[0] || "";
  const verification = organicFacebookDisconnectSource.split("const { data: remaining")[1]?.split("if (verifyError)")[0] || "";
  for (const query of [removal, verification]) {
    assert.match(withUiCopy(query), /\.eq\("provider", "facebook"\)/);
    assert.match(withUiCopy(query), /\.eq\("source", "facebook"\)/);
    assert.match(withUiCopy(query), /\.eq\("product", "facebook"\)/);
  }
  assert.match(withUiCopy(disconnectRouteSource), /source = provider === "meta" \? "meta_ads" : "google_ads"/);
  assert.match(withUiCopy(disconnectRouteSource), /\.eq\("product", "ads"\)/);
});
