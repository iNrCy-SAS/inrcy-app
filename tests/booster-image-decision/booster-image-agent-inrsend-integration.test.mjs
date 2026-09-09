import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("iNrAgent immediate and scheduled publications use the shared intelligent image matrix", async () => {
  const [execute, schedule, helper] = await Promise.all([
    read("app/api/agent/actions/execute/route.ts"),
    read("app/api/agent/actions/schedule/route.ts"),
    read("lib/boosterImageServerPreparation.ts"),
  ]);

  for (const source of [execute, schedule]) {
    assert.match(source, /prepareBoosterImagesByChannelOnServer/);
    assert.match(source, /imagesByChannel: preparedImages\.imagesByChannel/);
    assert.match(source, /imageSettingsByChannel: preparedImages\.imageSettingsByChannel/);
  }
  assert.match(helper, /getBoosterImageDecision/);
  assert.match(helper, /getBoosterImageSequenceTargetRatio/);
  assert.match(helper, /canUseAutomaticCover/);
  assert.match(helper, /"booster_intelligent_matrix_v1"/);
  assert.match(helper, /"booster_workspace_exact_settings_v1"/);
});

test("iNrSend edit restarts from the preserved original without cumulative crop", async () => {
  const [client, publishRoute, publishFoundations, details] = await Promise.all([
    read("app/dashboard/mails/MailboxClient.tsx"),
    read("app/api/booster/publish-now/route.ts"),
    read("app/api/booster/publish-now/publishNow.foundations.ts"),
    read("app/dashboard/mails/_components/MailboxDetailsModal.tsx"),
  ]);

  assert.match(client, /const initialTransform = originalUrl\s*\? \{ \.\.\.defaultTransform \}/);
  assert.match(publishRoute, /originalSourceUrlByKey/);
  assert.match(publishFoundations, /mappedOriginalUrl/);
  assert.match(details, /\? "Originale"\s*:\s*"Personnalisée"/);
});

test("iNrAgent scheduled publication keeps Pinterest image parity and includes video pins", async () => {
  const schedule = await read("app/api/agent/actions/schedule/route.ts");
  assert.match(schedule, /\| "pinterest"\s*\| "x";/);
  assert.match(schedule, /pinterest: "pinterest"/);
  assert.match(schedule, /activeMediaMode === "video"\) return true/);
  assert.doesNotMatch(schedule, /channel !== "pinterest"/);
});
