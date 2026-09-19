import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8");

const client = read("app/dashboard/agent/AgentClient.tsx");
const api = read("app/api/agent/actions/route.ts");
const scheduleHelpers = read("app/dashboard/agent/_lib/agent.schedule.ts");

test("media and content editors expose an explicit apply-everywhere choice", () => {
  assert.match(client, /i18nT\("apply_media_everywhere"\)/);
  assert.match(client, /applyCurrentPublishMediaEverywhere/);
  assert.match(client, /savePublishMediaPatch\(currentPublishMediaRecord, "replace", \{[\s\S]*?applyToAllChannels: true/);
  assert.match(client, /i18nT\("apply_content_everywhere"\)/);
  assert.match(client, /savePublishText\(\{ applyToAllChannels: true \}\)/);
  assert.match(client, /applyToAllChannels: options\.applyToAllChannels === true/);

  const fr = JSON.parse(read("messages/fr-FR/agent.json")) as Record<string, string>;
  assert.equal(fr.apply_media_everywhere, "Appliquer ce média partout");
  assert.equal(fr.apply_content_everywhere, "Appliquer ce contenu partout");
});

test("the API keeps local editing by default and expands only on explicit request", () => {
  const textBranch = api.slice(
    api.indexOf('if (editType === "publish_channel_text")'),
    api.indexOf('if (editType === "publish_channel_media")'),
  );
  const mediaBranch = api.slice(api.indexOf('if (editType === "publish_channel_media")'));

  for (const branch of [textBranch, mediaBranch]) {
    assert.match(branch, /const applyToAllChannels = requestBody\?\.applyToAllChannels === true/);
    assert.match(
      branch,
      /const targetChannels = applyToAllChannels[\s\S]*?: \[channel\]/,
    );
    assert.match(branch, /scope: applyToAllChannels \? "publication" : "channel"/);
  }
  assert.match(textBranch, /for \(const targetChannel of targetChannels\)/);
  assert.match(mediaBranch, /for \(const targetChannel of targetChannels\)/);
  assert.match(mediaBranch, /YouTube exige une vidéo/);
});

test("scheduled edits support the same explicit publication scope", () => {
  assert.match(
    scheduleHelpers,
    /updateScheduledEditPublishMedia\([\s\S]*?applyToChannels: ChannelKey\[\] = \[\]/,
  );
  assert.match(
    scheduleHelpers,
    /updateScheduledEditPublishText\([\s\S]*?applyToChannels: ChannelKey\[\] = \[\]/,
  );
  assert.match(scheduleHelpers, /const targetChannels = Array\.from\(new Set\(applyToChannels\)\)/);
  assert.match(scheduleHelpers, /payload:\s*compactInrAgentScheduledPayload\(\{/);
});

test("all supported locales contain the new editor labels", () => {
  for (const locale of [
    "fr-FR",
    "en-GB",
    "de-DE",
    "es-ES",
    "it-IT",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ]) {
    const messages = JSON.parse(read(`messages/${locale}/agent.json`)) as Record<string, string>;
    for (const key of [
      "apply_media_everywhere",
      "apply_media_everywhere_help",
      "publish_media_applied_everywhere",
      "apply_content_everywhere",
      "apply_content_everywhere_help",
      "publish_content_applied_everywhere",
    ]) {
      assert.ok(messages[key]?.trim(), `${locale}.${key}`);
    }
  }
});
