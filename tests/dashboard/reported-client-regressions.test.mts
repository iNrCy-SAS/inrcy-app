import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("le panneau Facebook reste contenu dans le tiroir, y compris sur petit écran", () => {
  const panel = read("app/dashboard/_components/FacebookPanel.tsx");
  const css = read("app/dashboard/dashboard.module.css");

  assert.match(panel, /className=\{styles\.facebookConfigPanel\}/);
  assert.match(panel, /className=\{styles\.facebookConfigCard\}/);
  assert.match(panel, /className=\{styles\.facebookConfigButtonRow\}/);
  assert.match(panel, /className=\{styles\.facebookConfigResourceRow\}/);
  assert.match(css, /\.facebookConfigPanel\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;/);
  assert.match(css, /\.facebookConfigCard\s*\{[\s\S]*?overflow:\s*hidden;/);
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
