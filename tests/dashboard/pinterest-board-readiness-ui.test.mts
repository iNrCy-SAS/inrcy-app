import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "app/dashboard/settings/_components/PinterestSettingsContent.tsx",
  "utf8",
);
const boosterSelector = readFileSync(
  "app/dashboard/booster/publier/components/PublishChannelSelector.tsx",
  "utf8",
);
const boosterModal = readFileSync(
  "app/dashboard/booster/publier/PublishModal.tsx",
  "utf8",
);
const boosterChannelsRoute = readFileSync(
  "app/api/booster/connected-channels/route.ts",
  "utf8",
);
const agentClient = readFileSync(
  "app/dashboard/agent/AgentClient.tsx",
  "utf8",
);
const agentSettings = readFileSync(
  "app/dashboard/agent/_lib/agent.settings.ts",
  "utf8",
);
const agentRuntime = readFileSync(
  "app/dashboard/agent/_hooks/useAgentRuntimeData.ts",
  "utf8",
);

test("le compte Pinterest et son tableau prêt ont deux états distincts", () => {
  assert.match(
    source,
    /function isPinterestBoardReady[\s\S]*?settings\.accountConnected[\s\S]*?settings\.defaultBoardId[\s\S]*?settings\.boards\.some/,
  );
  assert.match(
    source,
    /connected: isPinterestBoardReady\(settings\),[\s\S]*?accountConnected: settings\.accountConnected/,
  );
});

test("le bloc Tableaux n'est prêt qu'avec un tableau par défaut existant", () => {
  assert.match(source, /connected=\{pinterestBoardReady\}/);
  assert.match(source, /pinterestBoardReady[\s\S]*?"Prêt"/);
  assert.match(source, /boardOptions\.length > 0[\s\S]*?"À sélectionner"[\s\S]*?"À créer"/);
});

test("Pinterest reste absent de Booster tant qu'aucun tableau n'est prêt", () => {
  assert.match(
    boosterSelector,
    /const visibleChannelKeys = channelKeys\.filter\([\s\S]*?key !== "pinterest" \|\| connected\.pinterest/,
  );
  assert.match(boosterSelector, /visibleChannelKeys\.map\(/);
  assert.match(
    boosterModal,
    /youtube_shorts:[\s\S]*?pinterest: false/,
  );
  assert.match(
    boosterChannelsRoute,
    /pinterest:[\s\S]*?isOfficialPublicationChannelConnected\(states\.pinterest\)[\s\S]*?Boolean\(states\.pinterest\.default_board_id\)/,
  );
});

test("Pinterest reste absent de iNrAgent sans état frais confirmant un tableau", () => {
  assert.match(
    agentSettings,
    /if \(!connectedChannels\)[\s\S]*?channel !== "pinterest"/,
  );
  assert.match(
    agentClient,
    /settingsDisplayedChannels[\s\S]*?channel !== "pinterest" \|\|[\s\S]*?settingsAvailableChannels\.includes\("pinterest"\)/,
  );
  assert.match(agentRuntime, /pinterest: false/);
  assert.match(agentRuntime, /connectedChannels\.pinterest = false/);
  assert.match(
    agentRuntime,
    /isUsable\("pinterest"\)[\s\S]*?default_board_id/,
  );
});
