import type { AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";
import { readInrAgentPublicationSelection } from "./inrAgentPublicationPlacement.ts";

export type InrAgentMediaFormat = AiMediaGenerationRequest["format"];
export type InrAgentMediaFormatPlan = {
  version: 1;
  kind: "image" | "video";
  defaultFormat: InrAgentMediaFormat;
  formats: InrAgentMediaFormat[];
  byChannel: Record<string, InrAgentMediaFormat>;
};
export type InrAgentMediaFormatVariants<T = Record<string, unknown>> = {
  version: 1;
  kind: "image" | "video";
  defaultFormat: InrAgentMediaFormat;
  byFormat: Partial<Record<InrAgentMediaFormat, T[]>>;
};

const FORMATS: InrAgentMediaFormat[] = ["portrait", "story", "landscape", "square"];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** One generation per useful format, never one generation per destination. */
export function buildInrAgentMediaFormatPlan(args: {
  kind: "image" | "video";
  channels: readonly string[];
  payload?: unknown;
  /** Opt-in only: web/GMB never acquire another generation by default. */
  landscapeChannels?: readonly string[];
}): InrAgentMediaFormatPlan {
  const byChannel: Record<string, InrAgentMediaFormat> = {};
  const required = new Set<InrAgentMediaFormat>();
  for (const channel of new Set(args.channels)) {
    let format: InrAgentMediaFormat = args.kind === "video" || (channel === "tiktok" && record(args.payload).tiktokPhotoFullScreen !== false) ? "story" : "portrait";
    if (args.landscapeChannels?.includes(channel)) format = "landscape";
    if (channel === "facebook" || channel === "instagram") {
      const selection = readInrAgentPublicationSelection(args.payload, channel);
      if (selection.primaryPlacement !== "classic") format = "story";
      if (selection.includeStory) required.add("story");
    }
    byChannel[channel] = format;
    required.add(format);
  }
  const defaultFormat = required.has("portrait") ? "portrait" : required.has("story") ? "story" : "landscape";
  return { version: 1, kind: args.kind, defaultFormat, formats: FORMATS.filter((format) => required.has(format)), byChannel };
}

export function readInrAgentMediaFormatVariants<T = Record<string, unknown>>(
  payload: unknown,
): InrAgentMediaFormatVariants<T> | null {
  const root = record(payload);
  const raw = record(root.mediaFormatVariants || record(root.publishPayload).mediaFormatVariants);
  if (raw.version !== 1 || (raw.kind !== "image" && raw.kind !== "video") || !FORMATS.includes(raw.defaultFormat as InrAgentMediaFormat)) return null;
  const byFormat = Object.fromEntries(FORMATS.flatMap((format) => {
    const values = record(raw.byFormat)[format];
    return Array.isArray(values) && values.length ? [[format, values.slice(0, raw.kind === "video" ? 1 : 3)]] : [];
  })) as InrAgentMediaFormatVariants<T>["byFormat"];
  if (!byFormat[raw.defaultFormat as InrAgentMediaFormat]?.length) return null;
  return { version: 1, kind: raw.kind, defaultFormat: raw.defaultFormat as InrAgentMediaFormat, byFormat };
}

/** A publication can change placement later; reuse its existing format first. */
export function bindInrAgentMediaFormatVariants<T>(args: {
  variants: InrAgentMediaFormatVariants<T>;
  channels: readonly string[];
  payload?: unknown;
}) {
  const plan = buildInrAgentMediaFormatPlan({ kind: args.variants.kind, channels: args.channels, payload: args.payload });
  const imagesByChannel: Record<string, T[]> = {};
  const videoByChannel: Record<string, T | null> = {};
  const imagesByPlacement: Record<string, Partial<Record<"classic" | "reel" | "story", T[]>>> = {};
  for (const channel of args.channels) {
    const values = args.variants.byFormat[plan.byChannel[channel]] || [];
    if (args.variants.kind === "image") {
      imagesByChannel[channel] = values;
      if (channel === "facebook" || channel === "instagram") {
        imagesByPlacement[channel] = {
          ...(args.variants.byFormat.portrait ? { classic: args.variants.byFormat.portrait } : {}),
          ...(args.variants.byFormat.story ? { reel: args.variants.byFormat.story, story: args.variants.byFormat.story } : {}),
        };
      }
    } else videoByChannel[channel] = values[0] || null;
  }
  return { mediaFormatVariants: args.variants, imagesByChannel, videoByChannel, imagesByPlacement };
}

/** Explicit per-channel selections must never be merged with other formats. */
export function inrAgentChannelImages(payload: unknown, channel?: string): unknown[] | null {
  const root = record(payload);
  const nested = record(root.publishPayload);
  if (!channel) {
    const variants = readInrAgentMediaFormatVariants(payload);
    return variants?.kind === "image" ? variants.byFormat[variants.defaultFormat] || [] : null;
  }
  const direct = record(root.imagesByChannel)[channel] ?? record(nested.imagesByChannel)[channel];
  return Array.isArray(direct) ? direct : null;
}

/** Select the native file when the durable dispatcher splits Classic/Story. */
export function inrAgentImagesForPlacement<T>(args: {
  source: unknown;
  imagesByPlacement: unknown;
  channel: string;
  placement?: string | null;
  fallback: T[];
}): T[] {
  const selected = record(record(args.imagesByPlacement)[args.channel])[args.placement || "classic"];
  return String(args.source || "").startsWith("inr_agent") && Array.isArray(selected) ? selected as T[] : args.fallback;
}
