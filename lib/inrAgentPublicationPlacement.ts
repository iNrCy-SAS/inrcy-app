import type { FacebookPublicationPlacement } from "@/lib/facebookPublicationPreferences";
import type { InstagramPublicationPlacement } from "@/lib/instagramPublicationPreferences";
import {
  buildMetaPublicationSelection,
  normalizeMetaPublicationSelection,
  type MetaPublicationSelection,
  type MetaPrimaryPublicationPlacement,
} from "./metaPublicationTargets.ts";

export type InrAgentMetaChannel = "facebook" | "instagram";
export type InrAgentPublicationPlacement =
  | FacebookPublicationPlacement
  | InstagramPublicationPlacement;
export type InrAgentPublicationSelection = MetaPublicationSelection;

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
  return readInrAgentPublicationSelection(payload, channel).primaryPlacement;
}

/**
 * Reads the current v2 selection (primary format + optional Story) while
 * keeping every historical single-placement action fully compatible.
 */
export function readInrAgentPublicationSelection(
  payload: unknown,
  channel: InrAgentMetaChannel,
): InrAgentPublicationSelection {
  const root = asRecord(payload);
  const publishPayload = asRecord(root.publishPayload);
  const settingsKey = inrAgentPublicationSettingsKey(channel);
  const placementKey = inrAgentPublicationPlacementKey(channel);
  const directSettings = asRecord(root[settingsKey]);
  const nestedSettings = asRecord(publishPayload[settingsKey]);
  const settings = Object.keys(directSettings).length
    ? directSettings
    : Object.keys(nestedSettings).length
      ? nestedSettings
      : {
          placement: root[placementKey] ?? publishPayload[placementKey],
        };
  return normalizeMetaPublicationSelection(settings);
}

/**
 * Stores the choice at both action and publishPayload boundaries. Classic
 * without Story is represented by the absence of special settings; every
 * combined selection uses the shared Meta v2 contract consumed by Booster.
 */
export function applyInrAgentPublicationPlacement(
  payload: JsonRecord,
  channel: InrAgentMetaChannel,
  placementValue: unknown,
  includeStoryValue: unknown = false,
): JsonRecord {
  const requestedSelection =
    placementValue &&
    typeof placementValue === "object" &&
    !Array.isArray(placementValue)
      ? normalizeMetaPublicationSelection(placementValue)
      : buildMetaPublicationSelection(
          normalizeInrAgentPublicationPlacement(
            placementValue,
          ) as MetaPrimaryPublicationPlacement,
          includeStoryValue === true,
        );
  const placement = requestedSelection.primaryPlacement;
  const includeStory = requestedSelection.includeStory;
  const settingsKey = inrAgentPublicationSettingsKey(channel);
  const placementKey = inrAgentPublicationPlacementKey(channel);
  const nextPayload = { ...payload };
  const nextPublishPayload = { ...asRecord(payload.publishPayload) };

  if (placement === "classic" && !includeStory) {
    delete nextPayload[settingsKey];
    delete nextPayload[placementKey];
    delete nextPublishPayload[settingsKey];
    delete nextPublishPayload[placementKey];
  } else {
    const settings = {
      ...requestedSelection,
      // Kept for old workers that still read the former one-placement alias.
      placement,
      mediaOnly: placement === "story",
    };
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
): (InrAgentPublicationSelection & {
  placement: InrAgentPublicationPlacement;
  mediaOnly: boolean;
}) | null {
  const selection = readInrAgentPublicationSelection(payload, channel);
  if (
    selection.primaryPlacement === "classic" &&
    !selection.includeStory
  ) {
    return null;
  }
  return {
    ...selection,
    placement: selection.primaryPlacement,
    mediaOnly: selection.primaryPlacement === "story",
  };
}
