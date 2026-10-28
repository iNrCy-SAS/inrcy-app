import { normalizeMediaSoundtrackId } from "./mediaSoundtrackSelection.ts";
import {
  isInrAgentMetaChannel,
  readInrAgentPublicationSelection,
  type InrAgentMetaChannel,
} from "./inrAgentPublicationPlacement.ts";

type Payload = Record<string, unknown>;
const record = (value: unknown): Payload => value && typeof value === "object" && !Array.isArray(value)
  ? value as Payload : {};

/** Client-safe draft reader. Catalogue membership is checked again by the API. */
export function readInrAgentPublicationSoundtrack(payload: unknown, channel: InrAgentMetaChannel): string | null {
  if (!isInrAgentMetaChannel(channel)) return null;
  const root = record(payload), nested = record(root.publishPayload);
  for (const source of [root, nested]) {
    const selection = record(source.soundtrackByChannel);
    if (Object.hasOwn(selection, channel)) return normalizeMediaSoundtrackId(selection[channel]);
  }
  return normalizeMediaSoundtrackId(Object.hasOwn(root, "soundtrackId") ? root.soundtrackId : nested.soundtrackId);
}

/** Keep explicit Auto and the other channel at both persistence boundaries. */
export function applyInrAgentPublicationSoundtrack(payload: Payload, channel: InrAgentMetaChannel, id: unknown): Payload {
  if (!isInrAgentMetaChannel(channel) || (id !== null && (typeof id !== "string" || normalizeMediaSoundtrackId(id) !== id))) {
    throw new Error("booster_soundtrack_invalid");
  }
  const nested = record(payload.publishPayload);
  const soundtrackByChannel = {
    ...record(nested.soundtrackByChannel),
    ...record(payload.soundtrackByChannel),
    [channel]: id,
  };
  return { ...payload, soundtrackByChannel, publishPayload: { ...nested, soundtrackByChannel: { ...soundtrackByChannel } } };
}

/** Existing video audio is preserved; photo videos are rendered at dispatch. */
export function canConfigureInrAgentPublicationSoundtrack(payload: unknown, channel: InrAgentMetaChannel): boolean {
  if (!isInrAgentMetaChannel(channel)) return false;
  const selection = readInrAgentPublicationSelection(payload, channel);
  if (selection.primaryPlacement === "classic" && !selection.includeStory) return false;
  const root = record(payload), nested = record(root.publishPayload);
  const mode = record(root.mediaModeByChannel)[channel] ?? record(nested.mediaModeByChannel)[channel];
  if (mode === "video") return false;
  if (mode === "images" || mode === "image" || mode === "none") return true;
  const channelImages = record(root.imagesByChannel)[channel] ?? record(nested.imagesByChannel)[channel];
  if (Array.isArray(channelImages) && channelImages.length) return true;
  const channelVideo = record(root.videoByChannel)[channel] ?? record(nested.videoByChannel)[channel];
  if (Object.keys(record(channelVideo)).length) return false;
  const variants = record(record(root.mediaFormatVariantsByChannel)[channel] ?? record(nested.mediaFormatVariantsByChannel)[channel]
    ?? root.mediaFormatVariants ?? nested.mediaFormatVariants);
  if (variants.kind === "image") return true;
  if (variants.kind === "video") return false;
  const post = record(record(root.postByChannel)[channel] ?? record(nested.postByChannel)[channel]);
  const media = [root.mediaAsset, root.media, root.videoAsset, root.video, root.imageAsset, root.image,
    nested.mediaAsset, nested.media, nested.videoAsset, nested.video, nested.imageAsset, nested.image,
    post.media, post.mediaAsset, post.video, post.videoAsset].map(record).find(value => Object.keys(value).length) || {};
  const hint = String(media.kind || media.mediaType || media.media_type || media.mimeType || media.mime_type
    || media.type || media.url || media.storagePath || media.storage_path || media.path || "").toLowerCase();
  return !hint.includes("video") && !/\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(hint)
    && String(root.mediaType ?? nested.mediaType ?? "") !== "video";
}

/** A dispatched/uncertain Story keeps its original soundtrack and checkpoint. */
export function isInrAgentPublicationSoundtrackLocked(payload: unknown, channel: InrAgentMetaChannel): boolean {
  if (!isInrAgentMetaChannel(channel)) return true;
  const root = record(payload), nested = record(root.publishPayload);
  const inspectResult = (value: unknown, depth = 0): boolean => {
    if (depth > 7 || !value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(item => inspectResult(item, depth + 1));
    const entry = record(value);
    if (entry.channel && entry.channel !== channel) return false;
    if (entry.story_sequence_resume_ref || entry.storySequenceResumeRef || entry.publishStarted === true
      || entry.requestMayHaveSucceeded === true || Number(entry.published_image_count) > 0) return true;
    if (record(entry.storySequenceResumeByChannel)[channel]) return true;
    if (Object.hasOwn(entry, channel) && inspectResult(entry[channel], depth + 1)) return true;
    return ["summary", "results", "publishResult", "response", "entries", "placements", "story"]
      .some(key => inspectResult(entry[key], depth + 1));
  };
  for (const source of [root, nested]) {
    if (inspectResult(source)) return true;
    for (const key of ["execution", "partialImmediateExecution", "lastExecution"]) {
      const execution = record(source[key]);
      if (Array.isArray(execution.channels) && !execution.channels.includes(channel)) continue;
      if (execution.executedAt || execution.at || Number(execution.attemptCount) > 0 || inspectResult(execution)) return true;
    }
  }
  return false;
}
