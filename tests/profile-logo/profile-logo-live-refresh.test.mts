import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("saving either part of the unified profile refreshes iNrBadge and invalidates iNrSearch", () => {
  const profileForm = read("app/dashboard/settings/_components/ProfilContent.tsx");
  const activityForm = read("app/dashboard/settings/_components/ActivityContent.tsx");
  const refreshClient = read("lib/publicProfileRefreshClient.ts");
  const dashboard = read("app/dashboard/DashboardClient.tsx");
  const refreshRoute = read("app/api/public-profile/refresh/route.ts");

  assert.match(profileForm, /refreshPublicProfileDependents\("profile"\)/);
  assert.match(activityForm, /refreshPublicProfileDependents\("activity"\)/);
  assert.match(refreshClient, /fetch\("\/api\/public-profile\/refresh"/);
  assert.match(refreshClient, /new CustomEvent\(PUBLIC_PROFILE_DATA_SAVED_EVENT/);
  assert.match(dashboard, /window\.addEventListener\(PUBLIC_PROFILE_DATA_SAVED_EVENT, refreshProfileDependentChannels\)/);
  assert.match(refreshRoute, /revalidateInrSearchPublicRoutes\(slug\)/);
});

test("logo URLs are versioned through the profile, iNrSearch and iNrBadge paths", () => {
  const uploadRoute = read("app/api/profile/logo/route.ts");
  const logoHelpers = read("lib/profileLogo.ts");
  const badgePage = read("app/badge/[slug]/page.tsx");
  const badgeIcon = read("app/badge/[slug]/icon.png/route.ts");

  assert.match(uploadRoute, /getProfileLogoDisplayUrl\(path, createProfileLogoVersion\(\)\)/);
  assert.match(logoHelpers, /getProfileLogoVersion\(source\?\.logo_url\)/);
  assert.match(badgePage, /getBadgeIconUrl\(slug, logoVersion\)/);
  assert.match(badgeIcon, /new URL\(logoUrl, getOrigin\(req\)\)\.toString\(\)/);
  assert.match(badgeIcon, /max-age=31536000, immutable/);
});

test("obsolete profile-only refresh branches were removed", () => {
  const profileForm = read("app/dashboard/settings/_components/ProfilContent.tsx");
  const activityForm = read("app/dashboard/settings/_components/ActivityContent.tsx");
  const logoHelpers = read("lib/profileLogo.ts");

  assert.doesNotMatch(profileForm, /uploadLogoIfNeededLegacy|uploadLogoViaApi|PROFILE_SAVED_EVENT|\/api\/profile\/public-assets/);
  assert.doesNotMatch(activityForm, /PROFILE_SAVED_EVENT|\/api\/profile\/public-assets/);
  assert.doesNotMatch(logoHelpers, /createSignedLogoUrl/);
  assert.equal(existsSync(join(root, "lib/profileEvents.ts")), false);
  assert.equal(existsSync(join(root, "app/api/profile/public-assets/route.ts")), false);
});
