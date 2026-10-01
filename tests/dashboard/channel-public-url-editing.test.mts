import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { normalizeChannelPublicUrl } from "../../lib/channelPublicUrl.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("channel links accept their real public hosts and reject lookalikes", () => {
  for (const [channel, url] of [
    ["gmb", "https://www.google.fr/maps/place/iNrCy"],
    ["gmb", "https://maps.app.goo.gl/abc123"],
    ["facebook", "https://www.facebook.com/inrcy"],
    ["instagram", "https://instagram.com/inrcy"],
    ["linkedin", "https://www.linkedin.com/company/inrcy"],
    ["tiktok", "https://www.tiktok.com/@inrcy"],
    ["youtube_shorts", "https://www.youtube.com/@inrcy"],
    ["pinterest", "https://www.pinterest.fr/inrcy"],
    ["pinterest", "https://pinterest.co.uk/inrcy"],
    ["x", "https://x.com/inrcy"],
    ["site_inrcy", "https://site.inrcy.example.com"],
    ["site_web", "example.com:8443/contact"],
  ] as const) {
    assert.equal(normalizeChannelPublicUrl(channel, url).ok, true, `${channel}: ${url}`);
  }

  for (const [channel, url] of [
    ["gmb", "https://google.evil.com/maps/inrcy"],
    ["facebook", "https://facebook.com.evil.com/inrcy"],
    ["linkedin", "https://linkedin.com.evil.com/company/inrcy"],
    ["pinterest", "https://pinterest.evil.com/inrcy"],
    ["x", "https://x.com.evil.com/inrcy"],
  ] as const) {
    assert.deepEqual(normalizeChannelPublicUrl(channel, url), {
      ok: false,
      code: "wrong_host",
    });
  }
});

test("channel links reject explicit non-web schemes and non-public hosts", () => {
  for (const url of [
    "ftp://example.com/profile",
    "javascript:alert(1)",
    "mailto:contact@example.com",
  ]) {
    assert.deepEqual(normalizeChannelPublicUrl("site_web", url), {
      ok: false,
      code: "invalid_protocol",
    });
  }

  for (const url of [
    "http://localhost:3000",
    "http://app.localhost",
    "http://127.0.0.1",
    "http://10.1.2.3",
    "http://172.20.1.2",
    "http://192.168.1.2",
    "http://169.254.169.254",
    "http://[::1]",
    "http://[fc00::1]",
    "http://[fec0::1]",
    "https://intranet",
    "https://portal.internal",
  ]) {
    assert.deepEqual(normalizeChannelPublicUrl("site_web", url), {
      ok: false,
      code: "invalid_url",
    }, url);
  }
});

test("social links identify public profile/channel paths rather than arbitrary platform pages", () => {
  for (const [channel, url, target] of [
    ["facebook", "https://facebook.com/profile.php?id=123", undefined],
    ["linkedin", "https://linkedin.com/in/jane-doe", "profile"],
    ["linkedin", "https://linkedin.com/company/inrcy", "organization"],
    ["youtube_shorts", "https://youtube.com/channel/UC123", undefined],
    ["youtube_shorts", "https://youtube.com/user/inrcy", undefined],
    ["youtube_shorts", "https://youtube.com/@inrcy/videos", undefined],
  ] as const) {
    assert.equal(normalizeChannelPublicUrl(channel, url, target).ok, true, `${channel}: ${url}`);
  }

  for (const [channel, url, target] of [
    ["gmb", "https://google.com/maps", undefined],
    ["gmb", "https://google.com/mapsfake/place/inrcy", undefined],
    ["gmb", "https://google.zip/maps/place/inrcy", undefined],
    ["facebook", "https://facebook.com/", undefined],
    ["instagram", "https://instagram.com/p/abc", undefined],
    ["linkedin", "https://linkedin.com/jobs", undefined],
    ["linkedin", "https://linkedin.com/company/inrcy", "profile"],
    ["linkedin", "https://linkedin.com/in/jane-doe", "organization"],
    ["tiktok", "https://tiktok.com/video/123", undefined],
    ["youtube_shorts", "https://youtube.com/watch?v=abc", undefined],
    ["youtube_shorts", "https://youtu.be/abc", undefined],
    ["youtube_shorts", "https://youtube.com/embed", undefined],
    ["pinterest", "https://pinterest.com/pin/123", undefined],
    ["pinterest", "https://pin.it/abc", undefined],
    ["pinterest", "https://pinterest.zip/inrcy", undefined],
    ["x", "https://x.com/home", undefined],
  ] as const) {
    assert.equal(normalizeChannelPublicUrl(channel, url, target).ok, false, `${channel}: ${url}`);
  }
});

test("channel links are normalized and never accept embedded credentials", () => {
  const normalized = normalizeChannelPublicUrl(
    "instagram",
    " Instagram.com/inrcy/?b=2&a=1#profile ",
  );
  assert.deepEqual(normalized, {
    ok: true,
    url: "https://instagram.com/inrcy?a=1&b=2",
    comparisonKey: "https://instagram.com/inrcy?a=1&b=2",
  });
  assert.deepEqual(
    normalizeChannelPublicUrl("site_web", "https://user:secret@example.com"),
    { ok: false, code: "credentials_not_allowed" },
  );
});

