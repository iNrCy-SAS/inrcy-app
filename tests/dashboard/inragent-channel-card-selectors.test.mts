import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyInrAgentPinterestBoardSelection,
  readInrAgentPinterestBoardSelection,
} from "../../lib/inrAgentPinterestBoard.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const client = read("app/dashboard/agent/AgentClient.tsx");
const actionApi = read("app/api/agent/actions/route.ts");
const executeApi = read("app/api/agent/actions/execute/route.ts");
const scheduleApi = read("app/api/agent/actions/schedule/route.ts");

test("the Channel card renders Meta and TikTok formats, pilot-gated Threads modes and the Pinterest board", () => {
  const cardStart = client.indexOf(
    '<span className={styles.publishChannelCardMain}>',
  );
  assert.ok(cardStart >= 0);
  const cardEnd = client.indexOf("</article>", cardStart);
  assert.ok(cardEnd > cardStart);
  const cardSource = client.slice(cardStart, cardEnd);

  assert.match(cardSource, /\{activeMetaPublicationChannel \? \(/);
  assert.match(
    cardSource,
    /\) : activePreviewChannel === "pinterest" \? \(/,
  );
  assert.match(cardSource, /savePublishPinterestBoard/);
  assert.match(cardSource, /saveTiktokPhotoFormat/);
  assert.match(cardSource, /media_photo_shared_format/);
  assert.match(cardSource, /media_photo_fullscreen_format/);
  assert.match(cardSource, /\) : activePreviewChannel === "threads" && metaPilotEnabled \? \(/);
  assert.match(cardSource, /value=\{activeThreadsPublicationMode\}/);
  assert.match(cardSource, /saveThreadsPublicationMode/);
  assert.match(cardSource, /getEnabledThreadsPublicationModes\(threadsPublicationPreferences\)/);
  assert.match(cardSource, /!threadsModeEnabled \? <option value="ghost" disabled>/);
  assert.match(cardSource, /\) : null\}/);
  assert.equal(
    cardSource.match(/className=\{styles\.publishPlacementSelect\}/g)?.length,
    4,
  );
  assert.doesNotMatch(cardSource, /publication_mode_classic_only/);
});

test("a Pinterest board selection is stored at both action and publish boundaries", () => {
  const original = { publishPayload: { channels: ["pinterest"] } };
  const updated = applyInrAgentPinterestBoardSelection(original, {
    boardId: "board-123",
    boardName: "Réalisations",
  });

  assert.deepEqual(readInrAgentPinterestBoardSelection(updated), {
    boardId: "board-123",
    boardName: "Réalisations",
  });
  assert.deepEqual(
    (updated.publishPayload as Record<string, unknown>)
      .pinterestPublicationSettings,
    { boardId: "board-123", boardName: "Réalisations" },
  );
});

test("Pinterest board updates remain functional for immediate and scheduled publication", () => {
  assert.match(actionApi, /editType === "publish_pinterest_board"/);
  assert.match(actionApi, /applyInrAgentPinterestBoardSelection/);
  for (const source of [executeApi, scheduleApi]) {
    assert.match(source, /readInrAgentPinterestBoardSelection/);
    assert.match(source, /pinterestPublicationSettings/);
  }
});
