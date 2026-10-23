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
  assert.match(modal, /checked=\{scheduleMode === "channel"\}/);
  assert.match(modal, /aria-controls=\{channelDetailsId\}/);
  assert.doesNotMatch(modal, /<input[^>]+aria-expanded=/);
  assert.match(modal, /scheduleMode === "channel" \? \(/);
  assert.match(modal, /id=\{channelDetailsId\}/);
  assert.match(modal, /immediateChannels/);
});

test("an existing shared schedule reopens in general mode, otherwise in channel mode", () => {
  assert.match(modal, /allPublishableSelected && oneSharedDateTime/);
  assert.match(modal, /initialDates\.length === publishableChannels\.length/);
  assert.match(modal, /\? "general"\s*:\s*"channel"/);
});

test("scheduling has its own opaque portal dialog instead of inheriting the Booster fullscreen workspace", () => {
  assert.match(modal, /return createPortal\(/);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.doesNotMatch(modal, /data-inrcy-tool-overlay|data-inrcy-tool-dialog|presentation === "step"/);
  const css = readFileSync(new URL("../../app/dashboard/_components/PublishScheduleModal.module.css", import.meta.url), "utf8");
  assert.match(css, /background: linear-gradient\(135deg, #101e31, #111326/);
  assert.match(css, /max-height: calc\(100dvh - 40px\)/);
  assert.match(css, /scrollbar-width: none/);
});
