import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PROFILE_VERSION_FIELDS,
  getChangedProfileVersionFields,
  toProfileVersionsSnapshot,
} from "../../lib/profileVersioning.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const migration = read("ops/sql/2026-08-06_inrsend_realtime_version.sql");
const mailbox = read("app/dashboard/mails/_hooks/useMailboxHistory.ts");
const historyPreload = read("app/dashboard/mails/_lib/mailboxHistoryPreload.ts");
const boosterLayer = read("app/dashboard/_components/DashboardBoosterModalLayer.tsx");
const moduleSnapshotCache = read("lib/browserModuleSnapshotCache.ts");
const versionsRoute = read("app/api/profile/versions/route.ts");
const repairMigration = read("ops/sql/2026-08-06_inrsend_final_publication_refresh_repair.sql");
const historyRoute = read("app/api/inrsend/history/route.ts");
const list = read("app/dashboard/mails/_components/MailboxList.tsx");
const styles = read("app/dashboard/mails/mails.module.css");

test("inrsend_version appartient au pont realtime de profil", () => {
  assert.ok(PROFILE_VERSION_FIELDS.includes("inrsend_version"));
  const previous = toProfileVersionsSnapshot({ inrsend_version: 2 });
  const next = toProfileVersionsSnapshot({ inrsend_version: 3 });
  assert.equal(next.inrsend_version, 3);
  assert.deepEqual(getChangedProfileVersionFields(previous, next), [
    { field: "inrsend_version", previousValue: 2, value: 3 },
  ]);
});

test("iNrSend recharge son historique sur le compteur dédié et garde les signaux existants", () => {
  assert.match(mailbox, /detail\?\.field === "inrsend_version"/);
  assert.match(mailbox, /detail\?\.field === "docs_version"/);
  assert.match(mailbox, /detail\?\.field === "publications_version"/);
  assert.match(mailbox, /void loadHistory\(\{ silent: true, force: true \}\)/);
});

test("la migration couvre toutes les sources visibles de l'historique", () => {
  assert.match(migration, /add column if not exists inrsend_version bigint not null default 0/);
  assert.match(migration, /'inrsend_version'/);
  for (const trigger of [
    "trg_send_items_bump_inrsend_version",
    "trg_mail_campaigns_bump_inrsend_version",
    "trg_app_events_bump_inrsend_version",
    "trg_inr_agent_actions_bump_inrsend_version",
    "trg_inr_agent_scheduled_actions_bump_inrsend_version",
  ]) {
    assert.match(migration, new RegExp(trigger));
  }
});

test("les campagnes ignorent les heartbeats techniques mais gardent le suivi visible", () => {
  const campaignFunction = migration.match(
    /create or replace function public\.inrcy_bump_inrsend_for_mail_campaigns\(\)[\s\S]*?\n\$\$;/,
  )?.[0] || "";
  assert.match(campaignFunction, /'sent_count'/);
  assert.match(campaignFunction, /'progress_percent'/);
  assert.match(campaignFunction, /'last_error'/);
  assert.doesNotMatch(campaignFunction, /'updated_at'/);
  assert.doesNotMatch(campaignFunction, /'last_activity_at'/);
});

test("les publications finales rafraîchissent iNrSend sans réveiller les lignes techniques", () => {
  const visibilityFunction = migration.match(
    /create or replace function public\.inrcy_app_event_is_inrsend_visible\(p_row jsonb\)[\s\S]*?\n\$\$;/,
  )?.[0] || "";
  assert.match(visibilityFunction, /'publish_async_job'/);
  assert.match(visibilityFunction, /'publish_async_channel'/);
  assert.match(visibilityFunction, /'publish_idempotency_lock'/);
  assert.doesNotMatch(visibilityFunction, /'publish'\s*[,\]]/);
  assert.match(visibilityFunction, /array\['booster', 'propulser', 'fideliser'\]::text\[\]/);
  assert.match(repairMigration, /final `publish` rows/i);
  assert.match(repairMigration, /add column if not exists inrsend_version/);
  assert.match(repairMigration, /create or replace function public\.inrcy_bump_inrsend_version/);
  assert.match(repairMigration, /trg_app_events_bump_inrsend_version/);
});

test("le déploiement reste compatible si le SQL arrive juste après le code", () => {
  assert.match(versionsRoute, /includes\("inrsend_version"\)/);
  assert.match(versionsRoute, /field !== "inrsend_version"/);
  assert.match(versionsRoute, /toProfileVersionsSnapshot\(data \|\| \{\}\)/);
});


test("iNrSend garde un filet de sécurité visible même si le realtime SQL manque un signal", () => {
  assert.match(historyPreload, /MAILBOX_HISTORY_ACTIVE_REFRESH_MS = 10_000/);
  assert.match(historyPreload, /MAILBOX_HISTORY_IDLE_REFRESH_MS = 60_000/);
  assert.match(mailbox, /mailboxHistoryRefreshInterval/);
  assert.match(mailbox, /window\.setTimeout\([\s\S]*refreshVisibleHistory/);
  assert.match(mailbox, /document\.visibilityState === "hidden"/);
  assert.match(mailbox, /setHistoryCountsLoadedOnce\(true\)/);
  assert.match(historyRoute, /countsOnly/);
});

test("une publication invalide le snapshot iNrSend avant la navigation", () => {
  assert.match(moduleSnapshotCache, /export function invalidateModuleSnapshot/);
  assert.match(
    boosterLayer,
    /invalidateModuleSnapshot\(MODULE_SNAPSHOT_KEYS\.inrSendDefault\)/,
  );
  assert.match(mailbox, /force:\s*isInitialContextLoad/);
});

test("les origines programmées et iNrAgent sont marquées sans ambiguïté", () => {
  assert.match(list, /isInrAgentOrigin/);
  assert.match(list, /isScheduledOrigin/);
  assert.match(list, /scheduledOriginIcon/);
  assert.match(list, /inr-agent\.png/);
  assert.match(styles, /\.scheduledOriginIcon/);
});
