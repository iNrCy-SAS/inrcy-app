import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const agentClient = read("app/dashboard/agent/AgentClient.tsx");
const actionExecution = read(
  "app/dashboard/agent/_hooks/useAgentActionExecution.ts",
);
const executeRoute = read("app/api/agent/actions/execute/route.ts");
const scheduleRoute = read("app/api/agent/actions/schedule/route.ts");

test("iNrAgent asks once, then reuses verified TikTok settings for immediate publications", () => {
  assert.match(agentClient, /<TiktokPublicationSettingsModal/);
  assert.match(
    agentClient,
    /selectedPublicationUsesTiktok[\s\S]*?resolveAgentTiktokSessionSettings\(\)[\s\S]*?openAgentTiktokSettings\(\{ kind: "run_now" \}\)/,
  );
  assert.match(
    agentClient,
    /allowSessionReuse[\s\S]*?validateAgentTiktokSettings\(settings, meta\)/,
  );
  assert.match(
    agentClient,
    /createInrAgentTiktokValidationSession\(\{[\s\S]*?creatorInfo: meta\.creatorInfo/,
  );
  assert.match(
    agentClient,
    /updateActionStatus\("validated", \{[\s\S]*?tiktokPublicationSettings: settings/,
  );
  assert.match(
    actionExecution,
    /options\.tiktokPublicationSettings[\s\S]*?tiktokPublicationSettings: options\.tiktokPublicationSettings/,
  );
});

test("iNrAgent rechecks reusable TikTok settings before creating a scheduled publication", () => {
  assert.match(
    agentClient,
    /selections\.some\(\(selection\) => selection\.channel === "tiktok"\)[\s\S]*?resolveAgentTiktokSessionSettings\(\)[\s\S]*?openAgentTiktokSettings\(\{[\s\S]*?kind: "schedule"/,
  );
  assert.match(
    agentClient,
    /scheduleSelections: selections[\s\S]*?tiktokPublicationSettings/,
  );
  assert.match(
    scheduleRoute,
    /publishPayload: \{[\s\S]*?tiktokPublicationSettings/,
  );
  assert.match(
    scheduleRoute,
    /requestedSelections\.some\([\s\S]*?selection\.channel === "tiktok"[\s\S]*?INR_AGENT_TIKTOK_SETTINGS_REQUIRED/,
  );
});

test("the server rejects every iNrAgent TikTok execution without explicit consent", () => {
  assert.match(
    executeRoute,
    /selectedChannels\.includes\("tiktok"\)[\s\S]*?normalizeTiktokPublicationSettings/,
  );
  assert.match(executeRoute, /INR_AGENT_TIKTOK_SETTINGS_REQUIRED/);
  assert.match(
    executeRoute,
    /publishBody = \{[\s\S]*?tiktokPublicationSettings/,
  );
});
