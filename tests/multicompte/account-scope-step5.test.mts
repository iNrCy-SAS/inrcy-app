import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const migration = read("ops/sql/2026-07-05_multicompte_step5_runtime_isolation.sql");
const requireUser = read("lib/requireUser.ts");
const ensureProfile = read("lib/ensureProfileRow.ts");
const dashboardLayout = read("app/dashboard/layout.tsx");
const dashboardClient = read("app/dashboard/DashboardClient.tsx");
const gmailSend = read("app/api/inbox/gmail/send/route.ts");
const imapSend = read("app/api/inbox/imap/send/route.ts");
const microsoftSend = read("app/api/inbox/microsoft/send/route.ts");
const crmContacts = read("app/api/crm/contacts/route.ts");
const agentPrepare = read("app/api/agent/actions/prepare-publish/route.ts");
const statsBulk = read("app/api/stats/dashboard-bulk/route.ts");
const googleAi = read("app/api/e-reputation/google/generate-reply/route.ts");
const subscriptionUi = read("app/dashboard/settings/_components/AbonnementContent.tsx");
const accountExport = read("app/api/account/export/route.ts");
const accountDeletion = read("lib/deleteUserAccount.ts");

test("requireUser sépare explicitement AUTH et établissement actif", () => {
  assert.match(requireUser, /authUserId:\s*data\.user\.id/);
  assert.match(requireUser, /activeUserId:\s*accountScope\.activeUserId/);
});

test("la création SQL initialise un profil vierge sans abonnement secondaire", () => {
  assert.match(migration, /insert into public\.profiles \(user_id, updated_at\)/i);
  assert.match(migration, /values \(v_account_id, now\(\)\)/i);
  assert.doesNotMatch(migration, /insert into public\.subscriptions/i);
  assert.doesNotMatch(migration, /raw_user_meta_data/i);
});

test("ensureProfileRow ne copie les métadonnées AUTH que sur le compte principal", () => {
  assert.match(ensureProfile, /accountUserId === user\.id/);
  assert.match(ensureProfile, /user_id:\s*accountUserId/);
});

test("le forfait historique reste AUTH-global et l'écran lit le contrat vérifié de l'établissement", () => {
  assert.match(dashboardLayout, /\.eq\("user_id", user\.id\)/);
  assert.match(subscriptionUi, /readCurrentAccountSubscription<SubData>\(user\.id\)/);
  const reader = read("app/api/billing/account-subscription/route.ts");
  assert.match(reader, /getApprovedAccountSubscription\(accountId,user\.id\)/);
  assert.match(reader, /\.eq\("user_id",user\.id\)/);
});

test("le dashboard ne réécrase pas l'établissement actif avec l'UID AUTH au chargement", () => {
  assert.match(dashboardClient, /!getActiveBrowserUserId\(\)/);
  assert.doesNotMatch(
    dashboardClient,
    /setUserEmail\(user\?\.email \?\? null\);\s*setActiveBrowserUserId\(user\?\.id \?\? null\);/,
  );
});

test("les trois moteurs d'envoi mail utilisent l'établissement actif", () => {
  for (const source of [gmailSend, imapSend, microsoftSend]) {
    assert.match(source, /activeUserId/);
    assert.match(source, /const userId = activeUserId/);
  }
});

test("CRM, iNrAgent et statistiques sont isolés par établissement actif", () => {
  assert.match(crmContacts, /resolveActiveInrcyAccountId/);
  assert.match(agentPrepare, /const quotaAccountId = userId/);
  assert.match(read("lib/inrAgentRequest.ts"), /userId:\s*activeUserId/);
  assert.match(statsBulk, /resolveActiveInrcyAccountId/);
});

test("Google e-réputation utilise l’établissement actif pour le contexte et le quota IA", () => {
  assert.match(googleAi, /const userId = activeUserId/);
  assert.match(googleAi, /isAdminUserForAi\(supabase, authUserId\)/);
  assert.match(googleAi, /reserveAiCredits\(\{[\s\S]*?userId,/);
  assert.match(googleAi, /accountId:\s*userId/);
});


test("Mon Compte exporte et supprime l’ensemble des établissements du compte AUTH", () => {
  assert.match(accountExport, /accountScope\.accounts/);
  assert.match(accountExport, /fetchUserTable\(exportSupabase, "subscriptions", authUserId\)/);
  assert.match(accountDeletion, /inrcy_account_members/);
  assert.match(accountDeletion, /secondaryAccountIds/);
  assert.match(accountDeletion, /deleteUser\(authUserId\)/);
});
