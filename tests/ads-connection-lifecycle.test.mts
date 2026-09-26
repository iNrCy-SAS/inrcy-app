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
});

test("la configuration Meta conserve aussi la sélection de l’identité Facebook et Instagram", () => {
  assert.match(settingsSource, /Charger mes identités/);
  assert.match(settingsSource, /Changer l’identité/);
  assert.match(settingsSource, /Dissocier l’identité/);
  assert.match(selectionRouteSource, /listMetaPages\(user\.activeUserId\)/);
  assert.match(selectionRouteSource, /selected_instagram_user_id/);
});

test("un compte unique est mémorisé automatiquement et la déconnexion reste locale à iNr’ADS", () => {
  assert.match(accountsRouteSource, /eligibleAccounts\.length === 1/);
  assert.match(accountsRouteSource, /selectedAccountId/);
  assert.match(disconnectRouteSource, /\.eq\("product", "ads"\)/);
  assert.match(disconnectRouteSource, /\.eq\("source", source\)/);
});
