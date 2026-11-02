import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const mailbox = read("app/dashboard/mails/MailboxClient.tsx");
const dailyRoute = read("app/api/stats/daily-refresh/route.ts");
const lockdownSql = read("ops/sql/2026-07-05_multicompte_step6_1_scope_lockdown.sql");
const lockdownCheck = read("ops/checks/2026-07-05_multicompte_step6_1_scope_lockdown_check.sql");
const gmailSend = read("app/api/inbox/gmail/send/route.ts");
const microsoftSend = read("app/api/inbox/microsoft/send/route.ts");
const imapSend = read("app/api/inbox/imap/send/route.ts");
const mailSender = read("lib/inrsend/sendMailFromIntegration.ts");
const googleStats = read("lib/googleStats.ts");
const linkedInOAuth = read("lib/linkedinOAuth.ts");
const publicationActions = read("lib/inrsend/publicationChannelActions.ts");

test("les brouillons Mails ne retombent plus sur l'UID AUTH", () => {
  assert.doesNotMatch(mailbox, /\.eq\("user_id", \(await supabase\.auth\.getUser\(\)\)\.data\?\.user\?\.id/);
  for (const payload of ["draftPayload", "metadataPayload", "legacyPayload"]) {
    const scopedUpdate = new RegExp(`\\.from\\("send_items"\\)\\s*\\.update\\(\\{\\s*\\.\\.\\.${payload},\\s*updated_at:\\s*new Date\\(\\)\\.toISOString\\(\\)\\s*\\}(?: as any)?\\)\\s*\\.eq\\("id", draftId\\)\\s*\\.eq\\("user_id", userId\\)`);
    assert.match(mailbox, scopedUpdate, `${payload}: versioned update retains the exact draft and active establishment filters`);
  }
});

test("les destinataires de campagne Mails sont lus dans l'établissement actif", () => {
  assert.match(mailbox, /\.select\("email,display_name,contact_id"\)[\s\S]*?\.eq\("user_id", userId\)[\s\S]*?\.eq\("campaign_id", campaignId\)/);
  assert.match(mailbox, /mail_campaign_recipients[\s\S]*?count: "exact"[\s\S]*?\.eq\("user_id", userId\)[\s\S]*?\.eq\("campaign_id", campaignId\)/);
});

test("les trois RPC de refresh stats reçoivent explicitement activeUserId", () => {
  for (const rpc of ["claim_daily_stats_refresh", "complete_daily_stats_refresh", "release_daily_stats_refresh_claim"]) {
    const index = dailyRoute.indexOf(`rpc("${rpc}"`);
    assert.ok(index >= 0, rpc);
    assert.match(dailyRoute.slice(index, index + 500), /p_user_id:\s*activeUserId/);
  }
});

test("le SQL 6.1 supprime les anciennes RPC stats implicites", () => {
  assert.match(lockdownSql, /drop function if exists public\.claim_daily_stats_refresh\(date, integer\)/i);
  assert.match(lockdownSql, /drop function if exists public\.complete_daily_stats_refresh\(date\)/i);
  assert.match(lockdownSql, /drop function if exists public\.release_daily_stats_refresh_claim\(date\)/i);
  assert.doesNotMatch(lockdownSql, /v_user_id\s+uuid\s*:=\s*auth\.uid\(\)/i);
});

test("les RPC stats refusent un établissement non accessible", () => {
  const matches = lockdownSql.match(/public\.inrcy_can_access_account\(p_user_id\)/g) || [];
  assert.ok(matches.length >= 3, `contrôles trouvés: ${matches.length}`);
});

test("les moteurs Gmail Microsoft IMAP bornent les updates d'historique au user_id actif", () => {
  for (const source of [gmailSend, microsoftSend, imapSend]) {
    assert.match(source, /update\(historyPayload\)\.eq\("id", sendItemId\)\.eq\("user_id", userId\)/);
  }
});

test("les refresh tokens partagés ne modifient qu'une intégration du bon établissement", () => {
  assert.match(mailSender, /from\("integrations"\)\.update[\s\S]*?\.eq\("id", accountId\)\.eq\("user_id", asString\(account\.user_id\) \|\| ""\)/);
  assert.match(googleStats, /\.eq\("id", row\.id\)[\s\S]*?\.eq\("user_id", effectiveUserId\)/);
  assert.match(googleStats, /\.eq\("id", row\.id\)[\s\S]*?\.eq\("user_id", userId\)/);
  assert.match(linkedInOAuth, /\.eq\("id", row\.id\)[\s\S]*?\.eq\("user_id", params\.userId\)/);
});

test("les événements de publication modifiés restent bornés au user_id", () => {
  assert.match(publicationActions, /update\(\{ payload: nextPayload \}\)\.in\("id", ids\)\.eq\("user_id", userId\)/);
});

test("le check SQL 6.1 couvre anciennes signatures, RLS et FK établissement", () => {
  assert.match(lockdownCheck, /anomaly_legacy_daily_stats_rpc_signature/);
  assert.match(lockdownCheck, /anomaly_daily_stats_rpc_uses_auth_uid_as_business_scope/);
  assert.match(lockdownCheck, /anomaly_daily_stats_rls_not_account_scoped/);
  assert.match(lockdownCheck, /anomaly_daily_stats_fk_not_account_scoped/);
});
