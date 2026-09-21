import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("le panneau Facebook reste contenu dans le tiroir, y compris sur petit écran", () => {
  const panel = read("app/dashboard/_components/FacebookPanel.tsx");
  const css = read("app/dashboard/dashboard.module.css");
  const socialCss = read("app/dashboard/_components/SocialSettingsSteps.module.css");

  assert.match(panel, /className=\{`\$\{styles\.facebookConfigPanel\} \$\{socialStyles\.journey\} \$\{socialStyles\.facebook\}`\}/);
  assert.match(panel, /className=\{`\$\{socialStyles\.stepCard\} \$\{socialStyles\.facebook\}`\}/);
  assert.match(panel, /className=\{styles\.facebookConfigButtonRow\}/);
  assert.match(panel, /className=\{styles\.facebookConfigResourceRow\}/);
  assert.match(css, /\.facebookConfigPanel\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;/);
  assert.match(socialCss, /\.stepCard\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(socialCss, /@media \(max-width: 720px\)[\s\S]*?\.stepHeader/);
});

test("le bouton du widget Site web peut redemander son jeton au clic", () => {
  const component = read("app/dashboard/_components/SiteActusWidgetCode.tsx");
  const hook = read("app/dashboard/_hooks/channels/useSiteWebChannel.ts");
  const panel = read("app/dashboard/_components/SiteWebPanel.tsx");

  assert.match(component, /onRequestToken\?:\s*\(\)\s*=>\s*Promise<string>/);
  assert.match(component, /effectiveToken\s*=\s*\(await onRequestToken\(\)\)\.trim\(\)/);
  assert.match(component, /!hasToken\s*&&\s*!onRequestToken/);
  assert.match(hook, /const requestSiteWebWidgetToken\s*=\s*useCallback/);
  assert.match(hook, /extractDomain\(siteWebSavedUrl\s*\|\|\s*siteWebUrl\)/);
  assert.match(panel, /onRequestToken=\{requestSiteWebWidgetToken\}/);
});

test("le widget Actus propose un composant React et Next.js auto-redimensionné", () => {
  const component = read("app/dashboard/_components/SiteActusWidgetCode.tsx");
  const embed = read("app/embed/actus/_lib/render.ts");
  const messages = read("messages/fr-FR/shell.json");

  assert.match(component, /type WidgetInstallTarget = "html" \| "react_next"/);
  assert.match(component, /const buildReactNextSnippet/);
  assert.match(component, /return `"use client";/);
  assert.match(component, /useRef<HTMLIFrameElement \| null>/);
  assert.match(component, /event\.source !== iframe\.contentWindow/);
  assert.match(component, /if \(data\.source && data\.source !== "inrcy-embed"\) return/);
  assert.match(component, /loading="eager" fetchpriority="high"/);
  assert.match(
    component,
    /loading="eager"\s+fetchPriority="high"\s+referrerPolicy="strict-origin-when-cross-origin"/,
  );
  assert.doesNotMatch(component, /loading="lazy"/);
  assert.match(component, /scrolling="no"/);
  assert.match(embed, /source:'inrcy-embed'/);
  assert.match(component, /window\.removeEventListener\("message", onMessage\)/);
  assert.match(component, /<section id="actualites"/);
  assert.match(component, /\["react_next", "React \/ Next\.js"\]/);
  assert.match(messages, /frame-src https:\/\/app\.inrcy\.com/);
});

test("le thème gris clair du widget Actus garde des accents entièrement neutres", () => {
  const component = read("app/dashboard/_components/SiteActusWidgetCode.tsx");
  const route = read("app/embed/actus/route.ts");
  const embed = read("app/embed/actus/_lib/render.ts");
  const grayPalette = embed.match(/case "gray":[\s\S]*?case "sand":/)?.[0] ?? "";

  assert.match(component, /embedUrl\.searchParams\.set\("theme", config\.theme\)/);
  assert.match(component, /config\.theme === "custom" \? normalizeActusAccent\(config\.accent\) : ""/);
  assert.match(route, /const theme = clampTheme\(searchParams\.get\("theme"\)\)/);
  assert.match(route, /const accent = clampAccent\(searchParams\.get\("accent"\)\)/);
  assert.match(route, /"cache-control": "private, no-store, max-age=0"/);
  assert.match(grayPalette, /bg: "#f4f5f6"/);
  assert.match(grayPalette, /brand: "#6b7280"/);
  assert.match(grayPalette, /brandDeep: "#374151"/);
  assert.doesNotMatch(grayPalette, /#62d56a|#1f6a32/i);
  assert.match(embed, /const brand = palette\.brand/);
});

test("un rafraîchissement des connexions ne réinitialise pas la couleur du widget Actus", () => {
  const dashboard = read("app/dashboard/DashboardClient.tsx");

  assert.match(
    dashboard,
    /if \(typeof state\.siteInrcyActusAccent === "string"\) \{\s*setSiteInrcyActusAccent\(normalizeActusAccent\(state\.siteInrcyActusAccent\)\);\s*\}/,
  );
  assert.match(
    dashboard,
    /if \(typeof state\.siteWebActusAccent === "string"\) \{\s*setSiteWebActusAccent\(normalizeActusAccent\(state\.siteWebActusAccent\)\);\s*\}/,
  );
  assert.match(dashboard, /siteInrcyActusAccent:\s*""/);
  assert.match(dashboard, /siteWebActusAccent:\s*""/);
});

test("la couleur personnalisée pilote toute la palette de l'iframe Actus", () => {
  const embed = read("app/embed/actus/_lib/render.ts");
  const customPalette = embed.match(/case "custom": \{[\s\S]*?case "nature":/)?.[0] ?? "";

  assert.match(embed, /function buildCustomThemePalette\(accent: string\): ThemePalette \| null/);
  assert.match(customPalette, /buildCustomThemePalette\(accent\)/);
  assert.match(embed, /bg: mixHexColor\(color, white, 0\.9\)/);
  assert.match(embed, /surfaceSoft: mixHexColor\(color, white, 0\.94\)/);
  assert.match(embed, /brand: accent/);
  assert.match(
    embed,
    /const safeAccent =[\s\S]*?const palette = getThemePalette\(theme, safeAccent\)/,
  );
  assert.doesNotMatch(customPalette, /#6bd05f|#214f24/i);
});

test("l'émission d'un jeton accepte le dashboard same-origin sans affaiblir l'authentification", () => {
  const route = read("app/api/widgets/issue-token/route.ts");

  assert.match(route, /sameOriginDashboardRequest/);
  assert.match(route, /originH\s*===\s*requestHost\(_req\)/);
  assert.match(route, /if\s*\(!allowOrigin\s*&&\s*origin\)/);
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /resolveActiveInrcyAccountId/);
  assert.match(route, /Ce domaine n'est pas rattaché à votre site web/);
});

test("les sélections de ressources deviennent vertes sans attendre le rafraîchissement des statistiques", () => {
  const facebook = read("app/dashboard/_hooks/channels/useFacebookChannel.ts");
  const instagram = read("app/dashboard/_hooks/channels/useInstagramChannel.ts");
  const linkedin = read("app/dashboard/_hooks/channels/useLinkedinChannel.ts");

  assert.ok((facebook.match(/void triggerChannelRefresh\("facebook"\)/g) ?? []).length >= 2);
  assert.ok((instagram.match(/void triggerChannelRefresh\("instagram"\)/g) ?? []).length >= 2);
  assert.match(
    linkedin,
    /const persistLinkedinOrganization[\s\S]*?void triggerChannelRefresh\("linkedin"\)/,
  );
  assert.match(
    linkedin,
    /const useLinkedinPersonalProfile[\s\S]*?void triggerChannelRefresh\("linkedin"\)/,
  );
});

test("les pastilles privilégient la connexion confirmée sur un ancien état de chargement", () => {
  const facebook = read("app/dashboard/_components/FacebookPanel.tsx");
  const instagram = read("app/dashboard/_components/InstagramPanel.tsx");
  const linkedin = read("app/dashboard/_components/LinkedinPanel.tsx");

  assert.match(facebook, /facebookPageConnected\s*\?\s*undefined/);
  assert.match(instagram, /instagramConnected\s*\?\s*undefined/);
  assert.match(linkedin, /hasCompanyPage\s*\?\s*undefined/);
});

test("les panneaux Facebook et Instagram reçoivent leurs contrôles de formats", () => {
  const dashboard = read("app/dashboard/DashboardClient.tsx");
  const localsStart = dashboard.indexOf("const locals = {");
  const localsEnd = dashboard.indexOf(
    "buildDashboardPanelProps(locals)",
    localsStart,
  );

  assert.notEqual(localsStart, -1);
  assert.notEqual(localsEnd, -1);

  const locals = dashboard.slice(localsStart, localsEnd);
  for (const platform of ["Facebook", "Instagram"] as const) {
    const prefix = platform.toLowerCase();
    assert.match(locals, new RegExp(`${prefix}PublicationPreferences[,\\s]`));
    assert.match(
      locals,
      new RegExp(`${prefix}PublicationPreferencesLoading[,\\s]`),
    );
    assert.match(
      locals,
      new RegExp(`${prefix}PublicationPreferencesSaving[,\\s]`),
    );
    assert.match(
      locals,
      new RegExp(`${prefix}PublicationPreferencesNotice[,\\s]`),
    );
    assert.match(
      locals,
      new RegExp(`${prefix}PublicationPreferencesError[,\\s]`),
    );
    assert.match(
      locals,
      new RegExp(`update${platform}PublicationPreferences[,\\s]`),
    );
    assert.match(
      locals,
      new RegExp(`save${platform}PublicationPreferences[,\\s]`),
    );
  }
});

test("une connexion en cours grise et neutralise le bouton sans seconde animation", () => {
  const css = read("app/dashboard/dashboard.module.css");

  assert.match(
    css,
    /\.connectingActionBtn,[\s\S]*?\.connectingActionBtn:disabled\s*\{[\s\S]*?opacity:\s*0\.48;[\s\S]*?cursor:\s*not-allowed;[\s\S]*?pointer-events:\s*none;[\s\S]*?box-shadow:\s*none;/,
  );
  assert.match(css, /\.connectingActionBtn::before\s*\{\s*content:\s*none;/);
  assert.doesNotMatch(
    css,
    /\.connectingActionBtn::before\s*\{[\s\S]*?animation:\s*connectionPillPulse/,
  );
});

test("YouTube recharge l'état serveur au retour OAuth", () => {
  const source = read("app/dashboard/settings/_components/YoutubeShortsSettingsContent.tsx");

  assert.match(source, /params\.get\("linked"\)\s*!==\s*"youtube_shorts"/);
  assert.match(source, /params\.get\("ok"\)\s*===\s*"1"[\s\S]*?void loadSettings\(\)/);
});

test("les notifications automatiques ignorent un compte invité mais jamais activé", () => {
  const cron = read("app/api/cron/notifications/route.ts");

  assert.match(cron, /\.select\("user_id, last_active_at"\)/);
  assert.match(cron, /if\s*\(row\.user_id\s*&&\s*row\.last_active_at\)\s*userIds\.add/);
  assert.match(cron, /if\s*\(!row\?\.last_active_at\)/);
});

test("la période d'essai démarre à l'inscription, sans attendre le mot de passe", () => {
  const signup = read("app/api/public/trial-signup/route.ts");
  const trial = read("lib/trialSubscription.ts");

  assert.match(signup, /ensureTrialSubscription\(userId, payload\.email\)/);
  assert.match(trial, /const \{ start, end \} = computeTrialWindowFromNow\(trialDays\)/);
  assert.match(trial, /trial_start_at:\s*start\.toISOString\(\)/);
  assert.match(trial, /trial_end_at:\s*end\.toISOString\(\)/);
});
