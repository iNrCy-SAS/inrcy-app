import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("le renfort Instagram ne demande aucune permission business_management", () => {
  const start = read("app/api/integrations/instagram/start/route.ts");
  assert.doesNotMatch(start, /business_management/);
  for (const permission of ["pages_show_list", "pages_read_engagement", "instagram_basic"]) {
    assert.match(start, new RegExp(permission));
  }
});

test("la découverte conserve la requête historique puis utilise un fallback Page par Page", () => {
  const assets = read("lib/metaBusinessAssets.ts");
  assert.match(assets, /id,name,access_token,instagram_business_account\{username,id\}/);
  assert.match(assets, /fields: "id,name,access_token"/);
  assert.match(assets, /listAccessibleFacebookPagesDetailed/);
  assert.match(assets, /primary_fallback_used/);
  assert.match(assets, /enrichPageWithLookup/);
  assert.match(assets, /fetchWithRetry/);
});

test("une liste vide n'est plus renvoyée silencieusement", () => {
  const route = read("app/api/integrations/instagram/accounts/route.ts");
  for (const code of [
    "instagram_permissions_incomplete",
    "instagram_profile_not_returned",
    "facebook_pages_not_returned",
    "meta_page_discovery_failed",
  ]) {
    assert.match(route, new RegExp(code));
  }
  assert.match(route, /inspectFacebookUserTokenPermissions/);
  assert.match(route, /instagram_account_discovery_empty/);
});

test("la réparation OAuth est explicite et ne modifie pas la connexion normale", () => {
  const start = read("app/api/integrations/instagram/start/route.ts");
  const hook = read("app/dashboard/_hooks/channels/useInstagramChannel.ts");
  const panel = read("app/dashboard/_components/InstagramPanel.tsx");

  assert.match(start, /repair/);
  assert.match(start, /auth_type/);
  assert.match(start, /rerequest/);
  assert.match(hook, /repairParam/);
  assert.match(panel, /i18nT\("actualiser_les_autorisations_meta_85e7f589"\)/);
});


test("la réparation OAuth conserve le compte Instagram déjà sélectionné", () => {
  const start = read("app/api/integrations/instagram/start/route.ts");
  const callback = read("app/api/integrations/instagram/callback/route.ts");

  assert.match(start, /ig_repair/);
  assert.match(callback, /const repairMode = .*ig_repair/);
  assert.match(callback, /const preserveSelection = repairMode && previousStatus === "connected"/);
  assert.match(callback, /status: preserveSelection \? "connected" : "account_connected"/);
  assert.match(callback, /resource_id: preserveSelection \? previousResourceId : null/);
  assert.match(callback, /refreshedPageTokenEnc \|\| previousAccessTokenEnc \|\| encryptedToken/);
  assert.match(callback, /connected: true/);
});
