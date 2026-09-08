import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isInrAgentMetaChannel } from "../../lib/inrAgentPublicationPlacement.ts";
import {
  INR_AGENT_CHANNELS,
  INR_AGENT_DEFAULT_SETTINGS,
  INR_AGENT_LABELS,
  INR_AGENT_X_PUBLISH_MIGRATION_FLAG,
  sanitizeInrAgentSettings,
} from "../../lib/inrAgentSettings.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const agentConfig = read("app/dashboard/agent/_lib/agent.config.ts");
const agentRuntime = read("app/dashboard/agent/_hooks/useAgentRuntimeData.ts");
const agentSchedule = read("app/dashboard/agent/_lib/agent.schedule.ts");
const agentClient = read("app/dashboard/agent/AgentClient.tsx");
const agentSettingsApi = read("app/api/agent/settings/route.ts");
const agentActionsApi = read("app/api/agent/actions/route.ts");
const agentPrepareApi = read("app/api/agent/actions/prepare-publish/route.ts");
const agentStyles = read("app/dashboard/agent/agent.module.css");

test("X is a first-class iNrAgent publication channel", () => {
  assert.ok(INR_AGENT_CHANNELS.includes("x"));
  assert.ok(
    INR_AGENT_DEFAULT_SETTINGS.automations.publish.allowedChannels.includes("x"),
  );
  assert.equal(INR_AGENT_LABELS.channels.x, "X");

  const sanitized = sanitizeInrAgentSettings({
    automations: {
      publish: {
        ...INR_AGENT_DEFAULT_SETTINGS.automations.publish,
        allowedChannels: ["facebook", "x"],
      },
    } as typeof INR_AGENT_DEFAULT_SETTINGS.automations,
  });
  assert.ok(sanitized.automations.publish.allowedChannels.includes("x"));
});

test("the Agent UI maps X aliases, icon and Booster channel consistently", () => {
  assert.match(agentConfig, /x:\s*\{\s*name:\s*"X",\s*src:\s*"\/icons\/x\.svg"/);
  assert.match(agentConfig, /twitter:\s*"x"/);
  assert.match(agentConfig, /twitter_x:\s*"x"/);
  assert.match(agentConfig, /x_twitter:\s*"x"/);
  assert.match(agentConfig, /x:\s*\["x",\s*"twitter",\s*"twitter_x",\s*"x_twitter"\]/);
  assert.match(agentConfig, /agentChannelToBoosterDisplay[\s\S]*?x:\s*"x"/);
  assert.match(agentConfig, /channelToApi[\s\S]*?x:\s*"x"/);
  assert.match(
    agentConfig,
    /channelOrder[\s\S]*?"pinterest",\s*"mails",\s*"x",\s*\]/,
  );
  assert.match(
    agentConfig,
    /availableChannels:\s*\[[\s\S]*?"pinterest",\s*"x",\s*\]/,
  );
});

test("iNrAgent keeps X URL-free without blocking the other publication channels", () => {
  assert.match(agentPrepareApi, /RÈGLE ABSOLUE POUR X[\s\S]*?aucun lien ni aucune URL/);
  assert.match(agentActionsApi, /channel === "x"[\s\S]*?validateXUrlFreeText/);
  assert.match(agentActionsApi, /code:\s*xUrlValidation\.code/);
  assert.match(agentClient, /agentXPostContainsForbiddenUrl/);
  assert.match(agentClient, /blockers\.push\(X_FORBIDDEN_URL_ERROR\)/);
  assert.match(agentClient, /publishTextDraftHasForbiddenXUrl/);
  assert.match(agentClient, /showNotice\(X_FORBIDDEN_URL_ERROR\)/);
  assert.match(
    agentClient,
    /publishSaveState === "saving" \|\|\s*publishTextDraftHasForbiddenXUrl/,
  );
});

test("the desktop iNrAgent channel rail hugs every bubble and both arrows", () => {
  assert.match(agentStyles, /@media \(min-width: 1251px\)[\s\S]*?max-content minmax\(165px, 0\.68fr\)/);
  assert.match(agentStyles, /channelScrollerWrapPublish[\s\S]*?width:\s*max-content/);
  assert.match(agentStyles, /channelScrollerWrapPublish[\s\S]*?max-width:\s*430px/);
  assert.match(agentStyles, /grid-template-columns:\s*28px max-content 28px/);
  assert.match(agentStyles, /channelScroller button[\s\S]*?flex:\s*0 0 28px/);
});

test("X connection state hydrates live and cached iNrAgent channel lists", () => {
  assert.match(agentRuntime, /x:\s*isUsable\("x"\)/);
  assert.match(agentRuntime, /"xConnected"/);
  assert.match(agentRuntime, /state\.xConnectionStatus\s*!==\s*"needs_update"/);
  assert.match(agentRuntime, /state\.xRequiresUpdate\s*!==\s*true/);
});

test("scheduled X publications retain a stable display name", () => {
  assert.match(agentSchedule, /x:\s*"x"/);
  assert.match(agentSchedule, /twitter:\s*"x"/);
  assert.match(agentSchedule, /twitter_x:\s*"x"/);
  assert.match(agentSchedule, /x_twitter:\s*"x"/);
});

test("X is hydrated once when connected and remains Classic-only", () => {
  assert.equal(INR_AGENT_X_PUBLISH_MIGRATION_FLAG, "xChannelAdded");
  assert.match(agentSettingsApi, /states\.x\.connected\s*&&\s*!states\.x\.requiresUpdate/);
  assert.match(
    agentSettingsApi,
    /metadata\[INR_AGENT_X_PUBLISH_MIGRATION_FLAG\]\s*===\s*true/,
  );
  assert.match(agentSettingsApi, /allowedChannels\s*=\s*\[\.\.\.allowedChannels,\s*"x"\]/);
  assert.equal(isInrAgentMetaChannel("x"), false);
  assert.doesNotMatch(agentClient, /activeMetaPublicationChannel\s*===\s*"x"/);
});

test("the iNrAgent media editor enforces X's four-image limit", () => {
  assert.match(agentClient, /getBoosterMaxImageCountForChannel\(publishBoosterChannel\)/);
  assert.match(agentClient, /publishImageCount\s*>=\s*publishImageMaxCount/);
});

test("iNrAgent accepts text-only X drafts without inventing a media requirement", () => {
  const foundations = read("app/api/agent/actions/actionPublishDraft.foundations.ts");
  assert.match(
    foundations,
    /publishCanRunWithoutMedia[\s\S]*?"facebook",\s*"linkedin",\s*"x"/,
  );
});
