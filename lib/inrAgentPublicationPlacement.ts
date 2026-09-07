import type { FacebookPublicationPlacement } from "@/lib/facebookPublicationPreferences";
import type { InstagramPublicationPlacement } from "@/lib/instagramPublicationPreferences";

export type InrAgentMetaChannel = "facebook" | "instagram";
export type InrAgentPublicationPlacement =
  | FacebookPublicationPlacement
  | InstagramPublicationPlacement;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function isInrAgentMetaChannel(
  value: unknown,
): value is InrAgentMetaChannel {
  return value === "facebook" || value === "instagram";
}

export function normalizeInrAgentPublicationPlacement(
  value: unknown,
): InrAgentPublicationPlacement {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "reel" || normalized === "reels") return "reel";
  if (normalized === "story" || normalized === "stories") return "story";
  return "classic";
}

export function inrAgentPublicationSettingsKey(
  channel: InrAgentMetaChannel,
) {
  return channel === "instagram"
    ? "instagramPublicationSettings"
    : "facebookPublicationSettings";
}

export function inrAgentPublicationPlacementKey(
  channel: InrAgentMetaChannel,
) {
  return channel === "instagram"
    ? "instagramPublicationPlacement"
    : "facebookPublicationPlacement";
}

/**
 * Reads both the current publish-now contract and the former UI alias.
 * Missing settings deliberately mean Classic: iNr'Agent never opts a pro into
 * Reel/Story automatically.
 */
export function readInrAgentPublicationPlacement(
  payload: unknown,
  channel: InrAgentMetaChannel,
): InrAgentPublicationPlacement {
  const root = asRecord(payload);
  const publishPayload = asRecord(root.publishPayload);
  const settingsKey = inrAgentPublicationSettingsKey(channel);
  const placementKey = inrAgentPublicationPlacementKey(channel);
  const directSettings = asRecord(root[settingsKey]);
  const nestedSettings = asRecord(publishPayload[settingsKey]);
  return normalizeInrAgentPublicationPlacement(
    directSettings.placement ??
      nestedSettings.placement ??
      root[placementKey] ??
      publishPayload[placementKey],
  );
}

/**
 * Stores the choice at both action and publishPayload boundaries. Classic is
 * represented by the absence of special settings, which keeps old actions and
 * the Booster publish-now normalizers backward compatible.
 */
export function applyInrAgentPublicationPlacement(
  payload: JsonRecord,
  channel: InrAgentMetaChannel,
  placementValue: unknown,
): JsonRecord {
  const placement = normalizeInrAgentPublicationPlacement(placementValue);
  const settingsKey = inrAgentPublicationSettingsKey(channel);
  const placementKey = inrAgentPublicationPlacementKey(channel);
  const nextPayload = { ...payload };
  const nextPublishPayload = { ...asRecord(payload.publishPayload) };

  if (placement === "classic") {
    delete nextPayload[settingsKey];
    delete nextPayload[placementKey];
    delete nextPublishPayload[settingsKey];
    delete nextPublishPayload[placementKey];
  } else {
    const settings = { placement, mediaOnly: true };
    nextPayload[settingsKey] = settings;
    nextPayload[placementKey] = placement;
    nextPublishPayload[settingsKey] = settings;
    nextPublishPayload[placementKey] = placement;
  }

  nextPayload.publishPayload = nextPublishPayload;
  return nextPayload;
}

export function publicationSettingsForInrAgentChannel(
  payload: unknown,
  channel: InrAgentMetaChannel,
): { placement: "reel" | "story" } | null {
  const placement = readInrAgentPublicationPlacement(payload, channel);
  return placement === "classic" ? null : { placement };
}
