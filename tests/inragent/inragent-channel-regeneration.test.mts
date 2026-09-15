import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("iNrAgent regenerates only the requested channel content", () => {
  const route = read("app/api/agent/actions/regenerate-channel/route.ts");

  assert.match(route, /Régénère uniquement le titre et le texte de ce canal/);
  assert.match(route, /const nextPostByChannel = setChannelValue\(postByChannel, channel, regeneratedPost\)/);
  assert.match(route, /previewText: buildPublishPreviewTextFromPosts\(nextPostByChannel, action\.previewText\)/);
  assert.match(route, /editType: "regenerate_publish_channel_content"/);
});

test("media regeneration is atomic and keeps the one-video or two-image invariant", () => {
  const route = read("app/api/agent/actions/regenerate-channel/route.ts");

  assert.match(route, /const expectedCount = mediaKind === "video" \? 1 : 2/);
  assert.match(route, /for \(let index = 0; index < expectedCount; index \+= 1\)/);
  assert.match(route, /if \(generatedMedia\.length !== expectedCount\)/);
  assert.match(route, /Aucun média de la publication n’a été remplacé/);
  assert.match(route, /const nextImagesByChannel = setChannelValue\(imagesByChannel, channel, nextImages\)/);
  assert.match(route, /const nextVideoByChannel = setChannelValue\(videoByChannel, channel, nextVideo\)/);
  assert.match(route, /const nextMediaModeByChannel = setChannelValue\(mediaModeByChannel, channel, nextMode\)/);
  assert.match(route, /previewText: action\.previewText/);
  assert.match(route, /editType: "regenerate_publish_channel_media"/);
});

test("the review UI exposes independent content and media regeneration controls", () => {
  const ui = read("app/dashboard/agent/AgentClient.tsx");
  const styles = read("app/dashboard/agent/agent.module.css");

  assert.match(ui, /fetch\("\/api\/agent\/actions\/regenerate-channel"/);
  assert.match(ui, /requestPublishChannelRegeneration\("content"\)/);
  assert.match(ui, /requestPublishChannelRegeneration\("media"\)/);
  assert.match(ui, /regenerate_content/);
  assert.match(ui, /regenerate_media/);
  assert.match(ui, /agent_working_regenerating/);
  assert.match(styles, /\.publishRegenerateButton/);
  assert.match(styles, /\.robotWorkingBadge/);
});

test("scheduled and immediate execution preserve channel-specific regenerated videos", () => {
  const schedule = read("app/api/agent/actions/schedule/route.ts");
  const execute = read("app/api/agent/actions/execute/route.ts");

  assert.match(schedule, /publishPayload\.videoByChannel/);
  assert.match(schedule, /videoByChannel: filteredVideoByChannel/);
  assert.match(schedule, /const sourceVideoByChannel = asRecord/);
  assert.match(execute, /asRecord\(payload\.videoByChannel\)/);
  assert.match(execute, /selectedChannels\.length === 1 \? selectedChannels\[0\] : undefined/);
});
