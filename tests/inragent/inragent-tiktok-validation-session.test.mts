import assert from "node:assert/strict";
import test from "node:test";

import {
  INR_AGENT_TIKTOK_SESSION_TTL_MS,
  createInrAgentTiktokValidationSession,
  resolveReusableInrAgentTiktokSettings,
  type InrAgentTiktokCreatorInfo,
  type InrAgentTiktokPublicationSettings,
} from "../../lib/inrAgentTiktokValidationSession.ts";

const creatorInfo: InrAgentTiktokCreatorInfo = {
  accountKey: "creator-123",
  username: "@inrcy",
  displayName: "iNrCy",
  privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: false,
  stitchDisabled: false,
  maxVideoDurationSeconds: 180,
};

const settings: InrAgentTiktokPublicationSettings = {
  privacyLevel: "PUBLIC_TO_EVERYONE",
  allowComments: true,
  allowDuo: true,
  allowStitch: true,
  commercialContent: "self",
  aiContent: true,
  photoAutoMusic: true,
  musicUsageConfirmed: true,
};

test("réutilise les réglages TikTok pendant une série de validations", () => {
  const session = createInrAgentTiktokValidationSession({
    settings,
    creatorInfo,
    now: 1_000,
  });

  assert.deepEqual(
    resolveReusableInrAgentTiktokSettings({
      session,
      creatorInfo,
      mediaType: "video",
      videoDurationSeconds: 24,
      now: 2_000,
    }),
    { ...settings, photoAutoMusic: false },
  );
});

test("adapte sans risque les interactions quand la publication suivante est une photo", () => {
  const session = createInrAgentTiktokValidationSession({
    settings,
    creatorInfo,
    now: 1_000,
  });

  const reused = resolveReusableInrAgentTiktokSettings({
    session,
    creatorInfo,
    mediaType: "images",
    now: 2_000,
  });

  assert.equal(reused?.allowDuo, false);
  assert.equal(reused?.allowStitch, false);
  assert.equal(reused?.photoAutoMusic, true);
});

test("redemande la modale si le compte, les capacités ou la session changent", () => {
  const session = createInrAgentTiktokValidationSession({
    settings,
    creatorInfo,
    now: 1_000,
  });

  assert.equal(
    resolveReusableInrAgentTiktokSettings({
      session,
      creatorInfo: { ...creatorInfo, accountKey: "creator-456" },
      mediaType: "images",
      now: 2_000,
    }),
    null,
  );
  assert.equal(
    resolveReusableInrAgentTiktokSettings({
      session,
      creatorInfo: { ...creatorInfo, commentDisabled: true },
      mediaType: "images",
      now: 2_000,
    }),
    null,
  );
  assert.equal(
    resolveReusableInrAgentTiktokSettings({
      session,
      creatorInfo,
      mediaType: "images",
      now: 1_000 + INR_AGENT_TIKTOK_SESSION_TTL_MS,
    }),
    null,
  );
});

test("redemande la modale si la vidéo dépasse la capacité TikTok", () => {
  const session = createInrAgentTiktokValidationSession({
    settings,
    creatorInfo,
    now: 1_000,
  });

  assert.equal(
    resolveReusableInrAgentTiktokSettings({
      session,
      creatorInfo,
      mediaType: "video",
      videoDurationSeconds: 240,
      now: 2_000,
    }),
    null,
  );
});
