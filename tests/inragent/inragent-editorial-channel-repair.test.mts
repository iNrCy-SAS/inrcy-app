import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  missingPreparedInrAgentPublishChannels,
  resolveInrAgentEditorialRepairChannels,
} from "../../lib/inrAgentPublishChannels.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("editorial repair ignores configured channels unavailable during preparation", () => {
  const repairChannels = resolveInrAgentEditorialRepairChannels({
    plannedChannels: ["facebook", "pinterest"],
    preparedChannels: ["facebook"],
    targetChannels: ["facebook"],
  });

  assert.deepEqual(repairChannels, ["facebook"]);
  assert.deepEqual(
    missingPreparedInrAgentPublishChannels({
      plannedChannels: repairChannels,
      postByChannel: { facebook: { content: "Publication prête" } },
    }),
    [],
  );
});

test("editorial repair still detects a genuinely missing prepared channel", () => {
  const repairChannels = resolveInrAgentEditorialRepairChannels({
    plannedChannels: ["facebook", "youtube"],
    preparedChannels: null,
    targetChannels: ["facebook", "youtube_shorts"],
  });

  assert.deepEqual(repairChannels, ["facebook", "youtube_shorts"]);
  assert.deepEqual(
    missingPreparedInrAgentPublishChannels({
      plannedChannels: repairChannels,
      postByChannel: { facebook: { content: "Publication prête" } },
    }),
    ["youtube_shorts"],
  );
});

test("Pinterest requires OAuth and a default board for publication surfaces", () => {
  const channelState = read("lib/channelConnectionState.ts");
  const pinterestStatus = read("app/api/integrations/pinterest/status/route.ts");
  const editorialServer = read("lib/inrAgentEditorialPlanServer.ts");
  const preparation = read("app/api/agent/actions/prepare-publish/route.ts");

  assert.match(
    channelState,
    /pinterestAccountConnected\s*&&\s*pinterestDefaultBoardId/,
  );
  assert.match(
    channelState,
    /accountConnected:\s*pinterestAccountConnected,[\s\S]*?connected:\s*pinterestConnected/,
  );
  assert.match(
    pinterestStatus,
    /states\.pinterest\.accountConnected\s*&&\s*!states\.pinterest\.requiresUpdate/,
  );
  assert.match(editorialServer, /resolveInrAgentEditorialRepairChannels/);
  assert.match(preparation, /editorialPreparedChannels/);
  assert.match(preparation, /editorialSkippedChannels/);
});
