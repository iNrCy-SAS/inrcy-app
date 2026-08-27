import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");

test("une boîte IMAP connectée garde un accès permanent à ses paramètres", () => {
  const ui = read("app/dashboard/settings/_components/MailsSettingsContent.tsx");
  const status = read("app/api/integrations/status/route.ts");

  assert.match(ui, /acc\.provider === "imap"[\s\S]*imap_settings_button[\s\S]*openImapModal\(acc\)/);
  assert.match(ui, /account\?\.imap_settings/);
  assert.match(ui, /accountId: imapEditingAccountId/);
  assert.match(ui, /!imapEditingAccountId && !imapPassword/);
  assert.match(status, /imap_settings:[\s\S]*publicImapSettings\(settings\)/);
  assert.doesNotMatch(status, /select\([^\n]*refresh_token_enc/);
});

test("une modification IMAP conserve le secret et l'identifiant existants", () => {
  const route = read("app/api/integrations/imap/connect/route.ts");

  assert.doesNotMatch(route, /from\("integrations"\)\.delete\(/);
  assert.match(route, /const storedPassword = !submittedPassword && existingPasswordEnc/);
  assert.match(route, /submittedPassword \|\| !existingPasswordEnc[\s\S]*\? encryptSecret\(password\)[\s\S]*: existingPasswordEnc/);
  assert.match(route, /\.update\(payload\)[\s\S]*\.eq\("id", String\(existing\["id"\]\)\)[\s\S]*\.eq\("user_id", userId\)/);
  assert.match(route, /delete cleanedSettings\["mailbox_feedback_scan_paused_until"\]/);
  assert.match(route, /withCurrentConnectionVersion\("mail:imap", \{[\s\S]*\.\.\.cleanedSettings/);
});

test("les boîtes conservées mais invalides proposent une reconnexion OAuth", () => {
  const status = read("app/api/integrations/status/route.ts");
  const ui = read("app/dashboard/settings/_components/MailsSettingsContent.tsx");
  const googleStart = read("app/api/integrations/google/start/route.ts");
  const microsoftStart = read("app/api/integrations/microsoft/start/route.ts");

  assert.match(status, /computedConnectionStatus === "disconnected"[\s\S]*\? "needs_update"/);
  assert.match(ui, /acc\.provider !== "imap" && acc\.connection_status === "needs_update"/);
  assert.match(ui, /reconnect_mailbox/);
  assert.match(ui, /loginHint: acc\.email_address/);
  for (const start of [googleStart, microsoftStart]) {
    assert.match(start, /searchParams\.get\("loginHint"\)/);
    assert.match(start, /login_hint/);
  }
});

test("les erreurs d'authentification marquent immédiatement la boîte à reconnecter", () => {
  const health = read("lib/mailAccountReconnect.ts");
  const gmail = read("app/api/inbox/gmail/send/route.ts");
  const microsoft = read("app/api/inbox/microsoft/send/route.ts");
  const imap = read("app/api/inbox/imap/send/route.ts");
  const campaigns = read("lib/inrsend/sendMailFromIntegration.ts");

  assert.match(health, /needs_reconnect: true/);
  assert.match(health, /needs_reconnect_reason: params\.reason/);
  assert.match(health, /\.eq\("id", params\.accountId\)[\s\S]*\.eq\("user_id", params\.userId\)/);
  assert.match(gmail, /mailbox_access_token_missing/);
  assert.match(microsoft, /mailbox_oauth_invalid/);
  assert.match(imap, /mailbox_authentication_failed/);
  assert.match(campaigns, /mailbox_access_token_missing/);
  assert.match(campaigns, /mailbox_oauth_invalid/);
  assert.match(campaigns, /mailbox_authentication_failed/);
});
