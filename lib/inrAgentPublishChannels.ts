import type { BoosterChannels } from "@/lib/boosterPrompt";
import type { InrAgentChannel } from "@/lib/inrAgentSettings";

export const INR_AGENT_TO_BOOSTER_PUBLISH_CHANNEL: Partial<
  Record<InrAgentChannel, BoosterChannels>
> = {
  site_inrcy: "inrcy_site",
  site_web: "site_web",
  inr_search: "inr_search",
  gmb: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube_shorts",
  pinterest: "pinterest",
  x: "x",
};

export function inrAgentChannelToBoosterPublishChannel(
  channel: InrAgentChannel,
): BoosterChannels | null {
  return INR_AGENT_TO_BOOSTER_PUBLISH_CHANNEL[channel] || null;
}

export function normalizeBoosterPublishChannel(
  value: unknown,
): BoosterChannels | null {
  const channel = String(value || "").trim() as InrAgentChannel | BoosterChannels;
  return (
    INR_AGENT_TO_BOOSTER_PUBLISH_CHANNEL[channel as InrAgentChannel] ||
    (Object.values(INR_AGENT_TO_BOOSTER_PUBLISH_CHANNEL).includes(
      channel as BoosterChannels,
    )
      ? (channel as BoosterChannels)
      : null)
  );
}

function normalizeBoosterPublishChannels(values: readonly unknown[] | null | undefined) {
  return Array.from(
    new Set(
      (values || [])
        .map(normalizeBoosterPublishChannel)
        .filter((channel): channel is BoosterChannels => Boolean(channel)),
    ),
  );
}

/**
 * Once an editorial slot has been generated, only the channels that were
 * actually publishable during that preparation may trigger a repair. A stale
 * configured channel (for example Pinterest without a default board) must not
 * erase a valid publication and enqueue it again on every cron pass.
 */
export function resolveInrAgentEditorialRepairChannels(args: {
  plannedChannels: readonly unknown[];
  preparedChannels?: readonly unknown[] | null;
  targetChannels?: readonly unknown[] | null;
}) {
  const prepared = normalizeBoosterPublishChannels(args.preparedChannels);
  if (prepared.length) return prepared;

  const targets = normalizeBoosterPublishChannels(args.targetChannels);
  if (targets.length) return targets;

  return normalizeBoosterPublishChannels(args.plannedChannels);
}

export function missingPreparedInrAgentPublishChannels<T>(args: {
  plannedChannels: readonly T[];
  postByChannel: unknown;
}) {
  const posts =
    args.postByChannel &&
    typeof args.postByChannel === "object" &&
    !Array.isArray(args.postByChannel)
      ? (args.postByChannel as Record<string, unknown>)
      : {};
  const preparedChannels = new Set(
    Object.keys(posts)
      .map(normalizeBoosterPublishChannel)
      .filter((channel): channel is BoosterChannels => Boolean(channel)),
  );

  return args.plannedChannels.filter((channel) => {
    const boosterChannel = normalizeBoosterPublishChannel(channel);
    return Boolean(boosterChannel && !preparedChannels.has(boosterChannel));
  });
}
