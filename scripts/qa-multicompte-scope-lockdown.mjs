import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const errors = [];
const sourceExt = /\.(?:ts|tsx|js|jsx|mjs|mts)$/;

function read(file) {
  return readFileSync(file, "utf8");
}
function rel(file) {
  return relative(root, file).replaceAll("\\", "/");
}
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    const st = statSync(file);
    if (st.isDirectory()) out.push(...walk(file));
    else if (sourceExt.test(name)) out.push(file);
  }
  return out;
}
function chains(source) {
  const out = [];
  const re = /\.from\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = re.exec(source))) {
    let end = source.indexOf(";", match.index);
    if (end < 0 || end - match.index > 4000) end = Math.min(source.length, match.index + 4000);
    out.push({ table: match[1], start: match.index, text: source.slice(match.index, end + 1) });
  }
  return out;
}

const criticalTables = new Set([
  "integrations",
  "send_items",
  "mail_campaigns",
  "mail_campaign_recipients",
  "app_events",
  "publications",
  "publication_deliveries",
  "crm_contacts",
  "doc_saves",
  "agenda_events",
  "profiles",
  "business_profiles",
  "pro_tools_configs",
  "stats_cache",
  "inr_agent_actions",
  "inr_agent_scheduled_actions",
  "inr_agent_settings",
  "inr_agent_automation_settings",
  "notifications",
  "notification_preferences",
  "pro_media_library",
  "site_articles",
  "inrsend_history_files",
  "loyalty_balance",
  "loyalty_ledger",
  "execution_idempotency_locks",
]);

