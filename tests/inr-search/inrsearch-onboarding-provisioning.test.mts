import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

test("iNrSearch remains provisionable before the profile or iNrADN are filled", () => {
  const provisioning = read("lib/inrSearchProvisioning.ts");
  const settingsRoute = read("app/api/inr-search/settings/route.ts");
  const workspace = read("app/dashboard/_components/DashboardChannelWorkspace.tsx");

  assert.match(provisioning, /const PROVISIONAL_PAGE_TITLE = "Votre entreprise";/);
  assert.match(provisioning, /fallbackSlugSeed\(activeUserId\)/);
  assert.match(provisioning, /const canPublish = Boolean\(slug\);/);
  assert.doesNotMatch(provisioning, /const canPublish = Boolean\(companyName && slug\);/);
  assert.match(settingsRoute, /ensureSystemManagedInrSearch\(supabase, activeUserId\)/);
  assert.doesNotMatch(settingsRoute, /profil est incomplet/);
  assert.match(workspace, /NativeChannelSettingsContent/);
  assert.match(settingsRoute, /syncNativeChannelsForAccount\(activeUserId, \{ key: "inr_search", enabled: action === "connect" \}\)/);
  assert.doesNotMatch(workspace, /if \(!props\.inrBadgeSettingsProps\.profileReady\)/);
});
