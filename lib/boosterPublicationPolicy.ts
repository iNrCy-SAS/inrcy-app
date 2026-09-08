export const BOOSTER_PUBLICATION_CHANNELS = [
  "inrcy_site",
  "site_web",
  "inr_search",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
  "x",
] as const;

export type BoosterPublicationChannelKey =
  (typeof BOOSTER_PUBLICATION_CHANNELS)[number];

export const BOOSTER_PUBLICATION_CHANNEL_LABELS: Record<
  BoosterPublicationChannelKey,
  string
> = {
  inrcy_site: "Site iNrCy",
  site_web: "Site web",
  inr_search: "iNr'Search",
  gmb: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  youtube_shorts: "YouTube",
  pinterest: "Pinterest",
};

const BOOSTER_PUBLICATION_CHANNEL_SET = new Set<string>(
  BOOSTER_PUBLICATION_CHANNELS,
);

export const NON_RETRYABLE_BOOSTER_PUBLISH_CODES = new Set([
  "bubble_access_disabled",
  "unsupported_channel",
  "delivery_status_unknown",
  "provider_status_unknown",
  "video_duration_too_long",
  "video_duration_too_short",
  "video_duration_account_limit_unknown",
  "video_duration_long_upload_not_allowed",
  "video_payload_invalid",
  "video_required",
]);

export function isBoosterPublicationChannel(
  value: unknown,
): value is BoosterPublicationChannelKey {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return value === normalized && BOOSTER_PUBLICATION_CHANNEL_SET.has(normalized);
}

export function normalizeBoosterPublicationChannels(values: unknown): {
  channels: BoosterPublicationChannelKey[];
  invalidChannels: string[];
} {
  const rawValues = Array.isArray(values) ? values : [];
  const channels: BoosterPublicationChannelKey[] = [];
  const invalidChannels: string[] = [];
  const seenChannels = new Set<BoosterPublicationChannelKey>();
  const seenInvalid = new Set<string>();

  for (const rawValue of rawValues) {
    const normalized = typeof rawValue === "string" ? rawValue.trim() : "";
    if (isBoosterPublicationChannel(normalized)) {
      if (!seenChannels.has(normalized)) {
        seenChannels.add(normalized);
        channels.push(normalized);
      }
      continue;
    }

    const invalidLabel = normalized || String(rawValue ?? "").trim() || "(vide)";
    if (!seenInvalid.has(invalidLabel)) {
      seenInvalid.add(invalidLabel);
      invalidChannels.push(invalidLabel);
    }
  }

  return { channels, invalidChannels };
}

export function isBoosterPublishFailureRetryable(args: {
  ok: boolean;
  code?: unknown;
  retryable?: unknown;
}) {
  const code = String(args.code || "").trim();
  return (
    !args.ok &&
    args.retryable !== false &&
    !NON_RETRYABLE_BOOSTER_PUBLISH_CODES.has(code)
  );
}