const runtimeFiles = [join(root, "app"), join(root, "lib")].flatMap(walk);
for (const file of runtimeFiles) {
  const source = read(file);
  const path = rel(file);

  // Aucun user_id métier ne doit être repris directement depuis un getUser() imbriqué.
  if (/\.eq\(\s*["']user_id["']\s*,\s*\(await\s+[^)]*auth\.getUser\(\)/s.test(source)) {
    errors.push(`${path}: user_id dérivé directement d'un getUser() imbriqué`);
  }

  // Les mutations interactives sur une table appartenant à un établissement doivent être
  // explicitement bornées au user_id actif. Les jobs globaux et webhooks sont contrôlés à part.
  const interactive =
    (path.startsWith("app/dashboard/") || path.startsWith("app/api/")) &&
    !path.includes("/admin/") &&
    !path.includes("/cron/") &&
    !path.includes("/public/") &&
    !path.includes("/webhook") &&
    !path.includes("/unsubscribe/");

  if (interactive) {
    for (const chain of chains(source)) {
      if (!criticalTables.has(chain.table)) continue;
      const mutation = /\.(?:update|delete)\s*\(/.test(chain.text);
      if (!mutation) continue;
      if (/\.eq\(\s*["']user_id["']/.test(chain.text)) continue;
      const line = source.slice(0, chain.start).split("\n").length;
      errors.push(`${path}:${line}: mutation ${chain.table} non bornée par user_id`);
    }
  }
}

const mailbox = read(join(root, "app/dashboard/mails/MailboxClient.tsx"));
for (const required of [
  '.update(draftPayload as any)\n        .eq("id", draftId)\n        .eq("user_id", userId)',
  '.update(legacyPayload)\n          .eq("id", draftId)\n          .eq("user_id", userId)',
  '.select("email,display_name,contact_id")\n        .eq("user_id", userId)\n        .eq("campaign_id", campaignId)',
]) {
  if (!mailbox.includes(required)) errors.push(`MailboxClient.tsx: verrou de scope manquant: ${required.split("\n")[0]}`);
}
if (/\.eq\("user_id", \(await supabase\.auth\.getUser\(\)\)\.data\?\.user\?\.id/.test(mailbox)) {
  errors.push("MailboxClient.tsx: suppression de brouillon encore liée à l'UID AUTH");
}

const dailyRoute = read(join(root, "app/api/stats/daily-refresh/route.ts"));
for (const rpc of ["claim_daily_stats_refresh", "complete_daily_stats_refresh", "release_daily_stats_refresh_claim"]) {
  const idx = dailyRoute.indexOf(`rpc(\"${rpc}\"`);
  if (idx < 0) {
    errors.push(`daily-refresh: RPC ${rpc} introuvable`);
    continue;
  }
  const window = dailyRoute.slice(idx, idx + 500);
  if (!/p_user_id\s*:\s*activeUserId/.test(window)) errors.push(`daily-refresh: ${rpc} sans p_user_id actif`);
}

const loyaltyAwardRoute = read(join(root, "app/api/loyalty/award/route.ts"));
if (/rpc\(\s*["']award_inertia_action["']/.test(loyaltyAwardRoute)) {
  errors.push("loyalty award: ancienne RPC award_inertia_action encore utilisee sans UID actif explicite");
}
if (!loyaltyAwardRoute.includes("resolveActiveInrcyAccountId") || !loyaltyAwardRoute.includes("awardInertiaActionForUser")) {
  errors.push("loyalty award: attribution non centralisee sur l'etablissement actif");
}

const dashboardClient = read(join(root, "app/dashboard/DashboardClient.tsx"));
if (!dashboardClient.includes('fetch("/api/multicompte/accounts"')) {
  errors.push("DashboardClient.tsx: bootstrap du scope actif sans API multicompte serveur");
}
for (const forbidden of ["setActiveBrowserUserId(user.id)", "setActiveBrowserUserId(nextUserId)"]) {
  if (dashboardClient.includes(forbidden)) {
    errors.push(`DashboardClient.tsx: fallback direct AUTH UID interdit: ${forbidden}`);
  }
}
if (!dashboardClient.includes("const generatorPowerReady = siteConnectionsReady && profileCheckReady && activityCheckReady")) {
  errors.push("DashboardClient.tsx: barre generateur non protegee contre les checks partiels au refresh");
}

const establishmentMenu = read(join(root, "app/dashboard/_components/EstablishmentMenu.tsx"));
if (establishmentMenu.includes("AXA Oignies")) {
  errors.push("EstablishmentMenu.tsx: placeholder client reel encore present");
}
if (!establishmentMenu.includes('placeholder={`${copy.establishment} ${slot}`}')) {
  errors.push("EstablishmentMenu.tsx: placeholder de creation non generique/dynamique");
}

const bubbleEnsureRoute = read(join(root, "app/api/bubble-access/ensure/route.ts"));
const bubbleAccessPolicy = read(join(root, "lib/bubbleAccess.ts"));
const alwaysEnabledStart = bubbleAccessPolicy.indexOf(
  "export const APP_BUBBLE_ALWAYS_ENABLED_KEYS",
);
const alwaysEnabledEnd =
  alwaysEnabledStart >= 0
    ? bubbleAccessPolicy.indexOf("];", alwaysEnabledStart)
    : -1;
const alwaysEnabledBlock =
  alwaysEnabledStart >= 0 && alwaysEnabledEnd > alwaysEnabledStart
    ? bubbleAccessPolicy.slice(alwaysEnabledStart, alwaysEnabledEnd + 2)
    : "";
if (
  !bubbleEnsureRoute.includes("APP_BUBBLE_ALWAYS_ENABLED_KEYS") ||
  !bubbleEnsureRoute.includes("rowsToForceEnabled") ||
  !alwaysEnabledBlock.includes('"inr_agent"')
) {
  errors.push("bubble-access ensure: iNr'Agent absent de la politique toujours active");
}

const lockdownSql = read(join(root, "ops/sql/2026-07-05_multicompte_step6_1_scope_lockdown.sql"));
for (const signature of [
  "claim_daily_stats_refresh(date, integer)",
  "complete_daily_stats_refresh(date)",
  "release_daily_stats_refresh_claim(date)",
]) {
  if (!lockdownSql.includes(`drop function if exists public.${signature}`)) {
    errors.push(`SQL 6.1: ancienne signature ${signature} non supprimée`);
  }
}
if (!lockdownSql.includes("public.inrcy_can_access_account(p_user_id)")) {
  errors.push("SQL 6.1: RPC stats sans vérification d'accès établissement");
}
if (/v_user_id\s+uuid\s*:=\s*auth\.uid\(\)/i.test(lockdownSql)) {
  errors.push("SQL 6.1: une RPC stats déduit encore user_id de auth.uid()");
}

if (errors.length) {
  console.error("QA multicompte scope-lockdown: ECHEC");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("QA multicompte scope-lockdown: OK");
