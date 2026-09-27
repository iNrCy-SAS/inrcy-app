import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("un canal Ads connecté propose une déconnexion, pas une reconnexion systématique", () => {
  assert.match(settingsSource, /\{connected \? <button[\s\S]*?Déconnexion/);
  assert.match(settingsSource, /needsReconnect \? <>/);
  assert.match(settingsSource, /oauthLabel\(provider, "reconnect"\)/);
});

test("Meta Ads et Google Ads partagent le choix et le changement persistants du compte annonceur", () => {
  assert.match(settingsSource, /Charger mes comptes/);
  assert.match(settingsSource, /Changer de compte/);
  assert.match(settingsSource, /Dissocier ce compte/);
  assert.match(clientSource, /\/api\/ads\/accounts\/selection/);
  assert.match(selectionRouteSource, /listAdsAccounts\(user\.activeUserId, provider\)/);
  assert.match(selectionRouteSource, /update\.resource_id = account\.id/);
  assert.match(selectionRouteSource, /account_selection_cleared/);
  assert.match(settingsSource, /\{accountConfigured \? <button[\s\S]*?Dissocier ce compte/);
});

test("la configuration Meta conserve aussi la sélection de l’identité Facebook et Instagram", () => {
  assert.match(settingsSource, /Charger mes identités/);
  assert.match(settingsSource, /Changer l’identité/);
  assert.match(settingsSource, /Dissocier l’identité/);
  assert.match(selectionRouteSource, /listMetaPages\(user\.activeUserId\)/);
  assert.match(selectionRouteSource, /selected_instagram_user_id/);
});

test("un compte unique est seulement proposé avant une association explicite et la déconnexion reste locale à iNr’ADS", () => {
  assert.match(accountsRouteSource, /eligibleAccounts\.length === 1/);
  assert.match(accountsRouteSource, /suggestedAccountId/);
  assert.match(settingsSource, /Associer ce compte/);
  assert.doesNotMatch(accountsRouteSource, /supabaseAdmin/);
  assert.match(accountsRouteSource, /selectedAccountId/);
  assert.match(disconnectRouteSource, /\.eq\("product", "ads"\)/);
  assert.match(disconnectRouteSource, /\.eq\("source", source\)/);
});

test("le panneau affiche l’identité OAuth et respecte une dissociation explicite du compte annonceur", () => {
  assert.match(settingsSource, /Compte Google.*connecté/);
  assert.match(settingsSource, /Compte Facebook/);
  assert.match(accountsRouteSource, /connectionAccount/);
  assert.match(accountsRouteSource, /wasAccountExplicitlyCleared/);
});

test("une panne temporaire de découverte conserve les associations Ads enregistrées", () => {
  const fallback = accountsRouteSource.split("} catch (error) {").at(-1) || "";
  assert.match(fallback, /selectedAccountId:\s*refreshedConnection\?\.resource_id\s*\|\|\s*""/);
  assert.match(fallback, /selectedPageId:\s*selectedPageId\(refreshedConnection\)/);
  assert.match(fallback, /accountSelectionCleared:\s*refreshedConnection\s*\?\s*wasAccountExplicitlyCleared\(refreshedConnection\)/);
  assert.match(fallback, /selectedAccountAvailable:\s*false/);
});

test("déconnecter Facebook organique ne supprime pas la connexion Meta Ads", () => {
  const removal = organicFacebookDisconnectSource.split(".delete()")[1]?.split("if (deleteError)")[0] || "";
  const verification = organicFacebookDisconnectSource.split("const { data: remaining")[1]?.split("if (verifyError)")[0] || "";
  for (const query of [removal, verification]) {
    assert.match(query, /\.eq\("provider", "facebook"\)/);
    assert.match(query, /\.eq\("source", "facebook"\)/);
    assert.match(query, /\.eq\("product", "facebook"\)/);
  }
  assert.match(disconnectRouteSource, /source = provider === "meta" \? "meta_ads" : "google_ads"/);
  assert.match(disconnectRouteSource, /\.eq\("product", "ads"\)/);
});