test("every editable channel surface uses the shared protected field", () => {
  const surfaces = [
    "app/dashboard/_components/SiteInrcyPanel.tsx",
    "app/dashboard/_components/SiteWebPanel.tsx",
    "app/dashboard/_components/GoogleBusinessPanel.tsx",
    "app/dashboard/_components/FacebookPanel.tsx",
    "app/dashboard/_components/InstagramPanel.tsx",
    "app/dashboard/_components/LinkedinPanel.tsx",
    "app/dashboard/_components/TiktokPanel.tsx",
    "app/dashboard/settings/_components/YoutubeShortsSettingsContent.tsx",
    "app/dashboard/settings/_components/PinterestSettingsContent.tsx",
    "app/dashboard/settings/_components/XSettingsContent.tsx",
  ];

  for (const surface of surfaces) {
    assert.match(read(surface), /EditableChannelUrlField/, surface);
  }

  const field = read("app/dashboard/_components/EditableChannelUrlField.tsx");
  assert.match(field, /readOnly=\{!editing\}/);
  assert.match(field, /editing && hasNormalizedChange/);
  assert.match(field, /onDirtyChange\?\.\(editing && hasDraftChange\)/);
  assert.match(field, /onClick=\{cancelEditing\}[\s\S]*?annuler_49ba3292/);
  assert.match(field, /method: "PATCH"/);
  assert.match(field, /channel_url_change_required/);

  const drawer = read("app/dashboard/_components/DashboardSettingsDrawerContent.tsx");
  assert.match(drawer, /XSettingsContent onUnsavedChange=\{panel === "x" \? onUnsavedChange : undefined\}/);
  for (const channel of ["site_inrcy", "site_web", "instagram", "linkedin", "gmb", "facebook", "tiktok"]) {
    assert.match(
      drawer,
      new RegExp(`onUrlDirtyChange: panel === "${channel}" \\? onUnsavedChange : undefined`),
      channel,
    );
  }

  for (const surface of surfaces) {
    if (surface.includes("Youtube") || surface.includes("Pinterest")) continue;
    assert.match(read(surface), /onDirtyChange=/, surface);
  }
});

test("YouTube URL saves preserve the baseline of unrelated unsaved preferences", () => {
  const youtube = read("app/dashboard/settings/_components/YoutubeShortsSettingsContent.tsx");
  assert.match(youtube, /savedBaseline[\s\S]*?JSON\.stringify\(\{ \.\.\.savedBaseline, channelUrl: url \}\)/);
  assert.match(youtube, /onDirtyChange=\{setChannelUrlDraftDirty\}/);
  assert.match(youtube, /settingsDirty \|\| channelUrlDraftDirty/);
  const urlOnlySave = youtube.match(/onSaved=\{\(url\) => \{[\s\S]*?onDirtyChange=\{setChannelUrlDraftDirty\}/)?.[0] || "";
  assert.doesNotMatch(urlOnlySave, /settingsBaselineRef\.current = JSON\.stringify\(nextSettings\)/);
});

test("the save route writes both the active-account mirror and integration source of truth", () => {
  const route = read("app/api/integrations/channel-public-url/route.ts");
  assert.match(route, /requireUser\(\)/);
  assert.match(route, /activeUserId/);
  assert.match(route, /\.from\("profiles"\)[\s\S]*?\.select\("inrcy_site_ownership"\)[\s\S]*?\.eq\("user_id", activeUserId\)/);
  assert.match(route, /hasActiveInrcySite/);
  assert.match(route, /site_ownership_required[\s\S]*?status: 403/);
  assert.match(route, /\.from\("integrations"\)[\s\S]*?\.eq\("user_id", userId\)/);
  assert.match(route, /nextMeta = \{ \.\.\.asRecord\(integration\.meta\), \[metaKey\]: url \}/);
  assert.match(route, /\.from\("pro_tools_configs"\)[\s\S]*?\.eq\("user_id", activeUserId\)/);
  assert.match(route, /\.from\("inrcy_site_configs"\)[\s\S]*?user_id: activeUserId/);
  assert.match(route, /sourceOfTruthUpdated = await updateIntegrationSourceOfTruth/);
  assert.match(route, /if \(!sourceOfTruthUpdated\) throw mirrorError/);
  assert.match(route, /mirrorSynced = false/);
  assert.match(route, /NextResponse\.json\(\{ ok: true, url: normalized\.url, mirrorSynced \}\)/);
  assert.match(route, /channel_public_url_mirror_sync_failed/);
  assert.match(route, /syncSitePresenceIntegrations\(activeUserId\)/);
});

test("site URL saves update local channel blocks and bubble links prefer the fresh saved value", () => {
  const inrcyHook = read("app/dashboard/_hooks/channels/useSiteInrcyChannel.ts");
  const webHook = read("app/dashboard/_hooks/channels/useSiteWebChannel.ts");
  const bubbles = read("app/dashboard/dashboard.flux-bubbles.ts");
  const presenceSync = read("lib/sitePresenceSync.ts");

  assert.match(inrcyHook, /applySiteInrcyPublicUrlSaved[\s\S]*?resourceUrl: url[\s\S]*?triggerChannelRefresh\("site_inrcy"\)/);
  assert.match(webHook, /applySiteWebPublicUrlSaved[\s\S]*?resourceUrl: url[\s\S]*?triggerChannelRefresh\("site_web"\)/);
  assert.match(webHook, /setSiteWebSettingsText[\s\S]*?next\.url = url[\s\S]*?next\.domain/);
  assert.match(bubbles, /normalizeExternalHref\(siteInrcySavedUrl\) \|\| blockDrivenViewHref/);
  assert.match(bubbles, /normalizeExternalHref\(siteWebSavedUrl\) \|\| blockDrivenViewHref/);

  for (const hook of [inrcyHook, webHook]) {
    assert.match(hook, /fetch\("\/api\/integrations\/channel-public-url"/);
  }
  assert.match(presenceSync, /profileRes\.error \|\| inrcyCfgRes\.error \|\| proCfgRes\.error/);
  assert.match(presenceSync, /if \(error\) throw error/);
});

