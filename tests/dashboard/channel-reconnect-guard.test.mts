import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("dashboard exposes a dedicated reconnect state with orange warning UI", () => {
  const types = read("app/dashboard/dashboard.types.ts");
  const shared = read("app/dashboard/dashboard.shared.ts");
  const bubble = read("app/dashboard/_components/DashboardFluxBubble.tsx");
  const bubbleCss = read("app/dashboard/_components/DashboardChannelBubble.module.css");
  const i18n = read("messages/fr-FR/dashboard.json");

  assert.match(types, /"connected"\s*\|\s*"available"\s*\|\s*"reconnect"\s*\|\s*"coming"/);
  assert.match(shared, /status:\s*"reconnect",\s*text:\s*"À reconnecter"/);
  assert.match(bubble, /item\.bubbleStatus === "reconnect"/);
  assert.match(bubble, /WarningTriangle/);
  assert.match(bubbleCss, /\.reconnectCard\s*\{/);
  assert.match(bubbleCss, /\.statusReconnect\s*\{/);
  assert.match(bubbleCss, /#fb923c/i);
  assert.match(i18n, /"reconnect":\s*"À reconnecter"/);
});

test("reconnect state is refreshed in realtime for every OAuth publication channel", () => {
  const shared = read("app/dashboard/dashboard.shared.ts");
  for (const channel of ["gmb", "facebook", "instagram", "linkedin", "tiktok", "youtube_shorts", "pinterest"]) {
    assert.ok(shared.includes(`source === "${channel}"`) || shared.includes(`provider === "${channel}"`) || (channel === "youtube_shorts" && shared.includes('provider === "youtube"')), `missing realtime mapping for ${channel}`);
  }
});

test("Booster only enables channels whose official connection status is connected", () => {
  const route = read("app/api/booster/connected-channels/route.ts");
  const availability = read("lib/publicationChannelAvailability.ts");
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const selector = read("app/dashboard/booster/publier/components/PublishChannelSelector.tsx");

  assert.match(availability, /state\?\.connected === true && state\.connection_status === "connected"/);
  assert.match(route, /requiresReconnect:\s*publicationChannelRequiresReconnect\(states\.gmb\)/);
  assert.match(route, /requiresReconnect:\s*publicationChannelRequiresReconnect\(states\.pinterest\)/);
  assert.match(modal, /if \(!connected\[key\]\) return;/);
  assert.match(modal, /\[key\]: connected\[key\] \? selected : false/);
  assert.match(selector, /const requiresReconnect = Boolean\(info\?\.requiresReconnect\)/);
  assert.match(selector, /aria-disabled=\{!isConnected\}/);
  assert.match(selector, /requiresReconnect \? <WarningTriangle/);
});

test("runtime OAuth failures persist a reconnect marker and successful OAuth clears it", () => {
  const versions = read("lib/connectionVersions.ts");
  const diagnostics = read("lib/channelPublishDiagnostics.ts");
  const publishNow = read("app/api/booster/publish-now/route.ts");

  assert.match(versions, /hasConnectionReconnectMarker/);
  assert.match(versions, /if \(hasConnectionReconnectMarker\(versionNode\)\) return "needs_update"/);
  assert.match(versions, /clearConnectionReconnectMarkers/);
  for (const channel of ["gmb", "facebook", "instagram", "linkedin", "tiktok", "youtube_shorts", "pinterest"]) {
    assert.ok(diagnostics.includes(`${channel}: {`), `missing persistent reconnect integration key for ${channel}`);
  }
  assert.match(diagnostics, /needs_reconnect:\s*true/);
  assert.match(publishNow, /markPublishChannelReconnectRequired/);
});

test("official integration rows win over stale legacy settings", () => {
  const state = read("lib/channelConnectionState.ts");
  assert.match(state, /const gmbHasOfficialRow = hasIntegrationRecord\(gmb\)/);
  assert.match(state, /const fbHasOfficialRow = hasIntegrationRecord\(fb\)/);
  assert.match(state, /const igHasOfficialRow = hasIntegrationRecord\(ig\)/);
  assert.match(state, /const liHasOfficialRow = hasIntegrationRecord\(li\)/);
  assert.match(state, /pinterestRequiresUpdate/);
});

test("known credential expiry is orange for every OAuth publication channel", () => {
  const state = read("lib/channelConnectionState.ts");
  for (const [statusPrefix, expiryCondition] of [
    ["gmb", "gmbExpired"],
    ["fb", "fbExpired"],
    ["ig", "igExpired"],
    ["li", "liExpired"],
    ["tiktok", "tkExpired"],
    ["youtubeShorts", "youtubeShortsExpired"],
    ["pinterest", "pinterestExpired \\|\\| pinterestEnvironmentMismatch"],
  ]) {
    assert.match(
      state,
      new RegExp(`const ${statusPrefix}ConnectionStatus = ${expiryCondition}\\s*\\? \\"needs_update\\"`),
      `missing orange expiry state for ${statusPrefix}`,
    );
  }
});

test("providers with expiring refresh tokens persist and enforce the absolute expiry", () => {
  const state = read("lib/channelConnectionState.ts");
  const linkedinCallback = read("app/api/integrations/linkedin/callback/route.ts");
  const linkedinOAuth = read("lib/linkedinOAuth.ts");
  const tiktokStorage = read("lib/tiktokRouteStorage.ts");
  const pinterestCallback = read("app/api/integrations/pinterest/callback/route.ts");
  const pinterestOAuth = read("lib/pinterestOAuth.ts");

  assert.match(state, /liMeta\.refresh_expires_at/);
  assert.match(state, /tkMeta\.refresh_expires_at/);
  assert.match(state, /pinterestMeta\.refresh_expires_at/);
  assert.match(linkedinCallback, /refresh_expires_at:\s*refreshTokenExpiresAt/);
  assert.match(linkedinOAuth, /refreshTokenExpired/);
  assert.match(tiktokStorage, /hasUsableRefreshCredential/);
  assert.match(pinterestCallback, /refresh_expires_at:\s*dates\.refreshExpiresAt/);
  assert.match(pinterestOAuth, /isExpired\(meta\.refresh_expires_at\)/);
});

test("green publication channels also have the provider target required to publish", () => {
  const state = read("lib/channelConnectionState.ts");
  const linkedinCallback = read("app/api/integrations/linkedin/callback/route.ts");

  assert.match(state, /liHasPublicationTarget/);
  assert.match(
    state,
    /liHasReusableAuth && liHasPublicationTarget && !liExpired/,
  );
  assert.match(state, /gmbAccountConnected && gmbResourceId && gmbAccountName/);
  assert.match(state, /pinterestEnvironmentMismatch/);
  assert.match(linkedinCallback, /linkedin_profile_unavailable/);
});
