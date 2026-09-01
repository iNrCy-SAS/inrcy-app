import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");

function sourceFiles(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const relativePath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(relativePath)
        : /\.(?:ts|tsx)$/.test(entry.name)
          ? [relativePath]
          : [];
    },
  );
}

test("les reprises Booster transportent une référence compacte, jamais le média durable", () => {
  const route = read("app/api/booster/publish-now/route.ts");
  const cron = read("app/api/cron/booster-publications/route.ts");
  const dispatch = read("lib/boosterPreparationDispatch.ts");
  const preparationCron = cron.slice(
    cron.indexOf("async function dispatchPreparationJob"),
    cron.indexOf("async function dispatchChannelJob"),
  );

  assert.match(route, /buildBoosterPreparationDispatchReference\(\{/);
  assert.match(cron, /buildBoosterPreparationDispatchReference\(\{/);
  assert.doesNotMatch(preparationCron, /\.\.\.job\.preparationRequest/);
  assert.match(dispatch, /_asyncPreparationReference: true/);
  assert.match(dispatch, /\.eq\("id", params\.publicationId\)/);
  assert.match(dispatch, /\.eq\("user_id", params\.userId\)/);
  assert.match(dispatch, /preparationRequest/);
});

test("les URL Storage privées utilisent un GET borné à la place de HEAD", () => {
  const sanitizer = read("lib/storageUrlSanitization.ts");
  const googleProbe = read("lib/googleBusinessMediaProbe.ts");
  const route = read("app/api/booster/publish-now/route.ts");

  assert.match(sanitizer, /storage\/v1\/object\/sign/);
  assert.match(sanitizer, /api\/storage\/content/);
  assert.match(googleProbe, /const rangeGetOnly = shouldUseRangeGetForStorageDeliveryUrl/);
  assert.match(googleProbe, /if \(!rangeGetOnly\)/);
  assert.match(route, /method: rangeGet \? "GET" : "HEAD"/);
  assert.match(route, /Range: "bytes=0-0"/);
});

test("l'ancien parcours de démarrage n'existe plus dans le runtime", () => {
  const removed = [
    "app/dashboard/_hooks/useDashboardOnboardingState.ts",
    "app/api/dashboard/onboarding-state/route.ts",
    "lib/dashboardOnboardingServer.ts",
  ];

  removed.forEach((relativePath) => {
    assert.equal(existsSync(path.join(ROOT, relativePath)), false);
  });
});

test("toutes les créations de notifications passent par l'écriture atomique", () => {
  const writer = read("lib/notificationWriter.ts");
  const migration = read("ops/sql/2026-08-28_notification_insert_dedupe.sql");
  const offenders = [...sourceFiles("app"), ...sourceFiles("lib")].filter(
    (relativePath) =>
      relativePath !== path.join("lib", "notificationWriter.ts") &&
      /\.from\("notifications"\)[\s\S]{0,120}\.insert\(/.test(read(relativePath)),
  );

  assert.deepEqual(offenders, []);
  assert.match(writer, /rpc\(\s*"inrcy_insert_notification_once"/);
  assert.match(migration, /insert into public\.notifications/i);
  assert.match(migration, /on conflict do nothing/i);
  assert.match(migration, /grant execute[\s\S]*?to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*?to authenticated/i);
});
