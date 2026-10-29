import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { channelRuntime, channelNodes, channelItem } from "../helpers/channel-bubble-runtime.mts";

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
  const workspace = read("app/dashboard/_components/DashboardChannelWorkspace.tsx");
  const bubble = read("app/dashboard/_components/DashboardFluxBubble.tsx");

  assert.match(start, /repair/);
  assert.match(start, /auth_type/);
  assert.match(start, /rerequest/);
  assert.match(hook, /repairParam/);
  assert.match(hook, /const repairParam = options\?\.repair \? "&repair=1" : ""/);
  assert.match(workspace, /label: t\("classicConnection"\), menu: t\("facebookConnection"\), href: [^\n]+onConnect: item\.bubbleStatus === "reconnect" \? \(\) => ig\.connectInstagramAccount\(\{ repair: true \}\) : ig\.connectInstagramAccount/);
  assert.match(bubble, /const connectLabel = connection\?\.connectLabel \|\| \(item\.bubbleStatus === "reconnect" \|\| connection\?\.accountConnected \? t\("reconnect"\) : t\("connect"\)\)/);
  assert.match(bubble, /const showConnect = canConnect && !showDisconnect/);
  assert.match(bubble, /showConnect \? <[\s\S]*?connection\?\.connectOptions\?\.length \? setConnectOpen\(true\)/);
  assert.match(bubble, /const result = await option\.onConnect\(\)/);
  assert.match(bubble, /if \(result !== false\) setConnectOpen\(false\)/);
});


test("le libellé Annuaire ne change pas les actions Connecter ou Reconnecter d’Instagram", () => {
  for(const entry of [
    {key:"instagram",status:"available",connected:false,label:"Connecter"},
    {key:"instagram",status:"reconnect",connected:false,label:"Reconnecter"},
    {key:"instagram",status:"available",connected:true,label:"Reconnecter"},
    {key:"inr_directory",status:"available",connected:false,label:"Activer ma présence",override:"Activer ma présence"},
  ] as const){
    let calls=0;
    const runtime=channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx");
    const tree=runtime.render({item:{...channelItem,key:entry.key,name:entry.key,bubbleStatus:entry.status,
      connection:{accountConnected:entry.connected,resourceLabel:"Compte",onConnect:()=>{calls++;},...("override" in entry?{connectLabel:entry.override}:{})}}});
    const action=channelNodes(tree).find(node=>node.type==="button"&&node.props["aria-label"]===`${entry.label} — ${entry.key}`);
    assert.ok(action,entry.label);assert.equal(calls,0,"Rendering never initiates a connection");
    action.props.onClick();assert.equal(calls,1,"The existing connect callback is retained");
  }
});

test("la réparation OAuth conserve le compte Instagram déjà sélectionné", () => {
  const start = read("app/api/integrations/instagram/start/route.ts");
  const callback = read("app/api/integrations/instagram/callback/route.ts");

  assert.match(start, /ig_repair/);
  assert.match(callback, /const repairMode = .*ig_repair/);
  assert.match(callback, /const preserveSelection = repairMode && previousAuthMode === "facebook_login" && previousStatus === "connected"/);
  assert.match(callback, /status: preserveSelection \? "connected" : "account_connected"/);
  assert.match(callback, /resource_id: preserveSelection \? previousResourceId : null/);
  assert.match(callback, /refreshedPageTokenEnc \|\| previousAccessTokenEnc \|\| encryptedToken/);
  assert.match(callback, /connected: true/);
});
