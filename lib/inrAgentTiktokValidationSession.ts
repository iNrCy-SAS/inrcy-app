import { validateVideoDurationForChannel } from "./videoPublicationPolicy.ts";

export type InrAgentTiktokPublicationSettings = {
  privacyLevel: string;
  allowComments: boolean;
  allowDuo: boolean;
  allowStitch: boolean;
  commercialContent: "none" | "self" | "branded" | "both";
  aiContent: boolean;
  photoAutoMusic: boolean;
  musicUsageConfirmed: boolean;
};

export type InrAgentTiktokCreatorInfo = {
  accountKey: string;
  username: string;
  displayName: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoDurationSeconds: number | null;
};

export type InrAgentTiktokValidationSession = {
  settings: InrAgentTiktokPublicationSettings;
  accountKey: string;
  capabilitiesKey: string;
  createdAt: number;
  expiresAt: number;
};

export const INR_AGENT_TIKTOK_SESSION_TTL_MS = 30 * 60 * 1000;

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizedAccountKey(creatorInfo: InrAgentTiktokCreatorInfo) {
  return cleanText(
    creatorInfo.accountKey ||
      creatorInfo.username ||
      creatorInfo.displayName,
  ).toLocaleLowerCase("en");
}

function normalizedDuration(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function inrAgentTiktokCapabilitiesKey(
  creatorInfo: InrAgentTiktokCreatorInfo,
) {
  return JSON.stringify({
    privacyLevelOptions: Array.from(
      new Set(
        creatorInfo.privacyLevelOptions
          .map((option) => cleanText(option))
          .filter(Boolean),
      ),
    ).sort(),
    commentDisabled: creatorInfo.commentDisabled === true,
    duetDisabled: creatorInfo.duetDisabled === true,
    stitchDisabled: creatorInfo.stitchDisabled === true,
    maxVideoDurationSeconds: normalizedDuration(
      creatorInfo.maxVideoDurationSeconds,
    ),
  });
}

export function createInrAgentTiktokValidationSession(args: {
  settings: InrAgentTiktokPublicationSettings;
  creatorInfo: InrAgentTiktokCreatorInfo;
  now?: number;
}) {
  const now = Number.isFinite(args.now) ? Number(args.now) : Date.now();
  return {
    settings: { ...args.settings },
    accountKey: normalizedAccountKey(args.creatorInfo),
    capabilitiesKey: inrAgentTiktokCapabilitiesKey(args.creatorInfo),
    createdAt: now,
    expiresAt: now + INR_AGENT_TIKTOK_SESSION_TTL_MS,
  } satisfies InrAgentTiktokValidationSession;
}

export function resolveReusableInrAgentTiktokSettings(args: {
  session: InrAgentTiktokValidationSession | null;
  creatorInfo: InrAgentTiktokCreatorInfo;
  mediaType: "video" | "images";
  videoDurationSeconds?: number | null;
  now?: number;
}): InrAgentTiktokPublicationSettings | null {
  const { session, creatorInfo, mediaType } = args;
  if (!session) return null;

  const now = Number.isFinite(args.now) ? Number(args.now) : Date.now();
  if (now >= session.expiresAt) return null;
  if (!session.settings.musicUsageConfirmed) return null;
  if (!session.accountKey) return null;
  if (session.accountKey !== normalizedAccountKey(creatorInfo)) return null;
  if (
    session.capabilitiesKey !== inrAgentTiktokCapabilitiesKey(creatorInfo)
  ) {
    return null;
  }

  if (
    !creatorInfo.privacyLevelOptions.includes(session.settings.privacyLevel)
  ) {
    return null;
  }
  if (creatorInfo.commentDisabled && session.settings.allowComments) {
    return null;
  }
  if (
    mediaType === "video" &&
    ((creatorInfo.duetDisabled && session.settings.allowDuo) ||
      (creatorInfo.stitchDisabled && session.settings.allowStitch))
  ) {
    return null;
  }

  if (mediaType === "video") {
    const durationValidation = validateVideoDurationForChannel({
      channel: "tiktok",
      durationSeconds: args.videoDurationSeconds ?? null,
      tiktokMaxDurationSeconds: creatorInfo.maxVideoDurationSeconds,
      enforceAccountCapabilities: true,
    });
    if (!durationValidation.ok) return null;
  }

  return {
    ...session.settings,
    allowDuo: mediaType === "video" ? session.settings.allowDuo : false,
    allowStitch:
      mediaType === "video" ? session.settings.allowStitch : false,
    photoAutoMusic:
      mediaType === "images" ? session.settings.photoAutoMusic : false,
  };
}
