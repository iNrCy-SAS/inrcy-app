import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modal = readFileSync(
  new URL("../../app/dashboard/_components/PublishScheduleModal.tsx", import.meta.url),
  "utf8",
);

test("general scheduling is the default and applies one slot to every ready channel", () => {
  assert.match(modal, /useState<PublishScheduleMode>\("general"\)/);
  assert.match(modal, /i18nT\("schedule_general_title"\)/);
  assert.match(modal, /publishableItems\.map\(\(item\) => \(\{/);
  assert.match(modal, /generalDate \|\| defaultDateTime\.date/);
  assert.match(modal, /generalTime \|\| defaultDateTime\.time/);
  assert.match(modal, /scheduleMode === "general"\s*\? \[\]/);
});

test("per-channel scheduling stays collapsed until explicitly selected", () => {
  assert.match(modal, /i18nT\("schedule_per_channel_title"\)/);
  assert.match(modal, /aria-expanded=\{scheduleMode === "channel"\}/);
  assert.match(modal, /scheduleMode === "channel" \? \(/);
  assert.match(modal, /id="publish-schedule-channel-details"/);
  assert.match(modal, /immediateChannels/);
});

test("an existing shared schedule reopens in general mode, otherwise in channel mode", () => {
  assert.match(modal, /allPublishableSelected && oneSharedDateTime/);
  assert.match(modal, /initialDates\.length === publishableChannels\.length/);
  assert.match(modal, /\? "general"\s*:\s*"channel"/);
});
